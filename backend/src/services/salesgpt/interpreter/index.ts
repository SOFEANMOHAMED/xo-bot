/**
 * Phase 4 interpreter facade.
 * Whitelist always applies. LLM applies only flipped types when mode=flip.
 */
import type { ConversationState, Product } from '../../../core/types.js';
import { logger } from '../../../utils/logger.js';
import { applyInterpreterResult, type InterpreterApplyResult } from './apply.js';
import { interpretCustomerTurn } from './interpret.js';
import { isFlippedType, parseInterpreterMode } from './flip.js';
import type { InterpreterActionType, InterpreterInput, InterpreterMode, InterpreterResult } from './types.js';
import { validateInterpreterResult } from './validate.js';
import { matchWhitelist } from './whitelist.js';

export type { InterpreterApplyResult } from './apply.js';
export { applyInterpreterResult } from './apply.js';
export { buildInterpreterCandidates, buildStateSummary } from './candidates.js';
export { FLIPPED_INTERPRETER_TYPES, isFlippedType, parseInterpreterMode } from './flip.js';
export { groundInterpreterReply } from './ground.js';
export { interpretCustomerTurn } from './interpret.js';
export { nextActionFromInterpreterFacts } from './nextAction.js';
export type { InterpreterNextAction, InterpreterNextActionFacts } from './nextAction.js';
export {
  effectiveNextActionFromTurnFacts,
  type TurnFacts,
} from './turnFacts.js';
export type {
  InterpreterAction,
  InterpreterActionType,
  InterpreterInput,
  InterpreterMode,
  InterpreterResult,
} from './types.js';
export { validateInterpreterResult } from './validate.js';
export {
  isAskingIfBot,
  isExplicitHumanHandoffRequest,
  matchWhitelist,
} from './whitelist.js';

export type InterpreterTurnSource = 'whitelist' | 'llm' | 'none';

export type InterpreterTurnResult = {
  source: InterpreterTurnSource;
  raw: InterpreterResult | null;
  validated: InterpreterResult | null;
  applied: InterpreterApplyResult | null;
  skippedOldTypes: InterpreterActionType[];
};

export function resolveInterpreterMode(): InterpreterMode {
  return parseInterpreterMode(process.env.INTERPRETER_MODE);
}

function filterFlipped(result: InterpreterResult): InterpreterResult {
  return {
    rawModelConfidence: result.rawModelConfidence,
    actions: result.actions.filter((action) => isFlippedType(action.type)),
  };
}

export async function runInterpreterTurn(opts: {
  input: InterpreterInput;
  state: ConversationState;
  productsById: Map<string, Product>;
  storeCurrency?: string;
  mode?: InterpreterMode;
}): Promise<InterpreterTurnResult> {
  const mode = opts.mode ?? resolveInterpreterMode();

  const whitelist = matchWhitelist(opts.input);
  if (whitelist) {
    const validated = validateInterpreterResult(whitelist, opts.input);
    const applied = applyInterpreterResult({
      result: validated.result,
      state: opts.state,
      productsById: opts.productsById,
      storeCurrency: opts.storeCurrency,
    });
    return {
      source: 'whitelist',
      raw: whitelist,
      validated: validated.result,
      applied,
      skippedOldTypes: applied.applied,
    };
  }

  const raw = await interpretCustomerTurn(opts.input);
  if (!raw) {
    return {
      source: 'none',
      raw: null,
      validated: null,
      applied: null,
      skippedOldTypes: [],
    };
  }

  const validated = validateInterpreterResult(raw, opts.input);
  if (mode === 'shadow') {
    logger.info('Interpreter shadow', {
      actions: validated.result.actions.map((a) => a.type),
      ok: validated.ok,
      reason: validated.reason,
    });
    return {
      source: 'llm',
      raw,
      validated: validated.result,
      applied: null,
      skippedOldTypes: [],
    };
  }

  const live = filterFlipped(validated.result);
  if (live.actions.length === 0) {
    return {
      source: 'llm',
      raw,
      validated: validated.result,
      applied: null,
      skippedOldTypes: [],
    };
  }

  const applied = applyInterpreterResult({
    result: live,
    state: opts.state,
    productsById: opts.productsById,
    storeCurrency: opts.storeCurrency,
  });
  return {
    source: 'llm',
    raw,
    validated: validated.result,
    applied,
    skippedOldTypes: applied.applied,
  };
}
