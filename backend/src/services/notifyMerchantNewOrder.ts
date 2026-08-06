/**
 * Notify the owning merchant (tenant) about a newly created order via email.
 * Fire-and-forget safe: never throws to callers.
 */

import pool from '../database/connection.js';
import { logger } from '../utils/logger.js';
import {
  sendNewOrderEmail,
  type NewOrderEmailItem,
  type NewOrderEmailPayload,
} from '../utils/emailService.js';

export type NotifyNewOrderInput = {
  merchantId: string;
  orderId: string;
  customerName?: string | null;
  customerPhone?: string | null;
  customerEmail?: string | null;
  customerAddress?: string | null;
  deliveryTime?: string | null;
  notes?: string | null;
  total: number;
  currency?: string | null;
  source?: string | null;
  items?: Array<{
    productName?: string | null;
    quantity?: number | null;
    price?: number | null;
  }>;
};

/**
 * Load merchant email scoped by merchant_id and send new-order notification.
 * Skips silently if merchant has no email.
 */
export async function notifyMerchantNewOrder(input: NotifyNewOrderInput): Promise<void> {
  const { merchantId, orderId } = input;
  if (!merchantId || !orderId) return;

  try {
    const merchantResult = await pool.query(
      `SELECT email, name
       FROM merchants
       WHERE id = $1
         AND email IS NOT NULL
         AND TRIM(email) <> ''
       LIMIT 1`,
      [merchantId]
    );

    if (merchantResult.rows.length === 0) {
      logger.info('Skipping new-order email: merchant email missing', { merchantId, orderId });
      return;
    }

    const merchant = merchantResult.rows[0] as { email: string; name: string | null };
    const items: NewOrderEmailItem[] = (input.items || []).map((item) => ({
      productName: item.productName || 'منتج',
      quantity: item.quantity || 1,
      price: typeof item.price === 'number' ? item.price : parseFloat(String(item.price || 0)) || 0,
    }));

    // Hide synthetic chat emails from the merchant notification
    const rawEmail = input.customerEmail?.trim() || null;
    const customerEmail =
      rawEmail && !rawEmail.toLowerCase().endsWith('@chat-order.com') ? rawEmail : null;

    const payload: NewOrderEmailPayload = {
      orderId,
      customerName: input.customerName || null,
      customerPhone: input.customerPhone || null,
      customerEmail,
      customerAddress: input.customerAddress || null,
      deliveryTime: input.deliveryTime || null,
      notes: input.notes || null,
      total: typeof input.total === 'number' ? input.total : parseFloat(String(input.total || 0)) || 0,
      currency: input.currency || 'USD',
      source: input.source || null,
      items,
    };

    await sendNewOrderEmail(merchant.email, merchant.name, payload);
  } catch (error) {
    logger.error('notifyMerchantNewOrder failed', error as Error, { merchantId, orderId });
  }
}

/** Non-blocking wrapper for order pipelines */
export function notifyMerchantNewOrderAsync(input: NotifyNewOrderInput): void {
  void notifyMerchantNewOrder(input).catch((err) => {
    logger.error('notifyMerchantNewOrderAsync failed', err as Error, {
      merchantId: input.merchantId,
      orderId: input.orderId,
    });
  });
}
