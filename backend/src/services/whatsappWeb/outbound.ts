import { logger } from '../../utils/logger.js';
import { getMerchantRuntime, rememberSentMessageId } from './runtimeRegistry.js';
import { toOutboundJid } from './jid.js';

function getOpenSocket(merchantId: string) {
  const runtime = getMerchantRuntime(merchantId);
  if (!runtime?.sock || runtime.status !== 'connected') return null;
  return runtime.sock;
}

export async function sendWhatsAppWebText(
  merchantId: string,
  userId: string,
  text: string
): Promise<boolean> {
  const sock = getOpenSocket(merchantId);
  const jid = toOutboundJid(userId);
  const body = (text || '').trim();
  if (!sock || !jid || !body) return false;

  try {
    const sent = await sock.sendMessage(jid, { text: body });
    rememberSentMessageId(merchantId, sent?.key?.id || undefined);
    return true;
  } catch (error) {
    logger.error('WhatsApp Web text send failed', error as Error, { merchantId, jid });
    return false;
  }
}

export async function sendWhatsAppWebImage(
  merchantId: string,
  userId: string,
  imageUrl: string,
  caption = ''
): Promise<boolean> {
  const sock = getOpenSocket(merchantId);
  const jid = toOutboundJid(userId);
  if (!sock || !jid || !imageUrl) return false;

  try {
    const sent = await sock.sendMessage(jid, {
      image: { url: imageUrl },
      caption: (caption || '').substring(0, 1024)
    });
    rememberSentMessageId(merchantId, sent?.key?.id || undefined);
    return true;
  } catch (error) {
    logger.error('WhatsApp Web image send failed', error as Error, { merchantId, jid });
    return false;
  }
}

export async function sendWhatsAppWebTyping(
  merchantId: string,
  userId: string,
  isTyping: boolean
): Promise<void> {
  const sock = getOpenSocket(merchantId);
  const jid = toOutboundJid(userId);
  if (!sock || !jid) return;
  try {
    await sock.sendPresenceUpdate(isTyping ? 'composing' : 'paused', jid);
  } catch (error) {
    logger.debug('WhatsApp Web typing failed', { merchantId, jid });
    void error;
  }
}

export function isWhatsAppWebConnected(merchantId: string): boolean {
  return getMerchantRuntime(merchantId)?.status === 'connected';
}
