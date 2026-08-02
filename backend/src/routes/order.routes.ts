import express from 'express';
import {
  getOrders,
  getOrder,
  createOrder,
  updateOrderStatus,
  markOrderAsViewed,
  deleteOrder
} from '../controllers/order.controller.js';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();

router.use(authenticate);

router.get('/', getOrders);
router.get('/:id', getOrder);
router.post('/', createOrder);
router.patch('/:id/status', updateOrderStatus);
router.patch('/:id/viewed', markOrderAsViewed);
router.delete('/:id', deleteOrder);

export default router;

