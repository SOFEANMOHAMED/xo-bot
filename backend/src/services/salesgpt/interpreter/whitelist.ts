/**
 * Deterministic whitelist — no LLM. Contract §5 + pending bare variant + cancel + identity.
 */
import { normalizeArabic } from '../../../catalog/product-search.js';
import {
  matchCartLinesForProductNegation,
  matchCartLinesForRemoval,
} from '../cartLineRemoval.js';
import {
  botAskedIdentityField,
  ingestIdentityAnswerFromBotAsk,
  isBotIdentityBundleAsk,
  parseIdentityFieldsFromMessage,
} from '../collectInfoOrder.js';
import { classifyInterimCancelIntent } from '../interimCancelMatchers.js';
import {
  customerAffirmsOrder,
  customerDeclinesMoreItems,
  isStorePolicyInfoRequest,
} from '../orderConfirmationPolicy.js';
import { isPastBotClaimDispute } from '../pastBotClaimDispute.js';
import { colorAxisFromValues, sizeAxisFromValues } from '../variantEngine/axes.js';
import { extractBareCatalogAnswer } from '../variantEngine/match.js';
import type { InterpreterAction, InterpreterCartLine, InterpreterInput, InterpreterResult } from './types.js';

const APPLY_CONFIDENCE = 0.95;

function action(
  type: InterpreterAction['type'],
  evidence: string,
  extra: Partial<InterpreterAction> = {}
): InterpreterAction {
  return {
    type,
    confidence: APPLY_CONFIDENCE,
    evidence,
    ambiguous: false,
    ...extra,
  };
}

function result(actions: InterpreterAction[]): InterpreterResult {
  return { actions, rawModelConfidence: APPLY_CONFIDENCE };
}

/** Explicit human handoff — documented phrases only. */
export function isExplicitHumanHandoffRequest(messageText: string): boolean {
  if (!messageText?.trim()) return false;
  const n = normalizeArabic(messageText);
  return (
    /(موظف|انسان حقيقي|شخص حقيقي|بشري|تحدث مع (شخص|انسان|موظف)|كلم (موظف|شخص)|حولني)/i.test(
      n
    ) ||
    /\b(real person|human agent|speak to (a |an )?(human|person|agent)|talk to (a |an )?(human|person|agent))\b/i.test(
      messageText
    )
  );
}

/** Customer asking whether they are talking to a bot. */
export function isAskingIfBot(messageText: string): boolean {
  if (!messageText?.trim()) return false;
  const n = normalizeArabic(messageText);
  return (
    /(انت|انتو|هل انت|هل هذا)\s*(بوت|روبوت|ذكاء)/i.test(n) ||
    /\b(are you (a )?(bot|robot|ai)|is this (a )?(bot|robot|ai))\b/i.test(messageText)
  );
}

function isBareYesNo(messageText: string): boolean {
  const n = normalizeArabic(messageText);
  return /^(نعم|ايوا|ايوه|اي|لا|لاا|لأ|yes|yep|yeah|no|nope)$/i.test(n);
}

function lineForPending(
  input: InterpreterInput
): InterpreterCartLine | undefined {
  const pid = input.stateSummary.pendingProductId;
  if (pid) {
    const hit = input.cartLines.find((line) => line.productId === pid);
    if (hit) return hit;
  }
  return input.cartLines[0];
}

/**
 * Pending color/size ask → bare catalog answer is deterministic (no LLM).
 */
function matchPendingVariant(input: InterpreterInput): InterpreterResult | null {
  const pending = input.stateSummary.pendingBotQuestion;
  if (pending !== 'color' && pending !== 'size') return null;
  const message = input.message.trim();
  if (!message) return null;

  const line = lineForPending(input);
  const productId =
    input.stateSummary.pendingProductId || line?.productId || input.stateSummary.focusProductId;
  if (!productId || !input.allowedProductIds.includes(productId)) return null;

  if (pending === 'color') {
    const values = line?.allowedColors?.length
      ? line.allowedColors
      : [];
    // When cart has no colors yet, still allow axis from empty — fall through to LLM/old.
    if (!values.length) return null;
    const axis = colorAxisFromValues(values);
    if (!axis) return null;
    const picked = extractBareCatalogAnswer(message, axis);
    if (!picked) return null;
    return result([
      action('select_color', message.slice(0, 80), {
        color: picked,
        productId,
        lineId: line?.lineId,
      }),
    ]);
  }

  const values = line?.allowedSizes?.length ? line.allowedSizes : [];
  if (!values.length) return null;
  const axis = sizeAxisFromValues(values);
  if (!axis) return null;
  const picked = extractBareCatalogAnswer(message, axis);
  if (!picked) return null;
  return result([
    action('select_size', message.slice(0, 80), {
      size: picked,
      productId,
      lineId: line?.lineId,
    }),
  ]);
}

function cartItemsFromInterpreter(input: InterpreterInput) {
  return input.cartLines.map((line) => ({
    lineId: line.lineId,
    productId: line.productId,
    productName: line.productName,
    quantity: line.quantity,
    unitPrice: 0,
    currency: line.currency,
    color: line.color || undefined,
    size: line.size || undefined,
    addedAt: '',
  }));
}

function matchCancel(input: InterpreterInput): InterpreterResult | null {
  const kind = classifyInterimCancelIntent(input.message);
  if (kind === 'whole_cancel') {
    return result([action('cancel_order', input.message.trim().slice(0, 80))]);
  }
  if (kind === 'partial_remove') {
    const cartItems = cartItemsFromInterpreter(input);
    const matches = matchCartLinesForRemoval(input.message, cartItems);
    if (matches.length === 0) {
      // Signal empty match so the pipeline can emit line_not_found (not a free LLM ask).
      return result([
        action('ask_clarification', input.message.trim().slice(0, 80), {
          ambiguous: true,
          evidence: 'cart_line_not_found',
        }),
      ]);
    }
    // Same as the old interim rail: remove every matched line in one turn.
    return result(
      matches.map((match) =>
        action('remove_line', input.message.trim().slice(0, 80), {
          lineId: match.lineId,
          productId: match.productId,
        })
      )
    );
  }
  return null;
}

/**
 * «بدي القميص مو الساعة» / «ما بدي الساعة» — drop negated cart lines.
 * Evidence tag lets the pipeline continue when another product is still wanted.
 */
function matchProductNegation(input: InterpreterInput): InterpreterResult | null {
  const cartItems = cartItemsFromInterpreter(input);
  const negated = matchCartLinesForProductNegation(input.message, cartItems);
  if (negated.length === 0) return null;
  return result(
    negated.map((match) =>
      action('remove_line', 'product_negation', {
        lineId: match.lineId,
        productId: match.productId,
      })
    )
  );
}

function matchIdentity(input: InterpreterInput): InterpreterResult | null {
  const lastBot =
    [...input.recentMessages].reverse().find((m) => m.role === 'assistant')?.content ||
    '';
  const bundleAsk = isBotIdentityBundleAsk(lastBot);
  const asked = botAskedIdentityField(lastBot);
  if (!bundleAsk && !asked) return null;
  if (isPastBotClaimDispute(input.message)) return null;

  const parsed = parseIdentityFieldsFromMessage(input.message);
  // Name/address blobs without a phone token stay on the agent ingest+LLM path
  // (structural parse cannot split «اسم + عنوان» alone) — except short name after bundle.
  if (!parsed.phone && !bundleAsk && (asked === 'name' || asked === 'address')) {
    const tokens = input.message.trim().split(/\s+/).filter(Boolean).length;
    if (tokens > 3) return null;
  }
  if (!parsed.phone && bundleAsk) {
    const tokens = input.message.trim().split(/\s+/).filter(Boolean).length;
    // Bundle + long blob without phone → agent/LLM; short → name via ingest.
    if (tokens > 4) return null;
  }

  const ingested = ingestIdentityAnswerFromBotAsk({
    lastBotReply: lastBot,
    userMessage: input.message,
    collected: { name: null, phone: null, address: null },
    blockIngest: false,
  });

  const actions: InterpreterAction[] = [];
  for (const field of ['name', 'phone', 'address'] as const) {
    const value = ingested[field]?.trim();
    if (!value) continue;
    actions.push(
      action('provide_identity_field', input.message.trim().slice(0, 80), {
        identityField: field,
        identityValue: value,
      })
    );
  }
  if (actions.length === 0) return null;
  return result(actions);
}

/**
 * If the message matches a whitelist rule, return a closed result.
 * Otherwise null — caller may run the LLM interpreter.
 */
export function matchWhitelist(input: InterpreterInput): InterpreterResult | null {
  const message = input.message || '';
  if (!message.trim()) return null;

  if (isExplicitHumanHandoffRequest(message)) {
    return result([action('handoff_human', message.trim().slice(0, 80))]);
  }

  if (isAskingIfBot(message)) {
    return result([action('ask_product_info', message.trim().slice(0, 80), { infoKind: 'details' })]);
  }

  // Shipping / delivery / payment questions must never enter identity collect.
  if (isStorePolicyInfoRequest(message)) {
    return result([
      action('ask_product_info', message.trim().slice(0, 80), { infoKind: 'details' }),
    ]);
  }

  const awaiting = input.stateSummary.awaitingOrderConfirmation;
  if (awaiting && isBareYesNo(message)) {
    if (customerAffirmsOrder(message)) {
      return result([action('affirm_order', message.trim())]);
    }
    if (customerDeclinesMoreItems(message)) {
      return result([action('deny_order', message.trim())]);
    }
  }

  const identityHit = matchIdentity(input);
  if (identityHit) return identityHit;

  const pendingHit = matchPendingVariant(input);
  if (pendingHit) return pendingHit;

  const cancelHit = matchCancel(input);
  if (cancelHit) return cancelHit;

  const negationHit = matchProductNegation(input);
  if (negationHit) return negationHit;

  return null;
}
