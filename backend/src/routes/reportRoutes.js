import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import mongoose from 'mongoose';
import { Report } from '../models/Report.js';
import { User } from '../models/User.js';
import { Post } from '../models/Post.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireClientOrigin } from '../middleware/requireClientOrigin.js';
import { canView } from './postRoutes.js';

export const reportRoutes = Router();
reportRoutes.use(requireAuth);
const reportLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 10, standardHeaders: 'draft-8', legacyHeaders: false });
const schema = z.object({ reason: z.enum(['spam', 'harassment', 'inappropriate', 'impersonation', 'other']), details: z.string().trim().max(1000).optional().default('') }).strict();

reportRoutes.post('/user/:username', reportLimiter, requireClientOrigin, async (req, res, next) => {
  try {
    const input = schema.safeParse(req.body);
    if (!input.success) return res.status(400).json({ error: { message: 'Choose a reason for the report.' } });
    const user = await User.findOne({ username: req.params.username.toLowerCase() }).select('_id');
    if (!user) return res.status(404).json({ error: { message: 'Account not found.' } });
    if (user.id === req.user.id) return res.status(400).json({ error: { message: 'You cannot report your own account.' } });
    await Report.create({ reporter: req.user._id, targetUser: user._id, ...input.data });
    res.status(201).json({ submitted: true });
  } catch (error) { next(error); }
});

reportRoutes.post('/post/:postId', reportLimiter, requireClientOrigin, async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.postId)) return res.status(400).json({ error: { message: 'Invalid post ID.' } });
    const input = schema.safeParse(req.body);
    if (!input.success) return res.status(400).json({ error: { message: 'Choose a reason for the report.' } });
    const post = await Post.findById(req.params.postId).populate('author', 'isPrivate');
    if (!post || !(await canView(post, req.user._id))) return res.status(404).json({ error: { message: 'Post not found.' } });
    await Report.create({ reporter: req.user._id, targetPost: post._id, targetUser: post.author._id, ...input.data });
    res.status(201).json({ submitted: true });
  } catch (error) { next(error); }
});
