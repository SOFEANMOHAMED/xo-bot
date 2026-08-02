import rateLimit from 'express-rate-limit';

export const rateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000, // ✅ Increased limit to 1000 requests per 15 minutes (was 100)
  message: {
    error: 'Too many requests from this IP, please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false,
  // ✅ Skip rate limiting for authenticated users (they have subscription limits)
  skip: (req) => {
    // If user is authenticated, skip rate limiting (they have subscription limits)
    return !!req.headers.authorization;
  },
  // ✅ Use a more lenient key generator (by IP + user if authenticated)
  keyGenerator: (req) => {
    // If authenticated, use user ID instead of IP
    if (req.headers.authorization) {
      return req.headers.authorization;
    }
    return req.ip || req.socket.remoteAddress || 'unknown';
  }
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

