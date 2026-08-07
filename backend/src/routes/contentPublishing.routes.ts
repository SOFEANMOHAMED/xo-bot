import express from 'express';
import { authenticate } from '../middleware/auth.js';
import { checkSubscriptionStatus } from '../middleware/subscriptionCheck.js';
import {
  cancelContentPublication,
  createContentPublication,
  deleteContentPublication,
  getContentPublication,
  listContentAccounts,
  listContentPublications,
  publishContentPublicationNow,
  scheduleContentPublication,
  updateContentPublication
} from '../controllers/contentPublishing.controller.js';

const router = express.Router();

router.use(authenticate);
router.use(checkSubscriptionStatus);

router.get('/accounts', listContentAccounts);
router.get('/publications', listContentPublications);
router.post('/publications', createContentPublication);
router.get('/publications/:id', getContentPublication);
router.put('/publications/:id', updateContentPublication);
router.delete('/publications/:id', deleteContentPublication);
router.post('/publications/:id/publish', publishContentPublicationNow);
router.post('/publications/:id/schedule', scheduleContentPublication);
router.post('/publications/:id/cancel', cancelContentPublication);

export default router;
