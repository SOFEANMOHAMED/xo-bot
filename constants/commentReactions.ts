/**
 * Merchant UI: Facebook Page can only Like comments via Graph API.
 */

export const DEFAULT_COMMENT_REACTION = 'LIKE' as const;

export type CommentReactionOptionId = typeof DEFAULT_COMMENT_REACTION;
