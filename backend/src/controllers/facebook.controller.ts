import { Response, NextFunction } from 'express';
import crypto from 'crypto';
import pool from '../database/connection.js';
import { createError } from '../middleware/errorHandler.js';
import { AuthRequest } from '../middleware/auth.js';
import { logger } from '../utils/logger.js';
// ✅ النظام الجديد - Modular Architecture v2.0 (نفس المستخدم في تلجرام)
import type { Message, ConversationState, MerchantConfig } from '../bot/index.js';
import { stripInternalControlMarkers } from '../response/sanitize-reply.js';
import { buildMerchantBotConfig } from '../services/buildMerchantBotConfig.js';
import {
  extractImageUrl,
  extractOrderData,
  persistOrderIfPresent,
  runSalesBotTurn,
} from '../services/channels/botTurn.js';
import {
  ensureConversationCustomerName,
  isPlaceholderCustomerName,
  bindConversationChannelAccount,
} from '../services/socialProfile.js';
import { facebookAdapter, sendFacebookTyping } from '../services/channels/facebook.adapter.js';
import { startTypingKeepalive } from '../services/channels/replyDelivery.js';
import {
  conversationIngressQueue,
  mergeMessengerStylePayloads
} from '../services/conversationIngressQueue.js';
import { checkRateLimit, getCachedMerchantSettings } from '../services/cacheService.js';
import { analyzeImageAndSearch, imageUrlToBase64 } from '../services/imageRecognition.js';
import {
  resolveInboundVoice,
  voiceTranscriptionFallbackMessage
} from '../services/voiceTranscription.js';
import { getCurrencyDisplayName } from '../utils/currencyDisplayName.js';
import { applyCommentTemplate, clampSocialText, DEFAULT_COMMENT_REPLY, DEFAULT_DM_AFTER_COMMENT } from '../services/socialCommentReplies.js';
import { normalizePageFeedCommentValue, isPageFeedCommentEvent } from '../services/pageFeedCommentPayload.js';
import { processInstagramCommentFromPageFeed } from './instagram.controller.js';
import { getMerchantPlanLimits, getFacebookPagesCount } from '../utils/planLimits.js';
import { runCommentAutomation } from '../services/socialCommentAutomation.js';
import {
  fetchFacebookCommenterProfile,
  sendFacebookCommentReply,
  sendFacebookPrivateReplyAfterComment,
} from '../services/facebookCommentGraph.js';
import {
  applyMessagingAcquisition,
} from '../services/socialAcquisition.js';
import { withOAuthCodeDedup } from '../utils/oauthCodeDedup.js';
import {
  resolveManagedFacebookPages,
  fetchGrantedFacebookPermissions,
} from '../utils/facebookPages.js';

// ==================== FACEBOOK LINKING SESSIONS ====================

interface FacebookLinkingSession {
  purpose: 'merchant' | 'official_page';
  /** Merchant integrations only */
  merchantId?: string;
  /** Super-admin who started official-page OAuth */
  adminId?: string;
  /** Obscured admin UI base path for OAuth return */
  adminBasePath?: string;
  userAccessToken: string;
  pages: Array<{
    id: string;
    name: string;
    access_token?: string;
    category?: string;
    picture?: { data?: { url?: string } };
  }>;
  createdAt: number;
}

const fbLinkingSessions = new Map<string, FacebookLinkingSession>();

const FB_SESSION_TTL_MS = 10 * 60 * 1000; // 10 minutes

setInterval(() => {
  const now = Date.now();
  for (const [id, session] of fbLinkingSessions.entries()) {
    if (now - session.createdAt > FB_SESSION_TTL_MS) {
      fbLinkingSessions.delete(id);
    }
  }
}, 60_000);

export const getFbLinkingSession = (sessionId: string): FacebookLinkingSession | undefined => {
  const session = fbLinkingSessions.get(sessionId);
  if (!session) return undefined;
  if (Date.now() - session.createdAt > FB_SESSION_TTL_MS) {
    fbLinkingSessions.delete(sessionId);
    return undefined;
  }
  return session;
};

export const deleteFbLinkingSession = (sessionId: string): void => {
  fbLinkingSessions.delete(sessionId);
};

// Verify Facebook webhook signature (supports sha256 and legacy sha1)
const verifyFacebookSignature = (req: any, secret: string): boolean => {
  const signature256 = req.headers['x-hub-signature-256'];
  const signature1 = req.headers['x-hub-signature'];

  if (!signature256 && !signature1) return false;

  // Facebook signs the raw body; JSON stringify fallback is a last resort.
  const payloadBuffer: Buffer = req.rawBody
    ? Buffer.isBuffer(req.rawBody)
      ? req.rawBody
      : Buffer.from(String(req.rawBody), 'utf8')
    : Buffer.from(JSON.stringify(req.body ?? {}), 'utf8');

  const safeCompare = (actual: string, expected: string): boolean => {
    const a = Buffer.from(actual, 'utf8');
    const b = Buffer.from(expected, 'utf8');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  };

  if (typeof signature256 === 'string') {
    const expected256 = `sha256=${crypto
      .createHmac('sha256', secret)
      .update(payloadBuffer)
      .digest('hex')}`;
    if (safeCompare(signature256, expected256)) return true;
  }

  if (typeof signature1 === 'string') {
    const expected1 = `sha1=${crypto
      .createHmac('sha1', secret)
      .update(payloadBuffer)
      .digest('hex')}`;
    if (safeCompare(signature1, expected1)) return true;
  }

  return false;
};

// Get Facebook page access token for a merchant
const getFacebookAccessToken = async (merchantId: string, pageId: string): Promise<string | null> => {
  try {
    const result = await pool.query(
      'SELECT access_token FROM facebook_pages WHERE merchant_id = $1 AND page_id = $2',
      [merchantId, pageId]
    );
    return result.rows[0]?.access_token || null;
  } catch (error) {
    logger.error('Error getting Facebook access token', error as Error, { merchantId, pageId });
    return null;
  }
};

// Send image via Facebook Graph API
const sendFacebookImage = async (pageId: string, recipientId: string, imageUrl: string, caption: string, accessToken: string): Promise<boolean> => {
  try {
    const url =
      `https://graph.facebook.com/v21.0/${encodeURIComponent(pageId)}/messages` +
      `?access_token=${encodeURIComponent(accessToken)}`;
    const response = await fetch(url, {
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
      logger.error('Facebook API error sending image', new Error(JSON.stringify(data)), { pageId, recipientId, imageUrl });
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

// Send message via Facebook Graph API (محادثة ماسنجر عادية — يحتاج PSID بعد أن يكون المستخدم قد تواصل)
const sendFacebookMessage = async (pageId: string, recipientId: string, message: string, accessToken: string): Promise<boolean> => {
  try {
    // 💡 السطر السحري الذي ينتظره مراجع فيسبوك لمطابقة النص العربي مع الشاشة
    logger.info('Sending Text message via Facebook Graph API', {
      pageId,
      recipientId,
      messageLength: (message || '').length,
    });
    const url =
      `https://graph.facebook.com/v21.0/${encodeURIComponent(pageId)}/messages` +
      `?access_token=${encodeURIComponent(accessToken)}`;
    const response = await fetch(url, {
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

const buildFbCommentTemplateReply = (
  row: { comment_reply_template?: string | null; comment_dm_template?: string | null },
  context: 'comment' | 'dm_after_comment',
  commentText: string,
  commenterName: string
): string => {
  const template =
    context === 'comment' ? row.comment_reply_template : row.comment_dm_template;
  const fallback = context === 'comment' ? DEFAULT_COMMENT_REPLY : DEFAULT_DM_AFTER_COMMENT;
  const raw = applyCommentTemplate(template, fallback, {
    comment: commentText,
    name: commenterName
  });
  return clampSocialText(raw);
};

const processFacebookComment = async (pageId: string, value: any) => {
  try {
  const verb = typeof value?.verb === 'string' ? value.verb.toLowerCase() : '';
  if (verb === 'remove' || verb === 'hide' || verb === 'edited') {
    logger.debug('Facebook comment webhook skipped verb', { verb, pageId });
    return;
  }

  const n = normalizePageFeedCommentValue(value);
  const commentId = n.commentId;
  let commentText = n.message;
  let commenterId = n.fromId;
  let commenterName = n.fromName || 'صديقنا';
  const externalPostId = n.postId || n.parentId || null;

  if (!commentId) {
    logger.warn('Facebook comment: missing comment id', { pageId });
    return;
  }

  const pageRow = await pool.query(
    `SELECT fp.merchant_id, fp.access_token, fp.auto_reply_comments, fp.send_dm_on_comment,
            fp.comment_reply_template, fp.comment_dm_template, fp.comment_automation_mode,
            ms.store_name, ms.store_currency, ms.system_prompt, ms.bot_persona,
            ms.shipping_policy, ms.delivery_time, ms.payment_methods, ms.return_policy,
            ms.additional_notes
     FROM facebook_pages fp
     LEFT JOIN merchant_settings ms ON ms.merchant_id = fp.merchant_id
     WHERE fp.page_id = $1
     ORDER BY fp.updated_at DESC NULLS LAST
     LIMIT 1`,
    [pageId]
  );
  if (pageRow.rows.length === 0) {
    logger.warn('Facebook comment: page not in database', { pageId, commentId });
    return;
  }

  const row = pageRow.rows[0];
  const accessToken = row.access_token as string;

  if (!commenterId) {
    const enriched = await fetchFacebookCommenterProfile(commentId, accessToken);
    if (enriched?.fromId) {
      commenterId = enriched.fromId;
      if (enriched.fromName) commenterName = enriched.fromName;
      if (enriched.message && !commentText) commentText = enriched.message;
    }
  }

  if (commenterId && String(commenterId) === String(pageId)) return;

  const rateLimitKey = commenterId ? String(commenterId) : `fb-comment:${commentId}`;
  if (!checkRateLimit(rateLimitKey, row.merchant_id)) {
    logger.warn('Facebook comment rate limited', { rateLimitKey, merchantId: row.merchant_id });
    return;
  }

  await runCommentAutomation({
    platform: 'facebook',
    accountRef: pageId,
    pageIdForMessaging: pageId,
    externalPostId,
    commentId: String(commentId),
    commentText,
    commenterId,
    commenterName,
    account: row,
    sendPublicReply: sendFacebookCommentReply,
    sendPrivateReply: sendFacebookPrivateReplyAfterComment
  });
  } catch (err) {
    logger.error('processFacebookComment uncaught error', err as Error, { pageId });
  }
};

// Process Facebook message event
const processFacebookMessage = async (event: any) => {
  try {
    // ==================== OFFICIAL PAGE BOT (platform, not merchant) ====================
    // Intercept before merchant SalesGPT so the official page never touches tenant data.
    const inboundPageId = event?.recipient?.id ? String(event.recipient.id) : '';
    if (inboundPageId) {
      const { getPlatformFacebookPageByPageId } = await import('../services/platformFacebookPage.js');
      const platformPage = await getPlatformFacebookPageByPageId(inboundPageId);
      if (platformPage) {
        const { processOfficialPageMessage } = await import('../services/officialPageBot.js');
        await processOfficialPageMessage(event, platformPage);
        return;
      }
    } else {
      logger.warn('Facebook inbound message missing recipient page id', {
        senderId: event?.sender?.id || null,
      });
    }

    // ==================== STEP 1: Parse incoming event ====================
    const parsedEvent = await facebookAdapter.parseIncomingEvent(event);
    
    if (!parsedEvent) {
      // Event was ignored (auto-reply disabled, invalid event, etc.)
      return;
    }

    const { merchantId, userId, externalMessageId, userName, imageAttachmentUrl, audioAttachmentUrl, rawEventMetadata } = parsedEvent;
    let messageText = parsedEvent.messageText;
    const pageId = rawEventMetadata?.pageId;
    const accessToken = rawEventMetadata?.accessToken;

    // ==================== VALIDATION ====================
    if ((!messageText || messageText.trim().length < 1) && !imageAttachmentUrl && !audioAttachmentUrl) {
      logger.debug('Ignoring empty Facebook message', { userId });
      return;
    }

    // ==================== RATE LIMITING ====================
    if (!checkRateLimit(userId, merchantId)) {
      logger.warn('Facebook user rate limited', { userId, merchantId });
      return;
    }

    logger.info('Processing Facebook message', {
      userId,
      merchantId,
      messageLength: (messageText || '').length,
      hasImage: !!imageAttachmentUrl,
      hasAudio: !!audioAttachmentUrl
    });

    // ==================== VOICE TRANSCRIPTION (OpenAI STT) ====================
    if (audioAttachmentUrl) {
      const voiceResult = await resolveInboundVoice({
        merchantId,
        platform: 'facebook_messenger',
        url: audioAttachmentUrl,
        existingText: messageText === 'أرسل العميل صورة' ? '' : messageText,
        filename: 'voice.ogg',
        languageHint: 'arabic',
        downloadHeaders: accessToken
          ? { Authorization: `Bearer ${accessToken}` }
          : undefined
      });
      messageText = voiceResult.messageText || messageText;
      if (voiceResult.transcribed) {
        logger.info('Facebook voice transcribed', {
          merchantId,
          userId,
          transcriptLength: voiceResult.transcript?.text?.length || 0,
          model: voiceResult.transcript?.model
        });
      }
      if (voiceResult.shouldAbortWithFallback) {
        if (pageId && accessToken) {
          await sendFacebookMessage(
            pageId,
            userId,
            voiceTranscriptionFallbackMessage('arabic'),
            accessToken
          );
        }
        return;
      }
    }

    // ==================== IMAGE RECOGNITION ====================
    if (imageAttachmentUrl) {
      try {
        const dataUrl = await imageUrlToBase64(imageAttachmentUrl);
        if (dataUrl) {
          const analysis = await analyzeImageAndSearch(dataUrl, merchantId, messageText || undefined);
          if (analysis) {
            const productList = analysis.products
              .slice(0, 3)
              .map((p, i) =>
                `${i + 1}. ${p.name} — ${p.price} ${getCurrencyDisplayName(p.currency || 'USD', 'arabic')}`
              )
              .join('\n');

            if (analysis.products.length > 0) {
              messageText = `[تحليل صورة العميل: "${analysis.description}" — المنتجات المطابقة في المتجر:\n${productList}]\n${messageText || 'كم سعر هذا المنتج؟'}`;
            } else {
              messageText = `[تحليل صورة العميل: "${analysis.description}" — لم يُعثر على منتج مطابق في المتجر]\n${messageText || 'كم سعر هذا المنتج؟'}`;
            }
            console.log('[processFacebookMessage] Image analyzed', {
              messageLength: messageText.length,
            });
          }
        }
      } catch (imgErr) {
        logger.error('Facebook image analysis failed', imgErr as Error);
      }
      if (!messageText || !messageText.trim()) {
        messageText = 'أرسل العميل صورة';
      }
    }

    // ==================== STEP 2: Check bot_disabled and human response ====================
    // Get or create conversation
    const convResult = await pool.query(
      `SELECT id, conversation_state, current_intent, stage, user_name FROM conversations 
       WHERE merchant_id = $1 AND platform = 'facebook_messenger' AND user_id = $2
       ORDER BY last_message_at DESC LIMIT 1`,
      [merchantId, userId]
    );

    let conversationId: string;
    let conversationState: ConversationState = { message_count: 0 };
    let resolvedUserName = userName || '';
    
    if (convResult.rows.length > 0) {
      conversationId = convResult.rows[0].id;
      // ✅ استخراج حالة المحادثة من قاعدة البيانات
      conversationState = convResult.rows[0].conversation_state || { message_count: 0 };
      if (convResult.rows[0].current_intent) {
        conversationState.last_intent = convResult.rows[0].current_intent;
      }
      // Refresh profile name from Graph when missing/placeholder
      resolvedUserName = await ensureConversationCustomerName({
        merchantId,
        conversationId,
        platform: 'facebook_messenger',
        userId,
        currentName: !isPlaceholderCustomerName(userName)
          ? userName
          : convResult.rows[0].user_name,
        preferredPageId: pageId ? String(pageId) : null,
      });
    } else {
      // Create new conversation — prefer Graph name over placeholders
      if (isPlaceholderCustomerName(resolvedUserName)) {
        const { resolveSocialCustomerName } = await import('../services/socialProfile.js');
        resolvedUserName =
          (await resolveSocialCustomerName({
            merchantId,
            platform: 'facebook_messenger',
            userId,
            preferredPageId: pageId ? String(pageId) : null,
          })) || resolvedUserName || 'عميل فيسبوك';
      }
      const newConvResult = await pool.query(
        `INSERT INTO conversations (merchant_id, platform, user_id, user_name)
         VALUES ($1, 'facebook_messenger', $2, $3)
         RETURNING id`,
        [merchantId, userId, resolvedUserName]
      );
      conversationId = newConvResult.rows[0].id;
    }

    // Bind Meta page id for later profile lookups / outbound sends
    if (pageId) {
      await bindConversationChannelAccount({
        merchantId,
        conversationId,
        platform: 'facebook_messenger',
        accountId: String(pageId),
      });
    }

    // ==================== ACQUISITION (ad / post / ref / story) ====================
    let acquisitionNote = '';
    {
      const seeded = await applyMessagingAcquisition({
        event,
        merchantId,
        conversationId,
        conversationState,
        platform: 'facebook',
        accountRef: pageId || null,
      });
      conversationState = seeded.conversationState;
      acquisitionNote = seeded.acquisitionNote;
    }

    // ✅ فحص حالة المحادثة لمنع التضارب
    let convStatus;
    try {
      convStatus = await pool.query(
        `SELECT bot_disabled, last_human_response_at, last_bot_response_at, status
         FROM conversations WHERE id = $1`,
        [conversationId]
      );
    } catch (error: any) {
      // Backward compatibility: old schemas may miss conversation-state columns
      if (error?.code === '42703') {
        convStatus = { rows: [{ bot_disabled: false, status: 'bot' }] } as any;
      } else {
        throw error;
      }
    }

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

    // Skip bot reply if needed (before processing)
    if (shouldSkipBotReply) {
      // Still save user message even if bot is disabled
        await pool.query(
        `INSERT INTO messages (conversation_id, role, content, sender_type, external_message_id, source, metadata)
         VALUES ($1, 'user', $2, 'user', $3, 'facebook_messenger', $4::jsonb)`,
        [
          conversationId,
          messageText,
          externalMessageId,
          JSON.stringify({
            platform: 'facebook_messenger',
            ...(imageAttachmentUrl
              ? { type: 'image', imageUrl: imageAttachmentUrl }
              : { type: 'text' }),
          }),
        ]
      );
      
      logger.info('Bot reply skipped for Facebook', {
        conversationId,
        reason: skipReason,
        merchantId
      });
      return;
    }

    // ==================== STEP 3: Get merchant settings (with caching) ====================
    const cachedSettings = await getCachedMerchantSettings(merchantId);

    if (!cachedSettings) {
      logger.warn('Merchant settings not found for Facebook', { merchantId });
      return;
    }

    const settings = {
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

    // ✅ جلب الرسائل السابقة للسياق (آخر 25 رسالة) - نفس تلجرام
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

    console.log('[processFacebookMessage] Conversation ready for NEW orchestrator:', { 
      conversationId, 
      messageLength: messageText.length,
      recentMessagesCount: recentMessages.length,
      hasConversationState: Object.keys(conversationState).length > 0
    }); 

    // ✅ فحص حد الردود الذكية - نفس تلجرام
    const { getMerchantPlanLimits, getMonthlyAIResponseCount, isWithinLimit } = await import('../utils/planLimits.js');
    const limits = await getMerchantPlanLimits(merchantId);
    if (!limits.hasSalesBot) {
      logger.info('Sales bot not included in plan — skipping Facebook Messenger auto-reply', { merchantId });
      return;
    }
    const currentCount = await getMonthlyAIResponseCount(merchantId);

    console.log('[processFacebookMessage] Plan limits check:', { merchantId, currentCount, limit: limits.maxMonthlyAIResponses, isWithinLimit: isWithinLimit(currentCount, limits.maxMonthlyAIResponses) });

    if (!isWithinLimit(currentCount, limits.maxMonthlyAIResponses)) {
      logger.warn('AI response limit exceeded for Facebook', {
        merchantId,
        currentCount,
        limit: limits.maxMonthlyAIResponses
      });
      return;
    }

    // ==================== STEP 4: SalesGPT turn (shared) ====================
    let responseText: string;
    let updatedState: ConversationState = conversationState;

    const stopTypingKeepalive = accessToken
      ? startTypingKeepalive(() => sendFacebookTyping(pageId, userId, true, accessToken))
      : () => undefined;

    try {
      const merchantConfig: Partial<MerchantConfig> = buildMerchantBotConfig({
        merchantId,
        settings,
        systemPromptSuffix: acquisitionNote || '',
      });

      const turn = await runSalesBotTurn({
        merchantId,
        platform: 'facebook_messenger',
        escalatePlatform: 'facebook_messenger',
        userId,
        userName: resolvedUserName || userName || 'عميل',
        messageText,
        externalMessageId: externalMessageId || '',
        recentMessages,
        conversationState,
        merchantConfig,
        conversationId,
        storeCurrency: settings?.store_currency || 'USD',
        channelLabel: 'Facebook Messenger',
        pool,
        userMessageMetadata: imageAttachmentUrl
          ? { type: 'image', imageUrl: imageAttachmentUrl }
          : { type: 'text' },
      });

      responseText = turn.responseText;
      updatedState = turn.updatedState;

      if (!turn.failed) {
        console.log('[processFacebookMessage] SalesGPT response generated:', {
          conversationId,
          responseLength: responseText.length,
          pipelineUsed: turn.meta.pipelineUsed,
          aiCallsCount: turn.meta.aiCallsCount,
          processingTimeMs: turn.meta.processingTimeMs,
          intent: turn.meta.intent,
          stage: turn.meta.stage
        });
        logger.info('Facebook message processed via SalesGPT', {
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
      console.log('[processFacebookMessage] ORDER_DATA detected, processing order:', {
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
          defaultBaseNotes: 'Order created via Facebook Messenger bot',
          customerTags: ['bot-order', 'facebook'],
          interactionTitle: 'Order Created via Facebook Bot',
          interactionDescription: (orderId: string) => `Order #${orderId} created via Facebook Messenger bot`,
          interactionPlatform: 'facebook',
          logPrefix: 'processFacebookMessage'
        },
        updatedState,
      });
    }

    // ==================== STEP 5: Human-like send (typing delay + ≤2 bubbles) ====================
    const finalResponseText = stripInternalControlMarkers(cleanText || responseWithoutOrderData);
    console.log('[processFacebookMessage] Prepared final response for sending:', { conversationId, responseLength: finalResponseText.length });

    const hasImage = !!(imageUrl && imageUrl.startsWith('http') && accessToken);
    if ((!finalResponseText || finalResponseText.trim().length === 0) && !hasImage) {
      logger.info('Orchestrator returned no reply for Facebook', { conversationId, merchantId });
      return;
    }

    await facebookAdapter.sendMessage({
      merchantId,
      userId,
      text: finalResponseText || '',
      metadata: {
        pageId,
        accessToken,
        ...(hasImage ? { imageUrl } : {})
      }
    });

    // Update conversation
    await pool.query(
      `UPDATE conversations 
       SET last_message_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND merchant_id = $2`,
      [conversationId, merchantId]
    );

    console.log('[processFacebookMessage] Message processed successfully:', { userId, conversationId });
    logger.info('Facebook message processed successfully', { pageId, userId, conversationId });
  } catch (error) {
    console.error('[processFacebookMessage] ERROR:', error);
    logger.error('Error processing Facebook message', error as Error);
  }
};

// Facebook OAuth callback

const facebookOAuthCorsOrigin = () => process.env.CORS_ORIGIN || 'https://xo-bot.com';

const buildFacebookIntegrationRedirect = (params: Record<string, string>) => {
  const q = new URLSearchParams(params);
  return `${facebookOAuthCorsOrigin()}/app/integrations?${q.toString()}`;
};

const redirectFacebookIntegration = (res: Response, params: Record<string, string>) => {
  res.redirect(buildFacebookIntegrationRedirect(params));
};

export const facebookCallback = async (
  req: any,
  res: Response,
  next: NextFunction
) => {
  try {
    const oauthError = typeof req.query.error === 'string' ? req.query.error : '';
    if (oauthError) {
      const reason =
        oauthError === 'access_denied' || req.query.error_reason === 'user_denied'
          ? 'user_denied'
          : 'oauth_failed';
      logger.warn('Facebook OAuth denied or errored by provider', {
        error: oauthError,
        errorReason: req.query.error_reason || null,
        errorDescription: req.query.error_description || null,
      });
      redirectFacebookIntegration(res, { facebook: 'error', reason });
      return;
    }

    const { code, state } = req.query;

    if (!code || !state) {
      redirectFacebookIntegration(res, { facebook: 'error', reason: 'missing_params' });
      return;
    }

    const authCode = String(code);

    const redirectUrl = await withOAuthCodeDedup('facebook', authCode, async () => {
      let purpose: 'merchant' | 'official_page' = 'merchant';
      let merchantId: string | undefined;
      let adminId: string | undefined;
      let adminBasePath: string | undefined;
      try {
        const stateData = JSON.parse(Buffer.from(String(state), 'base64').toString());
        if (stateData.purpose === 'official_page') {
          purpose = 'official_page';
          adminId = stateData.adminId || undefined;
          adminBasePath = stateData.adminBasePath || undefined;
          if (!adminId) throw new Error('no adminId');
        } else {
          merchantId = stateData.merchantId;
          if (!merchantId) throw new Error('no merchantId');
        }
      } catch {
        return buildFacebookIntegrationRedirect({ facebook: 'error', reason: 'invalid_state' });
      }

      const {
        buildOfficialFacebookSelectRedirect,
        buildOfficialFacebookErrorRedirect,
      } = await import('./adminOfficialFacebook.controller.js');

      const errorRedirect = (reason: string) =>
        purpose === 'official_page'
          ? buildOfficialFacebookErrorRedirect(reason, adminBasePath)
          : buildFacebookIntegrationRedirect({ facebook: 'error', reason });

      const fbAppId = process.env.FACEBOOK_APP_ID;
      const fbAppSecret = process.env.FACEBOOK_APP_SECRET;
      const redirectUri =
        process.env.FACEBOOK_REDIRECT_URI ||
        `${process.env.CORS_ORIGIN}/api/integrations/facebook/callback`;

      const tokenResponse = await fetch(
        `https://graph.facebook.com/v21.0/oauth/access_token?client_id=${fbAppId}&client_secret=${fbAppSecret}&redirect_uri=${encodeURIComponent(redirectUri)}&code=${encodeURIComponent(authCode)}`
      );

      const tokenData = await tokenResponse.json() as {
        access_token?: string;
        token_type?: string;
        expires_in?: number;
        error?: { message?: string; code?: number };
      };

      if (!tokenResponse.ok || !tokenData.access_token) {
        logger.error('Facebook OAuth token exchange failed', new Error(JSON.stringify(tokenData)));
        return errorRedirect('oauth_failed');
      }

      const userAccessToken = tokenData.access_token;
      const { pages, source } = await resolveManagedFacebookPages(userAccessToken);

      if (pages.length === 0) {
        const granted = await fetchGrantedFacebookPermissions(userAccessToken);
        const hasPagePerms = granted.includes('pages_show_list');
        const hasBusinessMgmt = granted.includes('business_management');
        logger.error(
          'Failed to get Facebook pages',
          new Error(
            JSON.stringify({
              data: [],
              grantedPermissions: granted,
              hasPagePerms,
              hasBusinessMgmt,
              resolveSource: source,
              purpose,
            })
          )
        );
        return errorRedirect(
          hasPagePerms && !hasBusinessMgmt ? 'business_pages' : 'no_pages'
        );
      }

      logger.info('Facebook pages resolved for OAuth linking', {
        purpose,
        merchantId: merchantId || null,
        adminId: adminId || null,
        pagesCount: pages.length,
        source,
      });

      const corsOrigin = process.env.CORS_ORIGIN || 'https://xo-bot.com';
      const sessionId = crypto.randomUUID();
      fbLinkingSessions.set(sessionId, {
        purpose,
        merchantId,
        adminId,
        adminBasePath,
        userAccessToken,
        pages: pages.map((p) => ({
          id: p.id,
          name: p.name || p.id,
          access_token: p.access_token,
          category: p.category,
          picture: p.picture,
        })),
        createdAt: Date.now(),
      });

      logger.info('Facebook OAuth: linking session created', {
        purpose,
        merchantId: merchantId || null,
        adminId: adminId || null,
        sessionId,
        pagesCount: pages.length,
      });

      if (purpose === 'official_page') {
        return buildOfficialFacebookSelectRedirect(sessionId, adminBasePath);
      }

      return `${corsOrigin}/app/integrations?facebook=select_pages&fb_session=${sessionId}`;
    });

    res.redirect(redirectUrl);
  } catch (error) {
    logger.error('Error in Facebook OAuth callback', error as Error);
    redirectFacebookIntegration(res, { facebook: 'error', reason: 'server_error' });
  }
};

// Enhanced Facebook webhook handler
export const facebookWebhook = async (
  req: any,
  res: Response,
  next: NextFunction
) => {
  try {
    // Facebook webhook verification
    if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token']) {
      const verifyToken = process.env.FACEBOOK_WEBHOOK_VERIFY_TOKEN;
      if (req.query['hub.verify_token'] === verifyToken) {
        logger.info('Facebook webhook verified', { challenge: req.query['hub.challenge'] });
        return res.send(req.query['hub.challenge']);
      }
      logger.warn('Invalid Facebook webhook verify token');
      return next(createError('Invalid verify token', 403));
    }
    

    // Verify signature (fail closed in production when secret is missing)
    const appSecret = process.env.FACEBOOK_APP_SECRET;
    if (!appSecret) {
      if (process.env.NODE_ENV === 'production') {
        logger.warn('Facebook webhook rejected: FACEBOOK_APP_SECRET not configured');
        return next(createError('Webhook not configured', 503));
      }
      logger.warn('Facebook webhook: FACEBOOK_APP_SECRET missing (dev allow)');
    } else if (!verifyFacebookSignature(req, appSecret)) {
      logger.warn('Invalid Facebook webhook signature');
      return next(createError('Invalid signature', 403));
    }

    // Process webhook events
    const body = req.body;

    if (body.object === 'page') {
      for (const entry of body.entry || []) {
        // Process messages
        if (entry.messaging) {
          for (const event of entry.messaging) {
            // ✅ Message Echo: page/admin sent a message (Inbox or another app)
            // Meta payload: sender = PAGE_ID, recipient = customer PSID
            if (event.message && event.message.is_echo) {
              const appId = event.message.app_id;
              if (appId && appId.toString() === process.env.FACEBOOK_APP_ID) {
                continue; // Ignore echoes from our own Send API replies
              }

              const pageId = String(event.sender?.id || entry.id || '');
              const userPsid = String(event.recipient?.id || '');
              const messageText =
                typeof event.message?.text === 'string' ? event.message.text.trim() : '';
              const messageId = event.message?.mid ? String(event.message.mid) : '';
              const attachments = Array.isArray(event.message?.attachments)
                ? event.message.attachments
                : [];
              const hasAttachments = attachments.length > 0;

              if (!pageId || !userPsid || !messageId || (!messageText && !hasAttachments)) {
                logger.debug('Facebook echo skipped (incomplete payload)', {
                  pageId: pageId || null,
                  userPsid: userPsid || null,
                  hasText: !!messageText,
                  hasAttachments,
                  messageId: messageId || null
                });
                continue;
              }

              try {
                // Official XO Bot page: pause platform bot on human Inbox reply
                const { getPlatformFacebookPageByPageId } = await import(
                  '../services/platformFacebookPage.js'
                );
                const platformPage = await getPlatformFacebookPageByPageId(pageId);
                if (platformPage) {
                  const { handleOfficialPageHumanEcho } = await import(
                    '../services/officialPageBot.js'
                  );
                  await handleOfficialPageHumanEcho({
                    pageId,
                    userPsid,
                    messageText,
                    messageId,
                    hasAttachments,
                    attachmentType: attachments[0]?.type,
                  });
                  continue;
                }

                const merchantResult = await pool.query(
                  'SELECT merchant_id FROM facebook_pages WHERE page_id = $1',
                  [pageId]
                );

                if (merchantResult.rows.length === 0) {
                  logger.warn('Facebook echo: page not linked', { pageId, userPsid, messageId });
                  continue;
                }

                const merchant_id = merchantResult.rows[0].merchant_id;

                const convResult = await pool.query(
                  `SELECT id FROM conversations 
                   WHERE merchant_id = $1 AND platform = 'facebook_messenger' AND user_id = $2
                   ORDER BY last_message_at DESC LIMIT 1`,
                  [merchant_id, userPsid]
                );

                if (convResult.rows.length === 0) {
                  logger.info('Facebook echo: no conversation yet (bot stays active)', {
                    merchant_id,
                    pageId,
                    userPsid,
                    messageId
                  });
                  continue;
                }

                const conversationId = convResult.rows[0].id;

                const existingMsg = await pool.query(
                  `SELECT id FROM messages 
                   WHERE conversation_id = $1 
                   AND external_message_id = $2`,
                  [conversationId, messageId]
                );

                if (existingMsg.rows.length > 0) {
                  continue; // Already stored (e.g. race) — do not double-disable noise
                }

                // Dashboard send may not have stored Meta mid yet — skip near-duplicate human text
                if (messageText) {
                  const recentDup = await pool.query(
                    `SELECT id FROM messages
                     WHERE conversation_id = $1
                       AND sender_type = 'human'
                       AND content = $2
                       AND created_at > NOW() - INTERVAL '90 seconds'
                     LIMIT 1`,
                    [conversationId, messageText]
                  );
                  if (recentDup.rows.length > 0) {
                    continue;
                  }
                }

                const attachmentType = attachments[0]?.type || 'attachment';
                const content =
                  messageText ||
                  `[human ${attachmentType}]`;

                await pool.query(
                  `INSERT INTO messages (conversation_id, role, content, sender_type, external_message_id, source)
                   VALUES ($1, 'assistant', $2, 'human', $3, 'facebook_inbox')`,
                  [conversationId, content, messageId]
                );

                await pool.query(
                  `UPDATE conversations 
                   SET bot_disabled = TRUE,
                       status = 'human',
                       last_human_response_at = CURRENT_TIMESTAMP,
                       last_message_at = CURRENT_TIMESTAMP,
                       updated_at = CURRENT_TIMESTAMP
                   WHERE id = $1`,
                  [conversationId]
                );

                logger.info('Human response detected via echo - bot disabled', {
                  conversationId,
                  messageId,
                  merchant_id,
                  pageId,
                  userPsid,
                  hasText: !!messageText,
                  hasAttachments
                });
              } catch (echoErr) {
                logger.error('Error processing Facebook message echo', echoErr as Error, {
                  pageId,
                  userPsid,
                  messageId
                });
              }
            } else if (event.read) {
              // Customer read our messages (Messenger read receipt)
              const pageId = String(event.recipient?.id || entry.id || '');
              const userPsid = String(event.sender?.id || '');
              const watermark = Number(event.read?.watermark || 0);
              if (pageId && userPsid && watermark > 0) {
                void (async () => {
                  try {
                    const merchantResult = await pool.query(
                      'SELECT merchant_id FROM facebook_pages WHERE page_id = $1 LIMIT 1',
                      [pageId]
                    );
                    if (merchantResult.rows.length === 0) return;
                    const merchantId = String(merchantResult.rows[0].merchant_id);
                    const convResult = await pool.query(
                      `SELECT id FROM conversations
                       WHERE merchant_id = $1 AND platform = 'facebook_messenger' AND user_id = $2
                       ORDER BY last_message_at DESC LIMIT 1`,
                      [merchantId, userPsid]
                    );
                    if (convResult.rows.length === 0) return;
                    const conversationId = String(convResult.rows[0].id);
                    const readAt = new Date(watermark).toISOString();
                    await pool.query(
                      `UPDATE messages
                       SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('readAt', to_jsonb($2::text), 'deliveredAt', COALESCE(metadata->>'deliveredAt', $2::text))
                       WHERE conversation_id = $1
                         AND role = 'assistant'
                         AND created_at <= to_timestamp($3::double precision / 1000.0)
                         AND (metadata->>'readAt' IS NULL OR metadata->>'readAt' = '')`,
                      [conversationId, readAt, watermark]
                    );
                    const { publishMerchantInboxEvent } = await import('../services/inbox/inboxRealtime.js');
                    publishMerchantInboxEvent({
                      type: 'read',
                      merchantId,
                      conversationId,
                      platform: 'facebook_messenger',
                      read: {
                        conversationId,
                        reader: 'customer',
                        readAt,
                        watermark,
                      },
                      at: readAt,
                    });
                  } catch (err) {
                    logger.debug('Facebook message_reads handling failed', {
                      error: err instanceof Error ? err.message : String(err),
                    });
                  }
                })();
              }
            } else if (event.message && !event.message.is_echo) {
              // Per-conversation queue: merge rapid messages (4–6s) then process once
              const pageId = event.recipient?.id ? String(event.recipient.id) : '';
              const senderId = event.sender?.id ? String(event.sender.id) : '';
              const text = String(event.message?.text || '').trim();
              if (!pageId || !senderId) {
                processFacebookMessage(event).catch(err => {
                  logger.error('Error processing Facebook message event', err as Error);
                });
              } else {
                conversationIngressQueue
                  .enqueue({
                    conversationKey: `fb:${pageId}:${senderId}`,
                    platform: 'facebook_messenger',
                    text,
                    externalMessageId: event.message?.mid ? String(event.message.mid) : undefined,
                    payload: event,
                    process: async (batch) => {
                      const mergedEvent = mergeMessengerStylePayloads(batch.parts);
                      await processFacebookMessage(mergedEvent);
                    }
                  })
                  .catch(err => {
                    logger.error('Error processing Facebook message event', err as Error);
                  });
              }
            } else if (event.referral || event.postback) {
              // CTM / Ads / Get Started — seed product context then optional greeting turn
              // Postbacks are intentional single actions: serialize but skip merge wait
              const pageId = event.recipient?.id ? String(event.recipient.id) : '';
              const senderId = event.sender?.id ? String(event.sender.id) : '';
              const synthetic = {
                ...event,
                message: event.message || { text: event.postback?.title || 'مرحبا' }
              };
              if (!pageId || !senderId) {
                processFacebookMessage(synthetic).catch(err => {
                  logger.error('Error processing Facebook referral/postback', err as Error);
                });
              } else {
                conversationIngressQueue
                  .enqueue({
                    conversationKey: `fb:${pageId}:${senderId}`,
                    platform: 'facebook_messenger',
                    text: String(synthetic.message?.text || '').trim(),
                    externalMessageId: event.postback?.mid || event.message?.mid,
                    payload: synthetic,
                    debounceMs: 0,
                    process: async (batch) => {
                      const mergedEvent = mergeMessengerStylePayloads(batch.parts);
                      await processFacebookMessage(mergedEvent);
                    }
                  })
                  .catch(err => {
                    logger.error('Error processing Facebook referral/postback', err as Error);
                  });
              }
            }
          }
        }

        if (entry.changes) {
          for (const change of entry.changes) {
            if (change.field === 'feed' && isPageFeedCommentEvent(change.value)) {
              const pageId = entry.id;
              const payload = change.value as Record<string, any>;
              // IG vs Page: some IG feed payloads arrive without `from.username`/`media_id`.
              // Fallback heuristic: numeric comment_id (no underscore) + page linked to instagram_accounts.
              const rawCommentId = payload?.comment_id ?? payload?.id;
              const commentId = rawCommentId != null ? String(rawCommentId) : '';
              const hasInstagramHints = !!payload?.from?.username || payload?.media_id != null;
              const looksLikeInstagramCommentId =
                commentId.length > 0 && !commentId.includes('_') && /^\d+$/.test(commentId);

              let pageHasLinkedInstagram = false;
              if (!hasInstagramHints && looksLikeInstagramCommentId) {
                const igPage = await pool.query(
                  'SELECT 1 FROM instagram_accounts WHERE page_id = $1 LIMIT 1',
                  [pageId]
                );
                pageHasLinkedInstagram = igPage.rows.length > 0;
              }

              const isInstagramComment =
                hasInstagramHints || (looksLikeInstagramCommentId && pageHasLinkedInstagram);
              logger.info('Page feed comment webhook received', {
                pageId,
                item: payload?.item,
                verb: payload?.verb,
                hasCommentId: !!(payload?.comment_id ?? payload?.id),
                isInstagramComment,
                looksLikeInstagramCommentId,
                pageHasLinkedInstagram
              });
             if (isInstagramComment) {
                processInstagramCommentFromPageFeed(pageId, payload).catch(err =>
                  logger.error('Error processing Instagram comment from page feed', err as Error)
                );
              } else {
                // ✅ Dedicated log line for Meta App Review verification (pages_manage_metadata)
                logger.info('WEBHOOK EVENT RECEIVED: New comment on Facebook Page', {
                  permission: 'pages_manage_metadata',
                  page_id: pageId,
                  event_type: 'feed_comment',
                  comment_id: commentId,
                  comment_text: payload?.message,
                  received_at: new Date().toISOString()
                });
                // Official XO Bot page: isolated comment automation (never merchant tables)
                (async () => {
                  const { getPlatformFacebookPageByPageId } = await import(
                    '../services/platformFacebookPage.js'
                  );
                  const platformPage = await getPlatformFacebookPageByPageId(String(pageId));
                  if (platformPage) {
                    const { processOfficialPageComment } = await import(
                      '../services/platformCommentAutomation.js'
                    );
                    await processOfficialPageComment(platformPage, payload);
                    return;
                  }
                  await processFacebookComment(pageId, payload);
                })().catch((err) =>
                  logger.error('Error processing Facebook comment', err as Error)
                );
              }
            }
          }
        }
      }
    }

    // Respond immediately to Facebook
    res.json({ success: true });
  } catch (error) {
    logger.error('Error in Facebook webhook', error as Error);
    next(error);
  }
};

