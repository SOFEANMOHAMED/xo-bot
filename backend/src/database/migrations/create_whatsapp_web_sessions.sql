-- WhatsApp Web (QR) sessions — one isolated session per merchant.
-- Credentials are stored encrypted (AES-256-GCM) in creds_ciphertext / keys_ciphertext.
-- This table is independent of Cloud API `whatsapp_accounts`.

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
