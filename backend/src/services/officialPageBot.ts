/**
 * Official XO Bot Facebook page AI handler.
 * Completely separate from merchant SalesGPT / catalog / orders.
 */

import pool from '../database/connection.js';
import { logger } from '../utils/logger.js';
import { generateContent, type ChatMessage } from '../ai/gemini-client.js';
import { sendFacebookMessage } from './channels/facebook.adapter.js';
import {
  ensurePlatformFacebookTables,
  type PlatformFacebookPage,
} from './platformFacebookPage.js';

const HISTORY_LIMIT = 20;
const DEFAULT_SYSTEM_MESSAGE = `أنت XO Bot — مساعد منصة XO Bot الرسمي على فيسبوك.
هدفك مساعدة التجار على فهم المنتج، الإجابة عن أسئلتهم، وتشجيعهم على تجربة المنصة أو الاشتراك.
كن ودوداً ومقنعاً ومختصراً. رد بنفس لغة المستخدم.
لا تخترع أسعاراً غير مؤكدة. إذا لم تعرف معلومة، وجّه المستخدم لزيارة الموقع أو صفحة التسجيل.`;

export interface OfficialPageBotSettings {
  enabled: boolean;
  systemMessage: string;
}

async function loadOfficialPageBotSettings(): Promise<OfficialPageBotSettings> {
  try {
    const result = await pool.query(
      `SELECT value::jsonb FROM global_settings WHERE key = 'admin_global_settings' LIMIT 1`
    );
    const value = result.rows[0]?.value || {};
    const bot = value?.bots?.officialPageBot || {};
    const featureEnabled = value?.features?.officialPageBotEnabled;
    return {
      enabled:
        typeof bot.enabled === 'boolean'
          ? bot.enabled
          : typeof featureEnabled === 'boolean'
            ? featureEnabled
            : false,
      systemMessage:
        typeof bot.systemMessage === 'string' && bot.systemMessage.trim()
          ? bot.systemMessage.trim()
          : DEFAULT_SYSTEM_MESSAGE,
    };
  } catch (err) {
    logger.warn('Failed to load official page bot settings', {
      error: err instanceof Error ? err.message : String(err),
    });
    return { enabled: false, systemMessage: DEFAULT_SYSTEM_MESSAGE };
  }
}

async function getOrCreateConversation(params: {
  pageId: string;
  userId: string;
  userName?: string | null;
}): Promise<{ id: string; bot_disabled: boolean; status: string }> {
  await ensurePlatformFacebookTables();

  const existing = await pool.query(
    `SELECT id, COALESCE(bot_disabled, false) AS bot_disabled, COALESCE(status, 'bot') AS status
     FROM platform_conversations
     WHERE page_id = $1 AND user_id = $2
     LIMIT 1`,
    [params.pageId, params.userId]
  );

  if (existing.rows[0]) {
    if (params.userName) {
      await pool.query(
        `UPDATE platform_conversations
         SET user_name = COALESCE(user_name, $1), updated_at = CURRENT_TIMESTAMP
         WHERE id = $2`,
        [params.userName, existing.rows[0].id]
      );
    }
    return {
      id: existing.rows[0].id,
      bot_disabled: !!existing.rows[0].bot_disabled,
      status: String(existing.rows[0].status || 'bot'),
    };
  }

  const inserted = await pool.query(
    `INSERT INTO platform_conversations (page_id, user_id, user_name)
     VALUES ($1, $2, $3)
     ON CONFLICT (page_id, user_id) DO UPDATE SET updated_at = CURRENT_TIMESTAMP
     RETURNING id, COALESCE(bot_disabled, false) AS bot_disabled, COALESCE(status, 'bot') AS status`,
    [params.pageId, params.userId, params.userName || null]
  );
  return {
    id: inserted.rows[0].id,
    bot_disabled: !!inserted.rows[0].bot_disabled,
    status: String(inserted.rows[0].status || 'bot'),
  };
}

async function loadRecentMessages(conversationId: string): Promise<ChatMessage[]> {
  const result = await pool.query(
    `SELECT role, content FROM platform_messages
     WHERE conversation_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [conversationId, HISTORY_LIMIT]
  );

  return result.rows
    .reverse()
    .filter((r: { role: string; content: string }) => r.role === 'user' || r.role === 'model')
    .map((r: { role: string; content: string }) => ({
      role: r.role as 'user' | 'model',
      parts: [{ text: r.content }],
    }));
}

async function saveMessage(
  conversationId: string,
  role: 'user' | 'model' | 'human',
  content: string,
  externalMessageId?: string | null
) {
  await pool.query(
    `INSERT INTO platform_messages (conversation_id, role, content, external_message_id)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT DO NOTHING`,
    [conversationId, role, content, externalMessageId || null]
  );
  await pool.query(
    `UPDATE platform_conversations
     SET last_message_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
     WHERE id = $1`,
    [conversationId]
  );
}

function extractInboundText(event: any): string {
  const text = typeof event?.message?.text === 'string' ? event.message.text.trim() : '';
  if (text) return text;

  const postbackTitle =
    typeof event?.postback?.title === 'string' ? event.postback.title.trim() : '';
  if (postbackTitle) return postbackTitle;

  const postbackPayload =
    typeof event?.postback?.payload === 'string' ? event.postback.payload.trim() : '';
  if (postbackPayload) return postbackPayload;

  const referral =
    typeof event?.referral?.ref === 'string'
      ? event.referral.ref.trim()
      : typeof event?.message?.referral?.ref === 'string'
        ? event.message.referral.ref.trim()
        : '';
  if (referral) return referral;

  const attachments = Array.isArray(event?.message?.attachments) ? event.message.attachments : [];
  if (attachments.length > 0) {
    return 'أرسل المستخدم مرفقاً (صورة أو ملف). رُد بلطف واطلب منه الكتابة نصاً إن أمكن.';
  }

  return '';
}

/**
 * When a human replies from Facebook Page Inbox / Meta Business Suite, Meta sends is_echo=true
 * (sender = page, recipient = customer). Pause the official page bot for that conversation.
 */
export async function handleOfficialPageHumanEcho(params: {
  pageId: string;
  userPsid: string;
  messageText: string;
  messageId: string;
  hasAttachments: boolean;
  attachmentType?: string;
}): Promise<boolean> {
  await ensurePlatformFacebookTables();

  const { pageId, userPsid, messageText, messageId, hasAttachments, attachmentType } = params;
  if (!pageId || !userPsid || !messageId || (!messageText && !hasAttachments)) {
    return false;
  }

  const convResult = await pool.query(
    `SELECT id FROM platform_conversations
     WHERE page_id = $1 AND user_id = $2
     LIMIT 1`,
    [pageId, userPsid]
  );

  if (convResult.rows.length === 0) {
    logger.info('Official page human echo: no conversation yet (bot stays active)', {
      pageId,
      userPsid,
      messageId,
    });
    return false;
  }

  const conversationId = convResult.rows[0].id as string;

  const existingMsg = await pool.query(
    `SELECT id FROM platform_messages
     WHERE conversation_id = $1 AND external_message_id = $2
     LIMIT 1`,
    [conversationId, messageId]
  );
  if (existingMsg.rows.length > 0) {
    return true;
  }

  if (messageText) {
    const recentDup = await pool.query(
      `SELECT id FROM platform_messages
       WHERE conversation_id = $1
         AND role = 'human'
         AND content = $2
         AND created_at > NOW() - INTERVAL '90 seconds'
       LIMIT 1`,
      [conversationId, messageText]
    );
    if (recentDup.rows.length > 0) {
      // Still ensure bot is paused
      await pool.query(
        `UPDATE platform_conversations
         SET bot_disabled = TRUE,
             status = 'human',
             last_human_response_at = CURRENT_TIMESTAMP,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $1`,
        [conversationId]
      );
      return true;
    }
  }

  const content = messageText || `[human ${attachmentType || 'attachment'}]`;
  await saveMessage(conversationId, 'human', content, messageId);

  await pool.query(
    `UPDATE platform_conversations
     SET bot_disabled = TRUE,
         status = 'human',
         last_human_response_at = CURRENT_TIMESTAMP,
         last_message_at = CURRENT_TIMESTAMP,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $1`,
    [conversationId]
  );

  logger.info('Official page human response detected — bot disabled for conversation', {
    conversationId,
    messageId,
    pageId,
    userPsid,
    hasText: !!messageText,
    hasAttachments,
  });

  return true;
}

/**
 * Process an inbound Messenger event for the official platform page.
 * Returns true if the event was handled (caller must not run merchant sales bot).
 */
export async function processOfficialPageMessage(
  event: any,
  page: PlatformFacebookPage
): Promise<boolean> {
  const settings = await loadOfficialPageBotSettings();
  const userId = String(event?.sender?.id || '');
  const pageId = String(event?.recipient?.id || page.page_id);
  const userName =
    typeof event?.sender?.name === 'string'
      ? event.sender.name
      : typeof event?.postback?.title === 'string'
        ? null
        : null;

  if (!userId || !pageId) {
    logger.warn('Official page bot: incomplete event', { pageId, userId });
    return true;
  }

  // Echoes are handled separately (human takeover). Never treat them as customer messages.
  if (event?.message?.is_echo) {
    return true;
  }
  if (event?.read || event?.delivery) {
    return true;
  }

  if (!settings.enabled) {
    logger.info('Official page bot disabled — ignoring inbound message', { pageId, userId });
    return true;
  }

  const inboundText = extractInboundText(event);
  if (!inboundText) {
    logger.debug('Official page bot: empty inbound', { pageId, userId });
    return true;
  }

  try {
    const conversation = await getOrCreateConversation({
      pageId,
      userId,
      userName,
    });

    await saveMessage(conversation.id, 'user', inboundText);

    // Human takeover: do not race the page admin / Inbox agent
    if (conversation.bot_disabled || conversation.status === 'human') {
      logger.info('Official page bot skipped — human owns conversation', {
        pageId,
        userId,
        conversationId: conversation.id,
        status: conversation.status,
      });
      return true;
    }

    // Extra safety: recent human message in thread (race before bot_disabled flag)
    const recentHuman = await pool.query(
      `SELECT 1 FROM platform_messages
       WHERE conversation_id = $1
         AND role = 'human'
         AND created_at > NOW() - INTERVAL '5 minutes'
       LIMIT 1`,
      [conversation.id]
    );
    if (recentHuman.rows.length > 0) {
      await pool.query(
        `UPDATE platform_conversations
         SET bot_disabled = TRUE, status = 'human', updated_at = CURRENT_TIMESTAMP
         WHERE id = $1`,
        [conversation.id]
      );
      logger.info('Official page bot skipped — recent human message', {
        pageId,
        userId,
        conversationId: conversation.id,
      });
      return true;
    }

    const history = await loadRecentMessages(conversation.id);
    const result = await generateContent(history, {
      systemInstruction: settings.systemMessage,
      temperature: 0.5,
      maxOutputTokens: 600,
    });

    const replyText =
      result.success && result.text?.trim()
        ? result.text.trim().slice(0, 1900)
        : 'شكراً لتواصلك مع XO Bot! تعذّر الرد الآن، حاول مجدداً بعد لحظات أو زر موقعنا xo-bot.com';

    await saveMessage(conversation.id, 'model', replyText);

    const sent = await sendFacebookMessage(pageId, userId, replyText, page.access_token);

    if (!sent) {
      logger.error('Official page bot: failed to send Messenger reply', new Error('send failed'), {
        pageId,
        userId,
      });
    }

    logger.info('Official page bot replied', {
      pageId,
      userId,
      conversationId: conversation.id,
      replyLength: replyText.length,
      aiOk: result.success,
    });
  } catch (err) {
    logger.error('Official page bot processing failed', err as Error, { pageId, userId });
    try {
      await sendFacebookMessage(
        pageId,
        userId,
        'حدث خطأ مؤقت. حاول مراسلتنا مرة أخرى بعد قليل.',
        page.access_token
      );
    } catch {
      /* ignore */
    }
  }

  return true;
}

export { DEFAULT_SYSTEM_MESSAGE as OFFICIAL_PAGE_BOT_DEFAULT_SYSTEM_MESSAGE };
