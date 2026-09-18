import { Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth.js';
import { createError } from '../middleware/errorHandler.js';
import {
  ensureAgencySchema,
  getMerchantAccountType,
  requireActiveAgency,
  listAgencyPricing,
  listAgencySeats,
  createAgencySeat,
  submitSeatPayment,
  suspendAgencySeat,
  cancelAgencySeat,
  updateAgencySeatLabel,
  resetAgencyClientPassword,
  getAgencyReports,
  listAgencySeatPaymentsForAgency,
  type OfflineMethodId,
  type SeatPaymentPurpose
} from '../services/agency/index.js';
import { isPaidPlanKey } from '../utils/planDefinitions.js';

export const submitAgencySignupRequest = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const { email, password, phone, agencyName } = req.body || {};
    if (!email || !password || !phone || !agencyName) {
      return next(createError('جميع الحقول مطلوبة: البريد، كلمة المرور، الهاتف، اسم الوكالة', 400));
    }

    const { createAgencySignupRequest } = await import('../services/agency/signupRequests.js');
    const result = await createAgencySignupRequest({
      email: String(email),
      password: String(password),
      phone: String(phone),
      agencyName: String(agencyName),
    });

    res.status(201).json({
      success: true,
      message: result.message,
      data: { id: result.id },
    });
  } catch (error) {
    next(error);
  }
};

export const getAgencyMe = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    await ensureAgencySchema();
    const merchantId = req.merchantId;
    if (!merchantId) return next(createError('Unauthorized', 401));

    const agency = await requireActiveAgency(merchantId);
    const pricing = await listAgencyPricing(agency.id);

    res.json({
      success: true,
      data: {
        agency: {
          id: agency.id,
          name: agency.name,
          status: agency.status,
          notes: agency.notes,
          createdAt: agency.created_at
        },
        pricing
      }
    });
  } catch (error) {
    next(error);
  }
};

export const getAgencyDashboardReports = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const merchantId = req.merchantId;
    if (!merchantId) return next(createError('Unauthorized', 401));
    const agency = await requireActiveAgency(merchantId);
    const reports = await getAgencyReports(agency.id);
    res.json({ success: true, data: { reports } });
  } catch (error) {
    next(error);
  }
};

export const getAgencySeats = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const merchantId = req.merchantId;
    if (!merchantId) return next(createError('Unauthorized', 401));
    const agency = await requireActiveAgency(merchantId);
    const seats = await listAgencySeats(agency.id);
    res.json({ success: true, data: { seats } });
  } catch (error) {
    next(error);
  }
};

export const createSeat = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const merchantId = req.merchantId;
    if (!merchantId) return next(createError('Unauthorized', 401));
    const agency = await requireActiveAgency(merchantId);

    const { email, password, planKey, clientLabel, clientName } = req.body || {};
    if (!email || typeof email !== 'string') {
      return next(createError('البريد الإلكتروني مطلوب', 400));
    }
    if (!isPaidPlanKey(planKey)) {
      return next(createError('باقة غير صالحة', 400));
    }

    const result = await createAgencySeat({
      agencyId: agency.id,
      email,
      password,
      planKey,
      clientLabel,
      clientName
    });

    res.status(201).json({
      success: true,
      message: 'تم إنشاء المقعد. ادفع المبلغ المخفّض لتفعيله.',
      data: result
    });
  } catch (error) {
    next(error);
  }
};

export const payForSeat = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const merchantId = req.merchantId;
    if (!merchantId) return next(createError('Unauthorized', 401));
    const agency = await requireActiveAgency(merchantId);
    const { id: seatId } = req.params;
    const { proofUrl, method, purpose, planKey } = req.body || {};

    const paymentPurpose = (purpose || 'activate') as SeatPaymentPurpose;
    if (!['activate', 'renew', 'change_plan'].includes(paymentPurpose)) {
      return next(createError('غرض الدفع غير صالح', 400));
    }

    const payment = await submitSeatPayment({
      agencyId: agency.id,
      agencyOwnerMerchantId: merchantId,
      seatId,
      proofUrl,
      method: method as OfflineMethodId,
      purpose: paymentPurpose,
      planKey: planKey && isPaidPlanKey(planKey) ? planKey : undefined
    });

    res.json({
      success: true,
      message: 'تم إرسال طلب الدفع. سيتم تفعيل المقعد بعد التأكيد.',
      data: payment
    });
  } catch (error) {
    next(error);
  }
};

export const suspendSeat = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const merchantId = req.merchantId;
    if (!merchantId) return next(createError('Unauthorized', 401));
    const agency = await requireActiveAgency(merchantId);
    const seat = await suspendAgencySeat(agency.id, req.params.id);
    res.json({ success: true, message: 'تم تعليق المقعد', data: { seat } });
  } catch (error) {
    next(error);
  }
};

export const cancelSeat = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const merchantId = req.merchantId;
    if (!merchantId) return next(createError('Unauthorized', 401));
    const agency = await requireActiveAgency(merchantId);
    const seat = await cancelAgencySeat(agency.id, req.params.id);
    res.json({ success: true, message: 'تم إلغاء المقعد', data: { seat } });
  } catch (error) {
    next(error);
  }
};

export const updateSeat = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const merchantId = req.merchantId;
    if (!merchantId) return next(createError('Unauthorized', 401));
    const agency = await requireActiveAgency(merchantId);
    const { clientLabel } = req.body || {};
    const seat = await updateAgencySeatLabel(
      agency.id,
      req.params.id,
      typeof clientLabel === 'string' ? clientLabel : null
    );
    res.json({ success: true, message: 'تم تحديث بيانات المقعد', data: { seat } });
  } catch (error) {
    next(error);
  }
};

export const resetSeatPassword = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const merchantId = req.merchantId;
    if (!merchantId) return next(createError('Unauthorized', 401));
    const agency = await requireActiveAgency(merchantId);
    const { password } = req.body || {};
    const result = await resetAgencyClientPassword(agency.id, req.params.id, String(password || ''));
    res.json({ success: true, message: result.message, data: result });
  } catch (error) {
    next(error);
  }
};

export const getAgencyPayments = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const merchantId = req.merchantId;
    if (!merchantId) return next(createError('Unauthorized', 401));
    const agency = await requireActiveAgency(merchantId);
    const payments = await listAgencySeatPaymentsForAgency(agency.id);
    res.json({ success: true, data: { payments } });
  } catch (error) {
    next(error);
  }
};

/** Guard used by routes — ensures caller is an agency account */
export const assertAgencyAccount = async (req: AuthRequest, _res: Response, next: NextFunction) => {
  try {
    const merchantId = req.merchantId;
    if (!merchantId) return next(createError('Unauthorized', 401));
    const accountType = await getMerchantAccountType(merchantId);
    if (accountType !== 'agency') {
      return next(createError('هذه الواجهة للوكالات فقط', 403));
    }
    next();
  } catch (error) {
    next(error);
  }
};
