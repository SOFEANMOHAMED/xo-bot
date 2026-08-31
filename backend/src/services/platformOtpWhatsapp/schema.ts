import pool from '../../database/connection.js';
import { logger } from '../../utils/logger.js';

export const PLATFORM_OTP_WHATSAPP_PURPOSE = 'signup_otp';

const CREATE_PLATFORM_WHATSAPP_SESSIONS_SQL = `
CREATE TABLE IF NOT EXISTS platform_whatsapp_sessions (
    purpose VARCHAR(32) PRIMARY KEY DEFAULT 'signup_otp',
    phone_number VARCHAR(32),
    phone_digits VARCHAR(20),
    status VARCHAR(32) NOT NULL DEFAULT 'disconnected',
    creds_ciphertext TEXT,
    keys_ciphertext TEXT,
    last_connected_at TIMESTAMP,
    last_disconnect_at TIMESTAMP,
    last_disconnect_reason TEXT,
    last_qr_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
`;

const CREATE_SIGNUP_OTP_CHALLENGES_SQL = `
CREATE TABLE IF NOT EXISTS signup_otp_challenges (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    purpose VARCHAR(32) NOT NULL,
    email VARCHAR(255),
    merchant_id UUID REFERENCES merchants(id) ON DELETE CASCADE,
    phone VARCHAR(32) NOT NULL,
    phone_digits VARCHAR(20) NOT NULL,
    password_hash TEXT,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    otp_hash TEXT NOT NULL,
    attempts INT NOT NULL DEFAULT 0,
    last_sent_at TIMESTAMP,
    expires_at TIMESTAMP NOT NULL,
    verified_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS signup_otp_challenges_phone_digits_idx
    ON signup_otp_challenges (phone_digits, created_at DESC);

CREATE INDEX IF NOT EXISTS signup_otp_challenges_email_idx
    ON signup_otp_challenges (email)
    WHERE email IS NOT NULL;

CREATE INDEX IF NOT EXISTS signup_otp_challenges_merchant_idx
    ON signup_otp_challenges (merchant_id)
    WHERE merchant_id IS NOT NULL;
`;

let ensured = false;

export async function ensureSignupOtpSchema(): Promise<void> {
  if (ensured) return;
  await pool.query(CREATE_PLATFORM_WHATSAPP_SESSIONS_SQL);
  await pool.query(CREATE_SIGNUP_OTP_CHALLENGES_SQL);
  ensured = true;
  logger.info('Signup OTP schema ready');
}
