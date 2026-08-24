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
 */
export function isExplicitPhotoRequest(messageText: string): boolean {
  if (!messageText?.trim()) return false;
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

export interface ResolveTurnIntentInput {
  userMessage: string;
  customerRequest?: CustomerRequestSignals | null;
  /**
   * Color reply after the bot offered a photo — treated as browse_media
   * so checkout rails do not steal the turn.
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
    variantAfterPhotoOffer = false,
    asksProductInfo = false,
    isFinalizing = false,
  } = input;

  const photo =
    isExplicitPhotoRequest(userMessage) ||
    customerRequest?.wantsPhoto === true ||
    variantAfterPhotoOffer;

  // Finalize only when not clearly asking for a photo in the same breath
  if ((isFinalizing || customerRequest?.readyToConfirm) && !photo) {
    return 'finalize';
  }

  if (photo) {
    return 'browse_media';
  }

  if (asksProductInfo || customerRequest?.asksProductInfo === true) {
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
