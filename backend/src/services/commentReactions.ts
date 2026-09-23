/**
 * Comment reaction domain.
 * Platform-agnostic types + capability checks; Graph calls live in facebookCommentGraph.
 *
 * Note: Facebook Page tokens can only publish a Like via POST /{comment-id}/likes.
 * Other types are accepted in settings for forward-compat but Graph maps them to Like.
 */

export const COMMENT_REACTION_TYPES = [
  'LIKE',
  'LOVE',
  'CARE',
  'WOW',
  'HAHA',
  'SAD',
  'ANGRY',
] as const;

export type CommentReactionType = (typeof COMMENT_REACTION_TYPES)[number];

export const DEFAULT_COMMENT_REACTION: CommentReactionType = 'LIKE';

/** Types Meta allows Pages to publish via Graph today. */
export const PAGE_GRAPH_PUBLISHABLE_REACTION_TYPES: readonly CommentReactionType[] = [
  'LIKE',
];

const REACTION_SET = new Set<string>(COMMENT_REACTION_TYPES);

export function isCommentReactionType(value: unknown): value is CommentReactionType {
  return typeof value === 'string' && REACTION_SET.has(value.toUpperCase());
}

/** Normalize API/DB input; returns null if invalid. */
export function normalizeCommentReactionType(value: unknown): CommentReactionType | null {
  if (typeof value !== 'string') return null;
  const upper = value.trim().toUpperCase();
  return isCommentReactionType(upper) ? upper : null;
}

export function parseCommentReactionType(
  value: unknown,
  fallback: CommentReactionType = DEFAULT_COMMENT_REACTION
): CommentReactionType {
  return normalizeCommentReactionType(value) ?? fallback;
}

/** Meta Page can react to comments; Instagram Business comments do not support this. */
export function platformSupportsCommentReactions(
  platform: 'facebook' | 'instagram'
): boolean {
  return platform === 'facebook';
}

export type CommentReactionActionResult = {
  attempted: boolean;
  success: boolean;
  reactionType: CommentReactionType | null;
  skippedReason?: 'disabled' | 'unsupported_platform' | 'no_handler' | 'invalid_type';
};

export type ReactToCommentFn = (
  commentId: string,
  reactionType: CommentReactionType,
  accessToken: string
) => Promise<boolean>;

/**
 * Execute a configured comment reaction if enabled and platform-capable.
 * Safe no-op when disabled / unsupported — never throws.
 */
export async function applyCommentReaction(params: {
  enabled: boolean;
  reactionType: unknown;
  platform: 'facebook' | 'instagram';
  commentId: string;
  accessToken: string;
  sendReaction?: ReactToCommentFn;
}): Promise<CommentReactionActionResult> {
  if (!params.enabled) {
    return {
      attempted: false,
      success: false,
      reactionType: null,
      skippedReason: 'disabled',
    };
  }

  if (!platformSupportsCommentReactions(params.platform)) {
    return {
      attempted: false,
      success: false,
      reactionType: null,
      skippedReason: 'unsupported_platform',
    };
  }

  if (!params.sendReaction) {
    return {
      attempted: false,
      success: false,
      reactionType: null,
      skippedReason: 'no_handler',
    };
  }

  const reactionType = normalizeCommentReactionType(params.reactionType);
  if (!reactionType) {
    return {
      attempted: false,
      success: false,
      reactionType: null,
      skippedReason: 'invalid_type',
    };
  }

  const success = await params.sendReaction(
    params.commentId,
    reactionType,
    params.accessToken
  );

  return {
    attempted: true,
    success,
    reactionType,
  };
}
