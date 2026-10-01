/**
 * INTERIM — narrow Arabic number-word → integer mapping for cart quantity.
 *
 * WHY: «ساعتين» / «بدي ساعتين» must mean qty=2 on the watch without an LLM
 * "understanding" heuristic. Keep this table tiny and documented; replace when
 * the interpreter owns quantity (PHASE 4). Ambiguous → null (caller asks).
 */
import { normalizeArabic } from '../../catalog/product-search.js';

/** Documented small quantities only (1–10). */
export const ARABIC_QUANTITY_WORD_TO_INT: Readonly<Record<string, number>> = Object.freeze({
  واحد: 1,
  واحدة: 1,
  وحده: 1,
  واحدةه: 1,
  اثنين: 2,
  اثنان: 2,
  ثنين: 2,
  ثنتين: 2,
  زوج: 2,
  ثلاثة: 3,
  ثلاثه: 3,
  ثلاث: 3,
  اربعة: 4,
  اربعه: 4,
  أربع: 4,
  اربع: 4,
  خمسة: 5,
  خمسه: 5,
  خمس: 5,
  ستة: 6,
  سته: 6,
  ست: 6,
  سبعة: 7,
  سبعه: 7,
  سبع: 7,
  ثمانية: 8,
  ثمانيه: 8,
  ثمان: 8,
  تسعة: 9,
  تسعه: 9,
  تسع: 9,
  عشرة: 10,
  عشره: 10,
  عشر: 10,
});

export const ARABIC_QUANTITY_TEST_CASES: ReadonlyArray<{
  phrase: string;
  productName: string;
  quantity: number | null;
  note: string;
}> = Object.freeze([
  { phrase: 'ساعتين', productName: 'ساعة', quantity: 2, note: 'dual on product' },
  { phrase: 'بدي ساعتين', productName: 'ساعة', quantity: 2, note: 'بدي + dual' },
  { phrase: 'ابي ساعتين', productName: 'ساعة', quantity: 2, note: 'gulf dual' },
  { phrase: 'عايز ساعتين', productName: 'ساعة', quantity: 2, note: 'egyptian dual' },
  { phrase: 'اثنين ساعة', productName: 'ساعة', quantity: 2, note: 'number word + name' },
  { phrase: 'بدي الساعة', productName: 'ساعة', quantity: 1, note: 'singular default' },
  { phrase: 'ثلاثة ساعة', productName: 'ساعة', quantity: 3, note: 'ثلاث + singular name' },
  { phrase: 'ثلاث ساعات', productName: 'ساعة', quantity: 3, note: 'ثلاث + plural name' },
]);

function stripLeadingAl(token: string): string {
  return token.replace(/^ال/, '');
}

function tokenize(text: string): string[] {
  return normalizeArabic(text)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 0);
}

function productStem(name: string): string {
  return stripLeadingAl(normalizeArabic(name)).replace(/(ات|ين|ون|ه)$/u, '');
}

/**
 * Dual/plural product token («ساعتين», «قمصان») → quantity, or null if not a dual form.
 */
export function quantityFromProductInflection(
  token: string,
  productName: string
): number | null {
  const t = stripLeadingAl(normalizeArabic(token));
  const stem = productStem(productName);
  if (stem.length < 2) return null;
  if (t === stem || t === `${stem}ه` || t === stem + 'ة') return 1;
  if (t === `${stem}ين` || t === `${stem}ان` || t === `${stem}تين` || t === `${stem}تان`) {
    return 2;
  }
  if (t === `${stem}ات` || t === `${stem}ون`) {
    // Bare plural without a number word — ambiguous (ask).
    return null;
  }
  return null;
}

/**
 * Resolve a concrete quantity from the customer message for a named product.
 * Returns null when the utterance is ambiguous (caller should ask).
 */
export function resolveQuantityFromMessage(
  messageText: string,
  productName: string
): number | null {
  if (!messageText?.trim() || !productName?.trim()) return null;
  const tokens = tokenize(messageText);
  if (tokens.length === 0) return null;

  const stem = productStem(productName);
  const forms = new Set<string>([
    stem,
    `${stem}ه`,
    `${stem}ة`,
    `${stem}ين`,
    `${stem}ان`,
    `${stem}تين`,
    `${stem}تان`,
    `${stem}ات`,
    stripLeadingAl(normalizeArabic(productName)),
  ]);

  // 1) Number word / digit adjacent to a product token (wins over bare singular).
  for (let i = 0; i < tokens.length; i++) {
    const t = stripLeadingAl(tokens[i]);
    if (!forms.has(t) && t !== stem) continue;
    const prev = i > 0 ? stripLeadingAl(tokens[i - 1]) : '';
    const next = i + 1 < tokens.length ? stripLeadingAl(tokens[i + 1]) : '';
    for (const neighbor of [prev, next]) {
      if (!neighbor) continue;
      const mapped =
        ARABIC_QUANTITY_WORD_TO_INT[neighbor] ??
        ARABIC_QUANTITY_WORD_TO_INT[normalizeArabic(neighbor)];
      if (mapped != null) return mapped;
      const asNum = Number(neighbor);
      if (Number.isFinite(asNum) && asNum >= 1 && asNum <= 99) return Math.floor(asNum);
    }
  }

  // 2) Dual inflection on the product token itself («ساعتين»).
  for (const tok of tokens) {
    const t = stripLeadingAl(tok);
    if (!forms.has(t) && t !== stem) continue;
    const fromInfl = quantityFromProductInflection(t, productName);
    if (fromInfl === 2) return 2;
  }

  // 3) Singular product mention with no number → default 1 (not ambiguous).
  if (tokens.some((t) => forms.has(stripLeadingAl(t)))) {
    return 1;
  }

  return null;
}

/**
 * Single quantity owner for the live path — digits / Arabic number words only.
 * The model must not write quantity onto state; callers use this (or interpreter
 * set_quantity) exclusively.
 */
export function resolveQuantity(
  messageText: string,
  productName: string | null | undefined
): number | null {
  if (!productName?.trim()) return null;
  return resolveQuantityFromMessage(messageText, productName);
}
