import { Response, NextFunction } from 'express';
import { createError } from '../middleware/errorHandler.js';
import { AuthRequest } from '../middleware/auth.js';
import { logger } from '../utils/logger.js';
import {
  CANCELLABLE_STATUSES,
  DELETABLE_STATUSES,
  EDITABLE_STATUSES,
  createPublication,
  deletePublication,
  executePublication,
  getPublicationById,
  listPublications,
  listPublishableAccounts,
  normalizeMedia,
  normalizeTargets,
  parseScheduleDate,
  updatePublication,
  validatePublicationPayload
} from '../services/contentPublishing/index.js';
import type { PublicationStatus } from '../services/contentPublishing/types.js';

function requireMerchant(req: AuthRequest): string {
  if (!req.merchantId) throw createError('Unauthorized', 401);
  return req.merchantId;
}

function toDto(detail: Awaited<ReturnType<typeof getPublicationById>>) {
  if (!detail) return null;
  return {
    id: detail.id,
    caption: detail.caption,
    mediaKind: detail.media_kind,
    status: detail.status,
    scheduledAt: detail.scheduled_at,
    publishedAt: detail.published_at,
    errorSummary: detail.error_summary,
    metadata: detail.metadata,
    createdAt: detail.created_at,
    updatedAt: detail.updated_at,
    media: detail.media.map((m) => ({
      id: m.id,
      sortOrder: m.sort_order,
      mediaType: m.media_type,
      mediaUrl: m.media_url,
      thumbnailUrl: m.thumbnail_url,
      altText: m.alt_text
    })),
    targets: detail.targets.map((t) => ({
      id: t.id,
      platform: t.platform,
      accountRef: t.account_ref,
      accountLabel: t.account_label,
      status: t.status,
      externalPostId: t.external_post_id,
      permalink: t.permalink,
      errorMessage: t.error_message,
      publishedAt: t.published_at
    }))
  };
}

export const listContentAccounts = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const merchantId = requireMerchant(req);
    const accounts = await listPublishableAccounts(merchantId);
    res.json({
      accounts: accounts.map((a) => ({
        platform: a.platform,
        accountRef: a.accountRef,
        accountLabel: a.accountLabel,
        pageId: a.pageId
      }))
    });
  } catch (e) {
    next(e);
  }
};

export const listContentPublications = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const merchantId = requireMerchant(req);
    const statusParam = req.query.status as string | undefined;
    let status: PublicationStatus | PublicationStatus[] | undefined;
    if (statusParam) {
      status = statusParam.includes(',')
        ? (statusParam.split(',') as PublicationStatus[])
        : (statusParam as PublicationStatus);
    }

    const result = await listPublications(merchantId, {
      status,
      platform: req.query.platform as 'facebook' | 'instagram' | undefined,
      limit: req.query.limit ? Number(req.query.limit) : 30,
      offset: req.query.offset ? Number(req.query.offset) : 0,
      from: req.query.from as string | undefined,
      to: req.query.to as string | undefined
    });

    res.json({
      publications: result.items.map((item) => toDto(item)),
      total: result.total
    });
  } catch (e) {
    next(e);
  }
};

export const getContentPublication = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const merchantId = requireMerchant(req);
    const detail = await getPublicationById(merchantId, req.params.id);
    if (!detail) throw createError('المنشور غير موجود', 404);
    res.json({ publication: toDto(detail) });
  } catch (e) {
    next(e);
  }
};

export const createContentPublication = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const merchantId = requireMerchant(req);
    const media = normalizeMedia(req.body?.media);
    const targets = normalizeTargets(req.body?.targets);
    const caption = typeof req.body?.caption === 'string' ? req.body.caption : null;
    const publishNow = Boolean(req.body?.publishNow);
    const scheduledAt = parseScheduleDate(req.body?.scheduledAt);

    const owned = await listPublishableAccounts(merchantId);
    const ownedKeys = new Set(owned.map((a) => `${a.platform}:${a.accountRef}`));
    for (const target of targets) {
      if (!ownedKeys.has(`${target.platform}:${target.accountRef}`)) {
        throw createError('أحد الحسابات المحددة غير مرتبط بهذا التاجر', 403);
      }
      const match = owned.find(
        (a) => a.platform === target.platform && a.accountRef === target.accountRef
      );
      if (match && !target.accountLabel) {
        target.accountLabel = match.accountLabel;
      }
    }

    const validationError = validatePublicationPayload({
      caption,
      media,
      targets,
      scheduledAt,
      requireFutureSchedule: Boolean(scheduledAt) && !publishNow
    });
    if (validationError) throw createError(validationError, 400);

    let status: PublicationStatus = 'draft';
    if (publishNow) status = 'draft';
    else if (scheduledAt) status = 'scheduled';

    const created = await createPublication(merchantId, {
      caption,
      media,
      targets,
      status,
      scheduledAt: publishNow ? null : scheduledAt,
      createdBy: req.userId || merchantId,
      metadata: req.body?.metadata && typeof req.body.metadata === 'object' ? req.body.metadata : {}
    });

    if (publishNow) {
      const published = await executePublication({
        merchantId,
        publicationId: created.id
      });
      res.status(201).json({
        message: 'تم إنشاء المنشور ونشره',
        publication: toDto(published)
      });
      return;
    }

    res.status(201).json({
      message: scheduledAt ? 'تمت جدولة المنشور' : 'تم حفظ المسودة',
      publication: toDto(created)
    });
  } catch (e) {
    next(e);
  }
};

export const updateContentPublication = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const merchantId = requireMerchant(req);
    const existing = await getPublicationById(merchantId, req.params.id);
    if (!existing) throw createError('المنشور غير موجود', 404);
    if (!EDITABLE_STATUSES.has(existing.status)) {
      throw createError('لا يمكن تعديل منشور قيد النشر أو منشور مسبقاً', 409);
    }

    const media =
      req.body?.media !== undefined ? normalizeMedia(req.body.media) : undefined;
    const targets =
      req.body?.targets !== undefined ? normalizeTargets(req.body.targets) : undefined;
    const caption =
      req.body?.caption !== undefined
        ? typeof req.body.caption === 'string'
          ? req.body.caption
          : null
        : undefined;

    let scheduledAt: Date | null | undefined;
    let clearSchedule = false;
    let nextStatus: PublicationStatus | undefined;

    if (req.body?.scheduledAt === null) {
      clearSchedule = true;
      nextStatus = 'draft';
      scheduledAt = null;
    } else if (req.body?.scheduledAt !== undefined) {
      scheduledAt = parseScheduleDate(req.body.scheduledAt);
      if (!scheduledAt) throw createError('وقت الجدولة غير صالح', 400);
      nextStatus = 'scheduled';
    }

    const effectiveMedia = media ?? existing.media.map((m) => ({
      mediaUrl: m.media_url,
      mediaType: m.media_type,
      thumbnailUrl: m.thumbnail_url,
      altText: m.alt_text,
      sortOrder: m.sort_order
    }));
    const effectiveTargets = targets ?? existing.targets.map((t) => ({
      platform: t.platform,
      accountRef: t.account_ref,
      accountLabel: t.account_label
    }));
    const effectiveCaption = caption !== undefined ? caption : existing.caption;

    if (targets) {
      const owned = await listPublishableAccounts(merchantId);
      const ownedKeys = new Set(owned.map((a) => `${a.platform}:${a.accountRef}`));
      for (const target of targets) {
        if (!ownedKeys.has(`${target.platform}:${target.accountRef}`)) {
          throw createError('أحد الحسابات المحددة غير مرتبط بهذا التاجر', 403);
        }
      }
    }

    const validationError = validatePublicationPayload({
      caption: effectiveCaption,
      media: effectiveMedia,
      targets: effectiveTargets,
      scheduledAt:
        clearSchedule
          ? null
          : scheduledAt !== undefined
            ? scheduledAt
            : existing.scheduled_at,
      requireFutureSchedule: nextStatus === 'scheduled'
    });
    if (validationError) throw createError(validationError, 400);

    const updated = await updatePublication(merchantId, req.params.id, {
      caption,
      media,
      targets,
      status: nextStatus,
      scheduledAt,
      clearSchedule,
      errorSummary: nextStatus === 'scheduled' || nextStatus === 'draft' ? null : undefined,
      metadata: req.body?.metadata
    });

    res.json({ message: 'تم تحديث المنشور', publication: toDto(updated) });
  } catch (e) {
    next(e);
  }
};

export const deleteContentPublication = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const merchantId = requireMerchant(req);
    const existing = await getPublicationById(merchantId, req.params.id);
    if (!existing) throw createError('المنشور غير موجود', 404);
    if (!DELETABLE_STATUSES.has(existing.status)) {
      throw createError('لا يمكن حذف منشور قيد النشر حالياً', 409);
    }
    if (existing.status === 'publishing') {
      throw createError('المنشور قيد النشر حالياً', 409);
    }
    const ok = await deletePublication(merchantId, req.params.id);
    if (!ok) throw createError('المنشور غير موجود', 404);
    res.json({ message: 'تم حذف المنشور' });
  } catch (e) {
    next(e);
  }
};

export const publishContentPublicationNow = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const merchantId = requireMerchant(req);
    const existing = await getPublicationById(merchantId, req.params.id);
    if (!existing) throw createError('المنشور غير موجود', 404);
    if (!EDITABLE_STATUSES.has(existing.status) && existing.status !== 'partial') {
      throw createError('لا يمكن نشر هذا المنشور بحالته الحالية', 409);
    }

    const validationError = validatePublicationPayload({
      caption: existing.caption,
      media: existing.media.map((m) => ({
        mediaUrl: m.media_url,
        mediaType: m.media_type
      })),
      targets: existing.targets.map((t) => ({
        platform: t.platform,
        accountRef: t.account_ref
      }))
    });
    if (validationError) throw createError(validationError, 400);

    const published = await executePublication({
      merchantId,
      publicationId: existing.id
    });

    res.json({
      message: published.status === 'published' ? 'تم النشر بنجاح' : 'اكتمل النشر مع بعض الأخطاء',
      publication: toDto(published)
    });
  } catch (e) {
    logger.error('Manual content publish failed', e as Error, {
      merchantId: req.merchantId,
      publicationId: req.params.id
    });
    next(e);
  }
};

export const scheduleContentPublication = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const merchantId = requireMerchant(req);
    const existing = await getPublicationById(merchantId, req.params.id);
    if (!existing) throw createError('المنشور غير موجود', 404);
    if (!EDITABLE_STATUSES.has(existing.status)) {
      throw createError('لا يمكن جدولة هذا المنشور بحالته الحالية', 409);
    }

    const scheduledAt = parseScheduleDate(req.body?.scheduledAt);
    const validationError = validatePublicationPayload({
      caption: existing.caption,
      media: existing.media.map((m) => ({
        mediaUrl: m.media_url,
        mediaType: m.media_type
      })),
      targets: existing.targets.map((t) => ({
        platform: t.platform,
        accountRef: t.account_ref
      })),
      scheduledAt,
      requireFutureSchedule: true
    });
    if (validationError) throw createError(validationError, 400);

    const updated = await updatePublication(merchantId, existing.id, {
      status: 'scheduled',
      scheduledAt,
      errorSummary: null
    });

    res.json({ message: 'تمت جدولة المنشور', publication: toDto(updated) });
  } catch (e) {
    next(e);
  }
};

export const cancelContentPublication = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const merchantId = requireMerchant(req);
    const existing = await getPublicationById(merchantId, req.params.id);
    if (!existing) throw createError('المنشور غير موجود', 404);
    if (!CANCELLABLE_STATUSES.has(existing.status)) {
      throw createError('يمكن إلغاء المنشورات المجدولة فقط', 409);
    }

    const updated = await updatePublication(merchantId, existing.id, {
      status: 'cancelled',
      clearSchedule: true,
      errorSummary: null
    });

    res.json({ message: 'تم إلغاء الجدولة', publication: toDto(updated) });
  } catch (e) {
    next(e);
  }
};
