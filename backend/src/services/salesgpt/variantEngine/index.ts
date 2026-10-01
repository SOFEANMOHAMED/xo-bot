/**
 * Generic variant engine (V1–V5).
 * Size and color asks / bare extract / confirm gates are wired in processWithSalesGPT.
 * orderColorPolicy names stay as wrappers (COLOR_CANONICAL adapter).
 */
export {
  COLOR_AXIS_LABELS,
  RESERVED_AXIS_COLOR,
  RESERVED_AXIS_SIZE,
  SIZE_AXIS_LABELS,
} from './types.js';
export type {
  PendingVariantQuestion,
  VariantAxis,
  VariantAxisId,
  VariantSelection,
} from './types.js';

export {
  axisById,
  colorAxisFromValues,
  effectiveAxes,
  isAxisActive,
  missingAxes,
  selectionFromEntities,
  sizeAxisFromValues,
} from './axes.js';
export { extractBareCatalogAnswer, selectionInCatalog } from './match.js';

export {
  buildAskVariantMessage,
  buildUnavailableVariantMessage,
  isOurVariantAskTemplate,
} from './ask.js';
export { extractBareVariantAnswer } from './extract.js';

export {
  bindPendingVariantQuestion,
  detectPendingAxis,
  pendingFromConversationState,
  pendingToStateFields,
  resolveIncomingPending,
} from './pending.js';

export {
  buildAskWhichAxisMessage,
  isCatalogValueNegated,
  resolveVariantAxisChange,
} from './change.js';
export type { VariantAxisChangeResolution } from './change.js';

export { gateConfirmWhenVariantsInvalid } from './gate.js';
export { setLineVariant } from './line.js';
