import { Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth.js';
import { createError } from '../middleware/errorHandler.js';
import { logger } from '../utils/logger.js';
import { assertChannelSlotAvailable } from '../middleware/planLimits.js';
import {
  getWhatsAppWebLiveStatus,
  getWhatsAppWebSession,
  startWhatsAppWebPairing,
  subscribeWhatsAppPairing,
  type WhatsAppWebPairingEvent
} from '../services/whatsappWeb/index.js';

function writeSse(res: Response, event: string, data: unknown) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

/**
 * POST /api/whatsapp/web/pair
 * Start (or refresh) QR pairing for the authenticated merchant only.
 */
export const startWhatsAppWebPairingHandler = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const merchantId = req.merchantId || req.userId;
    if (!merchantId) {
      return next(createError('Unauthorized', 401));
    }

    const live = getWhatsAppWebLiveStatus(merchantId);
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

    const existing = await getWhatsAppWebSession(merchantId);
    const hasActiveSession =
      existing &&
      (existing.status === 'qr' || existing.status === 'connecting' || existing.status === 'connected');
    if (!hasActiveSession) {
      await assertChannelSlotAvailable(merchantId, 'whatsapp');
    }

    await startWhatsAppWebPairing(merchantId);
    const after = getWhatsAppWebLiveStatus(merchantId);
    res.json({
      success: true,
      data: {
        status: after.status,
        phoneNumber: after.phoneNumber,
        alreadyConnected: false
      }
    });
  } catch (error) {
    logger.error('Failed to start WhatsApp Web pairing', error as Error, {
      merchantId: req.merchantId
    });
    next(error);
  }
};

/**
 * GET /api/whatsapp/web/events
 * Merchant-scoped SSE: QR updates + connection status. Never leaks other tenants.
 */
export const streamWhatsAppWebEvents = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const merchantId = req.merchantId || req.userId;
    if (!merchantId) {
      return next(createError('Unauthorized', 401));
    }

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();
    (res as any).flush?.();

    writeSse(res, 'connected', {
      type: 'connected',
      merchantId,
      at: new Date().toISOString()
    });

    const live = getWhatsAppWebLiveStatus(merchantId);
    if (live.status !== 'connected' && live.status !== 'qr' && live.status !== 'connecting') {
      try {
        const existing = await getWhatsAppWebSession(merchantId);
        const hasActiveSession =
          existing &&
          (existing.status === 'qr' || existing.status === 'connecting' || existing.status === 'connected');
        if (!hasActiveSession) {
          await assertChannelSlotAvailable(merchantId, 'whatsapp');
        }
        void startWhatsAppWebPairing(merchantId).catch((error) => {
          logger.error('WhatsApp pairing from SSE failed', error as Error, { merchantId });
          writeSse(res, 'error', { type: 'error', message: 'تعذر بدء الربط. حاول مرة أخرى.' });
          (res as any).flush?.();
        });
      } catch (error: any) {
        writeSse(res, 'error', {
          type: 'error',
          message: error?.message || 'واتساب غير متاح في باقتك الحالية.'
        });
        (res as any).flush?.();
      }
    }

    const unsubscribe = subscribeWhatsAppPairing(merchantId, (event: WhatsAppWebPairingEvent) => {
      writeSse(res, event.type, event);
      (res as any).flush?.();
    });

    const heartbeat = setInterval(() => {
      try {
        writeSse(res, 'heartbeat', {
          type: 'heartbeat',
          merchantId,
          at: new Date().toISOString()
        });
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
