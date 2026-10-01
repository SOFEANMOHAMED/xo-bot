import type { ConversationState, Product } from '../../../core/types.js';
import { isSellableProduct } from '../resolveFocus.js';
import {
  detectPendingBotQuestion,
  readPendingFromState as readLegacyPending,
} from '../pendingBotQuestion.js';
import { isOurVariantAskTemplate } from './ask.js';
import { effectiveAxes, isAxisActive } from './axes.js';
import {
  RESERVED_AXIS_COLOR,
  RESERVED_AXIS_SIZE,
  type PendingVariantQuestion,
  type VariantAxisId,
} from './types.js';

/**
 * First effective axis whose OUR template appears in the reply.
 * Falls back to legacy color/size fingerprints (V2) when those axes are active.
 */
export function detectPendingAxis(
  replyText: string,
  product: Product | null | undefined
): VariantAxisId | null {
  if (!replyText?.trim()) return null;
  for (const axis of effectiveAxes(product)) {
    if (isOurVariantAskTemplate(replyText, axis)) return axis.id;
  }
  const legacy = detectPendingBotQuestion(replyText);
  if (legacy && isAxisActive(product, legacy)) return legacy;
  return null;
}

export function bindPendingVariantQuestion(
  replyText: string,
  state: ConversationState,
  focusProduct?: Product | null
): PendingVariantQuestion {
  if (focusProduct && !isSellableProduct(focusProduct)) return null;
  const axisId = detectPendingAxis(replyText, focusProduct);
  if (!axisId) return null;
  const productId =
    (focusProduct?.id && String(focusProduct.id)) ||
    state.last_recommended_products?.[0] ||
    state.extracted_entities?.product_id ||
    null;
  if (!productId) return null;
  return { axisId, productId: String(productId) };
}

export function resolveIncomingPending(opts: {
  stored?: string | null;
  storedProductId?: string | null;
  lastBotReply: string;
  product: Product | null | undefined;
  focusProductId?: string | null;
}): PendingVariantQuestion {
  const last = (opts.lastBotReply || '').trim();
  if (last) {
    const axisId = detectPendingAxis(last, opts.product);
    if (!axisId) return null;
    const productId =
      opts.focusProductId ||
      opts.storedProductId ||
      (opts.product?.id ? String(opts.product.id) : null);
    if (!productId) return null;
    return { axisId, productId };
  }
  const stored = (opts.stored || '').trim();
  if (!stored) return null;
  if (
    stored !== RESERVED_AXIS_COLOR &&
    stored !== RESERVED_AXIS_SIZE &&
    !isAxisActive(opts.product, stored)
  ) {
    return null;
  }
  const productId =
    opts.storedProductId ||
    opts.focusProductId ||
    (opts.product?.id ? String(opts.product.id) : null);
  if (!productId) return null;
  return { axisId: stored, productId };
}

/** Persist helper — V2 pipeline still writes via legacy bind (color/size only). */
export function pendingToStateFields(pending: PendingVariantQuestion): {
  pending_bot_question: string | null;
  pending_bot_question_product_id: string | null;
} {
  if (!pending) {
    return { pending_bot_question: null, pending_bot_question_product_id: null };
  }
  return {
    pending_bot_question: pending.axisId,
    pending_bot_question_product_id: pending.productId,
  };
}

export function pendingFromConversationState(
  state: ConversationState,
  product: Product | null | undefined,
  lastBotReply: string
): PendingVariantQuestion {
  const legacy = readLegacyPending(state);
  return resolveIncomingPending({
    stored: legacy.pending_bot_question,
    storedProductId: legacy.pending_bot_question_product_id,
    lastBotReply,
    product,
    focusProductId: product?.id ? String(product.id) : null,
  });
}
