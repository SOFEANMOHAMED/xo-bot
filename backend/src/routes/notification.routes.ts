
import express from 'express';
import {
  getUserNotifications,
  markUserNotificationAsRead,
  markAllUserNotificationsAsRead,
  deleteUserNotification
} from '../controllers/notification.controller.js';
import {
  getPushVapidPublicKey,
  getPushStatus,
  subscribePush,
  unsubscribePush,
  sendTestPush,
} from '../controllers/push.controller.js';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();

// All routes require authentication
router.use(authenticate);

// Web Push (PWA) — merchant-scoped
router.get('/push/vapid-public-key', getPushVapidPublicKey);
router.get('/push/status', getPushStatus);
router.post('/push/subscribe', subscribePush);
router.delete('/push/unsubscribe', unsubscribePush);
router.post('/push/test', sendTestPush);

// In-app notifications
router.get('/', getUserNotifications);
router.put('/:id/read', markUserNotificationAsRead);
router.put('/read-all', markAllUserNotificationsAsRead);
router.delete('/:id', deleteUserNotification);

export default router;

