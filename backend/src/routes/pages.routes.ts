import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth.js';
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

// Admin routes (require authentication and admin/owner role)
router.get('/admin', authenticate, requireRole('owner', 'admin'), getAdminPages);
router.get('/admin/:id', authenticate, requireRole('owner', 'admin'), getAdminPage);
router.post('/admin', authenticate, requireRole('owner', 'admin'), createPage);
router.put('/admin/:id', authenticate, requireRole('owner', 'admin'), updatePage);
router.delete('/admin/:id', authenticate, requireRole('owner', 'admin'), deletePage);

export default router;

