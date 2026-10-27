import { Router } from 'express';
import mongoose from 'mongoose';
import { Block } from '../models/Block.js';
import { Follow } from '../models/Follow.js';
import { Post } from '../models/Post.js';
import { User } from '../models/User.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireClientOrigin } from '../middleware/requireClientOrigin.js';
import { authenticatedImageUrl, isCloudinaryConfigured } from '../services/cloudinary.js';
import { canView } from './postRoutes.js';

export const mediaRoutes = Router();

export async function canViewAvatar(viewerId, user, { BlockModel = Block, FollowModel = Follow } = {}) {
  if (user._id.toString() === viewerId.toString()) return true;
  if (await BlockModel.exists({ $or: [{ blocker: viewerId, blocked: user._id }, { blocker: user._id, blocked: viewerId }] })) return false;
  if (!user.isPrivate) return true;
  return Boolean(await FollowModel.exists({ follower: viewerId, following: user._id }));
}

function sendUnavailable(res) {
  return res.status(404).json({ error: { message: 'Image not found.' } });
}

async function streamPrivateImage(res, publicId, format, next) {
  if (!isCloudinaryConfigured()) return next(Object.assign(new Error('Image delivery is not configured on this server.'), { status: 503 }));
  try {
    const upstream = await fetch(authenticatedImageUrl(publicId, format));
    if (!upstream.ok) return next(Object.assign(new Error('Image delivery is temporarily unavailable.'), { status: 502 }));
    const image = Buffer.from(await upstream.arrayBuffer());
    const contentTypes = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' };
    res.set({
      'Content-Type': contentTypes[format] || 'application/octet-stream',
      'Content-Length': image.length,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': 'inline',
      'Cross-Origin-Resource-Policy': 'cross-origin',
    });
    return res.status(200).end(image);
  } catch {
    return next(Object.assign(new Error('Image delivery is temporarily unavailable.'), { status: 502 }));
  }
}

mediaRoutes.get('/avatars/:userId/image', requireAuth, requireClientOrigin, async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.userId)) return sendUnavailable(res);
    const user = await User.findById(req.params.userId).select('+avatarPublicId +avatarFormat');
    if (!user?.avatarPublicId) return sendUnavailable(res);
    if (!await canViewAvatar(req.user._id, user)) return sendUnavailable(res);
    return await streamPrivateImage(res, user.avatarPublicId, user.avatarFormat, next);
  } catch (error) { next(error); }
});

mediaRoutes.get('/posts/:postId/image', requireAuth, requireClientOrigin, async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.postId)) return sendUnavailable(res);
    const post = await Post.findById(req.params.postId).select('+image.publicId +image.format').populate('author', 'isPrivate');
    if (!post?.image?.publicId || !await canView(post, req.user._id)) return sendUnavailable(res);
    return await streamPrivateImage(res, post.image.publicId, post.image.format, next);
  } catch (error) { next(error); }
});
