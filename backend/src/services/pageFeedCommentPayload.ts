/**
 * Normalize Meta Page `feed` webhook payloads — field names vary by API version / product surface.
 */

export type NormalizedFeedComment = {
  commentId: string | undefined;
  message: string;
  fromId: string | undefined;
  fromName?: string;
  fromUsername?: string;
  /** Parent post / media id when Meta includes it */
  postId?: string;
  parentId?: string;
};

export function normalizePageFeedCommentValue(value: Record<string, unknown> | null | undefined): NormalizedFeedComment {
  if (!value || typeof value !== 'object') {
    return { commentId: undefined, message: '', fromId: undefined };
  }

  const v = value as Record<string, any>;
  const commentIdRaw = v.comment_id ?? v.id ?? v.comment?.id;
  const commentId = commentIdRaw != null ? String(commentIdRaw) : undefined;

  const message = String(v.message ?? v.text ?? v.comment_text ?? '').trim();

  const fromIdRaw =
    v.from?.id ?? v.sender_id ?? v.from_id ?? (typeof v.sender === 'object' && v.sender?.id ? v.sender.id : undefined);
  const fromId = fromIdRaw != null ? String(fromIdRaw) : undefined;

  const postIdRaw =
    v.post_id ??
    v.post?.id ??
    v.media?.id ??
    v.media_id ??
    (typeof v.parent_id === 'string' && v.parent_id !== commentIdRaw ? v.parent_id : undefined);
  const parentIdRaw = v.parent_id != null ? String(v.parent_id) : undefined;

  return {
    commentId,
    message,
    fromId,
    fromName: v.from?.name,
    fromUsername: v.from?.username,
    postId: postIdRaw != null ? String(postIdRaw) : undefined,
    parentId: parentIdRaw
  };
}

/**
 * Detect comment-related feed webhooks. Meta sometimes omits `item` or uses different casing.
 */
export function isPageFeedCommentEvent(value: Record<string, unknown> | null | undefined): boolean {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, any>;
  const item = typeof v.item === 'string' ? v.item.toLowerCase() : '';

  if (item === 'post' || item === 'status' || item === 'reaction' || item === 'like' || item === 'share') {
    return false;
  }
  if (item === 'comment') return true;
  if (v.comment_id != null && String(v.comment_id).length > 0) return true;
  return false;
}
