/**
 * Super-admin: platform WhatsApp for signup OTP + OTP settings.
 */

import { Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth.js';
import { createError } from '../middleware/errorHandler.js';
import { logger } from '../utils/logger.js';
import pool from '../database/connection.js';
import {
  disconnectPlatformWhatsApp,
  getPlatformWhatsAppLiveStatus,
  startPlatformWhatsAppPairing,
  subscribePlatformWhatsAppPairing,
  type PlatformWaPairingEvent
} from '../services/platformOtpWhatsapp/index.js';
import {
  getPlatformOtpWhatsappStatus,
  getSignupOtpSettings
} from '../services/signupOtp/index.js';

function writeSse(res: Response, event: string, data: unknown) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

export const getAdminOtpStatus = async (
  _req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const status = await getPlatformOtpWhatsappStatus();
    res.json({ success: true, data: status });
  } catch (error) {
    next(error);
  }
};

export const startAdminOtpWhatsAppPairing = async (
  _req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const live = getPlatformWhatsAppLiveStatus();
    if (live.status === 'connected') {
      return res.json({
        success: true,
        data: {
          status: live.status,
          phoneNumber: live.phoneNumber,
          alreadyConnected: true
        }
      });
    }

    await startPlatformWhatsAppPairing();
    const after = getPlatformWhatsAppLiveStatus();
    res.json({
      success: true,
      data: {
        status: after.status,
        phoneNumber: after.phoneNumber,
        alreadyConnected: false
      }
    });
  } catch (error) {
    logger.error('Failed to start platform OTP WhatsApp pairing', error as Error);
    next(error);
  }
};

export const streamAdminOtpWhatsAppEvents = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();
    (res as any).flush?.();

    writeSse(res, 'connected', {
      type: 'connected',
      at: new Date().toISOString()
    });

    const live = getPlatformWhatsAppLiveStatus();
    if (live.status !== 'connected' && live.status !== 'qr' && live.status !== 'connecting') {
      void startPlatformWhatsAppPairing().catch((error) => {
        logger.error('Platform OTP pairing from SSE failed', error as Error);
        writeSse(res, 'error', {
          type: 'error',
          message: 'تعذر بدء الربط. حاول مرة أخرى.'
        });
        (res as any).flush?.();
      });
    }

    const unsubscribe = subscribePlatformWhatsAppPairing((event: PlatformWaPairingEvent) => {
      writeSse(res, event.type, event);
      (res as any).flush?.();
    });

    const heartbeat = setInterval(() => {
      try {
        writeSse(res, 'heartbeat', { type: 'heartbeat', at: new Date().toISOString() });
        (res as any).flush?.();
      } catch {
        /* closed */
      }
    }, 20000);

    const cleanup = () => {
      clearInterval(heartbeat);
      unsubscribe();
    };

    req.on('close', cleanup);
    req.on('aborted', cleanup);
    res.on('close', cleanup);
  } catch (error) {
    next(error);
  }
};

export const disconnectAdminOtpWhatsApp = async (
  _req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    await disconnectPlatformWhatsApp();
    res.json({ success: true, message: 'تم قطع ربط واتساب OTP' });
  } catch (error) {
    next(error);
  }
};

export const updateAdminOtpSettings = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const enabled =
      typeof (req.body as { enabled?: boolean })?.enabled === 'boolean'
        ? (req.body as { enabled: boolean }).enabled
        : undefined;

    if (enabled === undefined) {
      return next(createError('enabled is required', 400));
    }

    if (enabled) {
      const status = await getPlatformOtpWhatsappStatus();
      if (!status.connected) {
        return next(
          createError('يجب ربط واتساب أولاً قبل تفعيل OTP عند التسجيل', 400)
        );
      }
    }

    await pool.query(`
      CREATE TABLE IF NOT EXISTS global_settings (
        key VARCHAR(100) PRIMARY KEY,
        value JSONB NOT NULL DEFAULT '{}'::jsonb,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pool.query(
      `INSERT INTO global_settings (key, value, updated_at)
       VALUES ('admin_global_settings', '{}'::jsonb, CURRENT_TIMESTAMP)
       ON CONFLICT (key) DO NOTHING`
    );

    await pool.query(
      `UPDATE global_settings
       SET value = jsonb_set(
         COALESCE(value, '{}'::jsonb),
         '{signupOtp}',
         jsonb_build_object('enabled', $1::boolean),
         true
       ),
       updated_at = CURRENT_TIMESTAMP
       WHERE key = 'admin_global_settings'`,
      [enabled]
    );

    const settings = await getSignupOtpSettings();
    res.json({
      success: true,
      data: { signupOtpEnabled: settings.enabled }
    });
  } catch (error) {
    next(error);
  }
};
