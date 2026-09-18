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
