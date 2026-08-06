/**
 * Outbound presence: typing + mark_seen for linked channels.
 */

import pool from '../../database/connection.js';
import { logger } from '../../utils/logger.js';
import { sendFacebookTyping } from '../channels/facebook.adapter.js';
import { sendTelegramTyping } from '../channels/telegram.adapter.js';
import { publishMerchantInboxEvent } from './inboxRealtime.js';

const GRAPH_VERSION = process.env.FACEBOOK_GRAPH_VERSION || 'v21.0';

function normalizePlatform(platform: string): string {
  const p = (platform || '').toLowerCase().trim();
  if (p === 'facebook' || p === 'messenger') return 'facebook_messenger';
  return p;
}

async function sendMetaSenderAction(params: {
  accessToken: string;
  recipientId: string;
  action: 'typing_on' | 'typing_off' | 'mark_seen';
  pageId?: string | null;
}): Promise<boolean> {
  const base = params.pageId
    ? `https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(params.pageId)}/messages`
    : `https://graph.facebook.com/${GRAPH_VERSION}/me/messages`;
  const url = `${base}?access_token=${encodeURIComponent(params.accessToken)}`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      recipient: { id: params.recipientId },
      sender_action: params.action,
    }),
  });
  return resp.ok;
}

export async function setConversationTyping(params: {
  merchantId: string;
  conversationId: string;
  platform: string;
  recipientUserId: string;
  isTyping: boolean;
}): Promise<{ ok: boolean }> {
  const platform = normalizePlatform(params.platform);
  const { merchantId, recipientUserId, isTyping, conversationId } = params;

  try {
    // Fan-out to other open dashboard sessions for this merchant
    publishMerchantInboxEvent({
      type: 'typing',
      merchantId,
      conversationId,
      platform,
      typing: {
        conversationId,
        isTyping,
        from: 'merchant',
      },
      at: new Date().toISOString(),
    });

    switch (platform) {
      case 'facebook_messenger': {
        const page = await pool.query(
          `SELECT page_id, access_token FROM facebook_pages
           WHERE merchant_id = $1
           ORDER BY updated_at DESC NULLS LAST LIMIT 1`,
          [merchantId]
        );
        if (page.rows.length === 0) return { ok: false };
        await sendFacebookTyping(
          page.rows[0].page_id,
          recipientUserId,
          isTyping,
          page.rows[0].access_token
        );
        return { ok: true };
      }
      case 'instagram': {
        const ig = await pool.query(
          `SELECT access_token, page_id FROM instagram_accounts
           WHERE merchant_id = $1
           ORDER BY updated_at DESC NULLS LAST LIMIT 1`,
          [merchantId]
        );
        if (ig.rows.length === 0) return { ok: false };
        await sendMetaSenderAction({
          accessToken: ig.rows[0].access_token,
          recipientId: recipientUserId,
          action: isTyping ? 'typing_on' : 'typing_off',
          pageId: null,
        });
        return { ok: true };
      }
      case 'telegram': {
        let botToken: string | null = null;
        const bots = await pool.query(
          `SELECT bot_token FROM telegram_bots
           WHERE merchant_id = $1 AND is_active = true
           ORDER BY updated_at DESC NULLS LAST LIMIT 1`,
          [merchantId]
        );
        if (bots.rows.length > 0) botToken = bots.rows[0].bot_token;
        else {
          const settings = await pool.query(
            `SELECT telegram_bot_token FROM merchant_settings WHERE merchant_id = $1 LIMIT 1`,
            [merchantId]
          );
          botToken = settings.rows[0]?.telegram_bot_token || null;
        }
        if (!botToken || !isTyping) return { ok: !!botToken };
        await sendTelegramTyping(recipientUserId, botToken);
        return { ok: true };
      }
      case 'whatsapp': {
        // WhatsApp Cloud API: typing indicator requires message_id of inbound msg in newer APIs.
        // Best-effort no-op if unsupported; still publish local SSE typing.
        return { ok: true };
      }
      default:
        return { ok: true };
    }
  } catch (error) {
    logger.warn('setConversationTyping failed', {
      merchantId,
      conversationId,
      error: error instanceof Error ? error.message : String(error),
    });
    return { ok: false };
  }
}

export async function markConversationSeen(params: {
  merchantId: string;
  conversationId: string;
  platform: string;
  recipientUserId: string;
}): Promise<{ ok: boolean }> {
  const platform = normalizePlatform(params.platform);
  const { merchantId, recipientUserId, conversationId } = params;

  try {
    switch (platform) {
      case 'facebook_messenger': {
        const page = await pool.query(
          `SELECT page_id, access_token FROM facebook_pages
           WHERE merchant_id = $1
           ORDER BY updated_at DESC NULLS LAST LIMIT 1`,
          [merchantId]
        );
        if (page.rows.length === 0) return { ok: false };
        const ok = await sendMetaSenderAction({
          accessToken: page.rows[0].access_token,
          recipientId: recipientUserId,
          action: 'mark_seen',
          pageId: page.rows[0].page_id,
        });
        return { ok };
      }
      case 'instagram': {
        const ig = await pool.query(
          `SELECT access_token FROM instagram_accounts
           WHERE merchant_id = $1
           ORDER BY updated_at DESC NULLS LAST LIMIT 1`,
          [merchantId]
        );
        if (ig.rows.length === 0) return { ok: false };
        const ok = await sendMetaSenderAction({
          accessToken: ig.rows[0].access_token,
          recipientId: recipientUserId,
          action: 'mark_seen',
        });
        return { ok };
      }
      default:
        return { ok: true };
    }
  } catch (error) {
    logger.warn('markConversationSeen failed', {
      merchantId,
      conversationId,
      error: error instanceof Error ? error.message : String(error),
    });
    return { ok: false };
  } finally {
    // Mark inbound user messages as read in DB + notify inbox
    try {
      await pool.query(
        `UPDATE messages
         SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('readAt', to_jsonb($2::text))
         WHERE conversation_id = $1
           AND role = 'user'
           AND (metadata->>'readAt' IS NULL OR metadata->>'readAt' = '')`,
        [conversationId, new Date().toISOString()]
      );
      publishMerchantInboxEvent({
        type: 'read',
        merchantId,
        conversationId,
        platform,
        read: {
          conversationId,
          reader: 'merchant',
          readAt: new Date().toISOString(),
        },
        at: new Date().toISOString(),
      });
    } catch {
      /* ignore */
    }
  }
}
