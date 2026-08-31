import express from 'express';
import {
  getAdminStats,
  getAdminSubscriptionPlans,
  getPublicSubscriptionPlans,
  updateAdminSubscriptionPlan,
  getAdminUsageStats,
  getAdminChartData,
  getAdminAffiliateStats,
  getAdminAcquisitionStatsHandler,
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
import {
  listOfficialInboxConversations,
  getOfficialInboxConversation,
  sendOfficialInboxHumanMessage,
  disableOfficialInboxBot,
  enableOfficialInboxBot,
  markOfficialInboxRead,
  getOfficialInboxUnreadCount,
  streamOfficialInboxEvents,
} from '../controllers/adminOfficialInbox.controller.js';
import {
  getAdminPushVapidPublicKey,
  getAdminPushStatus,
  subscribeAdminPush,
  unsubscribeAdminPush,
  sendAdminTestPush,
} from '../controllers/adminPush.controller.js';
import {
  listOfficialContentAccounts,
  listOfficialContentPublications,
  getOfficialContentPublication,
  createOfficialContentPublication,
  updateOfficialContentPublication,
  deleteOfficialContentPublication,
  publishOfficialContentPublicationNow,
  scheduleOfficialContentPublication,
  cancelOfficialContentPublication,
} from '../controllers/adminOfficialContent.controller.js';
import {
  getAdminOtpStatus,
  startAdminOtpWhatsAppPairing,
  streamAdminOtpWhatsAppEvents,
  disconnectAdminOtpWhatsApp,
  updateAdminOtpSettings
} from '../controllers/adminOtp.controller.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { requireAdminGate } from '../middleware/adminGate.js';

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
router.get('/acquisition', getAdminAcquisitionStatsHandler);

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

// Signup OTP via platform WhatsApp
router.get('/otp/status', getAdminOtpStatus);
router.post('/otp/whatsapp/pair', startAdminOtpWhatsAppPairing);
router.get('/otp/whatsapp/events', streamAdminOtpWhatsAppEvents);
router.post('/otp/whatsapp/disconnect', disconnectAdminOtpWhatsApp);
router.put('/otp/settings', updateAdminOtpSettings);

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

// Official page Messenger inbox (platform-scoped — not merchant conversations)
router.get('/facebook/official/inbox/stream', streamOfficialInboxEvents);
router.get('/facebook/official/inbox/unread-count', getOfficialInboxUnreadCount);
router.get('/facebook/official/conversations', listOfficialInboxConversations);
router.get('/facebook/official/conversations/:id', getOfficialInboxConversation);
router.post(
  '/facebook/official/conversations/:id/send-human-message',
  sendOfficialInboxHumanMessage
);
router.put('/facebook/official/conversations/:id/disable-bot', disableOfficialInboxBot);
router.put('/facebook/official/conversations/:id/enable-bot', enableOfficialInboxBot);
router.post('/facebook/official/conversations/:id/mark-read', markOfficialInboxRead);

// Official page content publishing & scheduling (platform-scoped)
router.get('/facebook/official/content/accounts', listOfficialContentAccounts);
router.get('/facebook/official/content/publications', listOfficialContentPublications);
router.post('/facebook/official/content/publications', createOfficialContentPublication);
router.get('/facebook/official/content/publications/:id', getOfficialContentPublication);
router.put('/facebook/official/content/publications/:id', updateOfficialContentPublication);
router.delete('/facebook/official/content/publications/:id', deleteOfficialContentPublication);
router.post('/facebook/official/content/publications/:id/publish', publishOfficialContentPublicationNow);
router.post('/facebook/official/content/publications/:id/schedule', scheduleOfficialContentPublication);
router.post('/facebook/official/content/publications/:id/cancel', cancelOfficialContentPublication);

// Notifications
router.get('/notifications', getAdminNotifications);
router.put('/notifications/:id/read', markNotificationAsRead);
router.put('/notifications/read-all', markAllNotificationsAsRead);

// Super Admin Web Push (mobile / PWA)
router.get('/notifications/push/vapid-public-key', getAdminPushVapidPublicKey);
router.get('/notifications/push/status', getAdminPushStatus);
router.post('/notifications/push/subscribe', subscribeAdminPush);
router.delete('/notifications/push/unsubscribe', unsubscribeAdminPush);
router.post('/notifications/push/test', sendAdminTestPush);

// Email Broadcast
router.get('/email/recipient-count', getEmailRecipientCount);
router.get('/email/search', searchEmailRecipients);
router.post('/email/broadcast', sendEmailBroadcast);

// User Notifications
router.get('/notifications/recipient-count', getNotificationRecipientCount);
router.post('/notifications/send', sendUserNotification);

export default router;
