import express from 'express';
import {
  getSettings,
  updateSettings,
  getUserDashboardStats,
  clearMerchantCache,
  getCacheStatistics
} from '../controllers/settings.controller.js';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();

router.use(authenticate);

router.get('/', getSettings);
router.put('/', updateSettings);
router.get('/dashboard-stats', getUserDashboardStats);

// Cache management endpoints
router.post('/clear-cache', clearMerchantCache);
router.get('/cache-stats', getCacheStatistics);

export default router;

