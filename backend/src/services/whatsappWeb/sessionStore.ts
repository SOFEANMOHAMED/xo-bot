import pool from '../../database/connection.js';
import { logger } from '../../utils/logger.js';
import type { WhatsAppWebSessionRow, WhatsAppWebStatus } from './types.js';

export async function getWhatsAppWebSession(
  merchantId: string
): Promise<WhatsAppWebSessionRow | null> {
  const result = await pool.query(
    `SELECT merchant_id, phone_number, phone_digits, status,
            creds_ciphertext, keys_ciphertext, auto_reply_enabled, welcome_message,
            last_connected_at, last_disconnect_at, last_disconnect_reason
     FROM whatsapp_web_sessions
     WHERE merchant_id = $1
     LIMIT 1`,
    [merchantId]
  );
  return result.rows[0] || null;
}

export async function upsertWhatsAppWebSession(merchantId: string): Promise<void> {
  await pool.query(
    `INSERT INTO whatsapp_web_sessions (merchant_id, auto_reply_enabled)
     VALUES ($1, false)
     ON CONFLICT (merchant_id) DO NOTHING`,
    [merchantId]
  );
}

export async function saveEncryptedAuthState(
  merchantId: string,
  credsCiphertext: string,
  keysCiphertext: string
): Promise<void> {
  await pool.query(
    `UPDATE whatsapp_web_sessions
     SET creds_ciphertext = $2,
         keys_ciphertext = $3,
         updated_at = CURRENT_TIMESTAMP
     WHERE merchant_id = $1`,
    [merchantId, credsCiphertext, keysCiphertext]
  );
}

export async function updateWhatsAppWebStatus(params: {
  merchantId: string;
  status: WhatsAppWebStatus;
  phoneNumber?: string | null;
  phoneDigits?: string | null;
  disconnectReason?: string | null;
}): Promise<void> {
  const { merchantId, status, phoneNumber, phoneDigits, disconnectReason } = params;
  const isQr = status === 'qr';
  const connected = status === 'connected';
  const disconnected = status === 'disconnected' || status === 'logged_out';

  await pool.query(
    `UPDATE whatsapp_web_sessions
     SET status = $2::varchar(32),
         phone_number = COALESCE($3::varchar, phone_number),
         phone_digits = COALESCE($4::varchar, phone_digits),
         last_qr_at = CASE WHEN $5::boolean THEN CURRENT_TIMESTAMP ELSE last_qr_at END,
         last_connected_at = CASE WHEN $6::boolean THEN CURRENT_TIMESTAMP ELSE last_connected_at END,
         last_disconnect_at = CASE WHEN $7::boolean THEN CURRENT_TIMESTAMP ELSE last_disconnect_at END,
         last_disconnect_reason = CASE WHEN $7::boolean THEN $8::text ELSE last_disconnect_reason END,
         updated_at = CURRENT_TIMESTAMP
     WHERE merchant_id = $1::uuid`,
    [
      merchantId,
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

export async function clearWhatsAppWebAuth(
  merchantId: string,
  reason: string
): Promise<void> {
  await pool.query(
    `UPDATE whatsapp_web_sessions
     SET creds_ciphertext = NULL,
         keys_ciphertext = NULL,
         status = 'logged_out',
         last_disconnect_at = CURRENT_TIMESTAMP,
         last_disconnect_reason = $2,
         updated_at = CURRENT_TIMESTAMP
     WHERE merchant_id = $1`,
    [merchantId, reason]
  );
}

export async function deleteWhatsAppWebSession(merchantId: string): Promise<void> {
  await pool.query('DELETE FROM whatsapp_web_sessions WHERE merchant_id = $1', [merchantId]);
}

export async function findMerchantByConnectedPhone(
  phoneDigits: string,
  excludeMerchantId?: string
): Promise<string | null> {
  const result = await pool.query(
    `SELECT merchant_id
     FROM whatsapp_web_sessions
     WHERE phone_digits = $1
       AND status = 'connected'
       AND ($2::uuid IS NULL OR merchant_id <> $2::uuid)
     LIMIT 1`,
    [phoneDigits, excludeMerchantId || null]
  );
  return result.rows[0]?.merchant_id || null;
}

export async function listRestorableMerchantIds(): Promise<string[]> {
  const result = await pool.query(
    `SELECT merchant_id
     FROM whatsapp_web_sessions
     WHERE creds_ciphertext IS NOT NULL
       AND keys_ciphertext IS NOT NULL
       AND status IN ('connected', 'connecting')`
  );
  return result.rows.map((row) => row.merchant_id as string);
}

export async function updateWhatsAppWebSettings(
  merchantId: string,
  data: { autoReplyEnabled?: boolean; welcomeMessage?: string }
): Promise<boolean> {
  const result = await pool.query(
    `UPDATE whatsapp_web_sessions
     SET auto_reply_enabled = CASE
           WHEN $2::boolean IS NULL THEN auto_reply_enabled
           ELSE $2::boolean
         END,
         welcome_message = CASE
           WHEN $3::text IS NULL THEN welcome_message
           ELSE $3::text
         END,
         updated_at = CURRENT_TIMESTAMP
     WHERE merchant_id = $1::uuid`,
    [
      merchantId,
      typeof data.autoReplyEnabled === 'boolean' ? data.autoReplyEnabled : null,
      data.welcomeMessage === undefined ? null : data.welcomeMessage
    ]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function countWhatsAppWebSessions(merchantId: string): Promise<number> {
  try {
    const result = await pool.query(
      `SELECT COUNT(*)::int AS count
       FROM whatsapp_web_sessions
       WHERE merchant_id = $1 AND status = 'connected'`,
      [merchantId]
    );
    return result.rows[0]?.count || 0;
  } catch (error: any) {
    if (error?.code === '42P01') return 0;
    logger.error('Error counting WhatsApp Web sessions', error as Error, { merchantId });
    return 0;
  }
}
