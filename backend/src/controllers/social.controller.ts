import { Response, NextFunction } from 'express';
import pool from '../database/connection.js';
import { createError } from '../middleware/errorHandler.js';
import { AuthRequest } from '../middleware/auth.js';
import { logger } from '../utils/logger.js';
import {
  listMerchantSocialPosts,
  syncMerchantSocialPosts
} from '../services/socialPostsSync.js';

function requireMerchant(req: AuthRequest): string {
  if (!req.merchantId) throw createError('Unauthorized', 401);
  return req.merchantId;
}

export const syncSocialPosts = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const merchantId = requireMerchant(req);
    const platform = req.body?.platform as 'facebook' | 'instagram' | undefined;
    const results = await syncMerchantSocialPosts(merchantId, platform);
    res.json({ message: 'تمت مزامنة المنشورات', results });
  } catch (e) {
    next(e);
  }
};

export const getSocialPosts = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const merchantId = requireMerchant(req);
    const platform = req.query.platform as 'facebook' | 'instagram' | undefined;
    const accountRef = req.query.accountRef as string | undefined;
    const limit = req.query.limit ? Number(req.query.limit) : 50;
    const offset = req.query.offset ? Number(req.query.offset) : 0;
    const rows = await listMerchantSocialPosts(merchantId, {
      platform,
      accountRef,
      limit,
      offset
    });
    res.json({ posts: rows });
  } catch (e) {
    next(e);
  }
};

export const linkSocialPostProduct = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const merchantId = requireMerchant(req);
    const { socialPostId, productId } = req.body || {};
    if (!socialPostId) throw createError('socialPostId مطلوب', 400);

    const post = await pool.query(
      `SELECT id, platform, external_post_id FROM social_posts
       WHERE id = $1 AND merchant_id = $2`,
      [socialPostId, merchantId]
    );
    if (post.rows.length === 0) throw createError('المنشور غير موجود', 404);

    if (productId) {
      const product = await pool.query(
        `SELECT id FROM products WHERE id = $1 AND merchant_id = $2`,
        [productId, merchantId]
      );
      if (product.rows.length === 0) throw createError('المنتج غير موجود لهذا التاجر', 404);
    }

    // Replace any previous link for this post (tenant-scoped)
    await pool.query(
      `DELETE FROM social_content_links
       WHERE merchant_id = $1 AND (social_post_id = $2 OR external_id = $3)`,
      [merchantId, socialPostId, post.rows[0].external_post_id]
    );

    if (!productId) {
      res.json({ message: 'تم إلغاء ربط المنتج', linked: false });
      return;
    }

    const inserted = await pool.query(
      `INSERT INTO social_content_links (
         merchant_id, platform, content_type, external_id, social_post_id, product_id, is_active
       ) VALUES ($1, $2, 'post', $3, $4, $5, true)
       RETURNING id, product_id`,
      [
        merchantId,
        post.rows[0].platform,
        post.rows[0].external_post_id,
        socialPostId,
        productId
      ]
    );

    res.json({ message: 'تم ربط المنتج بالمنشور (مستحسن)', link: inserted.rows[0] });
  } catch (e) {
    next(e);
  }
};

export const updateSocialPostCommentSettings = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const merchantId = requireMerchant(req);
    const {
      socialPostId,
      commentReplyEnabled,
      publicReplyText,
      sendDmOnComment,
      privateReplyText
    } = req.body || {};

    if (!socialPostId) throw createError('socialPostId مطلوب', 400);

    const result = await pool.query(
      `UPDATE social_posts SET
         comment_reply_enabled = COALESCE($3, comment_reply_enabled),
         public_reply_text = COALESCE($4, public_reply_text),
         send_dm_on_comment = COALESCE($5, send_dm_on_comment),
         private_reply_text = COALESCE($6, private_reply_text),
         updated_at = NOW()
       WHERE id = $1 AND merchant_id = $2
       RETURNING id, external_post_id, comment_reply_enabled, public_reply_text,
                 send_dm_on_comment, private_reply_text`,
      [
        socialPostId,
        merchantId,
        typeof commentReplyEnabled === 'boolean' ? commentReplyEnabled : null,
        publicReplyText !== undefined ? publicReplyText : null,
        typeof sendDmOnComment === 'boolean' ? sendDmOnComment : null,
        privateReplyText !== undefined ? privateReplyText : null
      ]
    );

    if (result.rows.length === 0) throw createError('المنشور غير موجود', 404);
    res.json({ message: 'تم حفظ إعدادات رد المنشور', post: result.rows[0] });
  } catch (e) {
    next(e);
  }
};

export const listKeywordRules = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const merchantId = requireMerchant(req);
    const platform = req.query.platform as string | undefined;
    const socialPostId = req.query.socialPostId as string | undefined;
    const params: any[] = [merchantId];
    let sql = `SELECT * FROM social_keyword_rules WHERE merchant_id = $1 AND scope = 'post'`;
    if (platform) {
      params.push(platform);
      sql += ` AND platform = $${params.length}`;
    }
    if (socialPostId) {
      params.push(socialPostId);
      sql += ` AND social_post_id = $${params.length}`;
    }
    sql += ` ORDER BY priority DESC, created_at DESC`;
    const result = await pool.query(sql, params);
    res.json({ rules: result.rows });
  } catch (e) {
    next(e);
  }
};

export const createKeywordRule = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const merchantId = requireMerchant(req);
    const b = req.body || {};
    const platform = b.platform;
    const accountRef = b.accountRef;
    // Per-post only: account-wide keyword rules are no longer accepted
    const scope = 'post';
    const keywords = Array.isArray(b.keywords)
      ? b.keywords.map((k: any) => String(k).trim()).filter(Boolean)
      : String(b.keywords || '')
          .split(/[,\n]+/)
          .map((k: string) => k.trim())
          .filter(Boolean);

    if (!platform || !accountRef) throw createError('platform و accountRef مطلوبان', 400);
    if (keywords.length === 0) throw createError('أضف كلمة مفتاحية واحدة على الأقل', 400);
    if (!b.socialPostId && !b.externalPostId) {
      throw createError('اختر منشوراً لإضافة قاعدة كلمات مفتاحية', 400);
    }

    let socialPostId = b.socialPostId || null;
    let externalPostId = b.externalPostId || null;

    if (socialPostId) {
      const owned = await pool.query(
        `SELECT id, external_post_id FROM social_posts WHERE id = $1 AND merchant_id = $2`,
        [socialPostId, merchantId]
      );
      if (owned.rows.length === 0) throw createError('المنشور غير موجود', 404);
      externalPostId = owned.rows[0].external_post_id;
    }

    const result = await pool.query(
      `INSERT INTO social_keyword_rules (
         merchant_id, platform, account_ref, scope, social_post_id, external_post_id,
         keywords, match_type, priority, public_reply_enabled, public_reply_text,
         private_reply_enabled, private_reply_text, open_ai_conversation, is_active
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,false,$14)
       RETURNING *`,
      [
        merchantId,
        platform,
        accountRef,
        scope,
        socialPostId,
        externalPostId,
        keywords,
        b.matchType || 'contains',
        Number.isFinite(Number(b.priority)) ? Number(b.priority) : 100,
        b.publicReplyEnabled !== false,
        b.publicReplyText || null,
        b.privateReplyEnabled === true,
        b.privateReplyText || null,
        b.isActive !== false
      ]
    );

    res.status(201).json({ rule: result.rows[0] });
  } catch (e) {
    next(e);
  }
};

export const updateKeywordRule = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const merchantId = requireMerchant(req);
    const ruleId = req.params.ruleId;
    const b = req.body || {};

    const existing = await pool.query(
      `SELECT id FROM social_keyword_rules WHERE id = $1 AND merchant_id = $2`,
      [ruleId, merchantId]
    );
    if (existing.rows.length === 0) throw createError('القاعدة غير موجودة', 404);

    const keywords = b.keywords
      ? Array.isArray(b.keywords)
        ? b.keywords.map((k: any) => String(k).trim()).filter(Boolean)
        : String(b.keywords)
            .split(/[,\n]+/)
            .map((k: string) => k.trim())
            .filter(Boolean)
      : null;

    const result = await pool.query(
      `UPDATE social_keyword_rules SET
         keywords = COALESCE($3, keywords),
         match_type = COALESCE($4, match_type),
         priority = COALESCE($5, priority),
         public_reply_enabled = COALESCE($6, public_reply_enabled),
         public_reply_text = COALESCE($7, public_reply_text),
         private_reply_enabled = COALESCE($8, private_reply_enabled),
         private_reply_text = COALESCE($9, private_reply_text),
         open_ai_conversation = COALESCE($10, open_ai_conversation),
         is_active = COALESCE($11, is_active),
         scope = COALESCE($12, scope),
         social_post_id = COALESCE($13, social_post_id),
         external_post_id = COALESCE($14, external_post_id),
         updated_at = NOW()
       WHERE id = $1 AND merchant_id = $2
       RETURNING *`,
      [
        ruleId,
        merchantId,
        keywords,
        b.matchType ?? null,
        b.priority != null ? Number(b.priority) : null,
        typeof b.publicReplyEnabled === 'boolean' ? b.publicReplyEnabled : null,
        b.publicReplyText !== undefined ? b.publicReplyText : null,
        typeof b.privateReplyEnabled === 'boolean' ? b.privateReplyEnabled : null,
        b.privateReplyText !== undefined ? b.privateReplyText : null,
        typeof b.openAiConversation === 'boolean' ? b.openAiConversation : null,
        typeof b.isActive === 'boolean' ? b.isActive : null,
        b.scope === 'post' || b.scope === 'account' ? b.scope : null,
        b.socialPostId !== undefined ? b.socialPostId : null,
        b.externalPostId !== undefined ? b.externalPostId : null
      ]
    );

    res.json({ rule: result.rows[0] });
  } catch (e) {
    next(e);
  }
};

export const deleteKeywordRule = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const merchantId = requireMerchant(req);
    const ruleId = req.params.ruleId;
    const result = await pool.query(
      `DELETE FROM social_keyword_rules WHERE id = $1 AND merchant_id = $2 RETURNING id`,
      [ruleId, merchantId]
    );
    if (result.rows.length === 0) throw createError('القاعدة غير موجودة', 404);
    res.json({ message: 'تم حذف القاعدة' });
  } catch (e) {
    next(e);
  }
};

export const updateCommentAutomationMode = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const merchantId = requireMerchant(req);
    const { platform, mode, accountRef } = req.body || {};
    if (!['facebook', 'instagram'].includes(platform)) {
      throw createError('platform غير صالح', 400);
    }
    if (!['template_all', 'keyword_rules', 'off'].includes(mode)) {
      throw createError('mode يجب أن يكون template_all أو keyword_rules أو off', 400);
    }

    if (platform === 'facebook') {
      const result = await pool.query(
        accountRef
          ? `UPDATE facebook_pages SET comment_automation_mode = $1, updated_at = NOW()
             WHERE merchant_id = $2 AND page_id = $3 RETURNING page_id, comment_automation_mode`
          : `UPDATE facebook_pages SET comment_automation_mode = $1, updated_at = NOW()
             WHERE merchant_id = $2 RETURNING page_id, comment_automation_mode`,
        accountRef ? [mode, merchantId, accountRef] : [mode, merchantId]
      );
      if (result.rows.length === 0) throw createError('لا توجد صفحة فيسبوك مربوطة', 404);
      res.json({ message: 'تم تحديث وضع أتمتة التعليقات', pages: result.rows });
      return;
    }

    const result = await pool.query(
      accountRef
        ? `UPDATE instagram_accounts SET comment_automation_mode = $1, updated_at = NOW()
           WHERE merchant_id = $2 AND ig_user_id = $3 RETURNING ig_user_id, comment_automation_mode`
        : `UPDATE instagram_accounts SET comment_automation_mode = $1, updated_at = NOW()
           WHERE merchant_id = $2 RETURNING ig_user_id, comment_automation_mode`,
      accountRef ? [mode, merchantId, accountRef] : [mode, merchantId]
    );
    if (result.rows.length === 0) throw createError('لا يوجد حساب إنستغرام مربوط', 404);
    res.json({ message: 'تم تحديث وضع أتمتة التعليقات', accounts: result.rows });
  } catch (e) {
    next(e);
  }
};

logger.debug('social.controller loaded');
