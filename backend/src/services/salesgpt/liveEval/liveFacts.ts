/**
 * Deterministic reply-fact checks against catalog + cart (no exact-text asserts).
 */
import type { CartItem, Product } from '../../../core/types.js';

const COLOR_WORDS = [
  'أسود', 'اسود', 'أحمر', 'احمر', 'أبيض', 'ابيض', 'أزرق', 'ازرق',
  'أخضر', 'اخضر', 'بني', 'رمادي', 'ذهبي', 'red', 'black', 'white', 'blue', 'green',
];

export type FactFailure = { code: string; message: string };

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u064B-\u065F\u0670]/g, '')
    .replace(/[إأآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي');
}

function extractNumbers(text: string): number[] {
  const out: number[] = [];
  const re = /\d[\d,]*(?:\.\d+)?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const n = Number(m[0].replace(/,/g, ''));
    if (Number.isFinite(n)) out.push(n);
  }
  return out;
}

export function checkReplyFacts(input: {
  userMessage: string;
  replyText: string;
  catalog: Product[];
  cart: CartItem[];
  expectPriceForProductId?: string | null;
  expectOosProductId?: string | null;
}): FactFailure[] {
  const failures: FactFailure[] = [];
  const text = input.replyText || '';
  const norm = normalize(text);

  if (/!\[|\]\([^)]*\)/.test(text) && /image|img|png|jpg/i.test(text)) {
    failures.push({ code: 'markdown_image', message: 'markdown image placeholder in reply' });
  }

  const allowedPrices = new Set<number>();
  for (const p of input.catalog) {
    if (typeof p.price === 'number') allowedPrices.add(p.price);
  }
  for (const line of input.cart) {
    if (typeof line.unitPrice === 'number') allowedPrices.add(line.unitPrice);
    allowedPrices.add(line.unitPrice * (line.quantity || 1));
  }
  // Strip IMAGE payloads so CDN query timestamps are not treated as prices.
  const textForNumbers = text.replace(/\[IMAGE:[^\]]*\]/gi, ' ');
  // Allow small integers used as option indices / quantities.
  const mentioned = extractNumbers(textForNumbers).filter((n) => n >= 10);
  for (const n of mentioned) {
    const ok = [...allowedPrices].some((p) => Math.abs(p - n) <= 1 || Math.abs(p * 2 - n) <= 1);
    // Stock counts and years occasionally appear — tolerate catalog stock values.
    const stockOk = input.catalog.some((p) => p.stock === n);
    if (!ok && !stockOk && n !== 15) {
      // Soft: only flag round currency-looking amounts that match no catalog price.
      if (n >= 40) {
        failures.push({
          code: 'ungrounded_number',
          message: `number ${n} not in catalog/cart prices`,
        });
      }
    }
  }

  for (const color of COLOR_WORDS) {
    if (!norm.includes(normalize(color))) continue;
    const inCatalog = input.catalog.some((p) =>
      (p.colors || []).some((c) => normalize(c).includes(normalize(color)))
    );
    const inCart = input.cart.some((l) => l.color && normalize(l.color).includes(normalize(color)));
    const inUser = normalize(input.userMessage).includes(normalize(color));
    if (!inCatalog && !inCart && !inUser) {
      failures.push({
        code: 'ungrounded_color',
        message: `color «${color}» not in catalog/cart/user message`,
      });
    }
  }

  if (input.expectPriceForProductId) {
    const product = input.catalog.find((p) => p.id === input.expectPriceForProductId);
    if (product && !String(text).includes(String(product.price))) {
      failures.push({
        code: 'missing_price',
        message: `price question reply missing product price ${product.price}`,
      });
    }
  }

  if (input.expectOosProductId) {
    const product = input.catalog.find((p) => p.id === input.expectOosProductId);
    if (product && product.stock <= 0) {
      if (!/غير متوفر|نفد|مو موجود|out of stock|unavailable/i.test(text)) {
        failures.push({
          code: 'oos_not_marked',
          message: `OOS product ${product.name} not marked unavailable`,
        });
      }
    }
  }

  // False apology: claiming a real catalog color is unavailable for an in-stock colored product.
  for (const product of input.catalog) {
    if (!product.colors?.length || product.stock <= 0) continue;
    for (const color of product.colors) {
      const window = new RegExp(
        `${color}.{0,24}غير متوفر|غير متوفر.{0,24}${color}`,
        'i'
      );
      if (window.test(text)) {
        failures.push({
          code: 'false_color_unavailable',
          message: `falsely claims ${color} unavailable for ${product.name}`,
        });
      }
    }
  }

  return failures;
}

/** Mask API-looking secrets in transcripts. */
export function maskTranscript(text: string): string {
  return text
    .replace(/sk-[A-Za-z0-9_-]{10,}/g, 'sk-***')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer ***')
    .replace(/OPENAI_API_KEY\s*=\s*\S+/gi, 'OPENAI_API_KEY=***');
}
