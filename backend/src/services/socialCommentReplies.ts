/**
 * Default Arabic templates for public comment replies and follow-up DMs.
 * Merchants can override via facebook_pages / instagram_accounts columns.
 * Placeholders: {{name}}, {{comment}}
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

/** Max length for Graph API comment / DM text safety */
export function clampSocialText(text: string, maxLen = 1800): string {
  const t = text.trim();
  if (t.length <= maxLen) return t;
  return t.slice(0, maxLen - 1) + '…';
}
