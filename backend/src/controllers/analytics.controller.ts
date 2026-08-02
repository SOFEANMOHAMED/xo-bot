import { Response, NextFunction } from 'express';
import pool from '../database/connection.js';
import { createError } from '../middleware/errorHandler.js';
import { AuthRequest } from '../middleware/auth.js';

// Get comprehensive analytics dashboard data
export const getAnalyticsDashboard = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const merchantId = req.merchantId || req.userId;
    if (!merchantId) {
      return next(createError('Unauthorized', 401));
    }

    const { period = '30days' } = req.query;
    
    // Calculate date range
    let daysBack = 30;
    if (period === '7days') daysBack = 7;
    else if (period === '30days') daysBack = 30;
    else if (period === '90days') daysBack = 90;
    else if (period === 'year') daysBack = 365;

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - daysBack);

    // Sales Analytics
    const salesResult = await pool.query(
      `SELECT 
        COUNT(*) as total_orders,
        COALESCE(SUM(total), 0) as total_revenue,
        COALESCE(AVG(total), 0) as avg_order_value,
        COUNT(DISTINCT customer_email) as unique_customers
       FROM orders 
       WHERE merchant_id = $1 
       AND created_at >= $2
       AND status IN ('paid', 'fulfilled')`,
      [merchantId, startDate]
    );

    // Orders over time (daily)
    const ordersOverTimeResult = await pool.query(
      `SELECT 
        DATE(created_at) as date,
        COUNT(*) as count,
        COALESCE(SUM(total), 0) as revenue
       FROM orders 
       WHERE merchant_id = $1 
       AND created_at >= $2
       AND status IN ('paid', 'fulfilled')
       GROUP BY DATE(created_at)
       ORDER BY date ASC`,
      [merchantId, startDate]
    );

    // Top selling products
    const topProductsResult = await pool.query(
      `SELECT 
        oi.product_name,
        COUNT(*) as order_count,
        SUM(oi.quantity) as total_quantity,
        SUM(oi.price * oi.quantity) as revenue
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       WHERE o.merchant_id = $1 
       AND o.created_at >= $2
       AND o.status IN ('paid', 'fulfilled')
       GROUP BY oi.product_name
       ORDER BY revenue DESC
       LIMIT 10`,
      [merchantId, startDate]
    );

    // Conversation Analytics
    const conversationResult = await pool.query(
      `SELECT 
        COUNT(DISTINCT c.id) as total_conversations,
        COUNT(m.id) as total_messages,
        COUNT(DISTINCT CASE WHEN m.role = 'user' THEN m.id END) as user_messages,
        COUNT(DISTINCT CASE WHEN m.role = 'assistant' THEN m.id END) as bot_responses
       FROM conversations c
       LEFT JOIN messages m ON m.conversation_id = c.id
       WHERE c.merchant_id = $1 
       AND c.created_at >= $2`,
      [merchantId, startDate]
    );

    // Conversion rate (conversations that led to orders)
    const conversionResult = await pool.query(
      `SELECT 
        COUNT(DISTINCT c.id) as conversations_with_orders
       FROM conversations c
       JOIN orders o ON (
         (o.customer_email = c.user_name OR o.customer_phone = c.user_id)
         AND o.merchant_id = c.merchant_id
         AND o.created_at >= c.created_at
         AND o.created_at <= c.created_at + INTERVAL '24 hours'
       )
       WHERE c.merchant_id = $1 
       AND c.created_at >= $2`,
      [merchantId, startDate]
    );

    const totalConversations = parseInt(conversationResult.rows[0]?.total_conversations || '0');
    const conversationsWithOrders = parseInt(conversionResult.rows[0]?.conversations_with_orders || '0');
    const conversionRate = totalConversations > 0 
      ? (conversationsWithOrders / totalConversations * 100).toFixed(2)
      : '0.00';

    // Customer growth
    const customerGrowthResult = await pool.query(
      `SELECT 
        DATE(created_at) as date,
        COUNT(*) as count
       FROM customers 
       WHERE merchant_id = $1 
       AND created_at >= $2
       GROUP BY DATE(created_at)
       ORDER BY date ASC`,
      [merchantId, startDate]
    );

    // Platform distribution
    const platformResult = await pool.query(
      `SELECT 
        platform,
        COUNT(*) as count
       FROM conversations 
       WHERE merchant_id = $1 
       AND created_at >= $2
       GROUP BY platform
       ORDER BY count DESC`,
      [merchantId, startDate]
    );

    // Most common questions (from user messages)
    const commonQuestionsResult = await pool.query(
      `SELECT 
        m.content,
        COUNT(*) as frequency
       FROM messages m
       JOIN conversations c ON c.id = m.conversation_id
       WHERE c.merchant_id = $1 
       AND m.role = 'user'
       AND m.created_at >= $2
       AND LENGTH(m.content) > 10
       GROUP BY m.content
       ORDER BY frequency DESC
       LIMIT 10`,
      [merchantId, startDate]
    );

    res.json({
      success: true,
      data: {
        period,
        sales: {
          totalOrders: parseInt(salesResult.rows[0]?.total_orders || '0'),
          totalRevenue: parseFloat(salesResult.rows[0]?.total_revenue || '0'),
          avgOrderValue: parseFloat(salesResult.rows[0]?.avg_order_value || '0'),
          uniqueCustomers: parseInt(salesResult.rows[0]?.unique_customers || '0')
        },
        ordersOverTime: ordersOverTimeResult.rows.map(row => ({
          date: row.date,
          count: parseInt(row.count),
          revenue: parseFloat(row.revenue)
        })),
        topProducts: topProductsResult.rows.map(row => ({
          name: row.product_name,
          orderCount: parseInt(row.order_count),
          totalQuantity: parseInt(row.total_quantity),
          revenue: parseFloat(row.revenue)
        })),
        conversations: {
          totalConversations: totalConversations,
          totalMessages: parseInt(conversationResult.rows[0]?.total_messages || '0'),
          userMessages: parseInt(conversationResult.rows[0]?.user_messages || '0'),
          botResponses: parseInt(conversationResult.rows[0]?.bot_responses || '0'),
          conversionRate: parseFloat(conversionRate)
        },
        customerGrowth: customerGrowthResult.rows.map(row => ({
          date: row.date,
          count: parseInt(row.count)
        })),
        platformDistribution: platformResult.rows.map(row => ({
          platform: row.platform,
          count: parseInt(row.count)
        })),
        commonQuestions: commonQuestionsResult.rows.map(row => ({
          question: row.content,
          frequency: parseInt(row.frequency)
        }))
      }
    });
  } catch (error: any) {
    console.error('Error fetching analytics dashboard:', error);
    next(error);
  }
};

// Get sales analytics
export const getSalesAnalytics = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const merchantId = req.merchantId || req.userId;
    if (!merchantId) {
      return next(createError('Unauthorized', 401));
    }

    const { period = '30days', groupBy = 'day' } = req.query;
    
    let daysBack = 30;
    if (period === '7days') daysBack = 7;
    else if (period === '30days') daysBack = 30;
    else if (period === '90days') daysBack = 90;
    else if (period === 'year') daysBack = 365;

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - daysBack);

    let dateGrouping = "DATE(created_at)";
    if (groupBy === 'week') dateGrouping = "DATE_TRUNC('week', created_at)::date";
    else if (groupBy === 'month') dateGrouping = "DATE_TRUNC('month', created_at)::date";

    const salesOverTimeResult = await pool.query(
      `SELECT 
        ${dateGrouping} as period,
        COUNT(*) as order_count,
        COALESCE(SUM(total), 0) as revenue,
        COALESCE(AVG(total), 0) as avg_order_value
       FROM orders 
       WHERE merchant_id = $1 
       AND created_at >= $2
       AND status IN ('paid', 'fulfilled')
       GROUP BY ${dateGrouping}
       ORDER BY period ASC`,
      [merchantId, startDate]
    );

    // Order status breakdown
    const statusBreakdownResult = await pool.query(
      `SELECT 
        status,
        COUNT(*) as count,
        COALESCE(SUM(total), 0) as revenue
       FROM orders 
       WHERE merchant_id = $1 
       AND created_at >= $2
       GROUP BY status`,
      [merchantId, startDate]
    );

    // Revenue by product category
    const categoryRevenueResult = await pool.query(
      `SELECT 
        p.category,
        COUNT(DISTINCT o.id) as order_count,
        COALESCE(SUM(oi.price * oi.quantity), 0) as revenue
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       LEFT JOIN products p ON p.id = oi.product_id
       WHERE o.merchant_id = $1 
       AND o.created_at >= $2
       AND o.status IN ('paid', 'fulfilled')
       GROUP BY p.category
       ORDER BY revenue DESC`,
      [merchantId, startDate]
    );

    res.json({
      success: true,
      data: {
        salesOverTime: salesOverTimeResult.rows.map(row => ({
          period: row.period,
          orderCount: parseInt(row.order_count),
          revenue: parseFloat(row.revenue),
          avgOrderValue: parseFloat(row.avg_order_value)
        })),
        statusBreakdown: statusBreakdownResult.rows.map(row => ({
          status: row.status,
          count: parseInt(row.count),
          revenue: parseFloat(row.revenue)
        })),
        categoryRevenue: categoryRevenueResult.rows.map(row => ({
          category: row.category || 'غير مصنف',
          orderCount: parseInt(row.order_count),
          revenue: parseFloat(row.revenue)
        }))
      }
    });
  } catch (error: any) {
    console.error('Error fetching sales analytics:', error);
    next(error);
  }
};

// Get conversation analytics
export const getConversationAnalytics = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const merchantId = req.merchantId || req.userId;
    if (!merchantId) {
      return next(createError('Unauthorized', 401));
    }

    const { period = '30days' } = req.query;
    
    let daysBack = 30;
    if (period === '7days') daysBack = 7;
    else if (period === '30days') daysBack = 30;
    else if (period === '90days') daysBack = 90;
    else if (period === 'year') daysBack = 365;

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - daysBack);

    // Conversations over time
    const conversationsOverTimeResult = await pool.query(
      `SELECT 
        DATE(created_at) as date,
        COUNT(*) as count
       FROM conversations 
       WHERE merchant_id = $1 
       AND created_at >= $2
       GROUP BY DATE(created_at)
       ORDER BY date ASC`,
      [merchantId, startDate]
    );

    // Average response time
    const responseTimeResult = await pool.query(
      `SELECT 
        AVG(EXTRACT(EPOCH FROM (m2.created_at - m1.created_at))) as avg_response_time
       FROM messages m1
       JOIN messages m2 ON m2.conversation_id = m1.conversation_id 
         AND m2.created_at > m1.created_at
         AND m2.role = 'assistant'
       JOIN conversations c ON c.id = m1.conversation_id
       WHERE c.merchant_id = $1 
       AND m1.role = 'user'
       AND m1.created_at >= $2
       AND m2.created_at <= m1.created_at + INTERVAL '1 hour'`,
      [merchantId, startDate]
    );

    // Peak hours
    const peakHoursResult = await pool.query(
      `SELECT 
        EXTRACT(HOUR FROM messages.created_at) as hour,
        COUNT(*) as count
       FROM messages
       JOIN conversations c ON c.id = messages.conversation_id
       WHERE c.merchant_id = $1 
       AND messages.created_at >= $2
       AND messages.role = 'user'
       GROUP BY EXTRACT(HOUR FROM messages.created_at)
       ORDER BY count DESC
       LIMIT 10`,
      [merchantId, startDate]
    );

    res.json({
      success: true,
      data: {
        conversationsOverTime: conversationsOverTimeResult.rows.map(row => ({
          date: row.date,
          count: parseInt(row.count)
        })),
        avgResponseTime: parseFloat(responseTimeResult.rows[0]?.avg_response_time || '0'),
        peakHours: peakHoursResult.rows.map(row => ({
          hour: parseInt(row.hour),
          count: parseInt(row.count)
        }))
      }
    });
  } catch (error: any) {
    console.error('Error fetching conversation analytics:', error);
    next(error);
  }
};

// Get product performance analytics
export const getProductAnalytics = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const merchantId = req.merchantId || req.userId;
    if (!merchantId) {
      return next(createError('Unauthorized', 401));
    }

    const { period = '30days' } = req.query;
    
    let daysBack = 30;
    if (period === '7days') daysBack = 7;
    else if (period === '30days') daysBack = 30;
    else if (period === '90days') daysBack = 90;
    else if (period === 'year') daysBack = 365;

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - daysBack);

    // Product performance
    const productPerformanceResult = await pool.query(
      `SELECT 
        p.id,
        p.name,
        p.category,
        COUNT(DISTINCT oi.order_id) as order_count,
        SUM(oi.quantity) as total_quantity_sold,
        SUM(oi.price * oi.quantity) as revenue,
        p.stock,
        CASE 
          WHEN COUNT(DISTINCT oi.order_id) > 0 
          THEN (SUM(oi.quantity)::DECIMAL / NULLIF(COUNT(DISTINCT oi.order_id), 0))::DECIMAL(10, 2)
          ELSE 0 
        END as avg_quantity_per_order
       FROM products p
       LEFT JOIN order_items oi ON oi.product_id = p.id
       LEFT JOIN orders o ON o.id = oi.order_id 
         AND o.created_at >= $2
         AND o.status IN ('paid', 'fulfilled')
       WHERE p.merchant_id = $1
       GROUP BY p.id, p.name, p.category, p.stock
       ORDER BY revenue DESC NULLS LAST
       LIMIT 20`,
      [merchantId, startDate]
    );

    // Low stock products
    const lowStockResult = await pool.query(
      `SELECT 
        id,
        name,
        stock,
        category
       FROM products 
       WHERE merchant_id = $1 
       AND stock < 10
       ORDER BY stock ASC
       LIMIT 10`,
      [merchantId]
    );

    res.json({
      success: true,
      data: {
        topProducts: productPerformanceResult.rows.map(row => ({
          id: row.id,
          name: row.name,
          category: row.category,
          orderCount: parseInt(row.order_count || '0'),
          totalQuantitySold: parseInt(row.total_quantity_sold || '0'),
          revenue: parseFloat(row.revenue || '0'),
          stock: parseInt(row.stock || '0'),
          avgQuantityPerOrder: parseFloat(row.avg_quantity_per_order || '0')
        })),
        lowStockProducts: lowStockResult.rows.map(row => ({
          id: row.id,
          name: row.name,
          stock: parseInt(row.stock),
          category: row.category
        }))
      }
    });
  } catch (error: any) {
    console.error('Error fetching product analytics:', error);
    next(error);
  }
};

