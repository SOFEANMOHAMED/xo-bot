/**
 * Official XO Bot page inbox realtime (platform-scoped, isolated from merchants).
 * PostgreSQL LISTEN/NOTIFY → in-process subscribers → admin SSE clients.
 */

import pg from 'pg';
import pool from '../../database/connection.js';
import { logger } from '../../utils/logger.js';
import { ensurePlatformFacebookTables } from '../platformFacebookPage.js';

export const PLATFORM_INBOX_SCOPE = 'platform';

export type PlatformInboxRealtimeEvent = {
  type: 'message' | 'conversation' | 'heartbeat' | 'connected';
  scope: typeof PLATFORM_INBOX_SCOPE;
  conversationId?: string;
  platform?: string | null;
  message?: {
    id: string;
    role: string;
    content: string;
    senderType: string;
    createdAt: string;
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
    unreadCount?: number;
  };
  at?: string;
};

type Subscriber = (event: PlatformInboxRealtimeEvent) => void;

const CHANNEL = 'platform_inbox';
const subscribers = new Set<Subscriber>();

let listenClient: pg.Client | null = null;
let starting = false;
let notifyReady = false;

function roleToSenderType(role: string): string {
  if (role === 'user') return 'user';
  if (role === 'human') return 'human';
  return 'bot';
}

function decodeNotifyPayload(raw: string): PlatformInboxRealtimeEvent | null {
  try {
    const data = JSON.parse(raw);
    if (data.type === 'conversation') {
      return {
        type: 'conversation',
        scope: PLATFORM_INBOX_SCOPE,
        conversationId: data.conversationId ? String(data.conversationId) : undefined,
        platform: 'facebook_messenger',
        conversation: {
          id: String(data.conversationId || data.id || ''),
          platform: 'facebook_messenger',
          userId: data.userId ?? null,
          userName: data.userName ?? null,
          botDisabled: data.botDisabled === true || data.botDisabled === 't',
          status: data.status ?? null,
          lastMessageAt: data.lastMessageAt ?? null,
          lastMessagePreview: data.lastMessagePreview
            ? String(data.lastMessagePreview).slice(0, 180)
            : null,
          lastSenderType: data.lastSenderType ?? null,
          unreadCount:
            typeof data.unreadCount === 'number'
              ? data.unreadCount
              : data.unreadCount != null
                ? Number(data.unreadCount) || 0
                : undefined,
        },
        at: data.at || new Date().toISOString(),
      };
    }

    const role = String(data.role || 'model');
    return {
      type: 'message',
      scope: PLATFORM_INBOX_SCOPE,
      conversationId: data.conversationId ? String(data.conversationId) : undefined,
      platform: 'facebook_messenger',
      message: data.messageId
        ? {
            id: String(data.messageId),
            role,
            content: String(data.content || ''),
            senderType: String(data.senderType || roleToSenderType(role)),
            createdAt: data.createdAt || new Date().toISOString(),
          }
        : undefined,
      conversation: {
        id: String(data.conversationId || ''),
        platform: 'facebook_messenger',
        userId: data.userId ?? null,
        userName: data.userName ?? null,
        botDisabled: data.botDisabled === true || data.botDisabled === 't',
        status: data.status ?? null,
        lastMessageAt: data.createdAt || data.lastMessageAt || new Date().toISOString(),
        lastMessagePreview: data.content ? String(data.content).slice(0, 180) : null,
        lastSenderType: String(data.senderType || roleToSenderType(role)),
      },
      at: data.createdAt || new Date().toISOString(),
    };
  } catch (error) {
    logger.warn('Invalid platform_inbox notify payload', {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

function fanOut(event: PlatformInboxRealtimeEvent) {
  if (subscribers.size === 0) return;
  for (const sub of subscribers) {
    try {
      sub(event);
    } catch (error) {
      logger.warn('Platform inbox subscriber threw', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

export async function ensurePlatformInboxRealtimeTriggers(): Promise<void> {
  await ensurePlatformFacebookTables();

  await pool.query(`
    ALTER TABLE platform_conversations
      ADD COLUMN IF NOT EXISTS admin_last_read_at TIMESTAMP
  `);

  await pool.query(`
    CREATE OR REPLACE FUNCTION notify_platform_inbox_message()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    DECLARE
      uid TEXT;
      uname TEXT;
      bdisabled BOOLEAN;
      cstatus TEXT;
    BEGIN
      SELECT user_id, user_name,
             COALESCE(bot_disabled, false), COALESCE(status, 'bot')
        INTO uid, uname, bdisabled, cstatus
      FROM platform_conversations
      WHERE id = NEW.conversation_id;

      PERFORM pg_notify(
        'platform_inbox',
        json_build_object(
          'type', 'message',
          'conversationId', NEW.conversation_id,
          'messageId', NEW.id,
          'role', NEW.role,
          'senderType', CASE
            WHEN NEW.role = 'user' THEN 'user'
            WHEN NEW.role = 'human' THEN 'human'
            ELSE 'bot'
          END,
          'content', left(NEW.content, 500),
          'createdAt', to_char(NEW.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
          'userId', uid,
          'userName', uname,
          'botDisabled', bdisabled,
          'status', cstatus
        )::text
      );
      RETURN NEW;
    END;
    $$;
  `);

  await pool.query(`
    DROP TRIGGER IF EXISTS trg_platform_messages_inbox ON platform_messages;
    CREATE TRIGGER trg_platform_messages_inbox
    AFTER INSERT ON platform_messages
    FOR EACH ROW
    EXECUTE PROCEDURE notify_platform_inbox_message();
  `);

  await pool.query(`
    CREATE OR REPLACE FUNCTION notify_platform_inbox_conversation()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      IF (OLD.bot_disabled IS DISTINCT FROM NEW.bot_disabled)
         OR (OLD.status IS DISTINCT FROM NEW.status)
         OR (OLD.last_message_at IS DISTINCT FROM NEW.last_message_at)
         OR (OLD.user_name IS DISTINCT FROM NEW.user_name)
         OR (OLD.admin_last_read_at IS DISTINCT FROM NEW.admin_last_read_at) THEN
        PERFORM pg_notify(
          'platform_inbox',
          json_build_object(
            'type', 'conversation',
            'conversationId', NEW.id,
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
    DROP TRIGGER IF EXISTS trg_platform_conversations_inbox ON platform_conversations;
    CREATE TRIGGER trg_platform_conversations_inbox
    AFTER UPDATE ON platform_conversations
    FOR EACH ROW
    EXECUTE PROCEDURE notify_platform_inbox_conversation();
  `);

  notifyReady = true;
  logger.info('Platform inbox realtime DB triggers ready');
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
      logger.error('Platform inbox LISTEN client error', err);
      listenClient = null;
      starting = false;
      setTimeout(() => {
        void startPlatformInboxRealtime().catch(() => undefined);
      }, 3000);
    });
    listenClient = client;
    logger.info('Platform inbox realtime LISTEN attached');
  } catch (error) {
    logger.error('Failed to attach platform inbox LISTEN', error as Error);
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

export async function startPlatformInboxRealtime(): Promise<void> {
  if (!notifyReady) {
    await ensurePlatformInboxRealtimeTriggers();
  }
  await attachListener();
}

export async function stopPlatformInboxRealtime(): Promise<void> {
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

export function subscribePlatformInbox(subscriber: Subscriber): () => void {
  subscribers.add(subscriber);
  return () => {
    subscribers.delete(subscriber);
  };
}

export function publishPlatformInboxEvent(event: PlatformInboxRealtimeEvent): void {
  fanOut(event);
}
