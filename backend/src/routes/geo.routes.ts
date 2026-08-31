import express from 'express';
import { getVisitorCountry } from '../controllers/geo.controller.js';

const router = express.Router();

router.get('/visitor-country', getVisitorCountry);

export default router;
