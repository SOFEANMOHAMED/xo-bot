import { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import jwt, { SignOptions } from 'jsonwebtoken';
import crypto from 'crypto';
import passport from 'passport';
import pool from '../database/connection.js';
import { createError } from '../middleware/errorHandler.js';
import { AuthRequest } from '../middleware/auth.js';
import { z } from 'zod';
import { sendPasswordResetEmail } from '../utils/emailService.js';
import { sendAndTrackWelcomeEmail } from '../services/lifecycleEmails/index.js';
import { logger } from '../utils/logger.js';
import {
  linkMerchantToAffiliateReferrer,
  referralCodeFromOAuthState
} from '../utils/affiliateReferral.js';
import {
  applyMerchantAcquisition,
  acquisitionFromOAuthState,
  normalizeAcquisitionInput,
  type MerchantAcquisitionInput
} from '../services/merchantAcquisition.js';
import { setAuthCookie, clearAuthCookie } from '../utils/authCookies.js';
import {
  ensureSubscriptionEndsAtColumn,
  enforceMerchantSubscriptionExpiry
} from '../services/subscriptionExpiry/index.js';
import '../config/passport.js'; // Initialize passport

/** تطبيع البريد: المقارنة في قاعدة البيانات حساسة لحالة الأحرف بدون هذا. */
const normalizeMerchantEmail = (email: string): string => email.trim().toLowerCase();

function toIsoOrNull(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Public merchant user payload for auth responses (tenant-safe fields only). */
async function buildPublicMerchantUser(merchant: {
  id: string;
  email: string;
  name: string | null;
  subscription_plan?: string | null;
  subscription_status?: string | null;
  trial_ends_at?: Date | string | null;
  subscription_ends_at?: Date | string | null;
  created_at?: Date | string | null;
  role?: string | null;
}) {
  await ensureSubscriptionEndsAtColumn();
  const enforced = await enforceMerchantSubscriptionExpiry(merchant.id, {
    subscription_plan: merchant.subscription_plan ?? null,
    subscription_status: merchant.subscription_status ?? null,
    subscription_ends_at: merchant.subscription_ends_at ?? null
  });

  return {
    id: merchant.id,
    email: merchant.email,
    name: merchant.name,
    subscriptionPlan: merchant.subscription_plan || 'trial',
    subscriptionStatus: enforced.subscriptionStatus,
    trialEndsAt: toIsoOrNull(merchant.trial_ends_at),
    subscriptionEndsAt: toIsoOrNull(enforced.subscriptionEndsAt ?? merchant.subscription_ends_at),
    createdAt: toIsoOrNull(merchant.created_at) ?? undefined,
    role: (merchant.role || 'user') as 'owner' | 'admin' | 'user'
  };
}

const acquisitionBodySchema = z
  .object({
    utm_source: z.string().optional(),
    utm_medium: z.string().optional(),
    utm_campaign: z.string().optional(),
    utm_content: z.string().optional(),
    utm_term: z.string().optional(),
    source: z.string().optional(),
    medium: z.string().optional(),
    campaign: z.string().optional(),
    content: z.string().optional(),
    term: z.string().optional(),
    ad_id: z.string().optional(),
    adId: z.string().optional(),
    acq: z.string().optional(),
    acqCode: z.string().optional(),
    landing_path: z.string().optional(),
    landingPath: z.string().optional(),
    fbclid: z.string().optional(),
    gclid: z.string().optional(),
    ref: z.string().optional()
  })
  .passthrough()
  .optional();

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  name: z.string().optional(),
  referralCode: z.string().optional(),
  phone: z.string().optional(),
  acquisition: acquisitionBodySchema
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string()
});

export const register = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const validated = registerSchema.parse(req.body);
    const email = normalizeMerchantEmail(validated.email);
    const { password, name, referralCode: inputReferralCode, phone } = validated;
    const acquisitionInput: MerchantAcquisitionInput | null = normalizeAcquisitionInput({
      ...(validated.acquisition || {}),
      ref: validated.acquisition?.ref || inputReferralCode || undefined,
      acq: validated.acquisition?.acq || validated.acquisition?.acqCode || undefined
    } as Record<string, unknown>);

    // Check if user exists
    const existingUser = await pool.query(
      'SELECT id FROM merchants WHERE LOWER(TRIM(email)) = $1',
      [email]
    );

    if (existingUser.rows.length > 0) {
      return next(createError('Email already registered', 400));
    }

    // Hash password
    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(password, saltRounds);

    // Ensure referral_code column exists
    try {
      await pool.query(`
        DO $$ 
        BEGIN
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                        WHERE table_name='merchants' AND column_name='referral_code') THEN
            ALTER TABLE merchants ADD COLUMN referral_code VARCHAR(100) UNIQUE;
          END IF;
        END $$;
      `);
    } catch (err: any) {
      console.warn('Error ensuring referral_code column exists:', err.message);
    }

    // Generate unique referral code for the new user
    let newUserReferralCode: string = '';
    let isUnique = false;
    let attempts = 0;
    while (!isUnique && attempts < 20) {
      // Generate code: first 3 letters of email + random 5 digits
      const emailPrefix = email.substring(0, 3).toUpperCase().replace(/[^A-Z]/g, '') || 'REF';
      const randomNum = Math.floor(10000 + Math.random() * 90000); // 5 digits
      newUserReferralCode = `${emailPrefix}${randomNum}`;

      // Check if code is unique
      const checkResult = await pool.query(
        'SELECT id FROM merchants WHERE referral_code = $1',
        [newUserReferralCode]
      );

      if (checkResult.rows.length === 0) {
        isUnique = true;
      } else {
        attempts++;
        // If still not unique after many attempts, use UUID-based code
        if (attempts >= 15) {
          newUserReferralCode = `REF${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
          const finalCheck = await pool.query(
            'SELECT id FROM merchants WHERE referral_code = $1',
            [newUserReferralCode]
          );
          if (finalCheck.rows.length === 0) {
            isUnique = true;
          }
        }
      }
    }

    // Ensure phone column exists
    try {
      await pool.query(`
        DO $$ 
        BEGIN
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                        WHERE table_name='merchants' AND column_name='phone') THEN
            ALTER TABLE merchants ADD COLUMN phone VARCHAR(20);
          END IF;
        END $$;
      `);
    } catch (err: any) {
      console.warn('Error ensuring phone column exists:', err.message);
    }

    // Create user with referral code (default role is 'user')
    const result = await pool.query(
      `INSERT INTO merchants (email, password_hash, name, role, subscription_plan, trial_ends_at, referral_code, phone)
       VALUES ($1, $2, $3, 'user', 'trial', NOW() + INTERVAL '7 days', $4, $5)
       RETURNING id, email, name, role, subscription_plan, subscription_status, trial_ends_at, created_at, referral_code`,
      [email, passwordHash, name || null, newUserReferralCode, phone || null]
    );

    const merchant = result.rows[0];

    // Create default settings
    await pool.query(
      `INSERT INTO merchant_settings (merchant_id, store_name, welcome_message, store_currency)
       VALUES ($1, $2, $3, $4)`,
      [
        merchant.id,
        name || 'متجر جديد',
        'أهلاً بك في متجرنا! كيف يمكنني مساعدتك اليوم؟',
        'USD'
      ]
    );

    const trimmedRef = inputReferralCode?.trim();
    if (trimmedRef) {
      try {
        await linkMerchantToAffiliateReferrer(pool, merchant.id, trimmedRef);
      } catch (refError: unknown) {
        console.warn(
          'Error processing referral code:',
          refError instanceof Error ? refError.message : refError
        );
      }
    }

    try {
      await applyMerchantAcquisition(merchant.id, acquisitionInput);
    } catch (acqErr: unknown) {
      logger.warn('Failed to apply merchant acquisition on register', {
        merchantId: merchant.id,
        error: acqErr instanceof Error ? acqErr.message : String(acqErr)
      });
    }

    // Get role from database (default to 'user' if not set)
    const role = merchant.role || 'user';

    // Welcome email (tracked — also used for Google OAuth)
    void sendAndTrackWelcomeEmail(merchant.id, merchant.email, merchant.name);

    // Generate JWT
    const token = generateToken(merchant.id, merchant.id, role);
    setAuthCookie(res, token);

    const user = await buildPublicMerchantUser(merchant);

    res.status(201).json({
      success: true,
      data: {
        user,
        // Token also returned for transitional clients; prefer HttpOnly cookie.
        token
      }
    });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return next(createError(error.errors[0].message, 400));
    }
    next(error);
  }
};

export const login = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const validated = loginSchema.parse(req.body);
    const email = normalizeMerchantEmail(validated.email);
    const { password } = validated;

    await ensureSubscriptionEndsAtColumn();

    // Password comes from DB only; sync SUPER_ADMIN_* from .env via: npm run create-super-admin
    const result = await pool.query(
      `SELECT id, email, password_hash, name, subscription_plan, subscription_status,
              trial_ends_at, subscription_ends_at, role, created_at
       FROM merchants WHERE LOWER(TRIM(email)) = $1`,
      [email]
    );

    if (result.rows.length === 0) {
      return next(createError('Invalid email or password', 401));
    }

    const merchant = result.rows[0];

    if (!merchant.password_hash) {
      return next(createError('Invalid email or password', 401));
    }

    // Verify password
    const isValidPassword = await bcrypt.compare(password, merchant.password_hash);

    if (!isValidPassword) {
      return next(createError('Invalid email or password', 401));
    }

    // Get role from database (default to 'user' if not set)
    const role = merchant.role || 'user';

    // Generate JWT
    const token = generateToken(merchant.id, merchant.id, role);
    setAuthCookie(res, token);

    const user = await buildPublicMerchantUser(merchant);

    res.json({
      success: true,
      data: {
        user,
        token
      }
    });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return next(createError(error.errors[0].message, 400));
    }
    next(error);
  }
};

export const getProfile = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    await ensureSubscriptionEndsAtColumn();
    const result = await pool.query(
      `SELECT id, email, name, subscription_plan, subscription_status,
              trial_ends_at, subscription_ends_at, role, created_at
       FROM merchants WHERE id = $1`,
      [req.merchantId]
    );

    if (result.rows.length === 0) {
      return next(createError('User not found', 404));
    }

    const merchant = result.rows[0];
    const user = await buildPublicMerchantUser(merchant);
    res.json({
      success: true,
      data: { user }
    });
  } catch (error) {
    next(error);
  }
};

export const updateProfile = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const merchantId = req.merchantId;
    if (!merchantId) {
      return next(createError('Unauthorized', 401));
    }

    const { name, email, phone } = req.body;

    // Build dynamic update query
    const updates: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (name !== undefined) {
      updates.push(`name = $${paramIndex}`);
      values.push(name);
      paramIndex++;
    }

    if (email !== undefined) {
      const newEmail = normalizeMerchantEmail(String(email));
      const existingUser = await pool.query(
        'SELECT id FROM merchants WHERE LOWER(TRIM(email)) = $1 AND id != $2',
        [newEmail, merchantId]
      );
      if (existingUser.rows.length > 0) {
        return next(createError('البريد الإلكتروني مستخدم من قبل حساب آخر', 400));
      }
      updates.push(`email = $${paramIndex}`);
      values.push(newEmail);
      paramIndex++;
    }

    if (phone !== undefined) {
      updates.push(`phone = $${paramIndex}`);
      values.push(phone);
      paramIndex++;
    }

    if (updates.length === 0) {
      return next(createError('لا توجد بيانات للتحديث', 400));
    }

    updates.push('updated_at = CURRENT_TIMESTAMP');
    values.push(merchantId);

    const result = await pool.query(
      `UPDATE merchants SET ${updates.join(', ')} WHERE id = $${paramIndex} RETURNING id, email, name, phone`,
      values
    );

    logger.info('Profile updated successfully', { merchantId });

    res.json({
      success: true,
      data: {
        user: result.rows[0]
      }
    });
  } catch (error) {
    logger.error('Error updating profile', error as Error);
    next(error);
  }
};

export const forgotPassword = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { email } = req.body;

    if (!email || typeof email !== 'string') {
      return next(createError('Email is required', 400));
    }

    const normalized = normalizeMerchantEmail(email);

    // Check if user exists
    const result = await pool.query(
      'SELECT id, email FROM merchants WHERE LOWER(TRIM(email)) = $1',
      [normalized]
    );

    // Always return success to prevent email enumeration
    if (result.rows.length > 0) {
      const merchant = result.rows[0];
      
      // Generate secure reset token
      const resetToken = crypto.randomBytes(32).toString('hex');
      
      // Set expiration to 1 hour from now
      const expiresAt = new Date();
      expiresAt.setHours(expiresAt.getHours() + 1);
      
      // Store reset token in database
      await pool.query(
        `INSERT INTO password_reset_tokens (merchant_id, token, expires_at)
         VALUES ($1, $2, $3)`,
        [merchant.id, resetToken, expiresAt]
      );
      
      // Send email with reset link
      await sendPasswordResetEmail(merchant.email, resetToken);
    }

    res.json({
      success: true,
      message: 'If an account exists with this email, a password reset link has been sent.'
    });
  } catch (error) {
    next(error);
  }
};

export const resetPassword = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { token, password } = req.body;

    if (!token || !password) {
      return next(createError('Token and password are required', 400));
    }

    if (password.length < 6) {
      return next(createError('Password must be at least 6 characters', 400));
    }

    // Verify token from database
    const tokenResult = await pool.query(
      `SELECT merchant_id, expires_at, used_at 
       FROM password_reset_tokens 
       WHERE token = $1`,
      [token]
    );

    if (tokenResult.rows.length === 0) {
      return next(createError('Invalid or expired reset token', 400));
    }

    const tokenData = tokenResult.rows[0];

    // Check if token is expired
    if (new Date(tokenData.expires_at) < new Date()) {
      return next(createError('Reset token has expired', 400));
    }

    // Check if token has already been used
    if (tokenData.used_at) {
      return next(createError('Reset token has already been used', 400));
    }

    // Hash new password
    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(password, saltRounds);

    // Update password in database
    await pool.query(
      'UPDATE merchants SET password_hash = $1 WHERE id = $2',
      [passwordHash, tokenData.merchant_id]
    );

    // Mark token as used
    await pool.query(
      'UPDATE password_reset_tokens SET used_at = NOW() WHERE token = $1',
      [token]
    );

    res.json({
      success: true,
      message: 'Password has been reset successfully'
    });
  } catch (error) {
    next(error);
  }
};

function generateToken(userId: string, merchantId: string, role: string): string {
  const jwtSecret = process.env.JWT_SECRET;
  const expiresIn = process.env.JWT_EXPIRES_IN || '7d';

  if (!jwtSecret) {
    throw createError('JWT secret not configured', 500);
  }

  // Type assertion for expiresIn to satisfy jsonwebtoken types
  const options: SignOptions = {
    expiresIn: expiresIn as any
  };
  
  return jwt.sign(
    { userId, merchantId, role },
    jwtSecret as string,
    options
  );
}

// Google OAuth - Initiate login (optional ?ref= + acquisition via OAuth state)
export const googleAuth = (req: Request, res: Response, next: NextFunction) => {
  const refRaw = req.query.ref;
  const acqRaw = req.query.acq;
  let state: string | undefined;
  const statePayload: Record<string, unknown> = {};

  if (typeof refRaw === 'string' && refRaw.trim()) {
    const clean = refRaw.trim().toUpperCase().replace(/[^A-Z0-9\-_]/g, '');
    if (clean) statePayload.ref = clean;
  }
  if (typeof acqRaw === 'string' && acqRaw.trim()) {
    const cleanAcq = acqRaw.trim().toUpperCase().replace(/[^A-Z0-9\-_]/g, '');
    if (cleanAcq) statePayload.acq = cleanAcq;
  }

  const acquisition = normalizeAcquisitionInput({
    utm_source: req.query.utm_source,
    utm_medium: req.query.utm_medium,
    utm_campaign: req.query.utm_campaign,
    utm_content: req.query.utm_content,
    utm_term: req.query.utm_term,
    ad_id: req.query.ad_id,
    fbclid: req.query.fbclid,
    gclid: req.query.gclid,
    landing_path: req.query.landing_path,
    acq: statePayload.acq,
    ref: statePayload.ref
  } as Record<string, unknown>);

  if (acquisition) {
    statePayload.acquisition = acquisition;
  }

  if (Object.keys(statePayload).length > 0) {
    state = Buffer.from(JSON.stringify(statePayload), 'utf8').toString('base64url');
  }

  passport.authenticate('google', {
    scope: ['profile', 'email'],
    ...(state ? { state } : {})
  })(req, res, next);
};

// Google OAuth - Callback
export const googleCallback = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  console.log('[Google OAuth] Callback received:', {
    query: req.query,
    hasCode: !!req.query.code,
    url: req.url
  });
  
  logger.info('Google OAuth: Callback received', {
    query: req.query,
    hasCode: !!req.query.code
  });

  passport.authenticate('google', async (err: any, user: any, info: any) => {
    console.log('[Google OAuth] Passport authenticate callback:', {
      hasError: !!err,
      error: err?.message || err,
      hasUser: !!user,
      userId: user?.id,
      userEmail: user?.email,
      info: info
    });
    if (err) {
      console.error('[Google OAuth] Authentication error:', err);
      logger.error('Google OAuth: Authentication error', err instanceof Error ? err : new Error(String(err)), {
        query: req.query
      });
      const frontendUrl = process.env.FRONTEND_URL || process.env.CORS_ORIGIN || 'https://xo-bot.com';
      return res.redirect(`${frontendUrl}/login?error=google_auth_failed`);
    }

    if (!user) {
      console.error('[Google OAuth] No user returned. Info:', info);
      logger.error('Google OAuth: No user returned', new Error('No user returned from Passport'), {
        info: info || 'No info provided',
        query: req.query
      });
      const frontendUrl = process.env.FRONTEND_URL || process.env.CORS_ORIGIN || 'https://xo-bot.com';
      return res.redirect(`${frontendUrl}/login?error=google_auth_failed`);
    }

    try {
      console.log('[Google OAuth] User authenticated successfully:', {
        userId: user.id,
        email: user.email,
        role: user.role
      });
      
      logger.info('Google OAuth: User authenticated successfully', {
        userId: user.id,
        email: user.email,
        role: user.role
      });

      // Check if user needs to complete profile (missing password or phone)
      // Check for null, undefined, or empty string
      const hasPassword = user.password_hash && typeof user.password_hash === 'string' && user.password_hash.trim() !== '';
      const hasPhone = user.phone && typeof user.phone === 'string' && user.phone.trim() !== '';
      const needsProfileCompletion = !hasPassword || !hasPhone;
      
      console.log('[Google OAuth] Checking profile completion:', {
        userId: user.id,
        email: user.email,
        hasPassword: hasPassword,
        hasPhone: hasPhone,
        password_hash: user.password_hash ? 'exists' : 'null/undefined',
        phone: user.phone ? user.phone : 'null/undefined',
        needsProfileCompletion: needsProfileCompletion
      });
      
      if (needsProfileCompletion) {
        console.log('[Google OAuth] User needs to complete profile - redirecting:', {
          userId: user.id,
          hasPassword: hasPassword,
          hasPhone: hasPhone
        });
        
        logger.info('Google OAuth: User needs to complete profile', {
          userId: user.id,
          hasPassword: hasPassword,
          hasPhone: hasPhone
        });

        // Generate temporary token for profile completion
        const role = user.role || 'user';
        const token = generateToken(user.id, user.id, role);
        setAuthCookie(res, token);
        
        const frontendUrl = process.env.FRONTEND_URL || process.env.CORS_ORIGIN || 'https://xo-bot.com';
        const refFromState = referralCodeFromOAuthState(req.query.state);
        const acqFromState = acquisitionFromOAuthState(req.query.state);
        try {
          await applyMerchantAcquisition(user.id, acqFromState);
        } catch (acqErr) {
          logger.warn('OAuth acquisition apply failed (complete-profile path)', {
            userId: user.id,
            error: acqErr instanceof Error ? acqErr.message : String(acqErr)
          });
        }
        const refQuery = refFromState ? `&ref=${encodeURIComponent(refFromState)}` : '';
        const acqQuery =
          acqFromState?.acqCode ? `&acq=${encodeURIComponent(acqFromState.acqCode)}` : '';
        const redirectUrl = `${frontendUrl}/complete-profile?token=${token}${refQuery}${acqQuery}`;
        console.log('[Google OAuth] Redirecting to:', redirectUrl);
        res.redirect(redirectUrl);
        return;
      }

      // Generate JWT token
      const role = user.role || 'user';
      const token = generateToken(user.id, user.id, role);
      setAuthCookie(res, token);

      console.log('[Google OAuth] Token generated, redirecting to frontend:', {
        userId: user.id,
        tokenLength: token.length,
        frontendUrl: process.env.FRONTEND_URL || process.env.CORS_ORIGIN || 'https://xo-bot.com'
      });

      logger.info('Google OAuth: Token generated, redirecting to frontend', {
        userId: user.id,
        tokenLength: token.length
      });

      // Cookie carries auth — do not put JWT in the URL
      const frontendUrl = process.env.FRONTEND_URL || process.env.CORS_ORIGIN || 'https://xo-bot.com';
      const refFromState = referralCodeFromOAuthState(req.query.state);
      try {
        if (refFromState) {
          await linkMerchantToAffiliateReferrer(pool, user.id, refFromState);
        }
        await applyMerchantAcquisition(user.id, acquisitionFromOAuthState(req.query.state));
      } catch (postAuthErr) {
        logger.warn('OAuth post-auth affiliate/acquisition failed', {
          userId: user.id,
          error: postAuthErr instanceof Error ? postAuthErr.message : String(postAuthErr)
        });
      }
      res.redirect(
        refFromState
          ? `${frontendUrl}/?ref=${encodeURIComponent(refFromState)}`
          : frontendUrl
      );
    } catch (error: any) {
      console.error('[Google OAuth] Failed to generate token or redirect:', error);
      logger.error('Google OAuth: Failed to generate token or redirect', error instanceof Error ? error : new Error(String(error)), {
        userId: user?.id
      });
      const frontendUrl = process.env.FRONTEND_URL || process.env.CORS_ORIGIN || 'https://xo-bot.com';
      res.redirect(`${frontendUrl}/login?error=token_generation_failed`);
    }
  })(req, res, next);
};

// Delete Account
export const deleteAccount = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  const merchantId = req.merchantId || req.userId;
  if (!merchantId) {
    return next(createError('Unauthorized', 401));
  }

  try {
    logger.info('Deleting account', { merchantId });

    // Start transaction to delete all related data
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Delete related data in order (respecting foreign key constraints)
      // 1. Delete conversations and messages
      await client.query('DELETE FROM messages WHERE conversation_id IN (SELECT id FROM conversations WHERE merchant_id = $1)', [merchantId]);
      await client.query('DELETE FROM conversations WHERE merchant_id = $1', [merchantId]);

      // 2. Delete orders
      await client.query('DELETE FROM orders WHERE merchant_id = $1', [merchantId]);

      // 3. Delete products
      await client.query('DELETE FROM products WHERE merchant_id = $1', [merchantId]);

      // 4. Delete services
      await client.query('DELETE FROM services WHERE merchant_id = $1', [merchantId]);

      // 5. Delete customers
      await client.query('DELETE FROM customers WHERE merchant_id = $1', [merchantId]);

      // 6. Delete integrations (with error handling for tables that might not exist)
      const deleteIntegrationQueries = [
        'DELETE FROM facebook_pages WHERE merchant_id = $1',
        'DELETE FROM telegram_bots WHERE merchant_id = $1',
        'DELETE FROM whatsapp_accounts WHERE merchant_id = $1',
        'DELETE FROM shopify_stores WHERE merchant_id = $1'
      ];

      for (const query of deleteIntegrationQueries) {
        try {
          await client.query(query, [merchantId]);
        } catch (error: any) {
          // If table doesn't exist, log warning but continue
          if (error.code === '42P01') { // PostgreSQL error code for "relation does not exist"
            logger.warn('Table does not exist, skipping deletion', { query, merchantId });
          } else {
            throw error; // Re-throw other errors
          }
        }
      }

      // 7. Delete settings
      await client.query('DELETE FROM merchant_settings WHERE merchant_id = $1', [merchantId]);

      // 8. Delete password reset tokens
      await client.query('DELETE FROM password_reset_tokens WHERE merchant_id = $1', [merchantId]);

      // 9. Delete affiliate data if exists (with error handling)
      try {
        await client.query('DELETE FROM affiliate_referrals WHERE referred_user_id = $1 OR referrer_id = $1', [merchantId]);
        // Also delete affiliate_clicks if table exists
        await client.query('DELETE FROM affiliate_clicks WHERE referrer_id = $1', [merchantId]);
      } catch (error: any) {
        // If table doesn't exist, log warning but continue
        if (error.code === '42P01') { // PostgreSQL error code for "relation does not exist"
          logger.warn('Affiliate tables do not exist, skipping deletion', { merchantId });
        } else {
          throw error; // Re-throw other errors
        }
      }

      // 10. Finally, delete the merchant account
      await client.query('DELETE FROM merchants WHERE id = $1', [merchantId]);

      await client.query('COMMIT');

      logger.info('Account deleted successfully', { merchantId });

      res.json({
        success: true,
        message: 'Account deleted successfully'
      });
    } catch (error: any) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error: any) {
    logger.error('Error deleting account', error instanceof Error ? error : new Error(String(error)), { merchantId });
    next(error);
  }
};

// Change password for authenticated user
export const changePassword = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const merchantId = req.merchantId;
    if (!merchantId) {
      return next(createError('Unauthorized', 401));
    }

    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return next(createError('كلمة المرور الحالية والجديدة مطلوبتان', 400));
    }

    if (newPassword.length < 6) {
      return next(createError('كلمة المرور الجديدة يجب أن تكون 6 أحرف على الأقل', 400));
    }

    // Get current password hash
    const result = await pool.query(
      'SELECT password_hash FROM merchants WHERE id = $1',
      [merchantId]
    );

    if (result.rows.length === 0) {
      return next(createError('المستخدم غير موجود', 404));
    }

    const { password_hash } = result.rows[0];

    // Check if user has a password (Google OAuth users might not have one)
    if (!password_hash) {
      return next(createError('لا يمكن تغيير كلمة المرور لحساب Google. يرجى استخدام "نسيت كلمة المرور" لإنشاء كلمة مرور جديدة.', 400));
    }

    // Verify current password
    const isValidPassword = await bcrypt.compare(currentPassword, password_hash);
    if (!isValidPassword) {
      return next(createError('كلمة المرور الحالية غير صحيحة', 400));
    }

    // Hash new password
    const saltRounds = 10;
    const newPasswordHash = await bcrypt.hash(newPassword, saltRounds);

    // Update password
    await pool.query(
      'UPDATE merchants SET password_hash = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      [newPasswordHash, merchantId]
    );

    logger.info('Password changed successfully', { merchantId });

    res.json({
      success: true,
      message: 'تم تغيير كلمة المرور بنجاح'
    });
  } catch (error) {
    logger.error('Error changing password', error as Error);
    next(error);
  }
};

// Complete profile for Google OAuth users
export const completeProfile = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const merchantId = req.merchantId;
    if (!merchantId) {
      return next(createError('Unauthorized', 401));
    }

    const { password, phone, referralCode: inputReferralCode, acquisition } = req.body;

    // Validate required fields
    if (!password || !phone) {
      return next(createError('كلمة المرور ورقم الهاتف مطلوبان', 400));
    }

    if (password.length < 6) {
      return next(createError('كلمة المرور يجب أن تكون 6 أحرف على الأقل', 400));
    }

    // Get current user
    const userResult = await pool.query(
      'SELECT id, email, auth_provider, password_hash, phone FROM merchants WHERE id = $1',
      [merchantId]
    );

    if (userResult.rows.length === 0) {
      return next(createError('المستخدم غير موجود', 404));
    }

    const user = userResult.rows[0];

    // Only allow profile completion for Google OAuth users
    if (user.auth_provider !== 'google') {
      return next(createError('هذه العملية متاحة فقط لمستخدمي Google', 400));
    }

    // Hash password
    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(password, saltRounds);

    // Update user with password and phone
    await pool.query(
      'UPDATE merchants SET password_hash = $1, phone = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3',
      [passwordHash, phone, merchantId]
    );

    const trimmedRef = inputReferralCode?.trim();
    if (trimmedRef) {
      try {
        await linkMerchantToAffiliateReferrer(pool, merchantId, trimmedRef);
      } catch (refError: unknown) {
        console.warn(
          'Error processing referral code:',
          refError instanceof Error ? refError.message : refError
        );
        logger.warn(
          'Error processing referral code during profile completion',
          refError instanceof Error ? refError : new Error(String(refError))
        );
      }
    }

    try {
      const acqInput = normalizeAcquisitionInput({
        ...(typeof acquisition === 'object' && acquisition ? acquisition : {}),
        ref:
          (typeof acquisition === 'object' && acquisition?.ref) ||
          inputReferralCode ||
          undefined,
        acq:
          (typeof acquisition === 'object' && (acquisition?.acq || acquisition?.acqCode)) ||
          undefined
      } as Record<string, unknown>);
      await applyMerchantAcquisition(merchantId, acqInput);
    } catch (acqErr: unknown) {
      logger.warn('Failed to apply merchant acquisition on complete profile', {
        merchantId,
        error: acqErr instanceof Error ? acqErr.message : String(acqErr)
      });
    }

    logger.info('Profile completed successfully', { merchantId });

    res.json({
      success: true,
      message: 'تم إكمال الملف الشخصي بنجاح',
      data: {
        user: {
          id: user.id,
          email: user.email
        }
      }
    });
  } catch (error) {
    logger.error('Error completing profile', error as Error);
    next(error);
  }
};

/** Clear HttpOnly auth cookie (and respond OK even if already logged out). */
export const logout = async (_req: Request, res: Response) => {
  clearAuthCookie(res);
  res.json({ success: true, message: 'Logged out' });
};

/**
 * Exchange a one-time Bearer/body token for an HttpOnly cookie
 * (used after OAuth complete-profile URL bootstrap).
 */
export const establishSession = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const bodyToken = typeof (req.body as any)?.token === 'string' ? (req.body as any).token.trim() : '';
    const header = req.headers.authorization;
    const bearer = header?.startsWith('Bearer ') ? header.substring(7).trim() : '';
    const token = bodyToken || bearer;
    if (!token) {
      return next(createError('Token required', 400));
    }
    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
      return next(createError('JWT secret not configured', 500));
    }
    jwt.verify(token, jwtSecret);
    setAuthCookie(res, token);
    res.json({ success: true, data: { established: true } });
  } catch (error: any) {
    if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
      return next(createError('Invalid or expired token', 401));
    }
    next(error);
  }
};

