/**
 * Shared Graph API helpers for Facebook comment public + private replies.
 * Used by merchant and platform (official page) comment automation.
 */

import { logger } from '../utils/logger.js';

const GRAPH_VERSION = process.env.FACEBOOK_GRAPH_VERSION || 'v21.0';

export type FacebookCommenterProfile = {
  fromId: string | null;
  fromName: string | null;
  message: string;
};

/**
 * First private message after a page comment — must use comment_id (Private Replies).
 * Send API requires JSON (recipient + message object), not form fields.
 * @see https://developers.facebook.com/docs/messenger-platform/discovery/private-replies/
 */
export async function sendFacebookPrivateReplyAfterComment(
  pageId: string,
  commentId: string,
  message: string,
  accessToken: string
): Promise<boolean> {
  try {
    const url =
      `https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(pageId)}/messages` +
      `?access_token=${encodeURIComponent(accessToken)}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipient: { comment_id: commentId },
        message: { text: message },
      }),
    });
    const data = (await response.json()) as { error?: { message?: string; code?: number } };
    if (!response.ok) {
      logger.error(
        'Facebook private reply after comment failed',
        new Error(JSON.stringify(data)),
        { pageId, commentId, graphCode: data?.error?.code }
      );
      return false;
    }
    return true;
  } catch (error) {
    logger.error('Error sending Facebook private reply', error as Error, { pageId, commentId });
    return false;
  }
}

/**
 * Public reply on a comment. Graph mention parsing expects `message` as a form field
 * (same encoding as Page content publishing), not a JSON body.
 */
export async function sendFacebookCommentReply(
  commentId: string,
  message: string,
  accessToken: string
): Promise<boolean> {
  try {
    const url =
      `https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(commentId)}/comments` +
      `?access_token=${encodeURIComponent(accessToken)}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ message }).toString(),
    });
    const data = (await response.json()) as { error?: { message?: string } };
    if (!response.ok) {
      logger.error(
        'Facebook public comment reply failed',
        new Error(JSON.stringify(data)),
        { commentId }
      );
      return false;
    }
    return true;
  } catch (error) {
    logger.error('Error sending Facebook comment reply', error as Error, { commentId });
    return false;
  }
}

/** When a webhook omits `from` (privacy), load the commenter via a Page token. */
export async function fetchFacebookCommenterProfile(
  commentId: string,
  accessToken: string
): Promise<FacebookCommenterProfile | null> {
  try {
    const url =
      `https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(commentId)}` +
      `?fields=from,message&access_token=${encodeURIComponent(accessToken)}`;
    const response = await fetch(url);
    const data = (await response.json()) as {
      from?: { id?: string; name?: string };
      message?: string;
      error?: { message?: string };
    };
    if (!response.ok || data.error) {
      logger.warn('Facebook comment Graph lookup failed', {
        commentId,
        err: data.error?.message,
      });
      return null;
    }
    return {
      fromId: data.from?.id != null ? String(data.from.id) : null,
      fromName: data.from?.name ? String(data.from.name) : null,
      message: data.message != null ? String(data.message) : '',
    };
  } catch (error) {
    logger.error('Facebook comment Graph lookup error', error as Error, { commentId });
    return null;
  }
}
