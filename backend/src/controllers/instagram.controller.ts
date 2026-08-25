import { Response, NextFunction, Request } from 'express';
import crypto from 'crypto';
import pool from '../database/connection.js';
import { createError } from '../middleware/errorHandler.js';
import { AuthRequest } from '../middleware/auth.js';
import { logger } from '../utils/logger.js';
import type { Message, ConversationState, MerchantConfig } from '../bot/index.js';
import { checkRateLimit, getCachedMerchantSettings } from '../services/cacheService.js';
import {
  extractImageUrl,
  extractOrderData,
  persistOrderIfPresent,
  runSalesBotTurn,
} from '../services/channels/botTurn.js';
import { buildMerchantBotConfig } from '../services/buildMerchantBotConfig.js';
import { stripInternalControlMarkers } from '../response/sanitize-reply.js';
import {
  deliverHumanLikeReply,
  startTypingKeepalive
} from '../services/channels/replyDelivery.js';
import {
  conversationIngressQueue,
  mergeMessengerStylePayloads
} from '../services/conversationIngressQueue.js';
import {
  ensureConversationCustomerName,
  isPlaceholderCustomerName,
  bindConversationChannelAccount,
} from '../services/socialProfile.js';
import { analyzeImageAndSearch, imageUrlToBase64 } from '../services/imageRecognition.js';
import {
  resolveInboundVoice,
  voiceTranscriptionFallbackMessage
} from '../services/voiceTranscription.js';
import { getCurrencyDisplayName } from '../utils/currencyDisplayName.js';
import { withOAuthCodeDedup } from '../utils/oauthCodeDedup.js';
import {
  resolveManagedFacebookPages,
  fetchGrantedFacebookPermissions,
  type FacebookManagedPage,
} from '../utils/facebookPages.js';
import {
  applyCommentTemplate,
  clampSocialText,
  DEFAULT_COMMENT_REPLY,
  DEFAULT_DM_AFTER_COMMENT
} from '../services/socialCommentReplies.js';
import { normalizePageFeedCommentValue, isPageFeedCommentEvent } from '../services/pageFeedCommentPayload.js';
import { runCommentAutomation } from '../services/socialCommentAutomation.js';
import { sendInstagramCommentReply } from '../services/instagramCommentGraph.js';
import {
  applyAcquisitionToConversation,
  buildAcquisitionContextNote,
  extractReferralFromMessagingEvent,
  resolveProductForExternalContent,
  type AcquisitionContext
} from '../services/socialAcquisition.js';
import { getProductById } from '../catalog/product-search.js';
import { clearMerchantSocialPosts } from '../services/socialPostsSync.js';
import {
  FACEBOOK_PAGE_SUBSCRIBED_FIELDS,
  subscribeFacebookPageWebhooks
} from '../services/facebookPageWebhooks.js';
import { scheduleInstagramAccountHistorySync } from '../services/metaConversationHistorySync.js';
import { clearMerchantChannelConversations } from '../services/metaConversationCleanup.js';

// ==================== HELPERS ====================

const isValidUUID = (str: string | null | undefined): boolean => {
  if (!str) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
};

const verifyInstagramSignature = (req: any, secret: string): boolean => {
  const sig = req.headers['x-hub-signature-256'] || req.headers['x-hub-signature'];
  if (!sig) return false;

  const payload: Buffer = req.rawBody
    ? (Buffer.isBuffer(req.rawBody) ? req.rawBody : Buffer.from(String(req.rawBody), 'utf8'))
    : Buffer.from(JSON.stringify(req.body ?? {}), 'utf8');

  const algo = (sig as string).startsWith('sha256=') ? 'sha256' : 'sha1';
  const expected = `${algo}=${crypto.createHmac(algo, secret).update(payload).digest('hex')}`;

  const a = Buffer.from(sig as string, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
};

// ==================== INSTAGRAM GRAPH API HELPERS ====================

const INSTAGRAM_GRAPH_VERSION = process.env.FACEBOOK_GRAPH_VERSION || 'v21.0';

/** Scopes required to list pages and read linked IG business accounts (incl. Business Manager assets). */
const INSTAGRAM_OAUTH_SCOPES = [
  'pages_show_list',
  'pages_read_engagement',
  'pages_manage_metadata',
  'pages_messaging',
  'business_management',
  'instagram_basic',
  'instagram_manage_comments',
  'instagram_manage_messages',
  'instagram_content_publish'
].join(',');

type ManagedFacebookPage = FacebookManagedPage;

const IG_PAGE_FIELDS =
  'id,name,access_token,instagram_business_account{id,username}';

/**
 * Meta may expose the linked IG account on `instagram_business_account` or only on `/instagram_accounts`.
 * @see https://developers.facebook.com/docs/graph-api/reference/page/instagram_accounts/
 */
const resolveLinkedInstagramBusinessAccount = async (
  page: ManagedFacebookPage,
  userAccessToken: string
): Promise<{ igBusinessId: string; pageAccessToken: string; igUsername?: string } | null> => {
  const preloadedId = page.instagram_business_account?.id;
  if (preloadedId) {
    return {
      igBusinessId: preloadedId,
      pageAccessToken: page.access_token || userAccessToken,
      igUsername: page.instagram_business_account?.username
    };
  }

  const pageDetailResp = await fetch(
    `https://graph.facebook.com/${INSTAGRAM_GRAPH_VERSION}/${page.id}` +
    `?fields=access_token,instagram_business_account{id,username}` +
    `&access_token=${encodeURIComponent(userAccessToken)}`
  );
  const pageDetail = (await pageDetailResp.json()) as {
    access_token?: string;
    instagram_business_account?: { id?: string; username?: string };
    error?: { message?: string; code?: number };
  };
  const pageAccessToken = pageDetail.access_token || page.access_token || userAccessToken;

  if (pageDetail.instagram_business_account?.id) {
    return {
      igBusinessId: pageDetail.instagram_business_account.id,
      pageAccessToken,
      igUsername: pageDetail.instagram_business_account.username
    };
  }

  const edgeResp = await fetch(
    `https://graph.facebook.com/${INSTAGRAM_GRAPH_VERSION}/${page.id}/instagram_accounts` +
    `?fields=id,username&access_token=${encodeURIComponent(pageAccessToken)}`
  );
  const edgeData = (await edgeResp.json()) as {
    data?: Array<{ id?: string; username?: string }>;
    error?: { message?: string; code?: number };
  };
  const edgeAccount = edgeData.data?.[0];
  if (edgeAccount?.id) {
    return {
      igBusinessId: edgeAccount.id,
      pageAccessToken,
      igUsername: edgeAccount.username
    };
  }

  logger.warn('Instagram OAuth: page has no linked IG account in Graph API', {
    pageId: page.id,
    pageName: page.name || null,
    fieldError: pageDetail.error?.message || null,
    edgeError: edgeData.error?.message || null,
    edgeCount: edgeData.data?.length ?? 0
  });
  return null;
};

/**
 * أول رسالة خاصة بعد تعليق — يجب استخدام comment_id على مسار الصفحة (Private Replies).
 * لا يعمل استبدالها بـ recipient.id لأن المستخدم لم يبدأ محادثة بعد.
 * @see https://developers.facebook.com/docs/messenger-platform/instagram/features/private-replies/
 */
const sendInstagramPrivateReplyAfterComment = async (
  pageId: string,
  commentId: string,
  message: string,
  accessToken: string
): Promise<boolean> => {
  try {
    const url =
      `https://graph.facebook.com/${INSTAGRAM_GRAPH_VERSION}/${encodeURIComponent(pageId)}/messages` +
      `?access_token=${encodeURIComponent(accessToken)}`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipient: { comment_id: commentId },
        message: { text: message }
      })
    });
    const data = await resp.json() as any;
    if (!resp.ok) {
      logger.error(
        'Instagram private reply after comment failed',
        new Error(JSON.stringify(data)),
        { pageId, commentId }
      );
      return false;
    }
    return true;
  } catch (error) {
    logger.error('Error sending Instagram private reply', error as Error, { pageId, commentId });
    return false;
  }
};

const sendInstagramDM = async (
  igScopedUserId: string,
  message: string,
  accessToken: string
): Promise<boolean> => {
  try {
    // 💡 السطر السحري لإنستغرام لمطابقة النص العربي في مراجعة Meta
    logger.info('Sending Instagram DM via Meta Graph API', {
      recipientId: igScopedUserId,
      messageLength: (message || '').length,
    });
    const url =
      `https://graph.facebook.com/v21.0/me/messages` +
      `?access_token=${encodeURIComponent(accessToken)}`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipient: { id: igScopedUserId },
        message: { text: message }
      })
    });
    const data = await resp.json() as any;
    if (!resp.ok) {
      logger.error('Instagram DM send failed', new Error(JSON.stringify(data)), { igScopedUserId });
      return false;
    }
    return true;
  } catch (error) {
    logger.error('Error sending Instagram DM', error as Error, { igScopedUserId });
    return false;
  }
};

const sendInstagramTyping = async (
  igScopedUserId: string,
  isTyping: boolean,
  accessToken: string
): Promise<void> => {
  try {
    const url =
      `https://graph.facebook.com/v21.0/me/messages` +
      `?access_token=${encodeURIComponent(accessToken)}`;
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipient: { id: igScopedUserId },
        sender_action: isTyping ? 'typing_on' : 'typing_off'
      })
    });
  } catch (error) {
    logger.debug('Instagram typing indicator error', {
      error: error instanceof Error ? error.message : String(error),
      igScopedUserId
    });
  }
};

const sendInstagramImage = async (
  igScopedUserId: string,
  imageUrl: string,
  caption: string,
  accessToken: string
): Promise<boolean> => {
  try {
    const url =
      `https://graph.facebook.com/v21.0/me/messages` +
      `?access_token=${encodeURIComponent(accessToken)}`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipient: { id: igScopedUserId },
        message: {
          attachment: {
            type: 'image',
            payload: { url: imageUrl, is_reusable: false }
          }
        }
      })
    });
    const data = await resp.json() as any;
    if (!resp.ok) {
      logger.error('Instagram API error sending image', new Error(JSON.stringify(data)), { igScopedUserId });
      return false;
    }
    if (caption && caption.trim()) {
      await sendInstagramDM(igScopedUserId, caption, accessToken);
    }
    return true;
  } catch (error) {
    logger.error('Error sending Instagram image', error as Error, { igScopedUserId });
    return false;
  }
};

// ==================== OAUTH ====================

const instagramOAuthCorsOrigin = () => process.env.CORS_ORIGIN || 'https://xo-bot.com';

const buildInstagramIntegrationRedirect = (params: Record<string, string>) => {
  const q = new URLSearchParams(params);
  return `${instagramOAuthCorsOrigin()}/app/integrations?${q.toString()}`;
};

/** OAuth errors → redirect to SPA with query params (avoid raw JSON in the browser). */
const redirectInstagramIntegration = (res: Response, params: Record<string, string>) => {
  res.redirect(buildInstagramIntegrationRedirect(params));
};

const decodeBase64Url = (input: string): Buffer => {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  return Buffer.from(padded, 'base64');
};

/**
 * Meta "Deauthorize Callback" for Instagram/Facebook Login.
 * Accepts `signed_request` and returns HTTP 200 to acknowledge.
 */
export const instagramDeauthorizeCallback = async (req: Request, res: Response) => {
  try {
    const signedRequest = String((req.body as any)?.signed_request || req.query?.signed_request || '');
    if (!signedRequest || !signedRequest.includes('.')) {
      logger.warn('Instagram deauthorize callback: missing signed_request');
      return res.status(200).json({ success: true });
    }

    const [encodedSig, encodedPayload] = signedRequest.split('.', 2);
    const appSecret = process.env.FACEBOOK_APP_SECRET || '';

    if (appSecret) {
      const expectedSig = crypto.createHmac('sha256', appSecret).update(encodedPayload).digest();
      const providedSig = decodeBase64Url(encodedSig);
      if (providedSig.length !== expectedSig.length || !crypto.timingSafeEqual(providedSig, expectedSig)) {
        logger.warn('Instagram deauthorize callback: invalid signed_request signature');
        return res.status(200).json({ success: true });
      }
    }

    const payload = JSON.parse(decodeBase64Url(encodedPayload).toString('utf8')) as {
      user_id?: string;
      profile_id?: string;
    };

    logger.info('Instagram deauthorize callback received', {
      userId: payload.user_id || null,
      profileId: payload.profile_id || null
    });

    return res.status(200).json({ success: true });
  } catch (error) {
    logger.error('Instagram deauthorize callback error', error as Error);
    return res.status(200).json({ success: true });
  }
};

export const connectInstagram = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const fbAppId = process.env.FACEBOOK_APP_ID;
    const fbAppSecret = process.env.FACEBOOK_APP_SECRET;
    const redirectUri =
      process.env.INSTAGRAM_REDIRECT_URI ||
      `${process.env.CORS_ORIGIN || 'https://xo-bot.com'}/api/integrations/instagram/callback`;

    if (!fbAppId || !fbAppSecret) {
      return res.json({
        success: false,
        message: 'Instagram OAuth requires FACEBOOK_APP_ID and FACEBOOK_APP_SECRET.',
        requiresSetup: true
      });
    }

    const state = Buffer.from(JSON.stringify({ merchantId: req.merchantId })).toString('base64');

    const authUrl =
      `https://www.facebook.com/${INSTAGRAM_GRAPH_VERSION}/dialog/oauth` +
      `?client_id=${fbAppId}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&state=${encodeURIComponent(state)}` +
      `&scope=${encodeURIComponent(INSTAGRAM_OAUTH_SCOPES)}` +
      `&response_type=code` +
      `&auth_type=rerequest`;

    res.json({ success: true, data: { authUrl } });
  } catch (error) {
    next(error);
  }
};

export const instagramCallback = async (
  req: Request,
  res: Response,
  _next: NextFunction
) => {
  try {
    const oauthError = typeof req.query.error === 'string' ? req.query.error : '';
    if (oauthError) {
      const reason =
        oauthError === 'access_denied' || req.query.error_reason === 'user_denied'
          ? 'user_denied'
          : 'oauth_failed';
      logger.warn('Instagram OAuth denied or errored by provider', {
        error: oauthError,
        errorReason: req.query.error_reason || null,
      });
      redirectInstagramIntegration(res, { instagram: 'error', reason });
      return;
    }

    const { code, state } = req.query;
    if (!code || !state) {
      redirectInstagramIntegration(res, { instagram: 'error', reason: 'missing_params' });
      return;
    }

    const authCode = String(code);

    const redirectUrl = await withOAuthCodeDedup('instagram', authCode, async () => {
      const fbAppId = process.env.FACEBOOK_APP_ID!;
      const fbAppSecret = process.env.FACEBOOK_APP_SECRET!;
      const redirectUri =
        process.env.INSTAGRAM_REDIRECT_URI ||
        `${process.env.CORS_ORIGIN || 'https://xo-bot.com'}/api/integrations/instagram/callback`;

      let merchantId: string;
      try {
        const decoded = JSON.parse(Buffer.from(state as string, 'base64').toString());
        merchantId = decoded.merchantId;
        if (!isValidUUID(merchantId)) throw new Error('bad uuid');
      } catch {
        return buildInstagramIntegrationRedirect({ instagram: 'error', reason: 'invalid_state' });
      }

      const tokenResp = await fetch(
        `https://graph.facebook.com/v21.0/oauth/access_token` +
          `?client_id=${fbAppId}` +
          `&redirect_uri=${encodeURIComponent(redirectUri)}` +
          `&client_secret=${fbAppSecret}` +
          `&code=${encodeURIComponent(authCode)}`
      );
      const tokenData = (await tokenResp.json()) as { access_token?: string; error?: unknown };
      if (!tokenResp.ok || !tokenData.access_token) {
        logger.error('Instagram token exchange failed', new Error(JSON.stringify(tokenData)));
        return buildInstagramIntegrationRedirect({ instagram: 'error', reason: 'oauth_failed' });
      }
      const userAccessToken = tokenData.access_token;

      const { pages, source } = await resolveManagedFacebookPages(
        userAccessToken,
        IG_PAGE_FIELDS
      );
      if (!pages.length) {
        const granted = await fetchGrantedFacebookPermissions(userAccessToken);
        const hasPagePerms = granted.includes('pages_show_list');
        const hasBusinessMgmt = granted.includes('business_management');
        logger.warn('Instagram OAuth: no Facebook pages returned for user', {
          merchantId,
          grantedPermissions: granted,
          hasPagePerms,
          hasBusinessMgmt,
          resolveSource: source,
        });
        return buildInstagramIntegrationRedirect({
          instagram: 'error',
          reason: hasPagePerms && !hasBusinessMgmt ? 'business_pages' : 'no_pages',
        });
      }

      logger.info('Instagram OAuth pages resolved', {
        merchantId,
        pagesCount: pages.length,
        source,
      });

      let connectedCount = 0;
      const pagesWithoutIg: Array<{ id: string; name?: string }> = [];

      for (const page of pages) {
        const linked = await resolveLinkedInstagramBusinessAccount(page, userAccessToken);
        if (!linked) {
          pagesWithoutIg.push({ id: page.id, name: page.name });
          continue;
        }

        const { igBusinessId, pageAccessToken, igUsername } = linked;

        let resolvedUsername = igUsername || '';
        if (!resolvedUsername) {
          const igInfoResp = await fetch(
            `https://graph.facebook.com/${INSTAGRAM_GRAPH_VERSION}/${igBusinessId}` +
              `?fields=username,name,profile_picture_url&access_token=${encodeURIComponent(pageAccessToken)}`
          );
          const igInfo = (await igInfoResp.json()) as { username?: string };
          resolvedUsername = igInfo.username || '';
        }

        await pool.query(
          `INSERT INTO instagram_accounts
             (merchant_id, ig_user_id, ig_username, page_id, access_token,
              auto_reply_comments, auto_reply_dm, send_dm_on_comment)
           VALUES ($1,$2,$3,$4,$5, true, true, true)
           ON CONFLICT (merchant_id, ig_user_id)
           DO UPDATE SET
             ig_username = EXCLUDED.ig_username,
             page_id = EXCLUDED.page_id,
             access_token = EXCLUDED.access_token,
             updated_at = CURRENT_TIMESTAMP`,
          [merchantId, igBusinessId, resolvedUsername, page.id, pageAccessToken]
        );

        try {
          const { ok, data } = await subscribeFacebookPageWebhooks(page.id, pageAccessToken);
          if (!ok) {
            logger.warn('Failed to subscribe IG page to webhooks', {
              pageId: page.id,
              data: data as Record<string, any>,
            });
          } else {
            logger.info('Subscribed IG page webhooks', {
              pageId: page.id,
              fields: FACEBOOK_PAGE_SUBSCRIBED_FIELDS,
            });
          }
        } catch {
          logger.warn('Failed to subscribe IG page to webhooks', { pageId: page.id });
        }

        // Auto-import recent Instagram DM history (non-blocking).
        scheduleInstagramAccountHistorySync({
          merchantId,
          pageId: String(page.id),
          igUserId: String(igBusinessId),
          accessToken: pageAccessToken,
        });

        connectedCount++;
      }

      if (connectedCount === 0) {
        logger.warn('Instagram OAuth: no linked IG business account on any managed page', {
          merchantId,
          pagesChecked: pages.length,
          pagesWithoutIg,
        });
        return buildInstagramIntegrationRedirect({ instagram: 'error', reason: 'no_business' });
      }

      logger.info('Instagram OAuth completed', { merchantId, connectedCount });
      return `${instagramOAuthCorsOrigin()}/app/integrations?instagram=connected`;
    });

    res.redirect(redirectUrl);
  } catch (error) {
    logger.error('Instagram OAuth callback error', error as Error);
    redirectInstagramIntegration(res, { instagram: 'error', reason: 'server_error' });
  }
};

export const disconnectInstagram = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    await pool.query('DELETE FROM instagram_accounts WHERE merchant_id = $1', [req.merchantId]);
    // Remove synced Instagram posts so they no longer appear in the dashboard
    await clearMerchantSocialPosts(req.merchantId!, 'instagram');
    await clearMerchantChannelConversations({
      merchantId: req.merchantId!,
      platform: 'instagram',
    });
    res.json({ success: true, message: 'Instagram disconnected' });
  } catch (error) {
    next(error);
  }
};

// ==================== WEBHOOK ====================

export const instagramWebhook = async (
  req: any,
  res: Response,
  next: NextFunction
) => {
  try {
    // GET: subscription verification (same pattern as Facebook)
    if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token']) {
      const verifyToken = process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN || process.env.FACEBOOK_WEBHOOK_VERIFY_TOKEN;
      if (req.query['hub.verify_token'] === verifyToken) {
        logger.info('Instagram webhook verified');
        return res.send(req.query['hub.challenge']);
      }
      return next(createError('Invalid verify token', 403));
    }

    // POST: verify signature (fail closed in production when secret is missing)
    const appSecret = process.env.FACEBOOK_APP_SECRET;
    if (!appSecret) {
      if (process.env.NODE_ENV === 'production') {
        logger.warn('Instagram webhook rejected: FACEBOOK_APP_SECRET not configured');
        return next(createError('Webhook not configured', 503));
      }
      logger.warn('Instagram webhook: FACEBOOK_APP_SECRET missing (dev allow)');
    } else if (!verifyInstagramSignature(req, appSecret)) {
      logger.warn('Invalid Instagram webhook signature');
      return next(createError('Invalid signature', 403));
    }

    const body = req.body;
    logger.info('Instagram webhook received', {
      object: body?.object,
      entries: Array.isArray(body?.entry) ? body.entry.length : 0
    });

    // Instagram sends object = 'instagram' for IG-specific webhooks,
    // but comments on IG business accounts come as object = 'page' + changes field = 'feed'
    // when subscribed via the Page.

    if (body.object === 'instagram') {
      // Direct IG messaging webhook
      for (const entry of body.entry || []) {
        if (entry.messaging) {
          for (const event of entry.messaging) {
            // IG includes message echoes in the `messages` field (no separate message_echoes).
            // Echo payload: sender = IG business account, recipient = customer IGSID.
            if (event.message && event.message.is_echo) {
              handleInstagramHumanEcho(event, entry?.id).catch(err =>
                logger.error('Error processing IG message echo', err as Error)
              );
            } else if (event.message && !event.message.is_echo) {
              const igAccountId = event.recipient?.id ? String(event.recipient.id) : String(entry?.id || '');
              const senderId = event.sender?.id ? String(event.sender.id) : '';
              const text = String(event.message?.text || '').trim();
              if (!igAccountId || !senderId) {
                processInstagramDM(event).catch(err =>
                  logger.error('Error processing IG DM', err as Error)
                );
              } else {
                conversationIngressQueue
                  .enqueue({
                    conversationKey: `ig:${igAccountId}:${senderId}`,
                    platform: 'instagram',
                    text,
                    externalMessageId: event.message?.mid ? String(event.message.mid) : undefined,
                    payload: event,
                    process: async (batch) => {
                      const mergedEvent = mergeMessengerStylePayloads(batch.parts);
                      await processInstagramDM(mergedEvent);
                    }
                  })
                  .catch(err => logger.error('Error processing IG DM', err as Error));
              }
            }
          }
        }
        // IG comment webhook (newer API)
        if (entry.changes) {
          for (const change of entry.changes) {
            logger.info('Instagram webhook change received', {
              object: body.object,
              field: change?.field,
              hasValue: !!change?.value
            });
            if (change.field === 'comments') {
              logger.info('Instagram comments webhook detected', {
                hasCommentId: !!(change?.value?.id || change?.value?.comment_id),
                hasFromId: !!change?.value?.from?.id,
                hasOwnerId: !!(change?.value?.media?.owner_id || change?.value?.owner_id),
                entryId: entry?.id
              });
              processInstagramCommentWebhook(change.value, entry?.id).catch(err =>
                logger.error('Error processing IG comment webhook', err as Error)
              );
            }
          }
        }
      }
    }

    // Comments can also arrive as page feed changes
    if (body.object === 'page') {
      for (const entry of body.entry || []) {
        if (entry.changes) {
          for (const change of entry.changes) {
            if (change.field === 'feed' && isPageFeedCommentEvent(change.value)) {
              logger.info('Instagram page-feed comment webhook detected', {
                pageId: entry?.id,
                item: change?.value?.item,
                verb: change?.value?.verb,
                hasCommentId: !!(change?.value?.comment_id ?? change?.value?.id)
              });
              processInstagramCommentFromPageFeed(entry.id, change.value).catch(err =>
                logger.error('Error processing IG comment from page feed', err as Error)
              );
            }
          }
        }
      }
    }

    res.json({ success: true });
  } catch (error) {
    logger.error('Instagram webhook error', error as Error);
    next(error);
  }
};

// ==================== COMMENT PROCESSING ====================

/** Fixed template replies for IG comments / DM-after-comment (merchant-editable in DB). */
const buildIgTemplateReply = (
  ig: { comment_reply_template?: string | null; comment_dm_template?: string | null },
  context: 'comment' | 'dm_after_comment',
  commentText: string,
  commenterName: string
): string => {
  const template =
    context === 'comment' ? ig.comment_reply_template : ig.comment_dm_template;
  const fallback = context === 'comment' ? DEFAULT_COMMENT_REPLY : DEFAULT_DM_AFTER_COMMENT;
  const raw = applyCommentTemplate(template, fallback, {
    comment: commentText,
    name: commenterName
  });
  return clampSocialText(raw);
};

/**
 * Instagram comments on posts linked to a Facebook Page often arrive only on the **Page** webhook
 * (`/webhooks/facebook`), not on `/webhooks/instagram`. Exported so `facebookWebhook` can call it too.
 */
export const processInstagramCommentFromPageFeed = async (pageId: string, value: any) => {
  const n = normalizePageFeedCommentValue(value);
  const commenterId = n.fromId;
  const commentText = n.message;
  const commentId = n.commentId;
  const externalPostId =
    n.postId || (value?.media_id != null ? String(value.media_id) : null) || n.parentId || null;

  if (!commentId) return;

  const igResult = await pool.query(
    `SELECT ia.*, ms.store_name, ms.store_currency, ms.system_prompt, ms.bot_persona,
            ms.shipping_policy, ms.delivery_time, ms.payment_methods, ms.return_policy,
            ms.additional_notes
     FROM instagram_accounts ia
     JOIN merchant_settings ms ON ms.merchant_id = ia.merchant_id
     WHERE ia.page_id = $1
     ORDER BY ia.updated_at DESC NULLS LAST
     LIMIT 1`,
    [pageId]
  );

  if (igResult.rows.length === 0) {
    logger.warn('No IG account for page', { pageId });
    return;
  }

  const ig = igResult.rows[0];
  if (commenterId && commenterId === ig.ig_user_id) return;
  if (commenterId && !checkRateLimit(commenterId, ig.merchant_id)) {
    logger.warn('IG comment rate-limited', { commenterId, merchantId: ig.merchant_id });
    return;
  }

  const commenterName = n.fromName || n.fromUsername || 'صديقنا';
  const commenterUsername = n.fromUsername?.trim().replace(/^@+/, '') || null;

  await runCommentAutomation({
    platform: 'instagram',
    accountRef: ig.ig_user_id,
    pageIdForMessaging: pageId,
    externalPostId,
    commentId: String(commentId),
    commentText,
    commenterId,
    commenterName,
    commenterUsername,
    account: ig,
    sendPublicReply: sendInstagramCommentReply,
    sendPrivateReply: sendInstagramPrivateReplyAfterComment
  });
};

/**
 * When `comments` webhooks omit `media.owner_id`, resolve the merchant row via `entry.id`
 * (IG business account id) or by probing Graph with each stored page token until `media.owner` matches.
 */
async function loadInstagramAccountRowForCommentWebhook(
  commentId: string,
  value: any,
  entryInstagramAccountId?: string | null
): Promise<any | null> {
  const media = value?.media;
  const hintedOwner = (() => {
    const o = media?.owner_id ?? value?.owner_id;
    if (o != null && String(o).trim() !== '') return String(o);
    if (entryInstagramAccountId != null && String(entryInstagramAccountId).trim() !== '') {
      return String(entryInstagramAccountId);
    }
    return null;
  })();

  const baseQuery = `SELECT ia.*, ms.store_name, ms.store_currency, ms.system_prompt, ms.bot_persona
     FROM instagram_accounts ia
     JOIN merchant_settings ms ON ms.merchant_id = ia.merchant_id`;

  if (hintedOwner) {
    const r = await pool.query(`${baseQuery} WHERE ia.ig_user_id = $1 LIMIT 1`, [hintedOwner]);
    if (r.rows.length > 0) return r.rows[0];
  }

  const all = await pool.query(baseQuery);
  for (const row of all.rows) {
    const url =
      `https://graph.facebook.com/${INSTAGRAM_GRAPH_VERSION}/${encodeURIComponent(commentId)}` +
      `?fields=media{id,owner{id}}&access_token=${encodeURIComponent(row.access_token)}`;
    try {
      const resp = await fetch(url);
      const data = (await resp.json()) as Record<string, any>;
      if (!resp.ok) continue;
      const ownerId = data?.media?.owner?.id;
      if (ownerId != null && String(ownerId) === String(row.ig_user_id)) {
        logger.info('IG comment webhook: resolved owner via Graph (comment)', {
          commentId,
          igUserId: row.ig_user_id
        });
        return row;
      }
    } catch {
      continue;
    }
  }

  if (media?.id) {
    const mid = String(media.id);
    for (const row of all.rows) {
      const url =
        `https://graph.facebook.com/${INSTAGRAM_GRAPH_VERSION}/${encodeURIComponent(mid)}` +
        `?fields=owner{id}&access_token=${encodeURIComponent(row.access_token)}`;
      try {
        const resp = await fetch(url);
        const data = (await resp.json()) as Record<string, any>;
        if (!resp.ok) continue;
        const ownerId = data?.owner?.id;
        if (ownerId != null && String(ownerId) === String(row.ig_user_id)) {
          logger.info('IG comment webhook: resolved owner via Graph (media)', {
            commentId,
            mediaId: mid,
            igUserId: row.ig_user_id
          });
          return row;
        }
      } catch {
        continue;
      }
    }
  }

  logger.warn('IG comment webhook: could not resolve instagram account row', {
    commentId,
    entryInstagramAccountId: entryInstagramAccountId ?? null,
    hasMediaId: !!media?.id
  });
  return null;
}

const processInstagramCommentWebhook = async (value: any, entryInstagramAccountId?: string | null) => {
  const { id: commentId, text, from, media } = value || {};
  if (!commentId || !from?.id) {
    logger.info('IG comment webhook skipped: missing commentId/fromId', {
      hasCommentId: !!commentId,
      hasFromId: !!from?.id
    });
    return;
  }
  const bodyText = text != null ? String(text) : '';
  const externalPostId = media?.id != null ? String(media.id) : null;

  const ig = await loadInstagramAccountRowForCommentWebhook(
    String(commentId),
    value,
    entryInstagramAccountId
  );
  if (!ig) return;

  if (from.id === ig.ig_user_id) {
    logger.info('IG comment webhook skipped: self-comment', { commentId, igUserId: ig.ig_user_id });
    return;
  }

  const commenterUsername =
    typeof from.username === 'string' && from.username.trim() ? from.username.trim() : null;
  const commenterName =
    commenterUsername ||
    (from.name as string | undefined) ||
    'صديقنا';

  if (!checkRateLimit(from.id, ig.merchant_id)) {
    logger.warn('IG comment webhook rate-limited', { fromId: from.id, merchantId: ig.merchant_id });
    return;
  }

  if (!ig.page_id) {
    logger.warn('IG comment webhook: missing page_id for private reply', { commentId });
  }

  await runCommentAutomation({
    platform: 'instagram',
    accountRef: ig.ig_user_id,
    pageIdForMessaging: ig.page_id,
    externalPostId,
    commentId: String(commentId),
    commentText: bodyText,
    commenterId: String(from.id),
    commenterName,
    commenterUsername,
    account: ig,
    sendPublicReply: sendInstagramCommentReply,
    sendPrivateReply: sendInstagramPrivateReplyAfterComment
  });
};

// ==================== DM PROCESSING ====================
// نفس مسار تلجرام/ماسنجر: orchestrator + ORDER_DATA + حفظ الطلب في لوحة التحكم

/**
 * When a human replies from Instagram Inbox / Meta Business Suite, Meta sends is_echo=true.
 * Disable the bot for that conversation so it does not race the human agent.
 */
const handleInstagramHumanEcho = async (event: any, entryIgUserId?: string | null) => {
  const appId = event.message?.app_id;
  if (appId && appId.toString() === process.env.FACEBOOK_APP_ID) {
    return; // Our own Send API replies
  }

  // Echo: sender = IG business account, recipient = customer IGSID
  const igBusinessId = String(event.sender?.id || entryIgUserId || '');
  const userIgsid = String(event.recipient?.id || '');
  const messageText =
    typeof event.message?.text === 'string' ? event.message.text.trim() : '';
  const messageId = event.message?.mid ? String(event.message.mid) : '';
  const attachments = Array.isArray(event.message?.attachments)
    ? event.message.attachments
    : [];
  const hasAttachments = attachments.length > 0;

  if (!igBusinessId || !userIgsid || !messageId || (!messageText && !hasAttachments)) {
    logger.debug('Instagram echo skipped (incomplete payload)', {
      igBusinessId: igBusinessId || null,
      userIgsid: userIgsid || null,
      hasText: !!messageText,
      hasAttachments,
      messageId: messageId || null
    });
    return;
  }

  const igResult = await pool.query(
    `SELECT merchant_id FROM instagram_accounts WHERE ig_user_id = $1 LIMIT 1`,
    [igBusinessId]
  );

  if (igResult.rows.length === 0) {
    logger.warn('Instagram echo: account not linked', { igBusinessId, userIgsid, messageId });
    return;
  }

  const merchantId = igResult.rows[0].merchant_id as string;

  const convResult = await pool.query(
    `SELECT id FROM conversations 
     WHERE merchant_id = $1 AND platform = 'instagram' AND user_id = $2
     ORDER BY last_message_at DESC LIMIT 1`,
    [merchantId, userIgsid]
  );

  if (convResult.rows.length === 0) {
    logger.info('Instagram echo: no conversation yet (bot stays active)', {
      merchantId,
      igBusinessId,
      userIgsid,
      messageId
    });
    return;
  }

  const conversationId = convResult.rows[0].id as string;

  const existingMsg = await pool.query(
    `SELECT id FROM messages 
     WHERE conversation_id = $1 
     AND external_message_id = $2`,
    [conversationId, messageId]
  );

  if (existingMsg.rows.length > 0) {
    return;
  }

  // Dashboard send may not have stored Meta mid — skip near-duplicate human text
  if (messageText) {
    const recentDup = await pool.query(
      `SELECT id FROM messages
       WHERE conversation_id = $1
         AND sender_type = 'human'
         AND content = $2
         AND created_at > NOW() - INTERVAL '90 seconds'
       LIMIT 1`,
      [conversationId, messageText]
    );
    if (recentDup.rows.length > 0) {
      return;
    }
  }

  const attachmentType = attachments[0]?.type || 'attachment';
  const content = messageText || `[human ${attachmentType}]`;

  await pool.query(
    `INSERT INTO messages (conversation_id, role, content, sender_type, external_message_id, source)
     VALUES ($1, 'assistant', $2, 'human', $3, 'instagram_inbox')`,
    [conversationId, content, messageId]
  );

  await pool.query(
    `UPDATE conversations 
     SET bot_disabled = TRUE,
         status = 'human',
         last_human_response_at = CURRENT_TIMESTAMP,
         last_message_at = CURRENT_TIMESTAMP,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $1`,
    [conversationId]
  );

  logger.info('Human response detected via IG echo - bot disabled', {
    conversationId,
    messageId,
    merchantId,
    igBusinessId,
    userIgsid,
    hasText: !!messageText,
    hasAttachments
  });
};

const processInstagramDM = async (event: any) => {
  const senderId = event.sender?.id;
  const recipientId = event.recipient?.id;
  const rawText = event.message?.text || '';
  const externalMessageId = event.message?.mid?.toString() || '';

  // Extract image / audio attachments from Instagram DM
  let igImageAttachmentUrl: string | undefined;
  let igAudioAttachmentUrl: string | undefined;
  const attachments = event.message?.attachments;
  if (Array.isArray(attachments)) {
    const imgAtt = attachments.find((a: any) => a.type === 'image');
    if (imgAtt?.payload?.url) {
      igImageAttachmentUrl = imgAtt.payload.url;
    }
    const audioAtt = attachments.find(
      (a: any) =>
        a.type === 'audio' ||
        (a.type === 'file' &&
          /\.(ogg|opus|mp3|m4a|wav|aac)(\?|$)/i.test(String(a.payload?.url || '')))
    );
    if (audioAtt?.payload?.url) {
      igAudioAttachmentUrl = audioAtt.payload.url;
    }
  }

  if (!senderId || !recipientId || (!rawText && !igImageAttachmentUrl && !igAudioAttachmentUrl)) return;

  let messageText = (rawText || '').trim();
  if (messageText.length < 1 && !igImageAttachmentUrl && !igAudioAttachmentUrl) return;

  const igResult = await pool.query(
    `SELECT ia.*, ms.store_name, ms.store_currency, ms.system_prompt, ms.bot_persona
     FROM instagram_accounts ia
     JOIN merchant_settings ms ON ms.merchant_id = ia.merchant_id
     WHERE ia.ig_user_id = $1`,
    [recipientId]
  );

  if (igResult.rows.length === 0) return;
  const ig = igResult.rows[0];
  const merchantId: string = ig.merchant_id;

  if (!ig.auto_reply_dm) return;

  if (!checkRateLimit(senderId, merchantId)) return;

  const cachedSettings = await getCachedMerchantSettings(merchantId);
  if (!cachedSettings) {
    logger.warn('Instagram DM: merchant settings not found', { merchantId });
    return;
  }

  const settings = {
    store_name: cachedSettings.store_name,
    store_currency: cachedSettings.store_currency,
    system_prompt: cachedSettings.system_prompt,
    bot_persona: cachedSettings.bot_persona,
    shipping_policy: cachedSettings.shipping_policy,
    delivery_time: cachedSettings.delivery_time,
    payment_methods: cachedSettings.payment_methods,
    return_policy: cachedSettings.return_policy,
    additional_notes: cachedSettings.additional_notes,
    enable_ai_injection: cachedSettings.enable_ai_injection
  };

  // ==================== VOICE TRANSCRIPTION (OpenAI STT) ====================
  if (igAudioAttachmentUrl) {
    const voiceResult = await resolveInboundVoice({
      merchantId,
      platform: 'instagram',
      url: igAudioAttachmentUrl,
      existingText: messageText,
      filename: 'voice.ogg',
      languageHint: 'arabic',
      downloadHeaders: ig.access_token
        ? { Authorization: `Bearer ${ig.access_token}` }
        : undefined
    });
    messageText = voiceResult.messageText;
    if (voiceResult.transcribed) {
        logger.info('Instagram voice transcribed', {
          merchantId,
          userId: senderId,
          transcriptLength: voiceResult.transcript?.text?.length || 0,
          model: voiceResult.transcript?.model
        });
          }
    if (voiceResult.shouldAbortWithFallback) {
      await sendInstagramDM(
        senderId,
        voiceTranscriptionFallbackMessage('arabic'),
        ig.access_token
      );
      return;
    }
  }

  // ==================== IMAGE RECOGNITION ====================
  if (igImageAttachmentUrl) {
    try {
      const dataUrl = await imageUrlToBase64(igImageAttachmentUrl);
      if (dataUrl) {
        const analysis = await analyzeImageAndSearch(dataUrl, merchantId, messageText || undefined, settings.store_currency);
        if (analysis) {
          const productList = analysis.products
            .slice(0, 3)
            .map((p, i) => {
              const code = p.currency || settings.store_currency;
              return `${i + 1}. ${p.name} — ${p.price} ${getCurrencyDisplayName(code, 'arabic')}`;
            })
            .join('\n');

          if (analysis.products.length > 0) {
            messageText = `[تحليل صورة العميل: "${analysis.description}" — المنتجات المطابقة في المتجر:\n${productList}]\n${messageText || 'كم سعر هذا المنتج؟'}`;
          } else {
            messageText = `[تحليل صورة العميل: "${analysis.description}" — لم يُعثر على منتج مطابق في المتجر]\n${messageText || 'كم سعر هذا المنتج؟'}`;
          }
          console.log('[processInstagramDM] Image analyzed', {
            messageLength: messageText.length,
          });
        }
      }
    } catch (imgErr) {
      logger.error('Instagram image analysis failed', imgErr as Error);
    }
    if (!messageText || !messageText.trim()) {
      messageText = 'أرسل العميل صورة';
    }
  }

  let userName =
    (event.sender?.name as string | undefined) ||
    [event.sender?.first_name, event.sender?.last_name].filter(Boolean).join(' ') ||
    '';

  try {
    const convResult = await pool.query(
      `SELECT id, conversation_state, current_intent, stage, user_name FROM conversations 
       WHERE merchant_id = $1 AND platform = 'instagram' AND user_id = $2
       ORDER BY last_message_at DESC LIMIT 1`,
      [merchantId, senderId]
    );

    let conversationId: string;
    let conversationState: ConversationState = { message_count: 0 };
    let resolvedUserName = userName;

    if (convResult.rows.length > 0) {
      conversationId = convResult.rows[0].id;
      conversationState = convResult.rows[0].conversation_state || { message_count: 0 };
      if (convResult.rows[0].current_intent) {
        conversationState.last_intent = convResult.rows[0].current_intent;
      }
      resolvedUserName = await ensureConversationCustomerName({
        merchantId,
        conversationId,
        platform: 'instagram',
        userId: senderId,
        currentName: !isPlaceholderCustomerName(userName)
          ? userName
          : convResult.rows[0].user_name,
      });
    } else {
      if (isPlaceholderCustomerName(resolvedUserName)) {
        const { resolveSocialCustomerName } = await import('../services/socialProfile.js');
        resolvedUserName =
          (await resolveSocialCustomerName({
            merchantId,
            platform: 'instagram',
            userId: senderId,
          })) || resolvedUserName || 'عميل إنستغرام';
      }
      const newConvResult = await pool.query(
        `INSERT INTO conversations (merchant_id, platform, user_id, user_name)
         VALUES ($1, 'instagram', $2, $3)
         RETURNING id`,
        [merchantId, senderId, resolvedUserName]
      );
      conversationId = newConvResult.rows[0].id;
    }

    // Bind IG page / account for profile lookups
    if (ig.page_id || ig.ig_user_id) {
      await bindConversationChannelAccount({
        merchantId,
        conversationId,
        platform: 'instagram',
        accountId: String(ig.page_id || ig.ig_user_id),
      });
    }

    // ==================== Human takeover / bot_disabled ====================
    let convStatus;
    try {
      convStatus = await pool.query(
        `SELECT bot_disabled, last_human_response_at, last_bot_response_at, status
         FROM conversations WHERE id = $1`,
        [conversationId]
      );
    } catch (error: any) {
      if (error?.code === '42703') {
        convStatus = { rows: [{ bot_disabled: false, status: 'bot' }] } as any;
      } else {
        throw error;
      }
    }

    const conv = convStatus.rows[0] || { bot_disabled: false, status: 'bot' };

    const lastMessageCheck = await pool.query(
      `SELECT sender_type, created_at, external_message_id
       FROM messages 
       WHERE conversation_id = $1 
       ORDER BY created_at DESC 
       LIMIT 1`,
      [conversationId]
    );

    let shouldSkipBotReply = false;
    let skipReason = '';

    if (conv.bot_disabled || conv.status === 'human') {
      shouldSkipBotReply = true;
      skipReason = 'Bot disabled or conversation assigned to human';
    } else if (lastMessageCheck.rows.length > 0) {
      const lastMsg = lastMessageCheck.rows[0];
      if (lastMsg.sender_type === 'human') {
        const lastMsgTime = new Date(lastMsg.created_at);
        const minutesSinceHuman =
          (Date.now() - lastMsgTime.getTime()) / (1000 * 60);
        if (minutesSinceHuman < 5) {
          shouldSkipBotReply = true;
          skipReason = `Recent human response (${Math.round(minutesSinceHuman)} minutes ago)`;
        }
      }
    }

    if (shouldSkipBotReply) {
      await pool.query(
        `INSERT INTO messages (conversation_id, role, content, sender_type, external_message_id, source, metadata)
         VALUES ($1, 'user', $2, 'user', $3, 'instagram', $4::jsonb)`,
        [
          conversationId,
          messageText,
          externalMessageId || null,
          JSON.stringify({
            platform: 'instagram',
            ...(igImageAttachmentUrl
              ? { type: 'image', imageUrl: igImageAttachmentUrl }
              : { type: 'text' }),
          }),
        ]
      );
      logger.info('Bot reply skipped for Instagram', {
        conversationId,
        reason: skipReason,
        merchantId
      });
      return;
    }

    let acquisitionNote = '';
    const referralInfo = extractReferralFromMessagingEvent(event);
    if (referralInfo && (referralInfo.ref || referralInfo.adId || referralInfo.postId)) {
      const resolved = await resolveProductForExternalContent({
        merchantId,
        platform: 'instagram',
        externalPostId: referralInfo.postId,
        adId: referralInfo.adId,
        refCode: referralInfo.ref
      });
      const acquisition: AcquisitionContext = {
        source:
          referralInfo.source === 'ADS'
            ? 'ADS'
            : referralInfo.ref
              ? 'SHORTLINK'
              : 'POST',
        post_id: referralInfo.postId || null,
        ad_id: referralInfo.adId || null,
        ref: referralInfo.ref || null,
        product_id: resolved.productId,
        linked_recommended: resolved.linkedRecommended,
        platform: 'instagram',
        account_ref: recipientId,
        captured_at: new Date().toISOString()
      };
      conversationState = await applyAcquisitionToConversation({
        conversationId,
        merchantId,
        acquisition,
        conversationState
      });
      let productName: string | null = null;
      if (resolved.productId) {
        const p = await getProductById(merchantId, resolved.productId);
        productName = p?.name || null;
      }
      acquisitionNote = buildAcquisitionContextNote(acquisition, productName);
    }

    const recentMessagesResult = await pool.query(
      `SELECT role, content FROM messages 
       WHERE conversation_id = $1 
       ORDER BY created_at DESC 
       LIMIT 25`,
      [conversationId]
    );

    const recentMessages: Message[] = recentMessagesResult.rows
      .reverse()
      .map(row => ({
        role: row.role as 'user' | 'assistant',
        content: row.content
      }));

    const { getMerchantPlanLimits, getMonthlyAIResponseCount, isWithinLimit } = await import(
      '../utils/planLimits.js'
    );
    const limits = await getMerchantPlanLimits(merchantId);
    if (!limits.hasSalesBot) {
      logger.info('Sales bot not included in plan — skipping Instagram DM auto-reply', { merchantId });
      return;
    }
    const currentCount = await getMonthlyAIResponseCount(merchantId);

    if (!isWithinLimit(currentCount, limits.maxMonthlyAIResponses)) {
      logger.warn('AI response limit exceeded for Instagram', {
        merchantId,
        currentCount,
        limit: limits.maxMonthlyAIResponses
      });
      return;
    }

    let responseText: string;
    let updatedState: ConversationState = conversationState;

    const stopTypingKeepalive = startTypingKeepalive(() =>
      sendInstagramTyping(senderId, true, ig.access_token)
    );

    try {
      const merchantConfig: Partial<MerchantConfig> = buildMerchantBotConfig({
        merchantId,
        settings,
        // FB/IG only: acquisition context from ads/organic posts
        systemPromptSuffix: acquisitionNote || '',
      });

      const turn = await runSalesBotTurn({
        merchantId,
        platform: 'instagram',
        escalatePlatform: 'instagram',
        userId: senderId,
        userName: resolvedUserName || userName || 'عميل',
        messageText,
        externalMessageId: externalMessageId || '',
        recentMessages,
        conversationState,
        merchantConfig,
        conversationId,
        storeCurrency: settings?.store_currency || 'USD',
        channelLabel: 'Instagram',
        pool,
        userMessageMetadata: igImageAttachmentUrl
          ? { type: 'image', imageUrl: igImageAttachmentUrl }
          : { type: 'text' },
      });

      responseText = turn.responseText;
      updatedState = turn.updatedState;

      if (!turn.failed) {
        console.log('[processInstagramDM] SalesGPT response generated:', {
          conversationId,
          responseLength: responseText.length,
          pipelineUsed: turn.meta.pipelineUsed,
          aiCallsCount: turn.meta.aiCallsCount,
          processingTimeMs: turn.meta.processingTimeMs,
          intent: turn.meta.intent,
          stage: turn.meta.stage,
        });
        logger.info('Instagram DM processed via SalesGPT', {
          merchantId,
          conversationId,
          pipelineUsed: turn.meta.pipelineUsed,
          aiCallsCount: turn.meta.aiCallsCount,
          processingTimeMs: turn.meta.processingTimeMs,
        });
      }
    } finally {
      stopTypingKeepalive();
    }

    const { orderData, cleanText: responseWithoutOrderData } = extractOrderData(responseText);
    const { imageUrl, cleanText } = extractImageUrl(responseWithoutOrderData);

    if (orderData) {
      console.log('[processInstagramDM] ORDER_DATA detected, processing order:', {
        merchantId,
        hasName: Boolean(orderData.customerName),
        productsCount: orderData.products?.length || 0,
      });

      await persistOrderIfPresent({
        pool,
        merchantId,
        conversationId,
        orderData,
        settings: { store_currency: settings.store_currency || 'USD' },
        labels: {
          defaultBaseNotes: 'Order created via Instagram bot',
          customerTags: ['bot-order', 'instagram'],
          interactionTitle: 'Order Created via Instagram Bot',
          interactionDescription: (orderId: string) => `Order #${orderId} created via Instagram bot`,
          interactionPlatform: 'instagram',
          logPrefix: 'processInstagramDM',
        },
        updatedState,
      });
    }

    const finalResponseText = stripInternalControlMarkers(cleanText || responseWithoutOrderData);
    const hasImage = !!(imageUrl && imageUrl.startsWith('http'));
    if ((!finalResponseText || !finalResponseText.trim()) && !hasImage) {
      logger.info('Instagram DM: no reply text to send', { merchantId, conversationId });
      return;
    }

    await deliverHumanLikeReply({
      text: finalResponseText || '',
      imageUrl: hasImage ? imageUrl : null,
      transport: {
        setTyping: (on) => sendInstagramTyping(senderId, on, ig.access_token),
        sendText: (bubble) => sendInstagramDM(senderId, bubble, ig.access_token),
        sendImage: (url, caption) => sendInstagramImage(senderId, url, caption, ig.access_token)
      },
      context: { merchantId, platform: 'instagram', conversationId }
    });

    await pool.query(
      `UPDATE conversations 
       SET last_message_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND merchant_id = $2`,
      [conversationId, merchantId]
    );
  } catch (e) {
    logger.error('IG DM processing error', e as Error, { senderId, merchantId });
  }
};

// ==================== SETTINGS UPDATE ====================

export const updateInstagramSettings = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const { autoReplyComments, autoReplyDM, sendDmOnComment, commentReplyTemplate, commentDmTemplate } =
      req.body;

    if (autoReplyDM === true) {
      const { merchantHasSalesBot } = await import('../utils/planLimits.js');
      const allowed = await merchantHasSalesBot(req.merchantId!);
      if (!allowed) {
        return next(createError(
          'باقتك الحالية مخصّصة للرد على التعليقات فقط ولا تشمل بوت المبيعات. رقِّ الباقة لتفعيل الرسائل الخاصة.',
          403,
          true,
          'SALES_BOT_NOT_INCLUDED'
        ));
      }
    }

    const updates: string[] = [];
    const values: any[] = [];
    let idx = 1;

    if (typeof autoReplyComments === 'boolean') {
      updates.push(`auto_reply_comments = $${idx++}`);
      values.push(autoReplyComments);
    }
    if (typeof autoReplyDM === 'boolean') {
      updates.push(`auto_reply_dm = $${idx++}`);
      values.push(autoReplyDM);
    }
    if (typeof sendDmOnComment === 'boolean') {
      updates.push(`send_dm_on_comment = $${idx++}`);
      values.push(sendDmOnComment);
    }
    if (typeof commentReplyTemplate === 'string') {
      updates.push(`comment_reply_template = $${idx++}`);
      values.push(commentReplyTemplate.trim() === '' ? null : commentReplyTemplate.slice(0, 2000));
    }
    if (typeof commentDmTemplate === 'string') {
      updates.push(`comment_dm_template = $${idx++}`);
      values.push(commentDmTemplate.trim() === '' ? null : commentDmTemplate.slice(0, 2000));
    }

    if (updates.length === 0) {
      return next(createError('No fields to update', 400));
    }

    updates.push(`updated_at = CURRENT_TIMESTAMP`);
    values.push(req.merchantId);

    await pool.query(
      `UPDATE instagram_accounts SET ${updates.join(', ')} WHERE merchant_id = $${idx}`,
      values
    );

    res.json({ success: true, message: 'Instagram settings updated' });
  } catch (error) {
    next(error);
  }
};
