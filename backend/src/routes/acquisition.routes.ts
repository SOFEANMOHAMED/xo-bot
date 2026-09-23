import { Router } from 'express';
import { resolvePublicTrackingLink } from '../controllers/acquisition.controller.js';

const router = Router();

router.get('/go/:code', resolvePublicTrackingLink);

export default router;
