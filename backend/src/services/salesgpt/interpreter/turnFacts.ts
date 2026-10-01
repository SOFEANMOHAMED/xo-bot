/**
 * TurnFacts — single post-interpreter / post-policy snapshot for next_action ownership.
 */
import type { InterpreterActionType } from './types.js';
import {
  nextActionFromInterpreterFacts,
  type InterpreterNextAction,
  type InterpreterNextActionFacts,
} from './nextAction.js';

export type TurnFacts = InterpreterNextActionFacts & {
  /** I4 already decided confirm_order this turn (fast-path or policy). */
  finalizedOrder: boolean;
};

/**
 * effectiveNextAction: confirm (I4) wins; else interpreter facts; else null (keep agent/policy).
 */
export function effectiveNextActionFromTurnFacts(
  facts: TurnFacts,
  currentNextAction: string
): string {
  if (facts.finalizedOrder || currentNextAction === 'confirm_order') {
    return 'confirm_order';
  }
  const fromFacts: InterpreterNextAction = nextActionFromInterpreterFacts(facts);
  if (fromFacts) return fromFacts;
  return currentNextAction;
}

export type { InterpreterActionType };
