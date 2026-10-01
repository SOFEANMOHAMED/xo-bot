/**
 * Official XO Bot page comment automation (per selected post).
 * Isolated from merchant CRM / products / SalesGPT.
 * Supports Facebook Page feed comments and Instagram (page-feed + IG webhooks).
 * Private replies seed platform_conversations for the official Messenger bot.
 */

import pool from '../database/connection.js';
import { logger } from '../utils/logger.js';
import {
  applyCommentTemplate,
  clampSocialText,
  DEFAULT_COMMENT_REPLY,
  DEFAULT_DM_AFTER_COMMENT,
} from './socialCommentReplies.js';
import {
  logMissingPublicMention,
  resolvePublicCommentMentionIdentity,
  withPublicCommentMention,
} from './socialCommentMention.js';
import {
  fetchFacebookCommenterProfile,
  reactToFacebookComment,
  sendFacebookCommentReply,
  sendFacebookPrivateReplyAfterComment,
} from './facebookCommentGraph.js';
import {
  sendInstagramCommentReply,
  sendInstagramPrivateReplyAfterComment,
} from './instagramCommentGraph.js';
import { applyCommentReaction } from './commentReactions.js';
import { ensurePlatformCommentTables } from './platformSocialPosts.js';
import type { PlatformFacebookPage } from './platformFacebookPage.js';

type OfficialPlatform = 'facebook' | 'instagram';

type PostReplyRow = {
  id: string;
  external_post_id: string;
  comment_reply_enabled: boolean;
  public_reply_text: string | null;
  send_dm_on_comment: boolean;
  private_reply_text: string | null;
  react_on_comment_enabled: boolean;
};

type KeywordRuleRow = {
  id: string;
  keywords: string[];
  match_type: 'contains' | 'exact' | 'starts_with';
  priority: number;
  public_reply_enabled: boolean;
  public_reply_text: string | null;
  private_reply_enabled: boolean;
  private_reply_text: string | null;
};

function normalizeText(s: string): string {
  return String(s || '')
    .toLowerCase()
    .replace(/[إأآا]/g, 'ا')
    .replace(/[ة]/g, 'ه')
    .replace(/[ى]/g, 'ي')
    .replace(/[\u064B-\u065F]/g, '')
    .trim();
}

function ruleMatches(rule: KeywordRuleRow, commentText: string): string | null {
  const text = normalizeText(commentText);
  if (!text) return null;
  const keywords = Array.isArray(rule.keywords) ? rule.keywords : [];
  for (const raw of keywords) {
    const kw = normalizeText(raw);
    if (!kw) continue;
    if (rule.match_type === 'exact' && text === kw) return raw;
    if (rule.match_type === 'starts_with' && text.startsWith(kw)) return raw;
    if ((!rule.match_type || rule.match_type === 'contains') && text.includes(kw)) return raw;
  }
  return null;
}

async function alreadyHandled(
  pageId: string,
  platform: OfficialPlatform,
  commentId: string
): Promise<boolean> {
  const r = await pool.query(
    `SELECT 1 FROM platform_comment_actions
     WHERE page_id = $1 AND platform = $2 AND external_comment_id = $3
     LIMIT 1`,
    [pageId, platform, commentId]
  );
  return r.rows.length > 0;
}

async function loadAutomationPost(
  pageId: string,
  platform: OfficialPlatform,
  externalPostId: string
): Promise<PostReplyRow | null> {
  const r = await pool.query(
    `SELECT id, external_post_id, comment_reply_enabled, public_reply_text,
            send_dm_on_comment, private_reply_text,
            COALESCE(react_on_comment_enabled, false) AS react_on_comment_enabled
     FROM platform_social_posts
     WHERE page_id = $1
       AND platform = $2
       AND external_post_id = $3
       AND (
         comment_reply_enabled = true
         OR COALESCE(react_on_comment_enabled, false) = true
       )
     LIMIT 1`,
    [pageId, platform, externalPostId]
  );
  return (r.rows[0] as PostReplyRow) || null;
}

async function findMatchingRule(params: {
  pageId: string;
  platform: OfficialPlatform;
  accountRef: string;
  externalPostId: string;
  commentText: string;
}): Promise<{ rule: KeywordRuleRow; matchedKeyword: string } | null> {
  const result = await pool.query(
    `SELECT id, keywords, match_type, priority, public_reply_enabled, public_reply_text,
            private_reply_enabled, private_reply_text
     FROM platform_keyword_rules
     WHERE page_id = $1
       AND platform = $2
       AND account_ref = $3
       AND is_active = true
       AND scope = 'post'
       AND (
         external_post_id = $4
         OR social_post_id IN (
           SELECT id FROM platform_social_posts
           WHERE page_id = $1 AND platform = $2 AND external_post_id = $4
         )
       )
     ORDER BY priority DESC, created_at DESC`,
    [params.pageId, params.platform, params.accountRef, params.externalPostId]
  );

  for (const row of result.rows as KeywordRuleRow[]) {
    const matched = ruleMatches(row, params.commentText);
    if (matched) return { rule: row, matchedKeyword: matched };
  }
  return null;
}

async function recordAction(params: {
  pageId: string;
  platform: OfficialPlatform;
  accountRef: string;
  commentId: string;
  postId?: string | null;
  ruleId?: string | null;
  keyword?: string | null;
  publicReplied: boolean;
  privateReplied: boolean;
  conversationId?: string | null;
  metadata?: Record<string, unknown>;
}) {
  await pool.query(
    `INSERT INTO platform_comment_actions (
       page_id, platform, account_ref, external_comment_id, external_post_id,
       matched_rule_id, matched_keyword, public_replied, private_replied,
       conversation_id, metadata
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)
     ON CONFLICT (page_id, platform, external_comment_id) DO NOTHING`,
    [
      params.pageId,
      params.platform,
      params.accountRef,
      params.commentId,
      params.postId || null,
      params.ruleId || null,
      params.keyword || null,
      params.publicReplied,
      params.privateReplied,
      params.conversationId || null,
      JSON.stringify(params.metadata || {}),
    ]
  );
}

type OfficialCommentInput = {
  platform: OfficialPlatform;
  commentId: string;
  commentText: string;
  commenterId?: string | null;
  commenterName: string;
  commenterUsername?: string | null;
  externalPostId?: string | null;
};

async function runOfficialCommentAutomation(
  page: PlatformFacebookPage,
  input: OfficialCommentInput
): Promise<void> {
  await ensurePlatformCommentTables();

  const platform = input.platform;
  const accountRef =
    platform === 'instagram' ? page.ig_user_id || page.page_id : page.page_id;
  const commentId = String(input.commentId);
  let commentText = input.commentText || '';
  let commenterId = input.commenterId || null;
  let commenterName = input.commenterName || 'صديقنا';
  const commenterUsername = input.commenterUsername || null;
  const externalPostId = input.externalPostId || null;

  if (!commentId) {
    logger.warn('Official comment skipped: missing comment id', {
      pageId: page.page_id,
      platform,
    });
    return;
  }

  if (platform === 'facebook' && !commenterId) {
    const profile = await fetchFacebookCommenterProfile(commentId, page.access_token);
    if (profile?.fromId) {
      commenterId = profile.fromId;
      if (profile.fromName) commenterName = profile.fromName;
      if (profile.message && !commentText) commentText = profile.message;
    }
  }

  if (commenterId && String(commenterId) === String(page.page_id)) return;
  if (
    platform === 'instagram' &&
    page.ig_user_id &&
    commenterId &&
    String(commenterId) === String(page.ig_user_id)
  ) {
    return;
  }

  if (await alreadyHandled(page.page_id, platform, commentId)) {
    logger.debug('Official comment already handled', {
      pageId: page.page_id,
      platform,
      commentId,
    });
    return;
  }

  if (!externalPostId) {
    logger.info('Official comment skipped: missing post id', {
      pageId: page.page_id,
      platform,
      commentId,
    });
    return;
  }

  const post = await loadAutomationPost(page.page_id, platform, String(externalPostId));
  if (!post) {
    logger.debug('Official comment skipped: post not enabled', {
      pageId: page.page_id,
      platform,
      externalPostId,
    });
    return;
  }

  const mention = await resolvePublicCommentMentionIdentity({
    platform,
    commentId,
    accessToken: page.access_token,
    commenterId,
    commenterName,
    commenterUsername,
  });
  const displayName = mention.commenterName?.trim() || commenterName || 'صديقنا';
  if (mention.commenterId) commenterId = mention.commenterId;
  if (mention.commenterName) commenterName = mention.commenterName;

  let publicText: string | null = null;
  let privateText: string | null = null;
  let sendPrivate = false;
  let matchedRuleId: string | null = null;
  let matchedKeyword: string | null = null;

  if (post.comment_reply_enabled) {
    const match = await findMatchingRule({
      pageId: page.page_id,
      platform,
      accountRef,
      externalPostId: post.external_post_id,
      commentText,
    });

    if (match) {
      matchedRuleId = match.rule.id;
      matchedKeyword = match.matchedKeyword;
      if (match.rule.public_reply_enabled) {
        publicText = clampSocialText(
          applyCommentTemplate(
            match.rule.public_reply_text,
            post.public_reply_text || DEFAULT_COMMENT_REPLY,
            { comment: commentText, name: displayName }
          ).replace(/\{\{keyword\}\}/gi, match.matchedKeyword)
        );
      }
      sendPrivate = match.rule.private_reply_enabled === true;
      if (sendPrivate) {
        privateText = clampSocialText(
          applyCommentTemplate(
            match.rule.private_reply_text,
            post.private_reply_text || DEFAULT_DM_AFTER_COMMENT,
            { comment: commentText, name: displayName }
          ).replace(/\{\{keyword\}\}/gi, match.matchedKeyword)
        );
      }
    } else {
      publicText = clampSocialText(
        applyCommentTemplate(post.public_reply_text, DEFAULT_COMMENT_REPLY, {
          comment: commentText,
          name: displayName,
        })
      );
      sendPrivate = post.send_dm_on_comment === true;
      if (sendPrivate) {
        privateText = clampSocialText(
          applyCommentTemplate(post.private_reply_text, DEFAULT_DM_AFTER_COMMENT, {
            comment: commentText,
            name: displayName,
          })
        );
      }
    }
  }

  let publicReplied = false;
  if (publicText) {
    logMissingPublicMention(mention, { commentId });
    const mentioned = clampSocialText(withPublicCommentMention(publicText, mention));
    publicReplied =
      platform === 'instagram'
        ? await sendInstagramCommentReply(commentId, mentioned, page.access_token)
        : await sendFacebookCommentReply(commentId, mentioned, page.access_token);
  }

  const reaction = await applyCommentReaction({
    enabled: post.react_on_comment_enabled === true,
    platform,
    commentId,
    accessToken: page.access_token,
    sendReaction: platform === 'facebook' ? reactToFacebookComment : undefined,
  });

  let conversationId: string | null = null;
  let privateReplied = false;

  if (sendPrivate && privateText) {
    privateReplied =
      platform === 'instagram'
        ? await sendInstagramPrivateReplyAfterComment(
            page.page_id,
            commentId,
            privateText,
            page.access_token
          )
        : await sendFacebookPrivateReplyAfterComment(
            page.page_id,
            commentId,
            privateText,
            page.access_token
          );

    if (privateReplied && commenterId) {
      const existing = await pool.query(
        `SELECT id FROM platform_conversations
         WHERE page_id = $1 AND user_id = $2
         LIMIT 1`,
        [page.page_id, String(commenterId)]
      );

      if (existing.rows[0]) {
        conversationId = existing.rows[0].id;
      } else {
        const created = await pool.query(
          `INSERT INTO platform_conversations (page_id, user_id, user_name)
           VALUES ($1, $2, $3)
           ON CONFLICT (page_id, user_id) DO UPDATE SET updated_at = CURRENT_TIMESTAMP
           RETURNING id`,
          [page.page_id, String(commenterId), commenterName || null]
        );
        conversationId = created.rows[0].id;
      }

      if (conversationId) {
        await pool.query(
          `INSERT INTO platform_messages (conversation_id, role, content) VALUES
             ($1, 'user', $2),
             ($1, 'model', $3)`,
          [conversationId, commentText || 'تعليق على منشور', privateText]
        );
        await pool.query(
          `UPDATE platform_conversations
           SET last_message_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
           WHERE id = $1`,
          [conversationId]
        );
      }
    }
  }

  await recordAction({
    pageId: page.page_id,
    platform,
    accountRef,
    commentId,
    postId: post.external_post_id,
    ruleId: matchedRuleId,
    keyword: matchedKeyword,
    publicReplied,
    privateReplied,
    conversationId,
    metadata: {
      per_post: true,
      template_dm: true,
      social_post_id: post.id,
      reaction: {
        enabled: post.react_on_comment_enabled === true,
        attempted: reaction.attempted,
        success: reaction.success,
        type: reaction.reactionType,
        skipped: reaction.skippedReason || null,
      },
    },
  });

  logger.info('Official comment automation finished', {
    pageId: page.page_id,
    platform,
    commentId,
    externalPostId: post.external_post_id,
    publicReplied,
    privateReplied,
    reacted: reaction.success,
    reactionType: reaction.reactionType,
    matchedKeyword,
  });
}

/**
 * Process a feed comment on the official XO Bot Facebook page.
 */
export async function processOfficialPageComment(
  page: PlatformFacebookPage,
  value: Record<string, any>
): Promise<void> {
  const verb = typeof value?.verb === 'string' ? value.verb.toLowerCase() : '';
  if (verb === 'remove' || verb === 'hide' || verb === 'edited') {
    logger.debug('Official page comment skipped verb', { verb, pageId: page.page_id });
    return;
  }

  const { normalizePageFeedCommentValue } = await import('./pageFeedCommentPayload.js');
  const n = normalizePageFeedCommentValue(value);

  await runOfficialCommentAutomation(page, {
    platform: 'facebook',
    commentId: n.commentId || '',
    commentText: n.message,
    commenterId: n.fromId,
    commenterName: n.fromName || 'صديقنا',
    commenterUsername: null,
    externalPostId: n.postId || n.parentId || null,
  });
}

/**
 * Process an Instagram comment on the official XO Bot IG account (page-feed shape).
 */
export async function processOfficialInstagramCommentFromPageFeed(
  page: PlatformFacebookPage,
  value: Record<string, any>
): Promise<void> {
  if (!page.ig_user_id) {
    logger.warn('Official IG comment skipped: page has no ig_user_id', {
      pageId: page.page_id,
    });
    return;
  }

  const verb = typeof value?.verb === 'string' ? value.verb.toLowerCase() : '';
  if (verb === 'remove' || verb === 'hide' || verb === 'edited') {
    logger.debug('Official IG comment skipped verb', { verb, pageId: page.page_id });
    return;
  }

  const { normalizePageFeedCommentValue } = await import('./pageFeedCommentPayload.js');
  const n = normalizePageFeedCommentValue(value);
  const commenterUsername = n.fromUsername?.trim().replace(/^@+/, '') || null;

  await runOfficialCommentAutomation(page, {
    platform: 'instagram',
    commentId: n.commentId || '',
    commentText: n.message,
    commenterId: n.fromId,
    commenterName: n.fromName || commenterUsername || 'صديقنا',
    commenterUsername,
    externalPostId:
      n.postId ||
      (value?.media_id != null ? String(value.media_id) : null) ||
      n.parentId ||
      null,
  });
}

/**
 * Process an Instagram comments webhook payload for the official XO Bot account.
 */
export async function processOfficialInstagramCommentWebhook(
  page: PlatformFacebookPage,
  value: Record<string, any>
): Promise<void> {
  if (!page.ig_user_id) {
    logger.warn('Official IG webhook skipped: page has no ig_user_id', {
      pageId: page.page_id,
    });
    return;
  }

  const commentId = value?.id != null ? String(value.id) : '';
  const from = value?.from || {};
  const commenterUsername =
    typeof from.username === 'string' && from.username.trim()
      ? from.username.trim().replace(/^@+/, '')
      : null;

  await runOfficialCommentAutomation(page, {
    platform: 'instagram',
    commentId,
    commentText: value?.text != null ? String(value.text) : '',
    commenterId: from?.id != null ? String(from.id) : null,
    commenterName: commenterUsername || (from.name as string | undefined) || 'صديقنا',
    commenterUsername,
    externalPostId: value?.media?.id != null ? String(value.media.id) : null,
  });
}
