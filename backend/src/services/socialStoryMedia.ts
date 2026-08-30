/**
 * Resolve a real image for Facebook / Instagram stories.
 * Graph `url` on Page stories is a permalink, not an image — never use it as a thumbnail.
 * SaaS-safe: every lookup is scoped by merchant_id; tokens never leave the server.
 */

import pool from '../database/connection.js';
import { logger } from '../utils/logger.js';

const GRAPH_VERSION = process.env.FACEBOOK_GRAPH_VERSION || 'v21.0';
const MAX_PREVIEW_BYTES = 8 * 1024 * 1024;

const META_MEDIA_HOST =
  /(?:^|\.)(?:fbcdn\.net|cdninstagram\.com|fbsbx\.com|instagram\.com|xx\.fbcdn\.net)$/i;

export function isDirectStoryImageUrl(url: string | null | undefined): boolean {
  const raw = String(url || '').trim();
  if (!/^https:\/\//i.test(raw)) return false;
  if (/facebook\.com\/stories/i.test(raw)) return false;
  if (/\.(mp4|mov|m3u8|webm)(\?|$)/i.test(raw)) return false;
  try {
    const host = new URL(raw).hostname;
    return META_MEDIA_HOST.test(host) || /\.(jpe?g|png|webp|gif)(\?|$)/i.test(raw);
  } catch {
    return false;
  }
}

function pickLargestImageSource(images: unknown): string | null {
  if (!Array.isArray(images) || images.length === 0) return null;
  let best: { source?: string; width?: number } | null = null;
  for (const item of images) {
    if (!item || typeof item !== 'object') continue;
    const row = item as { source?: string; width?: number };
    if (!row.source) continue;
    if (!best || (row.width || 0) > (best.width || 0)) best = row;
  }
  return best?.source ? String(best.source) : null;
}

async function graphGet(
  path: string,
  accessToken: string,
  params: Record<string, string> = {}
): Promise<Record<string, any>> {
  const query = new URLSearchParams({ access_token: accessToken, ...params });
  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${path}?${query.toString()}`;
  const res = await fetch(url);
  const json = (await res.json()) as Record<string, any>;
  if (json.error) {
    throw new Error(JSON.stringify(json.error));
  }
  return json;
}

export async function resolveInstagramStoryMedia(
  igMediaId: string,
  accessToken: string
): Promise<{
  thumbnailUrl: string | null;
  permalink: string | null;
  mediaType: string | null;
  caption: string | null;
  postedAt: string | null;
}> {
  const data = await graphGet(encodeURIComponent(igMediaId), accessToken, {
    fields: 'id,caption,media_type,media_url,thumbnail_url,permalink,timestamp'
  });
  const thumbnailUrl =
    (isDirectStoryImageUrl(data.thumbnail_url) ? String(data.thumbnail_url) : null) ||
    (isDirectStoryImageUrl(data.media_url) ? String(data.media_url) : null);
  return {
    thumbnailUrl,
    permalink: data.permalink ? String(data.permalink) : null,
    mediaType: data.media_type ? String(data.media_type) : null,
    caption: data.caption ? String(data.caption) : null,
    postedAt: data.timestamp ? String(data.timestamp) : null
  };
}

export async function resolveFacebookStoryImageUrl(
  mediaId: string,
  accessToken: string
): Promise<string | null> {
  const fieldSets = ['picture,images,source', 'picture,images', 'picture,source', 'picture'];
  for (const fields of fieldSets) {
    try {
      const data = await graphGet(encodeURIComponent(mediaId), accessToken, { fields });
      const fromImages = pickLargestImageSource(data.images);
      if (isDirectStoryImageUrl(fromImages)) return fromImages;
      if (isDirectStoryImageUrl(data.source)) return String(data.source);
      if (isDirectStoryImageUrl(data.picture)) return String(data.picture);
    } catch (error) {
      logger.debug('Facebook story media fields lookup failed', {
        mediaId,
        fields,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  for (const type of ['normal', 'album', 'thumbnail']) {
    try {
      const pic = await graphGet(`${encodeURIComponent(mediaId)}/picture`, accessToken, {
        redirect: 'false',
        type
      });
      const url = pic?.data?.url ? String(pic.data.url) : null;
      if (isDirectStoryImageUrl(url)) return url;
    } catch (error) {
      logger.debug('Facebook story picture lookup failed', {
        mediaId,
        type,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  return null;
}

async function fetchAllowlistedImage(
  url: string
): Promise<{ body: Buffer; contentType: string } | null> {
  if (!isDirectStoryImageUrl(url)) return null;
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:') return null;

  const res = await fetch(url, {
    redirect: 'follow',
    headers: {
      Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
      'User-Agent': 'Mozilla/5.0 (compatible; XOBot/1.0)'
    }
  });
  if (!res.ok) return null;
  const contentType = String(res.headers.get('content-type') || '').split(';')[0].trim();
  if (!contentType.startsWith('image/')) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  if (!buf.length || buf.length > MAX_PREVIEW_BYTES) return null;
  return { body: buf, contentType };
}

export async function loadMerchantStoryPreviewImage(params: {
  merchantId: string;
  socialPostId: string;
}): Promise<{ body: Buffer; contentType: string } | null> {
  const postResult = await pool.query(
    `SELECT id, platform, account_ref, external_post_id, thumbnail_url, media_type, metadata
     FROM social_posts
     WHERE id = $1 AND merchant_id = $2 AND COALESCE(content_kind, 'post') = 'story'
     LIMIT 1`,
    [params.socialPostId, params.merchantId]
  );
  const post = postResult.rows[0];
  if (!post) return null;

  const metadata =
    post.metadata && typeof post.metadata === 'object' ? post.metadata : {};
  const mediaId = String(metadata.media_id || post.external_post_id || '').trim();

  let token: string | null = null;
  if (post.platform === 'instagram') {
    const tok = await pool.query(
      `SELECT access_token FROM instagram_accounts
       WHERE merchant_id = $1 AND ig_user_id = $2
       LIMIT 1`,
      [params.merchantId, post.account_ref]
    );
    token = tok.rows[0]?.access_token || null;
  } else if (post.platform === 'facebook') {
    const tok = await pool.query(
      `SELECT access_token FROM facebook_pages
       WHERE merchant_id = $1 AND page_id = $2
       LIMIT 1`,
      [params.merchantId, post.account_ref]
    );
    token = tok.rows[0]?.access_token || null;
  }

  let freshUrl: string | null = null;
  if (token && mediaId) {
    try {
      if (post.platform === 'instagram') {
        const ig = await resolveInstagramStoryMedia(mediaId, token);
        freshUrl = ig.thumbnailUrl;
      } else {
        freshUrl = await resolveFacebookStoryImageUrl(mediaId, token);
      }
    } catch (error) {
      logger.warn('Story preview Graph refresh failed', {
        merchantId: params.merchantId,
        socialPostId: params.socialPostId,
        platform: post.platform,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  const candidates = [freshUrl, post.thumbnail_url ? String(post.thumbnail_url) : null];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const img = await fetchAllowlistedImage(candidate);
    if (!img) continue;
    if (candidate !== post.thumbnail_url && isDirectStoryImageUrl(candidate)) {
      await pool.query(
        `UPDATE social_posts
         SET thumbnail_url = $1, updated_at = NOW()
         WHERE id = $2 AND merchant_id = $3`,
        [candidate, params.socialPostId, params.merchantId]
      );
    }
    return img;
  }
  return null;
}
