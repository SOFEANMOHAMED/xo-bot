/**
 * Strip internal model control markers from bot replies before they reach customers.
 * Preserves operational tags used by channel extractors: [ORDER_DATA] and [IMAGE:].
 */

const SHIELD_PREFIX = '\uE000SHIELD:';
const SHIELD_SUFFIX = '\uE001';

/** True if the model asked to escalate to a human agent */
export function detectEscalationMarker(text: string | null | undefined): boolean {
  if (!text) return false;
  return /<\s*ESCALATE\s*>/i.test(text);
}

/**
 * Remove internal tokens that must never appear in customer-facing messages.
 * Does not remove [ORDER_DATA]...[/ORDER_DATA] or [IMAGE: ...] (extracted later).
 */
export function stripInternalControlMarkers(text: string | null | undefined): string {
  if (!text) return '';

  const shields: string[] = [];
  const shield = (match: string): string => {
    const idx = shields.length;
    shields.push(match);
    return `${SHIELD_PREFIX}${idx}${SHIELD_SUFFIX}`;
  };

  let out = text;

  // Protect structured channel tags
  out = out.replace(/\[ORDER_DATA\][\s\S]*?\[\/ORDER_DATA\]/gi, shield);
  out = out.replace(/\[IMAGE:\s*[^\]]+\]/gi, shield);

  // Escalation + SalesGPT turn markers
  out = out.replace(/<\s*ESCALATE\s*>/gi, '');
  out = out.replace(/<\s*END_OF_TURN\s*>/gi, '');
  out = out.replace(/<\s*END_OF_CALL\s*>/gi, '');

  // ReAct leakage (full lines and inline)
  out = out.replace(/^\s*(?:Thought|Action(?:\s*Input)?|Observation)\s*:.*$/gim, '');
  out = out.replace(/\b(?:Thought|Action(?:\s*Input)?|Observation)\s*:\s*[^\n]*/gi, '');

  // Collapse leftover whitespace
  out = out.replace(/[ \t]+\n/g, '\n');
  out = out.replace(/\n{3,}/g, '\n\n');
  out = out.replace(/[ \t]{2,}/g, ' ');
  out = out.trim();

  out = out.replace(
    new RegExp(`${SHIELD_PREFIX}(\\d+)${SHIELD_SUFFIX}`, 'g'),
    (_, i: string) => shields[Number(i)] ?? ''
  );

  return out;
}

export interface PreparedBotReply {
  /** Text safe for customer channels (ORDER_DATA / IMAGE tags still present if any) */
  text: string;
  /** Whether this turn should hand the conversation to a human */
  shouldEscalate: boolean;
}

/**
 * Detect escalation signals then strip internal markers.
 * Escalation can come from <ESCALATE> in text or structured next_action.
 */
export function prepareBotReplyForCustomer(
  text: string | null | undefined,
  options?: { nextAction?: string | null }
): PreparedBotReply {
  const raw = text || '';
  const next = (options?.nextAction || '').trim().toLowerCase();
  const shouldEscalate =
    detectEscalationMarker(raw) || next === 'handoff' || next === 'escalate';

  return {
    text: stripInternalControlMarkers(raw),
    shouldEscalate,
  };
}
