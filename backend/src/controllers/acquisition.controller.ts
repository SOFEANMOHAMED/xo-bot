import { Request, Response, NextFunction } from 'express';
import { createError } from '../middleware/errorHandler.js';
import {
  createMarketingTrackingLink,
  listMarketingTrackingLinks,
  resolveMarketingTrackingLink,
  setMarketingTrackingLinkActive,
} from '../services/merchantAcquisition.js';

export const resolvePublicTrackingLink = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const code = typeof req.params.code === 'string' ? req.params.code : '';
    const resolved = await resolveMarketingTrackingLink(code, { recordClick: true });
    if (!resolved) {
      throw createError('الرابط غير موجود أو معطّل', 404);
    }
    res.json({ success: true, data: resolved });
  } catch (error) {
    next(error);
  }
};

export const listAdminTrackingLinks = async (
  _req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const data = await listMarketingTrackingLinks();
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

export const createAdminTrackingLink = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const body = (req.body || {}) as Record<string, unknown>;
    const data = await createMarketingTrackingLink({
      name: typeof body.name === 'string' ? body.name : null,
      code: typeof body.code === 'string' ? body.code : null,
      path: typeof body.path === 'string' ? body.path : '/signup',
      source: typeof body.utm_source === 'string' ? body.utm_source : typeof body.source === 'string' ? body.source : null,
      medium: typeof body.utm_medium === 'string' ? body.utm_medium : typeof body.medium === 'string' ? body.medium : null,
      campaign:
        typeof body.utm_campaign === 'string'
          ? body.utm_campaign
          : typeof body.campaign === 'string'
            ? body.campaign
            : null,
      content:
        typeof body.utm_content === 'string' ? body.utm_content : typeof body.content === 'string' ? body.content : null,
      term: typeof body.utm_term === 'string' ? body.utm_term : typeof body.term === 'string' ? body.term : null,
    });
    res.status(201).json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

export const updateAdminTrackingLink = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const id = typeof req.params.id === 'string' ? req.params.id : '';
    if (!id) throw createError('معرّف الرابط مطلوب', 400);
    const body = (req.body || {}) as { isActive?: unknown; is_active?: unknown };
    if (typeof body.isActive !== 'boolean' && typeof body.is_active !== 'boolean') {
      throw createError('isActive مطلوب', 400);
    }
    const isActive = typeof body.isActive === 'boolean' ? body.isActive : Boolean(body.is_active);
    const data = await setMarketingTrackingLinkActive(id, isActive);
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
};
