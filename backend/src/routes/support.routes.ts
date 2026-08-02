import express from 'express';
import {
  createSupportTicket,
  getUserSupportTickets,
  getAllSupportTickets,
  getSupportTicket,
  updateSupportTicket,
  addSupportTicketReply,
  getSupportTicketsStats
} from '../controllers/support.controller.js';
import { authenticate } from '../middleware/auth.js';
import { requireRole } from '../middleware/auth.js';

const router = express.Router();

// User routes (require authentication)
router.post('/', authenticate, createSupportTicket);
router.get('/my-tickets', authenticate, getUserSupportTickets);
router.get('/:id', authenticate, getSupportTicket);
router.post('/:ticketId/reply', authenticate, addSupportTicketReply);

// Admin routes (require authentication and admin/owner role)
router.get('/admin/all', authenticate, requireRole('owner', 'admin'), getAllSupportTickets);
router.get('/admin/stats', authenticate, requireRole('owner', 'admin'), getSupportTicketsStats);
router.put('/admin/:id', authenticate, requireRole('owner', 'admin'), updateSupportTicket);

export default router;

