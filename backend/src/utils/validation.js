import { z } from 'zod';

export const usernameSchema = z.string().trim().toLowerCase().min(3).max(24).regex(/^[a-z0-9_]+$/, 'Use letters, numbers, and underscores for your username.');

export const registerSchema = z.object({
  username: usernameSchema,
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  displayName: z.string().trim().min(1).max(60),
  password: z.string().min(10).max(128),
});

export const loginSchema = z.object({ identifier: z.string().trim().min(1).max(254), password: z.string().min(1).max(128) });
export const postInput = z.object({ text: z.string().trim().max(2000).default(''), visibility: z.enum(['public', 'followers']).default('public'), imageAlt: z.string().trim().max(200).optional() }).strict();
export const commentInput = z.object({ text: z.string().trim().min(1).max(1000) }).strict();
