/**
 * Order color policy — deterministic, catalog-bound color resolution for SalesGPT.
 *
 * The LLM may hallucinate colors (e.g. "ازرق" when the customer chose "أسود").
 * User message history + product.colors are the source of truth; AI extractions are
 * advisory only and never override a corroborated customer choice.
 */

import {
  extractColorFromText,
  formatColorOptionsForDisplay,
  matchColorOption,
  colorsMatch
} from '../../catalog/color-options.js';

export function isColorInProductCatalog(
  color: string | null | undefined,
  catalogColors: string[] | null | undefined
): boolean {
  if (!color?.trim() || !catalogColors?.length) return false;
  return matchColorOption(color, catalogColors).matched !== null;
}

/**
 * Map numeric replies ("2", "رقم 2", "الخيار 2") to a catalog color option.
 */
export function extractNumericColorChoice(
  text: string,
  catalogColors: string[]
): string | null {
  if (!text?.trim() || !catalogColors.length) return null;
  const t = text.trim();

  const pure = t.match(/^(\d{1,2})$/);
  if (pure) {
    const idx = parseInt(pure[1], 10) - 1;
    if (idx >= 0 && idx < catalogColors.length) return catalogColors[idx];
  }

  const labeled = t.match(
    /(?:رقم|الخيار|اللون|option|number|#|no\.?)\s*(\d{1,2})\s*[).]?$/i
  );
  if (labeled) {
    const idx = parseInt(labeled[1], 10) - 1;
    if (idx >= 0 && idx < catalogColors.length) return catalogColors[idx];
  }

  return null;
}

/** Extract a catalog-bound color from a single user message (text or number). */
export function extractColorFromUserText(
  text: string,
  catalogColors: string[]
): string | null {
  if (!text?.trim() || !catalogColors.length) return null;

  const numeric = extractNumericColorChoice(text, catalogColors);
  if (numeric) return numeric;

  const fromText = extractColorFromText(text, catalogColors);
  if (!fromText) return null;

  const match = matchColorOption(fromText, catalogColors);
  return match.matched;
}

/**
 * Walk user messages newest-first; return the latest explicit catalog color mention.
 */
export function extractLastColorFromUserHistory(
  userMessages: string[],
  catalogColors: string[]
): string | null {
  if (!catalogColors.length) return null;
  for (let i = userMessages.length - 1; i >= 0; i--) {
    const found = extractColorFromUserText(userMessages[i], catalogColors);
    if (found) return found;
  }
  return null;
}

export interface ResolveOrderColorInput {
  catalogColors: string[] | null | undefined;
  currentMessage: string;
  /** User messages in chronological order (including current). */
  userMessages: string[];
  storedColor?: string | null;
  aiColor?: string | null;
}

export interface ResolveOrderColorResult {
  /** Matched catalog option label, or null when unknown / not in catalog. */
  color: string | null;
  needsClarification: boolean;
  ambiguous: string[];
  /** AI suggested a color that is not in this product's catalog. */
  rejectedAiColor?: string | null;
}

/**
 * Resolve the order color strictly against product.colors.
 *
 * Priority:
 * 1. Explicit choice in the current user message
 * 2. Latest explicit color in user message history (source of truth)
 * 3. Previously stored color if still valid in catalog
 * 4. AI extraction only when it matches catalog AND is corroborated in user messages
 */
export function resolveOrderColor(input: ResolveOrderColorInput): ResolveOrderColorResult {
  const { catalogColors, currentMessage, userMessages, storedColor, aiColor } = input;

  if (!catalogColors?.length) {
    return {
      color: storedColor || aiColor || null,
      needsClarification: false,
      ambiguous: []
    };
  }

  const rejectAi =
    aiColor?.trim() && !isColorInProductCatalog(aiColor, catalogColors)
      ? aiColor
      : null;

  // 1) Current message
  const rawCurrent = extractColorFromText(currentMessage, catalogColors)
    ?? extractNumericColorChoice(currentMessage, catalogColors);
  if (rawCurrent) {
    const currentMatch = matchColorOption(rawCurrent, catalogColors);
    if (currentMatch.matched) {
      return { color: currentMatch.matched, needsClarification: false, ambiguous: [] };
    }
    if (currentMatch.ambiguous.length > 1) {
      return {
        color: null,
        needsClarification: true,
        ambiguous: currentMatch.ambiguous,
        rejectedAiColor: rejectAi
      };
    }
    // Mentioned a color not sold for this product
    if (extractColorFromText(currentMessage, catalogColors) || extractNumericColorChoice(currentMessage, catalogColors)) {
      return {
        color: null,
        needsClarification: false,
        ambiguous: [],
        rejectedAiColor: rejectAi ?? rawCurrent
      };
    }
  }

  // 2) User history (newest explicit mention wins)
  const fromHistory = extractLastColorFromUserHistory(userMessages, catalogColors);
  if (fromHistory) {
    return { color: fromHistory, needsClarification: false, ambiguous: [], rejectedAiColor: rejectAi };
  }

  // 3) Stored state — only if valid catalog option
  if (storedColor && isColorInProductCatalog(storedColor, catalogColors)) {
    const storedMatch = matchColorOption(storedColor, catalogColors);
    if (storedMatch.matched) {
      return { color: storedMatch.matched, needsClarification: false, ambiguous: [], rejectedAiColor: rejectAi };
    }
  }

  // 4) AI — catalog match + corroborated in user text
  if (aiColor && isColorInProductCatalog(aiColor, catalogColors)) {
    const aiMatch = matchColorOption(aiColor, catalogColors);
    if (aiMatch.matched) {
      const corroborated = userMessages.some((msg) => {
        const extracted = extractColorFromUserText(msg, catalogColors);
        return extracted && colorsMatch(extracted, aiMatch.matched!);
      });
      if (corroborated) {
        return { color: aiMatch.matched, needsClarification: false, ambiguous: [], rejectedAiColor: rejectAi };
      }
    }
  }

  return {
    color: null,
    needsClarification: false,
    ambiguous: [],
    rejectedAiColor: rejectAi
  };
}

export function buildUnavailableColorMessage(
  language: 'arabic' | 'english',
  catalogColors: string[],
  rejectedColor?: string | null
): string {
  const options = formatColorOptionsForDisplay(catalogColors, language);
  if (language === 'arabic') {
    const rejected = rejectedColor?.trim()
      ? `\n(«${rejectedColor}» غير متوفر لهذا المنتج.)`
      : '';
    return `هذا اللون غير متوفر لهذا المنتج 🎨${rejected}\n\nالألوان المتاحة:\n${options}\n\nاختار لوناً من القائمة من فضلك.`;
  }
  const rejected = rejectedColor?.trim()
    ? `\n("${rejectedColor}" is not available for this product.)`
    : '';
  return `That color isn't available for this product 🎨${rejected}\n\nAvailable colors:\n${options}\n\nPlease choose from the list.`;
}

export function buildAskColorMessage(
  language: 'arabic' | 'english',
  catalogColors: string[]
): string {
  const options = formatColorOptionsForDisplay(catalogColors, language);
  return language === 'arabic'
    ? `أي لون بتحب؟ 🎨\n${options}`
    : `Which color would you like? 🎨\n${options}`;
}
