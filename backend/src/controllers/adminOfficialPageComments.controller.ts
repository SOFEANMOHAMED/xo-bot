/**
 * Super-admin APIs for official XO Bot page comment automation
 * (per-post replies + keyword rules — platform-scoped Facebook + Instagram).
 */

import { Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth.js';
import { createError } from '../middleware/errorHandler.js';
import pool from '../database/connection.js';
import {
  ensurePlatformCommentTables,
  listOfficialPageSocialPosts,
  syncOfficialPagePosts as syncOfficialSocialPosts,
  type OfficialSocialPlatform,
} from '../services/platformSocialPosts.js';
import { getLinkedPlatformFacebookPage } from '../services/platformFacebookPage.js';

async function requireLinkedPage() {
  const page = await getLinkedPlatformFacebookPage();
  if (!page) throw createError('اربط صفحة XO Bot الرسمية أولاً من الإعدادات العامة', 400);
  return page;
}

function parseKeywords(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.map((k) => String(k).trim()).filter(Boolean);
  }
  return String(raw || '')
    .split(/[,\n،]+/)
    .map((k) => k.trim())
    .filter(Boolean);
}

function parsePlatform(raw: unknown): OfficialSocialPlatform | undefined {
  if (raw === 'facebook' || raw === 'instagram') return raw;
  return undefined;
}

export const syncOfficialPagePosts = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    await ensurePlatformCommentTables();
    const platform = parsePlatform(req.body?.platform);
    const results = await syncOfficialSocialPosts(platform);
    res.json({
      success: true,
      data: {
        message: 'تمت مزامنة منشورات صفحة XO Bot',
        results: results.map((r) => ({
          synced: r.synced,
          platform: r.platform,
          accountRef: r.accountRef,
          pageName: r.pageName,
          igUsername: r.igUsername ?? null,
        })),
      },
    });
  } catch (e) {
    next(e);
  }
};

export const getOfficialPagePosts = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    await ensurePlatformCommentTables();
    const limit = req.query.limit ? Number(req.query.limit) : 50;
    const offset = req.query.offset ? Number(req.query.offset) : 0;
    const platform = parsePlatform(req.query.platform) || 'facebook';
    const posts = await listOfficialPageSocialPosts({ platform, limit, offset });
    res.setHeader('Cache-Control', 'no-store');
    res.json({ success: true, data: { posts } });
  } catch (e) {
    next(e);
  }
};

export const updateOfficialPagePostCommentSettings = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    await ensurePlatformCommentTables();
    const page = await requireLinkedPage();
    const {
      socialPostId,
      commentReplyEnabled,
      publicReplyText,
      sendDmOnComment,
      privateReplyText,
      reactOnCommentEnabled,
    } = req.body || {};

    if (!socialPostId) throw createError('socialPostId مطلوب', 400);

    const result = await pool.query(
      `UPDATE platform_social_posts SET
         comment_reply_enabled = COALESCE($3, comment_reply_enabled),
         public_reply_text = COALESCE($4, public_reply_text),
         send_dm_on_comment = COALESCE($5, send_dm_on_comment),
         private_reply_text = COALESCE($6, private_reply_text),
         react_on_comment_enabled = COALESCE($7, react_on_comment_enabled),
         comment_reaction_type = CASE
           WHEN $7::boolean IS TRUE THEN 'LIKE'
           ELSE comment_reaction_type
         END,
         updated_at = NOW()
       WHERE id = $1 AND page_id = $2
       RETURNING id, external_post_id, platform, comment_reply_enabled, public_reply_text,
                 send_dm_on_comment, private_reply_text,
                 react_on_comment_enabled, comment_reaction_type`,
      [
        socialPostId,
        page.page_id,
        typeof commentReplyEnabled === 'boolean' ? commentReplyEnabled : null,
        publicReplyText !== undefined ? publicReplyText : null,
        typeof sendDmOnComment === 'boolean' ? sendDmOnComment : null,
        privateReplyText !== undefined ? privateReplyText : null,
        typeof reactOnCommentEnabled === 'boolean' ? reactOnCommentEnabled : null,
      ]
    );

    if (result.rows.length === 0) throw createError('المنشور غير موجود', 404);
    res.json({
      success: true,
      data: { message: 'تم حفظ إعدادات رد المنشور', post: result.rows[0] },
    });
  } catch (e) {
    next(e);
  }
};

export const listOfficialPageKeywordRules = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    await ensurePlatformCommentTables();
    const page = await requireLinkedPage();
    const socialPostId = req.query.socialPostId as string | undefined;
    const platform = parsePlatform(req.query.platform);
    const params: unknown[] = [page.page_id];
    let sql = `SELECT * FROM platform_keyword_rules WHERE page_id = $1 AND scope = 'post'`;
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
    res.json({ success: true, data: { rules: result.rows } });
  } catch (e) {
    next(e);
  }
};

export const createOfficialPageKeywordRule = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    await ensurePlatformCommentTables();
    const page = await requireLinkedPage();
    const b = req.body || {};
    const keywords = parseKeywords(b.keywords);

    if (keywords.length === 0) throw createError('أضف كلمة مفتاحية واحدة على الأقل', 400);
    if (!b.socialPostId) throw createError('اختر منشوراً لإضافة قاعدة', 400);

    const owned = await pool.query(
      `SELECT id, external_post_id, platform, account_ref FROM platform_social_posts
       WHERE id = $1 AND page_id = $2`,
      [b.socialPostId, page.page_id]
    );
    if (owned.rows.length === 0) throw createError('المنشور غير موجود', 404);

    const post = owned.rows[0] as {
      id: string;
      external_post_id: string;
      platform: OfficialSocialPlatform;
      account_ref: string;
    };

    const result = await pool.query(
      `INSERT INTO platform_keyword_rules (
         page_id, platform, account_ref, scope, social_post_id, external_post_id,
         keywords, match_type, priority, public_reply_enabled, public_reply_text,
         private_reply_enabled, private_reply_text, is_active
       ) VALUES ($1,$2,$3,'post',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING *`,
      [
        page.page_id,
        post.platform,
        post.account_ref,
        post.id,
        post.external_post_id,
        keywords,
        b.matchType || 'contains',
        Number.isFinite(Number(b.priority)) ? Number(b.priority) : 100,
        b.publicReplyEnabled !== false,
        b.publicReplyText || null,
        b.privateReplyEnabled === true,
        b.privateReplyText || null,
        b.isActive !== false,
      ]
    );

    res.status(201).json({ success: true, data: { rule: result.rows[0] } });
  } catch (e) {
    next(e);
  }
};

export const updateOfficialPageKeywordRule = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    await ensurePlatformCommentTables();
    const page = await requireLinkedPage();
    const ruleId = req.params.ruleId;
    const b = req.body || {};

    const existing = await pool.query(
      `SELECT id FROM platform_keyword_rules WHERE id = $1 AND page_id = $2`,
      [ruleId, page.page_id]
    );
    if (existing.rows.length === 0) throw createError('القاعدة غير موجودة', 404);

    const keywords = b.keywords !== undefined ? parseKeywords(b.keywords) : null;
    if (keywords && keywords.length === 0) {
      throw createError('أضف كلمة مفتاحية واحدة على الأقل', 400);
    }

    const result = await pool.query(
      `UPDATE platform_keyword_rules SET
         keywords = COALESCE($3, keywords),
         match_type = COALESCE($4, match_type),
         priority = COALESCE($5, priority),
         public_reply_enabled = COALESCE($6, public_reply_enabled),
         public_reply_text = COALESCE($7, public_reply_text),
         private_reply_enabled = COALESCE($8, private_reply_enabled),
         private_reply_text = COALESCE($9, private_reply_text),
         is_active = COALESCE($10, is_active),
         updated_at = NOW()
       WHERE id = $1 AND page_id = $2
       RETURNING *`,
      [
        ruleId,
        page.page_id,
        keywords,
        b.matchType || null,
        Number.isFinite(Number(b.priority)) ? Number(b.priority) : null,
        typeof b.publicReplyEnabled === 'boolean' ? b.publicReplyEnabled : null,
        b.publicReplyText !== undefined ? b.publicReplyText : null,
        typeof b.privateReplyEnabled === 'boolean' ? b.privateReplyEnabled : null,
        b.privateReplyText !== undefined ? b.privateReplyText : null,
        typeof b.isActive === 'boolean' ? b.isActive : null,
      ]
    );

    res.json({ success: true, data: { rule: result.rows[0] } });
  } catch (e) {
    next(e);
  }
};

export const deleteOfficialPageKeywordRule = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    await ensurePlatformCommentTables();
    const page = await requireLinkedPage();
    const ruleId = req.params.ruleId;

    const result = await pool.query(
      `DELETE FROM platform_keyword_rules WHERE id = $1 AND page_id = $2 RETURNING id`,
      [ruleId, page.page_id]
    );
    if (result.rows.length === 0) throw createError('القاعدة غير موجودة', 404);

    res.json({ success: true, data: { message: 'تم حذف القاعدة' } });
  } catch (e) {
    next(e);
  }
};
