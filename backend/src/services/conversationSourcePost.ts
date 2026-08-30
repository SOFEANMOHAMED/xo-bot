/**
 * Resolve the social post / ad that originated an inbox conversation.
 * Always merchant-scoped — never loads another tenant's posts.
 */

import pool from '../database/connection.js';
import { logger } from '../utils/logger.js';
import type { AcquisitionContext } from './socialAcquisition.js';

export type ConversationSourcePost = {
  source: string;
  sourceLabel: string;
  platform: string | null;
  externalPostId: string | null;
  caption: string | null;
  thumbnailUrl: string | null;
  permalink: string | null;
  productId: string | null;
  productName: string | null;
  commentId: string | null;
  adId: string | null;
  capturedAt: string | null;
};

function sourceLabel(source: string | null | undefined): string {
  switch ((source || '').toLowerCase()) {
    case 'comment':
      return 'من تعليق على منشور';
    case 'story':
      return 'من ستوري';
    case 'ads':
      return 'من إعلان';
    case 'post':
      return 'من منشور';
    case 'shortlink':
      return 'من رابط مختصر';
    case 'postback':
      return 'من زر / قائمة';
    default:
      return 'مصدر المحادثة';
  }
}

function normalizePlatform(
  platform: string | null | undefined,
  conversationPlatform?: string | null
): 'facebook' | 'instagram' | null {
  const p = (platform || conversationPlatform || '').toLowerCase();
  if (p === 'facebook' || p === 'facebook_messenger' || p === 'facebook_comment') {
    return 'facebook';
  }
  if (p === 'instagram') return 'instagram';
  return null;
}

async function loadSocialPost(params: {
  merchantId: string;
  externalPostId: string;
  platform?: 'facebook' | 'instagram' | null;
}): Promise<{
  caption: string | null;
  thumbnailUrl: string | null;
  permalink: string | null;
  platform: string | null;
} | null> {
  const values: unknown[] = [params.merchantId, params.externalPostId];
  let sql = `
    SELECT caption, thumbnail_url, permalink, platform
    FROM social_posts
    WHERE merchant_id = $1
      AND (
        external_post_id = $2
        OR metadata->>'media_id' = $2
        OR metadata->>'post_id' = $2
      )`;
  if (params.platform) {
    values.push(params.platform);
    sql += ` AND platform = $3`;
  }
  sql += ` LIMIT 1`;

  const result = await pool.query(sql, values);
  const row = result.rows[0];
  if (!row) return null;
  return {
    caption: row.caption || null,
    thumbnailUrl: row.thumbnail_url || null,
    permalink: row.permalink || null,
    platform: row.platform || null
  };
}

async function loadProductName(
  merchantId: string,
  productId: string | null | undefined
): Promise<string | null> {
  if (!productId) return null;
  const result = await pool.query(
    `SELECT name FROM products WHERE id = $1 AND merchant_id = $2 LIMIT 1`,
    [productId, merchantId]
  );
  return result.rows[0]?.name || null;
}

async function loadAcquisitionFromDb(
  merchantId: string,
  conversationId: string
): Promise<{
  acquisition: AcquisitionContext | null;
  pageId: string | null;
}> {
  const result = await pool.query(
    `SELECT session_metadata, conversation_state, platform
     FROM conversations
     WHERE id = $1 AND merchant_id = $2
     LIMIT 1`,
    [conversationId, merchantId]
  );
  const row = result.rows[0];
  if (!row) return { acquisition: null, pageId: null };

  const meta =
    row.session_metadata && typeof row.session_metadata === 'object'
      ? row.session_metadata
      : {};
  const state =
    row.conversation_state && typeof row.conversation_state === 'object'
      ? row.conversation_state
      : {};

  const acquisition =
    (meta.acquisition as AcquisitionContext | undefined) ||
    (state.acquisition as AcquisitionContext | undefined) ||
    null;

  const pageId =
    (typeof meta.pageId === 'string' && meta.pageId) ||
    (typeof meta.channel_account_id === 'string' && meta.channel_account_id) ||
    (typeof state?.channel_binding?.page_id === 'string' && state.channel_binding.page_id) ||
    null;

  return { acquisition, pageId };
}

async function loadAcquisitionFromCommentAction(
  merchantId: string,
  conversationId: string
): Promise<AcquisitionContext | null> {
  const result = await pool.query(
    `SELECT platform, account_ref, external_post_id, external_comment_id, product_id, metadata, created_at
     FROM social_comment_actions
     WHERE merchant_id = $1 AND conversation_id = $2
     ORDER BY created_at DESC
     LIMIT 1`,
    [merchantId, conversationId]
  );
  const row = result.rows[0];
  if (!row?.external_post_id) return null;
  return {
    source: 'comment',
    post_id: row.external_post_id,
    comment_id: row.external_comment_id || null,
    product_id: row.product_id || null,
    linked_recommended: !!row.product_id,
    platform: row.platform,
    account_ref: row.account_ref,
    captured_at:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : String(row.created_at || new Date().toISOString()),
    post_caption: null,
    post_thumbnail_url: null,
    post_permalink: null,
    product_name: null
  };
}

/**
 * Enrich acquisition with a durable snapshot of the originating post (tenant-scoped).
 * Prefer calling applyAcquisitionToConversation which already snapshots.
 */
export async function enrichAcquisitionWithPostSnapshot(
  merchantId: string,
  acquisition: AcquisitionContext
): Promise<AcquisitionContext> {
  const enriched: AcquisitionContext = { ...acquisition };
  const platform = normalizePlatform(acquisition.platform);
  const postId = acquisition.post_id ? String(acquisition.post_id) : null;

  if (postId && (!acquisition.post_caption || !acquisition.post_thumbnail_url)) {
    try {
      const post = await loadSocialPost({
        merchantId,
        externalPostId: postId,
        platform
      });
      if (post) {
        enriched.post_caption = acquisition.post_caption || post.caption;
        enriched.post_thumbnail_url =
          acquisition.post_thumbnail_url || post.thumbnailUrl;
        enriched.post_permalink = acquisition.post_permalink || post.permalink;
        if (!enriched.platform && post.platform) {
          enriched.platform = post.platform;
        }
      }
    } catch (error) {
      logger.warn('Failed to snapshot social post for acquisition', {
        merchantId,
        postId,
        error: (error as Error).message
      });
    }
  }

  if (acquisition.product_id && !acquisition.product_name) {
    enriched.product_name = await loadProductName(merchantId, acquisition.product_id);
  }

  return enriched;
}

/**
 * Build inbox source-post banner payload for a conversation.
 */
export async function resolveConversationSourcePost(params: {
  merchantId: string;
  conversationId: string;
  conversationPlatform?: string | null;
}): Promise<ConversationSourcePost | null> {
  const { merchantId, conversationId, conversationPlatform } = params;

  try {
    let { acquisition } = await loadAcquisitionFromDb(merchantId, conversationId);
    if (!acquisition?.post_id && !acquisition?.ad_id) {
      acquisition = await loadAcquisitionFromCommentAction(merchantId, conversationId);
    }
    if (!acquisition) return null;
    if (!acquisition.post_id && !acquisition.ad_id && !acquisition.ref) return null;

    const platform = normalizePlatform(acquisition.platform, conversationPlatform);
    let caption = acquisition.post_caption || null;
    let thumbnailUrl = acquisition.post_thumbnail_url || null;
    let permalink = acquisition.post_permalink || null;
    let productName = acquisition.product_name || null;

    if (acquisition.post_id && (!caption || !thumbnailUrl || !permalink)) {
      const post = await loadSocialPost({
        merchantId,
        externalPostId: String(acquisition.post_id),
        platform
      });
      if (post) {
        caption = caption || post.caption;
        thumbnailUrl = thumbnailUrl || post.thumbnailUrl;
        permalink = permalink || post.permalink;
      }
    }

    if (acquisition.product_id && !productName) {
      productName = await loadProductName(merchantId, acquisition.product_id);
    }

    return {
      source: acquisition.source || 'unknown',
      sourceLabel: sourceLabel(acquisition.source),
      platform: platform || acquisition.platform || null,
      externalPostId: acquisition.post_id ? String(acquisition.post_id) : null,
      caption: caption ? String(caption).slice(0, 280) : null,
      thumbnailUrl,
      permalink,
      productId: acquisition.product_id || null,
      productName,
      commentId: acquisition.comment_id || null,
      adId: acquisition.ad_id || null,
      capturedAt: acquisition.captured_at || null
    };
  } catch (error) {
    logger.error('resolveConversationSourcePost failed', error as Error, {
      merchantId,
      conversationId
    });
    return null;
  }
}
