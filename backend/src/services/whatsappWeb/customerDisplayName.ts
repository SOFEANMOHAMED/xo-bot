/**
 * Single source of truth for WhatsApp customer labels in the merchant inbox.
 * Prefer pushName; otherwise show the phone from a PN JID.
 */

import pool from '../../database/connection.js';
import { logger } from '../../utils/logger.js';
import { isPlaceholderCustomerName } from '../socialProfile.js';
import { phoneDisplayFromCustomerJid } from './jid.js';

const WHATSAPP_PLACEHOLDER = 'عميل واتساب';

export function resolveWhatsAppCustomerDisplayName(
  pushName: string | null | undefined,
  jid: string | undefined
): string {
  const trimmed = (pushName || '').trim();
  if (trimmed && !isPlaceholderCustomerName(trimmed)) return trimmed;

  const phone = phoneDisplayFromCustomerJid(jid);
  if (phone) return phone;

  return WHATSAPP_PLACEHOLDER;
}

/**
 * When the stored name is a placeholder, derive the phone from user_id and persist.
 */
export async function ensureWhatsAppConversationDisplayName(params: {
  merchantId: string;
  conversationId: string;
  userId: string;
  currentName?: string | null;
}): Promise<string> {
  const current = (params.currentName || '').trim();
  if (!isPlaceholderCustomerName(current)) return current;

  const phone = phoneDisplayFromCustomerJid(params.userId);
  if (!phone) return current || WHATSAPP_PLACEHOLDER;

  try {
    await pool.query(
      `UPDATE conversations
       SET user_name = $1, updated_at = CURRENT_TIMESTAMP
       WHERE id = $2 AND merchant_id = $3`,
      [phone, params.conversationId, params.merchantId]
    );
  } catch (error) {
    logger.warn('Failed to persist WhatsApp display phone', {
      conversationId: params.conversationId,
      error: (error as Error).message,
    });
  }

  return phone;
}
