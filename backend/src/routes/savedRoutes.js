import { Router } from 'express';
import { Follow } from '../models/Follow.js';
import mongoose from 'mongoose';
import { Post } from '../models/Post.js';
import { SavedPost } from '../models/SavedPost.js';
import { Block } from '../models/Block.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { postForClient } from '../services/postPresentation.js';

export const savedRoutes = Router();
savedRoutes.use(requireAuth);

savedRoutes.get('/', async (req, res, next) => {
  try {
    const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 20, 1), 30);
    const filter = { user: req.user._id };
    if (req.query.before) {
      if (!mongoose.isValidObjectId(req.query.before)) return res.status(400).json({ error: { message: 'Invalid pagination cursor.' } });
      filter._id = { $lt: req.query.before };
    }
    const rows = await SavedPost.find(filter).sort({ _id: -1 }).limit(limit + 1)
      .populate({ path: 'post', populate: [{ path: 'author', select: 'username displayName avatarUrl headline isPrivate' }, { path: 'comments.author', select: 'username displayName avatarUrl headline' }] });
    const permitted = [];
    for (const row of rows) {
      const post = row.post;
      if (!post) continue;
      const blocked = post.author._id.toString() !== req.user.id && await Block.exists({ $or: [{ blocker: req.user._id, blocked: post.author._id }, { blocker: post.author._id, blocked: req.user._id }] });
      if (!blocked && (post.author._id.toString() === req.user.id || ((!post.author.isPrivate && post.visibility === 'public') || await Follow.exists({ follower: req.user._id, following: post.author._id })))) {
        permitted.push(postForClient({ ...post.toObject(), likeCount: post.likes.length, likedByMe: post.likes.some((id) => id.toString() === req.user.id), isSaved: true, likes: undefined }, req.user._id));
      }
      if (permitted.length > limit) break;
    }
    const posts = permitted.slice(0, limit);
    res.json({ posts, nextCursor: permitted.length > limit ? rows[limit - 1]?._id : null });
  } catch (error) { next(error); }
});
