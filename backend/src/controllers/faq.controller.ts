import { Response, NextFunction } from 'express';
import { z } from 'zod';
import pool from '../database/connection.js';
import { createError } from '../middleware/errorHandler.js';
import { AuthRequest } from '../middleware/auth.js';
import { invalidateMerchantFaqs } from '../services/cacheService.js';

function requireMerchant(req: AuthRequest): string {
  if (!req.merchantId) throw createError('Unauthorized', 401);
  return req.merchantId;
}

const faqBodySchema = z.object({
  question: z.string().trim().min(1).max(1000),
  answer: z.string().trim().min(1).max(4000),
  priority: z.number().int().min(0).max(10000).optional(),
  isActive: z.boolean().optional(),
});

const faqUpdateSchema = z.object({
  question: z.string().trim().min(1).max(1000).optional(),
  answer: z.string().trim().min(1).max(4000).optional(),
  priority: z.number().int().min(0).max(10000).optional(),
  isActive: z.boolean().optional(),
});

function mapFaqRow(row: {
  id: string;
  question: string;
  answer: string;
  priority: number;
  is_active: boolean;
  created_at?: Date;
  updated_at?: Date;
}) {
  return {
    id: row.id,
    question: row.question,
    answer: row.answer,
    priority: row.priority,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export const listFaqs = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const merchantId = requireMerchant(req);
    const result = await pool.query(
      `SELECT id, question, answer, priority, is_active, created_at, updated_at
       FROM merchant_faqs
       WHERE merchant_id = $1
       ORDER BY priority DESC, created_at ASC`,
      [merchantId]
    );
    res.json({ faqs: result.rows.map(mapFaqRow) });
  } catch (e) {
    next(e);
  }
};

export const createFaq = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const merchantId = requireMerchant(req);
    const parsed = faqBodySchema.safeParse(req.body || {});
    if (!parsed.success) {
      throw createError('السؤال والجواب مطلوبان وبحدود طول معقولة', 400);
    }

    const { question, answer, priority = 100, isActive = true } = parsed.data;
    const result = await pool.query(
      `INSERT INTO merchant_faqs (merchant_id, question, answer, priority, is_active)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, question, answer, priority, is_active, created_at, updated_at`,
      [merchantId, question, answer, priority, isActive]
    );

    invalidateMerchantFaqs(merchantId);
    res.status(201).json({ faq: mapFaqRow(result.rows[0]) });
  } catch (e) {
    next(e);
  }
};

export const updateFaq = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const merchantId = requireMerchant(req);
    const faqId = String(req.params.id || '').trim();
    if (!faqId) throw createError('معرّف السؤال مطلوب', 400);

    const parsed = faqUpdateSchema.safeParse(req.body || {});
    if (!parsed.success) {
      throw createError('بيانات غير صالحة', 400);
    }

    const updates = parsed.data;
    if (
      updates.question === undefined &&
      updates.answer === undefined &&
      updates.priority === undefined &&
      updates.isActive === undefined
    ) {
      throw createError('لا توجد حقول للتحديث', 400);
    }

    const owned = await pool.query(
      `SELECT id FROM merchant_faqs WHERE id = $1 AND merchant_id = $2`,
      [faqId, merchantId]
    );
    if (owned.rows.length === 0) throw createError('السؤال غير موجود', 404);

    const sets: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (updates.question !== undefined) {
      sets.push(`question = $${idx++}`);
      values.push(updates.question);
    }
    if (updates.answer !== undefined) {
      sets.push(`answer = $${idx++}`);
      values.push(updates.answer);
    }
    if (updates.priority !== undefined) {
      sets.push(`priority = $${idx++}`);
      values.push(updates.priority);
    }
    if (updates.isActive !== undefined) {
      sets.push(`is_active = $${idx++}`);
      values.push(updates.isActive);
    }
    sets.push('updated_at = CURRENT_TIMESTAMP');

    values.push(faqId, merchantId);
    const result = await pool.query(
      `UPDATE merchant_faqs
       SET ${sets.join(', ')}
       WHERE id = $${idx++} AND merchant_id = $${idx}
       RETURNING id, question, answer, priority, is_active, created_at, updated_at`,
      values
    );

    invalidateMerchantFaqs(merchantId);
    res.json({ faq: mapFaqRow(result.rows[0]) });
  } catch (e) {
    next(e);
  }
};

export const deleteFaq = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const merchantId = requireMerchant(req);
    const faqId = String(req.params.id || '').trim();
    if (!faqId) throw createError('معرّف السؤال مطلوب', 400);

    const result = await pool.query(
      `DELETE FROM merchant_faqs WHERE id = $1 AND merchant_id = $2 RETURNING id`,
      [faqId, merchantId]
    );
    if (result.rows.length === 0) throw createError('السؤال غير موجود', 404);

    invalidateMerchantFaqs(merchantId);
    res.json({ message: 'تم حذف السؤال الشائع' });
  } catch (e) {
    next(e);
  }
};
