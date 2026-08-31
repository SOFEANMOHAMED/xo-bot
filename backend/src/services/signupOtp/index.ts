import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import pool from '../../database/connection.js';
import { createError } from '../../middleware/errorHandler.js';
import { logger } from '../../utils/logger.js';
import { phoneDigitsFromJid, formatDisplayPhone } from '../whatsappWeb/jid.js';
import {
  ensureSignupOtpSchema,
  isPlatformWhatsAppConnected,
  sendPlatformWhatsAppText
} from '../platformOtpWhatsapp/index.js';

export type SignupOtpPurpose = 'email_signup' | 'google_complete_profile';

const OTP_TTL_MS = 10 * 60 * 1000;
const OTP_RESEND_COOLDOWN_MS = 90 * 1000;
const MAX_OTP_ATTEMPTS = 5;
const MAX_OTP_SENDS_PER_PHONE_HOUR = 8;

export interface SignupOtpSettings {
  enabled: boolean;
}

export async function ensureSignupOtpServices(): Promise<void> {
  await ensureSignupOtpSchema();
}

export async function getSignupOtpSettings(): Promise<SignupOtpSettings> {
  try {
    const result = await pool.query(
      `SELECT value::jsonb FROM global_settings WHERE key = 'admin_global_settings' LIMIT 1`
    );
    const signupOtp = result.rows[0]?.value?.signupOtp;
    return { enabled: signupOtp?.enabled === true };
  } catch {
    return { enabled: false };
  }
}

export async function isSignupOtpEnabled(): Promise<boolean> {
  const settings = await getSignupOtpSettings();
  return settings.enabled;
}

export function normalizeSignupPhone(raw: string): { phone: string; phoneDigits: string } {
  const trimmed = (raw || '').trim();
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length < 8 || digits.length > 15) {
    throw createError('رقم الهاتف غير صالح', 400);
  }
  const phone = formatDisplayPhone(digits) || `+${digits}`;
  return { phone, phoneDigits: digits };
}

function generateOtpCode(): string {
  return String(crypto.randomInt(100000, 1000000));
}

async function hashOtp(code: string): Promise<string> {
  return bcrypt.hash(code, 10);
}

async function verifyOtpHash(code: string, hash: string): Promise<boolean> {
  return bcrypt.compare(code, hash);
}

async function countRecentSends(phoneDigits: string): Promise<number> {
  const result = await pool.query(
    `SELECT COUNT(*)::int AS count
     FROM signup_otp_challenges
     WHERE phone_digits = $1
       AND created_at > NOW() - INTERVAL '1 hour'`,
    [phoneDigits]
  );
  return result.rows[0]?.count || 0;
}

export async function assertSignupOtpCanSend(phoneDigits: string): Promise<void> {
  if (!(await isSignupOtpEnabled())) {
    throw createError('التحقق عبر واتساب غير مفعّل', 400);
  }
  if (!isPlatformWhatsAppConnected()) {
    throw createError('خدمة التحقق عبر واتساب غير متاحة حالياً. حاول لاحقاً.', 503);
  }
  const recent = await countRecentSends(phoneDigits);
  if (recent >= MAX_OTP_SENDS_PER_PHONE_HOUR) {
    throw createError('تم تجاوز حد إرسال رموز التحقق لهذا الرقم. حاول بعد ساعة.', 429);
  }
}

async function sendOtpWhatsApp(phone: string, code: string): Promise<void> {
  const message = `رمز التحقق XO Bot: ${code}\nصالح لمدة 10 دقائق. لا تشارك هذا الرمز مع أحد.`;
  const sent = await sendPlatformWhatsAppText(phone, message);
  if (!sent) {
    throw createError('تعذر إرسال رمز التحقق عبر واتساب. حاول لاحقاً.', 503);
  }
}

export interface CreateSignupOtpChallengeInput {
  purpose: SignupOtpPurpose;
  phone: string;
  email?: string | null;
  merchantId?: string | null;
  passwordHash?: string | null;
  payload?: Record<string, unknown>;
}

export async function createSignupOtpChallenge(
  input: CreateSignupOtpChallengeInput
): Promise<{ challengeId: string; expiresAt: string; resendAfterSeconds: number }> {
  await ensureSignupOtpSchema();
  const { phone, phoneDigits } = normalizeSignupPhone(input.phone);
  await assertSignupOtpCanSend(phoneDigits);

  const code = generateOtpCode();
  const otpHash = await hashOtp(code);
  const expiresAt = new Date(Date.now() + OTP_TTL_MS);

  const result = await pool.query(
    `INSERT INTO signup_otp_challenges (
       purpose, email, merchant_id, phone, phone_digits,
       password_hash, payload, otp_hash, last_sent_at, expires_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, CURRENT_TIMESTAMP, $9)
     RETURNING id, expires_at`,
    [
      input.purpose,
      input.email?.trim().toLowerCase() || null,
      input.merchantId || null,
      phone,
      phoneDigits,
      input.passwordHash || null,
      JSON.stringify(input.payload || {}),
      otpHash,
      expiresAt
    ]
  );

  const challengeId = result.rows[0].id as string;
  await sendOtpWhatsApp(phone, code);
  logger.info('Signup OTP sent', {
    purpose: input.purpose,
    challengeId,
    phoneDigits: phoneDigits.slice(-4)
  });

  return {
    challengeId,
    expiresAt: new Date(result.rows[0].expires_at).toISOString(),
    resendAfterSeconds: Math.ceil(OTP_RESEND_COOLDOWN_MS / 1000)
  };
}

export async function resendSignupOtpChallenge(challengeId: string): Promise<{
  challengeId: string;
  expiresAt: string;
  resendAfterSeconds: number;
}> {
  await ensureSignupOtpSchema();
  const row = await getChallengeRow(challengeId);
  if (!row) {
    throw createError('انتهت صلاحية طلب التحقق. أعد التسجيل من البداية.', 400);
  }
  if (row.verified_at) {
    throw createError('تم التحقق مسبقاً', 400);
  }

  const lastSent = row.last_sent_at ? new Date(row.last_sent_at).getTime() : 0;
  const elapsed = Date.now() - lastSent;
  if (elapsed < OTP_RESEND_COOLDOWN_MS) {
    const waitSec = Math.ceil((OTP_RESEND_COOLDOWN_MS - elapsed) / 1000);
    throw createError(`انتظر ${waitSec} ثانية قبل إعادة الإرسال`, 429);
  }

  await assertSignupOtpCanSend(row.phone_digits);

  const code = generateOtpCode();
  const otpHash = await hashOtp(code);
  const expiresAt = new Date(Date.now() + OTP_TTL_MS);

  await pool.query(
    `UPDATE signup_otp_challenges
     SET otp_hash = $2,
         attempts = 0,
         last_sent_at = CURRENT_TIMESTAMP,
         expires_at = $3
     WHERE id = $1::uuid`,
    [challengeId, otpHash, expiresAt]
  );

  await sendOtpWhatsApp(row.phone, code);
  logger.info('Signup OTP resent', { challengeId, phoneDigits: row.phone_digits.slice(-4) });

  return {
    challengeId,
    expiresAt: expiresAt.toISOString(),
    resendAfterSeconds: Math.ceil(OTP_RESEND_COOLDOWN_MS / 1000)
  };
}

interface ChallengeRow {
  id: string;
  purpose: SignupOtpPurpose;
  email: string | null;
  merchant_id: string | null;
  phone: string;
  phone_digits: string;
  password_hash: string | null;
  payload: Record<string, unknown>;
  otp_hash: string;
  attempts: number;
  last_sent_at: Date | null;
  expires_at: Date;
  verified_at: Date | null;
}

async function getChallengeRow(challengeId: string): Promise<ChallengeRow | null> {
  const result = await pool.query(
    `SELECT id, purpose, email, merchant_id, phone, phone_digits,
            password_hash, payload, otp_hash, attempts,
            last_sent_at, expires_at, verified_at
     FROM signup_otp_challenges
     WHERE id = $1::uuid
     LIMIT 1`,
    [challengeId]
  );
  if (!result.rows[0]) return null;
  const row = result.rows[0];
  return {
    ...row,
    payload: typeof row.payload === 'object' ? row.payload : {}
  } as ChallengeRow;
}

export async function verifySignupOtpChallenge(
  challengeId: string,
  code: string
): Promise<ChallengeRow> {
  await ensureSignupOtpSchema();
  const trimmedCode = (code || '').trim();
  if (!/^\d{6}$/.test(trimmedCode)) {
    throw createError('رمز التحقق يجب أن يكون 6 أرقام', 400);
  }

  const row = await getChallengeRow(challengeId);
  if (!row) {
    throw createError('طلب التحقق غير صالح أو منتهي', 400);
  }
  if (row.verified_at) {
    return row;
  }
  if (new Date(row.expires_at).getTime() < Date.now()) {
    throw createError('انتهت صلاحية رمز التحقق. أعد الإرسال أو ابدأ من جديد.', 400);
  }
  if (row.attempts >= MAX_OTP_ATTEMPTS) {
    throw createError('تم تجاوز عدد المحاولات. ابدأ من جديد.', 400);
  }

  const valid = await verifyOtpHash(trimmedCode, row.otp_hash);
  if (!valid) {
    await pool.query(
      `UPDATE signup_otp_challenges SET attempts = attempts + 1 WHERE id = $1::uuid`,
      [challengeId]
    );
    throw createError('رمز التحقق غير صحيح', 400);
  }

  await pool.query(
    `UPDATE signup_otp_challenges SET verified_at = CURRENT_TIMESTAMP WHERE id = $1::uuid`,
    [challengeId]
  );
  row.verified_at = new Date();
  return row;
}

export async function getPlatformOtpWhatsappStatus(): Promise<{
  connected: boolean;
  status: string;
  phoneNumber: string | null;
  signupOtpEnabled: boolean;
}> {
  await ensureSignupOtpSchema();
  const live = await import('../platformOtpWhatsapp/index.js').then((m) =>
    m.getPlatformWhatsAppLiveStatus()
  );
  const dbRow = await import('../platformOtpWhatsapp/sessionStore.js').then((m) =>
    m.getPlatformWhatsAppSession()
  );
  const settings = await getSignupOtpSettings();
  const connected =
    live.status === 'connected' || dbRow?.status === 'connected';
  return {
    connected,
    status: live.status || dbRow?.status || 'disconnected',
    phoneNumber: live.phoneNumber || dbRow?.phone_number || null,
    signupOtpEnabled: settings.enabled
  };
}

/** Normalize phone for duplicate checks across merchants */
export function phoneDigitsOnly(raw: string): string {
  return phoneDigitsFromJid(raw) || raw.replace(/\D/g, '');
}
