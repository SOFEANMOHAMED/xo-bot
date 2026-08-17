import type { proto, WAMessage } from '@whiskeysockets/baileys';
import { downloadMediaMessage } from '@whiskeysockets/baileys';
import { logger } from '../../utils/logger.js';
import { persistInboundImageBuffer } from '../inbox/messageMedia.js';

export function unwrapMessageContent(
  message: proto.IMessage | null | undefined
): proto.IMessage | null {
  if (!message) return null;
  return (
    message.ephemeralMessage?.message ||
    message.viewOnceMessage?.message ||
    message.viewOnceMessageV2?.message ||
    message.viewOnceMessageV2Extension?.message ||
    message.documentWithCaptionMessage?.message ||
    message
  );
}

export function extractInboundText(content: proto.IMessage | null): string {
  if (!content) return '';
  return (
    content.conversation ||
    content.extendedTextMessage?.text ||
    content.imageMessage?.caption ||
    content.videoMessage?.caption ||
    content.documentMessage?.caption ||
    content.buttonsResponseMessage?.selectedDisplayText ||
    content.listResponseMessage?.title ||
    ''
  ).trim();
}

export async function downloadInboundMedia(
  message: WAMessage
): Promise<{ buffer: Buffer; mimeType: string } | null> {
  try {
    const buffer = await downloadMediaMessage(message, 'buffer', {});
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) return null;
    const content = unwrapMessageContent(message.message);
    const mimeType =
      content?.imageMessage?.mimetype ||
      content?.audioMessage?.mimetype ||
      content?.videoMessage?.mimetype ||
      content?.stickerMessage?.mimetype ||
      content?.documentMessage?.mimetype ||
      'application/octet-stream';
    return { buffer, mimeType };
  } catch (error) {
    logger.warn('WhatsApp Web media download failed', {
      error: error instanceof Error ? error.message : String(error),
      messageId: message.key?.id
    });
    return null;
  }
}

export async function persistInboundImage(
  merchantId: string,
  message: WAMessage
): Promise<string | null> {
  const media = await downloadInboundMedia(message);
  if (!media) return null;
  return persistInboundImageBuffer({
    merchantId,
    buffer: media.buffer,
    mimeType: media.mimeType,
    source: 'whatsapp'
  });
}

export function inboundHasImage(content: proto.IMessage | null): boolean {
  return Boolean(content?.imageMessage || content?.stickerMessage);
}

export function inboundHasAudio(content: proto.IMessage | null): boolean {
  return Boolean(content?.audioMessage);
}
