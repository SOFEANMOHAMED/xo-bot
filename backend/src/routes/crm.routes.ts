import express from 'express';
import {
  getCustomers,
  getCustomer,
  createCustomer,
  updateCustomer,
  deleteCustomer,
  createInteraction,
  getCrmStats
} from '../controllers/crm.controller.js';
import { authenticate } from '../middleware/auth.js';
import { checkSubscriptionStatus } from '../middleware/subscriptionCheck.js';
import { checkCustomersLimit } from '../middleware/planLimits.js';

const router = express.Router();

router.use(authenticate);
router.use(checkSubscriptionStatus);

// Stats
router.get('/stats', getCrmStats);

// Customers
router.get('/', getCustomers);
router.get('/:id', getCustomer);
router.post('/', checkCustomersLimit, createCustomer);
router.put('/:id', updateCustomer);
router.delete('/:id', deleteCustomer);

// Interactions
router.post('/interactions', createInteraction);

export default router;

