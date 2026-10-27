import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { Follow } from '../models/Follow.js';
import { FollowRequest } from '../models/FollowRequest.js';
import { Post } from '../models/Post.js';
import { SavedPost } from '../models/SavedPost.js';
import { Block } from '../models/Block.js';
import { createNotification } from '../services/notifications.js';
import { commentInput, postInput } from '../utils/validation.js';
import { User } from '../models/User.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireClientOrigin } from '../middleware/requireClientOrigin.js';
import { parseImageUpload, POST_IMAGE_MAX_BYTES, validateImageFile } from '../middleware/imageUpload.js';
import { destroyCloudinaryImageIfUnreferenced, uploadCloudinaryImage } from '../services/cloudinary.js';
import { postForClient, reactionSummary, REACTION_KINDS } from '../services/postPresentation.js';

export const postRoutes = Router();
postRoutes.use(requireAuth);
postRoutes.param('postId', (req, res, next, id) => {
  if (!mongoose.isValidObjectId(id)) return res.status(400).json({ error: { message: 'Invalid post ID.' } });
  next();
});
postRoutes.param('commentId', (req, res, next, id) => {
  if (!mongoose.isValidObjectId(id)) return res.status(400).json({ error: { message: 'Invalid comment ID.' } });
  next();
});

const userProjection = 'username displayName avatarUrl headline';

async function followingIds(userId) {
  const rows = await Follow.find({ follower: userId }).select('following').lean();
  return rows.map((row) => row.following);
}

export async function canView(post, viewerId) {
  if (post.author._id.toString() === viewerId.toString()) return true;
  if (await Block.exists({ $or: [{ blocker: viewerId, blocked: post.author._id }, { blocker: post.author._id, blocked: viewerId }] })) return false;
  const authorPrivate = post.author.isPrivate;
  if (authorPrivate || post.visibility === 'followers') {
    return Boolean(await Follow.exists({ follower: viewerId, following: post.author._id }));
  }
  return true;
}

async function populatePost(query, viewerId) {
  const post = await query.populate({ path: 'author', select: userProjection + ' isPrivate' }).populate({ path: 'comments.author', select: userProjection });
  if (!post || !(await canView(post, viewerId))) return null;
  const saved = await SavedPost.exists({ user: viewerId, post: post._id });
  return postForClient({ ...post.toObject(), likeCount: post.likes.length, likedByMe: post.likes.some((id) => id.toString() === viewerId.toString()), isSaved: Boolean(saved), likes: undefined }, viewerId);
}

async function feedPage(baseQuery, cursorId, limit, viewerId) {
  const query = { ...baseQuery };
  if (cursorId) {
    const cursorPost = await Post.findById(cursorId).select('createdAt');
    if (!cursorPost) return { posts: [], cursorId: null, hasMore: false };
    query.$or = [
      { createdAt: { $lt: cursorPost.createdAt } },
      { createdAt: cursorPost.createdAt, _id: { $lt: cursorPost._id } },
    ];
  }

  const scanLimit = limit * 4 + 1;
  const batch = await Post.find(query).sort({ createdAt: -1, _id: -1 }).limit(scanLimit + 1)
    .populate({ path: 'author', select: userProjection + ' isPrivate' })
    .populate({ path: 'comments.author', select: userProjection }).lean();
  const scanned = batch.slice(0, scanLimit);
  const permitted = [];
  for (const post of scanned) {
    if (post.author && await canView(post, viewerId)) permitted.push(post);
    if (permitted.length > limit) break;
  }

  if (permitted.length > limit) {
    return { posts: permitted.slice(0, limit), cursorId: permitted[limit - 1]._id, hasMore: true };
  }
  if (batch.length > scanLimit) {
    return { posts: permitted, cursorId: scanned.at(-1)?._id || null, hasMore: true };
  }
  return { posts: permitted, cursorId: null, hasMore: false };
}

postRoutes.get('/', async (req, res, next) => {
  try {
    const mode = req.query.feed === 'following' ? 'following' : 'explore';
    const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 20, 1), 30);
    if (mode === 'following') {
      let phase = 'following';
      let cursorId = '';
      const suppliedCursor = typeof req.query.cursor === 'string' ? req.query.cursor : '';
      const legacyCursor = typeof req.query.before === 'string' ? req.query.before : '';
      if (suppliedCursor) {
        const match = /^(f|p)(?:\.([a-f\d]{24}))?$/i.exec(suppliedCursor);
        if (!match || (match[1].toLowerCase() === 'f' && !match[2])) return res.status(400).json({ error: { message: 'Invalid feed cursor.' } });
        phase = match[1].toLowerCase() === 'f' ? 'following' : 'public';
        cursorId = match[2] || '';
      } else if (legacyCursor) {
        if (!mongoose.isValidObjectId(legacyCursor)) return res.status(400).json({ error: { message: 'Invalid pagination cursor.' } });
        cursorId = legacyCursor;
      }

      const followed = [...new Set([req.user.id, ...(await followingIds(req.user.id)).map((id) => id.toString())])];
      let posts = [];
      let nextCursor = null;
      if (phase === 'following') {
        const preferred = await feedPage({ author: { $in: followed } }, cursorId, limit, req.user._id);
        posts = preferred.posts;
        if (preferred.hasMore) nextCursor = preferred.cursorId ? `f.${preferred.cursorId}` : null;
        else if (posts.length >= limit) nextCursor = 'p';
        else { phase = 'public'; cursorId = ''; }
      }
      if (phase === 'public' && posts.length < limit) {
        const publicPage = await feedPage({ visibility: 'public', author: { $nin: followed } }, cursorId, limit - posts.length, req.user._id);
        posts.push(...publicPage.posts);
        nextCursor = publicPage.hasMore ? `p.${publicPage.cursorId}` : null;
      }

      const authorIds = [...new Set(posts.map((post) => post.author._id.toString()))];
      const pendingRequests = authorIds.length
        ? await FollowRequest.find({ follower: req.user._id, following: { $in: authorIds } }).select('following').lean()
        : [];
      const pendingIds = new Set(pendingRequests.map((row) => row.following.toString()));
      const followedIds = new Set(followed);
      const savedRows = posts.length ? await SavedPost.find({ user: req.user._id, post: { $in: posts.map((post) => post._id) } }).select('post').lean() : [];
      const savedIds = new Set(savedRows.map((row) => row.post.toString()));
      const result = posts.map((post) => {
        const authorId = post.author._id.toString();
        const author = { ...post.author,
          isFollowing: authorId !== req.user.id && followedIds.has(authorId),
          hasPendingFollowRequest: pendingIds.has(authorId),
        };
        return postForClient({ ...post, author, likeCount: post.likes.length,
          likedByMe: post.likes.some((id) => id.toString() === req.user.id), isSaved: savedIds.has(post._id.toString()), likes: undefined }, req.user._id);
      });
      res.json({ posts: result, nextCursor });
      return;
    }

    const query = {};
    if (req.query.before) {
      if (!mongoose.isValidObjectId(req.query.before)) return res.status(400).json({ error: { message: 'Invalid pagination cursor.' } });
      const cursorPost = await Post.findById(req.query.before).select('createdAt');
      if (!cursorPost) return res.json({ posts: [], nextCursor: null });
      query.$or = [{ createdAt: { $lt: cursorPost.createdAt } }, { createdAt: cursorPost.createdAt, _id: { $lt: cursorPost._id } }];
    }
    query.visibility = 'public';

    const batch = await Post.find(query).sort({ createdAt: -1, _id: -1 }).limit(limit * 4 + 1)
      .populate({ path: 'author', select: userProjection + ' isPrivate' }).populate({ path: 'comments.author', select: userProjection }).lean();
    const visible = [];
    for (const post of batch) {
      const owner = post.author;
      if (!owner) continue;
      const blocked = owner._id.toString() !== req.user.id && await Block.exists({ $or: [{ blocker: req.user._id, blocked: owner._id }, { blocker: owner._id, blocked: req.user._id }] });
      const permitted = !blocked && (owner._id.toString() === req.user.id ||
        ((!owner.isPrivate && post.visibility === 'public') || await Follow.exists({ follower: req.user._id, following: owner._id })));
      if (permitted) visible.push(post);
      if (visible.length > limit) break;
    }
    const page = visible.slice(0, limit);
    const savedRows = page.length ? await SavedPost.find({ user: req.user._id, post: { $in: page.map((post) => post._id) } }).select('post').lean() : [];
    const savedIds = new Set(savedRows.map((row) => row.post.toString()));
    const posts = page.map((post) => postForClient({ ...post, likeCount: post.likes.length, likedByMe: post.likes.some((id) => id.toString() === req.user.id), isSaved: savedIds.has(post._id.toString()), likes: undefined }, req.user._id));
    res.json({ posts, nextCursor: visible.length > limit ? page.at(-1)?._id : null });
  } catch (error) { next(error); }
});

postRoutes.post('/', requireClientOrigin, parseImageUpload(POST_IMAGE_MAX_BYTES), async (req, res, next) => {
  let uploadedAsset;
  try {
    const input = postInput.safeParse(req.body);
    if (!input.success) return res.status(400).json({ error: { message: input.error.issues.map((issue) => issue.message).join(' ') } });
    if (!input.data.text && !req.file) return res.status(400).json({ error: { message: 'Write something or attach an image to create a post.' } });
    let image;
    if (req.file) {
      validateImageFile(req.file, POST_IMAGE_MAX_BYTES);
      uploadedAsset = await uploadCloudinaryImage(req.file.buffer, `chattr/posts/${req.user.id}`);
      image = { cloudinaryUrl: uploadedAsset.secure_url, publicId: uploadedAsset.public_id, width: uploadedAsset.width, height: uploadedAsset.height, format: uploadedAsset.format === 'jpeg' ? 'jpg' : uploadedAsset.format, bytes: uploadedAsset.bytes, alt: input.data.imageAlt || '' };
    }
    const { imageAlt: _imageAlt, ...postFields } = input.data;
    const post = await Post.create({ ...postFields, author: req.user._id, ...(image ? { image } : {}) });
    res.status(201).json({ post: await populatePost(Post.findById(post._id), req.user._id) });
  } catch (error) {
    if (uploadedAsset?.public_id) await destroyCloudinaryImageIfUnreferenced(uploadedAsset.public_id).catch(() => {});
    if ([502, 503].includes(error.status)) return res.status(error.status).json({ error: { message: error.message } });
    next(error);
  }
});

postRoutes.get('/tag/:tag', async (req, res, next) => {
  try {
    const tag = String(req.params.tag || '').trim().toLowerCase().replace(/^#/, '');
    if (!/^[\p{L}\p{N}_]{1,40}$/u.test(tag)) return res.status(400).json({ error: { message: 'That tag is not valid.' } });
    const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 20, 1), 30);
    const cursor = typeof req.query.cursor === 'string' && mongoose.isValidObjectId(req.query.cursor) ? req.query.cursor : '';
    const page = await feedPage({ tags: tag }, cursor, limit, req.user._id);
    const savedRows = page.posts.length ? await SavedPost.find({ user: req.user._id, post: { $in: page.posts.map((post) => post._id) } }).select('post').lean() : [];
    const savedIds = new Set(savedRows.map((row) => row.post.toString()));
    const posts = page.posts.map((post) => postForClient({ ...post, likeCount: post.likes.length, likedByMe: post.likes.some((id) => id.toString() === req.user.id), isSaved: savedIds.has(post._id.toString()), likes: undefined }, req.user._id));
    res.json({ tag, posts, nextCursor: page.hasMore ? page.cursorId : null });
  } catch (error) { next(error); }
});

postRoutes.put('/:postId/react', requireClientOrigin, async (req, res, next) => {
  try {
    const input = z.object({ kind: z.enum(REACTION_KINDS) }).strict().safeParse(req.body);
    if (!input.success) return res.status(400).json({ error: { message: 'Choose a valid reaction.' } });
    const post = await Post.findById(req.params.postId).populate('author', 'isPrivate');
    if (!post || !(await canView(post, req.user._id))) return res.status(404).json({ error: { message: 'Post not found.' } });
    const existing = post.reactions.find((reaction) => reaction.user.toString() === req.user.id);
    const isNew = !existing;
    if (existing) existing.kind = input.data.kind; else post.reactions.push({ user: req.user._id, kind: input.data.kind });
    await post.save();
    if (isNew) await createNotification({ recipient: post.author._id, actor: req.user._id, type: 'reaction', entityId: post._id, text: input.data.kind });
    res.json({ reactions: reactionSummary(post.reactions, req.user._id) });
  } catch (error) { next(error); }
});

postRoutes.delete('/:postId/react', requireClientOrigin, async (req, res, next) => {
  try {
    const post = await Post.findById(req.params.postId).populate('author', 'isPrivate');
    if (!post || !(await canView(post, req.user._id))) return res.status(404).json({ error: { message: 'Post not found.' } });
    await Post.updateOne({ _id: post._id }, { $pull: { reactions: { user: req.user._id } } });
    const updated = await Post.findById(post._id).select('reactions');
    res.json({ reactions: reactionSummary(updated.reactions, req.user._id) });
  } catch (error) { next(error); }
});

postRoutes.get('/:postId', async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.postId)) return res.status(400).json({ error: { message: 'Invalid post ID.' } });
    const post = await populatePost(Post.findById(req.params.postId), req.user._id);
    if (!post) return res.status(404).json({ error: { message: 'Post not found.' } });
    res.json({ post });
  } catch (error) { next(error); }
});

postRoutes.patch('/:postId', requireClientOrigin, async (req, res, next) => {
  try {
    const input = z.object({ text: z.string().trim().min(1).max(2000) }).strict().safeParse(req.body);
    if (!input.success) return res.status(400).json({ error: { message: 'Post text must be between 1 and 2000 characters.' } });
    const post = await Post.findById(req.params.postId);
    if (!post) return res.status(404).json({ error: { message: 'Post not found.' } });
    if (post.author.toString() !== req.user.id) return res.status(403).json({ error: { message: 'You can only edit your own posts.' } });
    post.text = input.data.text;
    await post.save();
    res.json({ post: await populatePost(Post.findById(post._id), req.user._id) });
  } catch (error) { next(error); }
});

postRoutes.delete('/:postId', requireClientOrigin, async (req, res, next) => {
  try {
    const post = await Post.findById(req.params.postId).select('+image.publicId');
    if (!post) return res.status(404).json({ error: { message: 'Post not found.' } });
    if (post.author.toString() !== req.user.id) return res.status(403).json({ error: { message: 'You can only delete your own posts.' } });
    await Promise.all([post.deleteOne(), SavedPost.deleteMany({ post: post._id })]);
    if (post.image?.publicId) await destroyCloudinaryImageIfUnreferenced(post.image.publicId).catch(() => {});
    res.status(204).end();
  } catch (error) { next(error); }
});

postRoutes.put('/:postId/like', requireClientOrigin, async (req, res, next) => {
  try {
    const post = await Post.findById(req.params.postId).populate('author', 'isPrivate');
    if (!post || !(await canView(post, req.user._id))) return res.status(404).json({ error: { message: 'Post not found.' } });
    const result = await Post.updateOne({ _id: post._id }, { $addToSet: { likes: req.user._id } });
    if (result.modifiedCount) await createNotification({ recipient: post.author._id, actor: req.user._id, type: 'like', entityId: post._id });
    const updated = await Post.findById(post._id).select('likes');
    res.json({ liked: true, likeCount: updated.likes.length });
  } catch (error) { next(error); }
});

postRoutes.delete('/:postId/like', requireClientOrigin, async (req, res, next) => {
  try {
    const post = await Post.findById(req.params.postId).populate('author', 'isPrivate');
    if (!post || !(await canView(post, req.user._id))) return res.status(404).json({ error: { message: 'Post not found.' } });
    await Post.updateOne({ _id: post._id }, { $pull: { likes: req.user._id } });
    const updated = await Post.findById(post._id).select('likes');
    res.json({ liked: false, likeCount: updated.likes.length });
  } catch (error) { next(error); }
});

postRoutes.post('/:postId/comments', requireClientOrigin, async (req, res, next) => {
  try {
    const input = commentInput.safeParse(req.body);
    if (!input.success) return res.status(400).json({ error: { message: 'Comment must be between 1 and 1000 characters.' } });
    const post = await Post.findById(req.params.postId).populate('author', 'isPrivate');
    if (!post || !(await canView(post, req.user._id))) return res.status(404).json({ error: { message: 'Post not found.' } });
    post.comments.push({ author: req.user._id, text: input.data.text });
    await post.save();
    await post.populate({ path: 'comments.author', select: userProjection });
    await createNotification({ recipient: post.author._id, actor: req.user._id, type: 'comment', entityId: post._id, text: input.data.text.slice(0, 100) });
    res.status(201).json({ comment: post.comments.at(-1), commentCount: post.comments.length });
  } catch (error) { next(error); }
});

postRoutes.delete('/:postId/comments/:commentId', requireClientOrigin, async (req, res, next) => {
  try {
    const post = await Post.findById(req.params.postId).populate('author', 'isPrivate');
    if (!post || !(await canView(post, req.user._id))) return res.status(404).json({ error: { message: 'Post not found.' } });
    const comment = post.comments.id(req.params.commentId);
    if (!comment) return res.status(404).json({ error: { message: 'Comment not found.' } });
    if (comment.author.toString() !== req.user.id && post.author._id.toString() !== req.user.id) return res.status(403).json({ error: { message: 'You cannot remove this comment.' } });
    comment.deleteOne();
    await post.save();
    res.status(204).end();
  } catch (error) { next(error); }
});

postRoutes.post('/:postId/save', requireClientOrigin, async (req, res, next) => {
  try {
    const post = await Post.findById(req.params.postId).populate('author', 'isPrivate');
    if (!post || !(await canView(post, req.user._id))) return res.status(404).json({ error: { message: 'Post not found.' } });
    await SavedPost.updateOne({ user: req.user._id, post: post._id }, { $setOnInsert: { user: req.user._id, post: post._id } }, { upsert: true });
    res.status(204).end();
  } catch (error) { next(error); }
});

postRoutes.delete('/:postId/save', requireClientOrigin, async (req, res, next) => {
  try {
    await SavedPost.deleteOne({ user: req.user._id, post: req.params.postId });
    res.status(204).end();
  } catch (error) { next(error); }
});

export { followingIds };
