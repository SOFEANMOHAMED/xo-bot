/**
 * Narrow catalog grounding for the genuine "customer asked for a specific
 * item that is not in this merchant's catalog" turn.
 *
 * Not a general hallucination detector — only price-vs-catalog + honest
 * unavailability phrasing, used when noMatchForSpecificQuery is already true.
 */

import type { Language, Persona } from '../../core/types.js';
import type { ProductOverviewRow } from '../../catalog/product-search.js';
import { getCurrencyDisplayName } from '../../utils/currencyDisplayName.js';
import { getSalesGPTPersonaMeta } from './prompts.js';

const PRICE_PATTERN =
  /\d[\d,.]*\s*(ليرة|دولار|ريال|درهم|جنيه|USD|SAR|AED|EGP|\$)/gi;

const CURRENCY_PREFIX_PATTERN = /(?:\$|USD|SAR|AED|EGP)\s*\d[\d,.]*/gi;

const HONEST_UNAVAILABLE_PHRASES = [
  'غير متوفر',
  'ما عنا',
  'لا نملك',
  'not available',
  "we don't carry",
  "we don't have",
] as const;

const PRICE_MATCH_ABS_TOLERANCE = 1;
const PRICE_MATCH_REL_TOLERANCE = 0.02;

export function isGenuineCatalogNoMatch(
  hadSpecificSearchIntent: boolean,
  searchMatchedQuery: boolean
): boolean {
  return hadSpecificSearchIntent && !searchMatchedQuery;
}

function parsePriceNumber(raw: string): number | null {
  const digits = raw.replace(/[^\d.,]/g, '');
  if (!digits) return null;
  const commaCount = (digits.match(/,/g) || []).length;
  const dotCount = (digits.match(/\./g) || []).length;
  let normalized = digits;
  if (commaCount > 0 && dotCount === 0) {
    normalized = digits.replace(/,/g, '');
  } else if (dotCount > 1 && commaCount === 0) {
    normalized = digits.replace(/\./g, '');
  } else {
    normalized = digits.replace(/,/g, '');
  }
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

function priceMatchesCatalog(value: number, catalogPrices: number[]): boolean {
  return catalogPrices.some((catalogPrice) => {
    const delta = Math.abs(value - catalogPrice);
    if (delta <= PRICE_MATCH_ABS_TOLERANCE) return true;
    return delta / Math.max(Math.abs(catalogPrice), 1) <= PRICE_MATCH_REL_TOLERANCE;
  });
}

function extractPricedAmounts(text: string): number[] {
  const amounts: number[] = [];
  const patterns = [PRICE_PATTERN, CURRENCY_PREFIX_PATTERN];
  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      const value = parsePriceNumber(match[0]);
      if (value !== null) amounts.push(value);
    }
  }
  return amounts;
}

function containsHonestUnavailablePhrase(text: string): boolean {
  const lower = text.toLowerCase();
  return HONEST_UNAVAILABLE_PHRASES.some((phrase) =>
    lower.includes(phrase.toLowerCase())
  );
}

/**
 * True when a no-match turn's reply invents a price that is not in the
 * real catalog and does not admit the item is unavailable.
 */
export function violatesNoMatchGrounding(
  responseText: string,
  catalogOverview: ProductOverviewRow[],
  _language: Language
): boolean {
  if (!responseText || !responseText.trim()) return false;
  if (containsHonestUnavailablePhrase(responseText)) return false;

  const catalogPrices = catalogOverview
    .map((row) => Number(row.price))
    .filter((price) => Number.isFinite(price));

  const mentionedPrices = extractPricedAmounts(responseText);
  if (mentionedPrices.length === 0) return false;

  return mentionedPrices.some((price) => !priceMatchesCatalog(price, catalogPrices));
}

export interface NoMatchFallbackParams {
  language: Language;
  persona?: Persona | null;
  salespersonName: string;
  storeName?: string;
  catalogOverview: ProductOverviewRow[];
}

function uniqueAlternatives(catalogOverview: ProductOverviewRow[]): ProductOverviewRow[] {
  const seen = new Set<string>();
  const rows: ProductOverviewRow[] = [];
  for (const row of catalogOverview) {
    const key = row.id || row.name;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    rows.push(row);
    if (rows.length >= 3) break;
  }
  return rows;
}

function formatAlternativeLine(
  row: ProductOverviewRow,
  language: Language
): string {
  const currency = getCurrencyDisplayName(
    row.currency || 'USD',
    language === 'arabic' ? 'arabic' : 'english'
  );
  const category = row.category ? (language === 'arabic' ? ` (${row.category})` : ` (${row.category})`) : '';
  return language === 'arabic'
    ? `• ${row.name}${category} — ${row.price} ${currency}`
    : `• ${row.name}${category} — ${row.price} ${currency}`;
}

/**
 * Deterministic honest reply when the model invents prices after a genuine no-match.
 * Tone follows the merchant persona; product facts come only from catalogOverview.
 */
export function buildNoMatchFallbackMessage(params: NoMatchFallbackParams): string {
  const { language, persona, salespersonName, storeName, catalogOverview } = params;
  const meta = getSalesGPTPersonaMeta(persona);
  const isArabic = language === 'arabic';
  const alternatives = uniqueAlternatives(catalogOverview);
  const store = storeName?.trim() || (isArabic ? 'المتجر' : 'the store');
  const name = salespersonName.trim() || (isArabic ? `مساعد ${store}` : `${store} assistant`);
  const list = alternatives.map((row) => formatAlternativeLine(row, language)).join('\n');

  const hasAlts = alternatives.length > 0;
  const key = meta.key;

  if (isArabic) {
    const openerByPersona: Record<string, string> = {
      formal: `${name}: معذرة، هذا الصنف غير متوفر لدينا في ${store}.`,
      friendly: `${name}: للأسف ما عنا هالصنف بالمتجر.`,
      sales: `${name}: صراحة هذا الصنف غير متوفر عندنا حالياً.`,
      fast: `${name}: هذا الصنف غير متوفر.`,
      luxury: `${name}: هذا الصنف غير مدرج ضمن مجموعتنا حالياً.`,
    };
    const opener = openerByPersona[key] || openerByPersona.friendly;
    if (!hasAlts) {
      return `${opener} الكتالوج الحالي لا يحتوي بديلاً قريباً لهذا الطلب. كيف يمكنني مساعدتك بشيء آخر؟`;
    }
    const offer =
      key === 'fast'
        ? `المتوفر فعلياً:\n${list}`
        : `إن حابب، الموجود فعلياً عندنا:\n${list}`;
    return `${opener}\n${offer}`;
  }

  const openerByPersonaEn: Record<string, string> = {
    formal: `${name}: I'm sorry — we do not carry that item at ${store}.`,
    friendly: `${name}: Unfortunately we don't have that item.`,
    sales: `${name}: Honestly we don't carry that item right now.`,
    fast: `${name}: That item is not available.`,
    luxury: `${name}: That piece is not part of our current collection.`,
  };
  const opener = openerByPersonaEn[key] || openerByPersonaEn.friendly;
  if (!hasAlts) {
    return `${opener} There isn't a close alternative in the catalog. How else can I help?`;
  }
  const offer =
    key === 'fast'
      ? `What we actually have:\n${list}`
      : `What we actually carry:\n${list}`;
  return `${opener}\n${offer}`;
}

/** Common color words used for false-availability / ungrounded-color checks. */
const COLOR_TERMS = [
  'أحمر', 'احمر', 'أزرق', 'ازرق', 'أخضر', 'اخضر', 'أسود', 'اسود',
  'أبيض', 'ابيض', 'أصفر', 'اصفر', 'بني', 'رمادي', 'وردي', 'ذهبي',
  'فضي', 'بيج', 'كحلي',
  'red', 'blue', 'green', 'black', 'white', 'yellow', 'brown', 'gray',
  'grey', 'pink', 'gold', 'silver', 'beige', 'navy',
] as const;

function normalizeFact(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u064B-\u065F\u0670]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function sourceContainsFact(source: string, fact: string): boolean {
  const normalizedFact = normalizeFact(fact);
  if (!normalizedFact) return false;
  return normalizeFact(source).includes(normalizedFact);
}

function factWindow(source: string, fact: string): string {
  const hay = normalizeFact(source);
  const needle = normalizeFact(fact);
  if (!needle) return '';
  const idx = hay.indexOf(needle);
  if (idx < 0) return '';
  return hay.slice(Math.max(0, idx - 28), idx + needle.length + 36);
}

function extractListedAvailableOptions(response: string): string[] {
  const match = response.match(
    /(?:الألوان المتاحة|الألوان المتوفرة|available colors)\s*[:：]?\s*([^\n]+)/i
  );
  if (!match?.[1]) return [];
  return match[1]
    .split(/[—,\n\/|]+/)
    .map((part) => part.replace(/^\s*\d+\)\s*/, '').trim())
    .filter((part) => part.length >= 2);
}

export type CatalogReplyGroundingInput = {
  responseText: string;
  products: Array<{
    colors?: string[] | null;
    sizes?: string[] | null;
    stock?: number | null;
    description?: string | null;
    price?: number | null;
  }>;
  customerMessage?: string;
  /** Colors already collected in conversation (must be catalog-valid when passed). */
  conversationColors?: Array<string | null | undefined>;
  catalogOverview?: ProductOverviewRow[];
  storeCurrencyLabels?: string[];
  cartLines?: Array<{ quantity: number; unitPrice: number }>;
  policyText?: string;
};

export type CatalogReplyGroundingResult = {
  valid: boolean;
  reasons: string[];
};

function buildAllowedColorSource(input: CatalogReplyGroundingInput): string {
  return [
    ...input.products.flatMap((product) => product.colors || []),
    input.customerMessage || '',
    ...(input.conversationColors || []).filter(
      (color): color is string => Boolean(color && String(color).trim())
    ),
  ].join(' ');
}

/**
 * Strip color words that are not grounded in catalog / customer / conversation.
 * Preserves the rest of the reply (price, currency, tone) instead of full replace.
 */
export function sanitizeUngroundedColorClaims(
  responseText: string,
  input: Omit<CatalogReplyGroundingInput, 'responseText'>
): { text: string; stripped: string[] } {
  const allowed = buildAllowedColorSource({ ...input, responseText });
  const stripped: string[] = [];
  let text = responseText || '';

  for (const color of COLOR_TERMS) {
    if (!sourceContainsFact(text, color)) continue;
    if (sourceContainsFact(allowed, color)) continue;
    stripped.push(color);
    const escaped = color.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Optional Arabic definite article; keep surrounding punctuation tidy.
    const re = new RegExp(`(^|[\\s،,])ال?${escaped}(?=[\\s،,.!?؟]|$)`, 'gi');
    text = text.replace(re, '$1');
  }

  text = text
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s+([.،,!?؟])/g, '$1')
    .replace(/\s+\n/g, '\n')
    .trim();

  return { text, stripped };
}

/**
 * Deterministic checks for harmful catalog claims (color/stock).
 * Used to rewrite replies that deny a real color or offer brand names as colors.
 */
export function validateCatalogReplyGrounding(
  input: CatalogReplyGroundingInput
): CatalogReplyGroundingResult {
  const response = input.responseText || '';
  const reasons = new Set<string>();

  const allowedColorSource = buildAllowedColorSource(input);
  for (const color of COLOR_TERMS) {
    if (
      sourceContainsFact(response, color) &&
      !sourceContainsFact(allowedColorSource, color)
    ) {
      reasons.add('ungrounded_color');
      break;
    }
  }

  if (input.products.length === 0) {
    if (/الألوان المتاحة|الألوان المتوفرة|اختار لونا|أي لون|available colors|which color/i.test(response)) {
      reasons.add('false_color_availability');
    }
  }

  if (input.products.length === 1 && typeof input.products[0].stock === 'number' && input.products[0].stock <= 0) {
    if (/الألوان المتاحة|الألوان المتوفرة|اختار لونا|أي لون|available colors|which color/i.test(response)) {
      reasons.add('false_color_availability');
    }
  }

  const catalogColorSource = input.products.flatMap((product) => product.colors || []).join(' ');
  const unavailableCue = /غير\s*متوفر|نفد|مو موجود|not available|unavailable/i;
  for (const color of COLOR_TERMS) {
    if (!sourceContainsFact(response, color)) continue;
    const inCatalog = sourceContainsFact(catalogColorSource, color);
    const window = factWindow(response, color);
    if (unavailableCue.test(window) && inCatalog) {
      reasons.add('false_color_availability');
      break;
    }
  }

  const listedAvailable = extractListedAvailableOptions(response);
  if (listedAvailable.length > 0 && input.products.length > 0) {
    const sold = input.products.flatMap((product) => product.colors || []);
    const mismatch = listedAvailable.some((option) => {
      if (!option || option.length < 2) return false;
      if (sold.length === 0) return true;
      return !sold.some(
        (color) => sourceContainsFact(color, option) || sourceContainsFact(option, color)
      );
    });
    if (mismatch) reasons.add('false_color_availability');
  }

  return {
    valid: reasons.size === 0,
    reasons: [...reasons],
  };
}
