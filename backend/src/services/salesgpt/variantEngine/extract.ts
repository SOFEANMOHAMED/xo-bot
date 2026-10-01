import { isPastBotClaimDispute } from '../pastBotClaimDispute.js';
import {
  isAvailabilityQuestion,
  looksLikeShowOrPhotoAsk,
} from '../pendingBotQuestion.js';
import { extractBareCatalogAnswer } from './match.js';
import type { VariantAxis } from './types.js';

/**
 * Bare catalog answer for one axis. Whole remainder must be one option or index.
 * Longer sentences that merely contain a value → null (closes P1-2 on this path).
 */
export function extractBareVariantAnswer(
  message: string,
  axis: VariantAxis
): string | null {
  if (!message?.trim() || !axis.values.length) return null;
  if (looksLikeShowOrPhotoAsk(message) || isAvailabilityQuestion(message)) {
    return null;
  }
  if (isPastBotClaimDispute(message)) return null;
  return extractBareCatalogAnswer(message, axis);
}
