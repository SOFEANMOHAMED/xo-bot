import express from 'express';
import {
  facebookWebhook,
  shopifyWebhook
} from '../controllers/webhook.controller.js';
import { telegramWebhook } from '../controllers/telegram.controller.js';
import { instagramWebhook } from '../controllers/instagram.controller.js';

const router = express.Router();

// Raw body middleware for Shopify webhook (needed for HMAC verification)
// Must be before express.json() to capture raw body
const rawBodyMiddleware = express.raw({ 
  type: 'application/json',
  limit: '10mb'
});

// Webhooks don't require authentication (they use signature verification)
router.get('/facebook', facebookWebhook);
router.post('/facebook', facebookWebhook);
router.get('/instagram', instagramWebhook);
router.post('/instagram', instagramWebhook);
router.post('/shopify', rawBodyMiddleware, shopifyWebhook);
router.post('/telegram', telegramWebhook);

export default router;

