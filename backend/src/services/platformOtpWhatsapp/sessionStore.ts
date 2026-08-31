import pool from '../../database/connection.js';
import { PLATFORM_OTP_WHATSAPP_PURPOSE } from './schema.js';
import type { PlatformWaStatus } from './types.js';

export interface PlatformWhatsAppSessionRow {
  purpose: string;
  phone_number: string | null;
  phone_digits: string | null;
  status: PlatformWaStatus;
  creds_ciphertext: string | null;
  keys_ciphertext: string | null;
  last_connected_at: Date | null;
  last_disconnect_at: Date | null;
  last_disconnect_reason: string | null;
}

export async function getPlatformWhatsAppSession(): Promise<PlatformWhatsAppSessionRow | null> {
  const result = await pool.query(
    `SELECT purpose, phone_number, phone_digits, status,
            creds_ciphertext, keys_ciphertext,
            last_connected_at, last_disconnect_at, last_disconnect_reason
     FROM platform_whatsapp_sessions
     WHERE purpose = $1
     LIMIT 1`,
    [PLATFORM_OTP_WHATSAPP_PURPOSE]
  );
  return result.rows[0] || null;
}

export async function upsertPlatformWhatsAppSession(): Promise<void> {
  await pool.query(
    `INSERT INTO platform_whatsapp_sessions (purpose, status)
     VALUES ($1, 'disconnected')
     ON CONFLICT (purpose) DO NOTHING`,
    [PLATFORM_OTP_WHATSAPP_PURPOSE]
  );
}

export async function savePlatformEncryptedAuthState(
  credsCiphertext: string,
  keysCiphertext: string
): Promise<void> {
  await pool.query(
    `UPDATE platform_whatsapp_sessions
     SET creds_ciphertext = $2,
         keys_ciphertext = $3,
         updated_at = CURRENT_TIMESTAMP
     WHERE purpose = $1`,
    [PLATFORM_OTP_WHATSAPP_PURPOSE, credsCiphertext, keysCiphertext]
  );
}

export async function updatePlatformWhatsAppStatus(params: {
  status: PlatformWaStatus;
  phoneNumber?: string | null;
  phoneDigits?: string | null;
  disconnectReason?: string | null;
}): Promise<void> {
  const { status, phoneNumber, phoneDigits, disconnectReason } = params;
  const isQr = status === 'qr';
  const connected = status === 'connected';
  const disconnected = status === 'disconnected' || status === 'logged_out';

  await pool.query(
    `UPDATE platform_whatsapp_sessions
     SET status = $2::varchar(32),
         phone_number = COALESCE($3::varchar, phone_number),
         phone_digits = COALESCE($4::varchar, phone_digits),
         last_qr_at = CASE WHEN $5::boolean THEN CURRENT_TIMESTAMP ELSE last_qr_at END,
         last_connected_at = CASE WHEN $6::boolean THEN CURRENT_TIMESTAMP ELSE last_connected_at END,
         last_disconnect_at = CASE WHEN $7::boolean THEN CURRENT_TIMESTAMP ELSE last_disconnect_at END,
         last_disconnect_reason = CASE WHEN $7::boolean THEN $8::text ELSE last_disconnect_reason END,
         updated_at = CURRENT_TIMESTAMP
     WHERE purpose = $1`,
    [
      PLATFORM_OTP_WHATSAPP_PURPOSE,
      status,
      phoneNumber ?? null,
      phoneDigits ?? null,
      isQr,
      connected,
      disconnected,
      disconnectReason ?? null
    ]
  );
}

export async function clearPlatformWhatsAppAuth(reason: string): Promise<void> {
  await pool.query(
    `UPDATE platform_whatsapp_sessions
     SET creds_ciphertext = NULL,
         keys_ciphertext = NULL,
         status = 'logged_out',
         last_disconnect_at = CURRENT_TIMESTAMP,
         last_disconnect_reason = $2,
         updated_at = CURRENT_TIMESTAMP
     WHERE purpose = $1`,
    [PLATFORM_OTP_WHATSAPP_PURPOSE, reason]
  );
}

export async function deletePlatformWhatsAppSession(): Promise<void> {
  await pool.query('DELETE FROM platform_whatsapp_sessions WHERE purpose = $1', [
    PLATFORM_OTP_WHATSAPP_PURPOSE
  ]);
}

export async function isPlatformSessionRestorable(): Promise<boolean> {
  const result = await pool.query(
    `SELECT 1 FROM platform_whatsapp_sessions
     WHERE purpose = $1
       AND creds_ciphertext IS NOT NULL
       AND keys_ciphertext IS NOT NULL
       AND status IN ('connected', 'connecting')
     LIMIT 1`,
    [PLATFORM_OTP_WHATSAPP_PURPOSE]
  );
  return result.rows.length > 0;
}
