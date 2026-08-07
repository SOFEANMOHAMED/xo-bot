import { Response, NextFunction } from 'express';
import pool from '../database/connection.js';
import { createError } from '../middleware/errorHandler.js';
import { AuthRequest } from '../middleware/auth.js';
import { z } from 'zod';
import {
  sendMerchantReply,
  inboxSourceForPlatform,
} from '../services/inbox/sendMerchantReply.js';
import { setConversationTyping, markConversationSeen } from '../services/inbox/presence.js';
import { toPublicMediaUrl, buildInboxMetadata } from '../services/inbox/messageMedia.js';
import {
  ensureConversationCustomerName,
  isPlaceholderCustomerName,
} from '../services/socialProfile.js';
import { resolveConversationSourcePost } from '../services/conversationSourcePost.js';

const messageSchema = z.object({
  role: z.enum(['user', 'assistant', 'system']),
  content: z.string().min(1),
  platform: z.enum(['web', 'facebook_messenger', 'facebook_comment', 'telegram']).optional()
});

const conversationSchema = z.object({
  platform: z.enum(['web', 'facebook_messenger', 'facebook_comment', 'telegram']).default('web'),
  userId: z.string().optional(),
  userName: z.string().optional(),
  messages: z.array(messageSchema).min(1)
});

/** Platforms shown in merchant inbox (exclude internal playground-only noise by default). */
const INBOX_PLATFORMS = [
  'facebook_messenger',
  'instagram',
  'telegram',
  'whatsapp',
] as const;

// Get all conversations for a merchant (inbox list)
export const getConversations = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    if (!req.merchantId) {
      return next(createError('Unauthorized', 401));
    }

    const platform = typeof req.query.platform === 'string' ? req.query.platform.trim() : '';
    const status = typeof req.query.status === 'string' ? req.query.status.trim() : '';
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
    const includeWeb = req.query.includeWeb === 'true';
    const limit = Math.min(Math.max(parseInt(String(req.query.limit || '50'), 10) || 50, 1), 100);
    const offset = Math.max(parseInt(String(req.query.offset || '0'), 10) || 0, 0);

    const params: unknown[] = [req.merchantId];
    let where = `c.merchant_id = $1`;

    if (platform && platform !== 'all') {
      params.push(platform);
      where += ` AND c.platform = $${params.length}`;
    } else if (!includeWeb) {
      params.push([...INBOX_PLATFORMS]);
      where += ` AND c.platform = ANY($${params.length}::text[])`;
    }

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
        c.platform,
        c.user_id as "userId",
        c.user_name as "userName",
        c.last_message_at as "lastMessageAt",
        c.created_at as "createdAt",
        COALESCE(c.bot_disabled, false) as "botDisabled",
        COALESCE(c.status, 'bot') as status,
        c.last_human_response_at as "lastHumanResponseAt",
        (
          SELECT m.content
          FROM messages m
          WHERE m.conversation_id = c.id
          ORDER BY m.created_at DESC
          LIMIT 1
        ) as "lastMessagePreview",
        (
          SELECT COALESCE(m.sender_type, CASE WHEN m.role = 'user' THEN 'user' ELSE 'bot' END)
          FROM messages m
          WHERE m.conversation_id = c.id
          ORDER BY m.created_at DESC
          LIMIT 1
        ) as "lastSenderType",
        (
          SELECT COUNT(*)::int FROM messages m WHERE m.conversation_id = c.id
        ) as "messageCount"
       FROM conversations c
       WHERE ${where}
       ORDER BY c.last_message_at DESC NULLS LAST
       LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      params
    );

    const countParams = params.slice(0, -2);
    const countResult = await pool.query(
      `SELECT COUNT(*)::int as total FROM conversations c WHERE ${where}`,
      countParams
    );

    const conversations = result.rows.map((row) => ({
      id: String(row.id),
      platform: row.platform,
      userId: row.userId || null,
      userName: row.userName || null,
      lastMessageAt: row.lastMessageAt,
      createdAt: row.createdAt,
      botDisabled: !!row.botDisabled,
      status: row.status || 'bot',
      lastHumanResponseAt: row.lastHumanResponseAt || null,
      lastMessagePreview: row.lastMessagePreview
        ? String(row.lastMessagePreview).slice(0, 180)
        : null,
      lastSenderType: row.lastSenderType || null,
      messageCount: row.messageCount || 0,
    }));

    // Lazily resolve Meta display names for placeholder rows (bounded concurrency)
    const needsName = conversations.filter(
      (c) =>
        c.userId &&
        (c.platform === 'facebook_messenger' || c.platform === 'instagram') &&
        isPlaceholderCustomerName(c.userName)
    );
    if (needsName.length > 0) {
      await Promise.all(
        needsName.slice(0, 8).map(async (c) => {
          try {
            const resolved = await ensureConversationCustomerName({
              merchantId: req.merchantId!,
              conversationId: c.id,
              platform: c.platform,
              userId: c.userId!,
              currentName: c.userName,
            });
            c.userName = resolved;
          } catch {
            /* non-fatal — keep placeholder */
          }
        })
      );
    }

    res.json({
      success: true,
      data: {
        conversations,
        total: countResult.rows[0]?.total || 0,
        limit,
        offset,
      },
    });
  } catch (error: any) {
    console.error('Error fetching conversations:', error);
    next(error);
  }
};

// Get a single conversation with messages
export const getConversation = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    if (!req.merchantId) {
      return next(createError('Unauthorized', 401));
    }

    const { id } = req.params;

    const convResult = await pool.query(
      `SELECT 
        c.id,
        c.platform,
        c.user_id as "userId",
        c.user_name as "userName",
        c.last_message_at as "lastMessageAt",
        c.created_at as "createdAt",
        COALESCE(c.bot_disabled, false) as "botDisabled",
        COALESCE(c.status, 'bot') as status,
        c.last_human_response_at as "lastHumanResponseAt"
       FROM conversations c
       WHERE c.id = $1 AND c.merchant_id = $2`,
      [id, req.merchantId]
    );

    if (convResult.rows.length === 0) {
      return next(createError('Conversation not found', 404));
    }

    const conversation = convResult.rows[0];

    let resolvedUserName = conversation.userName || null;
    if (
      conversation.userId &&
      (conversation.platform === 'facebook_messenger' || conversation.platform === 'instagram') &&
      isPlaceholderCustomerName(resolvedUserName)
    ) {
      try {
        resolvedUserName = await ensureConversationCustomerName({
          merchantId: req.merchantId,
          conversationId: String(conversation.id),
          platform: conversation.platform,
          userId: conversation.userId,
          currentName: resolvedUserName,
        });
      } catch {
        /* keep existing */
      }
    }

    const messagesResult = await pool.query(
      `SELECT 
        id,
        role,
        content,
        COALESCE(sender_type, CASE WHEN role = 'user' THEN 'user' ELSE 'bot' END) as "senderType",
        source,
        metadata,
        created_at as "createdAt"
       FROM messages
       WHERE conversation_id = $1
       ORDER BY created_at ASC`,
      [id]
    );

    const messages = messagesResult.rows.map((row) => {
      const metadata =
        row.metadata && typeof row.metadata === 'object' ? row.metadata : {};
      const imageUrl =
        typeof metadata.imageUrl === 'string'
          ? metadata.imageUrl
          : typeof metadata.image_url === 'string'
            ? metadata.image_url
            : null;
      const createdAtIso =
        row.createdAt instanceof Date
          ? row.createdAt.toISOString()
          : new Date(row.createdAt).toISOString();
      return {
        id: String(row.id),
        role: row.role,
        content: row.content,
        senderType: row.senderType || (row.role === 'user' ? 'user' : 'bot'),
        source: row.source || null,
        metadata,
        imageUrl,
        readAt: metadata.readAt || null,
        deliveredAt: metadata.deliveredAt || null,
        timestamp: createdAtIso,
        createdAt: createdAtIso,
      };
    });

    const sourcePost = await resolveConversationSourcePost({
      merchantId: req.merchantId,
      conversationId: String(conversation.id),
      conversationPlatform: conversation.platform,
    });

    res.json({
      success: true,
      data: {
        conversation: {
          id: String(conversation.id),
          platform: conversation.platform,
          userId: conversation.userId || null,
          userName: resolvedUserName || null,
          lastMessageAt: conversation.lastMessageAt,
          createdAt: conversation.createdAt,
          botDisabled: !!conversation.botDisabled,
          status: conversation.status || 'bot',
          lastHumanResponseAt: conversation.lastHumanResponseAt || null,
          sourcePost,
          messages,
        },
      },
    });
  } catch (error: any) {
    console.error('Error fetching conversation:', error);
    next(error);
  }
};

// Create a new conversation with messages
export const createConversation = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    if (!req.merchantId) {
      return next(createError('Unauthorized', 401));
    }

    const validated = conversationSchema.parse(req.body);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Create conversation
      const convResult = await client.query(
        `INSERT INTO conversations (
          merchant_id, platform, user_id, user_name
        ) VALUES ($1, $2, $3, $4)
        RETURNING id, platform, user_id as "userId", user_name as "userName", 
                  last_message_at as "lastMessageAt", created_at as "createdAt"`,
        [
          req.merchantId,
          validated.platform,
          validated.userId || null,
          validated.userName || null
        ]
      );

      const conversationId = convResult.rows[0].id;

      // Insert messages
      const messages = [];
      for (const msg of validated.messages) {
        const msgResult = await client.query(
          `INSERT INTO messages (
            conversation_id, role, content
          ) VALUES ($1, $2, $3)
          RETURNING id, role, content, created_at as "createdAt"`,
          [conversationId, msg.role, msg.content]
        );

        messages.push({
          id: msgResult.rows[0].id,
          role: msgResult.rows[0].role,
          content: msgResult.rows[0].content,
          timestamp: msgResult.rows[0].createdAt,
          createdAt: msgResult.rows[0].createdAt
        });
      }

      // Update conversation last_message_at
      await client.query(
        `UPDATE conversations 
         SET last_message_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
         WHERE id = $1`,
        [conversationId]
      );

      await client.query('COMMIT');

      res.status(201).json({
        success: true,
        data: {
          conversation: {
            id: conversationId,
            platform: convResult.rows[0].platform,
            userId: convResult.rows[0].userId,
            userName: convResult.rows[0].userName,
            lastMessageAt: convResult.rows[0].lastMessageAt,
            createdAt: convResult.rows[0].createdAt,
            messages
          }
        }
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return next(createError(error.errors[0].message, 400));
    }
    console.error('Error creating conversation:', error);
    next(error);
  }
};

// Add a message to an existing conversation
export const addMessage = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    if (!req.merchantId) {
      return next(createError('Unauthorized', 401));
    }

    const { id } = req.params;
    const validated = messageSchema.parse(req.body);

    // Verify conversation belongs to merchant
    const convCheck = await pool.query(
      'SELECT id FROM conversations WHERE id = $1 AND merchant_id = $2',
      [id, req.merchantId]
    );

    if (convCheck.rows.length === 0) {
      return next(createError('Conversation not found', 404));
    }

    // Insert message
    const msgResult = await pool.query(
      `INSERT INTO messages (conversation_id, role, content)
       VALUES ($1, $2, $3)
       RETURNING id, role, content, created_at as "createdAt"`,
      [id, validated.role, validated.content]
    );

    // Update conversation last_message_at
    await pool.query(
      `UPDATE conversations 
       SET last_message_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [id]
    );

    const message = {
      id: msgResult.rows[0].id,
      role: msgResult.rows[0].role,
      content: msgResult.rows[0].content,
      timestamp: msgResult.rows[0].createdAt,
      createdAt: msgResult.rows[0].createdAt
    };

    res.status(201).json({
      success: true,
      data: { message }
    });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return next(createError(error.errors[0].message, 400));
    }
    console.error('Error adding message:', error);
    next(error);
  }
};

// Get or create a conversation for a specific platform/user
export const getOrCreateConversation = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    if (!req.merchantId) {
      return next(createError('Unauthorized', 401));
    }

    const { platform, userId } = req.query;

    if (!platform || !userId) {
      return next(createError('Platform and userId are required', 400));
    }

    // Try to find existing conversation
    const existingResult = await pool.query(
      `SELECT id FROM conversations 
       WHERE merchant_id = $1 AND platform = $2 AND user_id = $3
       ORDER BY last_message_at DESC
       LIMIT 1`,
      [req.merchantId, platform, userId]
    );

    let conversationId: string;

    if (existingResult.rows.length > 0) {
      conversationId = existingResult.rows[0].id;
    } else {
      // Create new conversation
      const newConvResult = await pool.query(
        `INSERT INTO conversations (merchant_id, platform, user_id)
         VALUES ($1, $2, $3)
         RETURNING id`,
        [req.merchantId, platform, userId]
      );
      conversationId = newConvResult.rows[0].id;
    }

    // Get conversation with messages
    const convResult = await pool.query(
      `SELECT 
        c.id,
        c.platform,
        c.user_id as "userId",
        c.user_name as "userName",
        c.last_message_at as "lastMessageAt",
        c.created_at as "createdAt"
       FROM conversations c
       WHERE c.id = $1`,
      [conversationId]
    );

    const messagesResult = await pool.query(
      `SELECT 
        id,
        role,
        content,
        created_at as "createdAt"
       FROM messages
       WHERE conversation_id = $1
       ORDER BY created_at DESC`,
      [conversationId]
    );

    const messages = messagesResult.rows.map(row => ({
      id: row.id,
      role: row.role,
      content: row.content,
      timestamp: row.createdAt,
      createdAt: row.createdAt
    }));

    res.json({
      success: true,
      data: {
        conversation: {
          ...convResult.rows[0],
          messages
        }
      }
    });
  } catch (error: any) {
    console.error('Error getting or creating conversation:', error);
    next(error);
  }
};

// Disable bot for a conversation (Human Takeover)
export const disableBotForConversation = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const { conversationId } = req.params;
    const merchantId = req.merchantId;
    
    if (!merchantId) {
      return next(createError('Unauthorized', 401));
    }

    // Verify conversation belongs to merchant
    const convCheck = await pool.query(
      'SELECT id FROM conversations WHERE id = $1 AND merchant_id = $2',
      [conversationId, merchantId]
    );

    if (convCheck.rows.length === 0) {
      return next(createError('Conversation not found', 404));
    }

    await pool.query(
      `UPDATE conversations 
       SET bot_disabled = TRUE, 
           status = 'human',
           last_human_response_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND merchant_id = $2`,
      [conversationId, merchantId]
    );

    res.json({ 
      success: true, 
      message: 'Bot disabled for this conversation' 
    });
  } catch (error: any) {
    console.error('Error disabling bot for conversation:', error);
    next(error);
  }
};

// Enable bot for a conversation
export const enableBotForConversation = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const { conversationId } = req.params;
    const merchantId = req.merchantId;
    
    if (!merchantId) {
      return next(createError('Unauthorized', 401));
    }

    // Verify conversation belongs to merchant
    const convCheck = await pool.query(
      'SELECT id FROM conversations WHERE id = $1 AND merchant_id = $2',
      [conversationId, merchantId]
    );

    if (convCheck.rows.length === 0) {
      return next(createError('Conversation not found', 404));
    }

    await pool.query(
      `UPDATE conversations 
       SET bot_disabled = FALSE, 
           status = 'bot',
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND merchant_id = $2`,
      [conversationId, merchantId]
    );

    res.json({ 
      success: true, 
      message: 'Bot enabled for this conversation' 
    });
  } catch (error: any) {
    console.error('Error enabling bot for conversation:', error);
    next(error);
  }
};

// Send human message from merchant inbox (persists + delivers on channel)
export const sendHumanMessage = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const merchantId = req.merchantId;
    if (!merchantId) {
      return next(createError('Unauthorized', 401));
    }

    const conversationId = String(
      req.params.conversationId || req.body?.conversationId || ''
    ).trim();
    const message = String(req.body?.message || '').trim();
    const imageUrl = toPublicMediaUrl(
      typeof req.body?.imageUrl === 'string' ? req.body.imageUrl : null
    );

    if (!conversationId || (!message && !imageUrl)) {
      return next(createError('Conversation ID and message or image are required', 400));
    }
    if (message.length > 4000) {
      return next(createError('Message is too long (max 4000 characters)', 400));
    }

    const convCheck = await pool.query(
      `SELECT id, platform, user_id, user_name
       FROM conversations
       WHERE id = $1 AND merchant_id = $2`,
      [conversationId, merchantId]
    );

    if (convCheck.rows.length === 0) {
      return next(createError('Conversation not found', 404));
    }

    const conversation = convCheck.rows[0];
    const convPlatform = String(conversation.platform || '');
    const recipientId = String(
      req.body?.recipientId || conversation.user_id || ''
    ).trim();

    if (!recipientId) {
      return next(createError('Conversation has no recipient user id', 400));
    }

    const source = inboxSourceForPlatform(convPlatform);
    const delivery = await sendMerchantReply({
      merchantId,
      conversationId,
      platform: convPlatform,
      recipientUserId: recipientId,
      text: message,
      imageUrl,
    });

    if (!delivery.delivered) {
      return res.status(502).json({
        success: false,
        error: {
          message: delivery.errorMessage || 'Failed to deliver message',
          code: delivery.errorCode || 'SEND_FAILED',
        },
      });
    }

    const contentForDb = message || (imageUrl ? '📷 صورة' : '');
    const metadata = buildInboxMetadata(
      { platform: convPlatform, outbound: true },
      imageUrl ? { type: 'image', imageUrl } : { type: 'text' }
    );

    const insertResult = await pool.query(
      `INSERT INTO messages (conversation_id, role, content, sender_type, source, metadata)
       VALUES ($1, 'assistant', $2, 'human', $3, $4::jsonb)
       RETURNING id, role, content, sender_type as "senderType", source, metadata, created_at as "createdAt"`,
      [conversationId, contentForDb, source, JSON.stringify(metadata)]
    );

    await pool.query(
      `UPDATE conversations
       SET bot_disabled = TRUE,
           status = 'human',
           last_human_response_at = CURRENT_TIMESTAMP,
           last_message_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND merchant_id = $2`,
      [conversationId, merchantId]
    );

    const saved = insertResult.rows[0];
    const savedMeta = saved.metadata || metadata;
    const createdAtIso =
      saved.createdAt instanceof Date
        ? saved.createdAt.toISOString()
        : new Date(saved.createdAt).toISOString();

    res.json({
      success: true,
      message: 'Message sent',
      data: {
        conversationId,
        delivered: true,
        message: {
          id: String(saved.id),
          role: saved.role,
          content: saved.content,
          senderType: saved.senderType || 'human',
          source: saved.source,
          metadata: savedMeta,
          imageUrl: savedMeta?.imageUrl || imageUrl || null,
          createdAt: createdAtIso,
          timestamp: createdAtIso,
        },
        botDisabled: true,
        status: 'human',
      },
    });
  } catch (error: any) {
    console.error('Error sending human message:', error);
    next(error);
  }
};

/** Merchant is typing in inbox → forward typing indicator to channel */
export const setInboxTyping = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const merchantId = req.merchantId;
    if (!merchantId) return next(createError('Unauthorized', 401));

    const conversationId = String(req.params.conversationId || '').trim();
    const isTyping = req.body?.isTyping !== false && req.body?.isTyping !== 'false';

    const conv = await pool.query(
      `SELECT id, platform, user_id FROM conversations WHERE id = $1 AND merchant_id = $2`,
      [conversationId, merchantId]
    );
    if (conv.rows.length === 0) return next(createError('Conversation not found', 404));
    if (!conv.rows[0].user_id) {
      return res.json({ success: true, data: { ok: false } });
    }

    const result = await setConversationTyping({
      merchantId,
      conversationId,
      platform: conv.rows[0].platform,
      recipientUserId: conv.rows[0].user_id,
      isTyping: !!isTyping,
    });

    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
};

/** Merchant opened thread → mark_seen on channel + mark inbound messages read */
export const markInboxRead = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const merchantId = req.merchantId;
    if (!merchantId) return next(createError('Unauthorized', 401));

    const conversationId = String(req.params.conversationId || '').trim();
    const conv = await pool.query(
      `SELECT id, platform, user_id FROM conversations WHERE id = $1 AND merchant_id = $2`,
      [conversationId, merchantId]
    );
    if (conv.rows.length === 0) return next(createError('Conversation not found', 404));

    const result = await markConversationSeen({
      merchantId,
      conversationId,
      platform: conv.rows[0].platform,
      recipientUserId: String(conv.rows[0].user_id || ''),
    });

    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
};

// Auto re-enable bot for inactive conversations
export const autoReenableBot = async () => {
  try {
    const result = await pool.query(
      `UPDATE conversations 
       SET bot_disabled = FALSE,
           status = 'bot',
           updated_at = CURRENT_TIMESTAMP
       WHERE bot_disabled = TRUE 
         AND last_human_response_at < NOW() - INTERVAL '1 hour'
         AND last_message_at < NOW() - INTERVAL '30 minutes'`
    );
    
    if (result.rowCount && result.rowCount > 0) {
      console.log(`Auto re-enabled bot for ${result.rowCount} conversations`);
    }
  } catch (error: any) {
    console.error('Error in auto re-enable bot:', error);
  }
};

// ==================== HELPER FUNCTIONS FOR CONVERSATION STATE ====================

/**
 * Get conversation by platform and user ID (helper function, not a route handler)
 * @param merchantId - Merchant ID
 * @param platform - Platform name (web, facebook_messenger, telegram, etc.)
 * @param userId - User ID on the platform
 * @returns Conversation object or null if not found
 */
export const getConversationByPlatformUser = async (
  merchantId: string,
  platform: string,
  userId: string
): Promise<{
  id: string;
  platform: string;
  userId: string | null;
  userName: string | null;
  conversationState: any;
  currentIntent: string | null;
  sessionMetadata: any;
  stage: string;
  lastMessageAt: Date;
  createdAt: Date;
  updatedAt: Date;
} | null> => {
  try {
    const result = await pool.query(
      `SELECT 
        id,
        platform,
        user_id as "userId",
        user_name as "userName",
        conversation_state as "conversationState",
        current_intent as "currentIntent",
        session_metadata as "sessionMetadata",
        stage,
        last_message_at as "lastMessageAt",
        created_at as "createdAt",
        updated_at as "updatedAt"
       FROM conversations 
       WHERE merchant_id = $1 AND platform = $2 AND user_id = $3
       ORDER BY last_message_at DESC
       LIMIT 1`,
      [merchantId, platform, userId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    return {
      id: row.id,
      platform: row.platform,
      userId: row.userId,
      userName: row.userName,
      conversationState: row.conversationState || {},
      currentIntent: row.currentIntent,
      sessionMetadata: row.sessionMetadata || {},
      stage: row.stage || 'discover',
      lastMessageAt: row.lastMessageAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt
    };
  } catch (error: any) {
    console.error('Error getting conversation by platform/user:', error);
    throw error;
  }
};

/**
 * Update conversation state (merge JSONB, update intent/stage)
 * @param conversationId - Conversation ID
 * @param patchObject - Object with:
 *   - conversationState?: object - Will be merged with existing state (not overwritten)
 *   - currentIntent?: string - Will update current_intent
 *   - stage?: string - Will update stage
 *   - sessionMetadata?: object - Will be merged with existing metadata
 * @returns Updated conversation or null if not found
 */
export const updateConversationState = async (
  conversationId: string,
  patchObject: {
    conversationState?: Record<string, any>;
    currentIntent?: string;
    stage?: string;
    sessionMetadata?: Record<string, any>;
  }
): Promise<{
  id: string;
  conversationState: any;
  currentIntent: string | null;
  stage: string;
  sessionMetadata: any;
} | null> => {
  try {
    // Build update query dynamically based on provided fields
    const updates: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    // Merge conversation_state if provided
    if (patchObject.conversationState !== undefined) {
      updates.push(
        `conversation_state = COALESCE(conversation_state, '{}'::jsonb) || $${paramIndex}::jsonb`
      );
      values.push(JSON.stringify(patchObject.conversationState));
      paramIndex++;
    }

    // Update current_intent if provided
    if (patchObject.currentIntent !== undefined) {
      updates.push(`current_intent = $${paramIndex}`);
      values.push(patchObject.currentIntent || null);
      paramIndex++;
    }

    // Update stage if provided
    if (patchObject.stage !== undefined) {
      updates.push(`stage = $${paramIndex}`);
      values.push(patchObject.stage);
      paramIndex++;
    }

    // Merge session_metadata if provided
    if (patchObject.sessionMetadata !== undefined) {
      updates.push(
        `session_metadata = COALESCE(session_metadata, '{}'::jsonb) || $${paramIndex}::jsonb`
      );
      values.push(JSON.stringify(patchObject.sessionMetadata));
      paramIndex++;
    }

    if (updates.length === 0) {
      // No updates to perform, just return current state
      const result = await pool.query(
        `SELECT 
          id,
          conversation_state as "conversationState",
          current_intent as "currentIntent",
          stage,
          session_metadata as "sessionMetadata"
         FROM conversations 
         WHERE id = $1`,
        [conversationId]
      );
      return result.rows.length > 0 ? {
        id: result.rows[0].id,
        conversationState: result.rows[0].conversationState || {},
        currentIntent: result.rows[0].currentIntent,
        stage: result.rows[0].stage || 'discover',
        sessionMetadata: result.rows[0].sessionMetadata || {}
      } : null;
    }

    // Add updated_at
    updates.push(`updated_at = CURRENT_TIMESTAMP`);

    // Add conversationId to values
    values.push(conversationId);

    const updateQuery = `
      UPDATE conversations 
      SET ${updates.join(', ')}
      WHERE id = $${paramIndex}
      RETURNING 
        id,
        conversation_state as "conversationState",
        current_intent as "currentIntent",
        stage,
        session_metadata as "sessionMetadata"
    `;

    const result = await pool.query(updateQuery, values);

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    return {
      id: row.id,
      conversationState: row.conversationState || {},
      currentIntent: row.currentIntent,
      stage: row.stage || 'discover',
      sessionMetadata: row.sessionMetadata || {}
    };
  } catch (error: any) {
    console.error('Error updating conversation state:', error);
    throw error;
  }
};

/**
 * Append a message to conversation with metadata, intent, and entities
 * @param conversationId - Conversation ID
 * @param role - Message role (user, assistant, system)
 * @param content - Message content
 * @param senderType - Sender type (user, bot, human) - optional
 * @param externalMessageId - External message ID (from platform) - optional
 * @param metadata - Message metadata JSON object - optional
 * @param intent - Detected intent - optional
 * @param entities - Extracted entities JSON object - optional
 * @returns Created message object
 */
export const appendMessage = async (
  conversationId: string,
  role: 'user' | 'assistant' | 'system',
  content: string,
  senderType?: string,
  externalMessageId?: string,
  metadata?: Record<string, any>,
  intent?: string,
  entities?: Record<string, any>
): Promise<{
  id: string;
  conversationId: string;
  role: string;
  content: string;
  metadata: any;
  intent: string | null;
  entities: any;
  createdAt: Date;
}> => {
  try {
    const result = await pool.query(
      `INSERT INTO messages (
        conversation_id, 
        role, 
        content,
        sender_type,
        external_message_id,
        metadata,
        intent,
        entities
      )
      VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8::jsonb)
      RETURNING 
        id,
        conversation_id as "conversationId",
        role,
        content,
        metadata,
        intent,
        entities,
        created_at as "createdAt"`,
      [
        conversationId,
        role,
        content,
        senderType || null,
        externalMessageId || null,
        metadata ? JSON.stringify(metadata) : '{}',
        intent || null,
        entities ? JSON.stringify(entities) : '{}'
      ]
    );

    // Update conversation last_message_at
    await pool.query(
      `UPDATE conversations 
       SET last_message_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [conversationId]
    );

    const row = result.rows[0];
    return {
      id: row.id,
      conversationId: row.conversationId,
      role: row.role,
      content: row.content,
      metadata: row.metadata || {},
      intent: row.intent,
      entities: row.entities || {},
      createdAt: row.createdAt
    };
  } catch (error: any) {
    console.error('Error appending message:', error);
    throw error;
  }
};

// ==================== CHANNEL-AGNOSTIC ORCHESTRATOR HELPERS ====================

/**
 * Get or create conversation (helper function, not a route handler)
 * Channel-agnostic version for orchestrator use
 * 
 * @param params - { merchantId, platform, userId }
 * @returns Conversation object with all fields
 */
export const getOrCreateConversationHelper = async (params: {
  merchantId: string;
  platform: string;
  userId: string;
}): Promise<{
  id: string;
  merchantId: string;
  platform: string;
  userId: string | null;
  userName: string | null;
  conversationState: any;
  currentIntent: string | null;
  sessionMetadata: any;
  stage: string;
  lastError: string | null;
  lastMessageAt: Date;
  createdAt: Date;
  updatedAt: Date;
}> => {
  try {
    const { merchantId, platform, userId } = params;

    // Try to find existing conversation
    const existingResult = await pool.query(
      `SELECT 
        id,
        merchant_id,
        platform,
        user_id,
        user_name,
        conversation_state,
        current_intent,
        session_metadata,
        stage,
        last_error,
        last_message_at,
        created_at,
        updated_at
       FROM conversations 
       WHERE merchant_id = $1 AND platform = $2 AND user_id = $3
       ORDER BY last_message_at DESC
       LIMIT 1`,
      [merchantId, platform, userId]
    );

    if (existingResult.rows.length > 0) {
      const row = existingResult.rows[0];
      return {
        id: row.id,
        merchantId: row.merchant_id,
        platform: row.platform,
        userId: row.user_id,
        userName: row.user_name,
        conversationState: row.conversation_state || {},
        currentIntent: row.current_intent,
        sessionMetadata: row.session_metadata || {},
        stage: row.stage || 'discover',
        lastError: row.last_error,
        lastMessageAt: row.last_message_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      };
    }

    // Create new conversation with defaults
    const newConvResult = await pool.query(
      `INSERT INTO conversations (
        merchant_id, 
        platform, 
        user_id,
        conversation_state,
        stage
      )
      VALUES ($1, $2, $3, '{}'::jsonb, 'discover')
      RETURNING 
        id,
        merchant_id,
        platform,
        user_id,
        user_name,
        conversation_state,
        current_intent,
        session_metadata,
        stage,
        last_error,
        last_message_at,
        created_at,
        updated_at`,
      [merchantId, platform, userId]
    );

    const row = newConvResult.rows[0];
    return {
      id: row.id,
      merchantId: row.merchant_id,
      platform: row.platform,
      userId: row.user_id,
      userName: row.user_name,
      conversationState: row.conversation_state || {},
      currentIntent: row.current_intent,
      sessionMetadata: row.session_metadata || {},
      stage: row.stage || 'discover',
      lastError: row.last_error,
      lastMessageAt: row.last_message_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  } catch (error: any) {
    console.error('Error getting or creating conversation:', error);
    throw error;
  }
};

/**
 * Get recent messages for a conversation
 * Returns last N messages ordered ascending (oldest -> newest)
 * 
 * @param conversationId - Conversation ID
 * @param limit - Number of messages to return (default: 10)
 * @returns Array of messages
 */
export const getRecentMessages = async (
  conversationId: string,
  limit: number = 10
): Promise<Array<{
  id: string;
  conversationId: string;
  role: string;
  content: string;
  metadata: any;
  intent: string | null;
  entities: any;
  createdAt: Date;
}>> => {
  try {
    const result = await pool.query(
      `SELECT 
        id,
        conversation_id as "conversationId",
        role,
        content,
        metadata,
        intent,
        entities,
        created_at as "createdAt"
       FROM messages
       WHERE conversation_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [conversationId, limit]
    );

    return result.rows.map(row => ({
      id: row.id,
      conversationId: row.conversationId,
      role: row.role,
      content: row.content,
      metadata: row.metadata || {},
      intent: row.intent,
      entities: row.entities || {},
      createdAt: row.createdAt
    }));
  } catch (error: any) {
    console.error('Error getting recent messages:', error);
    throw error;
  }
};

/**
 * Patch conversation state (merge JSONB, update columns)
 * Channel-agnostic version for orchestrator use
 * 
 * @param conversationId - Conversation ID
 * @param patch - Object to merge into conversation_state and update columns
 * @returns Updated conversation or null if not found
 */
export const patchConversationState = async (
  conversationId: string,
  patch: {
    conversation_state?: Record<string, any>;
    stage?: string;
    current_intent?: string;
    session_metadata?: Record<string, any>;
    [key: string]: any; // Allow other fields
  }
): Promise<{
  id: string;
  conversationState: any;
  currentIntent: string | null;
  stage: string;
  sessionMetadata: any;
} | null> => {
  try {
    // Build update query dynamically
    const updates: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    // Merge conversation_state if provided
    if (patch.conversation_state !== undefined) {
      updates.push(
        `conversation_state = conversation_state || $${paramIndex}::jsonb`
      );
      values.push(JSON.stringify(patch.conversation_state));
      paramIndex++;
    }

    // Update current_intent if provided
    if (patch.current_intent !== undefined) {
      updates.push(`current_intent = $${paramIndex}`);
      values.push(patch.current_intent || null);
      paramIndex++;
    }

    // Update stage if provided
    if (patch.stage !== undefined) {
      updates.push(`stage = $${paramIndex}`);
      values.push(patch.stage);
      paramIndex++;
    }

    // Merge session_metadata if provided (don't overwrite, merge)
    if (patch.session_metadata !== undefined) {
      updates.push(
        `session_metadata = session_metadata || $${paramIndex}::jsonb`
      );
      values.push(JSON.stringify(patch.session_metadata));
      paramIndex++;
    }

    if (updates.length === 0) {
      // No updates to perform, just return current state
      const result = await pool.query(
        `SELECT 
          id,
          conversation_state as "conversationState",
          current_intent as "currentIntent",
          stage,
          session_metadata as "sessionMetadata"
         FROM conversations 
         WHERE id = $1`,
        [conversationId]
      );
      return result.rows.length > 0 ? {
        id: result.rows[0].id,
        conversationState: result.rows[0].conversationState || {},
        currentIntent: result.rows[0].currentIntent,
        stage: result.rows[0].stage || 'discover',
        sessionMetadata: result.rows[0].sessionMetadata || {}
      } : null;
    }

    // Add updated_at and last_message_at (if column exists)
    updates.push(`updated_at = CURRENT_TIMESTAMP`);
    
    // Add conversationId to values
    values.push(conversationId);

    const updateQuery = `
      UPDATE conversations 
      SET ${updates.join(', ')}
      WHERE id = $${paramIndex}
      RETURNING 
        id,
        conversation_state as "conversationState",
        current_intent as "currentIntent",
        stage,
        session_metadata as "sessionMetadata"
    `;

    const result = await pool.query(updateQuery, values);

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    return {
      id: row.id,
      conversationState: row.conversationState || {},
      currentIntent: row.currentIntent,
      stage: row.stage || 'discover',
      sessionMetadata: row.sessionMetadata || {}
    };
  } catch (error: any) {
    console.error('Error patching conversation state:', error);
    throw error;
  }
};

/**
 * Set conversation error
 * 
 * @param conversationId - Conversation ID
 * @param errorMessage - Error message to store
 * @returns Updated conversation or null if not found
 */
export const setConversationError = async (
  conversationId: string,
  errorMessage: string
): Promise<{
  id: string;
  lastError: string | null;
} | null> => {
  try {
    const result = await pool.query(
      `UPDATE conversations 
       SET last_error = $1, updated_at = CURRENT_TIMESTAMP
       WHERE id = $2
       RETURNING id, last_error as "lastError"`,
      [errorMessage, conversationId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    return {
      id: result.rows[0].id,
      lastError: result.rows[0].lastError
    };
  } catch (error: any) {
    console.error('Error setting conversation error:', error);
    throw error;
  }
};

