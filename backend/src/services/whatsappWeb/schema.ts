import pool from '../../database/connection.js';
import { logger } from '../../utils/logger.js';

const CREATE_WHATSAPP_WEB_SESSIONS_SQL = `
CREATE TABLE IF NOT EXISTS whatsapp_web_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    phone_number VARCHAR(32),
    phone_digits VARCHAR(20),
    status VARCHAR(32) NOT NULL DEFAULT 'disconnected',
    creds_ciphertext TEXT,
    keys_ciphertext TEXT,
    auto_reply_enabled BOOLEAN NOT NULL DEFAULT false,
    welcome_message TEXT,
    last_connected_at TIMESTAMP,
    last_disconnect_at TIMESTAMP,
    last_disconnect_reason TEXT,
    last_qr_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (merchant_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_web_sessions_phone_connected_uidx
    ON whatsapp_web_sessions (phone_digits)
    WHERE status = 'connected'
      AND phone_digits IS NOT NULL
      AND length(phone_digits) > 0;

CREATE INDEX IF NOT EXISTS whatsapp_web_sessions_status_idx
    ON whatsapp_web_sessions (status);
`;

let ensured = false;

export async function ensureWhatsAppWebSessionsSchema(): Promise<void> {
  if (ensured) return;
  await pool.query(CREATE_WHATSAPP_WEB_SESSIONS_SQL);
  await pool.query(`
    ALTER TABLE whatsapp_web_sessions
      ALTER COLUMN auto_reply_enabled SET DEFAULT false
  `);
  try {
    await pool.query(
      `UPDATE global_settings
       SET value = jsonb_set(COALESCE(value, '{}'::jsonb), '{maxWhatsAppAccounts}', '1'::jsonb),
           updated_at = CURRENT_TIMESTAMP
       WHERE key = ANY($1::text[])
         AND COALESCE(value->>'maxWhatsAppAccounts', '0') = '0'`,
      [[
        'plan_limits_single',
        'plan_limits_pro',
        'plan_limits_social',
        'plan_limits_yearly',
        'plan_limits_trial',
        'plan_limits_business'
      ]]
    );
  } catch {
    /* global_settings may not exist yet */
  }
  ensured = true;
  logger.info('WhatsApp Web sessions schema ready');
}
