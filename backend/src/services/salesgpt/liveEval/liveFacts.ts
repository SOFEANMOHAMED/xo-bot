/**
 * Deterministic reply-fact checks against catalog + cart (no exact-text asserts).
 * Numbers must appear on an explicit allowlist — IMAGE/URL digits never count.
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

/** Strip IMAGE payloads and bare URLs/query strings before scanning digits. */
export function stripNonFactNumberSources(text: string): string {
  return text
    .replace(/\[IMAGE:[^\]]*\]/gi, ' ')
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/\b[\w.-]+\.(?:com|net|org|test|io)\/\S*/gi, ' ')
    .replace(/[?&][a-z_][a-z0-9_]*=\d+/gi, ' ');
}

export function extractNumbers(text: string): number[] {
  const out: number[] = [];
  const re = /\d[\d,]*(?:\.\d+)?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const n = Number(m[0].replace(/,/g, ''));
    if (Number.isFinite(n)) out.push(n);
  }
  return out;
}

/**
 * Allowlist: catalog/cart prices & stock, focused product sizes/options,
 * quantities, per-currency cart totals, order-looking ids, digits the customer typed.
 */
export function buildNumberAllowlist(input: {
  catalog: Product[];
  cart: CartItem[];
  focusProductId?: string | null;
  customerTexts: string[];
  orderNumbers?: Array<string | number | null | undefined>;
}): Set<number> {
  const allowed = new Set<number>();

  const add = (n: number | null | undefined): void => {
    if (typeof n === 'number' && Number.isFinite(n)) allowed.add(n);
  };

  for (const p of input.catalog) {
    add(p.price);
    add(p.stock);
    for (const size of p.sizes || []) {
      for (const n of extractNumbers(String(size))) add(n);
    }
  }

  const focus = input.focusProductId
    ? input.catalog.find((p) => p.id === input.focusProductId)
    : null;
  if (focus) {
    add(focus.price);
    add(focus.stock);
    for (const size of focus.sizes || []) {
      for (const n of extractNumbers(String(size))) add(n);
    }
  }

  const totalsByCurrency = new Map<string, number>();
  for (const line of input.cart) {
    add(line.unitPrice);
    add(line.quantity);
    const lineTotal = line.unitPrice * (line.quantity || 1);
    add(lineTotal);
    if (line.size) {
      for (const n of extractNumbers(String(line.size))) add(n);
    }
    const prev = totalsByCurrency.get(line.currency) || 0;
    totalsByCurrency.set(line.currency, prev + lineTotal);
  }
  for (const total of totalsByCurrency.values()) add(total);

  for (const raw of input.orderNumbers || []) {
    if (raw == null) continue;
    for (const n of extractNumbers(String(raw))) add(n);
  }

  // Digits the customer typed (phone, address numbers, quantities in message).
  for (const text of input.customerTexts) {
    for (const n of extractNumbers(text || '')) add(n);
  }

  // Option indices 1..9 often appear in templates.
  for (let i = 1; i <= 9; i++) add(i);

  return allowed;
}

export function checkReplyFacts(input: {
  userMessage: string;
  replyText: string;
  catalog: Product[];
  cart: CartItem[];
  focusProductId?: string | null;
  /** Prior + current customer utterances (digits they typed are allowed). */
  customerTexts?: string[];
  orderNumbers?: Array<string | number | null | undefined>;
  expectPriceForProductId?: string | null;
  expectOosProductId?: string | null;
}): FactFailure[] {
  const failures: FactFailure[] = [];
  const text = input.replyText || '';
  const norm = normalize(text);

  if (/!\[|\]\([^)]*\)/.test(text) && /image|img|png|jpg/i.test(text)) {
    failures.push({ code: 'markdown_image', message: 'markdown image placeholder in reply' });
  }

  const customerTexts = input.customerTexts?.length
    ? input.customerTexts
    : [input.userMessage];
  const allowlist = buildNumberAllowlist({
    catalog: input.catalog,
    cart: input.cart,
    focusProductId: input.focusProductId,
    customerTexts,
    orderNumbers: input.orderNumbers,
  });

  const textForNumbers = stripNonFactNumberSources(text);
  for (const n of extractNumbers(textForNumbers)) {
    if (allowlist.has(n)) continue;
    // Tolerate near-price rounding (±1) against allowlisted prices only.
    const nearPrice = [...allowlist].some(
      (allowed) => allowed >= 10 && Math.abs(allowed - n) <= 1
    );
    if (nearPrice) continue;
    failures.push({
      code: 'ungrounded_number',
      message: `number ${n} not in allowlist (catalog/cart/focus options/customer digits)`,
    });
  }

  for (const color of COLOR_WORDS) {
    if (!norm.includes(normalize(color))) continue;
    const inCatalog = input.catalog.some((p) =>
      (p.colors || []).some((c) => normalize(c).includes(normalize(color)))
    );
    const inCart = input.cart.some((l) => l.color && normalize(l.color).includes(normalize(color)));
    const inUser = customerTexts.some((t) => normalize(t).includes(normalize(color)));
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
