/**
 * Merchant inbox — outbound human reply to channel users.
 * SaaS-safe: always resolves credentials by merchant_id + conversation ownership.
 */

import pool from '../../database/connection.js';
import { logger } from '../../utils/logger.js';
import {
  sendFacebookMessage,
  sendFacebookTyping,
  sendFacebookImage,
} from '../channels/facebook.adapter.js';
import { sendTelegramMessage, sendTelegramPhoto } from '../channels/telegram.adapter.js';
import { toPublicMediaUrl } from './messageMedia.js';

export type InboxPlatform =
  | 'facebook_messenger'
  | 'instagram'
  | 'telegram'
  | 'whatsapp'
  | 'web'
  | string;

export type SendMerchantReplyInput = {
  merchantId: string;
  conversationId: string;
  platform: InboxPlatform;
  recipientUserId: string;
  text?: string;
  imageUrl?: string | null;
};

export type SendMerchantReplyResult = {
  delivered: boolean;
  source: string;
  errorCode?: string;
  errorMessage?: string;
};

const GRAPH_VERSION = process.env.FACEBOOK_GRAPH_VERSION || 'v21.0';

function normalizePlatform(platform: string): string {
  const p = (platform || '').toLowerCase().trim();
  if (p === 'facebook' || p === 'messenger') return 'facebook_messenger';
  return p;
}

async function sendInstagramDm(
  recipientId: string,
  message: { text?: string; imageUrl?: string | null },
  accessToken: string
): Promise<{ ok: boolean; errorMessage?: string }> {
  const url =
    `https://graph.facebook.com/${GRAPH_VERSION}/me/messages` +
    `?access_token=${encodeURIComponent(accessToken)}`;

  if (message.imageUrl) {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipient: { id: recipientId },
        message: {
          attachment: {
            type: 'image',
            payload: { url: message.imageUrl, is_reusable: false },
          },
        },
        messaging_type: 'RESPONSE',
      }),
    });
    const data = (await resp.json()) as { error?: { message?: string } };
    if (!resp.ok) {
      return { ok: false, errorMessage: data.error?.message || 'Instagram image send failed' };
    }
    if (message.text?.trim()) {
      return sendInstagramDm(recipientId, { text: message.text.trim() }, accessToken);
    }
    return { ok: true };
  }

  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      recipient: { id: recipientId },
      message: { text: message.text || '' },
      messaging_type: 'RESPONSE',
    }),
  });
  const data = (await resp.json()) as { error?: { message?: string; code?: number } };
  if (!resp.ok) {
    return { ok: false, errorMessage: data.error?.message || 'Instagram send failed' };
  }
  return { ok: true };
}

async function sendWhatsAppPayload(params: {
  phoneNumberId: string;
  to: string;
  text?: string;
  imageUrl?: string | null;
  accessToken: string;
}): Promise<{ ok: boolean; errorMessage?: string }> {
  const body: Record<string, unknown> = {
    messaging_product: 'whatsapp',
    to: params.to,
  };

  if (params.imageUrl) {
    body.type = 'image';
    body.image = {
      link: params.imageUrl,
      ...(params.text?.trim() ? { caption: params.text.trim().slice(0, 1024) } : {}),
    };
  } else {
    body.type = 'text';
    body.text = { body: params.text || '' };
  }

  const resp = await fetch(
    `https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(params.phoneNumberId)}/messages`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${params.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    }
  );
  const data = (await resp.json()) as { error?: { message?: string } };
  if (!resp.ok) {
    return { ok: false, errorMessage: data.error?.message || 'WhatsApp send failed' };
  }
  return { ok: true };
}

/**
 * Deliver a merchant (human) reply on the correct channel.
 * Does not write to DB — caller owns persistence + human takeover flags.
 */
export async function sendMerchantReply(
  input: SendMerchantReplyInput
): Promise<SendMerchantReplyResult> {
  const merchantId = input.merchantId;
  const recipientUserId = String(input.recipientUserId || '').trim();
  const text = String(input.text || '').trim();
  const imageUrl = toPublicMediaUrl(input.imageUrl || null);
  const platform = normalizePlatform(input.platform);

  if (!merchantId || !recipientUserId || (!text && !imageUrl)) {
    return {
      delivered: false,
      source: 'invalid',
      errorCode: 'INVALID_INPUT',
      errorMessage: 'Missing merchant, recipient, or message content',
    };
  }

  try {
    switch (platform) {
      case 'facebook_messenger': {
        const page = await pool.query(
          `SELECT page_id, access_token
           FROM facebook_pages
           WHERE merchant_id = $1
           ORDER BY updated_at DESC NULLS LAST, created_at DESC
           LIMIT 1`,
          [merchantId]
        );
        if (page.rows.length === 0) {
          return {
            delivered: false,
            source: 'facebook_inbox',
            errorCode: 'CHANNEL_NOT_LINKED',
            errorMessage: 'لا توجد صفحة فيسبوك مربوطة',
          };
        }
        const { page_id: pageId, access_token: accessToken } = page.rows[0];
        try {
          await sendFacebookTyping(pageId, recipientUserId, true, accessToken);
        } catch {
          /* non-fatal */
        }

        let ok = false;
        if (imageUrl) {
          ok = await sendFacebookImage(pageId, recipientUserId, imageUrl, text, accessToken);
        } else {
          ok = await sendFacebookMessage(pageId, recipientUserId, text, accessToken);
        }

        try {
          await sendFacebookTyping(pageId, recipientUserId, false, accessToken);
        } catch {
          /* non-fatal */
        }
        return ok
          ? { delivered: true, source: 'facebook_inbox' }
          : {
              delivered: false,
              source: 'facebook_inbox',
              errorCode: 'SEND_FAILED',
              errorMessage:
                'فشل إرسال الرسالة عبر فيسبوك. قد تكون نافذة الـ 24 ساعة منتهية.',
            };
      }

      case 'instagram': {
        const ig = await pool.query(
          `SELECT access_token, page_id, ig_username
           FROM instagram_accounts
           WHERE merchant_id = $1
           ORDER BY updated_at DESC NULLS LAST, created_at DESC
           LIMIT 1`,
          [merchantId]
        );
        if (ig.rows.length === 0) {
          return {
            delivered: false,
            source: 'instagram_inbox',
            errorCode: 'CHANNEL_NOT_LINKED',
            errorMessage: 'لا يوجد حساب إنستغرام مربوط',
          };
        }
        const accessToken = ig.rows[0].access_token as string;
        const result = await sendInstagramDm(
          recipientUserId,
          { text, imageUrl },
          accessToken
        );
        return result.ok
          ? { delivered: true, source: 'instagram_inbox' }
          : {
              delivered: false,
              source: 'instagram_inbox',
              errorCode: 'SEND_FAILED',
              errorMessage:
                result.errorMessage ||
                'فشل إرسال الرسالة عبر إنستغرام. قد تكون نافذة المراسلة منتهية.',
            };
      }

      case 'telegram': {
        let botToken: string | null = null;
        const bots = await pool.query(
          `SELECT bot_token FROM telegram_bots
           WHERE merchant_id = $1 AND is_active = true
           ORDER BY updated_at DESC NULLS LAST, created_at DESC
           LIMIT 1`,
          [merchantId]
        );
        if (bots.rows.length > 0) {
          botToken = bots.rows[0].bot_token;
        } else {
          const settings = await pool.query(
            `SELECT telegram_bot_token FROM merchant_settings WHERE merchant_id = $1 LIMIT 1`,
            [merchantId]
          );
          botToken = settings.rows[0]?.telegram_bot_token || null;
        }
        if (!botToken) {
          return {
            delivered: false,
            source: 'telegram_manager',
            errorCode: 'CHANNEL_NOT_LINKED',
            errorMessage: 'لا يوجد بوت تيليجرام مربوط',
          };
        }
        let ok = false;
        if (imageUrl) {
          ok = await sendTelegramPhoto(recipientUserId, imageUrl, text || '', botToken);
        } else {
          ok = await sendTelegramMessage(recipientUserId, text, botToken);
        }
        return ok
          ? { delivered: true, source: 'telegram_manager' }
          : {
              delivered: false,
              source: 'telegram_manager',
              errorCode: 'SEND_FAILED',
              errorMessage: 'فشل إرسال الرسالة عبر تيليجرام',
            };
      }

      case 'whatsapp': {
        const wa = await pool.query(
          `SELECT phone_number_id, access_token
           FROM whatsapp_accounts
           WHERE merchant_id = $1 AND is_verified = true
           ORDER BY updated_at DESC NULLS LAST, created_at DESC
           LIMIT 1`,
          [merchantId]
        );
        if (wa.rows.length === 0) {
          return {
            delivered: false,
            source: 'whatsapp_manager',
            errorCode: 'CHANNEL_NOT_LINKED',
            errorMessage: 'لا يوجد حساب واتساب مربوط',
          };
        }
        const { phone_number_id: phoneNumberId, access_token: accessToken } = wa.rows[0];
        const result = await sendWhatsAppPayload({
          phoneNumberId,
          to: recipientUserId,
          text,
          imageUrl,
          accessToken,
        });
        return result.ok
          ? { delivered: true, source: 'whatsapp_manager' }
          : {
              delivered: false,
              source: 'whatsapp_manager',
              errorCode: 'SEND_FAILED',
              errorMessage: result.errorMessage || 'فشل إرسال الرسالة عبر واتساب',
            };
      }

      case 'web':
        return { delivered: true, source: 'web_inbox' };

      default:
        return {
          delivered: false,
          source: 'unknown',
          errorCode: 'UNSUPPORTED_PLATFORM',
          errorMessage: `المنصة غير مدعومة للرد: ${platform}`,
        };
    }
  } catch (error) {
    logger.error('sendMerchantReply failed', error as Error, {
      merchantId,
      conversationId: input.conversationId,
      platform,
    });
    return {
      delivered: false,
      source: platform,
      errorCode: 'EXCEPTION',
      errorMessage: error instanceof Error ? error.message : 'Unexpected send error',
    };
  }
}

export function inboxSourceForPlatform(platform: string): string {
  switch (normalizePlatform(platform)) {
    case 'facebook_messenger':
      return 'facebook_inbox';
    case 'instagram':
      return 'instagram_inbox';
    case 'telegram':
      return 'telegram_manager';
    case 'whatsapp':
      return 'whatsapp_manager';
    case 'web':
      return 'web_inbox';
    default:
      return 'merchant_inbox';
  }
}
