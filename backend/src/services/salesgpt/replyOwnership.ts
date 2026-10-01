/**
 * Shadow logging for outbound reply ownership (Phase 0).
 * Does not change reply text — only records who last wrote it.
 */
import { logger } from '../../utils/logger.js';

export type ReplyOwnershipPhase =
  | 'early_rail'
  | 'agent_draft'
  | 'order_policy'
  | 'post_photo'
  | 'post_ground'
  | 'post_color'
  | 'post_confirm_gate'
  | 'post_cart'
  | 'post_await'
  | 'post_variant_ask'
  | 'compose'
  | 'final';

export type ReplyOwnershipEvent = {
  phase: ReplyOwnershipPhase;
  reason: string;
  nextAction?: string;
  replyFingerprint: string;
};

function fingerprint(text: string): string {
  const t = (text || '').trim().replace(/\s+/g, ' ');
  if (t.length <= 80) return t;
  return `${t.slice(0, 40)}…${t.slice(-20)}`;
}

/** Log a reply-ownership assignment (shadow — no behavior change). */
export function logReplyOwnership(event: {
  phase: ReplyOwnershipPhase;
  reason: string;
  nextAction?: string;
  replyText: string;
}): ReplyOwnershipEvent {
  const recorded: ReplyOwnershipEvent = {
    phase: event.phase,
    reason: event.reason,
    nextAction: event.nextAction,
    replyFingerprint: fingerprint(event.replyText),
  };
  logger.debug('SalesGPT: replyOwnership', recorded);
  return recorded;
}
