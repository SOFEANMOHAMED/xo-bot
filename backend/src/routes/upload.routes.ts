import express from 'express';
import {
  uploadFile,
  uploadFiles,
  uploadPaymentProof,
  deleteFile,
  uploadSingle,
  uploadMultiple,
  uploadProofSingle
} from '../controllers/upload.controller.js';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();

router.use(authenticate);

router.post('/single', uploadSingle, uploadFile);
router.post('/multiple', uploadMultiple, uploadFiles);
router.post('/proof', uploadProofSingle, uploadPaymentProof);
router.delete('/:filename', deleteFile);

export default router;

