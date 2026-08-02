/**
 * Channel Adapters
 * Export all channel adapters
 */

export { ChannelAdapter, ParsedIncomingEvent, SendMessageParams } from './channel.interface.js';
export { FacebookAdapter, facebookAdapter } from './facebook.adapter.js';
export { TelegramAdapter, telegramAdapter } from './telegram.adapter.js';

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

