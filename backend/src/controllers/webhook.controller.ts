import { Request, Response, NextFunction } from 'express';
import { createError } from '../middleware/errorHandler.js';
import { facebookWebhook as facebookWebhookHandler } from './facebook.controller.js';

// Re-export Facebook webhook handler
export { facebookWebhookHandler as facebookWebhook };

import { shopifyWebhook as shopifyWebhookHandler } from './shopify.controller.js';

// Re-export Shopify webhook handler
export { shopifyWebhookHandler as shopifyWebhook };

