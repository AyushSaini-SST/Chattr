import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireClientOrigin } from '../middleware/requireClientOrigin.js';
import { User } from '../models/User.js';
import { Follow } from '../models/Follow.js';
import { FollowRequest } from '../models/FollowRequest.js';
import { Block } from '../models/Block.js';
import { Conversation } from '../models/Conversation.js';
import { createNotification } from '../services/notifications.js';
import { Post } from '../models/Post.js';
import { SavedPost } from '../models/SavedPost.js';
import { decideFollowRequest, followProfile, hasAcceptedFollow } from '../services/followRequests.js';
import { parseImageUpload, AVATAR_IMAGE_MAX_BYTES, validateImageFile } from '../middleware/imageUpload.js';
import { destroyCloudinaryImageIfUnreferenced, uploadCloudinaryImage } from '../services/cloudinary.js';
import { postForClient } from '../services/postPresentation.js';
import { emitToUser, revokeConversationAccess } from '../realtime/socketServer.js';

export const userRoutes = Router();
const updateSchema = z.object({
  displayName: z.string().trim().min(1).max(60).optional(),
  bio: z.string().trim().max(280).optional(),
  headline: z.string().trim().max(100).optional(),
  profileLink: z.union([z.string().trim().max(200).url(), z.literal('')]).optional(),
  isPrivate: z.boolean().optional(),
  messagePreference: z.enum(['everyone', 'followers', 'nobody']).optional(),
  pinnedPostId: z.union([z.string().regex(/^[a-f\d]{24}$/i), z.null()]).optional(),
  quietHours: z.object({
    enabled: z.boolean(),
    start: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Quiet hours must use HH:MM.'),
    end: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Quiet hours must use HH:MM.'),
    timezoneOffset: z.number().int().min(-840).max(840).default(0),
  }).strict().optional(),
}).strict();

userRoutes.get('/search', requireAuth, async (req, res, next) => {
  try {
    const term = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 40) : '';
    if (term.length < 2) return res.json({ users: [] });
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const blocked = await Block.find({ $or: [{ blocker: req.user._id }, { blocked: req.user._id }] }).select('blocker blocked').lean();
    const blockedIds = blocked.map((item) => item.blocker.toString() === req.user.id ? item.blocked : item.blocker);
    const users = await User.find({ _id: { $ne: req.user._id, $nin: blockedIds }, isPrivate: false, $or: [{ username: new RegExp(escaped, 'i') }, { displayName: new RegExp(escaped, 'i') }] })
      .select('username displayName headline avatarUrl').sort({ username: 1 }).limit(20).lean();
    const followed = await Follow.find({ follower: req.user._id, following: { $in: users.map((user) => user._id) } }).select('following').lean();
    const followedIds = new Set(followed.map((item) => item.following.toString()));
    res.json({ users: users.map((user) => ({ ...user, isFollowing: followedIds.has(user._id.toString()) })) });
  } catch (error) { next(error); }
});

userRoutes.get('/suggestions', requireAuth, async (req, res, next) => {
  try {
    res.set('Cache-Control', 'no-store');
    const blocked = await Block.find({ $or: [{ blocker: req.user._id }, { blocked: req.user._id }] })
      .select('blocker blocked').lean();
    const blockedIds = blocked.map((item) => item.blocker.toString() === req.user.id ? item.blocked : item.blocker);
    const follows = await Follow.find({ follower: req.user._id }).select('following').lean();
    const followingIds = new Set(follows.map((item) => item.following.toString()));
    const pending = await FollowRequest.find({ follower: req.user._id }).select('following').lean();
    const pendingIds = new Set(pending.map((item) => item.following.toString()));
    const primaryExcludedIds = [...blockedIds, ...followingIds, ...pendingIds];
    const primary = await User.find({ _id: { $ne: req.user._id, $nin: primaryExcludedIds } })
      .select('username displayName isPrivate headline avatarUrl').sort({ createdAt: -1 }).limit(5).lean();
    const users = primary.map((person) => ({
      _id: person._id, username: person.username, displayName: person.displayName,
      isPrivate: Boolean(person.isPrivate), isFollowing: false,
      hasPendingFollowRequest: false,
      ...(!person.isPrivate ? { headline: person.headline, avatarUrl: person.avatarUrl } : {}),
    }));
    const fallbackCount = 5 - users.length;
    if (fallbackCount > 0 && followingIds.size > 0) {
      const fallback = await User.find({ _id: {
        $ne: req.user._id,
        $in: [...followingIds],
        $nin: [...blockedIds, ...pendingIds, ...users.map((person) => person._id)],
      } }).select('username displayName isPrivate headline avatarUrl').sort({ createdAt: -1 }).limit(fallbackCount).lean();
      users.push(...fallback.map((person) => ({
        _id: person._id, username: person.username, displayName: person.displayName,
        isPrivate: Boolean(person.isPrivate), isFollowing: true, hasPendingFollowRequest: false,
        avatarUrl: person.avatarUrl, headline: person.headline,
      })));
    }
    res.json({ users });
  } catch (error) { next(error); }
});

userRoutes.get('/discover', requireAuth, async (req, res, next) => {
  try {
    res.set('Cache-Control', 'no-store');
    const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 24, 1), 40);
    let group = 'primary';
    let cursorId = '';
    if (req.query.cursor !== undefined) {
      const cursorMatch = /^(p|f)(?:\.([a-f\d]{24}))?$/i.exec(req.query.cursor);
      if (!cursorMatch || (cursorMatch[1].toLowerCase() === 'p' && !cursorMatch[2])) return res.status(400).json({ error: { message: 'Invalid discovery cursor.' } });
      group = cursorMatch[1].toLowerCase() === 'p' ? 'primary' : 'following';
      cursorId = cursorMatch[2] || '';
    }

    const [blockedRows, follows, pending] = await Promise.all([
      Block.find({ $or: [{ blocker: req.user._id }, { blocked: req.user._id }] }).select('blocker blocked').lean(),
      Follow.find({ follower: req.user._id }).select('following').lean(),
      FollowRequest.find({ follower: req.user._id }).select('following').lean(),
    ]);
    const blockedIds = new Set(blockedRows.map((row) => row.blocker.toString() === req.user.id ? row.blocked.toString() : row.blocker.toString()));
    const followingIds = new Set(follows.map((row) => row.following.toString()));
    const pendingIds = new Set(pending.map((row) => row.following.toString()));
    const eligibleFollowingIds = [...followingIds].filter((id) => !blockedIds.has(id) && !pendingIds.has(id));

    let pageUsers = [];
    let nextCursor = null;
    let primaryExhausted = group === 'following';
    if (group === 'primary') {
      const userIdFilter = { $ne: req.user._id, $nin: [...blockedIds, ...followingIds, ...pendingIds] };
      if (cursorId) userIdFilter.$lt = cursorId;
      const primary = await User.find({ _id: userIdFilter })
        .select('username displayName isPrivate headline avatarUrl').sort({ _id: -1 }).limit(limit + 1).lean();
      const hasMorePrimary = primary.length > limit;
      primaryExhausted = !hasMorePrimary;
      pageUsers = primary.slice(0, limit);
      if (hasMorePrimary) nextCursor = `p.${pageUsers.at(-1)._id}`;
    }

    if (group === 'following' || (primaryExhausted && pageUsers.length < limit)) {
      const remaining = group === 'following' ? limit : limit - pageUsers.length;
      const followedFilter = { $in: eligibleFollowingIds, $nin: [req.user._id, ...blockedIds, ...pendingIds, ...pageUsers.map((person) => person._id)] };
      if (cursorId && group === 'following') followedFilter.$lt = cursorId;
      const followed = eligibleFollowingIds.length && remaining
        ? await User.find({ _id: followedFilter }).select('username displayName isPrivate headline avatarUrl').sort({ _id: -1 }).limit(remaining + 1).lean()
        : [];
      const hasMoreFollowed = followed.length > remaining;
      const selectedFollowed = followed.slice(0, remaining);
      pageUsers.push(...selectedFollowed);
      if (hasMoreFollowed) nextCursor = `f.${selectedFollowed.at(-1)._id}`;
      else if (group === 'primary') nextCursor = null;
    } else if (group === 'primary' && primaryExhausted && eligibleFollowingIds.length) {
      // The primary group ended exactly at the page boundary. Continue with follows on the next page.
      nextCursor = 'f';
    }

    const users = pageUsers.map((person) => {
      const isFollowing = followingIds.has(person._id.toString());
      return {
        _id: person._id,
        username: person.username,
        displayName: person.displayName,
        isPrivate: Boolean(person.isPrivate),
        isFollowing,
        hasPendingFollowRequest: false,
        ...(!person.isPrivate || isFollowing ? { headline: person.headline, avatarUrl: person.avatarUrl } : {}),
        postPreviews: [],
      };
    });

    const previewable = users.filter((person) => !person.isPrivate || person.isFollowing);
    const previewIds = previewable.map((person) => person._id);
    const selectedIds = users.map((person) => person._id);
    const previewFollowIds = previewable.filter((person) => person.isFollowing).map((person) => person._id);
    const pipeline = previewIds.length ? [
      { $match: { author: { $in: previewIds }, $or: [{ visibility: 'public' }, ...(previewFollowIds.length ? [{ author: { $in: previewFollowIds } }] : [])] } },
      { $sort: { createdAt: -1, _id: -1 } },
      { $group: { _id: '$author', posts: { $push: { _id: '$_id', text: '$text', createdAt: '$createdAt', visibility: '$visibility', image: '$image' } } } },
      { $project: { posts: { $slice: ['$posts', 3] } } },
    ] : null;
    const [previewRows, currentBlocks, currentFollows] = await Promise.all([
      pipeline ? Post.aggregate(pipeline) : [],
      selectedIds.length ? Block.find({ $or: [
        { blocker: req.user._id, blocked: { $in: selectedIds } },
        { blocker: { $in: selectedIds }, blocked: req.user._id },
      ] }).select('blocker blocked').lean() : [],
      selectedIds.length ? Follow.find({ follower: req.user._id, following: { $in: selectedIds } }).select('following').lean() : [],
    ]);
    const blockedPreviewIds = new Set(currentBlocks.map((row) => row.blocker.toString() === req.user.id ? row.blocked.toString() : row.blocker.toString()));
    const currentFollowingIds = new Set(currentFollows.map((row) => row.following.toString()));
    const visibleUsers = users.filter((person) => {
      const userId = person._id.toString();
      if (blockedPreviewIds.has(userId)) return false;
      // If a private follow was removed while this request was being assembled, do not
      // return stale private-profile metadata or previews from the earlier relationship read.
      return !(person.isPrivate && person.isFollowing && !currentFollowingIds.has(userId));
    }).map((person) => ({
      ...person,
      isFollowing: currentFollowingIds.has(person._id.toString()),
    }));
    const previewsByUser = new Map(previewRows.map((row) => [row._id.toString(), row.posts || []]));
    const result = visibleUsers.map((person) => {
      const userId = person._id.toString();
      const posts = (previewsByUser.get(userId) || []).filter((post) => {
        if (blockedPreviewIds.has(userId)) return false;
        return !(person.isPrivate || post.visibility === 'followers') || currentFollowingIds.has(userId);
      }).slice(0, 3).map((post) => postForClient({ ...post, author: person }));
      return { ...person, postPreviews: posts };
    });
    res.json({ users: result, nextCursor });
  } catch (error) { next(error); }
});

userRoutes.get('/blocked', requireAuth, async (req, res, next) => {
  try {
    const rows = await Block.find({ blocker: req.user._id }).populate('blocked', 'username displayName avatarUrl').sort({ createdAt: -1 });
    res.json({ users: rows.filter((row) => row.blocked).map((row) => row.blocked) });
  } catch (error) { next(error); }
});

userRoutes.get('/follow-requests', requireAuth, async (req, res, next) => {
  try {
    const requests = await FollowRequest.find({ following: req.user._id })
      .sort({ createdAt: -1 }).populate('follower', 'username displayName avatarUrl').lean();
    const followerIds = requests.map((request) => request.follower?._id || request.follower).filter(Boolean);
    const blocked = followerIds.length ? await Block.find({ $or: [
      { blocker: req.user._id, blocked: { $in: followerIds } },
      { blocker: { $in: followerIds }, blocked: req.user._id },
    ] }).select('blocker blocked').lean() : [];
    const blockedIds = new Set(blocked.map((row) => row.blocker.toString() === req.user.id ? row.blocked.toString() : row.blocker.toString()));
    res.json({ requests: requests.filter((request) => request.follower && !blockedIds.has((request.follower._id || request.follower).toString())) });
  } catch (error) { next(error); }
});

userRoutes.patch('/follow-requests/:requestId', requireAuth, requireClientOrigin, async (req, res, next) => {
  try {
    if (!/^[a-f\d]{24}$/i.test(req.params.requestId)) return res.status(400).json({ error: { message: 'Invalid follow request ID.' } });
    const decision = req.body?.decision;
    if (!['approve', 'reject'].includes(decision)) return res.status(400).json({ error: { message: 'Choose approve or reject.' } });
    const request = await FollowRequest.findById(req.params.requestId);
    if (request?.following.toString() === req.user.id && await Block.exists({ $or: [
      { blocker: req.user._id, blocked: request.follower },
      { blocker: request.follower, blocked: req.user._id },
    ] })) return res.status(403).json({ error: { message: 'This follow request is not available.' } });
    const result = await decideFollowRequest({ request, ownerId: req.user._id, decision, Follow, FollowRequest });
    if (result.status === 'not-found') return res.status(404).json({ error: { message: 'Follow request not found.' } });
    if (result.status === 'self-request') return res.status(403).json({ error: { message: 'You cannot approve your own follow request.' } });
    res.json({ status: result.status });
  } catch (error) { next(error); }
});

async function visibleRelationshipPeople(relations, direction, profileId, viewerId, { includePending = true } = {}) {
  const people = relations.map((relation) => relation[direction === 'followers' ? 'follower' : 'following']).filter(Boolean);
  const personIds = people.map((person) => person._id);
  if (!personIds.length) return { people: [], followingIds: new Set(), pendingIds: new Set() };

  const [blockedRows, viewerFollows, pendingRows] = await Promise.all([
    Block.find({ $or: [
      { blocker: viewerId, blocked: { $in: personIds } }, { blocker: { $in: personIds }, blocked: viewerId },
      { blocker: profileId, blocked: { $in: personIds } }, { blocker: { $in: personIds }, blocked: profileId },
    ] }).select('blocker blocked').lean(),
    Follow.find({ follower: viewerId, following: { $in: personIds } }).select('following').lean(),
    includePending
      ? FollowRequest.find({ follower: viewerId, following: { $in: personIds } }).select('following').lean()
      : [],
  ]);
  const blockedPairs = new Set(blockedRows.map((row) => `${row.blocker}:${row.blocked}`));
  const followingIds = new Set(viewerFollows.map((row) => row.following.toString()));
  const pendingIds = new Set(pendingRows.map((row) => row.following.toString()));
  const viewerIdString = viewerId.toString();
  const profileIdString = profileId.toString();
  const visiblePeople = people.filter((person) => {
    const id = person._id.toString();
    return (id === viewerIdString || !person.isPrivate || followingIds.has(id)) &&
      !blockedPairs.has(`${viewerIdString}:${id}`) && !blockedPairs.has(`${id}:${viewerIdString}`) &&
      !blockedPairs.has(`${profileIdString}:${id}`) && !blockedPairs.has(`${id}:${profileIdString}`);
  });
  return { people: visiblePeople, followingIds, pendingIds };
}

async function eligibleRelationshipCount(profileId, viewerId, direction) {
  const relationField = direction === 'followers' ? 'following' : 'follower';
  const targetField = direction === 'followers' ? 'follower' : 'following';
  const relations = await Follow.find({ [relationField]: profileId })
    .populate(targetField, 'username displayName avatarUrl isPrivate').lean();
  const result = await visibleRelationshipPeople(relations, direction, profileId, viewerId, { includePending: false });
  return result.people.length;
}

async function profileRelationshipList(req, res, next, direction) {
  try {
    const cursor = req.query.cursor;
    if (cursor !== undefined && !/^[a-f\d]{24}$/i.test(cursor)) return res.status(400).json({ error: { message: 'Invalid list cursor.' } });
    const profile = await User.findOne({ username: req.params.username.toLowerCase() }).select('_id isPrivate').lean();
    if (!profile) return res.status(404).json({ error: { message: 'We could not find that profile.' } });
    const isSelf = profile._id.toString() === req.user.id;
    const ownerViewerBlock = { $or: [{ blocker: req.user._id, blocked: profile._id }, { blocker: profile._id, blocked: req.user._id }] };
    if (!isSelf && await Block.exists(ownerViewerBlock)) return res.status(404).json({ error: { message: 'We could not find that profile.' } });
    const accepted = isSelf || await hasAcceptedFollow(req.user._id, profile._id, Follow);
    if (profile.isPrivate && !accepted) return res.status(403).json({ error: { message: 'This profile is private.' } });

    const relationQuery = direction === 'followers' ? { following: profile._id } : { follower: profile._id };
    if (cursor) relationQuery._id = { $lt: cursor };
    const relations = await Follow.find(relationQuery).sort({ _id: -1 }).limit(31)
      .populate(direction === 'followers' ? 'follower' : 'following', 'username displayName avatarUrl isPrivate').lean();
    const hasMore = relations.length > 30;
    const page = relations.slice(0, 30);
    const { people, followingIds, pendingIds } = await visibleRelationshipPeople(page, direction, profile._id, req.user._id);
    const users = people.map((person) => ({
      _id: person._id, username: person.username, displayName: person.displayName, avatarUrl: person.avatarUrl,
      isFollowing: followingIds.has(person._id.toString()), hasPendingFollowRequest: pendingIds.has(person._id.toString()),
    }));
    res.json({ users, nextCursor: hasMore ? page[page.length - 1]?._id : null });
  } catch (error) { next(error); }
}

userRoutes.get('/:username/followers', requireAuth, (req, res, next) => profileRelationshipList(req, res, next, 'followers'));
userRoutes.get('/:username/following', requireAuth, (req, res, next) => profileRelationshipList(req, res, next, 'following'));

userRoutes.get('/:username', requireAuth, async (req, res, next) => {
  try {
    const user = await User.findOne({ username: req.params.username.toLowerCase() });
    if (!user) return res.status(404).json({ error: { message: 'We could not find that profile.' } });
    const isSelf = user.id === req.user.id;
    const [blockedByViewer, blockedViewer] = isSelf ? [false, false] : await Promise.all([
      Block.exists({ blocker: req.user._id, blocked: user._id }),
      Block.exists({ blocker: user._id, blocked: req.user._id }),
    ]);
    if (blockedViewer) return res.status(404).json({ error: { message: 'We could not find that profile.' } });
    const [isFollowing, hasPendingFollowRequest] = await Promise.all([
      isSelf || blockedByViewer ? false : hasAcceptedFollow(req.user._id, user._id, Follow),
      isSelf || blockedByViewer ? false : FollowRequest.exists({ follower: req.user._id, following: user._id }),
    ]);
    const canViewDetails = isSelf || (!blockedByViewer && (!user.isPrivate || Boolean(isFollowing)));
    const [followerCount, followingCount] = canViewDetails ? await Promise.all([
      eligibleRelationshipCount(user._id, req.user._id, 'followers'),
      eligibleRelationshipCount(user._id, req.user._id, 'following'),
    ]) : [];
    const details = canViewDetails ? user.toJSON() : {
      _id: user._id, username: user.username, displayName: user.displayName,
      isPrivate: true,
    };
    res.json({ user: { ...details, isPrivate: user.isPrivate, canViewDetails,
      ...(canViewDetails ? { followerCount, followingCount } : {}),
      isFollowing: Boolean(isFollowing), hasPendingFollowRequest: Boolean(hasPendingFollowRequest), isBlockedByMe: Boolean(blockedByViewer) } });
  } catch (error) { next(error); }
});

userRoutes.patch('/me', requireAuth, requireClientOrigin, async (req, res, next) => {
  try {
    const result = updateSchema.safeParse(req.body);
    if (!result.success) return res.status(400).json({ error: { message: result.error.issues.map((issue) => issue.message).join(' ') } });
    const { pinnedPostId, ...fields } = result.data;
    const update = { ...fields };
    if (pinnedPostId !== undefined) {
      if (pinnedPostId === null) update.pinnedPost = null;
      else {
        const owned = await Post.exists({ _id: pinnedPostId, author: req.user._id });
        if (!owned) return res.status(404).json({ error: { message: 'You can only pin one of your own posts.' } });
        update.pinnedPost = pinnedPostId;
      }
    }
    const user = await User.findByIdAndUpdate(req.user.id, { $set: update }, { new: true, runValidators: true });
    res.json({ user: user.toJSON() });
  } catch (error) { next(error); }
});

// Read-only bundle of everything the account owns, as JSON. Private fields of
// other users are never included: only their public identity on relations.
userRoutes.get('/me/export', requireAuth, async (req, res, next) => {
  try {
    const [user, posts, saved, follows, followers, blocks, conversations] = await Promise.all([
      User.findById(req.user.id).lean(),
      Post.find({ author: req.user._id }).sort({ createdAt: -1 }).lean(),
      SavedPost.find({ user: req.user._id }).populate({ path: 'post', select: 'text visibility createdAt author', populate: { path: 'author', select: 'username' } }).lean(),
      Follow.find({ follower: req.user._id }).populate('following', 'username displayName').lean(),
      Follow.find({ following: req.user._id }).populate('follower', 'username displayName').lean(),
      Block.find({ blocker: req.user._id }).populate('blocked', 'username').lean(),
      Conversation.find({ $or: [{ participantA: req.user._id }, { participantB: req.user._id }] }).populate('participantA participantB', 'username displayName').lean(),
    ]);
    const { Message } = await import('../models/Message.js');
    const messages = await Message.find({ conversation: { $in: conversations.map((item) => item._id) }, deletedFor: { $ne: req.user._id }, deletedForEveryone: { $ne: true } })
      .sort({ createdAt: 1 }).populate('sender', 'username').lean();
    const bundle = {
      exportedAt: new Date().toISOString(),
      account: user && { username: user.username, email: user.email, displayName: user.displayName, bio: user.bio, headline: user.headline, profileLink: user.profileLink, isPrivate: user.isPrivate, messagePreference: user.messagePreference, quietHours: user.quietHours, createdAt: user.createdAt },
      posts: posts.map((post) => ({ id: post._id, text: post.text, visibility: post.visibility, tags: post.tags, hasImage: Boolean(post.image), imageAlt: post.image?.alt || '', likeCount: post.likes?.length || 0, reactionCount: post.reactions?.length || 0, comments: (post.comments || []).map((comment) => ({ id: comment._id, author: comment.author, text: comment.text, createdAt: comment.createdAt })), createdAt: post.createdAt, updatedAt: post.updatedAt })),
      savedPosts: saved.filter((row) => row.post).map((row) => ({ id: row.post._id, author: row.post.author?.username, text: row.post.text, savedAt: row.createdAt })),
      following: follows.filter((row) => row.following).map((row) => ({ username: row.following.username, displayName: row.following.displayName, since: row.createdAt })),
      followers: followers.filter((row) => row.follower).map((row) => ({ username: row.follower.username, displayName: row.follower.displayName, since: row.createdAt })),
      blocked: blocks.filter((row) => row.blocked).map((row) => ({ username: row.blocked.username, since: row.createdAt })),
      conversations: conversations.map((item) => {
        const other = item.participantA?._id?.toString() === req.user.id ? item.participantB : item.participantA;
        return { id: item._id, with: other && { username: other.username, displayName: other.displayName }, status: item.status, muted: (item.mutedBy || []).some((id) => id.toString() === req.user.id), lastMessageAt: item.lastMessageAt,
          messages: messages.filter((message) => message.conversation.toString() === item._id.toString()).map((message) => ({ id: message._id, from: message.sender?.username, text: message.text, sentAt: message.createdAt })) };
      }),
    };
    res.set('Content-Disposition', `attachment; filename="chattr-export-${req.user.username}.json"`);
    res.set('Cache-Control', 'no-store');
    res.json(bundle);
  } catch (error) { next(error); }
});

userRoutes.post('/me/avatar', requireAuth, requireClientOrigin, parseImageUpload(AVATAR_IMAGE_MAX_BYTES), async (req, res, next) => {
  let uploadedAsset;
  try {
    validateImageFile(req.file, AVATAR_IMAGE_MAX_BYTES);
    uploadedAsset = await uploadCloudinaryImage(req.file.buffer, `chattr/avatars/${req.user.id}`);
    const user = await User.findById(req.user.id).select('+avatarCloudinaryUrl +avatarPublicId +avatarFormat +avatarBytes +avatarRevision');
    if (!user) {
      await destroyCloudinaryImageIfUnreferenced(uploadedAsset.public_id).catch(() => {});
      return res.status(404).json({ error: { message: 'Account not found.' } });
    }
    const oldPublicId = user.avatarPublicId;
    user.avatarRevision = (user.avatarRevision || 0) + 1;
    user.avatarUrl = `/api/media/avatars/${user._id}/image?v=${user.avatarRevision}`;
    user.avatarCloudinaryUrl = uploadedAsset.secure_url;
    user.avatarPublicId = uploadedAsset.public_id;
    user.avatarFormat = uploadedAsset.format === 'jpeg' ? 'jpg' : uploadedAsset.format;
    user.avatarBytes = uploadedAsset.bytes;
    await user.save();
    if (oldPublicId && oldPublicId !== uploadedAsset.public_id) await destroyCloudinaryImageIfUnreferenced(oldPublicId).catch(() => {});
    res.json({ user: user.toJSON() });
  } catch (error) {
    if (uploadedAsset?.public_id) await destroyCloudinaryImageIfUnreferenced(uploadedAsset.public_id).catch(() => {});
    if ([502, 503].includes(error.status)) return res.status(error.status).json({ error: { message: error.message } });
    next(error);
  }
});

userRoutes.get('/:username/posts', requireAuth, async (req, res, next) => {
  try {
    const profile = await User.findOne({ username: req.params.username.toLowerCase() }).select('_id isPrivate pinnedPost');
    if (!profile) return res.status(404).json({ error: { message: 'We could not find that profile.' } });
    const isSelf = profile.id === req.user.id;
    if (!isSelf && await Block.exists({ $or: [{ blocker: req.user._id, blocked: profile._id }, { blocker: profile._id, blocked: req.user._id }] })) return res.status(404).json({ error: { message: 'We could not find that profile.' } });
    const isFollowing = isSelf || await hasAcceptedFollow(req.user._id, profile._id, Follow);
    if (profile.isPrivate && !isFollowing) return res.status(403).json({ error: { message: 'This profile is private.' } });
    const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 20, 1), 30);
    const query = { author: profile._id };
    if (!isFollowing) query.visibility = 'public';
    const postProjection = (find) => find.populate('author', 'username displayName avatarUrl headline').populate('comments.author', 'username displayName avatarUrl').lean();
    let posts = await postProjection(Post.find(query).sort({ createdAt: -1, _id: -1 }).limit(limit));
    if (profile.pinnedPost) {
      const pinned = await postProjection(Post.findOne({ ...query, _id: profile.pinnedPost }));
      if (pinned) posts = [{ ...pinned, isPinned: true }, ...posts.filter((post) => post._id.toString() !== pinned._id.toString())];
    }
    const saved = posts.length ? await SavedPost.find({ user: req.user._id, post: { $in: posts.map((post) => post._id) } }).select('post').lean() : [];
    const savedIds = new Set(saved.map((item) => item.post.toString()));
    res.json({ posts: posts.map((post) => postForClient({ ...post, likeCount: post.likes.length, likedByMe: post.likes.some((id) => id.toString() === req.user.id), isSaved: savedIds.has(post._id.toString()), likes: undefined }, req.user._id)) });
  } catch (error) { next(error); }
});

userRoutes.post('/:username/follow', requireAuth, requireClientOrigin, async (req, res, next) => {
  try {
    const target = await User.findOne({ username: req.params.username.toLowerCase() }).select('_id isPrivate');
    if (!target) return res.status(404).json({ error: { message: 'We could not find that profile.' } });
    if (target.id === req.user.id) return res.status(400).json({ error: { message: 'You cannot follow yourself.' } });
    if (await Block.exists({ $or: [{ blocker: req.user._id, blocked: target._id }, { blocker: target._id, blocked: req.user._id }] })) return res.status(403).json({ error: { message: 'This follow is not available.' } });
    const result = await followProfile({ requesterId: req.user._id, target, Follow, FollowRequest });
    if (result.created && result.following) await createNotification({ recipient: target._id, actor: req.user._id, type: 'follow' });
    const [followers, following] = await Promise.all([
      eligibleRelationshipCount(target._id, req.user._id, 'followers'),
      eligibleRelationshipCount(target._id, req.user._id, 'following'),
    ]);
    res.json({ ...result, followerCount: followers, followingCount: following });
  } catch (error) {
    if (error.code === 11000) return res.json({ following: true });
    next(error);
  }
});

userRoutes.delete('/:username/follow', requireAuth, requireClientOrigin, async (req, res, next) => {
  try {
    const target = await User.findOne({ username: req.params.username.toLowerCase() }).select('_id');
    if (!target) return res.status(404).json({ error: { message: 'We could not find that profile.' } });
    if (await Block.exists({ $or: [{ blocker: req.user._id, blocked: target._id }, { blocker: target._id, blocked: req.user._id }] })) return res.status(403).json({ error: { message: 'This follow is not available.' } });
    await Promise.all([
      Follow.deleteOne({ follower: req.user._id, following: target._id }),
      FollowRequest.deleteOne({ follower: req.user._id, following: target._id }),
    ]);
    const [followers, following] = await Promise.all([
      eligibleRelationshipCount(target._id, req.user._id, 'followers'),
      eligibleRelationshipCount(target._id, req.user._id, 'following'),
    ]);
    res.json({ following: false, followerCount: followers, followingCount: following });
  } catch (error) { next(error); }
});

userRoutes.post('/:username/block', requireAuth, requireClientOrigin, async (req, res, next) => {
  try {
    const target = await User.findOne({ username: req.params.username.toLowerCase() }).select('_id');
    if (!target) return res.status(404).json({ error: { message: 'We could not find that account.' } });
    if (target.id === req.user.id) return res.status(400).json({ error: { message: 'You cannot block yourself.' } });
    await Block.updateOne({ blocker: req.user._id, blocked: target._id }, { $setOnInsert: { blocker: req.user._id, blocked: target._id } }, { upsert: true });
    const relationship = { $or: [{ follower: req.user._id, following: target._id }, { follower: target._id, following: req.user._id }] };
    const conversations = await Conversation.find({ $or: [
      { participantA: req.user._id, participantB: target._id },
      { participantA: target._id, participantB: req.user._id },
    ] }).select('_id status').lean();
    const pendingIds = conversations.filter((conversation) => conversation.status === 'pending').map((conversation) => conversation._id);
    await Promise.all([
      Follow.deleteMany(relationship),
      FollowRequest.deleteMany(relationship),
      ...(pendingIds.length ? [Conversation.updateMany({ _id: { $in: pendingIds }, status: 'pending' }, { $set: { status: 'rejected', acceptedVia: '' } })] : []),
    ]);
    for (const conversation of conversations) revokeConversationAccess(conversation._id, [req.user._id, target._id]);
    emitToUser(req.user._id, 'account:blocks:update', { userId: target._id.toString(), blocked: true });
    res.json({ blocked: true });
  } catch (error) { next(error); }
});

userRoutes.delete('/:username/block', requireAuth, requireClientOrigin, async (req, res, next) => {
  try {
    const target = await User.findOne({ username: req.params.username.toLowerCase() }).select('_id');
    if (!target) return res.status(404).json({ error: { message: 'We could not find that account.' } });
    await Block.deleteOne({ blocker: req.user._id, blocked: target._id });
    emitToUser(req.user._id, 'account:blocks:update', { userId: target._id.toString(), blocked: false });
    res.json({ blocked: false });
  } catch (error) { next(error); }
});
