import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { allowedOrigins, env } from './config/env.js';
import { errorHandler } from './middleware/errorHandler.js';
import { notFound } from './middleware/notFound.js';
import { authRoutes } from './routes/authRoutes.js';
import { userRoutes } from './routes/userRoutes.js';
import { postRoutes } from './routes/postRoutes.js';
import { savedRoutes } from './routes/savedRoutes.js';
import { messageRoutes } from './routes/messageRoutes.js';
import { notificationRoutes } from './routes/notificationRoutes.js';
import { reportRoutes } from './routes/reportRoutes.js';
import { searchRoutes } from './routes/searchRoutes.js';
import { mediaRoutes } from './routes/mediaRoutes.js';

export const app = express();
app.disable('x-powered-by');
// Render, Vercel and most PaaS hosts terminate TLS at a proxy. Trusting the
// first hop keeps secure cookies and the rate limiter's client IPs correct.
if (env.NODE_ENV === 'production') app.set('trust proxy', 1);
app.use(helmet());
app.use(cors({ origin: allowedOrigins, credentials: true }));
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());
app.use('/api', rateLimit({ windowMs: 15 * 60 * 1000, limit: 300, standardHeaders: 'draft-8', legacyHeaders: false }));

app.get('/api/health', (_req, res) => res.json({ status: 'ok', service: 'chattr-api' }));
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/posts', postRoutes);
app.use('/api/saved', savedRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/search', searchRoutes);
app.use('/api/media', mediaRoutes);

app.use(notFound);
app.use(errorHandler);
