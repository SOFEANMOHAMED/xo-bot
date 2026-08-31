import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import pool from '../database/connection.js';
import { createError } from '../middleware/errorHandler.js';
import { logger } from '../utils/logger.js';
import { sendAndTrackWelcomeEmail } from './lifecycleEmails/index.js';
import {
  linkMerchantToAffiliateReferrer,
} from '../utils/affiliateReferral.js';
import {
  applyMerchantAcquisition,
  normalizeAcquisitionInput,
  type MerchantAcquisitionInput
} from './merchantAcquisition.js';

export const normalizeMerchantEmail = (email: string): string => email.trim().toLowerCase();

function toIsoOrNull(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export async function buildPublicMerchantUser(merchant: {
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
  const { ensureSubscriptionEndsAtColumn, enforceMerchantSubscriptionExpiry } = await import(
    './subscriptionExpiry/index.js'
  );
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

async function ensureReferralCodeColumn(): Promise<void> {
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
  } catch (err: unknown) {
    console.warn('Error ensuring referral_code column exists:', err);
  }
}

async function ensurePhoneColumn(): Promise<void> {
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
  } catch (err: unknown) {
    console.warn('Error ensuring phone column exists:', err);
  }
}

async function generateUniqueReferralCode(email: string): Promise<string> {
  let newUserReferralCode = '';
  let isUnique = false;
  let attempts = 0;
  while (!isUnique && attempts < 20) {
    const emailPrefix = email.substring(0, 3).toUpperCase().replace(/[^A-Z]/g, '') || 'REF';
    const randomNum = Math.floor(10000 + Math.random() * 90000);
    newUserReferralCode = `${emailPrefix}${randomNum}`;

    const checkResult = await pool.query(
      'SELECT id FROM merchants WHERE referral_code = $1',
      [newUserReferralCode]
    );

    if (checkResult.rows.length === 0) {
      isUnique = true;
    } else {
      attempts++;
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
  return newUserReferralCode;
}

export interface CreateMerchantAccountInput {
  email: string;
  password?: string;
  passwordHash?: string;
  name?: string | null;
  storeName?: string | null;
  phone?: string | null;
  referralCode?: string | null;
  acquisition?: MerchantAcquisitionInput | null;
  authProvider?: string | null;
}

export async function createMerchantAccount(input: CreateMerchantAccountInput) {
  const email = normalizeMerchantEmail(input.email);
  const existingUser = await pool.query(
    'SELECT id FROM merchants WHERE LOWER(TRIM(email)) = $1',
    [email]
  );
  if (existingUser.rows.length > 0) {
    throw createError('Email already registered', 400);
  }

  await ensureReferralCodeColumn();
  await ensurePhoneColumn();

  let passwordHash = input.passwordHash;
  if (!passwordHash) {
    if (!input.password) {
      throw createError('Password is required', 400);
    }
    passwordHash = await bcrypt.hash(input.password, 10);
  }
  const newUserReferralCode = await generateUniqueReferralCode(email);
  const storeName = (input.storeName || input.name || 'متجر جديد').trim() || 'متجر جديد';

  const result = await pool.query(
    `INSERT INTO merchants (email, password_hash, name, role, subscription_plan, trial_ends_at, referral_code, phone, auth_provider)
     VALUES ($1, $2, $3, 'user', 'trial', NOW() + INTERVAL '7 days', $4, $5, $6)
     RETURNING id, email, name, role, subscription_plan, subscription_status, trial_ends_at, created_at, referral_code`,
    [
      email,
      passwordHash,
      input.name || null,
      newUserReferralCode,
      input.phone || null,
      input.authProvider || null
    ]
  );

  const merchant = result.rows[0];

  await pool.query(
    `INSERT INTO merchant_settings (merchant_id, store_name, welcome_message, store_currency)
     VALUES ($1, $2, $3, $4)`,
    [
      merchant.id,
      storeName,
      'أهلاً بك في متجرنا! كيف يمكنني مساعدتك اليوم؟',
      'USD'
    ]
  );

  const trimmedRef = input.referralCode?.trim();
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
    await applyMerchantAcquisition(merchant.id, input.acquisition ?? null);
  } catch (acqErr: unknown) {
    logger.warn('Failed to apply merchant acquisition on register', {
      merchantId: merchant.id,
      error: acqErr instanceof Error ? acqErr.message : String(acqErr)
    });
  }

  void sendAndTrackWelcomeEmail(merchant.id, merchant.email, merchant.name);

  return merchant;
}

export async function completeGoogleMerchantProfile(input: {
  merchantId: string;
  password?: string;
  passwordHash?: string;
  phone: string;
  referralCode?: string | null;
  acquisition?: MerchantAcquisitionInput | null;
}) {
  const userResult = await pool.query(
    'SELECT id, email, auth_provider, password_hash, phone FROM merchants WHERE id = $1',
    [input.merchantId]
  );

  if (userResult.rows.length === 0) {
    throw createError('المستخدم غير موجود', 404);
  }

  const user = userResult.rows[0];

  if (user.auth_provider !== 'google') {
    throw createError('هذه العملية متاحة فقط لمستخدمي Google', 400);
  }

  if (user.password_hash && user.phone) {
    throw createError('الملف الشخصي مكتمل مسبقاً', 400);
  }

  let passwordHash = input.passwordHash;
  if (!passwordHash) {
    if (!input.password) {
      throw createError('كلمة المرور مطلوبة', 400);
    }
    passwordHash = await bcrypt.hash(input.password, 10);
  }

  await pool.query(
    'UPDATE merchants SET password_hash = $1, phone = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3',
    [passwordHash, input.phone, input.merchantId]
  );

  const trimmedRef = input.referralCode?.trim();
  if (trimmedRef) {
    try {
      await linkMerchantToAffiliateReferrer(pool, input.merchantId, trimmedRef);
    } catch (refError: unknown) {
      logger.warn(
        'Error processing referral code during profile completion',
        refError instanceof Error ? refError : new Error(String(refError))
      );
    }
  }

  try {
    const acqInput = normalizeAcquisitionInput({
      ...(input.acquisition || {}),
      ref: input.acquisition?.ref || trimmedRef || undefined,
      acq: input.acquisition?.acqCode || undefined
    } as Record<string, unknown>);
    await applyMerchantAcquisition(input.merchantId, acqInput);
  } catch (acqErr: unknown) {
    logger.warn('Failed to apply merchant acquisition on complete profile', {
      merchantId: input.merchantId,
      error: acqErr instanceof Error ? acqErr.message : String(acqErr)
    });
  }

  return user;
}
