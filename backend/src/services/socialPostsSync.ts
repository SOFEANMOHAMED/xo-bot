/**
 * Sync Facebook Page feed / Instagram media into social_posts (merchant-scoped).
 */

import pool from '../database/connection.js';
import { logger } from '../utils/logger.js';

const GRAPH_VERSION = process.env.FACEBOOK_GRAPH_VERSION || 'v21.0';

type SyncResult = { synced: number; platform: string; accountRef: string };

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
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await pool.query(
    `INSERT INTO social_posts (
       merchant_id, platform, account_ref, external_post_id, caption, permalink,
       media_type, thumbnail_url, posted_at, synced_at, metadata, updated_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW(),$10::jsonb,NOW())
     ON CONFLICT (merchant_id, platform, external_post_id) DO UPDATE SET
       caption = EXCLUDED.caption,
       permalink = EXCLUDED.permalink,
       media_type = EXCLUDED.media_type,
       thumbnail_url = EXCLUDED.thumbnail_url,
       posted_at = COALESCE(EXCLUDED.posted_at, social_posts.posted_at),
       synced_at = NOW(),
       metadata = EXCLUDED.metadata,
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
      JSON.stringify(params.metadata || {})
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

export async function syncMerchantSocialPosts(
  merchantId: string,
  platform?: 'facebook' | 'instagram'
): Promise<SyncResult[]> {
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

export async function listMerchantSocialPosts(
  merchantId: string,
  opts: {
    platform?: 'facebook' | 'instagram';
    accountRef?: string;
    limit?: number;
    offset?: number;
  } = {}
) {
  const limit = Math.min(opts.limit ?? 50, 100);
  const offset = opts.offset ?? 0;
  const params: any[] = [merchantId];
  let where = 'WHERE sp.merchant_id = $1';
  if (opts.platform) {
    params.push(opts.platform);
    where += ` AND sp.platform = $${params.length}`;
  }
  if (opts.accountRef) {
    params.push(opts.accountRef);
    where += ` AND sp.account_ref = $${params.length}`;
  }
  params.push(limit, offset);

  const result = await pool.query(
    `SELECT sp.*,
            scl.product_id AS linked_product_id,
            scl.id AS content_link_id,
            p.name AS linked_product_name,
            p.price AS linked_product_price,
            p.image_url AS linked_product_image
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
