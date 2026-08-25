import { Response, NextFunction } from 'express';
import crypto from 'crypto';
import pool from '../database/connection.js';
import { createError } from '../middleware/errorHandler.js';
import { AuthRequest } from '../middleware/auth.js';
import { logger } from '../utils/logger.js';
// ✅ النظام الجديد - Modular Architecture v2.0
import type { Message, ConversationState, MerchantConfig } from '../bot/index.js';
import { stripInternalControlMarkers } from '../response/sanitize-reply.js';
import { buildMerchantBotConfig } from '../services/buildMerchantBotConfig.js';
import {
  extractImageUrl,
  extractOrderData,
  persistOrderIfPresent,
  runSalesBotTurn,
} from '../services/channels/botTurn.js';
import { telegramAdapter, sendTelegramTyping } from '../services/channels/telegram.adapter.js';
import { startTypingKeepalive } from '../services/channels/replyDelivery.js';
import {
  conversationIngressQueue,
  mergeTelegramUpdates
} from '../services/conversationIngressQueue.js';
import { analyzeImageAndSearch, imageUrlToBase64 } from '../services/imageRecognition.js';
import {
  resolveInboundVoice,
  voiceTranscriptionFallbackMessage
} from '../services/voiceTranscription.js';
import { getCurrencyDisplayName } from '../utils/currencyDisplayName.js';
import { bindConversationChannelAccount } from '../services/socialProfile.js';
import {
  clearMerchantChannelConversations,
  hasRemainingChannelAccount,
} from '../services/metaConversationCleanup.js';

// Verify Telegram webhook secret (required — empty secret rejects)
const verifyTelegramSecret = (req: any, secret: string): boolean => {
  if (!secret) return false;
  const receivedSecret = req.headers['x-telegram-bot-api-secret-token'];
  if (typeof receivedSecret !== 'string' || !receivedSecret) return false;
  const a = Buffer.from(receivedSecret, 'utf8');
  const b = Buffer.from(secret, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
};

// Send photo via Telegram Bot API
const sendTelegramPhoto = async (chatId: string, photoUrl: string, caption: string, botToken: string): Promise<boolean> => {
  try {
    const response = await fetch(`https://api.telegram.org/bot${botToken}/sendPhoto`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        chat_id: chatId,
        photo: photoUrl,
        caption: caption.substring(0, 1024), // Telegram caption limit is 1024 characters
        parse_mode: 'HTML'
      })
    });

    const data = await response.json() as { ok?: boolean; error_code?: number; description?: string };
    
    if (!response.ok) {
      logger.error('Telegram API error sending photo', new Error(JSON.stringify(data)), { chatId, photoUrl });
      return false;
    }

    return true;
  } catch (error) {
    logger.error('Error sending Telegram photo', error as Error, { chatId, photoUrl });
    return false;
  }
};

// Send message via Telegram Bot API
const sendTelegramMessage = async (chatId: string, message: string, botToken: string): Promise<boolean> => {
  try {
    const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: 'HTML'
      })
    });

    const data = await response.json() as { ok?: boolean; error_code?: number; description?: string };
    
    if (!response.ok) {
      logger.error('Telegram API error', new Error(JSON.stringify(data)), { chatId });
      return false;
    }

    return true;
  } catch (error) {
    logger.error('Error sending Telegram message', error as Error, { chatId });
    return false;
  }
};

// Get bot info from Telegram API
const getTelegramBotInfo = async (botToken: string): Promise<{ username: string; id: number; first_name: string } | null> => {
  try {
    const response = await fetch(`https://api.telegram.org/bot${botToken}/getMe`);
    const data = await response.json() as { ok: boolean; result?: { username?: string; id: number; first_name?: string } };
    
    if (data.ok && data.result) {
      return {
        username: data.result.username || '',
        id: data.result.id,
        first_name: data.result.first_name || ''
      };
    }
    return null;
  } catch (error) {
    logger.error('Error getting Telegram bot info', error as Error);
    return null;
  }
};

// Import cache service for rate limiting
import { checkRateLimit, getCachedMerchantSettings } from '../services/cacheService.js';

// Helper: get a public URL for a Telegram photo file_id
const getTelegramFileUrl = async (fileId: string, botToken: string): Promise<string | null> => {
  try {
    const resp = await fetch(`https://api.telegram.org/bot${botToken}/getFile?file_id=${fileId}`);
    const data = await resp.json() as { ok?: boolean; result?: { file_path?: string } };
    if (data.ok && data.result?.file_path) {
      return `https://api.telegram.org/file/bot${botToken}/${data.result.file_path}`;
    }
    return null;
  } catch {
    return null;
  }
};

// Process Telegram message
const processTelegramMessage = async (update: any) => {
  try {
    const message = update.message;
    const hasText = !!message?.text;
    const hasPhoto = Array.isArray(message?.photo) && message.photo.length > 0;
    const hasCaption = !!message?.caption;
    const voiceFileId: string | null = message?.voice?.file_id || null;
    const audioFileId: string | null = message?.audio?.file_id || null;
    const videoNoteFileId: string | null = message?.video_note?.file_id || null;
    const hasVoice = !!(voiceFileId || audioFileId || videoNoteFileId);

    if (!message || (!hasText && !hasPhoto && !hasVoice)) {
      logger.debug('Telegram message without text/photo/voice', {
        hasMessage: !!message,
        hasText,
        hasPhoto,
        hasVoice,
        updateKeys: Object.keys(update || {})
      });
      return;
    }

    const chatId = message.chat.id.toString();
    const userId = message.from.id.toString();
    const userName = message.from.first_name || 'Unknown User';
    let messageText = (message.text || message.caption || '').trim();
    const photoFileId: string | null = hasPhoto
      ? message.photo[message.photo.length - 1].file_id
      : null;
    const telegramAudioFileId = voiceFileId || audioFileId || videoNoteFileId;

    // Empty text is OK when the customer sent a photo or voice note
    // (media is resolved after we load the bot token below).
    if ((!messageText || messageText.length < 1) && !hasPhoto && !hasVoice) {
      logger.debug('Ignoring empty message', { userId });
      return;
    }

    // Get merchant ID early for rate limiting
    const merchantId: string | null = (update as any).merchantId || null;
    
    // ==================== RATE LIMITING ====================
    // Check rate limit before processing (20 messages per minute per user)
    if (merchantId && !checkRateLimit(userId, merchantId)) {
      logger.warn('User rate limited', { userId, merchantId });
      // Don't send error message to avoid spam
      return;
    }

    logger.info('Processing Telegram message', {
      chatId,
      userId,
      messageLength: messageText.length,
    });

    // ✅ SaaS: Merchant ID and bot info should be passed from webhook handler (set by telegramWebhook)
    // merchantId already extracted above for rate limiting
    const botId: string | null = (update as any).botId || null;
    const configuredBotType: string | null = (update as any).botType || null; // 'products', 'services', 'both'
    let botToken: string | null = null;
    let settings: any = null;

    if (!merchantId) {
      logger.error('Merchant ID not provided to processTelegramMessage', new Error('Merchant ID missing'), {
        chatId,
        userId,
        updateKeys: Object.keys(update || {})
      });
      return;
    }

    // ✅ SaaS: Get bot token and merchant settings
    if (botId) {
      // New approach: Get bot token from telegram_bots table
      const botResult = await pool.query(
        `SELECT bot_token FROM telegram_bots WHERE id = $1 AND merchant_id = $2 AND is_active = true`,
        [botId, merchantId]
      );

      if (botResult.rows.length === 0) {
        logger.warn('Telegram bot not found or inactive', { merchantId, botId });
        return;
      }

      botToken = botResult.rows[0].bot_token;
    } else {
      // Legacy approach: Get bot token from merchant_settings
      const settingsResult = await pool.query(
        `SELECT telegram_bot_token FROM merchant_settings WHERE merchant_id = $1`,
        [merchantId]
      );

      if (settingsResult.rows.length === 0 || !settingsResult.rows[0].telegram_bot_token) {
        logger.warn('Telegram bot token not found for merchant', { merchantId });
        return;
      }

      botToken = settingsResult.rows[0].telegram_bot_token;
    }

    // Get merchant settings (with caching for better performance)
    const cachedSettings = await getCachedMerchantSettings(merchantId);
    
    if (!cachedSettings) {
      logger.warn('Merchant settings not found', { merchantId });
      return;
    }

    settings = {
      store_name: cachedSettings.store_name,
      store_currency: cachedSettings.store_currency,
      system_prompt: cachedSettings.system_prompt,
      bot_persona: cachedSettings.bot_persona,
      shipping_policy: cachedSettings.shipping_policy,
      delivery_time: cachedSettings.delivery_time,
      payment_methods: cachedSettings.payment_methods,
      return_policy: cachedSettings.return_policy,
      additional_notes: cachedSettings.additional_notes,
      enable_ai_injection: cachedSettings.enable_ai_injection
    };

    // ==================== VOICE TRANSCRIPTION (OpenAI STT) ====================
    if (telegramAudioFileId && botToken) {
      const fileUrl = await getTelegramFileUrl(telegramAudioFileId, botToken);
      if (fileUrl) {
        const voiceResult = await resolveInboundVoice({
          merchantId,
          platform: 'telegram',
          url: fileUrl,
          existingText: messageText,
          filename: message.voice
            ? 'voice.ogg'
            : message.video_note
              ? 'video_note.mp4'
              : (message.audio?.file_name || 'audio.ogg'),
          mimeType: message.voice
            ? 'audio/ogg'
            : message.video_note
              ? 'video/mp4'
              : (message.audio?.mime_type || undefined),
          languageHint: 'arabic'
        });
        messageText = voiceResult.messageText;
        if (voiceResult.transcribed) {
          logger.info('Telegram voice transcribed', {
            merchantId,
            userId,
            transcriptLength: voiceResult.transcript?.text?.length || 0,
            model: voiceResult.transcript?.model,
            durationSec: voiceResult.transcript?.durationSec
          });
        }
        if (voiceResult.shouldAbortWithFallback) {
          await sendTelegramMessage(
            chatId,
            voiceTranscriptionFallbackMessage('arabic'),
            botToken
          );
          return;
        }
      } else if (!messageText || !messageText.trim()) {
        await sendTelegramMessage(
          chatId,
          voiceTranscriptionFallbackMessage('arabic'),
          botToken
        );
        return;
      }
    }

    // ==================== IMAGE RECOGNITION ====================
    let inboundImageUrl: string | null = null;
    if (photoFileId && botToken) {
      const fileUrl = await getTelegramFileUrl(photoFileId, botToken);
      if (fileUrl) {
        // Persist under merchant uploads — never store bot-token URLs in DB (SaaS secret leak).
        try {
          const imgResp = await fetch(fileUrl, { signal: AbortSignal.timeout(20_000) });
          if (imgResp.ok) {
            const buf = Buffer.from(await imgResp.arrayBuffer());
            const mimeType = imgResp.headers.get('content-type') || 'image/jpeg';
            const { persistInboundImageBuffer } = await import('../services/inbox/messageMedia.js');
            inboundImageUrl = await persistInboundImageBuffer({
              merchantId,
              buffer: buf,
              mimeType,
              source: 'telegram',
            });
          }
        } catch (persistErr) {
          logger.warn('Telegram inbound image persist failed', {
            merchantId,
            error: persistErr instanceof Error ? persistErr.message : String(persistErr),
          });
        }

        const dataUrl = await imageUrlToBase64(fileUrl);
        if (dataUrl) {
          const analysis = await analyzeImageAndSearch(
            dataUrl,
            merchantId,
            messageText || undefined,
            settings.store_currency
          );
          if (analysis) {
            const productList = analysis.products
              .slice(0, 3)
              .map((p, i) => {
                const code = p.currency || settings.store_currency;
                return `${i + 1}. ${p.name} — ${p.price} ${getCurrencyDisplayName(code, 'arabic')}`;
              })
              .join('\n');

            if (analysis.products.length > 0) {
              messageText = `[تحليل صورة العميل: "${analysis.description}" — المنتجات المطابقة في المتجر:\n${productList}]\n${messageText || 'كم سعر هذا المنتج؟'}`;
            } else {
              messageText = `[تحليل صورة العميل: "${analysis.description}" — لم يُعثر على منتج مطابق في المتجر]\n${messageText || 'كم سعر هذا المنتج؟'}`;
            }
            console.log('[processTelegramMessage] Image analyzed', {
              messageLength: messageText.length,
            });
          }
        }
      }
      if (!messageText || !messageText.trim()) {
        messageText = 'أرسل العميل صورة';
      }
    }

    // Get or create conversation
    const convResult = await pool.query(
      `SELECT id, conversation_state, current_intent, stage FROM conversations 
       WHERE merchant_id = $1 AND platform = 'telegram' AND user_id = $2
       ORDER BY last_message_at DESC LIMIT 1`,
      [merchantId, userId]
    );

    let conversationId: string;
    let conversationState: ConversationState = { message_count: 0 };
    
    if (convResult.rows.length > 0) {
      conversationId = convResult.rows[0].id;
      // ✅ استخراج حالة المحادثة من قاعدة البيانات
      conversationState = convResult.rows[0].conversation_state || { message_count: 0 };
      if (convResult.rows[0].current_intent) {
        conversationState.last_intent = convResult.rows[0].current_intent;
      }
    } else {
      // Create new conversation
      const newConvResult = await pool.query(
        `INSERT INTO conversations (merchant_id, platform, user_id, user_name)
         VALUES ($1, 'telegram', $2, $3)
         RETURNING id`,
        [merchantId, userId, userName]
      );
      conversationId = newConvResult.rows[0].id;
    }

    if (botId) {
      await bindConversationChannelAccount({
        merchantId,
        conversationId,
        platform: 'telegram',
        accountId: String(botId),
      });
    }

    // Human takeover: skip bot when merchant owns the chat (same as Messenger/IG)
    try {
      const convStatus = await pool.query(
        `SELECT bot_disabled, last_human_response_at, status
         FROM conversations WHERE id = $1 AND merchant_id = $2`,
        [conversationId, merchantId]
      );
      const conv = convStatus.rows[0] || { bot_disabled: false, status: 'bot' };
      if (conv.bot_disabled || conv.status === 'human') {
        await pool.query(
          `INSERT INTO messages (conversation_id, role, content, sender_type, source, metadata)
           VALUES ($1, 'user', $2, 'user', 'telegram', $3::jsonb)`,
          [
            conversationId,
            messageText,
            JSON.stringify({
              platform: 'telegram',
              ...(inboundImageUrl
                ? { type: 'image', imageUrl: inboundImageUrl }
                : { type: 'text' }),
            }),
          ]
        );
        await pool.query(
          `UPDATE conversations
           SET last_message_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
           WHERE id = $1 AND merchant_id = $2`,
          [conversationId, merchantId]
        );
        logger.info('Telegram bot skipped — conversation in human mode', {
          conversationId,
          merchantId,
          status: conv.status,
          bot_disabled: conv.bot_disabled,
        });
        return;
      }
    } catch (statusErr: any) {
      if (statusErr?.code !== '42703') {
        throw statusErr;
      }
    }

    // ✅ جلب الرسائل السابقة للسياق (آخر 25 رسالة)
    const recentMessagesResult = await pool.query(
      `SELECT role, content FROM messages 
       WHERE conversation_id = $1 
       ORDER BY created_at DESC 
       LIMIT 25`,
      [conversationId]
    );
    
    const recentMessages: Message[] = recentMessagesResult.rows
      .reverse() // ترتيب من الأقدم للأحدث
      .map(row => ({
        role: row.role as 'user' | 'assistant',
        content: row.content
      }));

    console.log('[processTelegramMessage] Conversation ready for NEW orchestrator:', { 
      conversationId, 
      messageLength: messageText.length,
      recentMessagesCount: recentMessages.length,
      hasConversationState: Object.keys(conversationState).length > 0
    }); 

    // ✅ فحص حد الردود الذكية
    const { getMerchantPlanLimits, getMonthlyAIResponseCount, isWithinLimit } = await import('../utils/planLimits.js');
    const limits = await getMerchantPlanLimits(merchantId);

    if (!limits.hasSalesBot) {
      logger.info('Sales bot not included in plan — skipping Telegram auto-reply', { merchantId });
      return;
    }

    const currentCount = await getMonthlyAIResponseCount(merchantId);

    console.log('[processTelegramMessage] Plan limits check:', { merchantId, currentCount, limit: limits.maxMonthlyAIResponses, isWithinLimit: isWithinLimit(currentCount, limits.maxMonthlyAIResponses) });

    if (!isWithinLimit(currentCount, limits.maxMonthlyAIResponses)) {
      logger.warn('AI response limit exceeded for Telegram', {
        merchantId,
        currentCount,
        limit: limits.maxMonthlyAIResponses
      });
      // Don't send error to user, just skip the reply
      return;
    }

    // ==================== SalesGPT turn (shared) ====================
    let responseText: string;
    let updatedState: ConversationState = conversationState;

    const stopTypingKeepalive = botToken
      ? startTypingKeepalive(() => sendTelegramTyping(chatId, botToken))
      : () => undefined;

    try {
      const merchantConfig: Partial<MerchantConfig> = buildMerchantBotConfig({
        merchantId,
        settings,
        systemPromptSuffix: '',
      });

      const turn = await runSalesBotTurn({
        merchantId,
        platform: 'telegram',
        escalatePlatform: 'telegram',
        userId,
        userName: userName || 'عميل',
        messageText,
        externalMessageId:
          message.message_id != null ? String(message.message_id) : '',
        recentMessages,
        conversationState,
        merchantConfig,
        conversationId,
        storeCurrency: settings?.store_currency || 'USD',
        channelLabel: 'Telegram',
        pool,
        userMessageMetadata: inboundImageUrl
          ? { type: 'image', imageUrl: inboundImageUrl }
          : { type: 'text' },
      });

      responseText = turn.responseText;
      updatedState = turn.updatedState;

      if (!turn.failed) {
        console.log('[processTelegramMessage] SalesGPT response generated:', {
          conversationId,
          responseLength: responseText.length,
          pipelineUsed: turn.meta.pipelineUsed,
          aiCallsCount: turn.meta.aiCallsCount,
          processingTimeMs: turn.meta.processingTimeMs,
          intent: turn.meta.intent,
          stage: turn.meta.stage
        });
        logger.info('Telegram message processed via SalesGPT', {
          merchantId,
          conversationId,
          pipelineUsed: turn.meta.pipelineUsed,
          aiCallsCount: turn.meta.aiCallsCount,
          processingTimeMs: turn.meta.processingTimeMs
        });
      }
    } finally {
      stopTypingKeepalive();
    }

    const { orderData, cleanText: responseWithoutOrderData } = extractOrderData(responseText);
    const { imageUrl, cleanText } = extractImageUrl(responseWithoutOrderData);

    if (orderData) {
      console.log('[processTelegramMessage] ORDER_DATA detected, processing order:', {
        merchantId,
        hasName: Boolean(orderData.customerName),
        productsCount: orderData.products?.length || 0
      });
      await persistOrderIfPresent({
        pool,
        merchantId,
        conversationId,
        orderData,
        settings: { store_currency: settings?.store_currency || 'USD' },
        labels: {
          defaultBaseNotes: 'Order created via Telegram bot',
          customerTags: ['bot-order', 'telegram'],
          interactionTitle: 'Order Created via Telegram Bot',
          interactionDescription: (orderId: string) => `Order #${orderId} created via Telegram bot`,
          interactionPlatform: 'telegram',
          logPrefix: 'processTelegramMessage'
        },
        updatedState,
      });
    }

    // ==================== STEP 3: Human-like send (typing delay + ≤2 bubbles) ====================
    // ✅ NOTE: Messages are already saved by orchestrator / bot core
    // DO NOT save messages here to avoid duplication
    const finalResponseText = stripInternalControlMarkers(cleanText || responseWithoutOrderData);
    console.log('[processTelegramMessage] Prepared final response for sending:', { conversationId, responseLength: finalResponseText.length });

    const hasImage = !!(imageUrl && imageUrl.startsWith('http') && botToken);
    if ((!finalResponseText || !finalResponseText.trim()) && !hasImage) {
      logger.info('Orchestrator returned no reply for Telegram', { conversationId, merchantId });
      return;
    }

    await telegramAdapter.sendMessage({
      merchantId,
      userId,
      text: finalResponseText || '',
      metadata: {
        botId: botId || null,
        botToken: botToken || null,
        botType: configuredBotType || null,
        ...(hasImage ? { imageUrl } : {})
      }
    });

    // Update conversation
    // ✅ SaaS: Verify conversation belongs to merchant before updating
    await pool.query(
      `UPDATE conversations 
       SET last_message_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND merchant_id = $2`,
      [conversationId, merchantId] // ✅ SaaS: Ensure merchant isolation
    );

    console.log('[processTelegramMessage] Message processed successfully:', { chatId, userId, conversationId });
    logger.info('Telegram message processed successfully', { chatId, userId, conversationId });
  } catch (error) {
    console.error('[processTelegramMessage] ERROR:', error);
    logger.error('Error processing Telegram message', error as Error);
  }
};

// Connect Telegram bot (verify token and set webhook)
export const connectTelegram = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const { botToken } = req.body;

    if (!botToken) {
      return next(createError('Bot token is required', 400));
    }

    // Verify bot token by getting bot info
    const botInfo = await getTelegramBotInfo(botToken);
    if (!botInfo) {
      return next(createError('Invalid bot token', 400));
    }

    // Get webhook URL - try multiple sources
    let baseUrl = process.env.BACKEND_URL;
    
    // If BACKEND_URL not set, try to detect from request headers (for production behind proxy)
    if (!baseUrl) {
      // Check X-Forwarded-Proto header (set by reverse proxy like Nginx)
      const forwardedProto = req.headers['x-forwarded-proto'];
      // Check if request is secure (direct HTTPS connection)
      const isSecure = req.secure || forwardedProto === 'https';
      // Get host from headers
      const forwardedHost = req.headers['x-forwarded-host'];
      const hostHeader = req.headers.host;
      const host = forwardedHost || hostHeader || 'xo-bot.com';
      
      // Determine protocol
      let protocol = 'http';
      if (isSecure || forwardedProto === 'https') {
        protocol = 'https';
      } else if (process.env.NODE_ENV === 'production') {
        // In production, assume HTTPS if behind reverse proxy
        protocol = 'https';
      } else if (host.includes('xo-bot.com') || host.includes('localhost') === false) {
        // If domain doesn't contain localhost, assume HTTPS
        protocol = 'https';
      }
      
      baseUrl = `${protocol}://${host}`;
      
      // If still using CORS_ORIGIN and it's HTTPS, use it
      if (!baseUrl.startsWith('https://') && process.env.CORS_ORIGIN?.startsWith('https://')) {
        baseUrl = process.env.CORS_ORIGIN.replace(':3000', ':3001');
      }
    }
    
    // Force HTTPS in production
    if (process.env.NODE_ENV === 'production' && !baseUrl.startsWith('https://')) {
      baseUrl = baseUrl.replace('http://', 'https://');
    }
    
    const webhookUrl = `${baseUrl}/webhooks/telegram`;

    // Check if URL is HTTPS (Telegram requires HTTPS for webhooks)
    if (!webhookUrl.startsWith('https://')) {
      const errorMessage = process.env.NODE_ENV === 'production' 
        ? 'يجب إضافة BACKEND_URL=https://your-domain.com في ملف .env الخاص بالخادم. Telegram يتطلب HTTPS لربط Webhook.'
        : 'في وضع التطوير، Telegram يتطلب HTTPS لربط Webhook. يرجى استخدام ngrok أو خدمة مشابهة لإنشاء HTTPS URL مؤقت، أو نشر التطبيق على خادم يستخدم HTTPS.';
      logger.error('Telegram webhook URL must be HTTPS', new Error(`Webhook URL: ${webhookUrl}, BACKEND_URL: ${process.env.BACKEND_URL || 'not set'}, CORS_ORIGIN: ${process.env.CORS_ORIGIN || 'not set'}, NODE_ENV: ${process.env.NODE_ENV || 'not set'}`));
      return next(createError(errorMessage, 400));
    }

    // ✅ SaaS: Generate unique webhook secret for this merchant
    const webhookSecret = crypto.randomBytes(32).toString('hex');
    
    // Set webhook via Telegram API with merchant-specific secret
    const setWebhookResponse = await fetch(
      `https://api.telegram.org/bot${botToken}/setWebhook?url=${encodeURIComponent(webhookUrl)}&secret_token=${webhookSecret}`
    );

    const webhookData = await setWebhookResponse.json() as { ok: boolean; description?: string; error_code?: number };

    if (!setWebhookResponse.ok || !webhookData.ok) {
      logger.error('Failed to set Telegram webhook', new Error(JSON.stringify(webhookData)));
      
      // Provide user-friendly error messages
      let errorMessage = 'فشل ربط Webhook';
      if (webhookData.description) {
        if (webhookData.description.includes('HTTPS') || webhookData.description.includes('bad webhook')) {
          errorMessage = 'Telegram يتطلب عنوان HTTPS لربط Webhook. يرجى التأكد من أن الخادم يستخدم HTTPS.';
        } else if (webhookData.description.includes('invalid')) {
          errorMessage = `عنوان Webhook غير صحيح: ${webhookData.description}`;
        } else {
          errorMessage = webhookData.description;
        }
      }
      
      return next(createError(errorMessage, 400));
    }

    // ✅ SaaS: Save bot token AND webhook secret in merchant settings (unique per merchant)
    // Check if telegram_webhook_secret column exists first
    try {
      // Try to update with webhook_secret column (new schema)
      await pool.query(
        `UPDATE merchant_settings 
         SET telegram_bot_token = $1, 
             telegram_webhook_secret = $2,
             updated_at = CURRENT_TIMESTAMP
         WHERE merchant_id = $3`,
        [botToken, webhookSecret, req.merchantId]
      );
    } catch (error: any) {
      // If column doesn't exist, try to create it first, then update
      if (error.code === '42703' || error.message?.includes('telegram_webhook_secret')) {
        logger.warn('telegram_webhook_secret column does not exist, attempting to create it', {
          merchantId: req.merchantId
        });
        
        try {
          // Try to add the column
          await pool.query(
            `ALTER TABLE merchant_settings 
             ADD COLUMN IF NOT EXISTS telegram_webhook_secret VARCHAR(255) UNIQUE`
          );
          
          // Now update with the new column
          await pool.query(
            `UPDATE merchant_settings 
             SET telegram_bot_token = $1, 
                 telegram_webhook_secret = $2,
                 updated_at = CURRENT_TIMESTAMP
             WHERE merchant_id = $3`,
            [botToken, webhookSecret, req.merchantId]
          );
          
          logger.info('Successfully created telegram_webhook_secret column and updated settings', {
            merchantId: req.merchantId
          });
        } catch (createError: any) {
          // If we can't create the column (permissions issue), fall back to legacy update
          if (createError.code === '42501' || createError.message?.includes('permission')) {
            logger.warn('Cannot create telegram_webhook_secret column (permission denied), using legacy update', {
              merchantId: req.merchantId
            });
            await pool.query(
              `UPDATE merchant_settings 
               SET telegram_bot_token = $1,
                   updated_at = CURRENT_TIMESTAMP
               WHERE merchant_id = $2`,
              [botToken, req.merchantId]
            );
          } else {
            throw createError; // Re-throw if it's a different error
          }
        }
      } else {
        throw error; // Re-throw if it's a different error
      }
    }

    logger.info('Telegram bot connected successfully', { 
      merchantId: req.merchantId, 
      botUsername: botInfo.username,
      webhookUrl 
    });

    res.json({
      success: true,
      data: {
        botInfo: {
          username: botInfo.username,
          id: botInfo.id,
          firstName: botInfo.first_name
        },
        webhookUrl,
        message: 'Bot connected successfully'
      }
    });
  } catch (error: any) {
    logger.error('Error connecting Telegram bot', error as Error);
    next(error);
  }
};

// Disconnect Telegram bot
export const disconnectTelegram = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    // Get bot token
    const settingsResult = await pool.query(
      'SELECT telegram_bot_token FROM merchant_settings WHERE merchant_id = $1',
      [req.merchantId]
    );

    if (settingsResult.rows.length > 0 && settingsResult.rows[0].telegram_bot_token) {
      const botToken = settingsResult.rows[0].telegram_bot_token;
      
      // Delete webhook
      try {
        await fetch(`https://api.telegram.org/bot${botToken}/deleteWebhook`);
      } catch (error) {
        logger.warn('Failed to delete Telegram webhook', { error });
      }
    }

    // ✅ SaaS: Remove bot token AND webhook secret from settings
    // Check if telegram_webhook_secret column exists first
    try {
      // Try to update with webhook_secret column (new schema)
      await pool.query(
        `UPDATE merchant_settings 
         SET telegram_bot_token = NULL, 
             telegram_webhook_secret = NULL,
             updated_at = CURRENT_TIMESTAMP
         WHERE merchant_id = $1`,
        [req.merchantId]
      );
    } catch (error: any) {
      // If column doesn't exist, update without it (legacy schema)
      if (error.code === '42703' || error.message?.includes('telegram_webhook_secret')) {
        logger.warn('telegram_webhook_secret column does not exist, using legacy update', {
          merchantId: req.merchantId
        });
        await pool.query(
          `UPDATE merchant_settings 
           SET telegram_bot_token = NULL,
               updated_at = CURRENT_TIMESTAMP
           WHERE merchant_id = $1`,
          [req.merchantId]
        );
      } else {
        throw error; // Re-throw if it's a different error
      }
    }

    logger.info('Telegram bot disconnected', { merchantId: req.merchantId });

    if (
      req.merchantId &&
      !(await hasRemainingChannelAccount(req.merchantId, 'telegram'))
    ) {
      await clearMerchantChannelConversations({
        merchantId: req.merchantId,
        platform: 'telegram',
      });
    }

    res.json({
      success: true,
      message: 'Telegram bot disconnected successfully'
    });
  } catch (error) {
    logger.error('Error disconnecting Telegram bot', error as Error);
    next(error);
  }
};

// Telegram webhook handler
export const telegramWebhook = async (
  req: any,
  res: Response,
  next: NextFunction
) => {
  try {
    // Log incoming webhook request for debugging (always log, even in production)
    console.log('[Telegram Webhook] Received request:', {
      path: req.path,
      method: req.method,
      hasBody: !!req.body,
      bodyKeys: req.body ? Object.keys(req.body) : [],
    });
    logger.info('Telegram webhook received', {
      path: req.path,
      method: req.method,
      hasBody: !!req.body,
      bodyKeys: req.body ? Object.keys(req.body) : []
    });

    // ✅ SaaS: Identify merchant by webhook secret (unique per merchant) — required
    const receivedSecret = req.headers['x-telegram-bot-api-secret-token'];

    if (typeof receivedSecret !== 'string' || !receivedSecret) {
      logger.warn('Telegram webhook rejected: missing secret token');
      return res.status(403).send('Forbidden');
    }

    console.log('[Telegram Webhook] Identifying merchant:', {
      hasSecret: true
    });

    let merchantId: string | null = null;
    let merchantResult: any;

    try {
      let botResult = await pool.query(
        `SELECT merchant_id, bot_token, bot_type, id as bot_id
         FROM telegram_bots 
         WHERE webhook_secret = $1 AND is_active = true`,
        [receivedSecret]
      );

      if (botResult.rows.length > 0) {
        merchantId = botResult.rows[0].merchant_id;
        const botId = botResult.rows[0].bot_id;
        const botType = botResult.rows[0].bot_type;
        console.log('[Telegram Webhook] Bot identified by secret:', { merchantId, botId, botType });
        logger.info('Telegram webhook bot identified by secret', { merchantId, botId });

        (req as any).telegramBotId = botId;
        (req as any).telegramBotType = botType;
      } else {
        merchantResult = await pool.query(
          `SELECT merchant_id, telegram_bot_token 
           FROM merchant_settings 
           WHERE telegram_webhook_secret = $1`,
          [receivedSecret]
        );

        if (merchantResult.rows.length > 0) {
          merchantId = merchantResult.rows[0].merchant_id;
          (req as any).telegramBotType = 'both';
          console.log('[Telegram Webhook] Merchant identified by secret (legacy):', { merchantId });
          logger.info('Telegram webhook merchant identified by secret (legacy)', { merchantId });
        } else {
          console.log('[Telegram Webhook] No bot or merchant found with this secret');
          logger.warn('Telegram webhook: unknown webhook secret');
        }
      }
    } catch (error) {
      console.error('[Telegram Webhook] Error querying by secret:', error);
      logger.error('Error querying bot by webhook secret', error as Error);
    }

    if (!merchantId) {
      console.error('[Telegram Webhook] Could not identify merchant');
      logger.error('Telegram webhook: Could not identify merchant', new Error('Merchant identification failed'), {
        hasSecret: true
      });
      return res.status(403).send('Forbidden');
    }
    
    console.log('[Telegram Webhook] Merchant identified successfully:', {
      merchantId,
      method: 'webhook_secret'
    });
    logger.info('Telegram webhook merchant identified', {
      merchantId,
      method: 'webhook_secret'
    });

    const update = req.body;

    // ✅ SaaS: Pass merchantId and bot info to processTelegramMessage
    (update as any).merchantId = merchantId;
    if ((req as any).telegramBotId) {
      (update as any).botId = (req as any).telegramBotId;
    }
    if ((req as any).telegramBotType) {
      (update as any).botType = (req as any).telegramBotType;
    }

    // Telegram sends updates in this format
    if (update && update.message) {
      console.log('[Telegram Webhook] Processing message:', {
        merchantId,
        chatId: update.message.chat?.id,
        userId: update.message.from?.id,
        textLength: update.message.text?.length || 0,
      });
      logger.info('Processing Telegram message', {
        merchantId,
        chatId: update.message.chat?.id,
        userId: update.message.from?.id,
        textLength: update.message.text?.length || 0,
      });
      
      // Per-conversation queue: merge rapid messages (4–6s) then process once
      const chatId = update.message.chat?.id != null ? String(update.message.chat.id) : '';
      const userId = update.message.from?.id != null ? String(update.message.from.id) : '';
      const text = String(update.message.text || update.message.caption || '').trim();
      const externalMessageId =
        update.message.message_id != null ? String(update.message.message_id) : undefined;

      if (!merchantId || !chatId) {
        processTelegramMessage(update).catch(err => {
          logger.error('Error processing Telegram message event', err as Error, {
            merchantId,
            chatId: update.message?.chat?.id,
            userId: update.message?.from?.id
          });
        });
      } else {
        conversationIngressQueue
          .enqueue({
            conversationKey: `${merchantId}:telegram:${chatId}`,
            merchantId,
            platform: 'telegram',
            text,
            externalMessageId,
            payload: update,
            process: async (batch) => {
              const mergedUpdate = mergeTelegramUpdates(batch.parts);
              // Preserve tenant stamps from webhook (not always on every part)
              (mergedUpdate as any).merchantId = merchantId;
              (mergedUpdate as any).botId = (update as any).botId ?? (mergedUpdate as any).botId;
              (mergedUpdate as any).botType = (update as any).botType ?? (mergedUpdate as any).botType;
              await processTelegramMessage(mergedUpdate);
            }
          })
          .catch(err => {
            logger.error('Error processing Telegram message event', err as Error, {
              merchantId,
              chatId: update.message?.chat?.id,
              userId: update.message?.from?.id
            });
          });
      }
    } else {
      console.log('[Telegram Webhook] Update without message:', {
        merchantId,
        updateKeys: Object.keys(update || {}),
      });
      logger.debug('Telegram webhook update without message', {
        merchantId,
        updateKeys: Object.keys(update || {})
      });
    }

    // Respond immediately to Telegram
    res.json({ ok: true });
  } catch (error) {
    logger.error('Error in Telegram webhook', error as Error, {
      path: req.path,
      body: req.body
    });
    next(error);
  }
};

// Get webhook info from Telegram
export const getTelegramWebhookInfo = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    // Get bot token from settings
    const settingsResult = await pool.query(
      'SELECT telegram_bot_token FROM merchant_settings WHERE merchant_id = $1',
      [req.merchantId]
    );

    if (settingsResult.rows.length === 0 || !settingsResult.rows[0].telegram_bot_token) {
      return next(createError('Telegram bot not connected', 404));
    }

    const botToken = settingsResult.rows[0].telegram_bot_token;

    // Get webhook info from Telegram API
    const response = await fetch(`https://api.telegram.org/bot${botToken}/getWebhookInfo`);
    const data = await response.json() as { 
      ok: boolean; 
      result?: { 
        url?: string; 
        has_custom_certificate?: boolean; 
        pending_update_count?: number;
        last_error_date?: number;
        last_error_message?: string;
        max_connections?: number;
        allowed_updates?: string[];
      } 
    };

    if (!response.ok || !data.ok) {
      return next(createError('Failed to get webhook info', 400));
    }

    res.json({
      success: true,
      data: data.result
    });
  } catch (error) {
    logger.error('Error getting Telegram webhook info', error as Error);
    next(error);
  }
};

// Set webhook URL (for merchant to configure) - DEPRECATED, use connectTelegram instead
export const setTelegramWebhook = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const { botToken, webhookUrl } = req.body;

    if (!botToken || !webhookUrl) {
      return next(createError('Bot token and webhook URL are required', 400));
    }

    // Set webhook via Telegram API
    const response = await fetch(
      `https://api.telegram.org/bot${botToken}/setWebhook?url=${encodeURIComponent(webhookUrl)}`
    );

    const data = await response.json() as { ok: boolean; description?: string; error_code?: number };

    if (!response.ok || !data.ok) {
      logger.error('Failed to set Telegram webhook', new Error(JSON.stringify(data)));
      return next(createError('Failed to set webhook', 400));
    }

    // Save bot token in merchant settings
    await pool.query(
      `UPDATE merchant_settings 
       SET telegram_bot_token = $1, updated_at = CURRENT_TIMESTAMP
       WHERE merchant_id = $2`,
      [botToken, req.merchantId]
    );

    logger.info('Telegram webhook set successfully', { merchantId: req.merchantId, webhookUrl });

    res.json({
      success: true,
      data: {
        message: 'Webhook set successfully',
        webhookUrl
      }
    });
  } catch (error) {
    logger.error('Error setting Telegram webhook', error as Error);
    next(error);
  }
};

// ==================== MULTIPLE BOTS API ====================

// List all Telegram bots for merchant
export const listTelegramBots = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const result = await pool.query(
      `SELECT id, bot_token, bot_name, bot_username, bot_type, is_active, created_at, updated_at
       FROM telegram_bots 
       WHERE merchant_id = $1
       ORDER BY created_at DESC`,
      [req.merchantId]
    );

    // Don't expose full bot_token — mask like settings API
    const bots = result.rows.map(row => ({
      id: row.id,
      botName: row.bot_name,
      botUsername: row.bot_username,
      botType: row.bot_type,
      isActive: row.is_active,
      tokenPreview: row.bot_token
        ? (row.bot_token.length <= 4 ? '****' : `****${row.bot_token.slice(-4)}`)
        : null,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));

    res.json({
      success: true,
      data: { bots }
    });
  } catch (error) {
    logger.error('Error listing Telegram bots', error as Error);
    next(error);
  }
};

// Create new Telegram bot
export const createTelegramBot = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const { botToken, botName, botType } = req.body;

    if (!botToken) {
      return next(createError('Bot token is required', 400));
    }

    if (!botType || !['products', 'services', 'both'].includes(botType)) {
      return next(createError('Bot type must be: products, services, or both', 400));
    }

    // Check plan limits
    const merchantId = req.merchantId;
    if (!merchantId) {
      return next(createError('Unauthorized', 401));
    }
    
    const { getMerchantPlanLimits, getTelegramBotsCount, isWithinLimit } = await import('../utils/planLimits.js');
    const limits = await getMerchantPlanLimits(merchantId);
    const currentCount = await getTelegramBotsCount(merchantId);

    if (!isWithinLimit(currentCount, limits.maxTelegramBots)) {
      return next(createError(
        `You have reached the maximum number of Telegram bots for your plan (${limits.maxTelegramBots === -1 ? 'unlimited' : limits.maxTelegramBots}). Please upgrade your plan to add more bots.`,
        403
      ));
    }

    // Verify bot token by getting bot info
    const botInfo = await getTelegramBotInfo(botToken);
    if (!botInfo) {
      return next(createError('Invalid bot token', 400));
    }

    // Check if bot token already exists for this merchant
    const existingBot = await pool.query(
      `SELECT id FROM telegram_bots WHERE merchant_id = $1 AND bot_token = $2`,
      [req.merchantId, botToken]
    );

    if (existingBot.rows.length > 0) {
      return next(createError('This bot is already connected', 400));
    }

    // Get webhook URL
    let baseUrl = process.env.BACKEND_URL;
    
    if (!baseUrl) {
      const forwardedProto = req.headers['x-forwarded-proto'];
      const isSecure = req.secure || forwardedProto === 'https';
      const forwardedHost = req.headers['x-forwarded-host'];
      const hostHeader = req.headers.host;
      const host = forwardedHost || hostHeader || 'xo-bot.com';
      
      let protocol = 'http';
      if (isSecure || forwardedProto === 'https') {
        protocol = 'https';
      } else if (process.env.NODE_ENV === 'production') {
        protocol = 'https';
      } else if (host.includes('xo-bot.com') || host.includes('localhost') === false) {
        protocol = 'https';
      }
      
      baseUrl = `${protocol}://${host}`;
      
      if (!baseUrl.startsWith('https://') && process.env.CORS_ORIGIN?.startsWith('https://')) {
        baseUrl = process.env.CORS_ORIGIN.replace(':3000', ':3001');
      }
    }
    
    if (process.env.NODE_ENV === 'production' && !baseUrl.startsWith('https://')) {
      baseUrl = baseUrl.replace('http://', 'https://');
    }
    
    const webhookUrl = `${baseUrl}/webhooks/telegram`;

    if (!webhookUrl.startsWith('https://')) {
      const errorMessage = process.env.NODE_ENV === 'production' 
        ? 'يجب إضافة BACKEND_URL=https://your-domain.com في ملف .env الخاص بالخادم. Telegram يتطلب HTTPS لربط Webhook.'
        : 'في وضع التطوير، Telegram يتطلب HTTPS لربط Webhook. يرجى استخدام ngrok أو خدمة مشابهة لإنشاء HTTPS URL مؤقت، أو نشر التطبيق على خادم يستخدم HTTPS.';
      logger.error('Telegram webhook URL must be HTTPS', new Error(`Webhook URL: ${webhookUrl}`));
      return next(createError(errorMessage, 400));
    }

    // Generate unique webhook secret
    const webhookSecret = crypto.randomBytes(32).toString('hex');
    
    // Set webhook via Telegram API
    const setWebhookResponse = await fetch(
      `https://api.telegram.org/bot${botToken}/setWebhook?url=${encodeURIComponent(webhookUrl)}&secret_token=${webhookSecret}`
    );

    const webhookData = await setWebhookResponse.json() as { ok: boolean; description?: string; error_code?: number };

    if (!setWebhookResponse.ok || !webhookData.ok) {
      logger.error('Failed to set Telegram webhook', new Error(JSON.stringify(webhookData)));
      
      let errorMessage = 'فشل ربط Webhook';
      if (webhookData.description) {
        if (webhookData.description.includes('HTTPS') || webhookData.description.includes('bad webhook')) {
          errorMessage = 'Telegram يتطلب عنوان HTTPS لربط Webhook. يرجى التأكد من أن الخادم يستخدم HTTPS.';
        } else if (webhookData.description.includes('invalid')) {
          errorMessage = `عنوان Webhook غير صحيح: ${webhookData.description}`;
        } else {
          errorMessage = webhookData.description;
        }
      }
      
      return next(createError(errorMessage, 400));
    }

    // Save bot to telegram_bots table
    const insertResult = await pool.query(
      `INSERT INTO telegram_bots (merchant_id, bot_token, webhook_secret, bot_name, bot_username, bot_type, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, true)
       RETURNING id, bot_name, bot_username, bot_type, is_active, created_at`,
      [
        req.merchantId,
        botToken,
        webhookSecret,
        botName || botInfo.first_name,
        botInfo.username,
        botType
      ]
    );

    const newBot = insertResult.rows[0];

    logger.info('Telegram bot created successfully', { 
      merchantId: req.merchantId, 
      botId: newBot.id,
      botUsername: botInfo.username,
      botType
    });

    res.json({
      success: true,
      data: {
        bot: {
          id: newBot.id,
          botName: newBot.bot_name,
          botUsername: newBot.bot_username,
          botType: newBot.bot_type,
          isActive: newBot.is_active,
          createdAt: newBot.created_at
        },
        webhookUrl,
        message: 'Bot connected successfully'
      }
    });
  } catch (error: any) {
    logger.error('Error creating Telegram bot', error as Error);
    next(error);
  }
};

// Update Telegram bot (mainly bot_type)
export const updateTelegramBot = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const { botId } = req.params;
    const { botName, botType, isActive } = req.body;

    // Verify bot belongs to merchant
    const botResult = await pool.query(
      `SELECT id FROM telegram_bots WHERE id = $1 AND merchant_id = $2`,
      [botId, req.merchantId]
    );

    if (botResult.rows.length === 0) {
      return next(createError('Bot not found', 404));
    }

    // Validate bot_type if provided
    if (botType && !['products', 'services', 'both'].includes(botType)) {
      return next(createError('Bot type must be: products, services, or both', 400));
    }

    // Build update query dynamically
    const updates: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (botName !== undefined) {
      updates.push(`bot_name = $${paramIndex++}`);
      values.push(botName);
    }

    if (botType !== undefined) {
      updates.push(`bot_type = $${paramIndex++}`);
      values.push(botType);
    }

    if (isActive !== undefined) {
      updates.push(`is_active = $${paramIndex++}`);
      values.push(isActive);
    }

    if (updates.length === 0) {
      return next(createError('No fields to update', 400));
    }

    updates.push(`updated_at = CURRENT_TIMESTAMP`);
    values.push(botId, req.merchantId);

    const updateQuery = `
      UPDATE telegram_bots 
      SET ${updates.join(', ')}
      WHERE id = $${paramIndex++} AND merchant_id = $${paramIndex}
      RETURNING id, bot_name, bot_username, bot_type, is_active, updated_at
    `;

    const result = await pool.query(updateQuery, values);

    logger.info('Telegram bot updated', {
      merchantId: req.merchantId,
      botId,
      updates: { botName, botType, isActive }
    });

    res.json({
      success: true,
      data: {
        bot: {
          id: result.rows[0].id,
          botName: result.rows[0].bot_name,
          botUsername: result.rows[0].bot_username,
          botType: result.rows[0].bot_type,
          isActive: result.rows[0].is_active,
          updatedAt: result.rows[0].updated_at
        },
        message: 'Bot updated successfully'
      }
    });
  } catch (error) {
    logger.error('Error updating Telegram bot', error as Error);
    next(error);
  }
};

// Delete Telegram bot
export const deleteTelegramBot = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const { botId } = req.params;

    // Get bot info before deletion
    const botResult = await pool.query(
      `SELECT bot_token FROM telegram_bots WHERE id = $1 AND merchant_id = $2`,
      [botId, req.merchantId]
    );

    if (botResult.rows.length === 0) {
      return next(createError('Bot not found', 404));
    }

    const botToken = botResult.rows[0].bot_token;

    // Delete webhook from Telegram
    try {
      await fetch(`https://api.telegram.org/bot${botToken}/deleteWebhook`);
    } catch (error) {
      logger.warn('Failed to delete Telegram webhook', { error });
    }

    // Delete bot from database
    await pool.query(
      `DELETE FROM telegram_bots WHERE id = $1 AND merchant_id = $2`,
      [botId, req.merchantId]
    );

    if (req.merchantId) {
      await clearMerchantChannelConversations({
        merchantId: req.merchantId,
        platform: 'telegram',
        accountId: String(botId),
      });
    }

    logger.info('Telegram bot deleted', { merchantId: req.merchantId, botId });

    res.json({
      success: true,
      message: 'Telegram bot disconnected successfully'
    });
  } catch (error) {
    logger.error('Error deleting Telegram bot', error as Error);
    next(error);
  }
};
