import express from 'express';
import {
  getPaymentMethods,
  submitPaymentRequest,
  getMyPaymentRequests,
  getAdminPaymentRequests,
  reviewPaymentRequest
} from '../controllers/billing.controller.js';
import { authenticate, requireRole } from '../middleware/auth.js';

const router = express.Router();

// Merchant routes (auth only — available even when trial expired)
router.get('/payment-methods', authenticate, getPaymentMethods);
router.post('/payment-requests', authenticate, submitPaymentRequest);
router.get('/payment-requests/me', authenticate, getMyPaymentRequests);

// Admin routes
router.get(
  '/admin/payment-requests',
  authenticate,
  requireRole('owner', 'admin'),
  getAdminPaymentRequests
);
router.put(
  '/admin/payment-requests/:id',
  authenticate,
  requireRole('owner', 'admin'),
  reviewPaymentRequest
);

export default router;
