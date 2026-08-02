/**
 * Channel outbound for abandoned-checkout reminders.
 * Resolves per-merchant credentials; never cross-tenant.
 */

import pool from '../../database/connection.js';
import { logger } from '../../utils/logger.js';
import type { AbandonedCheckoutPlatform } from './constants.js';

async function sendFacebookMessenger(
  merchantId: string,
  recipientId: string,
  text: string,
  preferredPageId?: string | null
): Promise<boolean> {
  let row: { page_id: string; access_token: string } | undefined;

  if (preferredPageId) {
    const preferred = await pool.query(
      `SELECT page_id, access_token
       FROM facebook_pages
       WHERE merchant_id = $1 AND page_id = $2
       LIMIT 1`,
      [merchantId, preferredPageId]
    );
    row = preferred.rows[0];
  }

  if (!row) {
    const fallback = await pool.query(
      `SELECT page_id, access_token
       FROM facebook_pages
       WHERE merchant_id = $1
       ORDER BY updated_at DESC NULLS LAST
       LIMIT 1`,
      [merchantId]
    );
    row = fallback.rows[0];
  }

  if (!row?.page_id || !row?.access_token) {
    logger.warn('Abandoned reminder: no Facebook page credentials', { merchantId });
    return false;
  }

  const url =
    `https://graph.facebook.com/v21.0/${encodeURIComponent(row.page_id)}/messages` +
    `?access_token=${encodeURIComponent(row.access_token)}`;

  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      recipient: { id: recipientId },
      message: { text },
      messaging_type: 'RESPONSE',
    }),
  });

  const data = (await resp.json()) as { error?: { message?: string; code?: number } };
  if (!resp.ok) {
    logger.error('Abandoned reminder: Facebook send failed', new Error(JSON.stringify(data)), {
      merchantId,
      recipientId,
      pageId: row.page_id,
    });
    return false;
  }
  return true;
}

async function sendInstagram(
  merchantId: string,
  recipientId: string,
  text: string,
  preferredIgUserId?: string | null
): Promise<boolean> {
  let row: { access_token: string } | undefined;

  if (preferredIgUserId) {
    const preferred = await pool.query(
      `SELECT access_token
       FROM instagram_accounts
       WHERE merchant_id = $1 AND ig_user_id = $2
       LIMIT 1`,
      [merchantId, preferredIgUserId]
    );
    row = preferred.rows[0];
  }

  if (!row) {
    const fallback = await pool.query(
      `SELECT access_token
       FROM instagram_accounts
       WHERE merchant_id = $1
       ORDER BY updated_at DESC NULLS LAST
       LIMIT 1`,
      [merchantId]
    );
    row = fallback.rows[0];
  }

  if (!row?.access_token) {
    logger.warn('Abandoned reminder: no Instagram credentials', { merchantId });
    return false;
  }

  const url =
    `https://graph.facebook.com/v21.0/me/messages` +
    `?access_token=${encodeURIComponent(row.access_token)}`;

  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      recipient: { id: recipientId },
      message: { text },
    }),
  });

  const data = (await resp.json()) as { error?: { message?: string } };
  if (!resp.ok) {
    logger.error('Abandoned reminder: Instagram send failed', new Error(JSON.stringify(data)), {
      merchantId,
      recipientId,
    });
    return false;
  }
  return true;
}

async function sendTelegram(merchantId: string, chatId: string, text: string): Promise<boolean> {
  const result = await pool.query(
    `SELECT telegram_bot_token
     FROM merchant_settings
     WHERE merchant_id = $1
     LIMIT 1`,
    [merchantId]
  );
  const botToken = result.rows[0]?.telegram_bot_token;
  if (!botToken) {
    logger.warn('Abandoned reminder: no Telegram bot token', { merchantId });
    return false;
  }

  const resp = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
    }),
  });

  const data = (await resp.json()) as { ok?: boolean; description?: string };
  if (!resp.ok || data.ok === false) {
    logger.error('Abandoned reminder: Telegram send failed', new Error(JSON.stringify(data)), {
      merchantId,
      chatId,
    });
    return false;
  }
  return true;
}

async function sendWhatsApp(merchantId: string, to: string, text: string): Promise<boolean> {
  const result = await pool.query(
    `SELECT phone_number_id, access_token
     FROM whatsapp_accounts
     WHERE merchant_id = $1 AND is_verified = true
     ORDER BY updated_at DESC NULLS LAST
     LIMIT 1`,
    [merchantId]
  );
  const row = result.rows[0];
  if (!row?.phone_number_id || !row?.access_token) {
    logger.warn('Abandoned reminder: no WhatsApp credentials', { merchantId });
    return false;
  }

  const resp = await fetch(`https://graph.facebook.com/v21.0/${row.phone_number_id}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${row.access_token}`,
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body: text },
    }),
  });

  if (!resp.ok) {
    const errorData = (await resp.json()) as { error?: { message?: string } };
    logger.error('Abandoned reminder: WhatsApp send failed', new Error(JSON.stringify(errorData)), {
      merchantId,
      to,
    });
    return false;
  }
  return true;
}

function resolvePreferredAccountId(
  sessionMetadata: Record<string, unknown> | null | undefined,
  conversationState: Record<string, unknown> | null | undefined
): string | null {
  const fromSession =
    (sessionMetadata?.channel_account_id as string | undefined) ||
    (sessionMetadata?.pageId as string | undefined) ||
    (sessionMetadata?.page_id as string | undefined);
  if (fromSession) return String(fromSession);

  const binding = conversationState?.channel_binding as
    | { account_id?: string; page_id?: string }
    | undefined;
  if (binding?.account_id) return String(binding.account_id);
  if (binding?.page_id) return String(binding.page_id);
  return null;
}

export async function sendAbandonedReminderOutbound(params: {
  merchantId: string;
  platform: AbandonedCheckoutPlatform;
  userId: string;
  text: string;
  sessionMetadata?: Record<string, unknown> | null;
  conversationState?: Record<string, unknown> | null;
}): Promise<boolean> {
  const preferred = resolvePreferredAccountId(params.sessionMetadata, params.conversationState);

  try {
    switch (params.platform) {
      case 'facebook_messenger':
        return await sendFacebookMessenger(params.merchantId, params.userId, params.text, preferred);
      case 'instagram':
        return await sendInstagram(params.merchantId, params.userId, params.text, preferred);
      case 'telegram':
        return await sendTelegram(params.merchantId, params.userId, params.text);
      case 'whatsapp':
        return await sendWhatsApp(params.merchantId, params.userId, params.text);
      default:
        logger.warn('Abandoned reminder: unsupported platform', {
          platform: params.platform,
          merchantId: params.merchantId,
        });
        return false;
    }
  } catch (error) {
    logger.error('Abandoned reminder: outbound exception', error as Error, {
      merchantId: params.merchantId,
      platform: params.platform,
      userId: params.userId,
    });
    return false;
  }
}
