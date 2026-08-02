/**
 * Keyword matching for social comment auto-replies (merchant-scoped).
 * Order: post-scoped rules → account-scoped rules → null (caller uses fallback template).
 */

import pool from '../database/connection.js';

export type KeywordRuleRow = {
  id: string;
  merchant_id: string;
  platform: string;
  account_ref: string;
  scope: 'account' | 'post';
  social_post_id: string | null;
  external_post_id: string | null;
  keywords: string[];
  match_type: 'contains' | 'exact' | 'starts_with';
  priority: number;
  public_reply_enabled: boolean;
  public_reply_text: string | null;
  private_reply_enabled: boolean;
  private_reply_text: string | null;
  open_ai_conversation: boolean;
  is_active: boolean;
};

export type KeywordMatch = {
  rule: KeywordRuleRow;
  matchedKeyword: string;
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

export async function findMatchingKeywordRule(params: {
  merchantId: string;
  platform: 'facebook' | 'instagram';
  accountRef: string;
  externalPostId?: string | null;
  commentText: string;
  /** When true, only rules with scope=post for this external post are considered */
  postScopeOnly?: boolean;
}): Promise<KeywordMatch | null> {
  const { merchantId, platform, accountRef, externalPostId, commentText, postScopeOnly } = params;

  if (postScopeOnly && !externalPostId) {
    return null;
  }

  const result = await pool.query(
    `SELECT * FROM social_keyword_rules
     WHERE merchant_id = $1
       AND platform = $2
       AND account_ref = $3
       AND is_active = true
       AND (
         (scope = 'post' AND (
           ($4::text IS NOT NULL AND external_post_id = $4)
           OR ($4::text IS NOT NULL AND social_post_id IN (
             SELECT id FROM social_posts
             WHERE merchant_id = $1 AND platform = $2 AND external_post_id = $4
           ))
         ))
         OR ($5::boolean IS NOT TRUE AND scope = 'account')
       )
     ORDER BY
       CASE WHEN scope = 'post' THEN 0 ELSE 1 END,
       priority DESC,
       created_at ASC`,
    [merchantId, platform, accountRef, externalPostId || null, !!postScopeOnly]
  );

  for (const row of result.rows as KeywordRuleRow[]) {
    const matchedKeyword = ruleMatches(row, commentText);
    if (matchedKeyword) {
      return { rule: row, matchedKeyword };
    }
  }
  return null;
}
