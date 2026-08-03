/**
 * Facebook Channel Adapter
 * Handles Facebook Messenger webhook events and message sending
 */

import pool from '../../database/connection.js';
import { logger } from '../../utils/logger.js';
import {
  ChannelAdapter,
  ParsedIncomingEvent,
  SendMessageParams,
  TypingIndicatorParams
} from './channel.interface.js';
import { deliverHumanLikeReply } from './replyDelivery.js';

// Extract image URL from response text
const extractImageUrl = (text: string): { imageUrl: string | null; cleanText: string } => {
  const imageRegex = /\[IMAGE:\s*([^\]]+)\]/i;
  const match = text.match(imageRegex);
  
  if (match && match[1]) {
    const imageUrl = match[1].trim();
    const cleanText = text.replace(imageRegex, '').trim();
    return { imageUrl, cleanText };
  }
  
  return { imageUrl: null, cleanText: text };
};

// Send image via Facebook Graph API
export const sendFacebookImage = async (
  pageId: string,
  recipientId: string,
  imageUrl: string,
  caption: string,
  accessToken: string
): Promise<boolean> => {
  try {
    const response = await fetch(`https://graph.facebook.com/v21.0/${pageId}/messages?access_token=${accessToken}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        recipient: { id: recipientId },
        message: {
          attachment: {
            type: 'image',
            payload: {
              url: imageUrl,
              is_reusable: false
            }
          }
        },
        messaging_type: 'RESPONSE'
      })
    });

    const data = await response.json() as { error?: { message?: string; code?: number } };
    
    if (!response.ok) {
      logger.error('Facebook API error sending image', new Error(JSON.stringify(data)), {
        pageId,
        recipientId,
        imageUrl
      });
      return false;
    }

    // If caption is provided and not empty, send it as a separate text message
    if (caption && caption.trim()) {
      await sendFacebookMessage(pageId, recipientId, caption, accessToken);
    }

    return true;
  } catch (error) {
    logger.error('Error sending Facebook image', error as Error, { pageId, recipientId, imageUrl });
    return false;
  }
};

// Send message via Facebook Graph API
export const sendFacebookMessage = async (
  pageId: string,
  recipientId: string,
  message: string,
  accessToken: string
): Promise<boolean> => {
  try {
    const response = await fetch(`https://graph.facebook.com/v21.0/${pageId}/messages?access_token=${accessToken}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        recipient: { id: recipientId },
        message: { text: message },
        messaging_type: 'RESPONSE'
      })
    });

    const data = await response.json() as { error?: { message?: string; code?: number } };
    
    if (!response.ok) {
      logger.error('Facebook API error', new Error(JSON.stringify(data)), { pageId, recipientId });
      return false;
    }

    return true;
  } catch (error) {
    logger.error('Error sending Facebook message', error as Error, { pageId, recipientId });
    return false;
  }
};

/** Messenger typing_on / typing_off */
export const sendFacebookTyping = async (
  pageId: string,
  recipientId: string,
  isTyping: boolean,
  accessToken: string
): Promise<void> => {
  try {
    const response = await fetch(
      `https://graph.facebook.com/v21.0/${encodeURIComponent(pageId)}/messages?access_token=${encodeURIComponent(accessToken)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipient: { id: recipientId },
          sender_action: isTyping ? 'typing_on' : 'typing_off'
        })
      }
    );
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      logger.debug('Facebook typing indicator failed', { pageId, recipientId, data });
    }
  } catch (error) {
    logger.debug('Facebook typing indicator error', {
      error: error instanceof Error ? error.message : String(error),
      pageId,
      recipientId
    });
  }
};

export class FacebookAdapter implements ChannelAdapter {
  /**
   * Parse incoming Facebook webhook event
   */
  async parseIncomingEvent(rawEvent: any): Promise<ParsedIncomingEvent | null> {
    try {
      const pageId = rawEvent.recipient?.id;
      const senderId = rawEvent.sender?.id;
      const messageText = rawEvent.message?.text || '';

      // Extract image / audio attachments if present
      let imageAttachmentUrl: string | undefined;
      let audioAttachmentUrl: string | undefined;
      const attachments = rawEvent.message?.attachments;
      if (Array.isArray(attachments)) {
        const imageAtt = attachments.find((a: any) => a.type === 'image');
        if (imageAtt?.payload?.url) {
          imageAttachmentUrl = imageAtt.payload.url;
        }
        const audioAtt = attachments.find(
          (a: any) =>
            a.type === 'audio' ||
            (a.type === 'file' &&
              /\.(ogg|opus|mp3|m4a|wav|aac)(\?|$)/i.test(String(a.payload?.url || '')))
        );
        if (audioAtt?.payload?.url) {
          audioAttachmentUrl = audioAtt.payload.url;
        }
      }

      if (!pageId || !senderId || (!messageText && !imageAttachmentUrl && !audioAttachmentUrl)) {
        logger.warn('Invalid Facebook message event', { event: rawEvent });
        return null;
      }

      // Find merchant by page ID (SaaS: never fall back to another merchant or hardcoded tokens)
      const merchantResult = await pool.query(
        `SELECT merchant_id, access_token, auto_reply_messenger
         FROM facebook_pages
         WHERE page_id = $1
         ORDER BY updated_at DESC NULLS LAST, created_at DESC
         LIMIT 1`,
        [pageId]
      );

      if (merchantResult.rows.length === 0) {
        logger.warn('No merchant found for Facebook page', { pageId });
        return null;
      }

      const duplicateCheck = await pool.query(
        'SELECT COUNT(*)::int AS c FROM facebook_pages WHERE page_id = $1',
        [pageId]
      );
      if ((duplicateCheck.rows[0]?.c || 0) > 1) {
        logger.warn('Multiple merchants share the same Facebook page_id — using most recently updated row', {
          pageId,
          count: duplicateCheck.rows[0].c
        });
      }

      let merchant_id: string = merchantResult.rows[0].merchant_id;
      let access_token: string = merchantResult.rows[0].access_token;
      let auto_reply_messenger: boolean = merchantResult.rows[0].auto_reply_messenger;

      if (!auto_reply_messenger) {
        // Auto-heal old rows where facebook_pages flag stayed false after OAuth connect.
        // If merchant-level setting allows messenger auto-reply, sync it to facebook_pages.
        const merchantSettings = await pool.query(
          'SELECT auto_reply_messenger FROM merchant_settings WHERE merchant_id = $1',
          [merchant_id]
        );
        const merchantWantsAutoReply = merchantSettings.rows[0]?.auto_reply_messenger === true;

        if (merchantWantsAutoReply) {
          await pool.query(
            'UPDATE facebook_pages SET auto_reply_messenger = true WHERE merchant_id = $1 AND page_id = $2',
            [merchant_id, pageId]
          );
          auto_reply_messenger = true;
          logger.info('Facebook auto-reply flag auto-healed from merchant settings', { pageId, merchant_id });
        }
      }

      if (!auto_reply_messenger) {
        logger.info('Auto-reply disabled for Facebook page', { pageId, merchant_id });
        return null;
      }

      // Comments-only plans: skip Messenger sales bot
      try {
        const { getMerchantPlanLimits } = await import('../../utils/planLimits.js');
        const planLimits = await getMerchantPlanLimits(merchant_id);
        if (!planLimits.hasSalesBot) {
          logger.info('Sales bot not included in plan — skipping Messenger auto-reply', {
            pageId,
            merchant_id
          });
          return null;
        }
      } catch (planErr) {
        logger.warn('Could not check sales bot plan flag', { error: planErr });
      }

      // Get user name if available
      let userName: string | undefined;
      try {
        const userInfoResponse = await fetch(
          `https://graph.facebook.com/v21.0/${senderId}?fields=name,first_name,last_name&access_token=${access_token}`
        );
        const userInfo = await userInfoResponse.json() as { name?: string; first_name?: string; last_name?: string };
        if (userInfo.name || userInfo.first_name) {
          userName = (userInfo.name || `${userInfo.first_name || ''} ${userInfo.last_name || ''}`).trim();
        }
      } catch (error) {
        // Ignore error, userName is optional
        logger.debug('Could not fetch Facebook user name', { error });
      }

      return {
        merchantId: merchant_id,
        platform: 'facebook',
        userId: senderId,
        messageText: messageText || (imageAttachmentUrl ? 'أرسل العميل صورة' : ''),
        externalMessageId: rawEvent.message?.mid,
        userName,
        imageAttachmentUrl,
        audioAttachmentUrl,
        rawEventMetadata: {
          pageId,
          senderId,
          messageId: rawEvent.message?.mid,
          accessToken: access_token
        }
      };
    } catch (error) {
      logger.error('Error parsing Facebook event', error as Error, { event: rawEvent });
      return null;
    }
  }

  /**
   * Send message via Facebook (human-like: typing + delay + optional 2 bubbles)
   */
  async sendMessage(params: SendMessageParams): Promise<boolean> {
    try {
      const { merchantId, userId, text, metadata = {} } = params;

      // Get page ID and access token from metadata or database
      let pageId: string | null = null;
      let accessToken: string | null = null;

      if (metadata.pageId && metadata.accessToken) {
        pageId = metadata.pageId;
        accessToken = metadata.accessToken;
      } else {
        // Get from database
        const result = await pool.query(
          `SELECT page_id, access_token 
           FROM facebook_pages 
           WHERE merchant_id = $1 
           LIMIT 1`,
          [merchantId]
        );

        if (result.rows.length === 0) {
          logger.error('No Facebook page found for merchant', new Error('No Facebook page found'), { merchantId });
          return false;
        }

        pageId = result.rows[0].page_id;
        accessToken = result.rows[0].access_token;
      }

      if (!pageId || !accessToken) {
        logger.error('Missing pageId or accessToken for Facebook', new Error('Missing credentials'), { merchantId, userId });
        return false;
      }

      const resolvedPageId = pageId;
      const resolvedToken = accessToken;

      // Prefer explicit metadata.imageUrl; otherwise extract [IMAGE:] tag
      let imageUrl: string | null =
        typeof metadata.imageUrl === 'string' && metadata.imageUrl.startsWith('http')
          ? metadata.imageUrl
          : null;
      let cleanText = text;
      if (!imageUrl) {
        const extracted = extractImageUrl(text);
        imageUrl = extracted.imageUrl;
        cleanText = extracted.cleanText;
      } else {
        cleanText = extractImageUrl(text).cleanText;
      }

      const result = await deliverHumanLikeReply({
        text: cleanText,
        imageUrl,
        transport: {
          setTyping: (on) => sendFacebookTyping(resolvedPageId, userId, on, resolvedToken),
          sendText: (bubble) => sendFacebookMessage(resolvedPageId, userId, bubble, resolvedToken),
          sendImage: (url, caption) =>
            sendFacebookImage(resolvedPageId, userId, url, caption, resolvedToken)
        },
        context: { merchantId, platform: 'facebook' }
      });

      return result.sent;
    } catch (error) {
      logger.error('Error sending Facebook message', error as Error, {
        merchantId: params.merchantId,
        userId: params.userId
      });
      return false;
    }
  }

  async setTypingIndicator(params: TypingIndicatorParams): Promise<void> {
    const { merchantId, userId, isTyping, metadata = {} } = params;
    let pageId = metadata.pageId as string | undefined;
    let accessToken = metadata.accessToken as string | undefined;

    if (!pageId || !accessToken) {
      const result = await pool.query(
        `SELECT page_id, access_token FROM facebook_pages WHERE merchant_id = $1 LIMIT 1`,
        [merchantId]
      );
      if (result.rows.length === 0) return;
      pageId = result.rows[0].page_id;
      accessToken = result.rows[0].access_token;
    }

    if (!pageId || !accessToken) return;
    await sendFacebookTyping(pageId, userId, isTyping, accessToken);
  }

  /**
   * Get Facebook channel metadata
   */
  async getChannelMetadata(merchantId: string): Promise<Record<string, any>> {
    try {
      const result = await pool.query(
        `SELECT page_id, page_name, access_token, auto_reply_messenger
         FROM facebook_pages 
         WHERE merchant_id = $1 
         LIMIT 1`,
        [merchantId]
      );

      if (result.rows.length === 0) {
        return {};
      }

      return {
        pageId: result.rows[0].page_id,
        pageName: result.rows[0].page_name,
        accessToken: result.rows[0].access_token,
        autoReplyMessenger: result.rows[0].auto_reply_messenger
      };
    } catch (error) {
      logger.error('Error getting Facebook metadata', error as Error, { merchantId });
      return {};
    }
  }
}

// Export singleton instance
export const facebookAdapter = new FacebookAdapter();

