/**
 * Acquisition context: seed conversation with optional product from post/ad/referral.
 * Product link is recommended, never required. AI may still browse other products.
 */

import pool from '../database/connection.js';
import { logger } from '../utils/logger.js';
import type { ConversationState } from '../core/types.js';
import { getProductById } from '../catalog/product-search.js';

export type AcquisitionSource =
  | 'comment'
  | 'ADS'
  | 'POST'
  | 'SHORTLINK'
  | 'POSTBACK'
  | null;

export type AcquisitionContext = {
  source: AcquisitionSource;
  post_id?: string | null;
  comment_id?: string | null;
  ad_id?: string | null;
  ref?: string | null;
  product_id?: string | null;
  linked_recommended?: boolean;
  platform?: string;
  account_ref?: string;
  captured_at: string;
  /** Durable snapshot for inbox banner (filled at capture time when available) */
  post_caption?: string | null;
  post_thumbnail_url?: string | null;
  post_permalink?: string | null;
  product_name?: string | null;
};

export async function resolveProductForExternalContent(params: {
  merchantId: string;
  platform: 'facebook' | 'instagram';
  externalPostId?: string | null;
  adId?: string | null;
  refCode?: string | null;
}): Promise<{ productId: string | null; linkedRecommended: boolean }> {
  const { merchantId, platform, externalPostId, adId, refCode } = params;

  if (refCode) {
    const byRef = await pool.query(
      `SELECT product_id FROM social_content_links
       WHERE merchant_id = $1 AND is_active = true AND ref_code = $2
       LIMIT 1`,
      [merchantId, refCode]
    );
    if (byRef.rows[0]?.product_id) {
      return { productId: byRef.rows[0].product_id, linkedRecommended: true };
    }
  }

  if (adId) {
    const byAd = await pool.query(
      `SELECT product_id FROM social_content_links
       WHERE merchant_id = $1 AND platform = $2 AND content_type = 'ad'
         AND is_active = true AND external_id = $3
       LIMIT 1`,
      [merchantId, platform, adId]
    );
    if (byAd.rows[0]?.product_id) {
      return { productId: byAd.rows[0].product_id, linkedRecommended: true };
    }
  }

  if (externalPostId) {
    const byPost = await pool.query(
      `SELECT scl.product_id
       FROM social_content_links scl
       LEFT JOIN social_posts sp ON sp.id = scl.social_post_id AND sp.merchant_id = scl.merchant_id
       WHERE scl.merchant_id = $1
         AND scl.platform = $2
         AND scl.is_active = true
         AND (
           scl.external_id = $3
           OR sp.external_post_id = $3
         )
       LIMIT 1`,
      [merchantId, platform, externalPostId]
    );
    if (byPost.rows[0]?.product_id) {
      return { productId: byPost.rows[0].product_id, linkedRecommended: true };
    }
  }

  return { productId: null, linkedRecommended: false };
}

export function buildAcquisitionContextNote(
  acquisition: AcquisitionContext,
  productName?: string | null
): string {
  const productPart = productName
    ? `المنتج المرتبط بالمنشور/الإعلان (مستحسن للبدء): «${productName}». ابدأ بالحديث عنه إذا ناسب سؤال العميل، ويمكنك اقتراح منتجات أخرى من الكتالوج عند الحاجة.`
    : 'دخل العميل من منشور/إعلان دون ربط منتج محدد — تصرّف كالمعتاد مع الكتالوج.';

  return `[سياق الدخول: المصدر=${acquisition.source || 'unknown'}، منشور=${acquisition.post_id || '-'}، إعلان=${acquisition.ad_id || '-'}، ref=${acquisition.ref || '-'}]. ${productPart}`;
}

export function seedConversationStateWithProduct(
  state: ConversationState,
  productId: string | null
): ConversationState {
  if (!productId) return state;
  const entities = { ...(state.extracted_entities || {}), product_id: productId };
  const last = Array.isArray(state.last_recommended_products)
    ? state.last_recommended_products.filter((id) => id !== productId)
    : [];
  return {
    ...state,
    extracted_entities: entities,
    last_recommended_products: [productId, ...last].slice(0, 5)
  };
}

export async function applyAcquisitionToConversation(params: {
  conversationId: string;
  merchantId: string;
  acquisition: AcquisitionContext;
  conversationState?: ConversationState;
}): Promise<ConversationState> {
  const { conversationId, merchantId } = params;
  const acquisition: AcquisitionContext = { ...params.acquisition };
  let state: ConversationState = params.conversationState || { message_count: 0 };

  // Snapshot post preview for inbox banner (merchant-scoped)
  if (acquisition.post_id && (!acquisition.post_caption || !acquisition.post_thumbnail_url)) {
    try {
      const postResult = await pool.query(
        `SELECT caption, thumbnail_url, permalink, platform
         FROM social_posts
         WHERE merchant_id = $1
           AND external_post_id = $2
           AND ($3::text IS NULL OR platform = $3)
         LIMIT 1`,
        [
          merchantId,
          String(acquisition.post_id),
          acquisition.platform === 'facebook' || acquisition.platform === 'instagram'
            ? acquisition.platform
            : null
        ]
      );
      const post = postResult.rows[0];
      if (post) {
        acquisition.post_caption = acquisition.post_caption || post.caption || null;
        acquisition.post_thumbnail_url =
          acquisition.post_thumbnail_url || post.thumbnail_url || null;
        acquisition.post_permalink = acquisition.post_permalink || post.permalink || null;
        if (!acquisition.platform && post.platform) {
          acquisition.platform = post.platform;
        }
      }
    } catch (error) {
      logger.warn('Failed to snapshot social post for acquisition', {
        merchantId,
        postId: acquisition.post_id,
        error: (error as Error).message
      });
    }
  }

  if (acquisition.product_id) {
    const product = await getProductById(merchantId, acquisition.product_id);
    if (!product) {
      logger.warn('Acquisition product not found for merchant', {
        merchantId,
        productId: acquisition.product_id
      });
      acquisition.product_id = null;
      acquisition.linked_recommended = false;
      acquisition.product_name = null;
    } else {
      acquisition.product_name = acquisition.product_name || product.name || null;
      state = seedConversationStateWithProduct(state, product.id);
    }
  }

  await pool.query(
    `UPDATE conversations
     SET session_metadata = COALESCE(session_metadata, '{}'::jsonb) || jsonb_build_object('acquisition', $2::jsonb),
         conversation_state = $3::jsonb,
         updated_at = NOW()
     WHERE id = $1 AND merchant_id = $4`,
    [conversationId, JSON.stringify(acquisition), JSON.stringify(state), merchantId]
  );

  return state;
}

export function extractReferralFromMessagingEvent(event: any): {
  ref?: string;
  adId?: string;
  source?: string;
  type?: string;
  postId?: string;
} | null {
  const referral = event?.referral || event?.postback?.referral || event?.message?.referral;
  const postback = event?.postback;

  if (!referral && !postback) return null;

  const ref =
    (referral?.ref != null ? String(referral.ref) : undefined) ||
    (postback?.payload != null ? String(postback.payload) : undefined);

  const adId =
    referral?.ad_id != null
      ? String(referral.ad_id)
      : referral?.ads_context_data?.ad_id != null
        ? String(referral.ads_context_data.ad_id)
        : undefined;

  return {
    ref,
    adId,
    source: referral?.source != null ? String(referral.source) : undefined,
    type: referral?.type != null ? String(referral.type) : undefined,
    postId:
      referral?.ads_context_data?.post_id != null
        ? String(referral.ads_context_data.post_id)
        : undefined
  };
}
