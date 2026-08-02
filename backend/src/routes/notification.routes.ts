
import express from 'express';
import {
  getUserNotifications,
  markUserNotificationAsRead,
  markAllUserNotificationsAsRead,
  deleteUserNotification
} from '../controllers/notification.controller.js';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();

// All routes require authentication
router.use(authenticate);

// Get user notifications
router.get('/', getUserNotifications);
router.put('/:id/read', markUserNotificationAsRead);
router.put('/read-all', markAllUserNotificationsAsRead);
router.delete('/:id', deleteUserNotification);

export default router;

