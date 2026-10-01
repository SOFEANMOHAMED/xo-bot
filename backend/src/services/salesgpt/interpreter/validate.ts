/**
 * Validate interpreter JSON against the closed contract.
 * Failed evidence / ids / conflicts → drop or reject the group.
 */
import { normalizeArabic } from '../../../catalog/product-search.js';
import { classifyInterimCancelIntent } from '../interimCancelMatchers.js';
import {
  DESTRUCTIVE_ACTION_TYPES,
  INTERPRETER_ACTION_TYPES,
  type InterpreterAction,
  type InterpreterActionType,
  type InterpreterInput,
  type InterpreterResult,
} from './types.js';

const APPLY_MIN = 0.8;
const CLARIFY_MIN = 0.55;
const DESTRUCTIVE_MIN = 0.9;

const IDENTITY_FIELDS = new Set(['name', 'phone', 'address']);
const INFO_KINDS = new Set(['price', 'details', 'availability']);

export type ValidateInterpreterOutcome = {
  ok: boolean;
  result: InterpreterResult;
  reason?: string;
};

function evidenceMatches(message: string, evidence: string): boolean {
  if (!evidence?.trim()) return false;
  const raw = evidence.trim();
  if (message.includes(raw)) return true;
  const nMsg = normalizeArabic(message);
  const nEv = normalizeArabic(raw);
  return nEv.length > 0 && nMsg.includes(nEv);
}

function isKnownType(type: string): type is InterpreterActionType {
  return (INTERPRETER_ACTION_TYPES as readonly string[]).includes(type);
}

function lineById(input: InterpreterInput, lineId: string | undefined) {
  if (!lineId) return undefined;
  return input.cartLines.find((line) => line.lineId === lineId);
}

function productAllowed(input: InterpreterInput, productId: string | undefined): boolean {
  if (!productId) return false;
  return input.allowedProductIds.includes(productId);
}

function hasDocumentedDestructiveEvidence(message: string, evidence: string): boolean {
  if (!evidenceMatches(message, evidence)) return false;
  const kind = classifyInterimCancelIntent(message);
  return kind === 'whole_cancel' || kind === 'partial_remove';
}

function toClarification(action: InterpreterAction): InterpreterAction {
  return {
    type: 'ask_clarification',
    confidence: action.confidence,
    evidence: action.evidence,
    ambiguous: true,
    productId: action.productId,
    lineId: action.lineId,
  };
}

/**
 * Filter and rewrite actions. Conflict cancel×affirm rejects the whole group.
 */
export function validateInterpreterResult(
  raw: InterpreterResult | null | undefined,
  input: InterpreterInput
): ValidateInterpreterOutcome {
  if (!raw || !Array.isArray(raw.actions)) {
    return { ok: false, result: { actions: [], rawModelConfidence: 0 }, reason: 'missing' };
  }

  const types = raw.actions.map((a) => a?.type);
  if (types.includes('cancel_order') && types.includes('affirm_order')) {
    return {
      ok: false,
      result: { actions: [], rawModelConfidence: raw.rawModelConfidence || 0 },
      reason: 'cancel_affirm_conflict',
    };
  }

  const kept: InterpreterAction[] = [];
  let clarificationCount = 0;

  for (const action of raw.actions) {
    if (!action || !isKnownType(action.type)) continue;
    if (action.type === 'noop') continue;
    if (typeof action.confidence !== 'number' || Number.isNaN(action.confidence)) continue;
    if (!evidenceMatches(input.message, action.evidence || '')) continue;

    if (action.productId && !productAllowed(input, action.productId)) continue;
    if (action.lineId && !lineById(input, action.lineId)) continue;

    if (action.color) {
      const line = lineById(input, action.lineId);
      const allowed = line?.allowedColors || [];
      if (allowed.length > 0 && !allowed.includes(action.color)) continue;
    }
    if (action.size) {
      const line = lineById(input, action.lineId);
      const allowed = line?.allowedSizes || [];
      if (allowed.length > 0 && !allowed.includes(action.size)) continue;
    }

    if (action.identityField && !IDENTITY_FIELDS.has(action.identityField)) continue;
    if (action.infoKind && !INFO_KINDS.has(action.infoKind)) continue;

    if (action.type === 'ask_clarification') {
      if (clarificationCount >= 1) continue;
      clarificationCount += 1;
      kept.push(action);
      continue;
    }

    const destructive = (DESTRUCTIVE_ACTION_TYPES as readonly string[]).includes(action.type);
    if (destructive) {
      const strong =
        action.confidence >= DESTRUCTIVE_MIN &&
        hasDocumentedDestructiveEvidence(input.message, action.evidence);
      if (!strong) {
        if (clarificationCount === 0) {
          kept.push(toClarification(action));
          clarificationCount += 1;
        }
        continue;
      }
      kept.push(action);
      continue;
    }

    if (action.confidence >= APPLY_MIN) {
      kept.push(action);
      continue;
    }
    if (action.confidence >= CLARIFY_MIN && clarificationCount === 0) {
      kept.push(toClarification(action));
      clarificationCount += 1;
    }
  }

  return {
    ok: true,
    result: {
      actions: kept,
      rawModelConfidence:
        typeof raw.rawModelConfidence === 'number' ? raw.rawModelConfidence : 0,
    },
  };
}
