import express from 'express';
import {
  getAdminStats,
  getAdminSubscriptionPlans,
  getPublicSubscriptionPlans,
  updateAdminSubscriptionPlan,
  getAdminUsageStats,
  getAdminChartData,
  getAdminAffiliateStats,
  getAdminUsers,
  getAdminUser,
  createAdminUser,
  updateAdminUser,
  deleteAdminUser,
  getSystemLogs,
  getGlobalSettings,
  updateGlobalSettings,
  getAdminNotifications,
  markNotificationAsRead,
  markAllNotificationsAsRead,
  getEmailRecipientCount,
  sendEmailBroadcast,
  getNotificationRecipientCount,
  sendUserNotification,
  getAdminPlanLimits,
  updateAdminPlanLimits
} from '../controllers/admin.controller.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { enableFullAIMode, disableFullAIMode } from './admin/enable-full-ai.js';

const router = express.Router();

// Public route (no authentication required)
router.get('/subscriptions/public', getPublicSubscriptionPlans);

// All admin routes require authentication and owner/admin role
router.use(authenticate);
router.use(requireRole('owner', 'admin'));

// Stats
router.get('/stats', getAdminStats);
router.get('/subscriptions', getAdminSubscriptionPlans);
router.put('/subscriptions/:planKey', updateAdminSubscriptionPlan);
router.get('/subscriptions/limits', getAdminPlanLimits);
router.put('/subscriptions/:planKey/limits', updateAdminPlanLimits);
router.get('/usage', getAdminUsageStats);
router.get('/charts', getAdminChartData);
router.get('/affiliates', getAdminAffiliateStats);

// Users management
router.get('/users', getAdminUsers);
router.post('/users', createAdminUser);
router.get('/users/:id', getAdminUser);
router.put('/users/:id', updateAdminUser);
router.delete('/users/:id', deleteAdminUser);

// System
router.get('/logs', getSystemLogs);
router.get('/settings', getGlobalSettings);
router.put('/settings', updateGlobalSettings);

// Notifications
router.get('/notifications', getAdminNotifications);
router.put('/notifications/:id/read', markNotificationAsRead);
router.put('/notifications/read-all', markAllNotificationsAsRead);

// Email Broadcast
router.get('/email/recipient-count', getEmailRecipientCount);
router.post('/email/broadcast', sendEmailBroadcast);

// User Notifications
router.get('/notifications/recipient-count', getNotificationRecipientCount);
router.post('/notifications/send', sendUserNotification);

// Full AI Mode Toggle
router.post('/full-ai/enable', enableFullAIMode);
router.post('/full-ai/disable', disableFullAIMode);

export default router;

