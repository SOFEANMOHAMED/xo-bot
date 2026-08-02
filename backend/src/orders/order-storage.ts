/**
 * Order Storage - Save and retrieve orders from database
 * Handles order persistence for SaaS
 */

import pool from '../database/connection.js';
import { logger } from '../utils/logger.js';
import type { OrderData } from '../core/types.js';
import { generateOrderId } from './order-builder.js';

// ==================== TYPES ====================

export interface StoredOrder extends OrderData {
  id: string;
  merchantId: string;
  conversationId?: string;
  status: OrderStatus;
  createdAt: string;
  updatedAt: string;
}

export type OrderStatus = 
  | 'pending'      // Order received, awaiting confirmation
  | 'confirmed'    // Order confirmed by merchant
  | 'processing'   // Order being prepared
  | 'shipped'      // Order shipped
  | 'delivered'    // Order delivered
  | 'cancelled'    // Order cancelled
  | 'returned';    // Order returned

export interface CreateOrderInput {
  merchantId: string;
  conversationId?: string;
  orderData: OrderData;
}

export interface OrderQuery {
  merchantId: string;
  status?: OrderStatus;
  fromDate?: Date;
  toDate?: Date;
  customerPhone?: string;
  limit?: number;
  offset?: number;
}

// ==================== ORDER CREATION ====================

/**
 * Save new order to database
 */
export const createOrder = async (
  input: CreateOrderInput
): Promise<StoredOrder | null> => {
  const { merchantId, conversationId, orderData } = input;
  const orderId = generateOrderId();

  try {
    const result = await pool.query(
      `INSERT INTO orders (
        id, merchant_id, conversation_id, status,
        customer_name, customer_phone, customer_email,
        customer_address, delivery_time, city,
        products, total, notes,
        created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4,
        $5, $6, $7,
        $8, $9, $10,
        $11, $12, $13,
        NOW(), NOW()
      ) RETURNING *`,
      [
        orderId,
        merchantId,
        conversationId || null,
        'pending',
        orderData.customerName,
        orderData.customerPhone,
        orderData.customerEmail || null,
        orderData.customerAddress,
        orderData.deliveryTime || null,
        orderData.city || null,
        JSON.stringify(orderData.products),
        orderData.total,
        orderData.notes || null
      ]
    );

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    logger.info('Order created', { orderId, merchantId });

    return mapRowToOrder(row);
  } catch (error) {
    logger.error('Error creating order', error as Error, { merchantId, orderId });
    return null;
  }
};

// ==================== ORDER RETRIEVAL ====================

/**
 * Get order by ID
 */
export const getOrderById = async (
  merchantId: string,
  orderId: string
): Promise<StoredOrder | null> => {
  try {
    const result = await pool.query(
      `SELECT * FROM orders 
       WHERE id = $1 AND merchant_id = $2`,
      [orderId, merchantId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    return mapRowToOrder(result.rows[0]);
  } catch (error) {
    logger.error('Error getting order', error as Error, { merchantId, orderId });
    return null;
  }
};

/**
 * Get orders by query
 */
export const getOrders = async (
  query: OrderQuery
): Promise<{ orders: StoredOrder[]; total: number }> => {
  const { 
    merchantId, 
    status, 
    fromDate, 
    toDate, 
    customerPhone,
    limit = 20, 
    offset = 0 
  } = query;

  try {
    const conditions: string[] = ['merchant_id = $1'];
    const values: any[] = [merchantId];
    let paramIndex = 2;

    if (status) {
      conditions.push(`status = $${paramIndex}`);
      values.push(status);
      paramIndex++;
    }

    if (fromDate) {
      conditions.push(`created_at >= $${paramIndex}`);
      values.push(fromDate);
      paramIndex++;
    }

    if (toDate) {
      conditions.push(`created_at <= $${paramIndex}`);
      values.push(toDate);
      paramIndex++;
    }

    if (customerPhone) {
      conditions.push(`customer_phone LIKE $${paramIndex}`);
      values.push(`%${customerPhone}%`);
      paramIndex++;
    }

    const whereClause = conditions.join(' AND ');

    // Get total count
    const countResult = await pool.query(
      `SELECT COUNT(*) FROM orders WHERE ${whereClause}`,
      values
    );
    const total = parseInt(countResult.rows[0].count);

    // Get orders
    const ordersResult = await pool.query(
      `SELECT * FROM orders 
       WHERE ${whereClause}
       ORDER BY created_at DESC
       LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      [...values, limit, offset]
    );

    const orders = ordersResult.rows.map(mapRowToOrder);

    return { orders, total };
  } catch (error) {
    logger.error('Error getting orders', error as Error, { merchantId });
    return { orders: [], total: 0 };
  }
};

/**
 * Get recent orders for a customer
 */
export const getCustomerOrders = async (
  merchantId: string,
  customerPhone: string,
  limit: number = 5
): Promise<StoredOrder[]> => {
  try {
    const result = await pool.query(
      `SELECT * FROM orders 
       WHERE merchant_id = $1 AND customer_phone = $2
       ORDER BY created_at DESC
       LIMIT $3`,
      [merchantId, customerPhone, limit]
    );

    return result.rows.map(mapRowToOrder);
  } catch (error) {
    logger.error('Error getting customer orders', error as Error, { 
      merchantId, 
      customerPhone 
    });
    return [];
  }
};

// ==================== ORDER UPDATES ====================

/**
 * Update order status
 */
export const updateOrderStatus = async (
  merchantId: string,
  orderId: string,
  status: OrderStatus
): Promise<boolean> => {
  try {
    const result = await pool.query(
      `UPDATE orders 
       SET status = $3, updated_at = NOW()
       WHERE id = $1 AND merchant_id = $2
       RETURNING id`,
      [orderId, merchantId, status]
    );

    if (result.rowCount === 0) {
      return false;
    }

    logger.info('Order status updated', { orderId, merchantId, status });
    return true;
  } catch (error) {
    logger.error('Error updating order status', error as Error, { 
      merchantId, 
      orderId, 
      status 
    });
    return false;
  }
};

/**
 * Cancel order
 */
export const cancelOrder = async (
  merchantId: string,
  orderId: string,
  reason?: string
): Promise<boolean> => {
  try {
    const result = await pool.query(
      `UPDATE orders 
       SET status = 'cancelled', 
           notes = COALESCE(notes, '') || $3,
           updated_at = NOW()
       WHERE id = $1 AND merchant_id = $2 AND status = 'pending'
       RETURNING id`,
      [orderId, merchantId, reason ? `\nCancellation reason: ${reason}` : '']
    );

    if (result.rowCount === 0) {
      return false;
    }

    logger.info('Order cancelled', { orderId, merchantId, reason });
    return true;
  } catch (error) {
    logger.error('Error cancelling order', error as Error, { merchantId, orderId });
    return false;
  }
};

/**
 * Update order details
 */
export const updateOrder = async (
  merchantId: string,
  orderId: string,
  updates: Partial<OrderData>
): Promise<boolean> => {
  try {
    const setClause: string[] = ['updated_at = NOW()'];
    const values: any[] = [orderId, merchantId];
    let paramIndex = 3;

    if (updates.customerName) {
      setClause.push(`customer_name = $${paramIndex}`);
      values.push(updates.customerName);
      paramIndex++;
    }

    if (updates.customerPhone) {
      setClause.push(`customer_phone = $${paramIndex}`);
      values.push(updates.customerPhone);
      paramIndex++;
    }

    if (updates.customerAddress) {
      setClause.push(`customer_address = $${paramIndex}`);
      values.push(updates.customerAddress);
      paramIndex++;
    }

    if (updates.deliveryTime) {
      setClause.push(`delivery_time = $${paramIndex}`);
      values.push(updates.deliveryTime);
      paramIndex++;
    }

    if (updates.notes) {
      setClause.push(`notes = $${paramIndex}`);
      values.push(updates.notes);
      paramIndex++;
    }

    const result = await pool.query(
      `UPDATE orders 
       SET ${setClause.join(', ')}
       WHERE id = $1 AND merchant_id = $2
       RETURNING id`,
      values
    );

    return (result.rowCount ?? 0) > 0;
  } catch (error) {
    logger.error('Error updating order', error as Error, { merchantId, orderId });
    return false;
  }
};

// ==================== ORDER STATISTICS ====================

/**
 * Get order statistics for merchant
 */
export const getOrderStats = async (
  merchantId: string,
  fromDate?: Date
): Promise<{
  total: number;
  pending: number;
  confirmed: number;
  delivered: number;
  cancelled: number;
  totalRevenue: number;
}> => {
  try {
    const dateCondition = fromDate ? 'AND created_at >= $2' : '';
    const values = fromDate ? [merchantId, fromDate] : [merchantId];

    const result = await pool.query(
      `SELECT 
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status = 'pending') as pending,
        COUNT(*) FILTER (WHERE status = 'confirmed') as confirmed,
        COUNT(*) FILTER (WHERE status = 'delivered') as delivered,
        COUNT(*) FILTER (WHERE status = 'cancelled') as cancelled,
        COALESCE(SUM(total) FILTER (WHERE status NOT IN ('cancelled', 'returned')), 0) as revenue
       FROM orders 
       WHERE merchant_id = $1 ${dateCondition}`,
      values
    );

    const row = result.rows[0];
    return {
      total: parseInt(row.total) || 0,
      pending: parseInt(row.pending) || 0,
      confirmed: parseInt(row.confirmed) || 0,
      delivered: parseInt(row.delivered) || 0,
      cancelled: parseInt(row.cancelled) || 0,
      totalRevenue: parseFloat(row.revenue) || 0
    };
  } catch (error) {
    logger.error('Error getting order stats', error as Error, { merchantId });
    return {
      total: 0,
      pending: 0,
      confirmed: 0,
      delivered: 0,
      cancelled: 0,
      totalRevenue: 0
    };
  }
};

// ==================== HELPERS ====================

/**
 * Map database row to StoredOrder
 */
const mapRowToOrder = (row: any): StoredOrder => ({
  id: row.id,
  merchantId: row.merchant_id,
  conversationId: row.conversation_id,
  status: row.status,
  customerName: row.customer_name,
  customerPhone: row.customer_phone,
  customerEmail: row.customer_email,
  customerAddress: row.customer_address,
  deliveryTime: row.delivery_time,
  city: row.city,
  products: typeof row.products === 'string' ? JSON.parse(row.products) : row.products,
  total: parseFloat(row.total),
  notes: row.notes,
  createdAt: row.created_at?.toISOString(),
  updatedAt: row.updated_at?.toISOString()
});

/**
 * Check if orders table exists, create if not
 */
export const ensureOrdersTable = async (): Promise<void> => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS orders (
        id VARCHAR(50) PRIMARY KEY,
        merchant_id UUID NOT NULL,
        conversation_id UUID,
        status VARCHAR(20) NOT NULL DEFAULT 'pending',
        customer_name VARCHAR(255) NOT NULL,
        customer_phone VARCHAR(50) NOT NULL,
        customer_email VARCHAR(255),
        customer_address TEXT NOT NULL,
        delivery_time VARCHAR(100),
        city VARCHAR(100),
        products JSONB NOT NULL,
        total DECIMAL(12,2) NOT NULL,
        notes TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
      
      CREATE INDEX IF NOT EXISTS idx_orders_merchant ON orders(merchant_id);
      CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
      CREATE INDEX IF NOT EXISTS idx_orders_phone ON orders(customer_phone);
      CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at);
    `);
    
    logger.info('Orders table ensured');
  } catch (error) {
    logger.error('Error ensuring orders table', error as Error);
  }
};
