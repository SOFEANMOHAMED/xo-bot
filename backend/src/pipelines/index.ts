/**
 * Pipelines Module - Export all pipelines
 */

// ==================== SMART PIPELINE ====================
export {
  processSmartPipeline,
  detectIntent,
  buildContext,
  updateContext
} from './smart-pipeline/index.js';

export type {
  SmartPipelineInput,
  SmartPipelineResult
} from './smart-pipeline/index.js';

export type {
  IntentDetectionResult,
  DetectIntentParams
} from './smart-pipeline/intent-detector.js';

export type {
  ConversationContext,
  ContextUpdateInput
} from './smart-pipeline/context-manager.js';

// ==================== SIMPLE PIPELINE ====================
export {
  processSimplePipeline,
  canHandleSimply,
  handleGreeting,
  isPureGreeting,
  handleConfirmation,
  isSimpleConfirmation,
  isThanks
} from './simple-pipeline/index.js';

export type {
  SimplePipelineInput,
  SimplePipelineResult
} from './simple-pipeline/index.js';
