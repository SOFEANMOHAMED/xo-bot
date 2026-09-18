import { Response, NextFunction } from 'express';
import { AuthRequest } from './auth.js';
import { createError } from './errorHandler.js';
import { getMerchantAccountType } from '../services/agency/index.js';

/**
 * Block agency management accounts from operational merchant APIs
 * (channels, products, bots, CRM, etc.).
 */
export const blockAgencyOperationalAccess = async (
  req: AuthRequest,
  _res: Response,
  next: NextFunction
) => {
  try {
    const merchantId = req.merchantId || req.userId;
    if (!merchantId) {
      return next(createError('Unauthorized', 401));
    }

    const accountType = await getMerchantAccountType(merchantId);
    if (accountType === 'agency') {
      return next(
        createError(
          'حساب الوكالة مخصص للإدارة فقط ولا يمكنه استخدام القنوات أو الأدوات التشغيلية.',
          403,
          true,
          'AGENCY_MANAGEMENT_ONLY'
        )
      );
    }

    next();
  } catch (error) {
    next(error);
  }
};
