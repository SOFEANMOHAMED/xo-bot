/**
 * Shared persistence for bot orders (Messenger / Telegram / Instagram).
 * Mirrors facebook.controller order transaction logic.
 */

import type { Pool } from 'pg';
import type { ConversationState, Entities } from '../core/types.js';
import { logger } from '../utils/logger.js';
import { clearAbandonedCheckoutFromState } from './abandonedCheckout/index.js';
import { notifyMerchantNewOrderAsync } from './notifyMerchantNewOrder.js';

export type ChannelOrderSettings = {
  store_currency: string;
};

export type ChannelOrderLabels = {
  /** When orderData.notes is empty */
  defaultBaseNotes: string;
  customerTags: string[];
  interactionTitle: string;
  interactionDescription: (orderId: string) => string;
  interactionPlatform: string;
  logPrefix: string;
};

/** @deprecated Use ConversationState — kept for backward-compatible imports */
export type MutableOrderConversationSlice = ConversationState;

/**
 * Mutates orderData.products (prices), updates DB, cleans conversation state on success.
 */
export async function persistBotChannelOrder(
  pool: Pool,
  merchantId: string,
  orderData: any,
  settings: ChannelOrderSettings,
  sanitizeUUID: (s: string | null | undefined) => string | null,
  labels: ChannelOrderLabels,
  updatedState: ConversationState
): Promise<boolean> {
  const { logPrefix, defaultBaseNotes, customerTags, interactionTitle, interactionDescription, interactionPlatform } =
    labels;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    for (const product of orderData.products) {
      if (product.productId && (!product.price || product.price === 0)) {
        try {
          const productResult = await client.query(
            `SELECT price, currency, name FROM products 
             WHERE id = $1 AND merchant_id = $2`,
            [product.productId, merchantId]
          );

          if (productResult.rows.length > 0) {
            product.price = parseFloat(productResult.rows[0].price);
            product.currency = productResult.rows[0].currency || settings?.store_currency || 'USD';
            product.productName = productResult.rows[0].name;

            console.log(`[${logPrefix}] Fetched product price from DB:`, {
              productId: product.productId,
              price: product.price,
              productName: product.productName
            });
          }
        } catch (priceError) {
          logger.error(`[${logPrefix}] Error fetching product price`, priceError as Error, {
            productId: product.productId
          });
        }
      }
    }

    orderData.total = orderData.products.reduce(
      (sum: number, item: any) => sum + ((item.price || 0) * (item.quantity || 1)),
      0
    );

    console.log(`[${logPrefix}] Order total calculated:`, {
      total: orderData.total,
      products: orderData.products.map((p: any) => ({
        name: p.productName,
        price: p.price,
        qty: p.quantity
      }))
    });

    const customerEmail =
      orderData.customerEmail?.trim() ||
      `${orderData.customerPhone.replace(/\s+/g, '').replace(/[^0-9]/g, '')}@chat-order.com`;
    const deliveryNote = orderData.deliveryTime ? `وقت التوصيل: ${orderData.deliveryTime}` : null;
    const baseNotes = orderData.notes || defaultBaseNotes;
    const combinedNotes = deliveryNote ? `${baseNotes} | ${deliveryNote}` : baseNotes;

    let customerId: string | null = null;

    const existingCustomer = await client.query(
      `SELECT id FROM customers 
       WHERE merchant_id = $1 
       AND (phone = $2 OR email = $3)
       LIMIT 1`,
      [merchantId, orderData.customerPhone, customerEmail]
    );

    if (existingCustomer.rows.length > 0) {
      customerId = existingCustomer.rows[0].id;

      await client.query(
        `UPDATE customers 
         SET name = COALESCE($1, name),
             email = COALESCE($2, email),
             phone = COALESCE($3, phone),
             address = COALESCE($4, address),
             notes = CASE 
               WHEN $7::text IS NULL OR $7::text = '' THEN notes 
               ELSE COALESCE(notes, '') || ' | ' || $7::text 
             END,
             last_interaction_date = CURRENT_TIMESTAMP,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $5 AND merchant_id = $6`,
        [
          orderData.customerName,
          customerEmail,
          orderData.customerPhone,
          orderData.customerAddress,
          customerId,
          merchantId,
          deliveryNote
        ]
      );

      console.log(`[${logPrefix}] Customer updated in CRM:`, { customerId });
    } else {
      const customerResult = await client.query(
        `INSERT INTO customers (
          merchant_id, name, email, phone, address,
          customer_type, status, notes, tags
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING id`,
        [
          merchantId,
          orderData.customerName,
          customerEmail,
          orderData.customerPhone,
          orderData.customerAddress,
          'new',
          'active',
          combinedNotes,
          customerTags
        ]
      );

      customerId = customerResult.rows[0].id;
      console.log(`[${logPrefix}] New customer created in CRM:`, { customerId });
    }

    const duplicateOrderCheck = await client.query(
      `SELECT id FROM orders 
         WHERE merchant_id = $1 
           AND customer_phone = $2 
           AND status IN ('pending','new','processing')
           AND created_at >= NOW() - INTERVAL '5 minutes'
         ORDER BY created_at DESC
         LIMIT 1`,
      [merchantId, orderData.customerPhone]
    );

    let orderId: string;
    let isDuplicateOrder = false;
    if (duplicateOrderCheck.rows.length > 0) {
      orderId = duplicateOrderCheck.rows[0].id;
      isDuplicateOrder = true;
      console.log(`[${logPrefix}] Duplicate order prevented, using existing order:`, { orderId });
    } else {
      const deliveryTimeColumnCheck = await client.query(`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'orders' 
        AND column_name = 'delivery_time'
      `);
      const hasDeliveryTimeColumn = deliveryTimeColumnCheck.rows.length > 0;

      const orderInsertQuery = hasDeliveryTimeColumn
        ? `INSERT INTO orders (
            merchant_id, customer_name, customer_email, 
            customer_phone, customer_address, delivery_time,
            total, currency, status, source, notes
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
          RETURNING id`
        : `INSERT INTO orders (
            merchant_id, customer_name, customer_email, 
            customer_phone, customer_address,
            total, currency, status, source, notes
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
          RETURNING id`;

      const orderInsertParams = hasDeliveryTimeColumn
        ? [
            merchantId,
            orderData.customerName,
            customerEmail,
            orderData.customerPhone,
            orderData.customerAddress,
            orderData.deliveryTime || null,
            orderData.total || 0,
            settings.store_currency || 'USD',
            'pending',
            'bot',
            combinedNotes
          ]
        : [
            merchantId,
            orderData.customerName,
            customerEmail,
            orderData.customerPhone,
            orderData.customerAddress,
            orderData.total || 0,
            settings.store_currency || 'USD',
            'pending',
            'bot',
            combinedNotes
          ];

      const orderResult = await client.query(orderInsertQuery, orderInsertParams);
      orderId = orderResult.rows[0].id;
    }

    for (const item of orderData.products) {
      const sanitizedProductId = sanitizeUUID(item.productId);

      if (item.productId && !sanitizedProductId) {
        console.warn(`[${logPrefix}] Invalid productId detected and sanitized:`, {
          original: item.productId,
          sanitized: sanitizedProductId,
          productName: item.productName
        });
      }

      if (isDuplicateOrder) {
        const existingItemCheck = await client.query(
          `SELECT id, quantity FROM order_items WHERE order_id = $1 AND (product_id = $2 OR product_name = $3) LIMIT 1`,
          [orderId, sanitizedProductId, item.productName || 'Unknown Product']
        );

        if (existingItemCheck.rows.length > 0) {
          const existingQty = existingItemCheck.rows[0].quantity || 1;
          const newQty = item.quantity || 1;
          if (newQty > existingQty) {
            await client.query(`UPDATE order_items SET quantity = $1 WHERE id = $2`, [
              newQty,
              existingItemCheck.rows[0].id
            ]);
            const priceDiff = (newQty - existingQty) * (item.price || 0);
            await client.query(`UPDATE orders SET total = total + $1 WHERE id = $2`, [priceDiff, orderId]);
            console.log(`[${logPrefix}] Updated quantity for existing item:`, {
              productName: item.productName,
              newQty
            });
          } else {
            console.log(`[${logPrefix}] Item already exists in duplicate order, skipping insertion:`, {
              productName: item.productName
            });
          }
          continue;
        }
      }

      await client.query(
        `INSERT INTO order_items (
          order_id, product_id, product_name, quantity, price, currency
        ) VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          orderId,
          sanitizedProductId,
          item.productName || 'Unknown Product',
          item.quantity || 1,
          item.price || 0,
          settings.store_currency || 'USD'
        ]
      );

      if (isDuplicateOrder) {
        const addedPrice = (item.quantity || 1) * (item.price || 0);
        await client.query(`UPDATE orders SET total = total + $1 WHERE id = $2`, [addedPrice, orderId]);
        console.log(`[${logPrefix}] Added new item to duplicate order, updated total:`, {
          productName: item.productName,
          addedPrice
        });
      }
    }

    await client.query(
      `UPDATE customers 
       SET total_orders = total_orders + ${isDuplicateOrder ? '0' : '1'},
           total_spent = total_spent + $1,
           last_order_date = CURRENT_TIMESTAMP,
           last_interaction_date = CURRENT_TIMESTAMP
       WHERE id = $2 AND merchant_id = $3`,
      [orderData.total || 0, customerId, merchantId]
    );

    await client.query(
      `INSERT INTO customer_interactions (
        customer_id, merchant_id, interaction_type, 
        title, description, platform, related_order_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        customerId,
        merchantId,
        'order',
        interactionTitle,
        interactionDescription(orderId),
        interactionPlatform,
        orderId
      ]
    );

    await client.query('COMMIT');

    console.log(`[${logPrefix}] Order processed successfully:`, {
      orderId,
      customerId,
      total: orderData.total
    });

    logger.info(`[${logPrefix}] order persisted`, {
      merchantId,
      orderId,
      customerId,
      total: orderData.total
    });

    if (!isDuplicateOrder) {
      notifyMerchantNewOrderAsync({
        merchantId,
        orderId,
        customerName: orderData.customerName,
        customerPhone: orderData.customerPhone,
        customerEmail,
        customerAddress: orderData.customerAddress,
        deliveryTime: orderData.deliveryTime || null,
        notes: combinedNotes,
        total: orderData.total || 0,
        currency: settings.store_currency || 'USD',
        source: 'bot',
        items: (orderData.products || []).map((p: any) => ({
          productName: p.productName,
          quantity: p.quantity || 1,
          price: p.price || 0,
        })),
      });
    }

    // 🧹 FULL RESET: After successful order → restart conversation fresh (same as Telegram/Facebook)
    const entities = (updatedState.extracted_entities || {}) as Partial<Entities>;
    const confirmedProductName =
      entities.product_query ||
      orderData.products?.[0]?.productName ||
      'المنتج';
    const confirmedCustomerName = entities.name || '';

    updatedState.last_order = {
      orderId,
      productName: confirmedProductName,
      customerName: confirmedCustomerName,
      confirmedAt: new Date().toISOString()
    };

    updatedState.extracted_entities = {};
    updatedState.last_recommended_products = [];
    updatedState.current_stage = 'discover';
    updatedState.salesgpt_stage_id = '1';
    updatedState.last_intent = 'greeting';
    updatedState.message_count = 0;
    updatedState.awaiting_order_confirmation = false;
    clearAbandonedCheckoutFromState(updatedState);

    console.log(`[${logPrefix}] Full state reset after order. last_order saved:`, {
      orderId,
      productName: confirmedProductName,
      customerName: confirmedCustomerName
    });

    return true;
  } catch (orderError) {
    await client.query('ROLLBACK');

    const errorMessage = (orderError as Error).message || 'Unknown error';
    const isUUIDError = errorMessage.includes('uuid') || errorMessage.includes('invalid input syntax');
    const isDuplicateError = errorMessage.includes('duplicate') || errorMessage.includes('unique');

    console.error(`[${logPrefix}] Error processing order:`, {
      error: errorMessage,
      errorType: isUUIDError ? 'INVALID_UUID' : isDuplicateError ? 'DUPLICATE' : 'UNKNOWN',
      merchantId,
      customerPhone: orderData.customerPhone,
      productsCount: orderData.products?.length || 0
    });

    logger.error(`[${logPrefix}] Error processing order`, orderError as Error, {
      merchantId,
      errorType: isUUIDError ? 'INVALID_UUID' : 'OTHER',
      orderDataSummary: {
        customerName: orderData.customerName,
        customerPhone: orderData.customerPhone,
        productsCount: orderData.products?.length || 0
      }
    });

    return false;
  } finally {
    client.release();
  }
}
