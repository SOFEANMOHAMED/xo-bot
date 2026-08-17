import rateLimit from 'express-rate-limit';

export const rateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000,
  message: {
    error: 'Too many requests from this IP, please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false,
  // Always key by IP — do not skip when an Authorization header is present
  // (a forged header previously bypassed limits on public endpoints).
  keyGenerator: (req) => req.ip || req.socket.remoteAddress || 'unknown'
});

/** Login only — separate store so register/forgot-password do not consume the same budget. */
export const loginRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: {
    error: 'Too many login attempts, please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false,
  // Successful logins do not count; only failed attempts (e.g. wrong password) hit the limit
  skipSuccessfulRequests: true
});

export const registerRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: {
    error: 'Too many registration attempts, please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false
});

/** Forgot / reset password — tight limit to reduce email abuse */
export const passwordResetRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: {
    error: 'Too many password reset attempts, please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false
});

/** Public AI / bot endpoints that burn provider quota */
export const publicAiRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: {
    error: 'Too many AI requests from this IP, please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.ip || req.socket.remoteAddress || 'unknown'
});
