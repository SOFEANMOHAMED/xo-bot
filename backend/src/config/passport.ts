import type { Request } from 'express';
import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import pool from '../database/connection.js';
import { logger } from '../utils/logger.js';
import {
  linkMerchantToAffiliateReferrer,
  referralCodeFromOAuthState
} from '../utils/affiliateReferral.js';
import { sendAndTrackWelcomeEmail } from '../services/lifecycleEmails/index.js';

passport.use(new GoogleStrategy({
  clientID: process.env.GOOGLE_CLIENT_ID!,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
  callbackURL: process.env.GOOGLE_REDIRECT_URI || 'https://xo-bot.com/api/auth/google/callback',
  passReqToCallback: true
}, async (req: Request, accessToken, refreshToken, profile, done) => {
  try {
    console.log('[Passport Google Strategy] Profile received:', {
      id: profile.id,
      displayName: profile.displayName,
      emails: profile.emails?.map(e => e.value),
      hasEmail: !!profile.emails?.[0]?.value
    });

    const { id, emails, displayName, photos } = profile;
    const email = emails?.[0]?.value;

    if (!email) {
      console.error('[Passport Google Strategy] No email found in profile');
      logger.error('Google OAuth: No email found in profile', new Error('No email in Google profile'));
      return done(new Error('No email found in Google profile'), undefined);
    }

    console.log('[Passport Google Strategy] Processing profile:', {
      googleId: id,
      email,
      displayName
    });

    logger.info('Google OAuth: Processing profile', {
      googleId: id,
      email,
      displayName
    });

    // Check if user exists with this Google ID
    let userResult = await pool.query(
      'SELECT * FROM merchants WHERE google_id = $1',
      [id]
    );

    if (userResult.rows.length > 0) {
      console.log('[Passport Google Strategy] User found by google_id:', { userId: userResult.rows[0].id });
      logger.info('Google OAuth: User found by google_id', { userId: userResult.rows[0].id });
      return done(null, userResult.rows[0]);
    }

    // Check if user exists with this email
    userResult = await pool.query(
      'SELECT * FROM merchants WHERE email = $1',
      [email]
    );

    if (userResult.rows.length > 0) {
      // Link Google account to existing user
      console.log('[Passport Google Strategy] Linking Google account to existing user:', { userId: userResult.rows[0].id });
      logger.info('Google OAuth: Linking Google account to existing user', { userId: userResult.rows[0].id });
      await pool.query(
        'UPDATE merchants SET google_id = $1, auth_provider = $2 WHERE email = $3',
        [id, 'google', email]
      );
      const updatedUser = await pool.query(
        'SELECT * FROM merchants WHERE email = $1',
        [email]
      );
      console.log('[Passport Google Strategy] User linked successfully:', { userId: updatedUser.rows[0].id });
      return done(null, updatedUser.rows[0]);
    }

    // Create new user
    console.log('[Passport Google Strategy] Creating new user:', { email, displayName });
    logger.info('Google OAuth: Creating new user', { email, displayName });
    const newUserResult = await pool.query(
      `INSERT INTO merchants (email, name, google_id, auth_provider, role, subscription_plan, trial_ends_at)
       VALUES ($1, $2, $3, 'google', 'user', 'trial', NOW() + INTERVAL '7 days')
       RETURNING *`,
      [email, displayName || email.split('@')[0], id]
    );

    const newUser = newUserResult.rows[0];

    // Create default settings
    await pool.query(
      `INSERT INTO merchant_settings (merchant_id, store_name, welcome_message, store_currency)
       VALUES ($1, $2, $3, $4)`,
      [newUser.id, displayName || 'متجر جديد', 'أهلاً بك في متجرنا! كيف يمكنني مساعدتك اليوم؟', 'USD']
    );

    const refFromOAuth = referralCodeFromOAuthState(req.query?.state);
    if (refFromOAuth) {
      try {
        await linkMerchantToAffiliateReferrer(pool, newUser.id, refFromOAuth);
      } catch (affErr: unknown) {
        logger.warn('Google OAuth: affiliate link failed (non-fatal)', {
          merchantId: newUser.id,
          error: affErr instanceof Error ? affErr.message : String(affErr)
        });
      }
    }

    console.log('[Passport Google Strategy] New user created successfully:', { userId: newUser.id });
    logger.info('Google OAuth: New user created successfully', { userId: newUser.id });

    void sendAndTrackWelcomeEmail(newUser.id, newUser.email, newUser.name);

    return done(null, newUser);
  } catch (error: any) {
    console.error('[Passport Google Strategy] Error processing profile:', error);
    logger.error('Google OAuth: Error processing profile', error as Error);
    return done(error, undefined);
  }
}));

passport.serializeUser((user: any, done) => {
  done(null, user.id);
});

passport.deserializeUser(async (id: string, done) => {
  try {
    const result = await pool.query('SELECT * FROM merchants WHERE id = $1', [id]);
    done(null, result.rows[0] || undefined);
  } catch (error) {
    logger.error('Passport: Error deserializing user', error as Error);
    done(error, undefined);
  }
});

export default passport;

