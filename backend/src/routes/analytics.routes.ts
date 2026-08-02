import express from 'express';
import {
  getAnalyticsDashboard,
  getSalesAnalytics,
  getConversationAnalytics,
  getProductAnalytics
} from '../controllers/analytics.controller.js';
import { authenticate } from '../middleware/auth.js';
import { checkSubscriptionStatus } from '../middleware/subscriptionCheck.js';
import { checkAdvancedAnalytics } from '../middleware/planLimits.js';

const router = express.Router();

router.use(authenticate);
router.use(checkSubscriptionStatus);

router.get('/dashboard', checkAdvancedAnalytics, getAnalyticsDashboard);
router.get('/sales', checkAdvancedAnalytics, getSalesAnalytics);
router.get('/conversations', checkAdvancedAnalytics, getConversationAnalytics);
router.get('/products', checkAdvancedAnalytics, getProductAnalytics);

export default router;

