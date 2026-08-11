/**
 * Automatic Meta Conversations history import (Messenger + Instagram).
 *
 * Triggered after a page/account is linked — no merchant action required.
 * Uses Graph Conversations API; message body details are limited to the
 * ~20 most recent messages per thread (Meta platform limit).
 *
 * SaaS-safe: every query is scoped by merchantId; never cross-tenant.
 */

import pool from '../database/connection.js';
import { logger } from '../utils/logger.js';
import { bindConversationChannelAccount } from './socialProfile.js';

const GRAPH_VERSION = process.env.FACEBOOK_GRAPH_VERSION || 'v21.0';

/** Soft caps to stay within Meta rate limits and keep link latency reasonable. */
const MAX_CONVERSATIONS = 40;
const MAX_MESSAGE_DETAILS = 20;
const CONVERSATION_PAGE_SIZE = 25;

export type MetaHistoryPlatform = 'messenger' | 'instagram';

export type MetaHistorySyncResult = {
  platform: MetaHistoryPlatform;
  conversationsSeen: number;
  conversationsUpserted: number;
  messagesImported: number;
  messagesSkipped: number;
  errors: number;
};

type GraphParticipant = {
  id?: string;
  name?: string;
  username?: string;
  email?: string;
};

type GraphConversation = {
  id: string;
  updated_time?: string;
  participants?: { data?: GraphParticipant[] };
  messages?: { data?: Array<{ id: string; created_time?: string }> };
};

type GraphMessage = {
  id: string;
  created_time?: string;
  message?: string;
  from?: GraphParticipant;
  to?: { data?: GraphParticipant[] };
  sticker?: string;
  attachments?: {
    data?: Array<{
      id?: string;
      mime_type?: string;
      name?: string;
      file_url?: string;
      image_data?: { url?: string; width?: number; height?: number };
      video_data?: { url?: string };
    }>;
  };
  error?: { message?: string; code?: number; error_subcode?: number };
};

type SyncJobKey = string;

const inflight = new Map<SyncJobKey, Promise<MetaHistorySyncResult>>();

function jobKey(
  merchantId: string,
  platform: MetaHistoryPlatform,
  accountId: string
): SyncJobKey {
  return `${merchantId}:${platform}:${accountId}`;
}

async function graphGet<T>(url: string): Promise<T> {
  const resp = await fetch(url);
  const data = (await resp.json()) as T & { error?: { message?: string; code?: number } };
  if (!resp.ok || (data as { error?: unknown }).error) {
    throw new Error(JSON.stringify((data as { error?: unknown }).error || { status: resp.status }));
  }
  return data;
}

async function fetchConversationList(params: {
  pageId: string;
  accessToken: string;
  platform: MetaHistoryPlatform;
  limit: number;
}): Promise<GraphConversation[]> {
  const out: GraphConversation[] = [];
  let url: string | null =
    `https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(params.pageId)}/conversations` +
    `?platform=${params.platform}` +
    `&fields=${encodeURIComponent('id,updated_time,participants')}` +
    `&limit=${Math.min(CONVERSATION_PAGE_SIZE, params.limit)}` +
    `&access_token=${encodeURIComponent(params.accessToken)}`;

  while (url && out.length < params.limit) {
    const pageData: {
      data?: GraphConversation[];
      paging?: { next?: string };
    } = await graphGet<{
      data?: GraphConversation[];
      paging?: { next?: string };
    }>(url);

    for (const row of pageData.data || []) {
      if (row?.id) out.push(row);
      if (out.length >= params.limit) break;
    }
    url = out.length < params.limit ? pageData.paging?.next || null : null;
  }

  return out;
}

async function fetchConversationMessages(
  conversationId: string,
  accessToken: string
): Promise<Array<{ id: string; created_time?: string }>> {
  const data = await graphGet<{
    messages?: { data?: Array<{ id: string; created_time?: string }> };
  }>(
    `https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(conversationId)}` +
      `?fields=${encodeURIComponent(`messages.limit(${MAX_MESSAGE_DETAILS}){id,created_time}`)}` +
      `&access_token=${encodeURIComponent(accessToken)}`
  );
  return Array.isArray(data.messages?.data) ? data.messages!.data! : [];
}

async function fetchMessageDetails(
  messageId: string,
  accessToken: string
): Promise<GraphMessage | null> {
  try {
    return await graphGet<GraphMessage>(
      `https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(messageId)}` +
        `?fields=${encodeURIComponent('id,created_time,from,to,message,sticker,attachments')}` +
        `&access_token=${encodeURIComponent(accessToken)}`
    );
  } catch (error) {
    // Meta returns an error for messages older than the last ~20 detailable ones.
    logger.debug('Meta history: message detail unavailable', {
      messageId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

function resolveCustomerParticipant(
  participants: GraphParticipant[] | undefined,
  businessIds: Set<string>
): GraphParticipant | null {
  if (!participants?.length) return null;
  const customers = participants.filter((p) => p.id && !businessIds.has(String(p.id)));
  return customers[0] || null;
}

function buildMessageContent(msg: GraphMessage): { content: string; imageUrl: string | null } {
  const attachments = msg.attachments?.data || [];
  let imageUrl: string | null = null;

  for (const att of attachments) {
    const candidate =
      att.image_data?.url ||
      att.video_data?.url ||
      att.file_url ||
      null;
    if (candidate && !imageUrl) imageUrl = candidate;
  }

  const text = typeof msg.message === 'string' ? msg.message.trim() : '';
  if (text) return { content: text, imageUrl };

  if (msg.sticker) return { content: '[ملصق]', imageUrl: msg.sticker };
  if (imageUrl) {
    const isVideo = attachments.some((a) => !!a.video_data?.url);
    return { content: isVideo ? '[فيديو]' : '[صورة]', imageUrl };
  }
  if (attachments.length > 0) return { content: '[مرفق]', imageUrl: null };
  return { content: '[رسالة]', imageUrl: null };
}

function isFromBusiness(msg: GraphMessage, businessIds: Set<string>): boolean {
  const fromId = msg.from?.id ? String(msg.from.id) : '';
  return !!fromId && businessIds.has(fromId);
}

async function getOrCreateImportedConversation(params: {
  merchantId: string;
  platform: 'facebook_messenger' | 'instagram';
  userId: string;
  userName: string | null;
}): Promise<{ id: string; userName: string | null }> {
  const existing = await pool.query(
    `SELECT id, user_name
     FROM conversations
     WHERE merchant_id = $1 AND platform = $2 AND user_id = $3
     ORDER BY last_message_at DESC NULLS LAST
     LIMIT 1`,
    [params.merchantId, params.platform, params.userId]
  );

  if (existing.rows[0]) {
    return {
      id: existing.rows[0].id as string,
      userName: (existing.rows[0].user_name as string | null) || null,
    };
  }

  try {
    const inserted = await pool.query(
      `INSERT INTO conversations (
         merchant_id, platform, user_id, user_name, conversation_state, stage, status
       ) VALUES ($1, $2, $3, $4, '{}'::jsonb, 'discover', 'bot')
       RETURNING id, user_name`,
      [params.merchantId, params.platform, params.userId, params.userName]
    );
    return {
      id: inserted.rows[0].id as string,
      userName: (inserted.rows[0].user_name as string | null) || null,
    };
  } catch (error: any) {
    // Concurrent link/sync race: unique (merchant_id, platform, user_id)
    if (error?.code === '23505') {
      const again = await pool.query(
        `SELECT id, user_name
         FROM conversations
         WHERE merchant_id = $1 AND platform = $2 AND user_id = $3
         LIMIT 1`,
        [params.merchantId, params.platform, params.userId]
      );
      if (again.rows[0]) {
        return {
          id: again.rows[0].id as string,
          userName: (again.rows[0].user_name as string | null) || null,
        };
      }
    }
    throw error;
  }
}

async function upsertImportedMessage(params: {
  conversationId: string;
  externalMessageId: string;
  role: 'user' | 'assistant';
  senderType: 'user' | 'human';
  source: string;
  content: string;
  createdAt: Date;
  metadata: Record<string, unknown>;
}): Promise<boolean> {
  const existing = await pool.query(
    `SELECT 1
     FROM messages
     WHERE conversation_id = $1::uuid
       AND external_message_id = $2::text
     LIMIT 1`,
    [params.conversationId, params.externalMessageId]
  );
  if ((existing.rowCount || 0) > 0) return false;

  try {
    const result = await pool.query(
      `INSERT INTO messages (
         conversation_id, role, content, sender_type, external_message_id, source, metadata, created_at
       ) VALUES (
         $1::uuid, $2::text, $3::text, $4::text, $5::text, $6::text, $7::jsonb, $8::timestamptz
       )
       RETURNING id`,
      [
        params.conversationId,
        params.role,
        params.content,
        params.senderType,
        params.externalMessageId,
        params.source,
        JSON.stringify(params.metadata),
        params.createdAt.toISOString(),
      ]
    );
    return (result.rowCount || 0) > 0;
  } catch (error: any) {
    if (error?.code === '23505') return false;
    throw error;
  }
}

async function touchConversationTimestamps(params: {
  conversationId: string;
  merchantId: string;
  userName: string | null;
  lastMessageAt: Date | null;
}): Promise<void> {
  await pool.query(
    `UPDATE conversations
     SET user_name = COALESCE(NULLIF($3::text, ''), user_name),
         last_message_at = CASE
           WHEN $4::timestamptz IS NULL THEN last_message_at
           WHEN last_message_at IS NULL OR last_message_at < $4::timestamptz THEN $4::timestamptz
           ELSE last_message_at
         END,
         session_metadata = COALESCE(session_metadata, '{}'::jsonb)
           || jsonb_build_object(
                'history_import',
                jsonb_build_object(
                  'at', to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
                  'source', 'meta_conversations_api'
                )
              ),
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $1::uuid AND merchant_id = $2::uuid`,
    [
      params.conversationId,
      params.merchantId,
      params.userName,
      params.lastMessageAt ? params.lastMessageAt.toISOString() : null,
    ]
  );
}

async function syncAccountHistory(params: {
  merchantId: string;
  pageId: string;
  accessToken: string;
  platform: MetaHistoryPlatform;
  /** Page ID and/or IG business account ID — treated as "business" senders. */
  businessActorIds: string[];
  storedPlatform: 'facebook_messenger' | 'instagram';
  /** Channel account id stored on the conversation (page id or IG user id). */
  channelAccountId: string;
}): Promise<MetaHistorySyncResult> {
  const result: MetaHistorySyncResult = {
    platform: params.platform,
    conversationsSeen: 0,
    conversationsUpserted: 0,
    messagesImported: 0,
    messagesSkipped: 0,
    errors: 0,
  };

  const businessIds = new Set(params.businessActorIds.map(String).filter(Boolean));
  const inboundSource =
    params.storedPlatform === 'instagram' ? 'instagram' : 'facebook_messenger';
  const outboundSource =
    params.storedPlatform === 'instagram' ? 'instagram' : 'facebook_inbox';

  let conversations: GraphConversation[] = [];
  try {
    conversations = await fetchConversationList({
      pageId: params.pageId,
      accessToken: params.accessToken,
      platform: params.platform,
      limit: MAX_CONVERSATIONS,
    });
  } catch (error) {
    logger.error('Meta history: failed to list conversations', error as Error, {
      merchantId: params.merchantId,
      pageId: params.pageId,
      platform: params.platform,
    });
    result.errors += 1;
    return result;
  }

  result.conversationsSeen = conversations.length;

  for (const thread of conversations) {
    try {
      const participants = thread.participants?.data || [];
      const customer = resolveCustomerParticipant(participants, businessIds);
      if (!customer?.id) {
        result.messagesSkipped += 1;
        continue;
      }

      const customerId = String(customer.id);
      const customerName =
        (customer.name || customer.username || '').trim() || null;

      const conversation = await getOrCreateImportedConversation({
        merchantId: params.merchantId,
        platform: params.storedPlatform,
        userId: customerId,
        userName: customerName,
      });

      result.conversationsUpserted += 1;

      await bindConversationChannelAccount({
        merchantId: params.merchantId,
        conversationId: conversation.id,
        platform: params.storedPlatform,
        accountId: params.channelAccountId,
      });

      if (customerName && customerName !== conversation.userName) {
        await pool.query(
          `UPDATE conversations
           SET user_name = $3, updated_at = CURRENT_TIMESTAMP
           WHERE id = $1 AND merchant_id = $2 AND (user_name IS NULL OR user_name = '')`,
          [conversation.id, params.merchantId, customerName]
        );
      }

      const messageRefs = await fetchConversationMessages(thread.id, params.accessToken);
      // API returns newest-first; keep that order for detail fetch, then store by created_time.
      const limited = messageRefs.slice(0, MAX_MESSAGE_DETAILS);

      let newestAt: Date | null = null;

      for (const ref of limited) {
        if (!ref?.id) continue;
        const detail = await fetchMessageDetails(ref.id, params.accessToken);
        if (!detail?.id) {
          result.messagesSkipped += 1;
          continue;
        }

        const fromBusiness = isFromBusiness(detail, businessIds);
        const { content, imageUrl } = buildMessageContent(detail);
        const createdAt = detail.created_time
          ? new Date(detail.created_time)
          : ref.created_time
            ? new Date(ref.created_time)
            : new Date();

        if (!newestAt || createdAt > newestAt) newestAt = createdAt;

        const imported = await upsertImportedMessage({
          conversationId: conversation.id,
          externalMessageId: String(detail.id),
          role: fromBusiness ? 'assistant' : 'user',
          senderType: fromBusiness ? 'human' : 'user',
          source: fromBusiness ? outboundSource : inboundSource,
          content,
          createdAt,
          metadata: {
            platform: params.storedPlatform,
            imported: true,
            importSource: 'meta_conversations_api',
            metaConversationId: thread.id,
            ...(imageUrl ? { imageUrl } : {}),
            ...(detail.from?.id ? { fromId: detail.from.id } : {}),
          },
        });

        if (imported) result.messagesImported += 1;
        else result.messagesSkipped += 1;
      }

      await touchConversationTimestamps({
        conversationId: conversation.id,
        merchantId: params.merchantId,
        userName: customerName,
        lastMessageAt: newestAt,
      });
    } catch (error) {
      result.errors += 1;
      logger.warn('Meta history: failed to sync one conversation', {
        merchantId: params.merchantId,
        threadId: thread.id,
        platform: params.platform,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return result;
}

/**
 * Run sync once per merchant+account; concurrent callers share the same promise.
 */
function runExclusive(
  key: SyncJobKey,
  work: () => Promise<MetaHistorySyncResult>
): Promise<MetaHistorySyncResult> {
  const existing = inflight.get(key);
  if (existing) return existing;

  const pending = work().finally(() => {
    inflight.delete(key);
  });
  inflight.set(key, pending);
  return pending;
}

export async function syncFacebookPageConversationHistory(params: {
  merchantId: string;
  pageId: string;
  accessToken: string;
}): Promise<MetaHistorySyncResult> {
  const { merchantId, pageId, accessToken } = params;
  return runExclusive(jobKey(merchantId, 'messenger', pageId), async () => {
    logger.info('Meta history sync started (Messenger)', { merchantId, pageId });
    const result = await syncAccountHistory({
      merchantId,
      pageId,
      accessToken,
      platform: 'messenger',
      businessActorIds: [pageId],
      storedPlatform: 'facebook_messenger',
      channelAccountId: pageId,
    });
    logger.info('Meta history sync finished (Messenger)', {
      merchantId,
      pageId,
      ...result,
    });
    return result;
  });
}

export async function syncInstagramAccountConversationHistory(params: {
  merchantId: string;
  pageId: string;
  igUserId: string;
  accessToken: string;
}): Promise<MetaHistorySyncResult> {
  const { merchantId, pageId, igUserId, accessToken } = params;
  return runExclusive(jobKey(merchantId, 'instagram', igUserId), async () => {
    logger.info('Meta history sync started (Instagram)', {
      merchantId,
      pageId,
      igUserId,
    });
    const result = await syncAccountHistory({
      merchantId,
      pageId,
      accessToken,
      platform: 'instagram',
      businessActorIds: [pageId, igUserId],
      storedPlatform: 'instagram',
      channelAccountId: igUserId,
    });
    logger.info('Meta history sync finished (Instagram)', {
      merchantId,
      pageId,
      igUserId,
      ...result,
    });
    return result;
  });
}

/** Fire-and-forget wrapper — never blocks the OAuth / link response. */
export function scheduleFacebookPageHistorySync(params: {
  merchantId: string;
  pageId: string;
  accessToken: string;
}): void {
  setImmediate(() => {
    void syncFacebookPageConversationHistory(params).catch((error) => {
      logger.error('Meta history sync failed (Messenger)', error as Error, {
        merchantId: params.merchantId,
        pageId: params.pageId,
      });
    });
  });
}

export function scheduleInstagramAccountHistorySync(params: {
  merchantId: string;
  pageId: string;
  igUserId: string;
  accessToken: string;
}): void {
  setImmediate(() => {
    void syncInstagramAccountConversationHistory(params).catch((error) => {
      logger.error('Meta history sync failed (Instagram)', error as Error, {
        merchantId: params.merchantId,
        pageId: params.pageId,
        igUserId: params.igUserId,
      });
    });
  });
}
