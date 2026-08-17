import express from 'express';
import {
  connectWhatsApp,
  disconnectWhatsApp,
  getWhatsAppStatus,
  updateWhatsAppSettings,
  verifyWhatsAppWebhook,
  handleWhatsAppWebhook
} from '../controllers/whatsapp.controller.js';
import {
  startWhatsAppWebPairingHandler,
  streamWhatsAppWebEvents
} from '../controllers/whatsappWeb.controller.js';
import { authenticate } from '../middleware/auth.js';
import { checkSubscriptionStatus } from '../middleware/subscriptionCheck.js';
import { checkWhatsAppAccountsLimit } from '../middleware/planLimits.js';

const router = express.Router();

// Public webhook routes (no authentication)
router.get('/webhook', verifyWhatsAppWebhook as unknown as express.RequestHandler);
router.post('/webhook', handleWhatsAppWebhook as unknown as express.RequestHandler);

// Authenticated routes
router.use(authenticate);
router.use(checkSubscriptionStatus);

router.get('/status', getWhatsAppStatus);
router.post('/connect', checkWhatsAppAccountsLimit, connectWhatsApp);
router.delete('/disconnect', disconnectWhatsApp);
router.put('/settings', updateWhatsAppSettings);

router.post('/web/pair', startWhatsAppWebPairingHandler);
router.get('/web/events', streamWhatsAppWebEvents);

export default router;

