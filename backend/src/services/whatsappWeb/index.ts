export { ensureWhatsAppWebSessionsSchema } from './schema.js';
export {
  startWhatsAppWebPairing,
  disconnectWhatsAppWeb,
  restoreConnectedWhatsAppSessions,
  shutdownWhatsAppWebSessions,
  subscribeWhatsAppPairing,
  getWhatsAppWebLiveStatus
} from './connectionManager.js';
export {
  sendWhatsAppWebText,
  sendWhatsAppWebImage,
  sendWhatsAppWebTyping,
  isWhatsAppWebConnected
} from './outbound.js';
export {
  getWhatsAppWebSession,
  updateWhatsAppWebSettings,
  countWhatsAppWebSessions,
  deleteWhatsAppWebSession
} from './sessionStore.js';
export type { WhatsAppWebPairingEvent, WhatsAppWebStatus } from './types.js';
