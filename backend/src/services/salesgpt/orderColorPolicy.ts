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
    colorsMatch,
    normalizeColorToken,
  } from '../../catalog/color-options.js';
import { isPastBotClaimDispute } from './pastBotClaimDispute.js';
import { buildAskVariantMessage, buildUnavailableVariantMessage } from './variantEngine/ask.js';
import { colorAxisFromValues } from './variantEngine/axes.js';
import {
    extractBareCatalogAnswer,
    extractNumericAxisChoice,
    stripSelectionPadding,
    tokenizeVariantText,
  } from './variantEngine/match.js';

  export function isColorInProductCatalog(
    color: string | null | undefined,
    catalogColors: string[] | null | undefined
  ): boolean {
    if (!color?.trim() || !catalogColors?.length) return false;
    return matchColorOption(color, catalogColors).matched !== null;
  }

  /**
   * Map numeric replies ("2", "رقم 2", "الخيار 2") to a catalog color option.
   * Wrapper over variant-engine numeric extract.
   */
  export function extractNumericColorChoice(
    text: string,
    catalogColors: string[]
  ): string | null {
    const axis = colorAxisFromValues(catalogColors);
    if (!axis) return null;
    return extractNumericAxisChoice(text, axis);
  }

  function stripLeadingAlToken(value: string): string {
    return value.replace(/^ال/, '');
  }

  function catalogColorMentionIndex(messageText: string, option: string): number {
    const hay = stripLeadingAlToken(normalizeColorToken(messageText)).replace(
      /(^|\s)ال(?=\S)/g,
      '$1'
    );
    const needle = stripLeadingAlToken(normalizeColorToken(option));
    if (!needle || needle.length < 2) return -1;
    return hay.indexOf(needle);
  }

  /** True when the catalog option sits under a local negation (ما بدي / مو / مش …). */
  export function isCatalogColorNegated(messageText: string, option: string): boolean {
    const hay = stripLeadingAlToken(normalizeColorToken(messageText)).replace(
      /(^|\s)ال(?=\S)/g,
      '$1'
    );
    const needle = stripLeadingAlToken(normalizeColorToken(option));
    const idx = hay.indexOf(needle);
    if (idx < 0) return false;
    const before = hay.slice(0, idx).trim();
    return /(?:ما\s*بدي|ما\s*ابي|ما\s*ابغى|ما\s*عاوز|بلاش|بدون|مو|مش|لا\s*بدي|لا\s*اريد|لا\s*أريد)\s*(?:ال)?$/i.test(
      before
    );
  }

  /**
   * Color the customer WANTS, resolved only against this product's real catalog colors.
   * Negated mentions lose; the last remaining positive mention wins.
   */
  export function resolveWantedCatalogColor(
    messageText: string,
    catalogColors: string[] | null | undefined
  ): string | null {
    if (!messageText?.trim() || !catalogColors?.length) return null;
    const mentioned: Array<{ color: string; index: number }> = [];
    for (const option of catalogColors) {
      if (typeof option !== 'string' || !option.trim()) continue;
      const index = catalogColorMentionIndex(messageText, option);
      if (index >= 0 || colorsMatch(messageText, option)) {
        mentioned.push({
          color: option,
          index: index >= 0 ? index : Number.MAX_SAFE_INTEGER,
        });
      }
    }
    if (mentioned.length === 0) {
      const extracted = extractColorFromText(messageText, catalogColors);
      if (!extracted || !isColorInProductCatalog(extracted, catalogColors)) return null;
      if (isCatalogColorNegated(messageText, extracted)) return null;
      return extracted;
    }
    mentioned.sort((a, b) => a.index - b.index);
    const positive = mentioned.filter((row) => !isCatalogColorNegated(messageText, row.color));
    if (positive.length === 0) return null;
    return positive[positive.length - 1].color;
  }

  /** A color word was said that this product does not sell. */
  export function mentionedColorOutsideCatalog(
    messageText: string,
    catalogColors: string[] | null | undefined
  ): string | null {
    if (!messageText?.trim() || !catalogColors?.length) return null;
    if (resolveWantedCatalogColor(messageText, catalogColors)) return null;
    const any = extractColorFromText(messageText);
    if (!any) return null;
    if (isColorInProductCatalog(any, catalogColors)) return null;
    if (isCatalogColorNegated(messageText, any)) return null;
    return any;
  }

  /** Extract a catalog-bound color from a single user message (text or number).
   * Prefer strict bare extract (engine). Wider scan is for **history corroboration
   * and negation reading only** — the live current-message path uses
   * `extractBareCatalogAnswer` via `resolveOrderColor`, not this function.
   */
  export function extractColorFromUserText(
    text: string,
    catalogColors: string[]
  ): string | null {
    if (!text?.trim() || !catalogColors.length) return null;
    // «أنت قلت في أسود» is a dispute, not a color selection.
    if (isPastBotClaimDispute(text)) return null;

    const axis = colorAxisFromValues(catalogColors);
    if (axis) {
      const bare = extractBareCatalogAnswer(text, axis);
      if (bare) return bare;
    }

    const numeric = extractNumericColorChoice(text, catalogColors);
    if (numeric) return numeric;

    const wanted = resolveWantedCatalogColor(text, catalogColors);
    if (wanted) return wanted;

    const fromText = extractColorFromText(text, catalogColors);
    if (!fromText) return null;
    if (isCatalogColorNegated(text, fromText)) return null;

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
  
    // 1) Current message — V5 bare catalog answer only (P1-2: «الأسود غالي؟» is not a pick)
    const colorAxis = colorAxisFromValues(catalogColors);
    if (colorAxis && !isPastBotClaimDispute(currentMessage)) {
      const currentBare = extractBareCatalogAnswer(currentMessage, colorAxis);
      if (currentBare) {
        return { color: currentBare, needsClarification: false, ambiguous: [] };
      }
      const padded = stripSelectionPadding(currentMessage, colorAxis);
      const tokens = tokenizeVariantText(padded);
      if (tokens.length > 0 && tokens.length <= 3) {
        const currentMatch = matchColorOption(padded, catalogColors);
        if (currentMatch.ambiguous.length > 1) {
          return {
            color: null,
            needsClarification: true,
            ambiguous: currentMatch.ambiguous,
            rejectedAiColor: rejectAi
          };
        }
      }
    }
  
    // 2) Prior user messages only — current already handled by the strict branch
    const priorMessages =
      userMessages.length > 0 &&
      userMessages[userMessages.length - 1] === currentMessage
        ? userMessages.slice(0, -1)
        : userMessages;
    const fromHistory = extractLastColorFromUserHistory(priorMessages, catalogColors);
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
    const axis = colorAxisFromValues(catalogColors);
    if (axis) {
      return buildUnavailableVariantMessage(language, axis, rejectedColor);
    }
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
    const axis = colorAxisFromValues(catalogColors);
    if (!axis) {
      return language === 'english'
        ? 'Which color would you like?'
        : 'أي لون بتحب؟';
    }
    return buildAskVariantMessage(language, axis);
  }
  