/**
 * Response Module - Export all response building functions
 */

// Main builder
export {
  buildResponse,
  buildGreetingResponse,
  buildErrorResponse,
  buildThanksResponse,
  buildConfirmationResponse,
  buildClarificationRequest,
  type ResponseBuilderInput,
  type ResponseBuilderResult
} from './response-builder.js';

// Guard
export {
  guardReply,
  type GuardInput,
  type GuardResult
} from './guard.js';

// Customer-facing reply sanitization / escalation markers
export {
  detectEscalationMarker,
  stripInternalControlMarkers,
  prepareBotReplyForCustomer,
  type PreparedBotReply
} from './sanitize-reply.js';

// Templates (if needed externally)
export * as arTemplates from './templates/ar/messages.js';
export * as enTemplates from './templates/en/messages.js';