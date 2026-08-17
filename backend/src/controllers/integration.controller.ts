import { Response, NextFunction } from 'express';
import pool from '../database/connection.js';
import { createError } from '../middleware/errorHandler.js';
import { AuthRequest } from '../middleware/auth.js';
import { logger } from '../utils/logger.js';
import { getMerchantPlanLimits, getFacebookPagesCount } from '../utils/planLimits.js';
import { getFbLinkingSession, deleteFbLinkingSession } from './facebook.controller.js';
import { clearMerchantSocialPosts } from '../services/socialPostsSync.js';
import {
  FACEBOOK_PAGE_SUBSCRIBED_FIELDS,
  subscribeFacebookPageWebhooks
} from '../services/facebookPageWebhooks.js';
import { scheduleFacebookPageHistorySync } from '../services/metaConversationHistorySync.js';
import { clearMerchantChannelConversations } from '../services/metaConversationCleanup.js';

export { FACEBOOK_PAGE_SUBSCRIBED_FIELDS, subscribeFacebookPageWebhooks };
export const getIntegrations = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const [fbResult, shopifyResult, telegramResult, whatsappResult, igResult, whatsappWebResult] = await Promise.all([
      pool.query(
        `SELECT page_id, page_name, auto_reply_messenger, auto_reply_comments, last_sync,
                comment_reply_template, comment_dm_template, send_dm_on_comment,
                comment_automation_mode
         FROM facebook_pages WHERE merchant_id = $1`,
        [req.merchantId]
      ),
      pool.query(
        'SELECT shop_domain, last_sync FROM shopify_stores WHERE merchant_id = $1',
        [req.merchantId]
      ),
      pool.query(
        'SELECT telegram_bot_token FROM merchant_settings WHERE merchant_id = $1',
        [req.merchantId]
      ),
      pool.query(
        'SELECT phone_number, phone_number_id, auto_reply_enabled, last_sync FROM whatsapp_accounts WHERE merchant_id = $1 AND is_verified = true',
        [req.merchantId]
      ),
      pool.query(
        `SELECT ig_user_id, ig_username, auto_reply_comments, auto_reply_dm, send_dm_on_comment,
                comment_reply_template, comment_dm_template, comment_automation_mode, created_at
         FROM instagram_accounts WHERE merchant_id = $1 LIMIT 1`,
        [req.merchantId]
      ).catch(() => ({ rows: [] })),
      pool.query(
        `SELECT phone_number, auto_reply_enabled, last_connected_at, status
         FROM whatsapp_web_sessions
         WHERE merchant_id = $1 AND status = 'connected'
         LIMIT 1`,
        [req.merchantId]
      ).catch(() => ({ rows: [] }))
    ]);

    // Get Telegram bot info if token exists
    let telegramInfo: any = { isConnected: false };
    if (telegramResult.rows.length > 0 && telegramResult.rows[0].telegram_bot_token) {
      const botToken = telegramResult.rows[0].telegram_bot_token;
      try {
        // Get bot info from Telegram API
        const botInfoResponse = await fetch(`https://api.telegram.org/bot${botToken}/getMe`);
        const botInfo = await botInfoResponse.json() as { ok: boolean; result?: { username?: string; id: number; first_name?: string } };
        
        if (botInfo.ok && botInfo.result) {
          telegramInfo = {
            isConnected: true,
            accountName: botInfo.result.username || 'Unknown Bot',
            botId: botInfo.result.id,
            firstName: botInfo.result.first_name
          };
        }
      } catch (error) {
        logger.warn('Failed to get Telegram bot info', { error });
        // Still mark as connected if token exists
        telegramInfo = {
          isConnected: true,
          accountName: 'Unknown Bot'
        };
      }
    }

    res.json({
      success: true,
      data: {
        facebook: fbResult.rows.length > 0 ? {
          isConnected: true,
          accountName: fbResult.rows[0].page_name,
          platformId: fbResult.rows[0].page_id,
          lastSync: fbResult.rows[0].last_sync,
          commentReplyTemplate: fbResult.rows[0].comment_reply_template ?? null,
          commentDmTemplate: fbResult.rows[0].comment_dm_template ?? null,
          sendDmOnComment: fbResult.rows[0].send_dm_on_comment === true,
          commentAutomationMode: fbResult.rows[0].comment_automation_mode || 'template_all',
          pages: fbResult.rows.map((r: any) => ({
            pageId: r.page_id,
            pageName: r.page_name,
            autoReplyMessenger: r.auto_reply_messenger,
            autoReplyComments: r.auto_reply_comments,
            commentAutomationMode: r.comment_automation_mode || 'template_all',
          })),
        } : { isConnected: false },
        shopify: shopifyResult.rows.length > 0 ? {
          isConnected: true,
          accountName: shopifyResult.rows[0].shop_domain,
          lastSync: shopifyResult.rows[0].last_sync
        } : { isConnected: false },
        telegram: telegramInfo,
        whatsapp: whatsappWebResult.rows.length > 0 ? {
          isConnected: true,
          accountName: whatsappWebResult.rows[0].phone_number,
          platformId: whatsappWebResult.rows[0].phone_number,
          lastSync: whatsappWebResult.rows[0].last_connected_at,
          connectionMode: 'web',
          autoReplyEnabled: whatsappWebResult.rows[0].auto_reply_enabled === true
        } : whatsappResult.rows.length > 0 ? {
          isConnected: true,
          accountName: whatsappResult.rows[0].phone_number,
          platformId: whatsappResult.rows[0].phone_number_id,
          lastSync: whatsappResult.rows[0].last_sync,
          connectionMode: 'cloud',
          autoReplyEnabled: whatsappResult.rows[0].auto_reply_enabled === true
        } : { isConnected: false },
        instagram: igResult.rows.length > 0 ? {
          isConnected: true,
          accountName: igResult.rows[0].ig_username || 'Instagram',
          platformId: igResult.rows[0].ig_user_id,
          autoReplyComments: igResult.rows[0].auto_reply_comments,
          autoReplyDM: igResult.rows[0].auto_reply_dm,
          sendDmOnComment: igResult.rows[0].send_dm_on_comment,
          commentReplyTemplate: igResult.rows[0].comment_reply_template ?? null,
          commentDmTemplate: igResult.rows[0].comment_dm_template ?? null,
          commentAutomationMode: igResult.rows[0].comment_automation_mode || 'template_all',
          connectedAt: igResult.rows[0].created_at
        } : { isConnected: false }
      }
    });
  } catch (error) {
    next(error);
  }
};

export const connectFacebook = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    // Check if Facebook App credentials are configured
    const fbAppId = process.env.FACEBOOK_APP_ID;
    const fbAppSecret = process.env.FACEBOOK_APP_SECRET;
    const redirectUri =
      process.env.FACEBOOK_REDIRECT_URI ||
      `${process.env.CORS_ORIGIN}/api/integrations/facebook/callback`;

    if (!fbAppId || !fbAppSecret) {
      return res.json({
        success: false,
        message: 'Facebook OAuth is not configured. Please set FACEBOOK_APP_ID and FACEBOOK_APP_SECRET in environment variables.',
        requiresSetup: true
      });
    }

    // Generate OAuth URL
    // pages_show_list is required for GET /me/accounts (especially on mobile Meta dialogs).
    const state = Buffer.from(JSON.stringify({ merchantId: req.merchantId })).toString('base64');
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
      // Force Meta to re-show page/business pickers (critical on mobile + Business Suite).
      `&auth_type=rerequest`;

    res.json({
      success: true,
      data: {
        authUrl,
        message: 'Redirect user to this URL to authorize Facebook access'
      }
    });
  } catch (error) {
    next(error);
  }
};

export const updateFacebookCommentSettings = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const { commentReplyTemplate, commentDmTemplate, sendDmOnComment } = req.body as {
      commentReplyTemplate?: string;
      commentDmTemplate?: string;
      sendDmOnComment?: boolean;
    };

    const updates: string[] = [];
    const values: unknown[] = [];
    let i = 1;

    if (typeof commentReplyTemplate === 'string') {
      updates.push(`comment_reply_template = $${i++}`);
      values.push(commentReplyTemplate.trim() === '' ? null : commentReplyTemplate.slice(0, 2000));
    }
    if (typeof commentDmTemplate === 'string') {
      updates.push(`comment_dm_template = $${i++}`);
      values.push(commentDmTemplate.trim() === '' ? null : commentDmTemplate.slice(0, 2000));
    }
    if (typeof sendDmOnComment === 'boolean') {
      updates.push(`send_dm_on_comment = $${i++}`);
      values.push(sendDmOnComment);
    }

    if (updates.length === 0) {
      return next(createError('No fields to update', 400));
    }

    updates.push('updated_at = CURRENT_TIMESTAMP');
    values.push(req.merchantId);

    const r = await pool.query(
      `UPDATE facebook_pages SET ${updates.join(', ')} WHERE merchant_id = $${i}`,
      values
    );

    if (r.rowCount === 0) {
      return next(createError('No Facebook page connected', 404));
    }

    res.json({ success: true, message: 'Facebook comment settings updated' });
  } catch (error) {
    next(error);
  }
};

export const getAvailableFacebookPages = async (
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
      return next(createError('انتهت صلاحية جلسة الربط. أعد ربط فيسبوك من صفحة التكاملات.', 410));
    }

    if (session.merchantId !== req.merchantId) {
      return next(createError('غير مصرح', 403));
    }

    const existingPagesResult = await pool.query(
      `SELECT page_id, page_name FROM facebook_pages WHERE merchant_id = $1`,
      [req.merchantId]
    );
    const alreadyLinked = new Set(
      existingPagesResult.rows.map((r: { page_id: string }) => String(r.page_id))
    );

    const planLimits = await getMerchantPlanLimits(req.merchantId!);
    const currentCount = await getFacebookPagesCount(req.merchantId!);

    const availablePages = session.pages.map(p => ({
      id: p.id,
      name: p.name,
      category: p.category || null,
      pictureUrl: p.picture?.data?.url || null,
      alreadyLinked: alreadyLinked.has(String(p.id)),
    }));

    res.json({
      success: true,
      data: {
        pages: availablePages,
        limits: {
          maxFacebookPages: planLimits.maxFacebookPages,
          currentLinkedCount: currentCount,
          remainingSlots: planLimits.maxFacebookPages === -1
            ? -1
            : Math.max(0, planLimits.maxFacebookPages - currentCount),
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

export const linkFacebookPages = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const { session: sessionId, pageIds } = req.body as {
      session: string;
      pageIds: string[];
    };

    if (!sessionId) {
      return next(createError('معرّف الجلسة مطلوب', 400));
    }
    if (!Array.isArray(pageIds) || pageIds.length === 0) {
      return next(createError('يرجى اختيار صفحة واحدة على الأقل', 400));
    }

    const session = getFbLinkingSession(sessionId);
    if (!session) {
      return next(createError('انتهت صلاحية جلسة الربط. أعد ربط فيسبوك من صفحة التكاملات.', 410));
    }

    if (session.merchantId !== req.merchantId) {
      return next(createError('غير مصرح', 403));
    }

    const planLimits = await getMerchantPlanLimits(req.merchantId!);
    const maxFacebookPages = planLimits.maxFacebookPages;

    const existingPagesResult = await pool.query(
      `SELECT page_id FROM facebook_pages WHERE merchant_id = $1`,
      [req.merchantId]
    );
    const alreadyLinkedPageIds = new Set(
      existingPagesResult.rows.map((r: { page_id: string }) => String(r.page_id))
    );
    let linkedCount = alreadyLinkedPageIds.size;

    const newPageIds = pageIds.filter(pid => !alreadyLinkedPageIds.has(String(pid)));

    if (maxFacebookPages !== -1 && linkedCount + newPageIds.length > maxFacebookPages) {
      const remaining = Math.max(0, maxFacebookPages - linkedCount);
      return next(
        createError(
          `باقتك الحالية تسمح بربط ${maxFacebookPages} صفحة فقط. يمكنك إضافة ${remaining} صفحة إضافية كحد أقصى.`,
          403,
          true,
          'FACEBOOK_PAGES_LIMIT'
        )
      );
    }

    const sessionPagesMap = new Map(session.pages.map(p => [String(p.id), p]));

    const merchantSettingsResult = await pool.query(
      'SELECT auto_reply_messenger, auto_reply_comments FROM merchant_settings WHERE merchant_id = $1',
      [req.merchantId]
    );
    const defaultAutoReplyMessenger =
      merchantSettingsResult.rows[0]?.auto_reply_messenger ?? true;
    const defaultAutoReplyComments =
      merchantSettingsResult.rows[0]?.auto_reply_comments ?? true;

    let newlyLinked = 0;

    for (const pageId of pageIds) {
      const pageData = sessionPagesMap.get(String(pageId));
      if (!pageData) {
        logger.warn('linkFacebookPages: page not found in session', { pageId, merchantId: req.merchantId });
        continue;
      }

      let pageAccessToken = pageData.access_token;
      try {
        const longLivedResponse = await fetch(
          `https://graph.facebook.com/v21.0/${pageData.id}?fields=access_token&access_token=${session.userAccessToken}`
        );
        const longLivedData = await longLivedResponse.json() as { access_token?: string };
        if (longLivedData.access_token) {
          pageAccessToken = longLivedData.access_token;
        }
      } catch (e) {
        logger.warn('Failed to get long-lived token for page', { pageId });
      }

      if (!pageAccessToken) {
        logger.warn('linkFacebookPages: missing page access token', { pageId });
        continue;
      }

      await pool.query(
        `INSERT INTO facebook_pages (merchant_id, page_id, page_name, access_token, auto_reply_messenger, auto_reply_comments)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (merchant_id, page_id)
         DO UPDATE SET access_token = $4, page_name = $3, updated_at = CURRENT_TIMESTAMP`,
        [req.merchantId, pageData.id, pageData.name, pageAccessToken, defaultAutoReplyMessenger, defaultAutoReplyComments]
      );

      if (!alreadyLinkedPageIds.has(String(pageData.id))) {
        newlyLinked += 1;
        linkedCount += 1;
      }

      try {
        const { ok, data: subscribeData } = await subscribeFacebookPageWebhooks(
          pageData.id,
          pageAccessToken
        );
        if (!ok) {
          logger.warn(`Failed to subscribe page ${pageData.id} webhooks`, subscribeData as Record<string, any>);
        } else {
          logger.info(`Subscribed page ${pageData.id} webhooks`, {
            fields: FACEBOOK_PAGE_SUBSCRIBED_FIELDS
          });
        }
      } catch (subErr) {
        logger.error(`Error subscribing page ${pageData.id}`, subErr as Error);
      }

      // Auto-import recent Messenger history for this page (non-blocking).
      scheduleFacebookPageHistorySync({
        merchantId: req.merchantId!,
        pageId: String(pageData.id),
        accessToken: pageAccessToken,
      });
    }

    deleteFbLinkingSession(sessionId);

    logger.info('Facebook pages linked via selection', {
      merchantId: req.merchantId,
      selectedCount: pageIds.length,
      newlyLinked,
      totalLinked: linkedCount,
    });

    res.json({
      success: true,
      message: `تم ربط ${newlyLinked} صفحة بنجاح`,
      data: { newlyLinked, totalLinked: linkedCount },
    });
  } catch (error) {
    next(error);
  }
};

export const disconnectFacebookPage = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const { pageId } = req.params;
    if (!pageId) {
      return next(createError('معرّف الصفحة مطلوب', 400));
    }

    const result = await pool.query(
      'DELETE FROM facebook_pages WHERE merchant_id = $1 AND page_id = $2',
      [req.merchantId, pageId]
    );

    if (result.rowCount === 0) {
      return next(createError('الصفحة غير موجودة', 404));
    }

    // Remove synced posts for this page so they no longer appear in the dashboard
    await clearMerchantSocialPosts(req.merchantId!, 'facebook', pageId);
    // Remove Messenger threads belonging to this page (messages cascade)
    await clearMerchantChannelConversations({
      merchantId: req.merchantId!,
      platform: 'facebook_messenger',
      accountId: pageId,
    });

    res.json({
      success: true,
      message: 'تم إلغاء ربط الصفحة بنجاح',
    });
  } catch (error) {
    next(error);
  }
};

export const disconnectFacebook = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    await pool.query(
      'DELETE FROM facebook_pages WHERE merchant_id = $1',
      [req.merchantId]
    );

    await clearMerchantSocialPosts(req.merchantId!, 'facebook');
    await clearMerchantChannelConversations({
      merchantId: req.merchantId!,
      platform: 'facebook_messenger',
    });

    res.json({
      success: true,
      message: 'Facebook disconnected successfully'
    });
  } catch (error) {
    next(error);
  }
};

export const connectShopify = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const { shopDomain } = req.body;

    if (!shopDomain) {
      return next(createError('Shop domain is required', 400));
    }

    // Validate shop domain format (should be like "mystore.myshopify.com" or "mystore")
    // Clean up common mistakes
    let cleanedDomain = shopDomain
      .replace(/^https?:\/\//, '') // Remove protocol
      .replace(/\/.*$/, '') // Remove path
      .replace(/\.myshopify\.com$/, '') // Remove .myshopify.com if present
      .replace(/\.com$/, '') // Remove .com if user entered it by mistake
      .replace(/\.$/, '') // Remove trailing dot
      .trim();
    
    const normalizedDomain = `${cleanedDomain}.myshopify.com`;

    // Check if Shopify App credentials are configured
    const shopifyApiKey = process.env.SHOPIFY_API_KEY;
    const shopifyApiSecret = process.env.SHOPIFY_API_SECRET;
    const redirectUri = process.env.SHOPIFY_REDIRECT_URI || `${process.env.CORS_ORIGIN}/integrations/shopify/callback`;

    if (!shopifyApiKey || !shopifyApiSecret) {
      return res.json({
        success: false,
        message: 'Shopify OAuth is not configured. Please set SHOPIFY_API_KEY and SHOPIFY_API_SECRET in environment variables.',
        requiresSetup: true
      });
    }

    // Generate OAuth URL
    const state = Buffer.from(JSON.stringify({ merchantId: req.merchantId, shopDomain: normalizedDomain })).toString('base64');
    const scopes = 'read_products,write_products,read_orders,write_orders,read_customers';
    const authUrl = `https://${normalizedDomain}/admin/oauth/authorize?client_id=${shopifyApiKey}&scope=${scopes}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}`;

    res.json({
      success: true,
      data: {
        authUrl,
        shopDomain: normalizedDomain,
        message: 'Redirect user to this URL to authorize Shopify access'
      }
    });
  } catch (error) {
    next(error);
  }
};

export const disconnectShopify = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    await pool.query(
      'DELETE FROM shopify_stores WHERE merchant_id = $1',
      [req.merchantId]
    );

    res.json({
      success: true,
      message: 'Shopify disconnected successfully'
    });
  } catch (error) {
    next(error);
  }
};

// Note: syncShopifyProducts and syncShopifyOrders are now in shopify.controller.ts

