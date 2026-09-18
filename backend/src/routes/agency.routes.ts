import express from 'express';
import {
  submitAgencySignupRequest,
  getAgencyMe,
  getAgencyDashboardReports,
  getAgencySeats,
  createSeat,
  payForSeat,
  suspendSeat,
  cancelSeat,
  updateSeat,
  resetSeatPassword,
  getAgencyPayments,
  assertAgencyAccount
} from '../controllers/agency.controller.js';
import { authenticate } from '../middleware/auth.js';
import { registerRateLimiter } from '../middleware/rateLimiter.js';

const router = express.Router();

/** Public: agency partnership signup request (pending admin approval) */
router.post('/signup-requests', registerRateLimiter, submitAgencySignupRequest);

router.use(authenticate);
router.use(assertAgencyAccount);

router.get('/me', getAgencyMe);
router.get('/reports', getAgencyDashboardReports);
router.get('/seats', getAgencySeats);
router.post('/seats', createSeat);
router.patch('/seats/:id', updateSeat);
router.post('/seats/:id/pay', payForSeat);
router.post('/seats/:id/suspend', suspendSeat);
router.post('/seats/:id/cancel', cancelSeat);
router.post('/seats/:id/reset-password', resetSeatPassword);
router.get('/payments', getAgencyPayments);

export default router;
