import express from 'express';
import {
  listFaqs,
  createFaq,
  updateFaq,
  deleteFaq,
} from '../controllers/faq.controller.js';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();

router.use(authenticate);

router.get('/', listFaqs);
router.post('/', createFaq);
router.put('/:id', updateFaq);
router.delete('/:id', deleteFaq);

export default router;
