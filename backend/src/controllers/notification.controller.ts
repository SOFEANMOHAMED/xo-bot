
import { Request, Response, NextFunction } from 'express';
import pool from '../database/connection.js';
import { AuthRequest } from '../middleware/auth.js';

/**
 * Get user notifications
 */
export const getUserNotifications = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const merchantId = req.merchantId || req.userId;
    if (!merchantId) {
      console.error('getUserNotifications: No merchant ID found in request');
      return res.status(401).json({
        success: false,
        error: { message: 'Unauthorized' }
      });
    }

    console.log('getUserNotifications: Fetching notifications for merchant:', merchantId);

    // Ensure user_notifications table exists
    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_notifications (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
        type VARCHAR(50) NOT NULL DEFAULT 'info',
        title VARCHAR(255) NOT NULL,
        message TEXT NOT NULL,
        data JSONB,
        is_read BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        read_at TIMESTAMP
      )
    `);

    const { unreadOnly } = req.query;
    
    let query = `
      SELECT id, type, title, message, data, is_read, created_at, read_at
      FROM user_notifications
      WHERE merchant_id = $1
    `;
    
    const params: any[] = [merchantId];
    
    if (unreadOnly === 'true') {
      query += ` AND is_read = FALSE`;
    }
    
    query += ` ORDER BY created_at DESC LIMIT 100`;
    
    const result = await pool.query(query, params);
    
    console.log(`getUserNotifications: Found ${result.rows.length} notifications for merchant ${merchantId}`);
    
    const notifications = result.rows.map((row) => ({
      id: String(row.id),
      type: row.type,
      title: row.title,
      message: row.message,
      data: row.data || {},
      isRead: row.is_read,
      createdAt: new Date(row.created_at),
      readAt: row.read_at ? new Date(row.read_at) : null
    }));

    res.json({
      success: true,
      data: notifications
    });
  } catch (error: any) {
    console.error('Error fetching user notifications:', error);
    next(error);
  }
};

/**
 * Mark notification as read
 */
export const markUserNotificationAsRead = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const merchantId = req.merchantId || req.userId;
    if (!merchantId) {
      return res.status(401).json({
        success: false,
        error: { message: 'Unauthorized' }
      });
    }

    const { id } = req.params;

    const result = await pool.query(
      `UPDATE user_notifications 
       SET is_read = TRUE, read_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND merchant_id = $2
       RETURNING id`,
      [id, merchantId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: { message: 'Notification not found' }
      });
    }

    res.json({
      success: true,
      message: 'Notification marked as read'
    });
  } catch (error: any) {
    console.error('Error marking notification as read:', error);
    next(error);
  }
};

/**
 * Mark all notifications as read
 */
export const markAllUserNotificationsAsRead = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const merchantId = req.merchantId || req.userId;
    if (!merchantId) {
      return res.status(401).json({
        success: false,
        error: { message: 'Unauthorized' }
      });
    }

    await pool.query(
      `UPDATE user_notifications 
       SET is_read = TRUE, read_at = CURRENT_TIMESTAMP
       WHERE merchant_id = $1 AND is_read = FALSE`,
      [merchantId]
    );

    res.json({
      success: true,
      message: 'All notifications marked as read'
    });
  } catch (error: any) {
    console.error('Error marking all notifications as read:', error);
    next(error);
  }
};

/**
 * Delete user notification
 */
export const deleteUserNotification = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const merchantId = req.merchantId || req.userId;
    if (!merchantId) {
      return res.status(401).json({
        success: false,
        error: { message: 'Unauthorized' }
      });
    }

    const { id } = req.params;

    const result = await pool.query(
      `DELETE FROM user_notifications 
       WHERE id = $1 AND merchant_id = $2
       RETURNING id`,
      [id, merchantId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: { message: 'Notification not found' }
      });
    }

    res.json({
      success: true,
      message: 'Notification deleted successfully'
    });
  } catch (error: any) {
    console.error('Error deleting notification:', error);
    next(error);
  }
};

