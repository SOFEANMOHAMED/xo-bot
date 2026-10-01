/**
 * TurnIntent — deterministic turn classification before order rails.
 *
 * The model may suggest next_action / customer_request flags; code owns the final
 * turn intent so browse (photo / product Q&A) never collapses into collect_info.
 *
 * Priority (highest first):
 *   finalize → browse_media → product_qa → cart_edit → other
 *
 * Keep this module free of imports from orderConfirmationPolicy to avoid cycles.
 */

import type { CustomerRequestSignals } from './customerRequest.js';
import { isPastBotClaimDispute } from './pastBotClaimDispute.js';

export type TurnIntent =
  | 'browse_media'
  | 'product_qa'
  | 'cart_edit'
  | 'checkout'
  | 'finalize'
  | 'other';

/**
 * True when the current user message is an explicit media/photo request.
 * Used as a hard gate — not prompt-only guidance.
 *
 * Refusal of a photo («ما بدي الصورة») is NOT a request — see isExplicitPhotoRefusal.
 */
export function isExplicitPhotoRequest(messageText: string): boolean {
  if (!messageText?.trim()) return false;
  if (isExplicitPhotoRefusal(messageText)) return false;
  const text = messageText.trim();
  // Must mention photo/image vocabulary (not every "ابعث" alone)
  const hasPhotoLexeme =
    /صور(ة|ه|ي)?/i.test(text) ||
    /وريني|فرجيني|ارني|أرني/i.test(text) ||
    /\b(photo|picture|image|pic)\b/i.test(text);
  if (!hasPhotoLexeme) return false;
  return (
    /صور(ة|ه|ي)?/i.test(text) ||
    /وريني|فرجيني|ارني|أرني|فرجوي/i.test(text) ||
    /بعتلي|ابعث|ابعتلي|أرسلي|ارسلي|أرسل|ارسل/i.test(text) ||
    /\b(photo|picture|image|pic)\b/i.test(text) ||
    /\b(send|show)\s+(me\s+)?(a\s+)?(photo|picture|image)\b/i.test(text)
  );
}

/**
 * Current-message refusal to receive a photo (INTERIM matcher — documented phrases).
 * WHY: messages that mention «صورة» while refusing were classified as browse_media
 * and got browseMediaCaptionFallback «رح أرسلك صورة المنتج» (PHASE 2F).
 */
export function isExplicitPhotoRefusal(messageText: string): boolean {
  if (!messageText?.trim()) return false;
  const hasPhoto =
    /صور(ة|ه)?/i.test(messageText) || /\b(photo|picture|image)\b/i.test(messageText);
  if (!hasPhoto) return false;
  return (
    /(ما\s*بدي|ما\s*ابي|بلاش|بدون|لا\s*بدي|مو\s*بدي|مش\s*بدي)\s*.{0,12}صور/i.test(
      messageText
    ) ||
    /لا\s*أنا\s*ما\s*بدي\s*الصور/i.test(messageText) ||
    /\b(don'?t|do not)\s+want\s+(a\s+)?(photo|picture|image)\b/i.test(messageText)
  );
}

/**
 * Single photo decision for attach / send_image / browse_media.
 * Current message + optional interpreter ownership; no history inference.
 */
export type PhotoDecision = {
  wantsPhoto: boolean;
  refusesPhoto: boolean;
  attachImage: boolean;
  nextActionHint: 'send_image' | null;
};

export function resolvePhotoDecision(opts: {
  messageText: string;
  customerRequest?: CustomerRequestSignals | null;
  /** When interpreter owned refuse_photo this turn. */
  interpreterRefusesPhoto?: boolean;
  /** When interpreter owned request_photo this turn. */
  interpreterWantsPhoto?: boolean | null;
  /** True when refuse_photo was flipped/applied this turn. */
  interpreterOwnsRefuse?: boolean;
  /** True when request_photo was flipped/applied this turn. */
  interpreterOwnsRequest?: boolean;
}): PhotoDecision {
  if (opts.interpreterOwnsRefuse || opts.interpreterRefusesPhoto) {
    return {
      wantsPhoto: false,
      refusesPhoto: true,
      attachImage: false,
      nextActionHint: null,
    };
  }

  if (opts.interpreterOwnsRequest) {
    const wants = Boolean(opts.interpreterWantsPhoto);
    return {
      wantsPhoto: wants,
      refusesPhoto: false,
      attachImage: wants,
      nextActionHint: wants ? 'send_image' : null,
    };
  }

  const refuses = isExplicitPhotoRefusal(opts.messageText);
  if (refuses) {
    return {
      wantsPhoto: false,
      refusesPhoto: true,
      attachImage: false,
      nextActionHint: null,
    };
  }

  const wants =
    isExplicitPhotoRequest(opts.messageText) ||
    opts.customerRequest?.wantsPhoto === true;
  return {
    wantsPhoto: wants,
    refusesPhoto: false,
    attachImage: wants,
    nextActionHint: wants ? 'send_image' : null,
  };
}

export interface ResolveTurnIntentInput {
  userMessage: string;
  customerRequest?: CustomerRequestSignals | null;
  /**
   * @deprecated Do not use — photo intent must come from the current message only.
   * Kept optional so older call sites compile; ignored when classifying.
   */
  variantAfterPhotoOffer?: boolean;
  /** Precomputed by caller (orderConfirmationPolicy.isProductInfoRequest / model flag). */
  asksProductInfo?: boolean;
  /** Precomputed by caller (customerAffirmsOrder / customerDeclinesMoreItems + lastBotReply). */
  isFinalizing?: boolean;
}

/**
 * Classify the customer turn. Model flags reinforce; code heuristics are authoritative
 * for browse_media so a missing wants_photo JSON flag cannot open checkout.
 */
export function resolveTurnIntent(input: ResolveTurnIntentInput): TurnIntent {
  const {
    userMessage,
    customerRequest,
    asksProductInfo = false,
    isFinalizing = false,
  } = input;

  const photoDecision = resolvePhotoDecision({
    messageText: userMessage,
    customerRequest,
  });

  // Finalize only when not clearly asking for a photo in the same breath
  if ((isFinalizing || customerRequest?.readyToConfirm) && !photoDecision.wantsPhoto) {
    return 'finalize';
  }

  if (photoDecision.wantsPhoto) {
    return 'browse_media';
  }

  // Disputing a prior bot claim («أنت قلت في أسود») is product Q&A, not checkout.
  if (
    isPastBotClaimDispute(userMessage) ||
    asksProductInfo ||
    customerRequest?.asksProductInfo === true
  ) {
    return 'product_qa';
  }

  if (customerRequest?.wantsAddAnother === true) {
    return 'cart_edit';
  }

  if (customerRequest?.wantsAlternatives === true) {
    return 'product_qa';
  }

  return 'other';
}

/** Turn intents that must never enter collect_info / await_confirmation / confirm_order. */
export function isBrowseTurnIntent(intent: TurnIntent): boolean {
  return intent === 'browse_media' || intent === 'product_qa';
}

/**
 * Map browse turn → safe next_action before order rails run.
 * Returns null when the turn may proceed to normal order policy.
 */
export function nextActionForBrowseTurn(
  intent: TurnIntent,
  aiNextAction: string
): string | null {
  if (intent === 'browse_media') {
    return 'send_image';
  }
  if (intent === 'product_qa') {
    if (aiNextAction === 'send_image' || aiNextAction === 'end_conversation') {
      return aiNextAction;
    }
    return 'present_product';
  }
  return null;
}

/** Short caption when the model leaked checkout copy on a photo turn. */
export function browseMediaCaptionFallback(language: 'arabic' | 'english'): string {
  return language === 'arabic'
    ? 'تمام، رح أرسلك صورة المنتج.'
    : 'Sure — I will send you a photo of the product.';
}
