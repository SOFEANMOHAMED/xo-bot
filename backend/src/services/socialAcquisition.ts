/**
 * Acquisition context: seed conversation with optional product from post/ad/referral/story.
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
  | 'STORY'
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

export type MessagingAcquisitionSignals = {
  ref?: string;
  adId?: string;
  source?: string;
  type?: string;
  postId?: string;
  storyId?: string;
  storyUrl?: string | null;
};

export const STORY_REPLY_PLACEHOLDER = 'رد العميل على الستوري';
export const STORY_REACTION_PLACEHOLDER = 'تفاعل العميل مع الستوري';

const STORY_REACTION_ATTACHMENT_TYPES = new Set([
  'like_heart',
  'like',
  'reaction',
  'sticker',
  'animated_image',
]);

function asNonEmptyString(value: unknown): string | undefined {
  if (value == null) return undefined;
  const s = String(value).trim();
  return s ? s : undefined;
}

/**
 * Story reply on the merchant's own story (IG reply_to.story / some FB story taps).
 * STORY_MENTION is the customer's story mentioning the business — not a product link.
 */
export function extractStoryReplyFromMessagingEvent(event: any): {
  storyId: string;
  storyUrl: string | null;
} | null {
  const replyStory = event?.message?.reply_to?.story;
  const replyStoryId = asNonEmptyString(replyStory?.id);
  if (replyStoryId) {
    return {
      storyId: replyStoryId,
      storyUrl: asNonEmptyString(replyStory?.url) || null
    };
  }

  const referral = event?.referral || event?.postback?.referral || event?.message?.referral;
  const source = String(referral?.source || '').toUpperCase();
  if (source === 'STORY_MENTION') return null;

  const referralStoryId = asNonEmptyString(referral?.story?.id);
  if (referralStoryId) {
    return {
      storyId: referralStoryId,
      storyUrl: asNonEmptyString(referral?.story?.url) || null
    };
  }

  if (source === 'STORY' || source === 'STORIES') {
    const id =
      asNonEmptyString(referral?.story?.id) ||
      asNonEmptyString(referral?.post_id) ||
      asNonEmptyString(referral?.ads_context_data?.post_id);
    if (id) {
      return { storyId: id, storyUrl: asNonEmptyString(referral?.story?.url) || null };
    }
  }

  return null;
}

export function isStoryReplyMessagingEvent(event: any): boolean {
  return extractStoryReplyFromMessagingEvent(event) != null;
}

function isStoryReactionAttachment(event: any): boolean {
  const attachments = event?.message?.attachments;
  if (!Array.isArray(attachments) || attachments.length === 0) return false;
  return attachments.some((a: any) =>
    STORY_REACTION_ATTACHMENT_TYPES.has(String(a?.type || '').toLowerCase())
  );
}

/** Text for the bot turn when the inbound payload is a story reply with little/no copy. */
export function resolveInboundMessagingText(event: any, existingText?: string | null): string {
  const text = String(existingText ?? event?.message?.text ?? '').trim();
  if (text) return text;
  if (!isStoryReplyMessagingEvent(event)) return '';
  return isStoryReactionAttachment(event)
    ? STORY_REACTION_PLACEHOLDER
    : STORY_REPLY_PLACEHOLDER;
}

function acquisitionSourceFromSignals(signals: MessagingAcquisitionSignals): AcquisitionSource {
  if (signals.storyId) return 'STORY';
  if (String(signals.source || '').toUpperCase() === 'ADS') return 'ADS';
  if (signals.ref) return 'SHORTLINK';
  return 'POST';
}

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
           OR sp.metadata->>'media_id' = $3
           OR sp.metadata->>'post_id' = $3
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
  const isStory = acquisition.source === 'STORY';
  const productPart = productName
    ? isStory
      ? `المنتج المرتبط بالستوري (مستحسن للبدء): «${productName}». ابدأ بالحديث عنه إذا ناسب سؤال العميل، ويمكنك اقتراح منتجات أخرى من الكتالوج عند الحاجة.`
      : `المنتج المرتبط بالمنشور/الإعلان (مستحسن للبدء): «${productName}». ابدأ بالحديث عنه إذا ناسب سؤال العميل، ويمكنك اقتراح منتجات أخرى من الكتالوج عند الحاجة.`
    : isStory
      ? 'دخل العميل من رد على ستوري دون ربط منتج محدد — تصرّف كالمعتاد مع الكتالوج.'
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
           AND (
             external_post_id = $2
             OR metadata->>'media_id' = $2
             OR metadata->>'post_id' = $2
           )
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

export function extractReferralFromMessagingEvent(event: any): MessagingAcquisitionSignals | null {
  const referral = event?.referral || event?.postback?.referral || event?.message?.referral;
  const postback = event?.postback;
  const story = extractStoryReplyFromMessagingEvent(event);

  if (!referral && !postback && !story) return null;

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
    source: referral?.source != null ? String(referral.source) : story ? 'STORY' : undefined,
    type: referral?.type != null ? String(referral.type) : undefined,
    postId:
      referral?.ads_context_data?.post_id != null
        ? String(referral.ads_context_data.post_id)
        : undefined,
    storyId: story?.storyId,
    storyUrl: story?.storyUrl ?? null
  };
}

/**
 * Shared FB/IG path: story reply, ad, post, or ref → seed product + acquisition note.
 * Does not run on WhatsApp / Telegram / playground.
 */
export async function applyMessagingAcquisition(params: {
  event: any;
  merchantId: string;
  conversationId: string;
  conversationState: ConversationState;
  platform: 'facebook' | 'instagram';
  accountRef?: string | null;
}): Promise<{ conversationState: ConversationState; acquisitionNote: string }> {
  const signals = extractReferralFromMessagingEvent(params.event);
  if (!signals) {
    return { conversationState: params.conversationState, acquisitionNote: '' };
  }

  const storyId = asNonEmptyString(signals.storyId);
  const postId = asNonEmptyString(signals.postId);
  const adId = asNonEmptyString(signals.adId);
  const refCode = asNonEmptyString(signals.ref);
  if (!storyId && !postId && !adId && !refCode) {
    return { conversationState: params.conversationState, acquisitionNote: '' };
  }

  let resolved: { productId: string | null; linkedRecommended: boolean } = {
    productId: null,
    linkedRecommended: false
  };

  if (storyId) {
    resolved = await resolveProductForExternalContent({
      merchantId: params.merchantId,
      platform: params.platform,
      externalPostId: storyId
    });
  }

  if (!resolved.productId) {
    resolved = await resolveProductForExternalContent({
      merchantId: params.merchantId,
      platform: params.platform,
      externalPostId: postId,
      adId,
      refCode
    });
  }

  const contentId = storyId || postId || null;
  const acquisition: AcquisitionContext = {
    source: acquisitionSourceFromSignals(signals),
    post_id: contentId,
    ad_id: adId || null,
    ref: refCode || null,
    product_id: resolved.productId,
    linked_recommended: resolved.linkedRecommended,
    platform: params.platform,
    account_ref: params.accountRef || undefined,
    captured_at: new Date().toISOString(),
    post_thumbnail_url: signals.storyUrl || null
  };

  if (resolved.productId) {
    const product = await getProductById(params.merchantId, resolved.productId);
    acquisition.product_name = product?.name || null;
  }

  const conversationState = await applyAcquisitionToConversation({
    conversationId: params.conversationId,
    merchantId: params.merchantId,
    acquisition,
    conversationState: params.conversationState
  });

  logger.info('Messaging acquisition context applied', {
    merchantId: params.merchantId,
    conversationId: params.conversationId,
    platform: params.platform,
    productId: resolved.productId,
    source: acquisition.source,
    storyId: storyId || null
  });

  return {
    conversationState,
    acquisitionNote: buildAcquisitionContextNote(acquisition, acquisition.product_name)
  };
}
