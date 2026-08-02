import { Response, NextFunction } from 'express';
import pool from '../database/connection.js';
import { createError } from '../middleware/errorHandler.js';
import { AuthRequest } from '../middleware/auth.js';
import { z } from 'zod';

// Validation schemas
const createCustomerSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  email: z.string().email().optional().or(z.literal('')),
  phone: z.string().optional(),
  address: z.string().optional(),
  city: z.string().optional(),
  country: z.string().optional(),
  customerType: z.enum(['regular', 'vip', 'wholesale', 'new']).default('regular'),
  status: z.enum(['active', 'inactive', 'blocked']).default('active'),
  notes: z.string().optional(),
  tags: z.array(z.string()).optional(),
  metadata: z.record(z.any()).optional()
});

const updateCustomerSchema = createCustomerSchema.partial();

const createInteractionSchema = z.object({
  customerId: z.string().uuid(),
  interactionType: z.enum(['message', 'call', 'email', 'order', 'complaint', 'review', 'note']),
  title: z.string().optional(),
  description: z.string().optional(),
  platform: z.string().optional(),
  relatedOrderId: z.string().uuid().optional(),
  relatedConversationId: z.string().uuid().optional()
});

// Get all customers with filters
export const getCustomers = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const merchantId = req.merchantId || req.userId;
    if (!merchantId) {
      return next(createError('Unauthorized', 401));
    }

    const {
      search,
      customerType,
      status,
      tags,
      page = '1',
      limit = '20',
      sortBy = 'last_order_date',
      sortOrder = 'desc'
    } = req.query;

    const offset = (parseInt(page as string) - 1) * parseInt(limit as string);
    const validSortBy = ['name', 'total_spent', 'total_orders', 'last_order_date', 'created_at'];
    const validSortOrder = ['asc', 'desc'];
    const sortByStr = Array.isArray(sortBy) ? sortBy[0] : sortBy;
    const sortOrderStr = Array.isArray(sortOrder) ? sortOrder[0] : sortOrder;
    let sortColumn = validSortBy.includes(sortByStr as string) ? sortByStr : 'last_order_date';
    const order = validSortOrder.includes(sortOrderStr as string) ? sortOrderStr : 'desc';

    // Map sort column to actual column name or aggregate function
    // For aggregate functions, we must use the full expression in ORDER BY when using GROUP BY
    const sortColumnMap: Record<string, string> = {
      'name': 'c.name',
      'total_spent': 'COALESCE(SUM(o.total), 0)',
      'total_orders': 'COUNT(DISTINCT o.id)',
      'last_order_date': 'MAX(o.created_at)',
      'created_at': 'c.created_at'
    };
    const actualSortColumn = sortColumnMap[sortColumn as string] || 'MAX(o.created_at)';

    let query = `
      SELECT 
        c.*,
        COUNT(DISTINCT o.id)::int as total_orders,
        COALESCE(SUM(o.total), 0)::decimal as total_spent,
        MAX(o.created_at) as last_order_date
      FROM customers c
      LEFT JOIN orders o ON o.customer_email = c.email AND o.merchant_id = c.merchant_id
      WHERE c.merchant_id = $1
    `;
    const queryParams: any[] = [merchantId];
    let paramIndex = 2;

    if (search) {
      query += ` AND (
        c.name ILIKE $${paramIndex} OR 
        c.email ILIKE $${paramIndex} OR 
        c.phone ILIKE $${paramIndex}
      )`;
      queryParams.push(`%${search}%`);
      paramIndex++;
    }

    if (customerType) {
      query += ` AND c.customer_type = $${paramIndex}`;
      queryParams.push(customerType);
      paramIndex++;
    }

    if (status) {
      query += ` AND c.status = $${paramIndex}`;
      queryParams.push(status);
      paramIndex++;
    }

    if (tags && Array.isArray(tags) && tags.length > 0) {
      query += ` AND c.tags && $${paramIndex}::text[]`;
      queryParams.push(tags);
      paramIndex++;
    }

    query += ` GROUP BY c.id ORDER BY ${actualSortColumn} ${order} NULLS LAST LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    queryParams.push(parseInt(limit as string), offset);

    const result = await pool.query(query, queryParams);

    // Get total count for pagination
    let countQuery = 'SELECT COUNT(*) FROM customers WHERE merchant_id = $1';
    const countParams: any[] = [merchantId];
    let countParamIndex = 2;

    if (search) {
      countQuery += ` AND (name ILIKE $${countParamIndex} OR email ILIKE $${countParamIndex} OR phone ILIKE $${countParamIndex})`;
      countParams.push(`%${search}%`);
      countParamIndex++;
    }

    if (customerType) {
      countQuery += ` AND customer_type = $${countParamIndex}`;
      countParams.push(customerType);
      countParamIndex++;
    }

    if (status) {
      countQuery += ` AND status = $${countParamIndex}`;
      countParams.push(status);
      countParamIndex++;
    }

    if (tags && Array.isArray(tags) && tags.length > 0) {
      countQuery += ` AND tags && $${countParamIndex}::text[]`;
      countParams.push(tags);
      countParamIndex++;
    }

    const countResult = await pool.query(countQuery, countParams);
    const total = parseInt(countResult.rows[0].count);

    res.json({
      success: true,
      data: {
        customers: result.rows.map(row => ({
          id: row.id,
          name: row.name,
          email: row.email,
          phone: row.phone,
          address: row.address,
          city: row.city,
          country: row.country,
          customerType: row.customer_type,
          status: row.status,
          totalOrders: parseInt(String(row.total_orders || '0')) || 0,
          totalSpent: parseFloat(String(row.total_spent || '0')) || 0,
          lastOrderDate: row.last_order_date || null,
          lastInteractionDate: row.last_interaction_date,
          notes: row.notes,
          tags: row.tags || [],
          metadata: row.metadata || {},
          createdAt: row.created_at,
          updatedAt: row.updated_at
        })),
        pagination: {
          page: parseInt(page as string),
          limit: parseInt(limit as string),
          total,
          totalPages: Math.ceil(total / parseInt(limit as string))
        }
      }
    });
  } catch (error: any) {
    console.error('Error fetching customers:', error);
    next(error);
  }
};

// Get single customer with details
export const getCustomer = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const merchantId = req.merchantId || req.userId;
    if (!merchantId) {
      return next(createError('Unauthorized', 401));
    }

    const { id } = req.params;

    // Get customer
    const customerResult = await pool.query(
      `SELECT * FROM customers WHERE id = $1 AND merchant_id = $2`,
      [id, merchantId]
    );

    if (customerResult.rows.length === 0) {
      return next(createError('Customer not found', 404));
    }

    const customer = customerResult.rows[0];

    // Get customer orders
    const ordersResult = await pool.query(
      `SELECT id, total, currency, status, created_at 
       FROM orders 
       WHERE merchant_id = $1 AND (customer_email = $2 OR customer_phone = $3)
       ORDER BY created_at DESC
       LIMIT 10`,
      [merchantId, customer.email || '', customer.phone || '']
    );

    // Get customer interactions
    const interactionsResult = await pool.query(
      `SELECT * FROM customer_interactions 
       WHERE customer_id = $1 
       ORDER BY created_at DESC
       LIMIT 20`,
      [id]
    );

    // Get customer conversations
    const conversationsResult = await pool.query(
      `SELECT c.*, COUNT(m.id) as message_count
       FROM conversations c
       LEFT JOIN messages m ON m.conversation_id = c.id
       WHERE c.merchant_id = $1 
       AND (c.user_name ILIKE $2 OR c.user_id = $3)
       GROUP BY c.id
       ORDER BY c.last_message_at DESC
       LIMIT 10`,
      [merchantId, `%${customer.name}%`, customer.phone || '']
    );

    res.json({
      success: true,
      data: {
        customer: {
          id: customer.id,
          name: customer.name,
          email: customer.email,
          phone: customer.phone,
          address: customer.address,
          city: customer.city,
          country: customer.country,
          customerType: customer.customer_type,
          status: customer.status,
          totalOrders: customer.total_orders || 0,
          totalSpent: parseFloat(customer.total_spent) || 0,
          lastOrderDate: customer.last_order_date,
          lastInteractionDate: customer.last_interaction_date,
          notes: customer.notes,
          tags: customer.tags || [],
          metadata: customer.metadata || {},
          createdAt: customer.created_at,
          updatedAt: customer.updated_at
        },
        orders: ordersResult.rows,
        interactions: interactionsResult.rows.map(row => ({
          id: row.id,
          interactionType: row.interaction_type,
          title: row.title,
          description: row.description,
          platform: row.platform,
          relatedOrderId: row.related_order_id,
          relatedConversationId: row.related_conversation_id,
          createdAt: row.created_at
        })),
        conversations: conversationsResult.rows
      }
    });
  } catch (error: any) {
    console.error('Error fetching customer:', error);
    next(error);
  }
};

// Create new customer
export const createCustomer = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const merchantId = req.merchantId || req.userId;
    if (!merchantId) {
      return next(createError('Unauthorized', 401));
    }

    const validated = createCustomerSchema.parse(req.body);

    // Check if customer with same email already exists
    if (validated.email && validated.email.trim() !== '') {
      const existing = await pool.query(
        `SELECT id FROM customers WHERE merchant_id = $1 AND email = $2`,
        [merchantId, validated.email]
      );
      if (existing.rows.length > 0) {
        return next(createError('Customer with this email already exists', 400));
      }
    }

    const result = await pool.query(
      `INSERT INTO customers (
        merchant_id, name, email, phone, address, city, country,
        customer_type, status, notes, tags, metadata
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING *`,
      [
        merchantId,
        validated.name,
        validated.email || null,
        validated.phone || null,
        validated.address || null,
        validated.city || null,
        validated.country || null,
        validated.customerType || 'regular',
        validated.status || 'active',
        validated.notes || null,
        validated.tags || [],
        validated.metadata ? JSON.stringify(validated.metadata) : null
      ]
    );

    const customer = result.rows[0];

    res.status(201).json({
      success: true,
      data: {
        id: customer.id,
        name: customer.name,
        email: customer.email,
        phone: customer.phone,
        address: customer.address,
        city: customer.city,
        country: customer.country,
        customerType: customer.customer_type,
        status: customer.status,
        totalOrders: customer.total_orders || 0,
        totalSpent: parseFloat(customer.total_spent) || 0,
        lastOrderDate: customer.last_order_date,
        lastInteractionDate: customer.last_interaction_date,
        notes: customer.notes,
        tags: customer.tags || [],
        metadata: customer.metadata || {},
        createdAt: customer.created_at,
        updatedAt: customer.updated_at
      }
    });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return next(createError(error.errors[0].message, 400));
    }
    console.error('Error creating customer:', error);
    next(error);
  }
};

// Update customer
export const updateCustomer = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const merchantId = req.merchantId || req.userId;
    if (!merchantId) {
      return next(createError('Unauthorized', 401));
    }

    const { id } = req.params;
    const validated = updateCustomerSchema.parse(req.body);

    // Check if customer exists
    const existing = await pool.query(
      `SELECT id FROM customers WHERE id = $1 AND merchant_id = $2`,
      [id, merchantId]
    );

    if (existing.rows.length === 0) {
      return next(createError('Customer not found', 404));
    }

    // Check email uniqueness if email is being updated
    if (validated.email && validated.email.trim() !== '') {
      const emailCheck = await pool.query(
        `SELECT id FROM customers WHERE merchant_id = $1 AND email = $2 AND id != $3`,
        [merchantId, validated.email, id]
      );
      if (emailCheck.rows.length > 0) {
        return next(createError('Customer with this email already exists', 400));
      }
    }

    // Build update query dynamically
    const updateFields: string[] = [];
    const updateValues: any[] = [];
    let paramIndex = 1;

    if (validated.name !== undefined) {
      updateFields.push(`name = $${paramIndex++}`);
      updateValues.push(validated.name);
    }
    if (validated.email !== undefined) {
      updateFields.push(`email = $${paramIndex++}`);
      updateValues.push(validated.email || null);
    }
    if (validated.phone !== undefined) {
      updateFields.push(`phone = $${paramIndex++}`);
      updateValues.push(validated.phone || null);
    }
    if (validated.address !== undefined) {
      updateFields.push(`address = $${paramIndex++}`);
      updateValues.push(validated.address || null);
    }
    if (validated.city !== undefined) {
      updateFields.push(`city = $${paramIndex++}`);
      updateValues.push(validated.city || null);
    }
    if (validated.country !== undefined) {
      updateFields.push(`country = $${paramIndex++}`);
      updateValues.push(validated.country || null);
    }
    if (validated.customerType !== undefined) {
      updateFields.push(`customer_type = $${paramIndex++}`);
      updateValues.push(validated.customerType);
    }
    if (validated.status !== undefined) {
      updateFields.push(`status = $${paramIndex++}`);
      updateValues.push(validated.status);
    }
    if (validated.notes !== undefined) {
      updateFields.push(`notes = $${paramIndex++}`);
      updateValues.push(validated.notes || null);
    }
    if (validated.tags !== undefined) {
      updateFields.push(`tags = $${paramIndex++}`);
      updateValues.push(validated.tags);
    }
    if (validated.metadata !== undefined) {
      updateFields.push(`metadata = $${paramIndex++}`);
      updateValues.push(JSON.stringify(validated.metadata));
    }

    if (updateFields.length === 0) {
      return next(createError('No fields to update', 400));
    }

    updateFields.push(`updated_at = CURRENT_TIMESTAMP`);
    updateValues.push(id, merchantId);

    const result = await pool.query(
      `UPDATE customers SET ${updateFields.join(', ')} 
       WHERE id = $${paramIndex} AND merchant_id = $${paramIndex + 1}
       RETURNING *`,
      updateValues
    );

    const customer = result.rows[0];

    res.json({
      success: true,
      data: {
        id: customer.id,
        name: customer.name,
        email: customer.email,
        phone: customer.phone,
        address: customer.address,
        city: customer.city,
        country: customer.country,
        customerType: customer.customer_type,
        status: customer.status,
        totalOrders: customer.total_orders || 0,
        totalSpent: parseFloat(customer.total_spent) || 0,
        lastOrderDate: customer.last_order_date,
        lastInteractionDate: customer.last_interaction_date,
        notes: customer.notes,
        tags: customer.tags || [],
        metadata: customer.metadata || {},
        createdAt: customer.created_at,
        updatedAt: customer.updated_at
      }
    });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return next(createError(error.errors[0].message, 400));
    }
    console.error('Error updating customer:', error);
    next(error);
  }
};

// Delete customer
export const deleteCustomer = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const merchantId = req.merchantId || req.userId;
    if (!merchantId) {
      return next(createError('Unauthorized', 401));
    }

    const { id } = req.params;

    const result = await pool.query(
      `DELETE FROM customers WHERE id = $1 AND merchant_id = $2 RETURNING id`,
      [id, merchantId]
    );

    if (result.rows.length === 0) {
      return next(createError('Customer not found', 404));
    }

    res.json({
      success: true,
      message: 'Customer deleted successfully'
    });
  } catch (error: any) {
    console.error('Error deleting customer:', error);
    next(error);
  }
};

// Create interaction
export const createInteraction = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const merchantId = req.merchantId || req.userId;
    if (!merchantId) {
      return next(createError('Unauthorized', 401));
    }

    const validated = createInteractionSchema.parse(req.body);

    // Verify customer belongs to merchant
    const customerCheck = await pool.query(
      `SELECT id FROM customers WHERE id = $1 AND merchant_id = $2`,
      [validated.customerId, merchantId]
    );

    if (customerCheck.rows.length === 0) {
      return next(createError('Customer not found', 404));
    }

    const result = await pool.query(
      `INSERT INTO customer_interactions (
        customer_id, merchant_id, interaction_type, title, description,
        platform, related_order_id, related_conversation_id, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *`,
      [
        validated.customerId,
        merchantId,
        validated.interactionType,
        validated.title || null,
        validated.description || null,
        validated.platform || null,
        validated.relatedOrderId || null,
        validated.relatedConversationId || null,
        merchantId
      ]
    );

    // Update customer's last interaction date
    await pool.query(
      `UPDATE customers SET last_interaction_date = CURRENT_TIMESTAMP WHERE id = $1`,
      [validated.customerId]
    );

    res.status(201).json({
      success: true,
      data: {
        id: result.rows[0].id,
        customerId: result.rows[0].customer_id,
        interactionType: result.rows[0].interaction_type,
        title: result.rows[0].title,
        description: result.rows[0].description,
        platform: result.rows[0].platform,
        relatedOrderId: result.rows[0].related_order_id,
        relatedConversationId: result.rows[0].related_conversation_id,
        createdAt: result.rows[0].created_at
      }
    });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return next(createError(error.errors[0].message, 400));
    }
    console.error('Error creating interaction:', error);
    next(error);
  }
};

// Get CRM stats
export const getCrmStats = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const merchantId = req.merchantId || req.userId;
    if (!merchantId) {
      return next(createError('Unauthorized', 401));
    }

    // Total customers
    const totalResult = await pool.query(
      `SELECT COUNT(*) as count FROM customers WHERE merchant_id = $1`,
      [merchantId]
    );
    const totalCustomers = parseInt(totalResult.rows[0].count);

    // Active customers
    const activeResult = await pool.query(
      `SELECT COUNT(*) as count FROM customers WHERE merchant_id = $1 AND status = 'active'`,
      [merchantId]
    );
    const activeCustomers = parseInt(activeResult.rows[0].count);

    // VIP customers
    const vipResult = await pool.query(
      `SELECT COUNT(*) as count FROM customers WHERE merchant_id = $1 AND customer_type = 'vip'`,
      [merchantId]
    );
    const vipCustomers = parseInt(vipResult.rows[0].count);

    // New customers this month
    const newCustomersResult = await pool.query(
      `SELECT COUNT(*) as count FROM customers 
       WHERE merchant_id = $1 AND created_at >= DATE_TRUNC('month', CURRENT_DATE)`,
      [merchantId]
    );
    const newCustomersThisMonth = parseInt(newCustomersResult.rows[0].count);

    // Total revenue
    const revenueResult = await pool.query(
      `SELECT COALESCE(SUM(total), 0) as total FROM orders 
       WHERE merchant_id = $1 AND status IN ('paid', 'fulfilled')`,
      [merchantId]
    );
    const totalRevenue = parseFloat(revenueResult.rows[0].total);

    // Average order value
    const avgOrderResult = await pool.query(
      `SELECT COALESCE(AVG(total), 0) as avg FROM orders 
       WHERE merchant_id = $1 AND status IN ('paid', 'fulfilled')`,
      [merchantId]
    );
    const averageOrderValue = parseFloat(avgOrderResult.rows[0].avg);

    res.json({
      success: true,
      data: {
        totalCustomers,
        activeCustomers,
        vipCustomers,
        newCustomersThisMonth,
        totalRevenue,
        averageOrderValue
      }
    });
  } catch (error: any) {
    console.error('Error fetching CRM stats:', error);
    next(error);
  }
};

