import express from 'express';
import {
  generateChatResponse,
  generateProductDescriptionAI,
  generateMarketingImageAI,
  getMarketingImageHistory,
  getMarketingImageContent
} from '../controllers/ai.controller.js';
import { generateSaaSBotResponse } from '../controllers/saasBot.controller.js';
import { authenticate } from '../middleware/auth.js';
import { checkSubscriptionStatus } from '../middleware/subscriptionCheck.js';
import { checkAIResponseLimit, checkMarketingImageLimit } from '../middleware/planLimits.js';
import { publicAiRateLimiter } from '../middleware/rateLimiter.js';

const router = express.Router();

// Public endpoint for SaaS bots (no auth — tight IP rate limit)
router.post('/saas-bot', publicAiRateLimiter, generateSaaSBotResponse);

// Protected endpoints
router.use(authenticate);
router.use(checkSubscriptionStatus);

router.post('/chat', checkAIResponseLimit, generateChatResponse);

router.post('/product-description', checkAIResponseLimit, generateProductDescriptionAI);

router.get('/marketing-images', getMarketingImageHistory);
router.get('/marketing-images/:id/content', getMarketingImageContent);
router.post('/marketing-image', checkMarketingImageLimit, generateMarketingImageAI);

export default router;

