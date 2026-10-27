import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { User } from '../models/User.js';

export async function requireAuth(req, _res, next) {
  try {
    const token = req.cookies.chattr_session;
    if (!token) return next(Object.assign(new Error('Please sign in to continue.'), { status: 401 }));
    const payload = jwt.verify(token, env.JWT_SECRET);
    const user = await User.findById(payload.sub);
    if (!user) return next(Object.assign(new Error('Your session is no longer valid. Please sign in again.'), { status: 401 }));
    req.user = user;
    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
      return next(Object.assign(new Error('Your session has expired. Please sign in again.'), { status: 401 }));
    }
    next(error);
  }
}
