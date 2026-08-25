/**
 * Comment automation (per selected post only):
 * - Public reply: keyword rule text or post public_reply_text (template/custom)
 * - Private reply: template/custom only — never AI-generated
 * - Still seeds conversation with linked product for later AI turns
 */

import pool from '../database/connection.js';
import { logger } from '../utils/logger.js';
import { findMatchingKeywordRule } from './socialKeywordMatcher.js';
import {
  applyAcquisitionToConversation,
  resolveProductForExternalContent,
  type AcquisitionContext
} from './socialAcquisition.js';
import {
  applyCommentTemplate,
  clampSocialText,
  DEFAULT_COMMENT_REPLY,
  DEFAULT_DM_AFTER_COMMENT
} from './socialCommentReplies.js';
import {
  logMissingPublicMention,
  resolvePublicCommentMentionIdentity,
  withPublicCommentMention
} from './socialCommentMention.js';
import type { ConversationState } from '../core/types.js';

export type CommentAutomationAccount = {
  merchant_id: string;
  access_token: string;
  auto_reply_comments?: boolean;
  send_dm_on_comment?: boolean;
  comment_reply_template?: string | null;
  comment_dm_template?: string | null;
  comment_automation_mode?: string | null;
};

export type CommentAutomationInput = {
  platform: 'facebook' | 'instagram';
  accountRef: string;
  pageIdForMessaging: string;
  externalPostId?: string | null;
  commentId: string;
  commentText: string;
  commenterId?: string | null;
  commenterName: string;
  /** Instagram username (without @) for public @mention */
  commenterUsername?: string | null;
  account: CommentAutomationAccount;
  sendPublicReply: (commentId: string, text: string, accessToken: string) => Promise<boolean>;
  sendPrivateReply: (
    pageId: string,
    commentId: string,
    text: string,
    accessToken: string
  ) => Promise<boolean>;
};

type PostReplyRow = {
  id: string;
  external_post_id: string;
  comment_reply_enabled: boolean;
  public_reply_text: string | null;
  send_dm_on_comment: boolean;
  private_reply_text: string | null;
};

async function alreadyHandled(
  merchantId: string,
  platform: string,
  commentId: string
): Promise<boolean> {
  const r = await pool.query(
    `SELECT 1 FROM social_comment_actions
     WHERE merchant_id = $1 AND platform = $2 AND external_comment_id = $3
     LIMIT 1`,
    [merchantId, platform, commentId]
  );
  return r.rows.length > 0;
}

async function recordAction(params: {
  merchantId: string;
  platform: string;
  accountRef: string;
  commentId: string;
  postId?: string | null;
  ruleId?: string | null;
  keyword?: string | null;
  publicReplied: boolean;
  privateReplied: boolean;
  conversationId?: string | null;
  productId?: string | null;
  metadata?: Record<string, unknown>;
}) {
  await pool.query(
    `INSERT INTO social_comment_actions (
       merchant_id, platform, account_ref, external_comment_id, external_post_id,
       matched_rule_id, matched_keyword, public_replied, private_replied,
       conversation_id, product_id, metadata
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb)
     ON CONFLICT (merchant_id, platform, external_comment_id) DO NOTHING`,
    [
      params.merchantId,
      params.platform,
      params.accountRef,
      params.commentId,
      params.postId || null,
      params.ruleId || null,
      params.keyword || null,
      params.publicReplied,
      params.privateReplied,
      params.conversationId || null,
      params.productId || null,
      JSON.stringify(params.metadata || {})
    ]
  );
}

async function loadEnabledPost(params: {
  merchantId: string;
  platform: 'facebook' | 'instagram';
  externalPostId: string;
}): Promise<PostReplyRow | null> {
  const r = await pool.query(
    `SELECT id, external_post_id, comment_reply_enabled, public_reply_text,
            send_dm_on_comment, private_reply_text
     FROM social_posts
     WHERE merchant_id = $1
       AND platform = $2
       AND external_post_id = $3
       AND comment_reply_enabled = true
     LIMIT 1`,
    [params.merchantId, params.platform, params.externalPostId]
  );
  return (r.rows[0] as PostReplyRow) || null;
}

export async function runCommentAutomation(input: CommentAutomationInput): Promise<void> {
  const {
    platform,
    accountRef,
    pageIdForMessaging,
    externalPostId,
    commentId,
    commentText,
    commenterId,
    commenterName,
    commenterUsername,
    account
  } = input;

  const merchantId = account.merchant_id;

  if (await alreadyHandled(merchantId, platform, commentId)) {
    logger.debug('Comment already handled', { merchantId, commentId, platform });
    return;
  }

  if (!externalPostId) {
    logger.info('Comment skipped: missing post id (per-post replies only)', {
      merchantId,
      commentId,
      platform
    });
    return;
  }

  const post = await loadEnabledPost({
    merchantId,
    platform,
    externalPostId: String(externalPostId)
  });

  if (!post) {
    logger.debug('Comment skipped: post not selected for auto-reply', {
      merchantId,
      externalPostId,
      platform
    });
    return;
  }

  const mention = await resolvePublicCommentMentionIdentity({
    platform,
    commentId,
    accessToken: account.access_token,
    commenterId,
    commenterName,
    commenterUsername
  });
  const displayName =
    mention.commenterName?.trim() ||
    mention.commenterUsername?.trim() ||
    commenterName ||
    'صديقنا';

  const match = await findMatchingKeywordRule({
    merchantId,
    platform,
    accountRef,
    externalPostId: post.external_post_id,
    commentText,
    postScopeOnly: true
  });

  let publicText: string | null = null;
  let privateText: string | null = null;
  let sendPrivate = false;
  let matchedRuleId: string | null = null;
  let matchedKeyword: string | null = null;

  if (match) {
    matchedRuleId = match.rule.id;
    matchedKeyword = match.matchedKeyword;
    if (match.rule.public_reply_enabled) {
      publicText = clampSocialText(
        applyCommentTemplate(match.rule.public_reply_text, post.public_reply_text || DEFAULT_COMMENT_REPLY, {
          comment: commentText,
          name: displayName
        }).replace(/\{\{keyword\}\}/gi, match.matchedKeyword)
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
    // No keyword match → post-level public / private templates
    publicText = clampSocialText(
      applyCommentTemplate(post.public_reply_text, DEFAULT_COMMENT_REPLY, {
        comment: commentText,
        name: displayName
      })
    );
    sendPrivate = post.send_dm_on_comment === true;
    if (sendPrivate) {
      privateText = clampSocialText(
        applyCommentTemplate(post.private_reply_text, DEFAULT_DM_AFTER_COMMENT, {
          comment: commentText,
          name: displayName
        })
      );
    }
  }

  let publicReplied = false;
  if (publicText) {
    logMissingPublicMention(mention, { commentId, merchantId });
    const mentionedPublicText = clampSocialText(withPublicCommentMention(publicText, mention));
    publicReplied = await input.sendPublicReply(
      commentId,
      mentionedPublicText,
      account.access_token
    );
  }

  let conversationId: string | null = null;
  let productId: string | null = null;
  let privateReplied = false;

  if (sendPrivate && privateText) {
    const resolved = await resolveProductForExternalContent({
      merchantId,
      platform,
      externalPostId: post.external_post_id
    });
    productId = resolved.productId;

    const acquisition: AcquisitionContext = {
      source: 'comment',
      post_id: post.external_post_id,
      comment_id: commentId,
      product_id: productId,
      linked_recommended: resolved.linkedRecommended,
      platform,
      account_ref: accountRef,
      captured_at: new Date().toISOString()
    };

    const convPlatform = platform === 'facebook' ? 'facebook_messenger' : 'instagram';
    const userId = mention.commenterId || commenterId || `comment:${commentId}`;

    const existing = await pool.query(
      `SELECT id, conversation_state FROM conversations
       WHERE merchant_id = $1 AND platform = $2 AND user_id = $3
       ORDER BY last_message_at DESC LIMIT 1`,
      [merchantId, convPlatform, userId]
    );

    let state: ConversationState = { message_count: 0 };
    if (existing.rows.length > 0) {
      conversationId = existing.rows[0].id;
      state = existing.rows[0].conversation_state || { message_count: 0 };
    } else {
      const created = await pool.query(
        `INSERT INTO conversations (merchant_id, platform, user_id, user_name)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [merchantId, convPlatform, userId, displayName || 'Social User']
      );
      conversationId = created.rows[0].id;
    }

    // Seed product context for later AI turns — do not generate the DM with AI
    state = await applyAcquisitionToConversation({
      conversationId: conversationId!,
      merchantId,
      acquisition,
      conversationState: state
    });

    privateReplied = await input.sendPrivateReply(
      pageIdForMessaging,
      commentId,
      privateText,
      account.access_token
    );

    if (privateReplied && conversationId) {
      await pool.query(
        `INSERT INTO messages (conversation_id, role, content, sender_type, source, metadata)
         VALUES ($1, 'user', $2, 'user', $3, $4::jsonb),
                ($1, 'assistant', $5, 'bot', $3, $6::jsonb)`,
        [
          conversationId,
          commentText || 'تعليق على منشور',
          convPlatform,
          JSON.stringify({ from_comment: true, comment_id: commentId }),
          privateText,
          JSON.stringify({
            from_comment_private_reply: true,
            template_only: true,
            product_id: productId
          })
        ]
      );
      await pool.query(
        `UPDATE conversations
         SET last_message_at = NOW(), updated_at = NOW()
         WHERE id = $1 AND merchant_id = $2`,
        [conversationId, merchantId]
      );
    }
  }

  await recordAction({
    merchantId,
    platform,
    accountRef,
    commentId,
    postId: post.external_post_id,
    ruleId: matchedRuleId,
    keyword: matchedKeyword,
    publicReplied,
    privateReplied,
    conversationId,
    productId,
    metadata: { per_post: true, template_dm: true, social_post_id: post.id }
  });

  logger.info('Per-post comment automation finished', {
    merchantId,
    commentId,
    externalPostId: post.external_post_id,
    publicReplied,
    privateReplied,
    matchedKeyword,
    productId
  });
}
