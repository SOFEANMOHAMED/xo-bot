/**
 * Merchant-facing comment reaction options (Facebook Page).
 *
 * Meta Graph only allows Pages to Like comments via POST /{comment-id}/likes.
 * Other reaction types (Love, etc.) are not available to third-party apps.
 * Keep ids aligned with backend/src/services/commentReactions.ts
 */

export const COMMENT_REACTION_OPTIONS = [
  { id: 'LIKE', label: 'إعجاب (لايك)', emoji: '👍' },
] as const;

/** Kept for forward-compat / stored legacy values — only LIKE is selectable. */
export const COMMENT_REACTION_LEGACY_LABELS: Record<string, string> = {
  LIKE: 'إعجاب (لايك)',
  LOVE: 'أحببته',
  CARE: 'أهتم',
  WOW: 'واو',
  HAHA: 'هاها',
  SAD: 'حزين',
  ANGRY: 'غاضب',
};

export type CommentReactionOptionId = (typeof COMMENT_REACTION_OPTIONS)[number]['id'];

export const DEFAULT_COMMENT_REACTION: CommentReactionOptionId = 'LIKE';

export function isCommentReactionOptionId(value: unknown): value is CommentReactionOptionId {
  return (
    typeof value === 'string' &&
    COMMENT_REACTION_OPTIONS.some((o) => o.id === value.toUpperCase())
  );
}

/** Always resolves to a Graph-supported option (LIKE). */
export function parseCommentReactionOptionId(
  _value?: unknown,
  fallback: CommentReactionOptionId = DEFAULT_COMMENT_REACTION
): CommentReactionOptionId {
  return fallback;
}
