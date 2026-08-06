/**
 * SSE stream for merchant inbox realtime updates.
 */

import { Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth.js';
import { createError } from '../middleware/errorHandler.js';
import {
  subscribeMerchantInbox,
  type InboxRealtimeEvent,
} from '../services/inbox/inboxRealtime.js';
import { logger } from '../utils/logger.js';

function writeSse(res: Response, event: string, data: unknown) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

/**
 * GET /api/conversations/stream
 * Long-lived SSE — merchant-scoped events only.
 */
export const streamInboxEvents = async (
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
    res.setHeader('X-Accel-Buffering', 'no'); // nginx
    res.flushHeaders?.();

    // Disable compression buffering if present
    (res as any).flush?.();

    writeSse(res, 'connected', {
      type: 'connected',
      merchantId,
      at: new Date().toISOString(),
    });

    const unsubscribe = subscribeMerchantInbox(merchantId, (event: InboxRealtimeEvent) => {
      if (event.merchantId !== merchantId) return;
      writeSse(res, event.type, event);
      (res as any).flush?.();
    });

    const heartbeat = setInterval(() => {
      try {
        writeSse(res, 'heartbeat', {
          type: 'heartbeat',
          merchantId,
          at: new Date().toISOString(),
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

    logger.info('Inbox SSE client connected', { merchantId });
  } catch (error) {
    next(error);
  }
};
