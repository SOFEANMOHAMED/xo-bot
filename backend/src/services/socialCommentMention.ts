/**
 * Public comment @mentions — single source of truth for Facebook and Instagram.
 *
 * Facebook Graph substitutes `@[PSID]` with a display name and often does NOT
 * create a `message_tags` entity (no blue link, no notification). The markup
 * Facebook itself uses for a real tag is `@[PSID:Name]` (or `@[PSID:0]` when
 * the name is unknown). Instagram tags are `@username`, never the display name.
 *
 * {{name}} in templates is plain text and never notifies anyone.
 *
 * @see https://developers.facebook.com/docs/pages-api/comments-mentions/
 */

import { logger } from '../utils/logger.js';
import { fetchFacebookCommenterProfile } from './facebookCommentGraph.js';
import { fetchInstagramCommenterUsername } from './instagramCommentGraph.js';

export type SocialCommentPlatform = 'facebook' | 'instagram';

export type PublicCommentMentionIdentity = {
  platform: SocialCommentPlatform;
  commenterId?: string | null;
  commenterName?: string | null;
  commenterUsername?: string | null;
};

const FACEBOOK_COMMENTER_ID_RE = /^\d+$/;
const INSTAGRAM_USERNAME_RE = /^[A-Za-z0-9._]{1,30}$/;
const PLACEHOLDER_COMMENTER_NAMES = new Set(['صديقنا', 'social user']);

export function normalizeFacebookCommenterId(id: string | null | undefined): string | null {
  const value = String(id ?? '').trim();
  return FACEBOOK_COMMENTER_ID_RE.test(value) ? value : null;
}

export function normalizeInstagramUsername(username: string | null | undefined): string | null {
  const value = String(username ?? '')
    .trim()
    .replace(/^@+/, '');
  if (!value || !INSTAGRAM_USERNAME_RE.test(value)) return null;
  if (value.endsWith('.')) return null;
  return value;
}

export function usableFacebookMentionName(name: string | null | undefined): string | null {
  const trimmed = String(name ?? '')
    .replace(/[\r\n\u0000]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!trimmed) return null;
  if (PLACEHOLDER_COMMENTER_NAMES.has(trimmed.toLowerCase())) return null;
  const sanitized = trimmed.replace(/[\]:@]/g, '').trim();
  if (!sanitized) return null;
  return sanitized.slice(0, 80);
}

/**
 * Facebook mention entity. `@[id]` only name-substitutes; `@[id:name]` creates a tag.
 */
export function formatFacebookMentionMarkup(psid: string, displayName?: string | null): string {
  const name = usableFacebookMentionName(displayName);
  return name ? `@[${psid}:${name}]` : `@[${psid}:0]`;
}

export function formatInstagramMentionMarkup(username: string): string {
  return `@${username}`;
}

/** Tag to prepend, or null when identity is insufficient. */
export function publicCommentMentionTag(opts: PublicCommentMentionIdentity): string | null {
  if (opts.platform === 'facebook') {
    const id = normalizeFacebookCommenterId(opts.commenterId);
    if (!id) return null;
    return formatFacebookMentionMarkup(id, opts.commenterName);
  }

  const username = normalizeInstagramUsername(opts.commenterUsername);
  if (!username) return null;
  return formatInstagramMentionMarkup(username);
}

function messageAlreadyHasMention(text: string, opts: PublicCommentMentionIdentity, tag: string): boolean {
  if (opts.platform === 'facebook') {
    const id = normalizeFacebookCommenterId(opts.commenterId);
    if (!id) return false;
    return text.includes(`@[${id}]`) || text.includes(`@[${id}:`);
  }

  const username = normalizeInstagramUsername(opts.commenterUsername);
  if (!username) return text.includes(tag);
  const escaped = username.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|\\s)@${escaped}(?=$|\\s|[^A-Za-z0-9._])`, 'i').test(text);
}

/**
 * Prepend a platform-native mention so the commenter is tagged on public replies.
 * Private DMs must not use this — mention markup is for public comments only.
 */
export function withPublicCommentMention(message: string, opts: PublicCommentMentionIdentity): string {
  const text = (message ?? '').trim();
  if (!text) return text;

  const tag = publicCommentMentionTag(opts);
  if (!tag) return text;
  if (messageAlreadyHasMention(text, opts, tag)) return text;
  return `${tag} ${text}`;
}

export async function resolvePublicCommentMentionIdentity(params: {
  platform: SocialCommentPlatform;
  commentId: string;
  accessToken: string;
  commenterId?: string | null;
  commenterName?: string | null;
  commenterUsername?: string | null;
}): Promise<PublicCommentMentionIdentity> {
  const identity: PublicCommentMentionIdentity = {
    platform: params.platform,
    commenterId: params.commenterId ?? null,
    commenterName: params.commenterName ?? null,
    commenterUsername: params.commenterUsername ?? null,
  };

  const token = String(params.accessToken || '').trim();
  if (!token || !params.commentId) return identity;

  if (params.platform === 'facebook') {
    const hasId = !!normalizeFacebookCommenterId(identity.commenterId);
    const hasName = !!usableFacebookMentionName(identity.commenterName);
    if (hasId && hasName) return identity;

    const profile = await fetchFacebookCommenterProfile(params.commentId, token);
    if (!profile) return identity;
    if (!hasId && profile.fromId) identity.commenterId = profile.fromId;
    if (!hasName && profile.fromName) identity.commenterName = profile.fromName;
    return identity;
  }

  if (normalizeInstagramUsername(identity.commenterUsername)) return identity;

  const username = await fetchInstagramCommenterUsername(params.commentId, token);
  if (username) identity.commenterUsername = username;
  return identity;
}

export function logMissingPublicMention(
  identity: PublicCommentMentionIdentity,
  context: { commentId: string; merchantId?: string }
): void {
  if (publicCommentMentionTag(identity)) return;
  logger.warn('Public comment reply missing mention identity', {
    platform: identity.platform,
    commentId: context.commentId,
    merchantId: context.merchantId || null,
    hasCommenterId: !!normalizeFacebookCommenterId(identity.commenterId),
    hasUsername: !!normalizeInstagramUsername(identity.commenterUsername),
  });
}
