/**
 * Platform (official XO Bot page) social posts sync + listing.
 * Completely isolated from merchant social_posts.
 */

import pool from '../database/connection.js';
import { logger } from '../utils/logger.js';
import {
  ensurePlatformFacebookTables,
  getLinkedPlatformFacebookPage,
} from './platformFacebookPage.js';

const GRAPH_VERSION = process.env.FACEBOOK_GRAPH_VERSION || 'v21.0';

let commentTablesEnsured = false;

export async function ensurePlatformCommentTables(): Promise<void> {
  if (commentTablesEnsured) return;
  await ensurePlatformFacebookTables();

  await pool.query(`
    CREATE TABLE IF NOT EXISTS platform_social_posts (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      page_id VARCHAR(255) NOT NULL,
      platform VARCHAR(32) NOT NULL DEFAULT 'facebook'
        CHECK (platform IN ('facebook', 'instagram')),
      account_ref VARCHAR(255) NOT NULL,
      external_post_id VARCHAR(255) NOT NULL,
      caption TEXT,
      permalink TEXT,
      media_type VARCHAR(64),
      thumbnail_url TEXT,
      posted_at TIMESTAMP,
      synced_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      comment_reply_enabled BOOLEAN NOT NULL DEFAULT false,
      public_reply_text TEXT,
      send_dm_on_comment BOOLEAN NOT NULL DEFAULT false,
      private_reply_text TEXT,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (platform, external_post_id)
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_platform_social_posts_page
      ON platform_social_posts(page_id, platform)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_platform_social_posts_account
      ON platform_social_posts(platform, account_ref)
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS platform_keyword_rules (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      page_id VARCHAR(255) NOT NULL,
      platform VARCHAR(32) NOT NULL DEFAULT 'facebook'
        CHECK (platform IN ('facebook', 'instagram')),
      account_ref VARCHAR(255) NOT NULL,
      scope VARCHAR(16) NOT NULL DEFAULT 'post' CHECK (scope IN ('post')),
      social_post_id UUID REFERENCES platform_social_posts(id) ON DELETE CASCADE,
      external_post_id VARCHAR(255),
      keywords TEXT[] NOT NULL DEFAULT '{}',
      match_type VARCHAR(32) NOT NULL DEFAULT 'contains'
        CHECK (match_type IN ('contains', 'exact', 'starts_with')),
      priority INTEGER NOT NULL DEFAULT 100,
      public_reply_enabled BOOLEAN NOT NULL DEFAULT true,
      public_reply_text TEXT,
      private_reply_enabled BOOLEAN NOT NULL DEFAULT false,
      private_reply_text TEXT,
      is_active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_platform_keyword_rules_lookup
      ON platform_keyword_rules(page_id, platform, account_ref, is_active, priority DESC)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_platform_keyword_rules_post
      ON platform_keyword_rules(social_post_id)
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS platform_comment_actions (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      page_id VARCHAR(255) NOT NULL,
      platform VARCHAR(32) NOT NULL,
      account_ref VARCHAR(255) NOT NULL,
      external_comment_id VARCHAR(255) NOT NULL,
      external_post_id VARCHAR(255),
      matched_rule_id UUID REFERENCES platform_keyword_rules(id) ON DELETE SET NULL,
      matched_keyword TEXT,
      public_replied BOOLEAN DEFAULT false,
      private_replied BOOLEAN DEFAULT false,
      conversation_id UUID REFERENCES platform_conversations(id) ON DELETE SET NULL,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (page_id, platform, external_comment_id)
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_platform_comment_actions_page
      ON platform_comment_actions(page_id)
  `);

  commentTablesEnsured = true;
}

async function upsertPlatformPost(params: {
  pageId: string;
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
    `INSERT INTO platform_social_posts (
       page_id, platform, account_ref, external_post_id, caption, permalink,
       media_type, thumbnail_url, posted_at, synced_at, metadata, updated_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW(),$10::jsonb,NOW())
     ON CONFLICT (platform, external_post_id) DO UPDATE SET
       page_id = EXCLUDED.page_id,
       account_ref = EXCLUDED.account_ref,
       caption = EXCLUDED.caption,
       permalink = EXCLUDED.permalink,
       media_type = EXCLUDED.media_type,
       thumbnail_url = EXCLUDED.thumbnail_url,
       posted_at = COALESCE(EXCLUDED.posted_at, platform_social_posts.posted_at),
       synced_at = NOW(),
       metadata = EXCLUDED.metadata,
       updated_at = NOW()`,
    [
      params.pageId,
      params.platform,
      params.accountRef,
      params.externalPostId,
      params.caption ?? null,
      params.permalink ?? null,
      params.mediaType ?? null,
      params.thumbnailUrl ?? null,
      params.postedAt ? new Date(params.postedAt) : null,
      JSON.stringify(params.metadata || {}),
    ]
  );
}

async function fetchGraphPages(url: string): Promise<{ data: any[]; next?: string }> {
  const res = await fetch(url);
  const json = (await res.json()) as {
    data?: any[];
    paging?: { next?: string };
    error?: unknown;
  };
  if (json.error) {
    throw new Error(JSON.stringify(json.error));
  }
  return { data: json.data || [], next: json.paging?.next };
}

export async function syncOfficialFacebookPagePosts(limit = 40): Promise<{
  synced: number;
  pageId: string;
  pageName: string | null;
}> {
  await ensurePlatformCommentTables();
  const page = await getLinkedPlatformFacebookPage();
  if (!page) {
    throw new Error('لا توجد صفحة XO Bot مربوطة');
  }

  let synced = 0;
  let url =
    `https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(page.page_id)}/feed` +
    `?fields=id,message,created_time,permalink_url,full_picture,attachments{media_type,media}` +
    `&limit=${Math.min(limit, 50)}&access_token=${encodeURIComponent(page.access_token)}`;

  while (url && synced < limit) {
    const batch = await fetchGraphPages(url);
    for (const item of batch.data) {
      if (!item?.id) continue;
      const mediaType =
        item.attachments?.data?.[0]?.media_type || (item.full_picture ? 'photo' : 'status');
      await upsertPlatformPost({
        pageId: page.page_id,
        platform: 'facebook',
        accountRef: page.page_id,
        externalPostId: String(item.id),
        caption: item.message || null,
        permalink: item.permalink_url || null,
        mediaType,
        thumbnailUrl: item.full_picture || null,
        postedAt: item.created_time || null,
        metadata: { raw_id: item.id },
      });
      synced += 1;
      if (synced >= limit) break;
    }
    url = synced < limit && batch.next ? batch.next : '';
  }

  logger.info('Official page Facebook posts synced', {
    pageId: page.page_id,
    synced,
  });

  return { synced, pageId: page.page_id, pageName: page.page_name };
}

export async function listOfficialPageSocialPosts(opts: {
  limit?: number;
  offset?: number;
} = {}) {
  await ensurePlatformCommentTables();
  const page = await getLinkedPlatformFacebookPage();
  if (!page) return [];

  const limit = Math.min(opts.limit ?? 50, 100);
  const offset = opts.offset ?? 0;

  const result = await pool.query(
    `SELECT id, page_id, platform, account_ref, external_post_id, caption, permalink,
            media_type, thumbnail_url, posted_at, synced_at,
            comment_reply_enabled, public_reply_text, send_dm_on_comment, private_reply_text,
            created_at, updated_at
     FROM platform_social_posts
     WHERE page_id = $1 AND platform = 'facebook'
     ORDER BY posted_at DESC NULLS LAST, synced_at DESC
     LIMIT $2 OFFSET $3`,
    [page.page_id, limit, offset]
  );
  return result.rows;
}
