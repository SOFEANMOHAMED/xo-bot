import { Response, NextFunction } from 'express';
import crypto from 'crypto';
import pool from '../database/connection.js';
import { createError } from '../middleware/errorHandler.js';
import { AuthRequest } from '../middleware/auth.js';
import { logger } from '../utils/logger.js';
// ✅ النظام الجديد - Modular Architecture v2.0
import { handleIncomingMessage } from '../bot/index.js';
import type { Message, ConversationState, MerchantConfig } from '../bot/index.js';
import { escalateConversationToHuman } from '../services/escalation.js';
import { stripInternalControlMarkers } from '../response/sanitize-reply.js';
import { appendOrderDataIfConfirmed } from '../services/buildMerchantBotConfig.js';
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
import { notifyMerchantNewOrderAsync } from '../services/notifyMerchantNewOrder.js';

// ==================== UUID VALIDATION ====================

/**
 * Validate UUID format (v4)
 * @param str - String to validate
 * @returns true if valid UUID v4, false otherwise
 */
const isValidUUID = (str: string | null | undefined): boolean => {
  if (!str) return false;
  const uuidV4Regex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  // Also accept any standard UUID format (not just v4)
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(str);
};

/**
 * Sanitize and validate UUID
 * Returns null if invalid, or the cleaned UUID if valid
 * @param str - String to sanitize
 * @returns Valid UUID string or null
 */
const sanitizeUUID = (str: string | null | undefined): string | null => {
  if (!str) return null;
  
  // Remove extra dashes, spaces, and invalid characters
  const cleaned = str.trim()
    .replace(/--+/g, '-')  // Fix double dashes
    .replace(/\s+/g, '')    // Remove spaces
    .toLowerCase();
  
  // Check if it's a valid UUID after cleaning
  if (isValidUUID(cleaned)) {
    return cleaned;
  }
  
  // Log warning for debugging
  console.warn('[UUID] Invalid UUID detected:', {
    original: str,
    cleaned: cleaned,
    isValid: false
  });
  
  return null;
};

// Verify Telegram webhook secret (if configured)
const verifyTelegramSecret = (req: any, secret: string): boolean => {
  if (!secret) return true; // If no secret configured, allow all
  
  const receivedSecret = req.headers['x-telegram-bot-api-secret-token'];
  return receivedSecret === secret;
};

// Extract image URL from response text
const extractImageUrl = (text: string): { imageUrl: string | null; cleanText: string } => {
  const imageRegex = /\[IMAGE:\s*([^\]]+)\]/i;
  const match = text.match(imageRegex);
  
  if (match && match[1]) {
    const imageUrl = match[1].trim();
    // Remove the [IMAGE: url] tag from the text
    const cleanText = text.replace(imageRegex, '').trim();
    return { imageUrl, cleanText };
  }
  
  return { imageUrl: null, cleanText: text };
};

// Extract ORDER_DATA from response text
const extractOrderData = (text: string): { orderData: any | null; cleanText: string } => {
  // ✅ تحسين الـ regex لالتقاط ORDER_DATA بشكل أفضل
  const orderDataRegex = /\[ORDER_DATA\]([\s\S]*?)\[\/ORDER_DATA\]/gi;
  // ✅ أيضاً التقاط أي صيغة مشابهة (مثل [_] أو [/] أو ORDER_DATA بدون أقواس)
  const altOrderDataRegex = /\[_?\/?ORDER_?DATA_?\]([\s\S]*?)\[\/?\s*_?\/?ORDER_?DATA_?\]/gi;
  const bracketTagRegex = /\[_\]([\s\S]*?)\[\/\_\]/gi;
  
  const match = text.match(orderDataRegex) || text.match(altOrderDataRegex) || text.match(bracketTagRegex);
  
  if (match && match.length > 0) {
    try {
      // استخراج JSON من أول match
      const jsonMatch = match[0].match(/\[(?:ORDER_DATA|_)\]([\s\S]*?)\[\/(?:ORDER_DATA|_)\]/i);
      if (jsonMatch && jsonMatch[1]) {
        const orderData = JSON.parse(jsonMatch[1].trim());
        // ✅ إزالة ORDER_DATA tag بالكامل من النص (جميع التكرارات)
        let cleanText = text.replace(orderDataRegex, '').trim();
        cleanText = cleanText.replace(altOrderDataRegex, '').trim();
        cleanText = cleanText.replace(bracketTagRegex, '').trim();
        // ✅ إزالة أي JSON structure متبقي (أي شيء بين { و } يحتوي أكثر من 50 حرف)
        cleanText = cleanText.replace(/\{[\s\S]{50,}?\}/g, '').trim();
        // ✅ إزالة أي أقواس مربعة فارغة أو مع محتوى ORDER
        cleanText = cleanText.replace(/\[\s*\/?\s*(?:ORDER_?DATA|_)?\s*\]/gi, '').trim();
        // ✅ إزالة المسافات والأسطر الفارغة المتكررة
        cleanText = cleanText.replace(/\n{3,}/g, '\n\n').trim();
        
        console.log('[extractOrderData] Successfully extracted order data:', {
          customerName: orderData.customerName,
          customerPhone: orderData.customerPhone
        });
        
        return { orderData, cleanText };
      }
    } catch (error) {
      console.error('[extractOrderData] Error parsing ORDER_DATA:', error);
      logger.error('Error parsing ORDER_DATA', error as Error);
    }
  }
  
  // ✅ حتى لو لم نجد ORDER_DATA صالح، أزل أي JSON structure طويل
  let cleanText = text;
  cleanText = cleanText.replace(orderDataRegex, '').trim();
  cleanText = cleanText.replace(altOrderDataRegex, '').trim();
  cleanText = cleanText.replace(bracketTagRegex, '').trim();
  cleanText = cleanText.replace(/\{[\s\S]{50,}?\}/g, '').trim();
  cleanText = cleanText.replace(/\[\s*\/?\s*(?:ORDER_?DATA|_)?\s*\]/gi, '').trim();
  cleanText = cleanText.replace(/\n{3,}/g, '\n\n').trim();
  
  return { orderData: null, cleanText };
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
      userName,
      messageText: messageText.substring(0, 50)
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
            textPreview: voiceResult.transcript?.text?.substring(0, 80),
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
            console.log('[processTelegramMessage] Image analyzed, augmented messageText:', messageText.substring(0, 200));
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
      messageText: messageText.substring(0, 50),
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

    // ==================== Process through NEW orchestrator ====================
    let responseText: string;
    let updatedState: ConversationState = conversationState;

    const stopTypingKeepalive = botToken
      ? startTypingKeepalive(() => sendTelegramTyping(chatId, botToken))
      : () => undefined;
    
    try {
      // ✅ بناء merchantConfig للنظام الجديد
      const merchantConfig: Partial<MerchantConfig> = {
        merchantId,
        storeName: settings.store_name || 'المتجر',
        storeCurrency: settings.store_currency || 'USD',
        systemPrompt: settings.system_prompt || '',
        persona: (settings.bot_persona || 'friendly') as any,
        shippingPolicy: settings.shipping_policy || '',
        deliveryTime: settings.delivery_time || '',
        paymentMethods: settings.payment_methods || '',
        returnPolicy: settings.return_policy || '',
        additionalNotes: settings.additional_notes || '',
        botLanguage: 'auto',
        
      };

      const result = await handleIncomingMessage({
        merchantId,
        platform: 'telegram',
        userId,
        userName: userName || 'عميل',
        messageText,
        externalMessageId: update.message?.message_id?.toString() || '',
        recentMessages,           // ✅ الرسائل السابقة
        conversationState,        // ✅ حالة المحادثة
        merchantConfig            // ✅ اسم جديد
      });

      responseText = result.replyText;
      updatedState = result.updatedState;

      // Shared gate: ORDER_DATA only when pipeline next_action === confirm_order
      const entities = updatedState.extracted_entities || {};
      const products = updatedState.last_recommended_products || [];
      responseText = appendOrderDataIfConfirmed({
        responseText,
        nextAction: result.next_action,
        entities,
        productIds: products,
        storeCurrency: settings?.store_currency || 'USD',
        channelLabel: 'Telegram (Full AI Mode)',
      });

      if (result.next_action === 'confirm_order' && responseText.includes('[ORDER_DATA]')) {
        console.log('[processTelegramMessage] Full AI Mode: Order confirmed, ORDER_DATA attached:', {
          name: entities.name,
          productsCount: products.length,
          next_action: result.next_action
        });
      }

      if (result.shouldEscalate) {
        await escalateConversationToHuman({
          merchantId,
          conversationId,
          platform: 'telegram',
          userId,
          userName: userName || 'عميل',
          reason: result.next_action === 'handoff' ? 'handoff_action' : 'escalate_marker',
          replyPreview: responseText,
        });
      }

      responseText = stripInternalControlMarkers(responseText);

      console.log('[processTelegramMessage] NEW Orchestrator response generated:', {
        conversationId,
        responseLength: responseText.length,
        responsePreview: responseText.substring(0, 100),
        // ✅ metadata جديدة من النظام الجديد
        pipelineUsed: result.meta.pipelineUsed,
        aiCallsCount: result.meta.aiCallsCount,
        processingTimeMs: result.meta.processingTimeMs,
        intent: result.meta.intent,
        stage: result.meta.stage
      });

      logger.info('Telegram message processed via NEW orchestrator', {
        merchantId,
        conversationId,
        pipelineUsed: result.meta.pipelineUsed,
        aiCallsCount: result.meta.aiCallsCount,
        processingTimeMs: result.meta.processingTimeMs
      });

      // ✅ حفظ الرسائل في قاعدة البيانات (النظام الجديد لا يحفظها تلقائياً)
      try {
        // حفظ رسالة المستخدم
        await pool.query(
          `INSERT INTO messages (conversation_id, role, content, metadata, intent, entities)
           VALUES ($1, 'user', $2, $3, $4, $5)`,
          [
            conversationId,
            messageText,
            JSON.stringify({
              platform: 'telegram',
              timestamp: new Date().toISOString(),
              externalId: update.message?.message_id?.toString() || null,
              ...(inboundImageUrl
                ? { type: 'image', imageUrl: inboundImageUrl }
                : { type: 'text' }),
            }),
            result.meta.intent,
            JSON.stringify({})
          ]
        );

        // حفظ رد البوت
        await pool.query(
          `INSERT INTO messages (conversation_id, role, content, metadata, intent, entities)
           VALUES ($1, 'assistant', $2, $3, $4, $5)`,
          [
            conversationId,
            responseText,
            JSON.stringify({
              platform: 'telegram',
              pipelineUsed: result.meta.pipelineUsed,
              aiCallsCount: result.meta.aiCallsCount,
              processingTimeMs: result.meta.processingTimeMs
            }),
            result.meta.intent,
            JSON.stringify({})
          ]
        );

        // ✅ تحديث حالة المحادثة
        await pool.query(
          `UPDATE conversations 
           SET conversation_state = $1,
               current_intent = $2,
               stage = $3,
               last_message_at = CURRENT_TIMESTAMP,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = $4 AND merchant_id = $5`,
          [
            JSON.stringify(updatedState),
            result.meta.intent,
            result.meta.stage,
            conversationId,
            merchantId
          ]
        );

        console.log('[processTelegramMessage] Messages and state saved successfully');
      } catch (saveError) {
        logger.error('Failed to save messages after successful processing', saveError as Error);
      }
    } catch (orchestratorError: any) {
      // Orchestrator failed - log, save messages manually, and return error
      logger.error('Orchestrator failed completely', orchestratorError as Error, {
        merchantId,
        conversationId,
        userId
      });

      responseText = 'عذراً، حدث خطأ في معالجة رسالتك. يرجى المحاولة مرة أخرى.';
      
      // Save user message and error response manually since orchestrator failed
      try {
        await pool.query(
          `INSERT INTO messages (conversation_id, role, content)
           SELECT $1, 'user', $2
           FROM conversations
           WHERE id = $1 AND merchant_id = $3`,
          [conversationId, messageText, merchantId]
        );
        
        await pool.query(
          `INSERT INTO messages (conversation_id, role, content)
           SELECT $1, 'assistant', $2
           FROM conversations
           WHERE id = $1 AND merchant_id = $3`,
          [conversationId, responseText, merchantId]
        );
      } catch (saveError) {
        logger.error('Failed to save messages after orchestrator failure', saveError as Error);
      }
      
      console.log('[processTelegramMessage] Orchestrator failed, sending error message');
    } finally {
      stopTypingKeepalive();
    }

    // ✅ Extract ORDER_DATA and remove it from message text
    let { orderData, cleanText: responseWithoutOrderData } = extractOrderData(responseText);
    
    // Extract image URL from response if present (use cleaned text)
    const { imageUrl, cleanText } = extractImageUrl(responseWithoutOrderData);
    
    // ✅ Process order if ORDER_DATA was found (from either Hybrid or Full AI Mode)
    if (orderData && orderData.customerName && orderData.customerPhone && 
        orderData.customerAddress && orderData.products && 
        Array.isArray(orderData.products) && orderData.products.length > 0) {
      
      console.log('[processTelegramMessage] ORDER_DATA detected, processing order:', {
        merchantId,
        customerName: orderData.customerName,
        productsCount: orderData.products.length
      });
      
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        // ✅ Full AI Mode: Fetch product prices from database if not provided
        for (const product of orderData.products) {
          if (product.productId && (!product.price || product.price === 0)) {
            try {
              const productResult = await client.query(
                `SELECT price, currency, name FROM products 
                 WHERE id = $1 AND merchant_id = $2`,
                [product.productId, merchantId]
              );
              
              if (productResult.rows.length > 0) {
                product.price = parseFloat(productResult.rows[0].price);
                product.currency = productResult.rows[0].currency || settings?.store_currency || 'USD';
                product.productName = productResult.rows[0].name;
                
                console.log('[processTelegramMessage] Fetched product price from DB:', {
                  productId: product.productId,
                  price: product.price,
                  productName: product.productName
                });
              }
            } catch (priceError) {
              logger.error('Error fetching product price', priceError as Error, { productId: product.productId });
            }
          }
        }
        
        // Calculate total
        orderData.total = orderData.products.reduce((sum: number, item: any) => 
          sum + ((item.price || 0) * (item.quantity || 1)), 0
        );
        
        console.log('[processTelegramMessage] Order total calculated:', {
          total: orderData.total,
          products: orderData.products.map((p: any) => ({ 
            name: p.productName, 
            price: p.price, 
            qty: p.quantity 
          }))
        });

        // Generate email if not provided
        const customerEmail = orderData.customerEmail?.trim() || 
          `${orderData.customerPhone.replace(/\s+/g, '').replace(/[^0-9]/g, '')}@chat-order.com`;
        const deliveryNote = orderData.deliveryTime ? `وقت التوصيل: ${orderData.deliveryTime}` : null;
        const baseNotes = orderData.notes || 'Order created via Telegram bot';
        const combinedNotes = deliveryNote ? `${baseNotes} | ${deliveryNote}` : baseNotes;

        // Check if customer exists (by phone or email)
        let customerId: string | null = null;
        
        const existingCustomer = await client.query(
          `SELECT id FROM customers 
           WHERE merchant_id = $1 
           AND (phone = $2 OR email = $3)
           LIMIT 1`,
          [merchantId, orderData.customerPhone, customerEmail]
        );

        if (existingCustomer.rows.length > 0) {
          // Customer exists - update their information
          customerId = existingCustomer.rows[0].id;
          
          await client.query(
            `UPDATE customers 
             SET name = COALESCE($1, name),
                 email = COALESCE($2, email),
                 phone = COALESCE($3, phone),
                 address = COALESCE($4, address),
                 notes = CASE 
                   WHEN $7::text IS NULL OR $7::text = '' THEN notes 
                   ELSE COALESCE(notes, '') || ' | ' || $7::text 
                 END,
                 last_interaction_date = CURRENT_TIMESTAMP,
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = $5 AND merchant_id = $6`,
            [
              orderData.customerName,
              customerEmail,
              orderData.customerPhone,
              orderData.customerAddress,
              customerId,
              merchantId, // ✅ SaaS: Ensure merchant isolation
              deliveryNote
            ]
          );
          
          console.log('[processTelegramMessage] Customer updated in CRM:', { customerId });
        } else {
          // Customer doesn't exist - create new customer
          const customerResult = await client.query(
            `INSERT INTO customers (
              merchant_id, name, email, phone, address,
              customer_type, status, notes, tags
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            RETURNING id`,
            [
              merchantId,
              orderData.customerName,
              customerEmail,
              orderData.customerPhone,
              orderData.customerAddress,
              'new',
              'active',
              combinedNotes,
              ['bot-order', 'telegram']
            ]
          );
          
          customerId = customerResult.rows[0].id;
          console.log('[processTelegramMessage] New customer created in CRM:', { customerId });
        }

        // Prevent duplicate orders: check recent pending orders for same phone within 5 minutes
        const duplicateOrderCheck = await client.query(
          `SELECT id FROM orders 
             WHERE merchant_id = $1 
               AND customer_phone = $2 
               AND status IN ('pending','new','processing')
               AND created_at >= NOW() - INTERVAL '5 minutes'
             ORDER BY created_at DESC
             LIMIT 1`,
          [merchantId, orderData.customerPhone]
        );

        let orderId: string;
        let isDuplicateOrder = false;
        if (duplicateOrderCheck.rows.length > 0) {
          orderId = duplicateOrderCheck.rows[0].id;
          isDuplicateOrder = true;
          console.log('[processTelegramMessage] Duplicate order prevented, using existing order:', { orderId });
        } else {
          // Create order
          const deliveryTimeColumnCheck = await client.query(`
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_schema = 'public' 
            AND table_name = 'orders' 
            AND column_name = 'delivery_time'
          `);
          const hasDeliveryTimeColumn = deliveryTimeColumnCheck.rows.length > 0;

          const orderInsertQuery = hasDeliveryTimeColumn
            ? `INSERT INTO orders (
                merchant_id, customer_name, customer_email, 
                customer_phone, customer_address, delivery_time,
                total, currency, status, source, notes
              ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
              RETURNING id`
            : `INSERT INTO orders (
                merchant_id, customer_name, customer_email, 
                customer_phone, customer_address,
                total, currency, status, source, notes
              ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
              RETURNING id`;

          const orderInsertParams = hasDeliveryTimeColumn
            ? [
                merchantId,
                orderData.customerName,
                customerEmail,
                orderData.customerPhone,
                orderData.customerAddress,
                orderData.deliveryTime || null,
                orderData.total || 0,
                settings.store_currency || 'USD',
                'pending',
                'bot',
                combinedNotes
              ]
            : [
                merchantId,
                orderData.customerName,
                customerEmail,
                orderData.customerPhone,
                orderData.customerAddress,
                orderData.total || 0,
                settings.store_currency || 'USD',
                'pending',
                'bot',
                combinedNotes
              ];

          const orderResult = await client.query(orderInsertQuery, orderInsertParams);

          orderId = orderResult.rows[0].id;
        }

        // Create order items with UUID validation
        for (const item of orderData.products) {
          // ✅ تنظيف وتصحيح UUID المنتج
          const sanitizedProductId = sanitizeUUID(item.productId);
          
          if (item.productId && !sanitizedProductId) {
            console.warn('[processTelegramMessage] Invalid productId detected and sanitized:', {
              original: item.productId,
              sanitized: sanitizedProductId,
              productName: item.productName
            });
          }

          // 🔥 منع تكرار نفس المنتج إذا كان الطلب مكرراً، مع تحديث الكمية إذا تغيرت
          if (isDuplicateOrder) {
            const existingItemCheck = await client.query(
              `SELECT id, quantity FROM order_items WHERE order_id = $1 AND (product_id = $2 OR product_name = $3) LIMIT 1`,
              [orderId, sanitizedProductId, item.productName || 'Unknown Product']
            );
            
            if (existingItemCheck.rows.length > 0) {
              const existingQty = existingItemCheck.rows[0].quantity || 1;
              const newQty = item.quantity || 1;
              if (newQty > existingQty) {
                await client.query(
                  `UPDATE order_items SET quantity = $1 WHERE id = $2`,
                  [newQty, existingItemCheck.rows[0].id]
                );
                // Also update order total
                const priceDiff = (newQty - existingQty) * (item.price || 0);
                await client.query(
                  `UPDATE orders SET total = total + $1 WHERE id = $2`,
                  [priceDiff, orderId]
                );
                console.log('[processTelegramMessage] Updated quantity for existing item:', { productName: item.productName, newQty });
              } else {
                console.log('[processTelegramMessage] Item already exists in duplicate order, skipping insertion:', { productName: item.productName });
              }
              continue;
            }
          }
          
          await client.query(
            `INSERT INTO order_items (
              order_id, product_id, product_name, quantity, price, currency
            ) VALUES ($1, $2, $3, $4, $5, $6)`,
            [
              orderId,
              sanitizedProductId,  // ✅ استخدام UUID النظيف أو null
              item.productName || 'Unknown Product',
              item.quantity || 1,
              item.price || 0,
              settings.store_currency || 'USD'
            ]
          );

          if (isDuplicateOrder) {
            const addedPrice = (item.quantity || 1) * (item.price || 0);
            await client.query(
              `UPDATE orders SET total = total + $1 WHERE id = $2`,
              [addedPrice, orderId]
            );
            console.log('[processTelegramMessage] Added new item to duplicate order, updated total:', { productName: item.productName, addedPrice });
          }
        }

        // Update customer stats
        await client.query(
          `UPDATE customers 
           SET total_orders = total_orders + ${isDuplicateOrder ? '0' : '1'},
               total_spent = total_spent + $1,
               last_order_date = CURRENT_TIMESTAMP,
               last_interaction_date = CURRENT_TIMESTAMP
           WHERE id = $2 AND merchant_id = $3`,
          [orderData.total || 0, customerId, merchantId] // ✅ SaaS: Ensure merchant isolation
        );

        // Create customer interaction record
        await client.query(
          `INSERT INTO customer_interactions (
            customer_id, merchant_id, interaction_type, 
            title, description, platform, related_order_id
          ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            customerId,
            merchantId,
            'order',
            'Order Created via Telegram Bot',
            `Order #${orderId} created via Telegram bot`,
            'telegram',
            orderId
          ]
        );

        await client.query('COMMIT');
        
        console.log('[processTelegramMessage] Order processed successfully:', {
          orderId,
          customerId,
          total: orderData.total
        });
        
        logger.info('Telegram order processed successfully', {
          merchantId,
          orderId,
          customerId,
          total: orderData.total
        });

        if (!isDuplicateOrder) {
          notifyMerchantNewOrderAsync({
            merchantId,
            orderId,
            customerName: orderData.customerName,
            customerPhone: orderData.customerPhone,
            customerEmail,
            customerAddress: orderData.customerAddress,
            deliveryTime: orderData.deliveryTime || null,
            notes: combinedNotes,
            total: orderData.total || 0,
            currency: settings?.store_currency || 'USD',
            source: 'telegram',
            items: (orderData.products || []).map((p: any) => ({
              productName: p.productName,
              quantity: p.quantity || 1,
              price: p.price || 0,
            })),
          });
        }

        // 🧹 FULL RESET: After successful order → restart conversation fresh
        const confirmedProductName =
          updatedState.extracted_entities?.product_query ||
          orderData.products?.[0]?.productName ||
          'المنتج';
        const confirmedCustomerName = updatedState.extracted_entities?.name || '';

        updatedState.last_order = {
          orderId,
          productName: confirmedProductName,
          customerName: confirmedCustomerName,
          confirmedAt: new Date().toISOString()
        };

        updatedState.extracted_entities = {};
        updatedState.last_recommended_products = [];
        updatedState.current_stage = 'discover';
        updatedState.salesgpt_stage_id = '1';
        updatedState.last_intent = 'greeting';
        updatedState.message_count = 0;
        updatedState.awaiting_order_confirmation = false;
        delete updatedState.abandoned_checkout;

        console.log('🧹 Telegram: Full state reset after order. last_order saved:', {
          orderId,
          productName: confirmedProductName,
          customerName: confirmedCustomerName
        });

        // 💾 Persist reset state + last_order (was only in memory — next message must load this from DB)
        await pool.query(
          `UPDATE conversations 
           SET conversation_state = $1,
               current_intent = $2,
               stage = $3,
               last_message_at = CURRENT_TIMESTAMP,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = $4 AND merchant_id = $5`,
          [
            JSON.stringify(updatedState),
            updatedState.last_intent || 'greeting',
            updatedState.current_stage || 'discover',
            conversationId,
            merchantId
          ]
        );
      } catch (orderError) {
        await client.query('ROLLBACK');
        
        // ✅ تحديد نوع الخطأ للتشخيص الأفضل
        const errorMessage = (orderError as Error).message || 'Unknown error';
        const isUUIDError = errorMessage.includes('uuid') || errorMessage.includes('invalid input syntax');
        const isDuplicateError = errorMessage.includes('duplicate') || errorMessage.includes('unique');
        
        console.error('[processTelegramMessage] Error processing order:', {
          error: errorMessage,
          errorType: isUUIDError ? 'INVALID_UUID' : isDuplicateError ? 'DUPLICATE' : 'UNKNOWN',
          merchantId,
          customerPhone: orderData.customerPhone,
          productsCount: orderData.products?.length || 0
        });
        
        logger.error('Error processing Telegram order', orderError as Error, {
          merchantId,
          errorType: isUUIDError ? 'INVALID_UUID' : 'OTHER',
          orderDataSummary: {
            customerName: orderData.customerName,
            customerPhone: orderData.customerPhone,
            productsCount: orderData.products?.length || 0
          }
        });
        
        // Don't fail the message sending if order processing fails
        // The user still gets the response, but order needs manual review
      } finally {
        client.release();
      }
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
      body: req.body ? JSON.stringify(req.body).substring(0, 200) : 'no body'
    });
    logger.info('Telegram webhook received', {
      path: req.path,
      method: req.method,
      hasBody: !!req.body,
      bodyKeys: req.body ? Object.keys(req.body) : []
    });

    // ✅ SaaS: Identify merchant by webhook secret (unique per merchant)
    const receivedSecret = req.headers['x-telegram-bot-api-secret-token'];
    
    console.log('[Telegram Webhook] Identifying merchant:', {
      hasSecret: !!receivedSecret,
      secretPreview: receivedSecret ? receivedSecret.substring(0, 10) + '...' : 'none'
    });
    
    let merchantId: string | null = null;
    let merchantResult: any;

    if (receivedSecret) {
      // Try to find bot by webhook secret (new multiple bots approach)
      try {
        // First try telegram_bots table (new approach)
        let botResult = await pool.query(
          `SELECT merchant_id, bot_token, bot_type, id as bot_id
           FROM telegram_bots 
           WHERE webhook_secret = $1 AND is_active = true`,
          [receivedSecret]
        );

        if (botResult.rows.length > 0) {
          merchantId = botResult.rows[0].merchant_id;
          // Store bot info for later use (update will be defined later)
          const botId = botResult.rows[0].bot_id;
          const botType = botResult.rows[0].bot_type;
          console.log('[Telegram Webhook] Bot identified by secret:', { merchantId, botId, botType });
          logger.info('Telegram webhook bot identified by secret', { merchantId, botId });
          
          // Store in a way that processTelegramMessage can access
          (req as any).telegramBotId = botId;
          (req as any).telegramBotType = botType;
        } else {
          // Fallback to legacy merchant_settings table
          merchantResult = await pool.query(
            `SELECT merchant_id, telegram_bot_token 
             FROM merchant_settings 
             WHERE telegram_webhook_secret = $1`,
            [receivedSecret]
          );

          if (merchantResult.rows.length > 0) {
            merchantId = merchantResult.rows[0].merchant_id;
            (req as any).telegramBotType = 'both'; // Default for legacy bots
            console.log('[Telegram Webhook] Merchant identified by secret (legacy):', { merchantId });
            logger.info('Telegram webhook merchant identified by secret (legacy)', { merchantId });
          } else {
            console.log('[Telegram Webhook] No bot or merchant found with this secret');
          }
        }
      } catch (error) {
        console.error('[Telegram Webhook] Error querying by secret:', error);
        logger.error('Error querying bot by webhook secret', error as Error);
      }
    }

    // ✅ Fallback: If no merchant found by secret, try legacy approach (for existing bots)
    // This allows existing bots to continue working until they reconnect
    if (!merchantId) {
      console.log('[Telegram Webhook] Trying legacy fallback...');
      logger.warn('Telegram webhook: No merchant found by secret, trying legacy fallback', {
        hasSecret: !!receivedSecret,
        secretPreview: receivedSecret ? receivedSecret.substring(0, 10) + '...' : 'none'
      });

      try {
        // Legacy: Find merchant by testing bot tokens (for backward compatibility)
        const allMerchantsResult = await pool.query(
          `SELECT merchant_id, telegram_bot_token 
           FROM merchant_settings 
           WHERE telegram_bot_token IS NOT NULL AND telegram_bot_token != ''`
        );

        console.log('[Telegram Webhook] Found merchants with bot tokens:', { count: allMerchantsResult.rows.length });

        if (allMerchantsResult.rows.length === 0) {
          console.log('[Telegram Webhook] No merchants found with Telegram bot configured');
          logger.warn('No merchants found with Telegram bot configured');
          return next(createError('No merchant found', 404));
        }

        // If only one merchant, use it directly
        if (allMerchantsResult.rows.length === 1) {
          merchantId = allMerchantsResult.rows[0].merchant_id;
          console.log('[Telegram Webhook] Using single merchant (legacy fallback):', { merchantId });
          logger.info('Telegram webhook: Using single merchant (legacy fallback)', { merchantId });
        } else {
          // Multiple merchants - need to identify by bot token
          // This is less efficient but necessary for backward compatibility
          console.log('[Telegram Webhook] Multiple merchants found, using first as fallback:', {
            merchantCount: allMerchantsResult.rows.length,
            firstMerchantId: allMerchantsResult.rows[0].merchant_id
          });
          logger.warn('Telegram webhook: Multiple merchants found, using legacy token matching (inefficient)', {
            merchantCount: allMerchantsResult.rows.length
          });
          
          // Try to identify by matching bot token (if we can extract bot info from update)
          // For now, use first merchant as fallback (not ideal but works)
          merchantId = allMerchantsResult.rows[0].merchant_id;
          logger.warn('Telegram webhook: Using first merchant as fallback (should reconnect bot for proper SaaS support)', {
            merchantId
          });
        }
      } catch (error) {
        console.error('[Telegram Webhook] Error in legacy fallback:', error);
        logger.error('Error in legacy fallback for Telegram webhook', error as Error);
        return next(createError('Error identifying merchant', 500));
      }
    }

    if (!merchantId) {
      console.error('[Telegram Webhook] Could not identify merchant');
      logger.error('Telegram webhook: Could not identify merchant', new Error('Merchant identification failed'), {
        hasSecret: !!receivedSecret
      });
      return next(createError('Could not identify merchant', 500));
    }
    
    console.log('[Telegram Webhook] Merchant identified successfully:', {
      merchantId,
      method: receivedSecret ? 'webhook_secret' : 'legacy_fallback'
    });
    logger.info('Telegram webhook merchant identified', {
      merchantId,
      method: receivedSecret ? 'webhook_secret' : 'legacy_fallback'
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
        text: update.message.text?.substring(0, 50)
      });
      logger.info('Processing Telegram message', {
        merchantId,
        chatId: update.message.chat?.id,
        userId: update.message.from?.id,
        text: update.message.text?.substring(0, 50)
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
        update: update ? JSON.stringify(update).substring(0, 200) : 'no update'
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

    // Don't expose full bot_token, only show last 10 characters
    const bots = result.rows.map(row => ({
      id: row.id,
      botName: row.bot_name,
      botUsername: row.bot_username,
      botType: row.bot_type,
      isActive: row.is_active,
      tokenPreview: row.bot_token ? `${row.bot_token.substring(0, 10)}...` : null,
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
