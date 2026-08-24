/**
 * Single write path for SalesGPT conversation stage fields.
 *
 * `salesgpt_stage_id` (1–9) is the source of truth.
 * `current_stage` and DB `conversations.stage` are always derived from it on write.
 */

import type { ConversationState, Stage } from '../../core/types.js';
import { mapStageIdToStage } from './stages.js';

export const FRESH_CONVERSATION_STAGE_ID = '1';
export const HANDOFF_STAGE_ID = '9';

export function normalizeSalesGPTStageId(stageId?: string | null): string | undefined {
  const trimmed = stageId?.trim();
  if (trimmed && /^[1-9]$/.test(trimmed)) return trimmed;
  return undefined;
}

/** Read path: derive legacy Stage from persisted numeric stage. */
export function deriveStageFromSalesGPTStageId(stageId?: string | null): Stage {
  const normalized = normalizeSalesGPTStageId(stageId);
  return (normalized ? mapStageIdToStage(normalized) : 'discover') as Stage;
}

/**
 * Write path: set `salesgpt_stage_id` and derive `current_stage`.
 * Never assign `current_stage` without updating `salesgpt_stage_id`.
 */
export function applySalesGPTStage(state: ConversationState, stageId: string): ConversationState {
  const normalized = normalizeSalesGPTStageId(stageId) || FRESH_CONVERSATION_STAGE_ID;
  state.salesgpt_stage_id = normalized;
  state.current_stage = deriveStageFromSalesGPTStageId(normalized);
  return state;
}

/** Value for `conversations.stage` column — derived from numeric stage when present. */
export function conversationStageForDb(state: ConversationState): Stage {
  // Escalation exception: applyHandoffStage sets current_stage without remapping stage 9.
  if (state.current_stage === 'handoff') return 'handoff';
  const fromId = normalizeSalesGPTStageId(state.salesgpt_stage_id);
  if (fromId) return deriveStageFromSalesGPTStageId(fromId);
  return (state.current_stage || 'discover') as Stage;
}

/** Post-order full reset → stage 1 / discover. */
export function applyFreshConversationStage(state: ConversationState): ConversationState {
  return applySalesGPTStage(state, FRESH_CONVERSATION_STAGE_ID);
}

/**
 * Human handoff — stage 9 + explicit handoff label for inbox/filters.
 * Exception: escalation is not a SalesGPT turn; both fields set together.
 */
export function applyHandoffStage(state: ConversationState): ConversationState {
  state.salesgpt_stage_id = HANDOFF_STAGE_ID;
  state.current_stage = 'handoff';
  return state;
}
