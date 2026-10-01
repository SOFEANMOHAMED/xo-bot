/**
 * Shared Graph API helpers for Instagram public comment replies and commenter identity.
 * Used by merchant and platform (official page) comment automation.
 */

import { logger } from '../utils/logger.js';

const GRAPH_VERSION = process.env.FACEBOOK_GRAPH_VERSION || 'v21.0';

/**
 * Reply to an IG comment. Mention parsing is documented on the `message` parameter
 * (`POST /{ig-comment-id}/replies?message=`), so send it as a form field.
 * @see https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-comment/replies/
 */
export async function sendInstagramCommentReply(
  commentId: string,
  message: string,
  accessToken: string
): Promise<boolean> {
  try {
    const url =
      `https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(commentId)}/replies` +
      `?access_token=${encodeURIComponent(accessToken)}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ message }).toString(),
    });
    const data = (await response.json()) as { error?: { message?: string } };
    if (!response.ok) {
      logger.error('Instagram comment reply failed', new Error(JSON.stringify(data)), { commentId });
      return false;
    }
    return true;
  } catch (error) {
    logger.error('Error sending Instagram comment reply', error as Error, { commentId });
    return false;
  }
}

/**
 * First private message after an IG comment — must use comment_id (Private Replies).
 * @see https://developers.facebook.com/docs/messenger-platform/instagram/features/private-replies/
 */
export async function sendInstagramPrivateReplyAfterComment(
  pageId: string,
  commentId: string,
  message: string,
  accessToken: string
): Promise<boolean> {
  try {
    const url =
      `https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(pageId)}/messages` +
      `?access_token=${encodeURIComponent(accessToken)}`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipient: { comment_id: commentId },
        message: { text: message },
      }),
    });
    const data = (await resp.json()) as { error?: unknown };
    if (!resp.ok) {
      logger.error(
        'Instagram private reply after comment failed',
        new Error(JSON.stringify(data)),
        { pageId, commentId }
      );
      return false;
    }
    return true;
  } catch (error) {
    logger.error('Error sending Instagram private reply', error as Error, { pageId, commentId });
    return false;
  }
}

/**
 * Resolve Instagram username for @mention. Webhooks often omit `from.username`;
 * since Aug 2024 Graph requires instagram_manage_comments to read `username`.
 */
export async function fetchInstagramCommenterUsername(
  commentId: string,
  accessToken: string
): Promise<string | null> {
  try {
    const url =
      `https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(commentId)}` +
      `?fields=username,from{username}&access_token=${encodeURIComponent(accessToken)}`;
    const response = await fetch(url);
    const data = (await response.json()) as {
      username?: string;
      from?: { username?: string };
      error?: { message?: string };
    };
    if (!response.ok || data.error) {
      logger.warn('IG comment username lookup failed', {
        commentId,
        err: data.error?.message,
      });
      return null;
    }
    const username = data.username || data.from?.username;
    const normalized =
      username && String(username).trim()
        ? String(username).trim().replace(/^@+/, '')
        : '';
    return normalized || null;
  } catch (error) {
    logger.error('IG comment username lookup error', error as Error, { commentId });
    return null;
  }
}
