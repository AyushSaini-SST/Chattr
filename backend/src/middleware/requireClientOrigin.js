import { isAllowedOrigin } from '../config/env.js';

export function requireClientOrigin(req, _res, next) {
  const origin = req.get('origin');
  if (!isAllowedOrigin(origin)) return next(Object.assign(new Error('Request origin is not allowed.'), { status: 403 }));
  next();
}
