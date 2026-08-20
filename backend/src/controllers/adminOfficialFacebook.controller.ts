/**
 * Super-admin endpoints for linking the official XO Bot Facebook page
 * and managing the platform page bot (separate from merchant integrations).
 */

import { Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth.js';
import { createError } from '../middleware/errorHandler.js';
import { logger } from '../utils/logger.js';
import {
  getFbLinkingSession,
  deleteFbLinkingSession,
} from './facebook.controller.js';
import {
  FACEBOOK_PAGE_SUBSCRIBED_FIELDS,
  subscribeFacebookPageWebhooks,
} from '../services/facebookPageWebhooks.js';
import {
  ensurePlatformFacebookTables,
  getLinkedPlatformFacebookPage,
  linkPlatformFacebookPage,
  unlinkPlatformFacebookPage,
  toPublicPlatformPage,
} from '../services/platformFacebookPage.js';
import { OFFICIAL_PAGE_BOT_DEFAULT_SYSTEM_MESSAGE } from '../services/officialPageBot.js';
import pool from '../database/connection.js';

function sanitizeAdminBasePath(raw: unknown): string {
  const fallback =
    process.env.ADMIN_FRONTEND_BASE_PATH ||
    process.env.VITE_ADMIN_BASE_PATH ||
    '/ops-change-me-to-a-random-path';
  let p = typeof raw === 'string' ? raw.trim() : '';
  if (!p) p = String(fallback).trim();
  if (!p.startsWith('/')) p = `/${p}`;
  p = p.replace(/\/+$/, '') || String(fallback);
  // Only allow a single path segment (obscured admin base)
  if (!/^\/[A-Za-z0-9_-]{8,128}$/.test(p)) {
    return String(fallback).startsWith('/')
      ? String(fallback).replace(/\/+$/, '')
      : `/${String(fallback)}`.replace(/\/+$/, '');
  }
  return p;
}

export const connectOfficialFacebook = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const fbAppId = process.env.FACEBOOK_APP_ID;
    const fbAppSecret = process.env.FACEBOOK_APP_SECRET;
    const redirectUri =
      process.env.FACEBOOK_REDIRECT_URI ||
      `${process.env.CORS_ORIGIN}/api/integrations/facebook/callback`;

    if (!fbAppId || !fbAppSecret) {
      return res.json({
        success: false,
        message:
          'Facebook OAuth is not configured. Please set FACEBOOK_APP_ID and FACEBOOK_APP_SECRET.',
        requiresSetup: true,
      });
    }

    const adminBasePath = sanitizeAdminBasePath(
      (req.body as { adminBasePath?: string })?.adminBasePath
    );

    const state = Buffer.from(
      JSON.stringify({
        purpose: 'official_page',
        adminId: req.merchantId,
        adminBasePath,
      })
    ).toString('base64');

    const scopes = [
      'pages_show_list',
      'pages_manage_metadata',
      'pages_read_engagement',
      'pages_messaging',
      'pages_manage_posts',
      'publish_video',
      'pages_manage_engagement',
      'business_management',
    ].join(',');

    const authUrl =
      `https://www.facebook.com/v21.0/dialog/oauth` +
      `?client_id=${fbAppId}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&state=${encodeURIComponent(state)}` +
      `&scope=${encodeURIComponent(scopes)}` +
      `&response_type=code` +
      `&auth_type=rerequest`;

    res.json({
      success: true,
      data: {
        authUrl,
        message: 'Redirect admin to authorize official Facebook page access',
      },
    });
  } catch (error) {
    next(error);
  }
};

export const getOfficialFacebookStatus = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    await ensurePlatformFacebookTables();
    const page = await getLinkedPlatformFacebookPage();

    let botSettings = {
      enabled: false,
      systemMessage: OFFICIAL_PAGE_BOT_DEFAULT_SYSTEM_MESSAGE,
    };
    try {
      const settingsResult = await pool.query(
        `SELECT value::jsonb FROM global_settings WHERE key = 'admin_global_settings' LIMIT 1`
      );
      const value = settingsResult.rows[0]?.value || {};
      const bot = value?.bots?.officialPageBot || {};
      botSettings = {
        enabled:
          typeof bot.enabled === 'boolean'
            ? bot.enabled
            : Boolean(value?.features?.officialPageBotEnabled),
        systemMessage:
          typeof bot.systemMessage === 'string' && bot.systemMessage.trim()
            ? bot.systemMessage
            : OFFICIAL_PAGE_BOT_DEFAULT_SYSTEM_MESSAGE,
      };
    } catch {
      /* defaults */
    }

    res.json({
      success: true,
      data: {
        linked: !!page,
        page: toPublicPlatformPage(page),
        bot: botSettings,
      },
    });
  } catch (error) {
    next(error);
  }
};

export const getOfficialAvailableFacebookPages = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const sessionId = req.query.session as string;
    if (!sessionId) {
      return next(createError('معرّف الجلسة مطلوب', 400));
    }

    const session = getFbLinkingSession(sessionId);
    if (!session) {
      return next(
        createError('انتهت صلاحية جلسة الربط. أعد ربط فيسبوك من إعدادات السوبر أدمن.', 410)
      );
    }

    if (session.purpose !== 'official_page') {
      return next(createError('جلسة الربط غير مخصصة للصفحة الرسمية', 403));
    }

    if (session.adminId && session.adminId !== req.merchantId) {
      return next(createError('غير مصرح', 403));
    }

    const availablePages = session.pages.map((p) => ({
      id: p.id,
      name: p.name,
      category: p.category || null,
      pictureUrl: p.picture?.data?.url || null,
    }));

    res.json({
      success: true,
      data: { pages: availablePages },
    });
  } catch (error) {
    next(error);
  }
};

export const linkOfficialFacebookPage = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const { session: sessionId, pageId } = req.body as {
      session: string;
      pageId: string;
    };

    if (!sessionId) {
      return next(createError('معرّف الجلسة مطلوب', 400));
    }
    if (!pageId || typeof pageId !== 'string') {
      return next(createError('يرجى اختيار صفحة واحدة', 400));
    }

    const session = getFbLinkingSession(sessionId);
    if (!session) {
      return next(
        createError('انتهت صلاحية جلسة الربط. أعد ربط فيسبوك من إعدادات السوبر أدمن.', 410)
      );
    }

    if (session.purpose !== 'official_page') {
      return next(createError('جلسة الربط غير مخصصة للصفحة الرسمية', 403));
    }

    if (session.adminId && session.adminId !== req.merchantId) {
      return next(createError('غير مصرح', 403));
    }

    const pageData = session.pages.find((p) => String(p.id) === String(pageId));
    if (!pageData) {
      return next(createError('الصفحة غير موجودة في جلسة الربط', 404));
    }

    let pageAccessToken = pageData.access_token;
    try {
      const longLivedResponse = await fetch(
        `https://graph.facebook.com/v21.0/${pageData.id}?fields=access_token&access_token=${session.userAccessToken}`
      );
      const longLivedData = (await longLivedResponse.json()) as { access_token?: string };
      if (longLivedData.access_token) {
        pageAccessToken = longLivedData.access_token;
      }
    } catch {
      logger.warn('Official page: failed to refresh page access token', { pageId });
    }

    if (!pageAccessToken) {
      return next(createError('تعذر الحصول على رمز الوصول للصفحة', 400));
    }

    const linked = await linkPlatformFacebookPage({
      pageId: String(pageData.id),
      pageName: pageData.name || String(pageData.id),
      accessToken: pageAccessToken,
      linkedByMerchantId: req.merchantId || null,
    });

    try {
      const { ok, data: subscribeData } = await subscribeFacebookPageWebhooks(
        linked.page_id,
        pageAccessToken
      );
      if (!ok) {
        logger.warn('Failed to subscribe official page webhooks', subscribeData as Record<string, unknown>);
      } else {
        logger.info('Subscribed official page webhooks', {
          pageId: linked.page_id,
          fields: FACEBOOK_PAGE_SUBSCRIBED_FIELDS,
        });
      }
    } catch (subErr) {
      logger.error('Error subscribing official page', subErr as Error);
    }

    deleteFbLinkingSession(sessionId);

    res.json({
      success: true,
      message: 'تم ربط الصفحة الرسمية بنجاح',
      data: {
        message: 'تم ربط الصفحة الرسمية بنجاح',
        page: toPublicPlatformPage(linked),
      },
    });
  } catch (error) {
    next(error);
  }
};

export const disconnectOfficialFacebook = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const removed = await unlinkPlatformFacebookPage();
    res.json({
      success: true,
      message: removed ? 'تم فصل الصفحة الرسمية' : 'لا توجد صفحة رسمية مربوطة',
      data: {
        message: removed ? 'تم فصل الصفحة الرسمية' : 'لا توجد صفحة رسمية مربوطة',
        disconnected: removed,
      },
    });
  } catch (error) {
    next(error);
  }
};

/** Used by facebook OAuth callback to build admin settings redirect */
export function buildOfficialFacebookSelectRedirect(
  sessionId: string,
  adminBasePath?: string
): string {
  const corsOrigin = process.env.CORS_ORIGIN || 'https://xo-bot.com';
  const adminBase = sanitizeAdminBasePath(adminBasePath);
  return `${corsOrigin}${adminBase}/settings?facebook=select_pages&fb_session=${encodeURIComponent(sessionId)}`;
}

export function buildOfficialFacebookErrorRedirect(
  reason: string,
  adminBasePath?: string
): string {
  const corsOrigin = process.env.CORS_ORIGIN || 'https://xo-bot.com';
  const adminBase = sanitizeAdminBasePath(adminBasePath);
  return `${corsOrigin}${adminBase}/settings?facebook=error&reason=${encodeURIComponent(reason)}`;
}
