import { Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth.js';
import { createError } from '../middleware/errorHandler.js';
import pool from '../database/connection.js';
import { logger } from '../utils/logger.js';

/**
 * Create a new support ticket
 */
export const createSupportTicket = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const merchantId = req.merchantId || req.userId;
    if (!merchantId) {
      return next(createError('Unauthorized', 401));
    }

    const { subject, message, priority = 'medium' } = req.body;

    if (!subject || !message) {
      return next(createError('Subject and message are required', 400));
    }

    if (subject.length > 255) {
      return next(createError('Subject is too long (max 255 characters)', 400));
    }

    if (message.length > 5000) {
      return next(createError('Message is too long (max 5000 characters)', 400));
    }

    const validPriorities = ['low', 'medium', 'high', 'urgent'];
    if (!validPriorities.includes(priority)) {
      return next(createError('Invalid priority', 400));
    }

    const result = await pool.query(
      `INSERT INTO support_tickets (merchant_id, subject, message, priority, status)
       VALUES ($1, $2, $3, $4, 'open')
       RETURNING id, merchant_id, subject, message, status, priority, created_at`,
      [merchantId, subject.trim(), message.trim(), priority]
    );

    const ticket = result.rows[0];

    logger.info('Support ticket created', {
      ticketId: ticket.id,
      merchantId,
      subject: ticket.subject
    });

    res.status(201).json({
      success: true,
      data: {
        ticket: {
          id: ticket.id,
          subject: ticket.subject,
          message: ticket.message,
          status: ticket.status,
          priority: ticket.priority,
          createdAt: ticket.created_at
        }
      }
    });
  } catch (error) {
    logger.error('Error creating support ticket', error as Error, {
      merchantId: req.merchantId
    });
    next(error);
  }
};

/**
 * Get user's support tickets with replies
 */
export const getUserSupportTickets = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const merchantId = req.merchantId || req.userId;
    if (!merchantId) {
      return next(createError('Unauthorized', 401));
    }

    const result = await pool.query(
      `SELECT 
        id, 
        subject, 
        message, 
        status, 
        priority, 
        admin_response,
        resolved_at,
        created_at,
        updated_at
       FROM support_tickets
       WHERE merchant_id = $1
       ORDER BY created_at DESC`,
      [merchantId]
    );

    // Get replies for each ticket
    const ticketsWithReplies = await Promise.all(
      result.rows.map(async (ticket) => {
        const repliesResult = await pool.query(
          `SELECT 
            r.id,
            r.message,
            r.sender_type,
            r.sender_id,
            r.attachments,
            r.created_at,
            m.name as sender_name,
            m.email as sender_email
           FROM support_ticket_replies r
           LEFT JOIN merchants m ON r.sender_id = m.id
           WHERE r.ticket_id = $1
           ORDER BY r.created_at ASC`,
          [ticket.id]
        );

        return {
          id: ticket.id,
          subject: ticket.subject,
          message: ticket.message,
          status: ticket.status,
          priority: ticket.priority,
          adminResponse: ticket.admin_response,
          resolvedAt: ticket.resolved_at,
          createdAt: ticket.created_at,
          updatedAt: ticket.updated_at,
          replies: repliesResult.rows.map(reply => ({
            id: reply.id,
            message: reply.message,
            senderType: reply.sender_type,
            senderId: reply.sender_id,
            senderName: reply.sender_name,
            senderEmail: reply.sender_email,
            attachments: typeof reply.attachments === 'string' ? JSON.parse(reply.attachments) : (reply.attachments || []),
            createdAt: reply.created_at
          }))
        };
      })
    );

    res.json({
      success: true,
      data: {
        tickets: ticketsWithReplies
      }
    });
  } catch (error) {
    logger.error('Error getting user support tickets', error as Error, {
      merchantId: req.merchantId
    });
    next(error);
  }
};

/**
 * Get all support tickets (Admin only)
 */
export const getAllSupportTickets = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const { status, priority, page = 1, limit = 20 } = req.query;
    const offset = (Number(page) - 1) * Number(limit);

    let query = `
      SELECT 
        t.id,
        t.subject,
        t.message,
        t.status,
        t.priority,
        t.admin_response,
        t.resolved_at,
        t.created_at,
        t.updated_at,
        m.id as merchant_id,
        m.email as merchant_email,
        m.name as merchant_name,
        a.id as admin_id,
        a.name as admin_name
      FROM support_tickets t
      LEFT JOIN merchants m ON t.merchant_id = m.id
      LEFT JOIN merchants a ON t.admin_id = a.id
      WHERE 1=1
    `;
    const params: any[] = [];
    let paramCount = 1;

    if (status) {
      query += ` AND t.status = $${paramCount++}`;
      params.push(status);
    }

    if (priority) {
      query += ` AND t.priority = $${paramCount++}`;
      params.push(priority);
    }

    query += ` ORDER BY t.created_at DESC LIMIT $${paramCount++} OFFSET $${paramCount++}`;
    params.push(Number(limit), offset);

    const result = await pool.query(query, params);

    // Get replies for each ticket
    const ticketsWithReplies = await Promise.all(
      result.rows.map(async (ticket) => {
        const repliesResult = await pool.query(
          `SELECT 
            r.id,
            r.message,
            r.sender_type,
            r.sender_id,
            r.attachments,
            r.created_at,
            m.name as sender_name,
            m.email as sender_email
           FROM support_ticket_replies r
           LEFT JOIN merchants m ON r.sender_id = m.id
           WHERE r.ticket_id = $1
           ORDER BY r.created_at ASC`,
          [ticket.id]
        );

        return {
          id: ticket.id,
          subject: ticket.subject,
          message: ticket.message,
          status: ticket.status,
          priority: ticket.priority,
          adminResponse: ticket.admin_response,
          resolvedAt: ticket.resolved_at,
          createdAt: ticket.created_at,
          updatedAt: ticket.updated_at,
          merchant: {
            id: ticket.merchant_id,
            email: ticket.merchant_email,
            name: ticket.merchant_name
          },
          admin: ticket.admin_id ? {
            id: ticket.admin_id,
            name: ticket.admin_name
          } : null,
          replies: repliesResult.rows.map(reply => ({
            id: reply.id,
            message: reply.message,
            senderType: reply.sender_type,
            senderId: reply.sender_id,
            senderName: reply.sender_name,
            senderEmail: reply.sender_email,
            attachments: typeof reply.attachments === 'string' ? JSON.parse(reply.attachments) : (reply.attachments || []),
            createdAt: reply.created_at
          }))
        };
      })
    );

    // Get total count
    let countQuery = 'SELECT COUNT(*) as total FROM support_tickets WHERE 1=1';
    const countParams: any[] = [];
    let countParamCount = 1;

    if (status) {
      countQuery += ` AND status = $${countParamCount++}`;
      countParams.push(status);
    }

    if (priority) {
      countQuery += ` AND priority = $${countParamCount++}`;
      countParams.push(priority);
    }

    const countResult = await pool.query(countQuery, countParams);
    const total = parseInt(countResult.rows[0].total);

    res.json({
      success: true,
      data: {
        tickets: ticketsWithReplies,
        pagination: {
          page: Number(page),
          limit: Number(limit),
          total,
          totalPages: Math.ceil(total / Number(limit))
        }
      }
    });
  } catch (error) {
    logger.error('Error getting all support tickets', error as Error);
    next(error);
  }
};

/**
 * Get support ticket by ID
 */
export const getSupportTicket = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const { id } = req.params;
    const merchantId = req.merchantId || req.userId;
    const userRole = req.userRole;

    const result = await pool.query(
      `SELECT 
        t.id,
        t.subject,
        t.message,
        t.status,
        t.priority,
        t.admin_response,
        t.resolved_at,
        t.created_at,
        t.updated_at,
        m.id as merchant_id,
        m.email as merchant_email,
        m.name as merchant_name,
        a.id as admin_id,
        a.name as admin_name
      FROM support_tickets t
      LEFT JOIN merchants m ON t.merchant_id = m.id
      LEFT JOIN merchants a ON t.admin_id = a.id
      WHERE t.id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return next(createError('Support ticket not found', 404));
    }

    const ticket = result.rows[0];

    // Check if user has access (owner or admin can see all, user can only see their own)
    if (userRole !== 'owner' && userRole !== 'admin' && ticket.merchant_id !== merchantId) {
      return next(createError('Unauthorized', 403));
    }

    // Get replies
    const repliesResult = await pool.query(
      `SELECT 
        r.id,
        r.message,
        r.sender_type,
        r.sender_id,
        r.attachments,
        r.created_at,
        m.name as sender_name,
        m.email as sender_email
       FROM support_ticket_replies r
       LEFT JOIN merchants m ON r.sender_id = m.id
       WHERE r.ticket_id = $1
       ORDER BY r.created_at ASC`,
      [id]
    );

    res.json({
      success: true,
      data: {
        ticket: {
          id: ticket.id,
          subject: ticket.subject,
          message: ticket.message,
          status: ticket.status,
          priority: ticket.priority,
          adminResponse: ticket.admin_response,
          resolvedAt: ticket.resolved_at,
          createdAt: ticket.created_at,
          updatedAt: ticket.updated_at,
          merchant: {
            id: ticket.merchant_id,
            email: ticket.merchant_email,
            name: ticket.merchant_name
          },
          admin: ticket.admin_id ? {
            id: ticket.admin_id,
            name: ticket.admin_name
          } : null,
          replies: repliesResult.rows.map(reply => ({
            id: reply.id,
            message: reply.message,
            senderType: reply.sender_type,
            senderId: reply.sender_id,
            senderName: reply.sender_name,
            senderEmail: reply.sender_email,
            attachments: typeof reply.attachments === 'string' ? JSON.parse(reply.attachments) : (reply.attachments || []),
            createdAt: reply.created_at
          }))
        }
      }
    });
  } catch (error) {
    logger.error('Error getting support ticket', error as Error);
    next(error);
  }
};

/**
 * Update support ticket (Admin only - respond or change status)
 */
export const updateSupportTicket = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const { id } = req.params;
    const adminId = req.merchantId || req.userId;
    const { status, adminResponse, priority } = req.body;

    // Check if ticket exists
    const ticketResult = await pool.query(
      'SELECT id, status FROM support_tickets WHERE id = $1',
      [id]
    );

    if (ticketResult.rows.length === 0) {
      return next(createError('Support ticket not found', 404));
    }

    const updateFields: string[] = [];
    const values: any[] = [];
    let paramCount = 1;

    if (status) {
      const validStatuses = ['open', 'in_progress', 'resolved', 'closed'];
      if (!validStatuses.includes(status)) {
        return next(createError('Invalid status', 400));
      }
      updateFields.push(`status = $${paramCount++}`);
      values.push(status);

      if (status === 'resolved' || status === 'closed') {
        updateFields.push(`resolved_at = $${paramCount++}`);
        values.push(new Date());
      }
    }

    if (adminResponse !== undefined) {
      if (adminResponse.length > 5000) {
        return next(createError('Admin response is too long (max 5000 characters)', 400));
      }
      updateFields.push(`admin_response = $${paramCount++}`);
      values.push(adminResponse.trim());
      updateFields.push(`admin_id = $${paramCount++}`);
      values.push(adminId);
    }

    if (priority) {
      const validPriorities = ['low', 'medium', 'high', 'urgent'];
      if (!validPriorities.includes(priority)) {
        return next(createError('Invalid priority', 400));
      }
      updateFields.push(`priority = $${paramCount++}`);
      values.push(priority);
    }

    if (updateFields.length === 0) {
      return next(createError('No fields to update', 400));
    }

    updateFields.push(`updated_at = $${paramCount++}`);
    values.push(new Date());

    values.push(id);

    const updateQuery = `
      UPDATE support_tickets
      SET ${updateFields.join(', ')}
      WHERE id = $${paramCount}
      RETURNING id, subject, message, status, priority, admin_response, resolved_at, created_at, updated_at
    `;

    const result = await pool.query(updateQuery, values);

    logger.info('Support ticket updated', {
      ticketId: id,
      adminId,
      updates: { status, adminResponse: adminResponse ? 'provided' : null, priority }
    });

    res.json({
      success: true,
      data: {
        ticket: result.rows[0]
      }
    });
  } catch (error) {
    logger.error('Error updating support ticket', error as Error);
    next(error);
  }
};

/**
 * Add reply to support ticket (User or Admin)
 */
export const addSupportTicketReply = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const { ticketId } = req.params;
    const senderId = req.merchantId || req.userId;
    const userRole = req.userRole;
    
    if (!senderId) {
      return next(createError('Unauthorized', 401));
    }

    const { message, attachments } = req.body;

    // Message is optional if there are attachments
    if ((!message || !message.trim()) && (!attachments || attachments.length === 0)) {
      return next(createError('Message or attachments are required', 400));
    }

    if (message && message.length > 5000) {
      return next(createError('Message is too long (max 5000 characters)', 400));
    }

    // Validate attachments format
    if (attachments && !Array.isArray(attachments)) {
      return next(createError('Attachments must be an array', 400));
    }

    if (attachments && attachments.length > 10) {
      return next(createError('Maximum 10 attachments allowed', 400));
    }

    // Check if ticket exists and user has access
    const ticketResult = await pool.query(
      `SELECT id, merchant_id, status FROM support_tickets WHERE id = $1`,
      [ticketId]
    );

    if (ticketResult.rows.length === 0) {
      return next(createError('Support ticket not found', 404));
    }

    const ticket = ticketResult.rows[0];

    // Check access: user can only reply to their own tickets, admin can reply to any
    if (userRole !== 'owner' && userRole !== 'admin' && ticket.merchant_id !== senderId) {
      return next(createError('Unauthorized', 403));
    }

    // Determine sender type
    const senderType = (userRole === 'owner' || userRole === 'admin') ? 'admin' : 'user';

    // Add reply with attachments
    const attachmentsJson = attachments ? JSON.stringify(attachments) : JSON.stringify([]);
    const replyResult = await pool.query(
      `INSERT INTO support_ticket_replies (ticket_id, sender_id, sender_type, message, attachments)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, ticket_id, sender_id, sender_type, message, attachments, created_at`,
      [ticketId, senderId, senderType, message ? message.trim() : '', attachmentsJson]
    );

    // Update ticket status if it was closed/resolved and user is replying
    if (senderType === 'user' && (ticket.status === 'closed' || ticket.status === 'resolved')) {
      await pool.query(
        `UPDATE support_tickets SET status = 'open', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
        [ticketId]
      );
    } else if (senderType === 'admin') {
      // If admin replies, set status to in_progress if it was open
      if (ticket.status === 'open') {
        await pool.query(
          `UPDATE support_tickets SET status = 'in_progress', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
          [ticketId]
        );
      }
    }

    logger.info('Support ticket reply added', {
      ticketId,
      senderId,
      senderType
    });

    res.status(201).json({
      success: true,
      data: {
        reply: {
          id: replyResult.rows[0].id,
          ticketId: replyResult.rows[0].ticket_id,
          message: replyResult.rows[0].message,
          senderType: replyResult.rows[0].sender_type,
          attachments: typeof replyResult.rows[0].attachments === 'string' ? JSON.parse(replyResult.rows[0].attachments) : (replyResult.rows[0].attachments || []),
          createdAt: replyResult.rows[0].created_at
        }
      }
    });
  } catch (error) {
    logger.error('Error adding support ticket reply', error as Error);
    next(error);
  }
};

/**
 * Get support tickets statistics (Admin only)
 */
export const getSupportTicketsStats = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const result = await pool.query(
      `SELECT 
        COUNT(*) FILTER (WHERE status = 'open') as open_count,
        COUNT(*) FILTER (WHERE status = 'in_progress') as in_progress_count,
        COUNT(*) FILTER (WHERE status = 'resolved') as resolved_count,
        COUNT(*) FILTER (WHERE status = 'closed') as closed_count,
        COUNT(*) FILTER (WHERE priority = 'urgent') as urgent_count,
        COUNT(*) FILTER (WHERE priority = 'high') as high_count,
        COUNT(*) as total_count,
        COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '24 hours') as last_24h_count
      FROM support_tickets`
    );

    const stats = result.rows[0];

    res.json({
      success: true,
      data: {
        stats: {
          open: parseInt(stats.open_count),
          inProgress: parseInt(stats.in_progress_count),
          resolved: parseInt(stats.resolved_count),
          closed: parseInt(stats.closed_count),
          urgent: parseInt(stats.urgent_count),
          high: parseInt(stats.high_count),
          total: parseInt(stats.total_count),
          last24h: parseInt(stats.last_24h_count)
        }
      }
    });
  } catch (error) {
    logger.error('Error getting support tickets stats', error as Error);
    next(error);
  }
};

