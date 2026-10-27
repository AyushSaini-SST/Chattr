import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { rateLimit } from 'express-rate-limit';
import { env } from '../config/env.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireClientOrigin } from '../middleware/requireClientOrigin.js';
import { User } from '../models/User.js';
import { loginSchema, registerSchema } from '../utils/validation.js';

export const authRoutes = Router();
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: 'draft-8', legacyHeaders: false });
function parseBody(schema, body) {
  const result = schema.safeParse(body);
  if (!result.success) {
    const message = result.error.issues.map((issue) => issue.message).join(' ');
    throw Object.assign(new Error(message), { status: 400 });
  }
  return result.data;
}

function setSessionCookie(res, userId) {
  const token = jwt.sign({}, env.JWT_SECRET, { subject: userId.toString(), expiresIn: '7d' });
  res.cookie('chattr_session', token, {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: env.NODE_ENV === 'production' ? 'none' : 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: '/',
  });
}

function clearSessionCookie(res) {
  res.clearCookie('chattr_session', {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: env.NODE_ENV === 'production' ? 'none' : 'lax',
    path: '/',
  });
}

authRoutes.post('/register', authLimiter, requireClientOrigin, async (req, res, next) => {
  try {
    const input = parseBody(registerSchema, req.body);
    const existing = await User.findOne({ $or: [{ username: input.username }, { email: input.email }] }).select('username email');
    if (existing) {
      const field = existing.username === input.username ? 'username' : 'email';
      return res.status(409).json({ error: { message: `That ${field} is already in use.` } });
    }
    const passwordHash = await bcrypt.hash(input.password, 12);
    const user = await User.create({ ...input, passwordHash });
    setSessionCookie(res, user._id);
    res.status(201).json({ user: user.toJSON() });
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ error: { message: 'That username or email is already in use.' } });
    next(error);
  }
});

authRoutes.post('/login', authLimiter, requireClientOrigin, async (req, res, next) => {
  try {
    const input = parseBody(loginSchema, req.body);
    const identifier = input.identifier.toLowerCase();
    const user = await User.findOne({ $or: [{ email: identifier }, { username: identifier }] }).select('+passwordHash');
    const valid = user && await bcrypt.compare(input.password, user.passwordHash);
    if (!valid) return res.status(401).json({ error: { message: 'The username/email or password is incorrect.' } });
    setSessionCookie(res, user._id);
    res.json({ user: user.toJSON() });
  } catch (error) { next(error); }
});

authRoutes.post('/logout', requireClientOrigin, (_req, res) => {
  clearSessionCookie(res);
  res.status(204).end();
});

authRoutes.get('/me', requireAuth, (req, res) => res.json({ user: req.user.toJSON() }));
