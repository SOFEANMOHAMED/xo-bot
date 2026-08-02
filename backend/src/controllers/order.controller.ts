import { Response, NextFunction } from 'express';
import pool from '../database/connection.js';
import { createError } from '../middleware/errorHandler.js';
import { AuthRequest } from '../middleware/auth.js';
import { z } from 'zod';

const orderItemSchema = z.object({
  productId: z.string().uuid().optional(),
  productName: z.string(),
  quantity: z.number().int().positive(),
  price: z.number().positive(),
  currency: z.string().default('USD')
});

const orderSchema = z.object({
  externalId: z.string().optional(),
  customerName: z.string().min(1),
  customerEmail: z.string().email().optional(),
  customerPhone: z.string().optional(),
  customerAddress: z.string().optional(),
  deliveryTime: z.string().optional(),
  total: z.number().positive(),
  currency: z.string().default('USD'),
  status: z.enum(['pending', 'paid', 'fulfilled', 'cancelled']).default('pending'),
  source: z.enum(['shopify', 'manual']).default('manual'),
  items: z.array(orderItemSchema).min(1),
  notes: z.string().optional()
});

export const getOrders = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const { status, limit = '50', offset = '0' } = req.query;

    // Check if viewed_at column exists
    const columnCheck = await pool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_schema = 'public' 
      AND table_name = 'orders' 
      AND column_name = 'viewed_at'
    `);
    const hasViewedAtColumn = columnCheck.rows.length > 0;
    
    // Check if delivery_time column exists
    const deliveryTimeColumnCheck = await pool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_schema = 'public' 
      AND table_name = 'orders' 
      AND column_name = 'delivery_time'
    `);
    const hasDeliveryTimeColumn = deliveryTimeColumnCheck.rows.length > 0;

    let query = `
      SELECT o.id, o.external_id, o.customer_name, o.customer_email, 
             o.customer_phone, o.customer_address,
             o.total, o.currency, o.status, o.source, o.notes, o.created_at, o.updated_at
    `;
    
    if (hasViewedAtColumn) {
      query += `, o.viewed_at`;
    }
    if (hasDeliveryTimeColumn) {
      query += `, o.delivery_time`;
    }
    
    query += `
      FROM orders o
      WHERE o.merchant_id = $1
    `;
    const params: any[] = [req.merchantId];

    if (status && status !== 'all') {
      query += ` AND o.status = $${params.length + 1}`;
      params.push(status);
    }

    query += ` ORDER BY o.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(parseInt(limit as string), parseInt(offset as string));

    const ordersResult = await pool.query(query, params);

    // Get order items for each order
    const orders = await Promise.all(
      ordersResult.rows.map(async (orderRow) => {
        const itemsResult = await pool.query(
          `SELECT id, product_id, product_name, quantity, price, currency
           FROM order_items
           WHERE order_id = $1`,
          [orderRow.id]
        );

        return {
          id: orderRow.id,
          externalId: orderRow.external_id,
          customerName: orderRow.customer_name,
          customerEmail: orderRow.customer_email,
          customerPhone: orderRow.customer_phone,
          customerAddress: orderRow.customer_address,
          deliveryTime: hasDeliveryTimeColumn ? orderRow.delivery_time : null,
          total: parseFloat(orderRow.total),
          currency: orderRow.currency,
          status: orderRow.status,
          source: orderRow.source,
          notes: orderRow.notes,
          viewedAt: hasViewedAtColumn ? orderRow.viewed_at : null,
          items: itemsResult.rows.map(item => ({
            id: item.id,
            productId: item.product_id,
            productName: item.product_name,
            quantity: item.quantity,
            price: parseFloat(item.price),
            currency: item.currency
          })),
          date: orderRow.created_at,
          createdAt: orderRow.created_at,
          updatedAt: orderRow.updated_at
        };
      })
    );

    res.json({
      success: true,
      data: { orders }
    });
  } catch (error) {
    next(error);
  }
};

export const getOrder = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const { id } = req.params;

    // Check if viewed_at column exists
    const columnCheck = await pool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_schema = 'public' 
      AND table_name = 'orders' 
      AND column_name = 'viewed_at'
    `);
    const hasViewedAtColumn = columnCheck.rows.length > 0;
    
    // Check if delivery_time column exists
    const deliveryTimeColumnCheck = await pool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_schema = 'public' 
      AND table_name = 'orders' 
      AND column_name = 'delivery_time'
    `);
    const hasDeliveryTimeColumn = deliveryTimeColumnCheck.rows.length > 0;

    let query = `
      SELECT id, external_id, customer_name, customer_email, customer_phone,
             customer_address, total, currency, status, source, notes,
             created_at, updated_at
    `;
    
    if (hasViewedAtColumn) {
      query += `, viewed_at`;
    }
    if (hasDeliveryTimeColumn) {
      query += `, delivery_time`;
    }
    
    query += `
       FROM orders
       WHERE id = $1 AND merchant_id = $2
    `;

    const orderResult = await pool.query(query, [id, req.merchantId]);

    if (orderResult.rows.length === 0) {
      return next(createError('Order not found', 404));
    }

    const orderRow = orderResult.rows[0];

    const itemsResult = await pool.query(
      `SELECT id, product_id, product_name, quantity, price, currency
       FROM order_items
       WHERE order_id = $1`,
      [id]
    );

    const order = {
      id: orderRow.id,
      externalId: orderRow.external_id,
      customerName: orderRow.customer_name,
      customerEmail: orderRow.customer_email,
      customerPhone: orderRow.customer_phone,
      customerAddress: orderRow.customer_address,
      deliveryTime: hasDeliveryTimeColumn ? orderRow.delivery_time : null,
      total: parseFloat(orderRow.total),
      currency: orderRow.currency,
      status: orderRow.status,
      source: orderRow.source,
      notes: orderRow.notes,
      viewedAt: hasViewedAtColumn ? orderRow.viewed_at : null,
      items: itemsResult.rows.map(item => ({
        id: item.id,
        productId: item.product_id,
        productName: item.product_name,
        quantity: item.quantity,
        price: parseFloat(item.price),
        currency: item.currency
      })),
      date: orderRow.created_at,
      createdAt: orderRow.created_at,
      updatedAt: orderRow.updated_at
    };

    res.json({
      success: true,
      data: { order }
    });
  } catch (error) {
    next(error);
  }
};

export const createOrder = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const validated = orderSchema.parse(req.body);

    // Start transaction
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Create order
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
            merchant_id, external_id, customer_name, customer_email, 
            customer_phone, customer_address, delivery_time,
            total, currency, status, source, notes
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
          RETURNING id, external_id, customer_name, customer_email, 
                    customer_phone, customer_address, delivery_time,
                    total, currency, status, source, notes, created_at, updated_at`
        : `INSERT INTO orders (
            merchant_id, external_id, customer_name, customer_email, 
            customer_phone, customer_address,
            total, currency, status, source, notes
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
          RETURNING id, external_id, customer_name, customer_email, 
                    customer_phone, customer_address,
                    total, currency, status, source, notes, created_at, updated_at`;

      const orderInsertParams = hasDeliveryTimeColumn
        ? [
            req.merchantId,
            validated.externalId || null,
            validated.customerName,
            validated.customerEmail || null,
            validated.customerPhone || null,
            validated.customerAddress || null,
            validated.deliveryTime || null,
            validated.total,
            validated.currency,
            validated.status,
            validated.source,
            validated.notes || null
          ]
        : [
            req.merchantId,
            validated.externalId || null,
            validated.customerName,
            validated.customerEmail || null,
            validated.customerPhone || null,
            validated.customerAddress || null,
            validated.total,
            validated.currency,
            validated.status,
            validated.source,
            validated.notes || null
          ];

      const orderResult = await client.query(orderInsertQuery, orderInsertParams);

      const orderRow = orderResult.rows[0];

      // Create order items
      const items = [];
      for (const item of validated.items) {
        const itemResult = await client.query(
          `INSERT INTO order_items (
            order_id, product_id, product_name, quantity, price, currency
          ) VALUES ($1, $2, $3, $4, $5, $6)
          RETURNING id, product_id, product_name, quantity, price, currency`,
          [
            orderRow.id,
            item.productId || null,
            item.productName,
            item.quantity,
            item.price,
            item.currency
          ]
        );
        items.push({
          id: itemResult.rows[0].id,
          productId: itemResult.rows[0].product_id,
          productName: itemResult.rows[0].product_name,
          quantity: itemResult.rows[0].quantity,
          price: parseFloat(itemResult.rows[0].price),
          currency: itemResult.rows[0].currency
        });
      }

      await client.query('COMMIT');

      const order = {
        id: orderRow.id,
        externalId: orderRow.external_id,
        customerName: orderRow.customer_name,
        customerEmail: orderRow.customer_email,
        customerPhone: orderRow.customer_phone,
        customerAddress: orderRow.customer_address,
        deliveryTime: hasDeliveryTimeColumn ? orderRow.delivery_time : null,
        total: parseFloat(orderRow.total),
        currency: orderRow.currency,
        status: orderRow.status,
        source: orderRow.source,
        notes: orderRow.notes,
        items,
        date: orderRow.created_at,
        createdAt: orderRow.created_at,
        updatedAt: orderRow.updated_at
      };

      res.status(201).json({
        success: true,
        data: { order }
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return next(createError(error.errors[0].message, 400));
    }
    next(error);
  }
};

export const updateOrderStatus = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!['pending', 'paid', 'fulfilled', 'cancelled'].includes(status)) {
      return next(createError('Invalid status', 400));
    }

    const result = await pool.query(
      `UPDATE orders 
       SET status = $1, updated_at = CURRENT_TIMESTAMP
       WHERE id = $2 AND merchant_id = $3
       RETURNING id, status`,
      [status, id, req.merchantId]
    );

    if (result.rows.length === 0) {
      return next(createError('Order not found', 404));
    }

    res.json({
      success: true,
      data: {
        order: {
          id: result.rows[0].id,
          status: result.rows[0].status
        }
      }
    });
  } catch (error) {
    next(error);
  }
};

export const markOrderAsViewed = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const { id } = req.params;

    // Check if viewed_at column exists
    const columnCheck = await pool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_schema = 'public' 
      AND table_name = 'orders' 
      AND column_name = 'viewed_at'
    `);
    const hasViewedAtColumn = columnCheck.rows.length > 0;

    if (!hasViewedAtColumn) {
      // Column doesn't exist yet, just return success without updating
      // The frontend will still work, but viewed status won't persist until column is added
      return res.json({
        success: true,
        data: {
          order: {
            id,
            viewedAt: null
          }
        }
      });
    }

    const result = await pool.query(
      `UPDATE orders 
       SET viewed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND merchant_id = $2
       RETURNING id, viewed_at`,
      [id, req.merchantId]
    );

    if (result.rows.length === 0) {
      return next(createError('Order not found', 404));
    }

    res.json({
      success: true,
      data: {
        order: {
          id: result.rows[0].id,
          viewedAt: result.rows[0].viewed_at
        }
      }
    });
  } catch (error) {
    next(error);
  }
};

export const deleteOrder = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      'DELETE FROM orders WHERE id = $1 AND merchant_id = $2 RETURNING id',
      [id, req.merchantId]
    );

    if (result.rows.length === 0) {
      return next(createError('Order not found', 404));
    }

    res.json({
      success: true,
      message: 'Order deleted successfully'
    });
  } catch (error) {
    next(error);
  }
};

