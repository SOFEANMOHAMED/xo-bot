/**
 * Channel Adapters
 * Export all channel adapters
 */

export { ChannelAdapter, ParsedIncomingEvent, SendMessageParams, TypingIndicatorParams } from './channel.interface.js';
export { FacebookAdapter, facebookAdapter, sendFacebookTyping, sendFacebookMessage, sendFacebookImage } from './facebook.adapter.js';
export { TelegramAdapter, telegramAdapter, sendTelegramTyping, sendTelegramMessage, sendTelegramPhoto } from './telegram.adapter.js';
export {
  deliverHumanLikeReply,
  splitReplyIntoBubbles,
  computeTypingDelayMs,
  computeInterBubbleDelayMs,
  sleep,
  startTypingKeepalive,
  type OutboundTransport,
  type DeliverHumanLikeReplyParams,
  type DeliverHumanLikeReplyResult
} from './replyDelivery.js';

import { facebookAdapter } from './facebook.adapter.js';
import { telegramAdapter } from './telegram.adapter.js';

/**
 * Get adapter for a platform
 */
export const getAdapter = (platform: 'facebook' | 'telegram' | 'web' | 'whatsapp') => {
  switch (platform) {
    case 'facebook':
      return facebookAdapter;
    case 'telegram':
      return telegramAdapter;
    default:
      throw new Error(`No adapter available for platform: ${platform}`);
  }
};
