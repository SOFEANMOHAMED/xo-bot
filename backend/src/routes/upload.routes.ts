import express from 'express';
import {
  uploadFile,
  uploadFiles,
  uploadPaymentProof,
  deleteFile,
  uploadSingle,
  uploadMultiple,
  uploadProofSingle,
  handleMulterError
} from '../controllers/upload.controller.js';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();

router.use(authenticate);

router.post('/single', uploadSingle, handleMulterError, uploadFile);
router.post('/multiple', uploadMultiple, handleMulterError, uploadFiles);
router.post('/proof', uploadProofSingle, handleMulterError, uploadPaymentProof);
router.delete('/:filename', deleteFile);

export default router;

