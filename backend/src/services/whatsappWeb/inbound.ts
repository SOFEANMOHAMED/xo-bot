import type { WAMessage } from '@whiskeysockets/baileys';
import pool from '../../database/connection.js';
import { logger } from '../../utils/logger.js';
import type { ConversationState, Message } from '../../bot/index.js';
import { getCachedMerchantSettings } from '../cacheService.js';
import {
  extractImageUrl,
  extractOrderData,
  persistOrderIfPresent,
  runSalesBotTurn,
} from '../channels/botTurn.js';
import { buildMerchantBotConfig } from '../buildMerchantBotConfig.js';
import { stripInternalControlMarkers } from '../../response/sanitize-reply.js';
import {
  deliverHumanLikeReply,
  startTypingKeepalive
} from '../channels/replyDelivery.js';
import { conversationIngressQueue } from '../conversationIngressQueue.js';
import { analyzeImageAndSearch } from '../imageRecognition.js';
import {
  resolveInboundVoice,
  voiceTranscriptionFallbackMessage
} from '../voiceTranscription.js';
import { getCurrencyDisplayName } from '../../utils/currencyDisplayName.js';
import { getWhatsAppWebSession } from './sessionStore.js';
import {
  sendWhatsAppWebImage,
  sendWhatsAppWebText,
  sendWhatsAppWebTyping
} from './outbound.js';
import {
  downloadInboundMedia,
  extractInboundText,
  inboundHasAudio,
  inboundHasImage,
  persistInboundImage,
  unwrapMessageContent
} from './media.js';
import { isDirectCustomerJid, normalizeWhatsAppJid } from './jid.js';
import { wasSentByBot } from './runtimeRegistry.js';
import { isPlaceholderCustomerName } from '../socialProfile.js';

type PreparedInbound = {
  merchantId: string;
  userId: string;
  userName: string;
  messageId: string;
  messageText: string;
  imageUrl: string | null;
};

async function getOrCreateConversation(
  merchantId: string,
  userId: string,
  userName: string
): Promise<{ conversationId: string; conversationState: ConversationState }> {
  const existing = await pool.query(
    `SELECT id, conversation_state, current_intent
     FROM conversations
     WHERE merchant_id = $1 AND platform = 'whatsapp' AND user_id = $2
     ORDER BY last_message_at DESC NULLS LAST
     LIMIT 1`,
    [merchantId, userId]
  );

  if (existing.rows.length > 0) {
    const row = existing.rows[0];
    const conversationState: ConversationState = row.conversation_state || { message_count: 0 };
    if (row.current_intent) conversationState.last_intent = row.current_intent;
    return { conversationId: row.id, conversationState };
  }

  const created = await pool.query(
    `INSERT INTO conversations (merchant_id, platform, user_id, user_name)
     VALUES ($1, 'whatsapp', $2, $3)
     RETURNING id`,
    [merchantId, userId, userName || 'عميل واتساب']
  );
  return { conversationId: created.rows[0].id, conversationState: { message_count: 0 } };
}

async function persistCustomerMessage(params: {
  merchantId: string;
  conversationId: string;
  messageText: string;
  messageId: string;
  imageUrl: string | null;
}): Promise<void> {
  await pool.query(
    `INSERT INTO messages (conversation_id, role, content, sender_type, external_message_id, source, metadata)
     VALUES ($1, 'user', $2, 'user', $3, 'whatsapp', $4::jsonb)`,
    [
      params.conversationId,
      params.messageText,
      params.messageId || null,
      JSON.stringify({
        platform: 'whatsapp',
        ...(params.imageUrl ? { type: 'image', imageUrl: params.imageUrl } : { type: 'text' })
      })
    ]
  );
  await pool.query(
    `UPDATE conversations
     SET last_message_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
     WHERE id = $1 AND merchant_id = $2`,
    [params.conversationId, params.merchantId]
  );
}

async function processBotTurn(payload: PreparedInbound): Promise<void> {
  const { merchantId, userId, userName, messageId } = payload;
  let { messageText, imageUrl } = payload;

  const session = await getWhatsAppWebSession(merchantId);
  if (session?.auto_reply_enabled !== true) {
    const { conversationId } = await getOrCreateConversation(merchantId, userId, userName);
    await persistCustomerMessage({ merchantId, conversationId, messageText, messageId, imageUrl });
    return;
  }

  const settings = (await getCachedMerchantSettings(merchantId)) || {
    store_name: 'المتجر',
    store_currency: 'USD',
    system_prompt: '',
    bot_persona: 'friendly',
    shipping_policy: '',
    delivery_time: '',
    payment_methods: '',
    return_policy: '',
    additional_notes: '',
  };

  if (imageUrl) {
    try {
      const media = await fetch(imageUrl);
      const buf = Buffer.from(await media.arrayBuffer());
      const mime = media.headers.get('content-type') || 'image/jpeg';
      const dataUrl = `data:${mime};base64,${buf.toString('base64')}`;
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
      }
    } catch (error) {
      logger.error('WhatsApp Web image analysis failed', error as Error, { merchantId });
    }
    if (!messageText.trim()) messageText = '📷 صورة';
  }

  const { conversationId, conversationState } = await getOrCreateConversation(
    merchantId,
    userId,
    userName
  );

  const convStatus = await pool.query(
    `SELECT bot_disabled, status, last_human_response_at FROM conversations WHERE id = $1 AND merchant_id = $2`,
    [conversationId, merchantId]
  );
  const conv = convStatus.rows[0] || { bot_disabled: false, status: 'bot' };

  const lastMessageCheck = await pool.query(
    `SELECT sender_type, created_at
     FROM messages
     WHERE conversation_id = $1
     ORDER BY created_at DESC
     LIMIT 1`,
    [conversationId]
  );

  let shouldSkipBotReply = false;
  let skipReason = '';
  if (conv.bot_disabled || conv.status === 'human') {
    shouldSkipBotReply = true;
    skipReason = 'Bot disabled or conversation assigned to human';
  } else if (lastMessageCheck.rows.length > 0) {
    const lastMsg = lastMessageCheck.rows[0];
    if (lastMsg.sender_type === 'human') {
      const minutesSinceHuman =
        (Date.now() - new Date(lastMsg.created_at).getTime()) / (1000 * 60);
      if (minutesSinceHuman < 5) {
        shouldSkipBotReply = true;
        skipReason = `Recent human response (${Math.round(minutesSinceHuman)} minutes ago)`;
      }
    }
  }

  if (shouldSkipBotReply) {
    await persistCustomerMessage({ merchantId, conversationId, messageText, messageId, imageUrl });
    logger.info('WhatsApp Web bot skipped — conversation in human mode', {
      merchantId,
      conversationId,
      reason: skipReason
    });
    return;
  }

  const recentMessagesResult = await pool.query(
    `SELECT role, content FROM messages
     WHERE conversation_id = $1
     ORDER BY created_at DESC
     LIMIT 25`,
    [conversationId]
  );
  const recentMessages: Message[] = recentMessagesResult.rows
    .reverse()
    .map((row) => ({ role: row.role as 'user' | 'assistant', content: row.content }));

  const { getMerchantPlanLimits, getMonthlyAIResponseCount, isWithinLimit } = await import(
    '../../utils/planLimits.js'
  );
  const limits = await getMerchantPlanLimits(merchantId);
  if (!limits.hasSalesBot) {
    logger.info('Sales bot not included in plan — skipping WhatsApp Web auto-reply', { merchantId });
    await persistCustomerMessage({ merchantId, conversationId, messageText, messageId, imageUrl });
    return;
  }
  const currentCount = await getMonthlyAIResponseCount(merchantId);
  if (!isWithinLimit(currentCount, limits.maxMonthlyAIResponses)) {
    logger.warn('AI response limit exceeded for WhatsApp Web', { merchantId, currentCount });
    await persistCustomerMessage({ merchantId, conversationId, messageText, messageId, imageUrl });
    return;
  }

  const stopTyping = startTypingKeepalive(() => sendWhatsAppWebTyping(merchantId, userId, true));
  let responseText = '';
  let updatedState: ConversationState = conversationState;

  try {
    const turn = await runSalesBotTurn({
      merchantId,
      platform: 'whatsapp',
      escalatePlatform: 'whatsapp',
      userId,
      userName: isPlaceholderCustomerName(userName) ? 'عميل' : userName,
      messageText,
      externalMessageId: messageId,
      recentMessages,
      conversationState,
      merchantConfig: buildMerchantBotConfig({ merchantId, settings }),
      conversationId,
      storeCurrency: settings.store_currency || 'USD',
      channelLabel: 'WhatsApp Web',
      pool,
      userMessageMetadata: imageUrl
        ? { type: 'image', imageUrl }
        : { type: 'text' },
    });

    responseText = turn.responseText;
    updatedState = turn.updatedState;

    if (turn.failed) {
      logger.error('WhatsApp Web orchestrator failed', new Error('SalesGPT turn failed'), {
        merchantId,
        conversationId,
      });
    }
  } catch (error) {
    logger.error('WhatsApp Web orchestrator failed', error as Error, { merchantId, conversationId });
    responseText = 'عذراً، حدث خطأ في معالجة رسالتك. يرجى المحاولة مرة أخرى.';
  } finally {
    stopTyping();
  }

  const { orderData, cleanText: withoutOrder } = extractOrderData(responseText);
  const { imageUrl: replyImage, cleanText } = extractImageUrl(withoutOrder);

  if (orderData) {
    await persistOrderIfPresent({
      pool,
      merchantId,
      conversationId,
      orderData,
      settings: { store_currency: settings.store_currency || 'USD' },
      labels: {
        defaultBaseNotes: 'Order created via WhatsApp bot',
        customerTags: ['bot-order', 'whatsapp'],
        interactionTitle: 'Order Created via WhatsApp Bot',
        interactionDescription: (orderId: string) => `Order #${orderId} created via WhatsApp bot`,
        interactionPlatform: 'whatsapp',
        logPrefix: 'whatsappWebInbound'
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

  const finalText = stripInternalControlMarkers(cleanText);
  const hasImage = !!(replyImage && replyImage.startsWith('http'));
  if (!finalText.trim() && !hasImage) return;

  await deliverHumanLikeReply({
    text: finalText,
    imageUrl: hasImage ? replyImage : null,
    transport: {
      setTyping: (on) => sendWhatsAppWebTyping(merchantId, userId, on),
      sendText: (bubble) => sendWhatsAppWebText(merchantId, userId, bubble),
      sendImage: (url, caption) => sendWhatsAppWebImage(merchantId, userId, url, caption)
    },
    context: { merchantId, platform: 'whatsapp', conversationId }
  });
}

async function prepareInboundFromWaMessage(
  merchantId: string,
  message: WAMessage
): Promise<PreparedInbound | null> {
  const remoteJid = normalizeWhatsAppJid(message.key?.remoteJid || undefined);
  if (!isDirectCustomerJid(remoteJid)) return null;

  const content = unwrapMessageContent(message.message);
  let messageText = extractInboundText(content);
  const messageId = message.key?.id || '';
  const userName = isPlaceholderCustomerName(message.pushName)
    ? 'عميل واتساب'
    : (message.pushName as string).trim();
  let imageUrl: string | null = null;

  if (inboundHasImage(content)) {
    imageUrl = await persistInboundImage(merchantId, message);
  }

  if (inboundHasAudio(content)) {
    const media = await downloadInboundMedia(message);
    if (media?.buffer) {
      const voiceResult = await resolveInboundVoice({
        merchantId,
        platform: 'whatsapp',
        buffer: media.buffer,
        mimeType: media.mimeType || 'audio/ogg',
        filename: 'whatsapp-voice.ogg',
        existingText: messageText,
        languageHint: 'arabic'
      });
      messageText = voiceResult.messageText;
      if (voiceResult.shouldAbortWithFallback) {
        await sendWhatsAppWebText(merchantId, remoteJid, voiceTranscriptionFallbackMessage('arabic'));
        return null;
      }
    } else if (!messageText.trim()) {
      await sendWhatsAppWebText(merchantId, remoteJid, voiceTranscriptionFallbackMessage('arabic'));
      return null;
    }
  }

  if (!messageText.trim() && !imageUrl) return null;

  return {
    merchantId,
    userId: remoteJid,
    userName,
    messageId,
    messageText: messageText || '📷 صورة',
    imageUrl
  };
}

export async function handleWhatsAppWebCustomerMessage(
  merchantId: string,
  message: WAMessage
): Promise<void> {
  if (message.key?.fromMe) return;
  if (wasSentByBot(merchantId, message.key?.id || undefined)) return;

  const prepared = await prepareInboundFromWaMessage(merchantId, message);
  if (!prepared) return;

  await conversationIngressQueue.enqueue({
    conversationKey: `${merchantId}:whatsapp:${prepared.userId}`,
    merchantId,
    platform: 'whatsapp',
    text: prepared.messageText,
    externalMessageId: prepared.messageId,
    payload: prepared,
    process: async (batch) => {
      const latest = batch.latestPayload;
      await processBotTurn({
        ...latest,
        messageText: batch.mergedText || latest.messageText,
        imageUrl: batch.payloads.map((p) => p.imageUrl).find(Boolean) || latest.imageUrl
      });
    }
  });
}

export async function handleWhatsAppWebMerchantPhoneMessage(
  merchantId: string,
  message: WAMessage
): Promise<void> {
  if (!message.key?.fromMe) return;
  if (wasSentByBot(merchantId, message.key?.id || undefined)) return;

  const remoteJid = normalizeWhatsAppJid(message.key.remoteJid || undefined);
  if (!isDirectCustomerJid(remoteJid)) return;

  const content = unwrapMessageContent(message.message);
  const text = extractInboundText(content);
  if (!text.trim()) return;

  const existing = await pool.query(
    `SELECT id FROM conversations
     WHERE merchant_id = $1 AND platform = 'whatsapp' AND user_id = $2
     LIMIT 1`,
    [merchantId, remoteJid]
  );
  if (existing.rows.length === 0) return;

  const conversationId = existing.rows[0].id;
  await pool.query(
    `INSERT INTO messages (conversation_id, role, content, sender_type, source, metadata)
     VALUES ($1, 'assistant', $2, 'human', 'whatsapp', $3::jsonb)`,
    [
      conversationId,
      text,
      JSON.stringify({ platform: 'whatsapp', origin: 'phone' })
    ]
  );
  await pool.query(
    `UPDATE conversations
     SET last_message_at = CURRENT_TIMESTAMP,
         last_human_response_at = CURRENT_TIMESTAMP,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $1 AND merchant_id = $2`,
    [conversationId, merchantId]
  );
}
