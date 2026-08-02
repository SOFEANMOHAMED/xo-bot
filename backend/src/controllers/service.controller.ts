import { Response, NextFunction } from 'express';
import pool from '../database/connection.js';
import { createError } from '../middleware/errorHandler.js';
import { AuthRequest } from '../middleware/auth.js';
import { z } from 'zod';

const serviceSchema = z.object({
  name: z.string().min(1),
  category: z.string().optional(),
  type: z.string().optional(),
  shortDescription: z.string().min(1),
  fullDescription: z.string().optional(),
  priceLabel: z.string().min(1),
  pricingType: z.enum(['one_time', 'subscription', 'per_hour']).default('one_time'),
  duration: z.string().optional(),
  deliveryTime: z.string().optional(),
  includedItems: z.array(z.string()).default([]),
  requirements: z.array(z.string()).default([]),
  previousWorkTemplates: z.array(z.string()).default([]),
  bookingLink: z.string().url().optional(),
  contactChannel: z.string().optional()
});

export const getServices = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const result = await pool.query(
      `SELECT id, name, category, type, short_description, full_description,
              price_label, pricing_type, duration, delivery_time,
              included_items, requirements, previous_work_templates,
              booking_link, contact_channel, created_at, updated_at
       FROM services
       WHERE merchant_id = $1
       ORDER BY created_at DESC`,
      [req.merchantId]
    );

    const services = result.rows.map(row => ({
      id: row.id,
      name: row.name,
      category: row.category,
      type: row.type,
      shortDescription: row.short_description,
      fullDescription: row.full_description,
      priceLabel: row.price_label,
      pricingType: row.pricing_type,
      duration: row.duration,
      deliveryTime: row.delivery_time,
      includedItems: row.included_items || [],
      requirements: row.requirements || [],
      previousWorkTemplates: row.previous_work_templates || [],
      bookingLink: row.booking_link,
      contactChannel: row.contact_channel,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));

    res.json({
      success: true,
      data: { services }
    });
  } catch (error) {
    next(error);
  }
};

export const getService = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `SELECT id, name, category, type, short_description, full_description,
              price_label, pricing_type, duration, delivery_time,
              included_items, requirements, previous_work_templates,
              booking_link, contact_channel, created_at, updated_at
       FROM services
       WHERE id = $1 AND merchant_id = $2`,
      [id, req.merchantId]
    );

    if (result.rows.length === 0) {
      return next(createError('Service not found', 404));
    }

    const row = result.rows[0];
    const service = {
      id: row.id,
      name: row.name,
      category: row.category,
      type: row.type,
      shortDescription: row.short_description,
      fullDescription: row.full_description,
      priceLabel: row.price_label,
      pricingType: row.pricing_type,
      duration: row.duration,
      deliveryTime: row.delivery_time,
      includedItems: row.included_items || [],
      requirements: row.requirements || [],
      previousWorkTemplates: row.previous_work_templates || [],
      bookingLink: row.booking_link,
      contactChannel: row.contact_channel,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };

    res.json({
      success: true,
      data: { service }
    });
  } catch (error) {
    next(error);
  }
};

export const createService = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const validated = serviceSchema.parse(req.body);

    const result = await pool.query(
      `INSERT INTO services (
        merchant_id, name, category, type, short_description, full_description,
        price_label, pricing_type, duration, delivery_time,
        included_items, requirements, previous_work_templates,
        booking_link, contact_channel
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
      RETURNING id, name, category, type, short_description, full_description,
                price_label, pricing_type, duration, delivery_time,
                included_items, requirements, previous_work_templates,
                booking_link, contact_channel, created_at, updated_at`,
      [
        req.merchantId,
        validated.name,
        validated.category || null,
        validated.type || null,
        validated.shortDescription,
        validated.fullDescription || null,
        validated.priceLabel,
        validated.pricingType,
        validated.duration || null,
        validated.deliveryTime || null,
        validated.includedItems,
        validated.requirements,
        validated.previousWorkTemplates,
        validated.bookingLink || null,
        validated.contactChannel || null
      ]
    );

    const row = result.rows[0];
    const service = {
      id: row.id,
      name: row.name,
      category: row.category,
      type: row.type,
      shortDescription: row.short_description,
      fullDescription: row.full_description,
      priceLabel: row.price_label,
      pricingType: row.pricing_type,
      duration: row.duration,
      deliveryTime: row.delivery_time,
      includedItems: row.included_items || [],
      requirements: row.requirements || [],
      previousWorkTemplates: row.previous_work_templates || [],
      bookingLink: row.booking_link,
      contactChannel: row.contact_channel,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };

    res.status(201).json({
      success: true,
      data: { service }
    });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return next(createError(error.errors[0].message, 400));
    }
    next(error);
  }
};

export const updateService = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const { id } = req.params;
    const validated = serviceSchema.partial().parse(req.body);

    const checkResult = await pool.query(
      'SELECT id FROM services WHERE id = $1 AND merchant_id = $2',
      [id, req.merchantId]
    );

    if (checkResult.rows.length === 0) {
      return next(createError('Service not found', 404));
    }

    const updates: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    Object.entries(validated).forEach(([key, value]) => {
      if (value !== undefined) {
        const dbKey = key.replace(/([A-Z])/g, '_$1').toLowerCase();
        updates.push(`${dbKey} = $${paramIndex++}`);
        values.push(value);
      }
    });

    if (updates.length === 0) {
      return next(createError('No fields to update', 400));
    }

    updates.push('updated_at = CURRENT_TIMESTAMP');
    values.push(id, req.merchantId);

    const result = await pool.query(
      `UPDATE services
       SET ${updates.join(', ')}
       WHERE id = $${paramIndex++} AND merchant_id = $${paramIndex}
       RETURNING id, name, category, type, short_description, full_description,
                 price_label, pricing_type, duration, delivery_time,
                 included_items, requirements, previous_work_templates,
                 booking_link, contact_channel, created_at, updated_at`,
      values
    );

    const row = result.rows[0];
    const service = {
      id: row.id,
      name: row.name,
      category: row.category,
      type: row.type,
      shortDescription: row.short_description,
      fullDescription: row.full_description,
      priceLabel: row.price_label,
      pricingType: row.pricing_type,
      duration: row.duration,
      deliveryTime: row.delivery_time,
      includedItems: row.included_items || [],
      requirements: row.requirements || [],
      previousWorkTemplates: row.previous_work_templates || [],
      bookingLink: row.booking_link,
      contactChannel: row.contact_channel,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };

    res.json({
      success: true,
      data: { service }
    });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return next(createError(error.errors[0].message, 400));
    }
    next(error);
  }
};

export const deleteService = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      'DELETE FROM services WHERE id = $1 AND merchant_id = $2 RETURNING id',
      [id, req.merchantId]
    );

    if (result.rows.length === 0) {
      return next(createError('Service not found', 404));
    }

    res.json({
      success: true,
      message: 'Service deleted successfully'
    });
  } catch (error) {
    next(error);
  }
};

