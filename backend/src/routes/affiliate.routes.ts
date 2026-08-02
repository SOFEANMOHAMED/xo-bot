import express from 'express';
import { getAffiliateStats, requestWithdrawal, trackAffiliateClick } from '../controllers/affiliate.controller.js';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();

// Track affiliate click (public endpoint, no auth required)
router.get('/track-click', trackAffiliateClick);

// All other affiliate routes require authentication
router.use(authenticate);

// Get affiliate stats for current user
router.get('/stats', getAffiliateStats);

// Request withdrawal
router.post('/withdraw', requestWithdrawal);

export default router;

