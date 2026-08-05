import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth.js';
import { requireAdminGate } from '../middleware/adminGate.js';
import {
  getAdminPages,
  getPageBySlug,
  getAdminPage,
  createPage,
  updatePage,
  deletePage,
  listPublishedPagesForFooter
} from '../controllers/pages.controller.js';

const router = Router();

// Public routes
router.get('/published', listPublishedPagesForFooter);
router.get('/public/:slug', getPageBySlug);

// Admin routes (gate + auth + role)
router.get('/admin', requireAdminGate, authenticate, requireRole('owner', 'admin'), getAdminPages);
router.get('/admin/:id', requireAdminGate, authenticate, requireRole('owner', 'admin'), getAdminPage);
router.post('/admin', requireAdminGate, authenticate, requireRole('owner', 'admin'), createPage);
router.put('/admin/:id', requireAdminGate, authenticate, requireRole('owner', 'admin'), updatePage);
router.delete('/admin/:id', requireAdminGate, authenticate, requireRole('owner', 'admin'), deletePage);

export default router;

