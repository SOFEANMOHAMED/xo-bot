/**
 * Response Module - Customer-facing reply utilities
 */

export {
  detectEscalationMarker,
  stripInternalControlMarkers,
  prepareBotReplyForCustomer,
  type PreparedBotReply
} from './sanitize-reply.js';

export {
  sanitizeCaptionWhenImageSent,
  stripFalseImageDeliveryClaims
} from './image-caption.js';
