/**
 * Comment reaction domain (Page Like on comments).
 * Graph publishing lives in facebookCommentGraph — Meta only supports LIKE via /likes.
 */

export const DEFAULT_COMMENT_REACTION = 'LIKE' as const;

export type CommentReactionType = typeof DEFAULT_COMMENT_REACTION;

export function platformSupportsCommentReactions(
  platform: 'facebook' | 'instagram'
): boolean {
  return platform === 'facebook';
}

export type CommentReactionActionResult = {
  attempted: boolean;
  success: boolean;
  reactionType: CommentReactionType | null;
  skippedReason?: 'disabled' | 'unsupported_platform' | 'no_handler';
};

export type ReactToCommentFn = (
  commentId: string,
  reactionType: CommentReactionType,
  accessToken: string
) => Promise<boolean>;

/**
 * Apply a configured comment like when enabled and platform-capable.
 * Never throws.
 */
export async function applyCommentReaction(params: {
  enabled: boolean;
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

  const success = await params.sendReaction(
    params.commentId,
    DEFAULT_COMMENT_REACTION,
    params.accessToken
  );

  return {
    attempted: true,
    success,
    reactionType: DEFAULT_COMMENT_REACTION,
  };
}
