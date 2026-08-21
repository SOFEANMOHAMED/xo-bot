/**
 * Resolve customer display names from Meta (Facebook / Instagram) Graph API.
 * Tenant-scoped: always uses the merchant's own page/account tokens.
 */

import pool from '../database/connection.js';
import { logger } from '../utils/logger.js';

const PLACEHOLDER_NAMES = new Set([
  '',
  'عميل',
  'عميل غير معروف',
  'عميل إنستغرام',
  'عميل فيسبوك',
  'زائر',
  'زائر فيسبوك',
  'facebook user',
  'instagram user',
  'عميل واتساب',
  'whatsapp user',
  'عميل تجريبي',
  'unknown',
  'user',
  'visitor',
]);

export function isPlaceholderCustomerName(name: string | null | undefined): boolean {
  if (!name) return true;
  const normalized = name.trim().toLowerCase();
  if (!normalized) return true;
  if (PLACEHOLDER_NAMES.has(normalized)) return true;
  // Arabic visitor / customer placeholders: «زائر · …» / «عميل فيسبوك»
  if (normalized.startsWith('زائر') || normalized.startsWith('عميل')) return true;
  // IGSID / PSID mistaken as name
  if (/^\d{10,}$/.test(normalized)) return true;
  return false;
}

async function getFacebookPageCredentials(
  merchantId: string,
  preferredPageId?: string | null
): Promise<{ pageId: string; accessToken: string } | null> {
  if (preferredPageId) {
    const preferred = await pool.query(
      `SELECT page_id, access_token
       FROM facebook_pages
       WHERE merchant_id = $1
         AND page_id = $2
         AND access_token IS NOT NULL
         AND BTRIM(access_token) <> ''
       LIMIT 1`,
      [merchantId, preferredPageId]
    );
    if (preferred.rows[0]?.access_token) {
      return {
        pageId: preferred.rows[0].page_id,
        accessToken: preferred.rows[0].access_token,
      };
    }
  }

  const result = await pool.query(
    `SELECT page_id, access_token
     FROM facebook_pages
     WHERE merchant_id = $1
       AND access_token IS NOT NULL
       AND BTRIM(access_token) <> ''
     ORDER BY updated_at DESC NULLS LAST
     LIMIT 1`,
    [merchantId]
  );
  const row = result.rows[0];
  if (!row?.page_id || !row?.access_token) return null;
  return { pageId: row.page_id, accessToken: row.access_token };
}

async function getInstagramCredentials(
  merchantId: string
): Promise<{ accessToken: string; pageId?: string } | null> {
  const ig = await pool.query(
    `SELECT access_token, page_id
     FROM instagram_accounts
     WHERE merchant_id = $1
       AND access_token IS NOT NULL
       AND BTRIM(access_token) <> ''
     ORDER BY updated_at DESC NULLS LAST
     LIMIT 1`,
    [merchantId]
  );
  if (ig.rows[0]?.access_token) {
    return { accessToken: ig.rows[0].access_token, pageId: ig.rows[0].page_id || undefined };
  }

  // Fallback: page token linked to an IG account
  const page = await pool.query(
    `SELECT fp.page_id, fp.access_token
     FROM facebook_pages fp
     INNER JOIN instagram_accounts ia ON ia.page_id = fp.page_id AND ia.merchant_id = fp.merchant_id
     WHERE fp.merchant_id = $1
       AND fp.access_token IS NOT NULL
     ORDER BY fp.updated_at DESC NULLS LAST
     LIMIT 1`,
    [merchantId]
  );
  if (page.rows[0]?.access_token) {
    return { accessToken: page.rows[0].access_token, pageId: page.rows[0].page_id };
  }
  return null;
}

async function fetchFacebookUserName(
  userId: string,
  accessToken: string,
  pageId?: string | null
): Promise<string | null> {
  // 1) User Profile API (works for many PSIDs)
  const profileUrl =
    `https://graph.facebook.com/v21.0/${encodeURIComponent(userId)}` +
    `?fields=name,first_name,last_name&access_token=${encodeURIComponent(accessToken)}`;
  try {
    const resp = await fetch(profileUrl);
    const data = (await resp.json()) as {
      name?: string;
      first_name?: string;
      last_name?: string;
      error?: { message?: string; code?: number; error_subcode?: number };
    };
    if (resp.ok && !data.error) {
      const full =
        (data.name || '').trim() ||
        `${data.first_name || ''} ${data.last_name || ''}`.trim();
      if (full) return full;
    } else {
      logger.warn('Facebook profile name fetch failed', {
        userId,
        error: data.error?.message || `HTTP ${resp.status}`,
        code: data.error?.code,
        subcode: data.error?.error_subcode,
      });
    }
  } catch (error) {
    logger.warn('Facebook profile name fetch threw', {
      userId,
      error: (error as Error).message,
    });
  }

  // 2) Fallback: Page Conversations API (often works when Profile API returns #100/33)
  if (!pageId) return null;
  try {
    const convUrl =
      `https://graph.facebook.com/v21.0/${encodeURIComponent(pageId)}/conversations` +
      `?platform=MESSENGER&user_id=${encodeURIComponent(userId)}` +
      `&fields=participants&limit=1` +
      `&access_token=${encodeURIComponent(accessToken)}`;
    const resp = await fetch(convUrl);
    const data = (await resp.json()) as {
      data?: Array<{
        participants?: { data?: Array<{ id?: string; name?: string }> };
      }>;
      error?: { message?: string };
    };
    if (!resp.ok || data.error) {
      logger.warn('Facebook conversations name fallback failed', {
        userId,
        pageId,
        error: data.error?.message || `HTTP ${resp.status}`,
      });
      return null;
    }
    const participants = data.data?.[0]?.participants?.data || [];
    const match = participants.find(
      (p) => String(p.id) === String(userId) && (p.name || '').trim()
    );
    const name = (match?.name || '').trim();
    if (name) {
      logger.info('Resolved Facebook customer name via conversations API', {
        userId,
        pageId,
        name,
      });
      return name;
    }
  } catch (error) {
    logger.warn('Facebook conversations name fallback threw', {
      userId,
      pageId,
      error: (error as Error).message,
    });
  }

  return null;
}

async function fetchInstagramUserName(
  userId: string,
  accessToken: string
): Promise<string | null> {
  const url =
    `https://graph.facebook.com/v21.0/${encodeURIComponent(userId)}` +
    `?fields=name,username&access_token=${encodeURIComponent(accessToken)}`;
  const resp = await fetch(url);
  const data = (await resp.json()) as {
    name?: string;
    username?: string;
    error?: { message?: string };
  };
  if (!resp.ok || data.error) {
    logger.warn('Instagram profile name fetch failed', {
      userId,
      error: data.error?.message || `HTTP ${resp.status}`,
    });
    return null;
  }
  const name = (data.name || '').trim();
  const username = (data.username || '').trim();
  if (name && username) return `${name} (@${username})`;
  if (name) return name;
  if (username) return `@${username}`;
  return null;
}

/**
 * Resolve a real customer display name for Meta platforms.
 * Returns null if unavailable.
 */
export async function resolveSocialCustomerName(params: {
  merchantId: string;
  platform: string;
  userId: string;
  preferredPageId?: string | null;
}): Promise<string | null> {
  const { merchantId, platform, userId, preferredPageId } = params;
  if (!merchantId || !userId) return null;

  try {
    if (platform === 'facebook_messenger' || platform === 'facebook') {
      const creds = await getFacebookPageCredentials(merchantId, preferredPageId);
      if (!creds) return null;
      return await fetchFacebookUserName(userId, creds.accessToken, creds.pageId);
    }

    if (platform === 'instagram') {
      const creds = await getInstagramCredentials(merchantId);
      if (!creds) return null;
      return await fetchInstagramUserName(userId, creds.accessToken);
    }
  } catch (error) {
    logger.error('resolveSocialCustomerName failed', error as Error, {
      merchantId,
      platform,
      userId,
    });
  }
  return null;
}

/**
 * Prefer an existing real name; otherwise fetch from Meta and persist on the conversation.
 */
export async function ensureConversationCustomerName(params: {
  merchantId: string;
  conversationId?: string | null;
  platform: string;
  userId: string;
  currentName?: string | null;
  preferredPageId?: string | null;
}): Promise<string> {
  const current = (params.currentName || '').trim();
  if (!isPlaceholderCustomerName(current)) {
    return current;
  }

  const resolved = await resolveSocialCustomerName({
    merchantId: params.merchantId,
    platform: params.platform,
    userId: params.userId,
    preferredPageId: params.preferredPageId,
  });

  if (!resolved) {
    return current || 'عميل غير معروف';
  }

  if (params.conversationId) {
    try {
      await pool.query(
        `UPDATE conversations
         SET user_name = $1, updated_at = CURRENT_TIMESTAMP
         WHERE id = $2 AND merchant_id = $3`,
        [resolved, params.conversationId, params.merchantId]
      );
    } catch (error) {
      logger.warn('Failed to persist resolved customer name', {
        conversationId: params.conversationId,
        error: (error as Error).message,
      });
    }
  }

  return resolved;
}

/**
 * Resolve Facebook Messenger display name using the official platform page token
 * (not merchant facebook_pages — SaaS isolation).
 */
export async function resolvePlatformFacebookCustomerName(params: {
  userId: string;
  pageId: string;
  accessToken: string;
}): Promise<string | null> {
  const { userId, pageId, accessToken } = params;
  if (!userId || !accessToken) return null;
  try {
    return await fetchFacebookUserName(userId, accessToken, pageId || null);
  } catch (error) {
    logger.error('resolvePlatformFacebookCustomerName failed', error as Error, {
      userId,
      pageId,
    });
    return null;
  }
}

/**
 * Prefer an existing real name; otherwise fetch from Meta and persist on platform_conversations.
 */
export async function ensurePlatformConversationCustomerName(params: {
  conversationId: string;
  pageId: string;
  userId: string;
  accessToken: string;
  currentName?: string | null;
}): Promise<string> {
  const current = (params.currentName || '').trim();
  if (!isPlaceholderCustomerName(current)) {
    return current;
  }

  const resolved = await resolvePlatformFacebookCustomerName({
    userId: params.userId,
    pageId: params.pageId,
    accessToken: params.accessToken,
  });

  if (!resolved) {
    return current || '';
  }

  try {
    await pool.query(
      `UPDATE platform_conversations
       SET user_name = $1, updated_at = CURRENT_TIMESTAMP
       WHERE id = $2 AND page_id = $3`,
      [resolved, params.conversationId, params.pageId]
    );
  } catch (error) {
    logger.warn('Failed to persist platform customer name', {
      conversationId: params.conversationId,
      error: (error as Error).message,
    });
  }

  return resolved;
}

/** Persist Meta page/account id on the conversation for later profile lookups / outbound sends. */
export async function bindConversationChannelAccount(params: {
  merchantId: string;
  conversationId: string;
  platform: string;
  accountId: string;
}): Promise<void> {
  const { merchantId, conversationId, platform, accountId } = params;
  if (!merchantId || !conversationId || !accountId) return;

  try {
    await pool.query(
      `UPDATE conversations
       SET conversation_state = COALESCE(conversation_state, '{}'::jsonb)
             || jsonb_build_object(
                  'channel_binding',
                  jsonb_build_object(
                    'account_id', $3::text,
                    'page_id', $3::text,
                    'platform', $4::text
                  )
                ),
           session_metadata = COALESCE(session_metadata, '{}'::jsonb)
             || jsonb_build_object('pageId', $3::text, 'channel_account_id', $3::text),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND merchant_id = $2`,
      [conversationId, merchantId, accountId, platform]
    );
  } catch (error) {
    logger.warn('Failed to bind conversation channel account', {
      conversationId,
      error: (error as Error).message,
    });
  }
}
