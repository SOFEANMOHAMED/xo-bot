/**
 * Import recent WhatsApp Web chat history into the merchant inbox.
 *
 * Never runs SalesGPT / bot turns — history is display-only.
 * Media is represented as placeholders (no download) to keep link latency bounded.
 * SaaS-safe: every write is scoped by merchant_id.
 */

import type { proto, WAMessage } from '@whiskeysockets/baileys';
import { logger } from '../../utils/logger.js';
import { isPlaceholderCustomerName } from '../socialProfile.js';
import {
  getOrCreateImportedConversation,
  touchImportedConversationTimestamps,
  upsertImportedMessage,
} from '../inbox/importedConversation.js';
import { extractInboundText, unwrapMessageContent } from './media.js';
import { isDirectCustomerJid, normalizeWhatsAppJid } from './jid.js';

const MAX_CHATS = 60;
const MAX_MESSAGES_PER_CHAT = 30;

type HistoryBudget = {
  chats: Set<string>;
  perChat: Map<string, number>;
};

const queues = new Map<string, Promise<void>>();
const budgets = new Map<string, HistoryBudget>();

export function describeWhatsAppHistoryContent(
  content: proto.IMessage | null
): { text: string } | null {
  if (!content) return null;
  const text = extractInboundText(content);
  if (text) return { text };
  if (content.imageMessage || content.stickerMessage) return { text: '📷 صورة' };
  if (content.videoMessage) return { text: '🎬 فيديو' };
  if (content.audioMessage) return { text: '🎤 رسالة صوتية' };
  if (content.documentMessage) return { text: '📎 ملف' };
  return null;
}

export function resetWhatsAppWebHistoryBudget(merchantId: string): void {
  budgets.delete(merchantId);
}

function waTimestampToDate(message: WAMessage): Date {
  const raw = message.messageTimestamp;
  const n = typeof raw === 'number' ? raw : Number(raw || 0);
  if (!Number.isFinite(n) || n <= 0) return new Date();
  return new Date(n > 1e12 ? n : n * 1000);
}

function getBudget(merchantId: string): HistoryBudget {
  let budget = budgets.get(merchantId);
  if (!budget) {
    budget = { chats: new Set(), perChat: new Map() };
    budgets.set(merchantId, budget);
  }
  return budget;
}

function customerDisplayName(pushName: string | null | undefined): string {
  if (isPlaceholderCustomerName(pushName)) return 'عميل واتساب';
  const trimmed = (pushName || '').trim();
  return trimmed || 'عميل واتساب';
}

async function importWhatsAppWebHistoryMessages(
  merchantId: string,
  messages: WAMessage[]
): Promise<void> {
  if (!merchantId || messages.length === 0) return;

  const budget = getBudget(merchantId);
  const perChatNewest = new Map<
    string,
    { conversationId: string; userName: string | null; lastMessageAt: Date | null }
  >();

  for (const message of messages) {
    const remoteJid = normalizeWhatsAppJid(message.key?.remoteJid || undefined);
    if (!isDirectCustomerJid(remoteJid)) continue;

    const messageId = message.key?.id ? String(message.key.id) : '';
    if (!messageId) continue;

    const described = describeWhatsAppHistoryContent(
      unwrapMessageContent(message.message)
    );
    if (!described) continue;

    const isKnownChat = budget.chats.has(remoteJid);
    if (!isKnownChat && budget.chats.size >= MAX_CHATS) continue;

    const chatCount = budget.perChat.get(remoteJid) || 0;
    if (chatCount >= MAX_MESSAGES_PER_CHAT) continue;

    const conversation = await getOrCreateImportedConversation({
      merchantId,
      platform: 'whatsapp',
      userId: remoteJid,
      userName: customerDisplayName(message.pushName),
    });

    const fromMe = message.key?.fromMe === true;
    const createdAt = waTimestampToDate(message);

    const imported = await upsertImportedMessage({
      conversationId: conversation.id,
      externalMessageId: messageId,
      role: fromMe ? 'assistant' : 'user',
      senderType: fromMe ? 'human' : 'user',
      source: 'whatsapp',
      content: described.text,
      createdAt,
      metadata: {
        platform: 'whatsapp',
        origin: 'whatsapp_web_history',
        fromMe,
      },
    });

    if (!imported) continue;

    budget.chats.add(remoteJid);
    budget.perChat.set(remoteJid, chatCount + 1);

    const prev = perChatNewest.get(remoteJid);
    if (!prev || !prev.lastMessageAt || createdAt > prev.lastMessageAt) {
      perChatNewest.set(remoteJid, {
        conversationId: conversation.id,
        userName: conversation.userName,
        lastMessageAt: createdAt,
      });
    }
  }

  for (const row of perChatNewest.values()) {
    await touchImportedConversationTimestamps({
      conversationId: row.conversationId,
      merchantId,
      userName: row.userName,
      lastMessageAt: row.lastMessageAt,
      source: 'whatsapp_web_history',
    });
  }
}

/**
 * Fire-and-forget, serialized per merchant so concurrent Baileys chunks
 * do not race conversation inserts.
 */
export function enqueueWhatsAppWebHistoryImport(
  merchantId: string,
  messages: WAMessage[]
): void {
  if (!merchantId || messages.length === 0) return;

  const prev = queues.get(merchantId) || Promise.resolve();
  const next = prev
    .then(() => importWhatsAppWebHistoryMessages(merchantId, messages))
    .catch((error) => {
      logger.warn('WhatsApp Web history import failed', {
        merchantId,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  queues.set(merchantId, next);
}
