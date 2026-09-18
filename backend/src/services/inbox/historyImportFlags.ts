/**
 * Markers and SQL predicates for channel history imported at link-time.
 *
 * Those threads are display-only (inbox context). They were not handled by
 * XO Bot, so they must never count toward merchant usage, quotas, or cost.
 */

export const WHATSAPP_WEB_HISTORY_ORIGIN = 'whatsapp_web_history';
export const META_HISTORY_IMPORT_SOURCE = 'meta_conversations_api';

const DEFAULT_LINK_GRACE_MS = 60_000;
const FALLBACK_STALE_MS = 10 * 60 * 1000;

export function buildImportedHistoryMetadata(
  extra: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    imported: true,
    historyOnly: true,
    ...extra,
  };
}

/**
 * True when a message row was copied from Facebook / Instagram / WhatsApp
 * history rather than produced by a live XO Bot turn.
 */
export function isImportedHistoryMessageSql(alias = 'm'): string {
  const meta = `${alias}.metadata`;
  return `(
    COALESCE((${meta}->>'imported')::text, '') IN ('true', 't', '1')
    OR COALESCE(${meta}->>'origin', '') = '${WHATSAPP_WEB_HISTORY_ORIGIN}'
    OR COALESCE(${meta}->>'importSource', '') IN (
      '${META_HISTORY_IMPORT_SOURCE}',
      '${WHATSAPP_WEB_HISTORY_ORIGIN}'
    )
  )`;
}

/** Assistant rows that represent an actual XO Bot reply (billable / quota). */
export function isBillableBotResponseSql(alias = 'm'): string {
  return `(
    ${alias}.role = 'assistant'
    AND COALESCE(${alias}.sender_type, 'bot') = 'bot'
    AND NOT ${isImportedHistoryMessageSql(alias)}
  )`;
}

export function isLiveCustomerMessageSql(alias = 'm'): string {
  return `(
    ${alias}.role = 'user'
    AND NOT ${isImportedHistoryMessageSql(alias)}
  )`;
}

/** Conversation has at least one live (non-imported) message. */
export function conversationHasLiveMessagesSql(
  conversationAlias: string,
  messageAlias = 'live_msg'
): string {
  return `EXISTS (
    SELECT 1
    FROM messages ${messageAlias}
    WHERE ${messageAlias}.conversation_id = ${conversationAlias}.id
      AND NOT ${isImportedHistoryMessageSql(messageAlias)}
  )`;
}

export function parseChannelEventTime(timestamp: unknown): Date | null {
  const n = typeof timestamp === 'number' ? timestamp : Number(timestamp);
  if (!Number.isFinite(n) || n <= 0) return null;
  return new Date(n > 1e12 ? n : n * 1000);
}

/**
 * Messages whose original timestamp is before the merchant linked the channel
 * must not drive the bot (no LLM cost). A small grace covers pairing latency.
 */
export function isBeforeChannelLink(
  eventTime: Date | null,
  linkedAt: Date | string | null | undefined,
  graceMs = DEFAULT_LINK_GRACE_MS
): boolean {
  if (!eventTime) return false;
  const linkedMs =
    linkedAt instanceof Date
      ? linkedAt.getTime()
      : linkedAt
        ? new Date(linkedAt).getTime()
        : NaN;
  if (!Number.isFinite(linkedMs)) return false;
  return eventTime.getTime() < linkedMs - graceMs;
}

export function historyCutoffFromLinkedAt(
  linkedAt: Date | string | null | undefined,
  graceMs = DEFAULT_LINK_GRACE_MS
): Date {
  const linkedMs =
    linkedAt instanceof Date
      ? linkedAt.getTime()
      : linkedAt
        ? new Date(linkedAt).getTime()
        : NaN;
  if (!Number.isFinite(linkedMs)) {
    return new Date(Date.now() - FALLBACK_STALE_MS);
  }
  return new Date(linkedMs - graceMs);
}
