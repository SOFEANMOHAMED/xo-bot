/**
 * Default Arabic templates for public comment replies and follow-up DMs.
 * Merchants can override via facebook_pages / instagram_accounts columns.
 * Placeholders: {{name}}, {{comment}}
 *
 * Public replies also get an automatic platform mention prepended:
 * - Facebook: @[PSID] (Pages API comment tagging)
 * - Instagram: @username
 */

export const DEFAULT_COMMENT_REPLY = `شكراً لتعليقك! 💬 يسعدنا اهتمامك. يمكنك مراسلتنا في الخاص لأي استفسار أو طلب.`;

export const DEFAULT_DM_AFTER_COMMENT = `مرحباً {{name}}! شكراً لتواصلك معنا. كيف نقدر نخدمك اليوم؟`;

export function applyCommentTemplate(
  template: string | null | undefined,
  fallback: string,
  vars: { comment?: string; name?: string }
): string {
  const base = template != null && String(template).trim() !== '' ? String(template).trim() : fallback;
  return base
    .replace(/\{\{comment\}\}/gi, vars.comment ?? '')
    .replace(/\{\{name\}\}/gi, vars.name ?? '');
}

/**
 * Prepend a platform-native @mention so the commenter is notified on public replies.
 * Skips when identity is missing or the message already contains the same tag.
 * Private DMs should not use this — mention syntax is for public comments only.
 */
export function withPublicCommentMention(
  message: string,
  opts: {
    platform: 'facebook' | 'instagram';
    commenterId?: string | null;
    commenterUsername?: string | null;
  }
): string {
  const text = (message ?? '').trim();
  if (!text) return text;

  if (opts.platform === 'facebook') {
    const id = String(opts.commenterId ?? '').trim();
    if (!id || !/^\d+$/.test(id)) return text;
    const tag = `@[${id}]`;
    if (text.includes(tag)) return text;
    return `${tag} ${text}`;
  }

  const username = String(opts.commenterUsername ?? '')
    .trim()
    .replace(/^@+/, '');
  if (!username || !/^[A-Za-z0-9._]+$/.test(username)) return text;
  const tag = `@${username}`;
  // Case-insensitive check so we don't double-tag
  const escaped = username.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (new RegExp(`(^|\\s)@${escaped}(\\b|\\s|$)`, 'i').test(text)) return text;
  return `${tag} ${text}`;
}

/** Max length for Graph API comment / DM text safety */
export function clampSocialText(text: string, maxLen = 1800): string {
  const t = text.trim();
  if (t.length <= maxLen) return t;
  return t.slice(0, maxLen - 1) + '…';
}
