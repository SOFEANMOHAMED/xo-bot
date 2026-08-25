/**
 * Merchant inbox realtime fan-out (SaaS-safe).
 * PostgreSQL LISTEN/NOTIFY → in-process subscribers → SSE clients per merchant_id.
 */

import pg from 'pg';
import pool from '../../database/connection.js';
import { logger } from '../../utils/logger.js';

export type InboxRealtimeEvent = {
  type:
    | 'message'
    | 'conversation'
    | 'heartbeat'
    | 'connected'
    | 'typing'
    | 'read'
    | 'channel_cleared';
  merchantId: string;
  conversationId?: string;
  platform?: string | null;
  /** True when every thread of this platform was removed (full unlink). */
  purgedPlatform?: boolean;
  message?: {
    id: string;
    role: string;
    content: string;
    senderType: string;
    source?: string | null;
    createdAt: string;
    imageUrl?: string | null;
    metadata?: Record<string, unknown> | null;
  };
  conversation?: {
    id: string;
    platform?: string | null;
    userId?: string | null;
    userName?: string | null;
    botDisabled?: boolean;
    status?: string | null;
    lastMessageAt?: string | null;
    lastMessagePreview?: string | null;
    lastSenderType?: string | null;
  };
  typing?: {
    conversationId: string;
    isTyping: boolean;
    from: 'merchant' | 'customer';
  };
  read?: {
    conversationId: string;
    reader: 'merchant' | 'customer';
    readAt: string;
    watermark?: number | null;
  };
  at?: string;
};

type Subscriber = (event: InboxRealtimeEvent) => void;

const CHANNEL = 'merchant_inbox';
const subscribers = new Map<string, Set<Subscriber>>();

let listenClient: pg.Client | null = null;
let starting = false;
let notifyReady = false;

function decodeNotifyPayload(raw: string): InboxRealtimeEvent | null {
  try {
    const data = JSON.parse(raw);
    const merchantId = String(data.merchantId || '');
    if (!merchantId) return null;

    if (data.type === 'typing') {
      return {
        type: 'typing',
        merchantId,
        conversationId: data.conversationId ? String(data.conversationId) : undefined,
        platform: data.platform ?? null,
        typing: {
          conversationId: String(data.conversationId || ''),
          isTyping: data.isTyping === true || data.isTyping === 't',
          from: data.from === 'customer' ? 'customer' : 'merchant',
        },
        at: data.at || new Date().toISOString(),
      };
    }

    if (data.type === 'read') {
      return {
        type: 'read',
        merchantId,
        conversationId: data.conversationId ? String(data.conversationId) : undefined,
        platform: data.platform ?? null,
        read: {
          conversationId: String(data.conversationId || ''),
          reader: data.reader === 'merchant' ? 'merchant' : 'customer',
          readAt: data.readAt || new Date().toISOString(),
          watermark: data.watermark ?? null,
        },
        at: data.at || new Date().toISOString(),
      };
    }

    if (data.type === 'channel_cleared') {
      return {
        type: 'channel_cleared',
        merchantId,
        platform: data.platform ?? null,
        purgedPlatform: data.purgedPlatform === true,
        at: data.at || new Date().toISOString(),
      };
    }

    if (data.type === 'conversation') {
      return {
        type: 'conversation',
        merchantId,
        conversationId: data.conversationId ? String(data.conversationId) : undefined,
        platform: data.platform ?? null,
        conversation: {
          id: String(data.conversationId || data.id || ''),
          platform: data.platform ?? null,
          userId: data.userId ?? null,
          userName: data.userName ?? null,
          botDisabled: data.botDisabled === true || data.botDisabled === 't',
          status: data.status ?? null,
          lastMessageAt: data.lastMessageAt ?? null,
          lastMessagePreview: data.lastMessagePreview
            ? String(data.lastMessagePreview).slice(0, 180)
            : null,
          lastSenderType: data.lastSenderType ?? null,
        },
        at: data.at || new Date().toISOString(),
      };
    }

    // default: message
    return {
      type: 'message',
      merchantId,
      conversationId: data.conversationId ? String(data.conversationId) : undefined,
      platform: data.platform ?? null,
      message: data.messageId
        ? {
            id: String(data.messageId),
            role: String(data.role || 'assistant'),
            content: String(data.content || ''),
            senderType: String(
              data.senderType || (data.role === 'user' ? 'user' : 'bot')
            ),
            source: data.source ?? null,
            createdAt: data.createdAt || new Date().toISOString(),
            imageUrl:
              typeof data.imageUrl === 'string'
                ? data.imageUrl
                : data.metadata?.imageUrl || data.metadata?.image_url || null,
            metadata:
              data.metadata && typeof data.metadata === 'object' ? data.metadata : null,
          }
        : undefined,
      conversation: {
        id: String(data.conversationId || ''),
        platform: data.platform ?? null,
        userId: data.userId ?? null,
        userName: data.userName ?? null,
        botDisabled: data.botDisabled === true || data.botDisabled === 't',
        status: data.status ?? null,
        lastMessageAt: data.createdAt || data.lastMessageAt || new Date().toISOString(),
        lastMessagePreview: data.content ? String(data.content).slice(0, 180) : null,
        lastSenderType: String(
          data.senderType || (data.role === 'user' ? 'user' : 'bot')
        ),
      },
      at: data.createdAt || new Date().toISOString(),
    };
  } catch (error) {
    logger.warn('Invalid merchant_inbox notify payload', {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

function fanOut(event: InboxRealtimeEvent) {
  const set = subscribers.get(event.merchantId);
  if (!set || set.size === 0) return;
  for (const sub of set) {
    try {
      sub(event);
    } catch (error) {
      logger.warn('Inbox subscriber threw', {
        merchantId: event.merchantId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

/** Ensure DB triggers exist (idempotent). */
export async function ensureInboxRealtimeTriggers(): Promise<void> {
  await pool.query(`
    CREATE OR REPLACE FUNCTION notify_merchant_inbox_message()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    DECLARE
      mid UUID;
      plat TEXT;
      uname TEXT;
      uid TEXT;
      bdisabled BOOLEAN;
      cstatus TEXT;
    BEGIN
      SELECT merchant_id, platform, user_name, user_id,
             COALESCE(bot_disabled, false), COALESCE(status, 'bot')
        INTO mid, plat, uname, uid, bdisabled, cstatus
      FROM conversations
      WHERE id = NEW.conversation_id;

      IF mid IS NULL THEN
        RETURN NEW;
      END IF;

      PERFORM pg_notify(
        'merchant_inbox',
        json_build_object(
          'type', 'message',
          'merchantId', mid,
          'conversationId', NEW.conversation_id,
          'messageId', NEW.id,
          'role', NEW.role,
          'senderType', COALESCE(
            NEW.sender_type,
            CASE WHEN NEW.role = 'user' THEN 'user' ELSE 'bot' END
          ),
          'content', left(NEW.content, 500),
          'source', NEW.source,
          'createdAt', to_char(NEW.created_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
          'platform', plat,
          'userId', uid,
          'userName', uname,
          'botDisabled', bdisabled,
          'status', cstatus,
          'imageUrl', COALESCE(NEW.metadata->>'imageUrl', NEW.metadata->>'image_url'),
          'metadata', NEW.metadata
        )::text
      );
      RETURN NEW;
    END;
    $$;
  `);

  await pool.query(`
    DROP TRIGGER IF EXISTS trg_messages_merchant_inbox ON messages;
    CREATE TRIGGER trg_messages_merchant_inbox
    AFTER INSERT ON messages
    FOR EACH ROW
    EXECUTE PROCEDURE notify_merchant_inbox_message();
  `);

  await pool.query(`
    CREATE OR REPLACE FUNCTION notify_merchant_inbox_conversation()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      IF (OLD.bot_disabled IS DISTINCT FROM NEW.bot_disabled)
         OR (OLD.status IS DISTINCT FROM NEW.status)
         OR (OLD.last_message_at IS DISTINCT FROM NEW.last_message_at)
         OR (OLD.user_name IS DISTINCT FROM NEW.user_name) THEN
        PERFORM pg_notify(
          'merchant_inbox',
          json_build_object(
            'type', 'conversation',
            'merchantId', NEW.merchant_id,
            'conversationId', NEW.id,
            'platform', NEW.platform,
            'userId', NEW.user_id,
            'userName', NEW.user_name,
            'botDisabled', COALESCE(NEW.bot_disabled, false),
            'status', COALESCE(NEW.status, 'bot'),
            'lastMessageAt', NEW.last_message_at,
            'at', NOW()
          )::text
        );
      END IF;
      RETURN NEW;
    END;
    $$;
  `);

  await pool.query(`
    DROP TRIGGER IF EXISTS trg_conversations_merchant_inbox ON conversations;
    CREATE TRIGGER trg_conversations_merchant_inbox
    AFTER UPDATE ON conversations
    FOR EACH ROW
    EXECUTE PROCEDURE notify_merchant_inbox_conversation();
  `);

  notifyReady = true;
  logger.info('Inbox realtime DB triggers ready');
}

async function attachListener(): Promise<void> {
  if (listenClient || starting) return;
  starting = true;

  const client = new pg.Client({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    database: process.env.DB_NAME || 'xobot_db',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD,
  });

  try {
    await client.connect();
    await client.query(`LISTEN ${CHANNEL}`);
    client.on('notification', (msg) => {
      if (msg.channel !== CHANNEL || !msg.payload) return;
      const event = decodeNotifyPayload(msg.payload);
      if (event) fanOut(event);
    });
    client.on('error', (err) => {
      logger.error('Inbox LISTEN client error', err);
      listenClient = null;
      starting = false;
      setTimeout(() => {
        void startInboxRealtime().catch(() => undefined);
      }, 3000);
    });
    listenClient = client;
    logger.info('Inbox realtime LISTEN attached');
  } catch (error) {
    logger.error('Failed to attach inbox LISTEN', error as Error);
    try {
      await client.end();
    } catch {
      /* ignore */
    }
    listenClient = null;
    throw error;
  } finally {
    starting = false;
  }
}

export async function startInboxRealtime(): Promise<void> {
  if (!notifyReady) {
    await ensureInboxRealtimeTriggers();
  }
  await attachListener();
}

export async function stopInboxRealtime(): Promise<void> {
  if (listenClient) {
    try {
      await listenClient.query(`UNLISTEN ${CHANNEL}`);
      await listenClient.end();
    } catch {
      /* ignore */
    }
    listenClient = null;
  }
}

/**
 * Notify this merchant's open inbox that a channel's threads were removed.
 */
export async function notifyMerchantInboxChannelCleared(params: {
  merchantId: string;
  platform: string;
  purgedPlatform: boolean;
}): Promise<void> {
  const { merchantId, platform, purgedPlatform } = params;
  if (!merchantId || !platform) return;

  const event: InboxRealtimeEvent = {
    type: 'channel_cleared',
    merchantId,
    platform,
    purgedPlatform,
    at: new Date().toISOString(),
  };

  try {
    await pool.query('SELECT pg_notify($1, $2)', [
      CHANNEL,
      JSON.stringify({
        type: 'channel_cleared',
        merchantId,
        platform,
        purgedPlatform,
        at: event.at,
      }),
    ]);
  } catch (error) {
    logger.warn('Failed to notify inbox channel cleared', {
      merchantId,
      platform,
      error: error instanceof Error ? error.message : String(error),
    });
    fanOut(event);
  }
}

/** Subscribe to inbox events for one merchant only. Returns unsubscribe. */
export function subscribeMerchantInbox(
  merchantId: string,
  subscriber: Subscriber
): () => void {
  if (!merchantId) return () => undefined;
  let set = subscribers.get(merchantId);
  if (!set) {
    set = new Set();
    subscribers.set(merchantId, set);
  }
  set.add(subscriber);
  return () => {
    const current = subscribers.get(merchantId);
    if (!current) return;
    current.delete(subscriber);
    if (current.size === 0) subscribers.delete(merchantId);
  };
}

/** Local publish (same process) — optional fast path; NOTIFY still covers all writers. */
export function publishMerchantInboxEvent(event: InboxRealtimeEvent): void {
  if (!event?.merchantId) return;
  fanOut(event);
}
