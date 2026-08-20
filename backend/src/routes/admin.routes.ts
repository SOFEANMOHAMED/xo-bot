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
  searchEmailRecipients,
  sendEmailBroadcast,
  getNotificationRecipientCount,
  sendUserNotification,
  getAdminPlanLimits,
  updateAdminPlanLimits
} from '../controllers/admin.controller.js';
import {
  connectOfficialFacebook,
  getOfficialFacebookStatus,
  getOfficialAvailableFacebookPages,
  linkOfficialFacebookPage,
  disconnectOfficialFacebook,
} from '../controllers/adminOfficialFacebook.controller.js';
import {
  syncOfficialPagePosts,
  getOfficialPagePosts,
  updateOfficialPagePostCommentSettings,
  listOfficialPageKeywordRules,
  createOfficialPageKeywordRule,
  updateOfficialPageKeywordRule,
  deleteOfficialPageKeywordRule,
} from '../controllers/adminOfficialPageComments.controller.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { requireAdminGate } from '../middleware/adminGate.js';
import { enableFullAIMode, disableFullAIMode } from './admin/enable-full-ai.js';

const router = express.Router();

// Public route (no authentication / no admin gate — used by merchant billing UI)
router.get('/subscriptions/public', getPublicSubscriptionPlans);

// Remaining admin routes: obscure gate + JWT + role
router.use(requireAdminGate);
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

// Official XO Bot Facebook page (platform bot — not merchant-scoped)
router.get('/facebook/official/status', getOfficialFacebookStatus);
router.post('/facebook/official/connect', connectOfficialFacebook);
router.get('/facebook/official/available-pages', getOfficialAvailableFacebookPages);
router.post('/facebook/official/link-page', linkOfficialFacebookPage);
router.delete('/facebook/official/disconnect', disconnectOfficialFacebook);

// Official page comment automation (per-post — platform-scoped)
router.post('/facebook/official/posts/sync', syncOfficialPagePosts);
router.get('/facebook/official/posts', getOfficialPagePosts);
router.put('/facebook/official/posts/comment-settings', updateOfficialPagePostCommentSettings);
router.get('/facebook/official/keyword-rules', listOfficialPageKeywordRules);
router.post('/facebook/official/keyword-rules', createOfficialPageKeywordRule);
router.put('/facebook/official/keyword-rules/:ruleId', updateOfficialPageKeywordRule);
router.delete('/facebook/official/keyword-rules/:ruleId', deleteOfficialPageKeywordRule);

// Notifications
router.get('/notifications', getAdminNotifications);
router.put('/notifications/:id/read', markNotificationAsRead);
router.put('/notifications/read-all', markAllNotificationsAsRead);

// Email Broadcast
router.get('/email/recipient-count', getEmailRecipientCount);
router.get('/email/search', searchEmailRecipients);
router.post('/email/broadcast', sendEmailBroadcast);

// User Notifications
router.get('/notifications/recipient-count', getNotificationRecipientCount);
router.post('/notifications/send', sendUserNotification);

// Full AI Mode Toggle
router.post('/full-ai/enable', enableFullAIMode);
router.post('/full-ai/disable', disableFullAIMode);

export default router;
