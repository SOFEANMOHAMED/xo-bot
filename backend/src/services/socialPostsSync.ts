/**
 * Sync Facebook Page feed / Instagram media / active stories into social_posts (merchant-scoped).
 */

import pool from '../database/connection.js';
import { logger } from '../utils/logger.js';
import {
  resolveFacebookStoryImageUrl,
  resolveInstagramStoryMedia,
} from './socialStoryMedia.js';

const GRAPH_VERSION = process.env.FACEBOOK_GRAPH_VERSION || 'v21.0';
const STORY_TTL_MS = 24 * 60 * 60 * 1000;
const GRAPH_STORY_MAX_PAGES = 8;

export type SocialContentKind = 'post' | 'story';

type SyncResult = {
  synced: number;
  pruned?: number;
  platform: string;
  accountRef: string;
};

let storySchemaEnsured = false;

export async function ensureSocialStorySchema(): Promise<void> {
  if (storySchemaEnsured) return;

  await pool.query(`
    ALTER TABLE social_posts
      ADD COLUMN IF NOT EXISTS content_kind VARCHAR(16) NOT NULL DEFAULT 'post'
  `);
  await pool.query(`
    ALTER TABLE social_posts
      ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP
  `);
  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'social_posts'::regclass
          AND conname = 'social_posts_content_kind_check'
      ) THEN
        ALTER TABLE social_posts
          ADD CONSTRAINT social_posts_content_kind_check
          CHECK (content_kind IN ('post', 'story'));
      END IF;
    END $$;
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_social_posts_content_kind
      ON social_posts(merchant_id, platform, content_kind)
  `);
  await pool.query(`
    DO $$
    DECLARE
      r record;
    BEGIN
      FOR r IN
        SELECT conname
        FROM pg_constraint
        WHERE conrelid = 'social_content_links'::regclass
          AND contype = 'c'
          AND pg_get_constraintdef(oid) ILIKE '%content_type%'
      LOOP
        EXECUTE format('ALTER TABLE social_content_links DROP CONSTRAINT %I', r.conname);
      END LOOP;
    END $$;
  `);
  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'social_content_links'::regclass
          AND conname = 'social_content_links_content_type_check'
      ) THEN
        ALTER TABLE social_content_links
          ADD CONSTRAINT social_content_links_content_type_check
          CHECK (content_type IN ('post', 'ad', 'ctm_ref', 'ice_breaker', 'story'));
      END IF;
    END $$;
  `);

  storySchemaEnsured = true;
}

function parseMetaTimestamp(value: unknown): string | null {
  if (value == null || value === '') return null;
  if (typeof value === 'number' || /^\d+(\.\d+)?$/.test(String(value).trim())) {
    const n = Number(value);
    const ms = n < 1e12 ? n * 1000 : n;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function storyExpiresAt(postedAt?: string | Date | null): Date {
  const base = postedAt ? new Date(postedAt) : new Date();
  const t = Number.isNaN(base.getTime()) ? Date.now() : base.getTime();
  return new Date(t + STORY_TTL_MS);
}

async function upsertPost(params: {
  merchantId: string;
  platform: 'facebook' | 'instagram';
  accountRef: string;
  externalPostId: string;
  caption?: string | null;
  permalink?: string | null;
  mediaType?: string | null;
  thumbnailUrl?: string | null;
  postedAt?: string | null;
  contentKind?: SocialContentKind;
  expiresAt?: Date | null;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await ensureSocialStorySchema();
  const contentKind = params.contentKind || 'post';
  await pool.query(
    `INSERT INTO social_posts (
       merchant_id, platform, account_ref, external_post_id, caption, permalink,
       media_type, thumbnail_url, posted_at, synced_at, metadata, updated_at,
       content_kind, expires_at, is_active_for_rules, comment_reply_enabled
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW(),$10::jsonb,NOW(),$11,$12,false,false)
     ON CONFLICT (merchant_id, platform, external_post_id) DO UPDATE SET
       caption = EXCLUDED.caption,
       permalink = EXCLUDED.permalink,
       media_type = EXCLUDED.media_type,
       thumbnail_url = EXCLUDED.thumbnail_url,
       posted_at = COALESCE(EXCLUDED.posted_at, social_posts.posted_at),
       synced_at = NOW(),
       metadata = EXCLUDED.metadata,
       content_kind = EXCLUDED.content_kind,
       expires_at = COALESCE(EXCLUDED.expires_at, social_posts.expires_at),
       updated_at = NOW()`,
    [
      params.merchantId,
      params.platform,
      params.accountRef,
      params.externalPostId,
      params.caption ?? null,
      params.permalink ?? null,
      params.mediaType ?? null,
      params.thumbnailUrl ?? null,
      params.postedAt ? new Date(params.postedAt) : null,
      JSON.stringify(params.metadata || {}),
      contentKind,
      params.expiresAt ?? null
    ]
  );
}

async function fetchGraphPages(
  url: string
): Promise<{ data: any[]; next?: string }> {
  const res = await fetch(url);
  const json = (await res.json()) as { data?: any[]; paging?: { next?: string }; error?: any };
  if (json.error) {
    throw new Error(JSON.stringify(json.error));
  }
  return { data: json.data || [], next: json.paging?.next };
}

async function fetchAllGraphItems(startUrl: string): Promise<any[]> {
  const items: any[] = [];
  let url: string | undefined = startUrl;
  let pages = 0;
  while (url && pages < GRAPH_STORY_MAX_PAGES) {
    const page = await fetchGraphPages(url);
    if (Array.isArray(page.data) && page.data.length > 0) {
      items.push(...page.data);
    }
    url = page.next;
    pages += 1;
  }
  return items;
}

function uniqueStoryIds(values: Array<unknown>): string[] {
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const value of values) {
    const id = String(value ?? '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

function isPublishedFacebookStory(item: any): boolean {
  const status = String(item?.status || 'PUBLISHED').toUpperCase();
  return status === 'PUBLISHED';
}

function facebookLiveStoryIds(items: any[]): string[] {
  const raw: unknown[] = [];
  for (const item of items) {
    if (!isPublishedFacebookStory(item)) continue;
    if (item?.media_id) raw.push(item.media_id);
    if (item?.post_id) raw.push(item.post_id);
  }
  return uniqueStoryIds(raw);
}

/**
 * Drop merchant-scoped story rows that are no longer on the page tray.
 * Only call after a successful Graph stories fetch. Empty liveIds means the
 * tray is empty — delete this account's stories, never other merchants/posts.
 */
async function pruneStoriesAbsentFromPage(
  merchantId: string,
  platform: 'facebook' | 'instagram',
  accountRef: string,
  liveIds: string[]
): Promise<number> {
  const result = await pool.query(
    `DELETE FROM social_posts
     WHERE merchant_id = $1
       AND platform = $2
       AND account_ref = $3
       AND COALESCE(content_kind, 'post') = 'story'
       AND NOT (
         cardinality($4::text[]) > 0
         AND (
           external_post_id = ANY($4::text[])
           OR COALESCE(metadata->>'media_id', '') = ANY($4::text[])
           OR COALESCE(metadata->>'post_id', '') = ANY($4::text[])
         )
       )`,
    [merchantId, platform, accountRef, liveIds]
  );
  const pruned = result.rowCount ?? 0;
  if (pruned > 0) {
    logger.info('Removed stories deleted from the page', {
      merchantId,
      platform,
      accountRef,
      pruned,
      liveCount: liveIds.length
    });
  }
  return pruned;
}

async function loadInstagramStoryItems(
  igUserId: string,
  accessToken: string
): Promise<any[]> {
  const url =
    `https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(igUserId)}/stories` +
    `?fields=id&access_token=${encodeURIComponent(accessToken)}`;
  return fetchAllGraphItems(url);
}

async function loadFacebookPageStoryItems(
  pageId: string,
  accessToken: string
): Promise<any[]> {
  const url =
    `https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(pageId)}/stories` +
    `?fields=post_id,status,creation_time,media_type,media_id,url` +
    `&access_token=${encodeURIComponent(accessToken)}`;
  return fetchAllGraphItems(url);
}

export async function syncFacebookPagePosts(
  merchantId: string,
  pageId: string,
  accessToken: string,
  limit = 40
): Promise<SyncResult> {
  let synced = 0;
  let url =
    `https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(pageId)}/feed` +
    `?fields=id,message,created_time,permalink_url,full_picture,attachments{media_type,media}` +
    `&limit=${Math.min(limit, 50)}&access_token=${encodeURIComponent(accessToken)}`;

  while (url && synced < limit) {
    const page = await fetchGraphPages(url);
    for (const item of page.data) {
      if (!item?.id) continue;
      const mediaType =
        item.attachments?.data?.[0]?.media_type ||
        (item.full_picture ? 'photo' : 'status');
      await upsertPost({
        merchantId,
        platform: 'facebook',
        accountRef: pageId,
        externalPostId: String(item.id),
        caption: item.message || null,
        permalink: item.permalink_url || null,
        mediaType,
        thumbnailUrl: item.full_picture || null,
        postedAt: item.created_time || null,
        contentKind: 'post',
        metadata: { raw_id: item.id }
      });
      synced += 1;
      if (synced >= limit) break;
    }
    url = synced < limit && page.next ? page.next : '';
  }

  logger.info('Facebook posts synced', { merchantId, pageId, synced });
  return { synced, platform: 'facebook', accountRef: pageId };
}

export async function syncInstagramMedia(
  merchantId: string,
  igUserId: string,
  accessToken: string,
  limit = 40
): Promise<SyncResult> {
  let synced = 0;
  let url =
    `https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(igUserId)}/media` +
    `?fields=id,caption,media_type,media_url,thumbnail_url,permalink,timestamp` +
    `&limit=${Math.min(limit, 50)}&access_token=${encodeURIComponent(accessToken)}`;

  while (url && synced < limit) {
    const page = await fetchGraphPages(url);
    for (const item of page.data) {
      if (!item?.id) continue;
      await upsertPost({
        merchantId,
        platform: 'instagram',
        accountRef: igUserId,
        externalPostId: String(item.id),
        caption: item.caption || null,
        permalink: item.permalink || null,
        mediaType: item.media_type || null,
        thumbnailUrl: item.thumbnail_url || item.media_url || null,
        postedAt: item.timestamp || null,
        contentKind: 'post',
        metadata: { raw_id: item.id }
      });
      synced += 1;
      if (synced >= limit) break;
    }
    url = synced < limit && page.next ? page.next : '';
  }

  logger.info('Instagram media synced', { merchantId, igUserId, synced });
  return { synced, platform: 'instagram', accountRef: igUserId };
}

export async function syncInstagramStories(
  merchantId: string,
  igUserId: string,
  accessToken: string
): Promise<SyncResult> {
  let synced = 0;
  let pruned = 0;

  try {
    const items = await loadInstagramStoryItems(igUserId, accessToken);
    const liveIds = uniqueStoryIds(items.map((item) => item?.id));
    pruned = await pruneStoriesAbsentFromPage(
      merchantId,
      'instagram',
      igUserId,
      liveIds
    );

    for (const item of items) {
      if (!item?.id) continue;
      const mediaId = String(item.id);
      let details: Awaited<ReturnType<typeof resolveInstagramStoryMedia>>;
      try {
        details = await resolveInstagramStoryMedia(mediaId, accessToken);
      } catch (error) {
        logger.warn('Instagram story media lookup failed', {
          merchantId,
          igUserId,
          mediaId,
          error: error instanceof Error ? error.message : String(error)
        });
        continue;
      }
      const postedAt = details.postedAt || null;
      await upsertPost({
        merchantId,
        platform: 'instagram',
        accountRef: igUserId,
        externalPostId: mediaId,
        caption: details.caption,
        permalink: details.permalink,
        mediaType: details.mediaType || 'STORY',
        thumbnailUrl: details.thumbnailUrl,
        postedAt,
        contentKind: 'story',
        expiresAt: storyExpiresAt(postedAt),
        metadata: {
          kind: 'story',
          media_id: mediaId,
          raw_id: mediaId
        }
      });
      synced += 1;
    }
  } catch (e) {
    logger.warn('Instagram stories sync failed', {
      merchantId,
      igUserId,
      error: e instanceof Error ? e.message : String(e)
    });
    throw e;
  }

  logger.info('Instagram stories synced', { merchantId, igUserId, synced, pruned });
  return { synced, pruned, platform: 'instagram', accountRef: igUserId };
}

export async function syncFacebookPageStories(
  merchantId: string,
  pageId: string,
  accessToken: string
): Promise<SyncResult> {
  let synced = 0;
  let pruned = 0;

  try {
    const items = await loadFacebookPageStoryItems(pageId, accessToken);
    const liveIds = facebookLiveStoryIds(items);
    pruned = await pruneStoriesAbsentFromPage(
      merchantId,
      'facebook',
      pageId,
      liveIds
    );

    for (const item of items) {
      if (!isPublishedFacebookStory(item)) continue;
      const mediaId = item.media_id ? String(item.media_id) : '';
      const postId = item.post_id ? String(item.post_id) : '';
      const externalPostId = mediaId || postId;
      if (!externalPostId) continue;
      const postedAt = parseMetaTimestamp(item.creation_time);
      let thumbnailUrl: string | null = null;
      if (mediaId) {
        try {
          thumbnailUrl = await resolveFacebookStoryImageUrl(mediaId, accessToken);
        } catch (error) {
          logger.warn('Facebook story image lookup failed', {
            merchantId,
            pageId,
            mediaId,
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }
      await upsertPost({
        merchantId,
        platform: 'facebook',
        accountRef: pageId,
        externalPostId,
        caption: null,
        permalink: item.url || null,
        mediaType: item.media_type || 'STORY',
        thumbnailUrl,
        postedAt,
        contentKind: 'story',
        expiresAt: storyExpiresAt(postedAt),
        metadata: {
          kind: 'story',
          media_id: mediaId || null,
          post_id: postId || null,
          status: String(item.status || 'PUBLISHED').toUpperCase()
        }
      });
      synced += 1;
    }
  } catch (e) {
    logger.warn('Facebook stories sync failed', {
      merchantId,
      pageId,
      error: e instanceof Error ? e.message : String(e)
    });
    throw e;
  }

  logger.info('Facebook stories synced', { merchantId, pageId, synced, pruned });
  return { synced, pruned, platform: 'facebook', accountRef: pageId };
}

export async function syncMerchantSocialPosts(
  merchantId: string,
  platform?: 'facebook' | 'instagram'
): Promise<SyncResult[]> {
  await ensureSocialStorySchema();
  const results: SyncResult[] = [];

  if (!platform || platform === 'facebook') {
    const pages = await pool.query(
      `SELECT page_id, access_token FROM facebook_pages WHERE merchant_id = $1`,
      [merchantId]
    );
    for (const row of pages.rows) {
      try {
        results.push(
          await syncFacebookPagePosts(merchantId, row.page_id, row.access_token)
        );
      } catch (e) {
        logger.error('Facebook posts sync failed', e as Error, {
          merchantId,
          pageId: row.page_id
        });
      }
    }
  }

  if (!platform || platform === 'instagram') {
    const accounts = await pool.query(
      `SELECT ig_user_id, access_token FROM instagram_accounts WHERE merchant_id = $1`,
      [merchantId]
    );
    for (const row of accounts.rows) {
      try {
        results.push(
          await syncInstagramMedia(merchantId, row.ig_user_id, row.access_token)
        );
      } catch (e) {
        logger.error('Instagram media sync failed', e as Error, {
          merchantId,
          igUserId: row.ig_user_id
        });
      }
    }
  }

  return results;
}

export async function syncMerchantSocialStories(
  merchantId: string,
  platform?: 'facebook' | 'instagram'
): Promise<SyncResult[]> {
  await ensureSocialStorySchema();
  const results: SyncResult[] = [];

  if (!platform || platform === 'facebook') {
    const pages = await pool.query(
      `SELECT page_id, access_token FROM facebook_pages WHERE merchant_id = $1`,
      [merchantId]
    );
    for (const row of pages.rows) {
      try {
        results.push(
          await syncFacebookPageStories(merchantId, row.page_id, row.access_token)
        );
      } catch (e) {
        logger.error('Facebook stories sync failed', e as Error, {
          merchantId,
          pageId: row.page_id
        });
      }
    }
  }

  if (!platform || platform === 'instagram') {
    const accounts = await pool.query(
      `SELECT ig_user_id, access_token FROM instagram_accounts WHERE merchant_id = $1`,
      [merchantId]
    );
    for (const row of accounts.rows) {
      try {
        results.push(
          await syncInstagramStories(merchantId, row.ig_user_id, row.access_token)
        );
      } catch (e) {
        logger.error('Instagram stories sync failed', e as Error, {
          merchantId,
          igUserId: row.ig_user_id
        });
      }
    }
  }

  return results;
}

/**
 * Align stored stories with the live page/IG tray (IDs only).
 * Used on story list so deleted tray items disappear without a full media sync.
 * Never prunes if Graph fails for that account.
 */
export async function reconcileMerchantSocialStoryPresence(
  merchantId: string,
  platform?: 'facebook' | 'instagram'
): Promise<{ pruned: number }> {
  await ensureSocialStorySchema();
  let pruned = 0;

  if (!platform || platform === 'facebook') {
    const pages = await pool.query(
      `SELECT page_id, access_token FROM facebook_pages WHERE merchant_id = $1`,
      [merchantId]
    );
    for (const row of pages.rows) {
      try {
        const items = await loadFacebookPageStoryItems(row.page_id, row.access_token);
        pruned += await pruneStoriesAbsentFromPage(
          merchantId,
          'facebook',
          row.page_id,
          facebookLiveStoryIds(items)
        );
      } catch (e) {
        logger.warn('Facebook story presence reconcile skipped', {
          merchantId,
          pageId: row.page_id,
          error: e instanceof Error ? e.message : String(e)
        });
      }
    }
  }

  if (!platform || platform === 'instagram') {
    const accounts = await pool.query(
      `SELECT ig_user_id, access_token FROM instagram_accounts WHERE merchant_id = $1`,
      [merchantId]
    );
    for (const row of accounts.rows) {
      try {
        const items = await loadInstagramStoryItems(row.ig_user_id, row.access_token);
        pruned += await pruneStoriesAbsentFromPage(
          merchantId,
          'instagram',
          row.ig_user_id,
          uniqueStoryIds(items.map((item) => item?.id))
        );
      } catch (e) {
        logger.warn('Instagram story presence reconcile skipped', {
          merchantId,
          igUserId: row.ig_user_id,
          error: e instanceof Error ? e.message : String(e)
        });
      }
    }
  }

  return { pruned };
}

export async function listMerchantSocialPosts(
  merchantId: string,
  opts: {
    platform?: 'facebook' | 'instagram';
    accountRef?: string;
    contentKind?: SocialContentKind;
    limit?: number;
    offset?: number;
  } = {}
) {
  await ensureSocialStorySchema();
  const limit = Math.min(opts.limit ?? 50, 100);
  const offset = opts.offset ?? 0;
  const contentKind: SocialContentKind = opts.contentKind || 'post';
  const params: any[] = [merchantId];
  let where = 'WHERE sp.merchant_id = $1';
  params.push(contentKind);
  where += ` AND COALESCE(sp.content_kind, 'post') = $${params.length}`;
  if (opts.platform) {
    params.push(opts.platform);
    where += ` AND sp.platform = $${params.length}`;
  }
  if (opts.accountRef) {
    params.push(opts.accountRef);
    where += ` AND sp.account_ref = $${params.length}`;
  }
  if (contentKind === 'story') {
    where += ` AND (
      (sp.expires_at IS NOT NULL AND sp.expires_at > NOW())
      OR (
        sp.expires_at IS NULL
        AND sp.posted_at IS NOT NULL
        AND sp.posted_at > NOW() - INTERVAL '24 hours'
      )
    )`;
  }
  params.push(limit, offset);

  const result = await pool.query(
    `SELECT sp.*,
            scl.product_id AS linked_product_id,
            scl.id AS content_link_id,
            p.name AS linked_product_name,
            p.price AS linked_product_price,
            p.image_url AS linked_product_image,
            CASE
              WHEN sp.expires_at IS NOT NULL THEN sp.expires_at > NOW()
              WHEN sp.posted_at IS NOT NULL THEN sp.posted_at > NOW() - INTERVAL '24 hours'
              ELSE true
            END AS is_live
     FROM social_posts sp
     LEFT JOIN social_content_links scl
       ON scl.social_post_id = sp.id AND scl.merchant_id = sp.merchant_id AND scl.is_active = true
     LEFT JOIN products p
       ON p.id = scl.product_id AND p.merchant_id = sp.merchant_id
     ${where}
     ORDER BY sp.posted_at DESC NULLS LAST, sp.synced_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  return result.rows;
}

/**
 * Remove synced posts and related automation data for a merchant social account.
 * SaaS-safe: always scoped by merchant_id (+ optional account_ref).
 * Deleting social_posts cascades post-scoped content links and keyword rules.
 */
export async function clearMerchantSocialPosts(
  merchantId: string,
  platform: 'facebook' | 'instagram',
  accountRef?: string
): Promise<{ postsDeleted: number }> {
  const params: string[] = [merchantId, platform];
  let accountFilter = '';
  if (accountRef) {
    params.push(accountRef);
    accountFilter = ` AND account_ref = $${params.length}`;
  }

  const postsResult = await pool.query(
    `DELETE FROM social_posts
     WHERE merchant_id = $1 AND platform = $2${accountFilter}`,
    params
  );

  // Account-scoped keyword rules (no social_post_id) do not cascade from posts
  await pool.query(
    `DELETE FROM social_keyword_rules
     WHERE merchant_id = $1 AND platform = $2${accountFilter}`,
    params
  );

  await pool.query(
    `DELETE FROM social_comment_actions
     WHERE merchant_id = $1 AND platform = $2${accountFilter}`,
    params
  );

  const postsDeleted = postsResult.rowCount ?? 0;
  logger.info('Cleared merchant social posts on disconnect', {
    merchantId,
    platform,
    accountRef: accountRef ?? null,
    postsDeleted,
  });

  return { postsDeleted };
}
