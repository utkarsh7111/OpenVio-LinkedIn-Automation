import { rateLimit } from 'express-rate-limit';

const body = (code: string, message: string) => ({ success: false, data: null, error: { code, message } });

/** General limiter for the whole /api surface. */
export const apiLimiter = rateLimit({
  windowMs: 60_000,
  limit: 120,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: body('RATE_LIMITED', 'Too many requests. Try again shortly.'),
});

/** Strict limiter for OAuth connect, publish and AI endpoints (use in later phases). */
export const strictLimiter = rateLimit({
  windowMs: 60_000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: body('RATE_LIMITED', 'Too many attempts. Wait a minute and try again.'),
});

/** Dedicated limiter for media uploads: allows up to 60 uploads per minute so users can attach up to 20 images without hitting 429. */
export const mediaUploadLimiter = rateLimit({
  windowMs: 60_000,
  limit: 60,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: body('RATE_LIMITED', 'Too many media uploads. Wait a minute and try again.'),
});
