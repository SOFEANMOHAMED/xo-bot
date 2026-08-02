import express from 'express';
import {
  getIntegrations,
  connectFacebook,
  disconnectFacebook,
  disconnectFacebookPage,
  updateFacebookCommentSettings,
  getAvailableFacebookPages,
  linkFacebookPages,
  connectShopify,
  disconnectShopify
} from '../controllers/integration.controller.js';
import {
  syncSocialPosts,
  getSocialPosts,
  linkSocialPostProduct,
  updateSocialPostCommentSettings,
  listKeywordRules,
  createKeywordRule,
  updateKeywordRule,
  deleteKeywordRule,
  updateCommentAutomationMode
} from '../controllers/social.controller.js';
import { 
  syncShopifyProducts, 
  syncShopifyOrders, 
  shopifyHealth,
  shopifyCallback,
  getSyncJobStatus,
  getSyncHistory,
  updateShopifySettings,
  getProductDetails,
  pushProductToShopify
} from '../controllers/shopify.controller.js';
import { facebookCallback } from '../controllers/facebook.controller.js';
import {
  connectInstagram,
  instagramCallback,
  instagramDeauthorizeCallback,
  disconnectInstagram,
  updateInstagramSettings
} from '../controllers/instagram.controller.js';
import { 
  connectTelegram, 
  disconnectTelegram, 
  setTelegramWebhook, 
  getTelegramWebhookInfo,
  listTelegramBots,
  createTelegramBot,
  updateTelegramBot,
  deleteTelegramBot
} from '../controllers/telegram.controller.js';
import { authenticate } from '../middleware/auth.js';
import { checkSubscriptionStatus } from '../middleware/subscriptionCheck.js';
import { checkFacebookPagesLimit, checkInstagramAccountsLimit, checkShopifyStoresLimit, checkTelegramBotsLimit } from '../middleware/planLimits.js';

const router = express.Router();

// Public routes (OAuth callbacks)
router.get('/facebook/callback', facebookCallback);
router.get('/instagram/callback', instagramCallback);
router.post('/instagram/deauthorize', instagramDeauthorizeCallback);
router.get('/shopify/callback', shopifyCallback);

// Protected routes
router.use(authenticate);
router.use(checkSubscriptionStatus);

router.get('/', getIntegrations);
router.post('/facebook/connect', checkFacebookPagesLimit, connectFacebook);
router.get('/facebook/available-pages', getAvailableFacebookPages);
router.post('/facebook/link-pages', linkFacebookPages);
router.delete('/facebook/disconnect', disconnectFacebook);
router.delete('/facebook/disconnect/:pageId', disconnectFacebookPage);
router.put('/facebook/comment-settings', updateFacebookCommentSettings);
router.post('/instagram/connect', checkInstagramAccountsLimit, connectInstagram);
router.put('/instagram/settings', updateInstagramSettings);
router.delete('/instagram/disconnect', disconnectInstagram);

// Social posts + keyword rules (FB/IG)
router.post('/social/posts/sync', syncSocialPosts);
router.get('/social/posts', getSocialPosts);
router.put('/social/posts/link-product', linkSocialPostProduct);
router.put('/social/posts/comment-settings', updateSocialPostCommentSettings);
router.get('/social/keyword-rules', listKeywordRules);
router.post('/social/keyword-rules', createKeywordRule);
router.put('/social/keyword-rules/:ruleId', updateKeywordRule);
router.delete('/social/keyword-rules/:ruleId', deleteKeywordRule);
router.put('/social/comment-automation-mode', updateCommentAutomationMode);

router.post('/shopify/connect', checkShopifyStoresLimit, connectShopify);
router.delete('/shopify/disconnect', disconnectShopify);
router.post('/shopify/sync/products', syncShopifyProducts);
router.post('/shopify/sync/orders', syncShopifyOrders);
router.get('/shopify/health', shopifyHealth);
router.put('/shopify/settings', updateShopifySettings);
router.get('/shopify/sync/jobs/:jobId', getSyncJobStatus);
router.get('/shopify/sync/history', getSyncHistory);
router.get('/shopify/products/:productId', getProductDetails);
router.post('/shopify/products/:productId/push', pushProductToShopify);
router.post('/telegram/connect', connectTelegram);
router.delete('/telegram/disconnect', disconnectTelegram);
router.get('/telegram/webhook/info', getTelegramWebhookInfo);
router.post('/telegram/webhook', setTelegramWebhook); // Deprecated, use connect instead

// Multiple Telegram bots API
router.get('/telegram/bots', authenticate, checkSubscriptionStatus, listTelegramBots);
router.post('/telegram/bots', authenticate, checkSubscriptionStatus, checkTelegramBotsLimit, createTelegramBot);
router.put('/telegram/bots/:botId', authenticate, checkSubscriptionStatus, updateTelegramBot);
router.delete('/telegram/bots/:botId', authenticate, checkSubscriptionStatus, deleteTelegramBot);

export default router;

