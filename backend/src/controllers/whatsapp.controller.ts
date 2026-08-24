import { Response, NextFunction } from 'express';
import crypto from 'crypto';
import pool from '../database/connection.js';
import { createError } from '../middleware/errorHandler.js';
import { AuthRequest } from '../middleware/auth.js';
import { logger } from '../utils/logger.js';
import type { Message, ConversationState, MerchantConfig } from '../bot/index.js';
import { getCachedMerchantSettings } from '../services/cacheService.js';
import {
  extractImageUrl,
  extractOrderData,
  persistOrderIfPresent,
  runSalesBotTurn,
} from '../services/channels/botTurn.js';
import { buildMerchantBotConfig } from '../services/buildMerchantBotConfig.js';
import {
  downloadAudioBuffer,
  resolveInboundVoice,
  voiceTranscriptionFallbackMessage
} from '../services/voiceTranscription.js';
import { stripInternalControlMarkers } from '../response/sanitize-reply.js';
import {
  deliverHumanLikeReply,
  startTypingKeepalive
} from '../services/channels/replyDelivery.js';
import {
  conversationIngressQueue,
  type IngressBatch
} from '../services/conversationIngressQueue.js';
import { persistInboundImageBuffer, toPublicMediaUrl } from '../services/inbox/messageMedia.js';
import {
  disconnectWhatsAppWeb,
  getWhatsAppWebLiveStatus,
  getWhatsAppWebSession,
  updateWhatsAppWebSettings
} from '../services/whatsappWeb/index.js';

// Verify WhatsApp webhook signature (Meta signs the raw body with the App Secret)
const verifyWhatsAppSignature = (req: any, secret: string): boolean => {
  const signature = req.headers['x-hub-signature-256'];
  if (!signature || typeof signature !== 'string') return false;

  const payloadBuffer: Buffer = req.rawBody
    ? Buffer.isBuffer(req.rawBody)
      ? req.rawBody
      : Buffer.from(String(req.rawBody), 'utf8')
    : Buffer.from(JSON.stringify(req.body ?? {}), 'utf8');

  const expectedSignature = `sha256=${crypto
    .createHmac('sha256', secret)
    .update(payloadBuffer)
    .digest('hex')}`;

  const a = Buffer.from(signature, 'utf8');
  const b = Buffer.from(expectedSignature, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
};

// Get WhatsApp access token for a merchant
const getWhatsAppAccessToken = async (merchantId: string): Promise<string | null> => {
  try {
    const result = await pool.query(
      'SELECT access_token FROM whatsapp_accounts WHERE merchant_id = $1 AND is_verified = true LIMIT 1',
      [merchantId]
    );
    return result.rows[0]?.access_token || null;
  } catch (error) {
    logger.error('Error getting WhatsApp access token', error as Error, { merchantId });
    return null;
  }
};

// Get WhatsApp phone number ID for a merchant
const getWhatsAppPhoneNumberId = async (merchantId: string): Promise<string | null> => {
  try {
    const result = await pool.query(
      'SELECT phone_number_id FROM whatsapp_accounts WHERE merchant_id = $1 AND is_verified = true LIMIT 1',
      [merchantId]
    );
    return result.rows[0]?.phone_number_id || null;
  } catch (error) {
    logger.error('Error getting WhatsApp phone number ID', error as Error, { merchantId });
    return null;
  }
};

/**
 * Resolve WhatsApp Cloud API media id → binary buffer (tenant-scoped via access token).
 */
const downloadWhatsAppMedia = async (
  mediaId: string,
  accessToken: string
): Promise<{ buffer: Buffer; mimeType?: string } | null> => {
  try {
    const metaResp = await fetch(`https://graph.facebook.com/v21.0/${encodeURIComponent(mediaId)}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(15_000)
    });
    if (!metaResp.ok) {
      logger.warn('WhatsApp media metadata fetch failed', { mediaId, status: metaResp.status });
      return null;
    }
    const meta = (await metaResp.json()) as { url?: string; mime_type?: string };
    if (!meta.url) return null;

    return downloadAudioBuffer(meta.url, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
  } catch (error) {
    logger.error('WhatsApp media download error', error as Error, { mediaId });
    return null;
  }
};

// Send image via WhatsApp Business API
const sendWhatsAppImage = async (
  phoneNumberId: string,
  to: string,
  imageUrl: string,
  caption: string,
  accessToken: string
): Promise<boolean> => {
  try {
    const imagePayload: { link: string; caption?: string } = { link: imageUrl };
    const trimmed = (caption || '').trim();
    if (trimmed) {
      imagePayload.caption = trimmed.substring(0, 1024);
    }

    const response = await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: to,
        type: 'image',
        image: imagePayload
      })
    });

    if (!response.ok) {
      const errorData = await response.json() as { error?: { message?: string; code?: number } };
      logger.error('WhatsApp API error sending image', new Error(JSON.stringify(errorData)), {
        phoneNumberId,
        to,
        status: response.status
      });
      return false;
    }

    const data = await response.json() as { messages?: Array<{ id?: string }> };
    logger.info('WhatsApp image sent successfully', { messageId: data.messages?.[0]?.id });
    return true;
  } catch (error) {
    logger.error('Error sending WhatsApp image', error as Error, { phoneNumberId, to, imageUrl });
    return false;
  }
};

// Send message via WhatsApp Business API
const sendWhatsAppMessage = async (
  phoneNumberId: string,
  to: string,
  message: string,
  accessToken: string
): Promise<boolean> => {
  try {
    const response = await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: to,
        type: 'text',
        text: {
          body: message
        }
      })
    });

    if (!response.ok) {
      const errorData = await response.json() as { error?: { message?: string; code?: number } };
      logger.error('WhatsApp API error', new Error(JSON.stringify(errorData)), {
        phoneNumberId,
        to,
        status: response.status
      });
      return false;
    }

    const data = await response.json() as { messages?: Array<{ id?: string }> };
    logger.info('WhatsApp message sent successfully', { messageId: data.messages?.[0]?.id });
    return true;
  } catch (error) {
    logger.error('Error sending WhatsApp message', error as Error, { phoneNumberId, to });
    return false;
  }
};

/**
 * WhatsApp Cloud API typing indicator (requires inbound wamid).
 * @see https://developers.facebook.com/docs/whatsapp/cloud-api/typing-indicators
 */
const sendWhatsAppTyping = async (
  phoneNumberId: string,
  inboundMessageId: string,
  accessToken: string
): Promise<void> => {
  if (!inboundMessageId) return;
  try {
    await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        status: 'read',
        message_id: inboundMessageId,
        typing_indicator: { type: 'text' }
      })
    });
  } catch (error) {
    logger.debug('WhatsApp typing indicator error', {
      error: error instanceof Error ? error.message : String(error),
      phoneNumberId
    });
  }
};

// Connect WhatsApp Business Account
export const connectWhatsApp = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const merchantId = req.merchantId || req.userId;
    if (!merchantId) {
      return next(createError('Unauthorized', 401));
    }

    const {
      phoneNumberId,
      phoneNumber,
      businessAccountId,
      accessToken,
      appId,
      appSecret,
      webhookVerifyToken
    } = req.body;

    if (!phoneNumberId || !phoneNumber || !accessToken) {
      return next(createError('Phone Number ID, Phone Number, and Access Token are required', 400));
    }

    // Check if account already exists
    const existing = await pool.query(
      'SELECT id FROM whatsapp_accounts WHERE merchant_id = $1 AND phone_number_id = $2',
      [merchantId, phoneNumberId]
    );

    if (existing.rows.length > 0) {
      // Update existing account
      await pool.query(
        `UPDATE whatsapp_accounts 
         SET phone_number = $1, business_account_id = $2, access_token = $3, 
             app_id = $4, app_secret = $5, webhook_verify_token = $6,
             is_verified = true, updated_at = CURRENT_TIMESTAMP
         WHERE merchant_id = $7 AND phone_number_id = $8`,
        [phoneNumber, businessAccountId || null, accessToken, appId || null, appSecret || null, webhookVerifyToken || null, merchantId, phoneNumberId]
      );
    } else {
      // Insert new account
      await pool.query(
        `INSERT INTO whatsapp_accounts (
          merchant_id, phone_number_id, phone_number, business_account_id,
          access_token, app_id, app_secret, webhook_verify_token, is_verified
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true)`,
        [merchantId, phoneNumberId, phoneNumber, businessAccountId || null, accessToken, appId || null, appSecret || null, webhookVerifyToken || null]
      );
    }

    res.json({
      success: true,
      message: 'WhatsApp account connected successfully',
      data: {
        phoneNumberId,
        phoneNumber,
        isVerified: true
      }
    });
  } catch (error: any) {
    console.error('Error connecting WhatsApp:', error);
    next(error);
  }
};

// Disconnect WhatsApp
export const disconnectWhatsApp = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const merchantId = req.merchantId || req.userId;
    if (!merchantId) {
      return next(createError('Unauthorized', 401));
    }

    await disconnectWhatsAppWeb(merchantId).catch((error) => {
      logger.error('WhatsApp Web disconnect failed', error as Error, { merchantId });
    });
    await pool.query(
      'DELETE FROM whatsapp_accounts WHERE merchant_id = $1',
      [merchantId]
    );

    res.json({
      success: true,
      message: 'WhatsApp account disconnected successfully'
    });
  } catch (error: any) {
    console.error('Error disconnecting WhatsApp:', error);
    next(error);
  }
};

// Get WhatsApp integration status
export const getWhatsAppStatus = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const merchantId = req.merchantId || req.userId;
    if (!merchantId) {
      return next(createError('Unauthorized', 401));
    }

    const live = getWhatsAppWebLiveStatus(merchantId);
    const webRow = await getWhatsAppWebSession(merchantId);
    const webConnected = live.status === 'connected' || webRow?.status === 'connected';
    if (webConnected || live.status === 'qr' || live.status === 'connecting') {
      const phoneNumber = live.phoneNumber || webRow?.phone_number || null;
      return res.json({
        success: true,
        data: {
          isConnected: webConnected,
          connectionMode: 'web',
          status: live.status,
          phoneNumber,
          autoReplyEnabled: webRow?.auto_reply_enabled === true,
          welcomeMessage: webRow?.welcome_message || null,
          lastSync: webRow?.last_connected_at || null
        }
      });
    }

    const result = await pool.query(
      `SELECT phone_number_id, phone_number, business_account_id, 
              auto_reply_enabled, welcome_message, last_sync, is_verified
       FROM whatsapp_accounts 
       WHERE merchant_id = $1 
       LIMIT 1`,
      [merchantId]
    );

    if (result.rows.length === 0) {
      return res.json({
        success: true,
        data: {
          isConnected: false
        }
      });
    }

    const account = result.rows[0];
    res.json({
      success: true,
      data: {
        isConnected: account.is_verified,
        connectionMode: 'cloud',
        phoneNumber: account.phone_number,
        phoneNumberId: account.phone_number_id,
        businessAccountId: account.business_account_id,
        autoReplyEnabled: account.auto_reply_enabled,
        welcomeMessage: account.welcome_message,
        lastSync: account.last_sync
      }
    });
  } catch (error: any) {
    console.error('Error getting WhatsApp status:', error);
    next(error);
  }
};

// Update WhatsApp settings
export const updateWhatsAppSettings = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const merchantId = req.merchantId || req.userId;
    if (!merchantId) {
      return next(createError('Unauthorized', 401));
    }

    const { autoReplyEnabled, welcomeMessage } = req.body;

    const webUpdated = await updateWhatsAppWebSettings(merchantId, {
      autoReplyEnabled: typeof autoReplyEnabled === 'boolean' ? autoReplyEnabled : undefined,
      welcomeMessage: typeof welcomeMessage === 'string' ? welcomeMessage : undefined
    });
    if (!webUpdated) {
      await pool.query(
        `UPDATE whatsapp_accounts 
         SET auto_reply_enabled = CASE
               WHEN $1::boolean IS NULL THEN auto_reply_enabled
               ELSE $1::boolean
             END,
             welcome_message = CASE
               WHEN $2::text IS NULL THEN welcome_message
               ELSE $2::text
             END,
             updated_at = CURRENT_TIMESTAMP
         WHERE merchant_id = $3::uuid`,
        [
          typeof autoReplyEnabled === 'boolean' ? autoReplyEnabled : null,
          typeof welcomeMessage === 'string' ? welcomeMessage : null,
          merchantId
        ]
      );
    }

    res.json({
      success: true,
      message: 'WhatsApp settings updated successfully'
    });
  } catch (error: any) {
    console.error('Error updating WhatsApp settings:', error);
    next(error);
  }
};

// Webhook verification (GET request)
export const verifyWhatsAppWebhook = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const mode = (req as any).query['hub.mode'];
    const token = (req as any).query['hub.verify_token'];
    const challenge = (req as any).query['hub.challenge'];

    // Multi-tenant: match the submitted token (never pick LIMIT 1 across merchants)
    let matched = false;
    if (typeof token === 'string' && token.length > 0) {
      const result = await pool.query(
        `SELECT 1 FROM whatsapp_accounts
         WHERE is_verified = true
           AND webhook_verify_token IS NOT NULL
           AND webhook_verify_token = $1
         LIMIT 1`,
        [token]
      );
      matched = result.rows.length > 0;
      if (!matched && process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN) {
        matched = token === process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
      }
    }

    if (mode === 'subscribe' && matched) {
      logger.info('WhatsApp webhook verified');
      res.status(200).send(challenge);
    } else {
      logger.warn('WhatsApp webhook verification failed', {
        mode,
        hasToken: typeof token === 'string' && token.length > 0
      });
      res.status(403).send('Forbidden');
    }
  } catch (error: any) {
    console.error('Error verifying WhatsApp webhook:', error);
    next(error);
  }
};

// Handle incoming WhatsApp webhook (POST request)
export const handleWhatsAppWebhook = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const body = (req as any).body;

    // Resolve App Secret: platform env, then per-account secret by phone_number_id
    let appSecret =
      process.env.WHATSAPP_APP_SECRET || process.env.FACEBOOK_APP_SECRET || '';
    const phoneNumberIdForSig =
      body?.entry?.[0]?.changes?.[0]?.value?.metadata?.phone_number_id;
    if (!appSecret && phoneNumberIdForSig) {
      const secretRow = await pool.query(
        `SELECT app_secret FROM whatsapp_accounts
         WHERE phone_number_id = $1 AND app_secret IS NOT NULL AND app_secret != ''
         LIMIT 1`,
        [String(phoneNumberIdForSig)]
      );
      appSecret = secretRow.rows[0]?.app_secret || '';
    }

    if (!appSecret) {
      if (process.env.NODE_ENV === 'production') {
        logger.warn('WhatsApp webhook rejected: app secret not configured');
        return res.status(403).send('Forbidden');
      }
      logger.warn('WhatsApp webhook: no app secret configured (dev allow)');
    } else if (!verifyWhatsAppSignature(req, appSecret)) {
      logger.warn('WhatsApp webhook signature verification failed');
      return res.status(403).send('Forbidden');
    }

    // Acknowledge only after signature checks
    res.status(200).send('OK');
    
    // WhatsApp webhook structure
    if (body.object === 'whatsapp_business_account') {
      const entry = body.entry?.[0];
      
      if (!entry || !entry.changes) {
        return;
      }

      // Process all changes
      for (const change of entry.changes) {
        const value = change.value;
        const metadata = value?.metadata;
        const phoneNumberId = metadata?.phone_number_id;

        // ✅ معالجة Status Updates (مهم جداً!)
        // WhatsApp يرسل status updates عندما يتم إرسال رسالة
        if (change.field === 'statuses') {
          const status = value?.statuses?.[0];
          
          if (status && phoneNumberId) {
            const statusMessageId = status.id;
            const statusType = status.status; // 'sent', 'delivered', 'read', 'failed'
            const recipientId = status.recipient_id;
            
            // ✅ إذا كانت الرسالة status = 'sent' من رقمنا
            // فهذا يعني أن إنسان أرسل رسالة من WhatsApp Business Manager
            if (statusType === 'sent' && recipientId) {
              // البحث عن المحادثة
              const convResult = await pool.query(
                `SELECT c.id, c.merchant_id 
                 FROM conversations c
                 JOIN whatsapp_accounts wa ON wa.merchant_id = c.merchant_id
                 WHERE wa.phone_number_id = $1
                 AND c.platform = 'whatsapp'
                 AND c.user_id = $2
                 ORDER BY c.last_message_at DESC LIMIT 1`,
                [phoneNumberId, recipientId]
              );

              if (convResult.rows.length > 0) {
                const convId = convResult.rows[0].id;
                
                // ✅ التحقق: هل هذه الرسالة موجودة في قاعدة البيانات كرسالة بوت؟
                const existingMsg = await pool.query(
                  `SELECT id, sender_type FROM messages 
                   WHERE conversation_id = $1 
                   AND external_message_id = $2`,
                  [convId, statusMessageId]
                );

                // ✅ إذا لم تكن موجودة، فهي رسالة من إنسان!
                if (existingMsg.rows.length === 0) {
                  // تعطيل البوت لهذه المحادثة
                  await pool.query(
                    `UPDATE conversations 
                     SET bot_disabled = TRUE,
                         status = 'human',
                         last_human_response_at = CURRENT_TIMESTAMP,
                         updated_at = CURRENT_TIMESTAMP
                     WHERE id = $1`,
                    [convId]
                  );

                  logger.info('Human response detected via status update - bot disabled', {
                    conversationId: convId,
                    messageId: statusMessageId,
                    recipientId
                  });
                }
              }
            }
          }
        }

        // ✅ معالجة الرسائل الواردة
        if (change.field === 'messages') {
          const message = value?.messages?.[0];
          const contact = value?.contacts?.[0];
          const metadata = value?.metadata;

          if (message && contact && metadata) {
            const from = message.from;
            const messageId = message.id;
            const messageType = message.type;
            let messageText = message.text?.body || message.image?.caption || message.audio?.caption || '';
            const phoneNumberId = metadata?.phone_number_id;
            const audioMediaId: string | null =
              messageType === 'audio' && message.audio?.id ? String(message.audio.id) : null;
            const imageMediaId: string | null =
              messageType === 'image' && message.image?.id ? String(message.image.id) : null;
            let inboundImageUrl: string | null = null;

            logger.info('Received WhatsApp message', {
              from,
              messageId,
              messageType,
              phoneNumberId,
              hasAudio: !!audioMediaId,
              hasImage: !!imageMediaId
            });

            // Find merchant by phone number ID
            const merchantResult = await pool.query(
            'SELECT merchant_id, auto_reply_enabled, welcome_message FROM whatsapp_accounts WHERE phone_number_id = $1 AND is_verified = true',
            [phoneNumberId]
          );

            if (merchantResult.rows.length === 0) {
              logger.warn('No merchant found for WhatsApp phone number ID', { phoneNumberId });
              continue; // Skip to next change in the loop
            }

            const merchantId = merchantResult.rows[0].merchant_id;
            const autoReplyEnabled = merchantResult.rows[0].auto_reply_enabled;
            const welcomeMessage = merchantResult.rows[0].welcome_message;

            // ==================== INBOUND IMAGE (persist + visual recognition) ====================
            if (imageMediaId) {
              const accessToken = await getWhatsAppAccessToken(merchantId);
              if (accessToken) {
                const media = await downloadWhatsAppMedia(imageMediaId, accessToken);
                if (media?.buffer) {
                  inboundImageUrl = await persistInboundImageBuffer({
                    merchantId,
                    buffer: media.buffer,
                    mimeType: media.mimeType || message.image?.mime_type || 'image/jpeg',
                    source: 'whatsapp',
                  });

                  try {
                    const { analyzeImageAndSearch } = await import('../services/imageRecognition.js');
                    const mime = media.mimeType || message.image?.mime_type || 'image/jpeg';
                    const dataUrl = `data:${mime};base64,${media.buffer.toString('base64')}`;
                    const analysis = await analyzeImageAndSearch(
                      dataUrl,
                      merchantId,
                      messageText && messageText !== '📷 صورة' ? messageText : undefined
                    );
                    if (analysis) {
                      const productList = analysis.products
                        .slice(0, 3)
                        .map((p, i) => `${i + 1}. ${p.name} — ${p.price} ${p.currency || ''}`)
                        .join('\n');
                      if (analysis.products.length > 0) {
                        messageText = `[تحليل صورة العميل: "${analysis.description}" — المنتجات المطابقة في المتجر:\n${productList}]\n${messageText && messageText !== '📷 صورة' ? messageText : 'كم سعر هذا المنتج؟'}`;
                      } else {
                        messageText = `[تحليل صورة العميل: "${analysis.description}" — لم يُعثر على منتج مطابق في المتجر]\n${messageText && messageText !== '📷 صورة' ? messageText : 'كم سعر هذا المنتج؟'}`;
                      }
                      logger.info('WhatsApp image analyzed', {
                        merchantId,
                        method: analysis.matchMethod,
                        products: analysis.products.length
                      });
                    }
                  } catch (imgErr) {
                    logger.error('WhatsApp image analysis failed', imgErr as Error, { merchantId });
                  }
                }
              }
              if (!messageText.trim()) {
                messageText = '📷 صورة';
              }
            }

            // ==================== VOICE TRANSCRIPTION (OpenAI STT) ====================
            if (audioMediaId) {
              const accessToken = await getWhatsAppAccessToken(merchantId);
              if (accessToken) {
                const media = await downloadWhatsAppMedia(audioMediaId, accessToken);
                if (media?.buffer) {
                  const voiceResult = await resolveInboundVoice({
                    merchantId,
                    platform: 'whatsapp',
                    buffer: media.buffer,
                    mimeType: media.mimeType || message.audio?.mime_type || 'audio/ogg',
                    filename: 'whatsapp-voice.ogg',
                    existingText: messageText,
                    languageHint: 'arabic'
                  });
                  messageText = voiceResult.messageText;
                  if (voiceResult.transcribed) {
                    logger.info('WhatsApp voice transcribed', {
                      merchantId,
                      from,
                      transcriptLength: voiceResult.transcript?.text?.length || 0,
                      model: voiceResult.transcript?.model
                    });
                  }
                  if (voiceResult.shouldAbortWithFallback) {
                    await sendWhatsAppMessage(
                      phoneNumberId,
                      from,
                      voiceTranscriptionFallbackMessage('arabic'),
                      accessToken
                    );
                    continue;
                  }
                } else if (!messageText.trim()) {
                  await sendWhatsAppMessage(
                    phoneNumberId,
                    from,
                    voiceTranscriptionFallbackMessage('arabic'),
                    accessToken
                  );
                  continue;
                }
              } else if (!messageText.trim()) {
                logger.warn('WhatsApp voice skipped: missing access token', { merchantId });
                continue;
              }
            }
            // Per-conversation queue: merge rapid messages (4–6s) then process once
            type WaIngressPayload = {
              merchantId: string;
              from: string;
              messageId: string;
              messageText: string;
              phoneNumberId: string;
              contact: any;
              value: any;
              autoReplyEnabled: boolean;
              welcomeMessage: string;
              imageUrl?: string | null;
            };

            const waIngressPayload: WaIngressPayload = {
              merchantId,
              from,
              messageId,
              messageText,
              phoneNumberId,
              contact,
              value,
              autoReplyEnabled,
              welcomeMessage,
              imageUrl: inboundImageUrl,
            };

            conversationIngressQueue
              .enqueue({
                conversationKey: `${merchantId}:whatsapp:${from}`,
                merchantId,
                platform: 'whatsapp',
                text: messageText,
                externalMessageId: messageId,
                payload: waIngressPayload,
                process: async (batch: IngressBatch<WaIngressPayload>) => {
                  const latest = batch.latestPayload;
                  const merchantId = latest.merchantId;
                  const from = latest.from;
                  const phoneNumberId = latest.phoneNumberId;
                  const contact = latest.contact;
                  const value = latest.value;
                  const autoReplyEnabled = latest.autoReplyEnabled;
                  const welcomeMessage = latest.welcomeMessage;
                  const messageText = batch.mergedText || latest.messageText;
                  const messageId =
                    batch.externalMessageIds[batch.externalMessageIds.length - 1] ||
                    latest.messageId;
                  const inboundImageUrl =
                    [...batch.payloads]
                      .reverse()
                      .find((p) => typeof p?.imageUrl === 'string' && p.imageUrl)?.imageUrl ||
                    latest.imageUrl ||
                    null;

              // Get or create conversation (WhatsApp Cloud lookup — unchanged keys)
              let conversationResult = await pool.query(
              `SELECT id, conversation_state, current_intent, stage FROM conversations 
               WHERE merchant_id = $1 
               AND platform = 'whatsapp' 
               AND user_id = $2
               ORDER BY created_at DESC
               LIMIT 1`,
                [merchantId, from]
              );

              let conversationId: string;
              let conversationState: ConversationState = { message_count: 0 };
              if (conversationResult.rows.length === 0) {
                // Create new conversation
                const newConversation = await pool.query(
                  `INSERT INTO conversations (merchant_id, platform, user_id, user_name, last_message_at)
                   VALUES ($1, 'whatsapp', $2, $3, CURRENT_TIMESTAMP)
                   RETURNING id`,
                  [merchantId, from, contact.profile?.name || from]
                );
                conversationId = newConversation.rows[0].id;

                // Send welcome message if enabled
                if (welcomeMessage && autoReplyEnabled) {
                  await sendWhatsAppMessage(
                    phoneNumberId,
                    from,
                    welcomeMessage,
                    await getWhatsAppAccessToken(merchantId) || ''
                  );
                }
              } else {
                conversationId = conversationResult.rows[0].id;
                conversationState = conversationResult.rows[0].conversation_state || { message_count: 0 };
                if (conversationResult.rows[0].current_intent) {
                  conversationState.last_intent = conversationResult.rows[0].current_intent;
                }
              
                // Update last message time
                await pool.query(
                  'UPDATE conversations SET last_message_at = CURRENT_TIMESTAMP WHERE id = $1',
                  [conversationId]
                );
              }

              // ✅ فحص حالة المحادثة لمنع التضارب
              const convStatus = await pool.query(
                `SELECT bot_disabled, last_human_response_at, last_bot_response_at, status
                 FROM conversations WHERE id = $1`,
                [conversationId]
              );

              const conv = convStatus.rows[0] || { bot_disabled: false, status: 'bot' };

              // ✅ فحص آخر رسالة في المحادثة
              const lastMessageCheck = await pool.query(
                `SELECT sender_type, created_at, external_message_id
                 FROM messages 
                 WHERE conversation_id = $1 
                 ORDER BY created_at DESC 
                 LIMIT 1`,
                [conversationId]
              );

              let shouldSkipBotReply = false;
              let skipReason = '';

              // ✅ منطق منع التضارب:
              // 1. إذا كان البوت معطل لهذه المحادثة
              if (conv.bot_disabled || conv.status === 'human') {
                shouldSkipBotReply = true;
                skipReason = 'Bot disabled or conversation assigned to human';
              }
              // 2. إذا كانت آخر رسالة من إنسان خلال آخر 5 دقائق
              else if (lastMessageCheck.rows.length > 0) {
                const lastMsg = lastMessageCheck.rows[0];
              
                if (lastMsg.sender_type === 'human') {
                  const lastMsgTime = new Date(lastMsg.created_at);
                  const now = new Date();
                  const minutesSinceHuman = (now.getTime() - lastMsgTime.getTime()) / (1000 * 60);
                
                  if (minutesSinceHuman < 5) {
                    shouldSkipBotReply = true;
                    skipReason = `Recent human response (${Math.round(minutesSinceHuman)} minutes ago)`;
                  }
                }
              }

              const cachedSettings = await getCachedMerchantSettings(merchantId);

              if (!autoReplyEnabled || shouldSkipBotReply) {
              await pool.query(
                `INSERT INTO messages (conversation_id, role, content, sender_type, external_message_id, source, metadata)
                 VALUES ($1, 'user', $2, 'user', $3, 'whatsapp', $4::jsonb)`,
                [
                  conversationId,
                  messageText || (inboundImageUrl ? '📷 صورة' : ''),
                  messageId,
                  JSON.stringify({
                    platform: 'whatsapp',
                    ...(inboundImageUrl
                      ? { type: 'image', imageUrl: toPublicMediaUrl(inboundImageUrl) }
                      : { type: 'text' }),
                  }),
                ]
              );

                if (shouldSkipBotReply) {
                  logger.info('Bot reply skipped', {
                    conversationId,
                    reason: skipReason,
                    merchantId
                  });
                }
              } else if (messageText.trim() || inboundImageUrl) {
                try {
                  const { getMerchantPlanLimits, getMonthlyAIResponseCount, isWithinLimit } = await import('../utils/planLimits.js');
                  const limits = await getMerchantPlanLimits(merchantId);
                  const currentCount = await getMonthlyAIResponseCount(merchantId);

                  if (!limits.hasSalesBot) {
                    logger.info('Sales bot not included in plan — skipping WhatsApp auto-reply', { merchantId });
                  } else if (!isWithinLimit(currentCount, limits.maxMonthlyAIResponses)) {
                    logger.warn('AI response limit exceeded for WhatsApp', {
                      merchantId,
                      currentCount,
                      limit: limits.maxMonthlyAIResponses
                    });
                  } else {
                    const recentMessagesResult = await pool.query(
                      `SELECT role, content FROM messages
                       WHERE conversation_id = $1
                       ORDER BY created_at DESC
                       LIMIT 25`,
                      [conversationId]
                    );
                    const recentMessages: Message[] = recentMessagesResult.rows
                      .reverse()
                      .map((row: { role: string; content: string }) => ({
                        role: row.role as 'user' | 'assistant',
                        content: row.content
                      }));

                    const merchantConfig: Partial<MerchantConfig> = buildMerchantBotConfig({
                      merchantId,
                      settings: cachedSettings || {},
                    });

                    const accessTokenForTyping = await getWhatsAppAccessToken(merchantId);
                    const phoneNumberIdForTyping = await getWhatsAppPhoneNumberId(merchantId);
                    const stopTypingKeepalive =
                      accessTokenForTyping && phoneNumberIdForTyping && messageId
                        ? startTypingKeepalive(() =>
                            sendWhatsAppTyping(phoneNumberIdForTyping, messageId, accessTokenForTyping)
                          )
                        : () => undefined;

                    let responseText = '';
                    let updatedState: ConversationState = conversationState;
                    let turnFailed = false;

                    try {
                      const turn = await runSalesBotTurn({
                        merchantId,
                        platform: 'whatsapp',
                        escalatePlatform: 'whatsapp',
                        userId: from,
                        userName: contact.profile?.name || from,
                        messageText,
                        externalMessageId: messageId,
                        recentMessages,
                        conversationState,
                        merchantConfig,
                        conversationId,
                        storeCurrency: cachedSettings?.store_currency || 'USD',
                        channelLabel: 'WhatsApp Cloud',
                        pool,
                        userMessageMetadata: inboundImageUrl
                          ? { type: 'image', imageUrl: toPublicMediaUrl(inboundImageUrl) }
                          : { type: 'text' },
                      });

                      responseText = turn.responseText;
                      updatedState = turn.updatedState;
                      turnFailed = turn.failed;

                      if (turn.failed) {
                        logger.error('Error processing WhatsApp auto-reply', new Error('SalesGPT turn failed'), {
                          merchantId,
                          conversationId,
                        });
                      } else {
                        logger.info('WhatsApp Cloud message processed via SalesGPT', {
                          merchantId,
                          conversationId,
                          pipelineUsed: turn.meta.pipelineUsed,
                          aiCallsCount: turn.meta.aiCallsCount,
                          processingTimeMs: turn.meta.processingTimeMs,
                        });
                      }
                    } finally {
                      stopTypingKeepalive();
                    }

                    if (!turnFailed) {
                    const { orderData, cleanText: responseWithoutOrderData } = extractOrderData(responseText);
                    const { imageUrl, cleanText } = extractImageUrl(responseWithoutOrderData);

                    if (orderData) {
                      logger.info('ORDER_DATA detected from WhatsApp, processing order', {
                        merchantId,
                        customerName: orderData.customerName,
                        productsCount: orderData.products?.length || 0
                      });

                      await persistOrderIfPresent({
                        pool,
                        merchantId,
                        conversationId,
                        orderData,
                        settings: { store_currency: cachedSettings?.store_currency || 'USD' },
                        labels: {
                          defaultBaseNotes: 'Order created via WhatsApp bot',
                          customerTags: ['bot-order', 'whatsapp'],
                          interactionTitle: 'Order Created via WhatsApp Bot',
                          interactionDescription: (orderId: string) => `Order #${orderId} created via WhatsApp bot`,
                          interactionPlatform: 'whatsapp',
                          logPrefix: 'processWhatsAppCloudMessage'
                        },
                        updatedState,
                      });
                    }

                    await pool.query(
                      `UPDATE conversations
                       SET last_bot_response_at = CURRENT_TIMESTAMP
                       WHERE id = $1 AND merchant_id = $2`,
                      [conversationId, merchantId]
                    );

                    const accessToken = accessTokenForTyping || (await getWhatsAppAccessToken(merchantId));
                    const phoneNumberIdForReply =
                      phoneNumberIdForTyping || (await getWhatsAppPhoneNumberId(merchantId));
                  
                    if (accessToken && phoneNumberIdForReply) {
                      const outboundText = stripInternalControlMarkers(cleanText || responseText);
                      const hasImage = !!(imageUrl && imageUrl !== 'N/A' && imageUrl.startsWith('http'));
                      if (outboundText.trim() || hasImage) {
                        await deliverHumanLikeReply({
                          text: outboundText,
                          imageUrl: hasImage ? imageUrl : null,
                          transport: {
                            setTyping: async (on) => {
                              if (on && messageId) {
                                await sendWhatsAppTyping(phoneNumberIdForReply, messageId, accessToken);
                              }
                            },
                            sendText: (bubble) =>
                              sendWhatsAppMessage(phoneNumberIdForReply, from, bubble, accessToken),
                            sendImage: (url, caption) =>
                              sendWhatsAppImage(
                                phoneNumberIdForReply,
                                from,
                                url,
                                caption,
                                accessToken
                              )
                          },
                          context: { merchantId, platform: 'whatsapp', conversationId }
                        });
                      }
                    }
                    }
                  }
                } catch (error: any) {
                  logger.error('Error processing WhatsApp auto-reply', error, { merchantId, conversationId });
                }
              }
                }
              })
              .catch((error) => {
                logger.error('Error processing WhatsApp ingress batch', error as Error, {
                  merchantId,
                  from
                });
              });

          }
        }
      }
    }
  } catch (error: any) {
    logger.error('Error handling WhatsApp webhook', error);
    // Don't send error response as we already sent 200 OK
  }
};

