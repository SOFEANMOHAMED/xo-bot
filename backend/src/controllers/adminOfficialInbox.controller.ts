/**
 * Super-admin inbox for the official XO Bot Facebook page.
 * Queries only platform_* tables — never merchant conversations.
 */

import { Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth.js';
import { createError } from '../middleware/errorHandler.js';
import pool from '../database/connection.js';
import { logger } from '../utils/logger.js';
import {
  ensurePlatformFacebookTables,
  getLinkedPlatformFacebookPage,
} from '../services/platformFacebookPage.js';
import {
  sendFacebookMessage,
  sendFacebookImage,
} from '../services/channels/facebook.adapter.js';
import {
  PLATFORM_INBOX_SCOPE,
  subscribePlatformInbox,
  type PlatformInboxRealtimeEvent,
} from '../services/inbox/platformInboxRealtime.js';
import { ensurePlatformInboxRealtimeTriggers } from '../services/inbox/platformInboxRealtime.js';
import {
  ensurePlatformConversationCustomerName,
  isPlaceholderCustomerName,
} from '../services/socialProfile.js';

function mapPlatformMessage(row: {
  id: string;
  role: string;
  content: string;
  created_at: Date | string;
}) {
  const role = String(row.role || '');
  const senderType =
    role === 'user' ? 'user' : role === 'human' ? 'human' : 'bot';
  const uiRole = role === 'user' ? 'user' : 'assistant';
  const createdAt =
    row.created_at instanceof Date
      ? row.created_at.toISOString()
      : new Date(row.created_at).toISOString();

  return {
    id: String(row.id),
    role: uiRole,
    content: row.content,
    senderType,
    source: 'facebook_messenger',
    imageUrl: null as string | null,
    metadata: null as Record<string, unknown> | null,
    readAt: null as string | null,
    deliveredAt: null as string | null,
    timestamp: createdAt,
    createdAt,
  };
}

function writeSse(res: Response, event: string, data: unknown) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

/**
 * GET /api/admin/facebook/official/conversations
 */
export const listOfficialInboxConversations = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    await ensurePlatformFacebookTables();
    await ensurePlatformInboxRealtimeTriggers();

    const page = await getLinkedPlatformFacebookPage();
    if (!page) {
      return res.json({
        success: true,
        data: {
          linked: false,
          conversations: [],
          total: 0,
          limit: 50,
          offset: 0,
        },
      });
    }

    const status = typeof req.query.status === 'string' ? req.query.status.trim() : '';
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
    const limit = Math.min(Math.max(parseInt(String(req.query.limit || '50'), 10) || 50, 1), 100);
    const offset = Math.max(parseInt(String(req.query.offset || '0'), 10) || 0, 0);

    const params: unknown[] = [page.page_id];
    let where = `c.page_id = $1`;

    if (status === 'human' || status === 'bot' || status === 'hybrid') {
      params.push(status);
      where += ` AND COALESCE(c.status, 'bot') = $${params.length}`;
    } else if (status === 'needs_attention') {
      where += ` AND (COALESCE(c.bot_disabled, false) = true OR COALESCE(c.status, 'bot') = 'human')`;
    }

    if (search) {
      params.push(`%${search}%`);
      where += ` AND (c.user_name ILIKE $${params.length} OR c.user_id ILIKE $${params.length})`;
    }

    params.push(limit);
    const limitIdx = params.length;
    params.push(offset);
    const offsetIdx = params.length;

    const result = await pool.query(
      `SELECT
        c.id,
        c.user_id as "userId",
        c.user_name as "userName",
        c.last_message_at as "lastMessageAt",
        c.created_at as "createdAt",
        COALESCE(c.bot_disabled, false) as "botDisabled",
        COALESCE(c.status, 'bot') as status,
        c.last_human_response_at as "lastHumanResponseAt",
        c.admin_last_read_at as "adminLastReadAt",
        (
          SELECT m.content
          FROM platform_messages m
          WHERE m.conversation_id = c.id
          ORDER BY m.created_at DESC
          LIMIT 1
        ) as "lastMessagePreview",
        (
          SELECT CASE
            WHEN m.role = 'user' THEN 'user'
            WHEN m.role = 'human' THEN 'human'
            ELSE 'bot'
          END
          FROM platform_messages m
          WHERE m.conversation_id = c.id
          ORDER BY m.created_at DESC
          LIMIT 1
        ) as "lastSenderType",
        (
          SELECT COUNT(*)::int FROM platform_messages m WHERE m.conversation_id = c.id
        ) as "messageCount",
        (
          SELECT COUNT(*)::int
          FROM platform_messages m
          WHERE m.conversation_id = c.id
            AND m.role = 'user'
            AND (c.admin_last_read_at IS NULL OR m.created_at > c.admin_last_read_at)
        ) as "unreadCount"
       FROM platform_conversations c
       WHERE ${where}
       ORDER BY c.last_message_at DESC NULLS LAST
       LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      params
    );

    const countParams = params.slice(0, -2);
    const countResult = await pool.query(
      `SELECT COUNT(*)::int as total FROM platform_conversations c WHERE ${where}`,
      countParams
    );

    const conversations = result.rows.map((row) => ({
      id: String(row.id),
      platform: 'facebook_messenger',
      userId: row.userId || null,
      userName: row.userName || null,
      lastMessageAt: row.lastMessageAt,
      createdAt: row.createdAt,
      botDisabled: !!row.botDisabled,
      status: row.status || 'bot',
      lastHumanResponseAt: row.lastHumanResponseAt || null,
      adminLastReadAt: row.adminLastReadAt || null,
      lastMessagePreview: row.lastMessagePreview
        ? String(row.lastMessagePreview).slice(0, 180)
        : null,
      lastSenderType: row.lastSenderType || null,
      messageCount: row.messageCount || 0,
      unreadCount: row.unreadCount || 0,
    }));

    // Lazily resolve Meta display names for placeholder rows (bounded concurrency)
    const needsName = conversations.filter(
      (c) => c.userId && isPlaceholderCustomerName(c.userName)
    );
    if (needsName.length > 0) {
      await Promise.all(
        needsName.slice(0, 8).map(async (c) => {
          try {
            const resolved = await ensurePlatformConversationCustomerName({
              conversationId: c.id,
              pageId: page.page_id,
              userId: c.userId!,
              accessToken: page.access_token,
              currentName: c.userName,
            });
            if (!isPlaceholderCustomerName(resolved)) {
              c.userName = resolved;
            }
          } catch {
            /* ignore per-row failures */
          }
        })
      );
    }

    res.json({
      success: true,
      data: {
        linked: true,
        page: {
          pageId: page.page_id,
          pageName: page.page_name,
        },
        conversations,
        total: countResult.rows[0]?.total || 0,
        limit,
        offset,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/admin/facebook/official/conversations/:id
 */
export const getOfficialInboxConversation = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    await ensurePlatformFacebookTables();
    const page = await getLinkedPlatformFacebookPage();
    if (!page) {
      return next(createError('Official Facebook page is not linked', 404));
    }

    const conversationId = String(req.params.id || '').trim();
    if (!conversationId) {
      return next(createError('Conversation ID is required', 400));
    }

    const convResult = await pool.query(
      `SELECT
        id,
        user_id as "userId",
        user_name as "userName",
        last_message_at as "lastMessageAt",
        created_at as "createdAt",
        COALESCE(bot_disabled, false) as "botDisabled",
        COALESCE(status, 'bot') as status,
        last_human_response_at as "lastHumanResponseAt",
        admin_last_read_at as "adminLastReadAt"
       FROM platform_conversations
       WHERE id = $1 AND page_id = $2
       LIMIT 1`,
      [conversationId, page.page_id]
    );

    if (convResult.rows.length === 0) {
      return next(createError('Conversation not found', 404));
    }

    const conv = convResult.rows[0];
    let resolvedUserName = (conv.userName as string | null) || null;

    if (conv.userId && isPlaceholderCustomerName(resolvedUserName)) {
      try {
        const name = await ensurePlatformConversationCustomerName({
          conversationId: String(conv.id),
          pageId: page.page_id,
          userId: String(conv.userId),
          accessToken: page.access_token,
          currentName: resolvedUserName,
        });
        if (!isPlaceholderCustomerName(name)) {
          resolvedUserName = name;
        }
      } catch {
        /* keep existing */
      }
    }

    const messagesResult = await pool.query(
      `SELECT id, role, content, created_at
       FROM platform_messages
       WHERE conversation_id = $1
       ORDER BY created_at ASC`,
      [conversationId]
    );

    res.json({
      success: true,
      data: {
        conversation: {
          id: String(conv.id),
          platform: 'facebook_messenger',
          userId: conv.userId || null,
          userName: resolvedUserName,
          lastMessageAt: conv.lastMessageAt,
          createdAt: conv.createdAt,
          botDisabled: !!conv.botDisabled,
          status: conv.status || 'bot',
          lastHumanResponseAt: conv.lastHumanResponseAt || null,
          adminLastReadAt: conv.adminLastReadAt || null,
          sourcePost: null,
          messages: messagesResult.rows.map(mapPlatformMessage),
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/admin/facebook/official/conversations/:id/send-human-message
 */
export const sendOfficialInboxHumanMessage = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    await ensurePlatformFacebookTables();
    const page = await getLinkedPlatformFacebookPage();
    if (!page) {
      return next(createError('Official Facebook page is not linked', 404));
    }

    const conversationId = String(req.params.id || '').trim();
    const message = String(req.body?.message || '').trim();
    const imageUrl =
      typeof req.body?.imageUrl === 'string' && req.body.imageUrl.trim()
        ? req.body.imageUrl.trim()
        : null;

    if (!conversationId || (!message && !imageUrl)) {
      return next(createError('Conversation ID and message or image are required', 400));
    }
    if (message.length > 4000) {
      return next(createError('Message is too long (max 4000 characters)', 400));
    }

    const convCheck = await pool.query(
      `SELECT id, user_id, user_name
       FROM platform_conversations
       WHERE id = $1 AND page_id = $2
       LIMIT 1`,
      [conversationId, page.page_id]
    );

    if (convCheck.rows.length === 0) {
      return next(createError('Conversation not found', 404));
    }

    const recipientId = String(convCheck.rows[0].user_id || '').trim();
    if (!recipientId) {
      return next(createError('Conversation has no recipient user id', 400));
    }

    let delivered = false;
    if (imageUrl) {
      delivered = await sendFacebookImage(
        page.page_id,
        recipientId,
        imageUrl,
        message,
        page.access_token
      );
    } else {
      delivered = await sendFacebookMessage(
        page.page_id,
        recipientId,
        message,
        page.access_token
      );
    }

    if (!delivered) {
      return res.status(502).json({
        success: false,
        error: {
          message: 'Failed to deliver message via Facebook Messenger',
          code: 'SEND_FAILED',
        },
      });
    }

    const contentForDb = message || (imageUrl ? '📷 صورة' : '');
    const insertResult = await pool.query(
      `INSERT INTO platform_messages (conversation_id, role, content)
       VALUES ($1, 'human', $2)
       RETURNING id, role, content, created_at`,
      [conversationId, contentForDb]
    );

    await pool.query(
      `UPDATE platform_conversations
       SET bot_disabled = TRUE,
           status = 'human',
           last_human_response_at = CURRENT_TIMESTAMP,
           last_message_at = CURRENT_TIMESTAMP,
           admin_last_read_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND page_id = $2`,
      [conversationId, page.page_id]
    );

    const saved = mapPlatformMessage(insertResult.rows[0]);

    res.json({
      success: true,
      message: 'Message sent',
      data: {
        conversationId,
        delivered: true,
        message: saved,
        botDisabled: true,
        status: 'human',
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * PUT /api/admin/facebook/official/conversations/:id/disable-bot
 */
export const disableOfficialInboxBot = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    await ensurePlatformFacebookTables();
    const page = await getLinkedPlatformFacebookPage();
    if (!page) {
      return next(createError('Official Facebook page is not linked', 404));
    }

    const conversationId = String(req.params.id || '').trim();
    const result = await pool.query(
      `UPDATE platform_conversations
       SET bot_disabled = TRUE,
           status = 'human',
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND page_id = $2
       RETURNING id`,
      [conversationId, page.page_id]
    );

    if (result.rows.length === 0) {
      return next(createError('Conversation not found', 404));
    }

    res.json({ success: true, message: 'Bot disabled for conversation' });
  } catch (error) {
    next(error);
  }
};

/**
 * PUT /api/admin/facebook/official/conversations/:id/enable-bot
 */
export const enableOfficialInboxBot = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    await ensurePlatformFacebookTables();
    const page = await getLinkedPlatformFacebookPage();
    if (!page) {
      return next(createError('Official Facebook page is not linked', 404));
    }

    const conversationId = String(req.params.id || '').trim();
    const result = await pool.query(
      `UPDATE platform_conversations
       SET bot_disabled = FALSE,
           status = 'bot',
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND page_id = $2
       RETURNING id`,
      [conversationId, page.page_id]
    );

    if (result.rows.length === 0) {
      return next(createError('Conversation not found', 404));
    }

    res.json({ success: true, message: 'Bot re-enabled for conversation' });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/admin/facebook/official/conversations/:id/mark-read
 */
export const markOfficialInboxRead = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    await ensurePlatformFacebookTables();
    const page = await getLinkedPlatformFacebookPage();
    if (!page) {
      return next(createError('Official Facebook page is not linked', 404));
    }

    const conversationId = String(req.params.id || '').trim();
    const result = await pool.query(
      `UPDATE platform_conversations
       SET admin_last_read_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND page_id = $2
       RETURNING id`,
      [conversationId, page.page_id]
    );

    if (result.rows.length === 0) {
      return next(createError('Conversation not found', 404));
    }

    // Mark related inbox notifications as read
    await pool.query(
      `UPDATE admin_notifications
       SET is_read = TRUE, read_at = CURRENT_TIMESTAMP
       WHERE type = 'official_inbox'
         AND is_read = FALSE
         AND data->>'conversationId' = $1`,
      [conversationId]
    );

    res.json({ success: true, data: { ok: true } });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/admin/facebook/official/inbox/unread-count
 */
export const getOfficialInboxUnreadCount = async (
  _req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    await ensurePlatformFacebookTables();
    await ensurePlatformInboxRealtimeTriggers();

    const page = await getLinkedPlatformFacebookPage();
    if (!page) {
      return res.json({ success: true, data: { linked: false, unreadConversations: 0, unreadMessages: 0 } });
    }

    const result = await pool.query(
      `SELECT
         COUNT(*) FILTER (
           WHERE EXISTS (
             SELECT 1 FROM platform_messages m
             WHERE m.conversation_id = c.id
               AND m.role = 'user'
               AND (c.admin_last_read_at IS NULL OR m.created_at > c.admin_last_read_at)
           )
         )::int AS unread_conversations,
         COALESCE(SUM((
           SELECT COUNT(*)::int
           FROM platform_messages m
           WHERE m.conversation_id = c.id
             AND m.role = 'user'
             AND (c.admin_last_read_at IS NULL OR m.created_at > c.admin_last_read_at)
         )), 0)::int AS unread_messages
       FROM platform_conversations c
       WHERE c.page_id = $1`,
      [page.page_id]
    );

    res.json({
      success: true,
      data: {
        linked: true,
        unreadConversations: result.rows[0]?.unread_conversations || 0,
        unreadMessages: result.rows[0]?.unread_messages || 0,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/admin/facebook/official/inbox/stream  (SSE)
 */
export const streamOfficialInboxEvents = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    await ensurePlatformInboxRealtimeTriggers();

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();
    (res as any).flush?.();

    writeSse(res, 'connected', {
      type: 'connected',
      scope: PLATFORM_INBOX_SCOPE,
      at: new Date().toISOString(),
    });

    const unsubscribe = subscribePlatformInbox((event: PlatformInboxRealtimeEvent) => {
      writeSse(res, event.type, event);
      (res as any).flush?.();
    });

    const heartbeat = setInterval(() => {
      try {
        writeSse(res, 'heartbeat', {
          type: 'heartbeat',
          scope: PLATFORM_INBOX_SCOPE,
          at: new Date().toISOString(),
        });
        (res as any).flush?.();
      } catch {
        /* closed */
      }
    }, 20000);

    const cleanup = () => {
      clearInterval(heartbeat);
      unsubscribe();
    };

    req.on('close', cleanup);
    req.on('aborted', cleanup);
    res.on('close', cleanup);

    logger.info('Platform inbox SSE client connected', {
      adminId: req.merchantId || req.userId,
    });
  } catch (error) {
    next(error);
  }
};
