/**
 * Color options: each entry in product.colors is ONE sellable option.
 * An option may be a single color ("أسود") or a compound ("أسود وبني").
 * Never split an option into separate sellable colors.
 */

const COLOR_CANONICAL: Array<{ canonical: string; aliases: string[] }> = [
  { canonical: 'احمر', aliases: ['احمر', 'أحمر', 'حمرا', 'حمراء', 'حمره', 'red', 'maroon', 'burgundy'] },
  { canonical: 'ازرق', aliases: ['ازرق', 'أزرق', 'زرقا', 'زرقاء', 'زرقه', 'blue'] },
  { canonical: 'كحلي', aliases: ['كحلي', 'كحليه', 'navy'] },
  { canonical: 'اخضر', aliases: ['اخضر', 'أخضر', 'خضرا', 'خضراء', 'خضره', 'green', 'olive'] },
  { canonical: 'اصفر', aliases: ['اصفر', 'أصفر', 'صفرا', 'صفراء', 'صفره', 'yellow', 'gold', 'ذهبي', 'ذهبيه'] },
  { canonical: 'اسود', aliases: ['اسود', 'أسود', 'سودا', 'سوداء', 'سوده', 'black'] },
  { canonical: 'ابيض', aliases: ['ابيض', 'أبيض', 'بيضا', 'بيضاء', 'بيضه', 'white', 'offwhite', 'ivory'] },
  { canonical: 'بني', aliases: ['بني', 'بنيه', 'brown', 'beige', 'بيج', 'بيجه'] },
  { canonical: 'رمادي', aliases: ['رمادي', 'رماديه', 'gray', 'grey', 'silver', 'فضي', 'فضيه'] },
  { canonical: 'برتقالي', aliases: ['برتقالي', 'برتقاليه', 'orange'] },
  { canonical: 'وردي', aliases: ['وردي', 'ورديه', 'زهري', 'زهريه', 'روز', 'pink', 'rose'] },
  { canonical: 'بنفسجي', aliases: ['بنفسجي', 'بنفسجيه', 'موف', 'purple', 'violet', 'lilac'] }
];

/** Separators that may join colors inside one sellable option */
const COMPOUND_SPLIT_RE = /\s*(?:[/\\|+]|\u060c|،|,|و|and|&)\s*/i;

export function normalizeColorToken(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[\u064B-\u0652]/g, '')
    .replace(/[إأآا]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Strip Arabic definite article ال for matching (الأسود / والبني → اسود / بني) */
function stripArabicArticle(token: string): string {
  return token.replace(/(^|[\sو])ال(?=\S)/g, '$1');
}

function aliasToCanonical(token: string): string | null {
  const n = normalizeColorToken(token);
  if (!n) return null;
  for (const entry of COLOR_CANONICAL) {
    for (const alias of entry.aliases) {
      const a = normalizeColorToken(alias);
      if (n === a) return entry.canonical;
    }
  }
  return null;
}

function isColorBoundary(ch: string | undefined): boolean {
  if (ch === undefined) return true;
  return /[\s/\\|+,و&-]/.test(ch);
}

/**
 * Extract all known atomic colors from a string (order preserved, unique).
 * Used for compound options like "أسود وبني".
 */
export function extractAtomicColors(input: string | null | undefined): string[] {
  if (!input?.trim()) return [];
  // Strip ال so "الأسود والبني" matches aliases اسود / بني
  const n = stripArabicArticle(normalizeColorToken(input));
  const found: string[] = [];
  const seen = new Set<string>();

  type Hit = { start: number; end: number; canonical: string; len: number };
  const hits: Hit[] = [];

  for (const entry of COLOR_CANONICAL) {
    for (const alias of entry.aliases) {
      const a = normalizeColorToken(alias);
      if (!a) continue;
      let idx = 0;
      while (idx < n.length) {
        const pos = n.indexOf(a, idx);
        if (pos < 0) break;
        const beforeOk = isColorBoundary(n[pos - 1]);
        const afterOk = isColorBoundary(n[pos + a.length]);
        if (beforeOk && afterOk) {
          hits.push({
            start: pos,
            end: pos + a.length,
            canonical: entry.canonical,
            len: a.length
          });
        }
        idx = pos + 1;
      }
    }
  }

  // Non-overlapping: earliest start, then longest alias
  hits.sort((a, b) => a.start - b.start || b.len - a.len);
  let cursor = 0;
  for (const h of hits) {
    if (h.start < cursor) continue;
    if (!seen.has(h.canonical)) {
      seen.add(h.canonical);
      found.push(h.canonical);
    }
    cursor = h.end;
  }

  // Fallback for "Black/Brown" style tokens
  if (found.length === 0) {
    for (const part of input.split(COMPOUND_SPLIT_RE)) {
      const c = aliasToCanonical(part);
      if (c && !seen.has(c)) {
        seen.add(c);
        found.push(c);
      }
    }
  }

  return found;
}

export function isCompoundColorOption(input: string | null | undefined): boolean {
  return extractAtomicColors(input).length >= 2;
}

/**
 * Canonical form of a color option.
 * Single: "اسود". Compound: "اسود+بني" (sorted for stable equality).
 * Unknown custom labels keep normalized full string.
 */
export function canonicalizeColor(input: string | null | undefined): string | null {
  if (!input?.trim()) return null;
  const atoms = extractAtomicColors(input);
  if (atoms.length >= 2) {
    return [...atoms].sort().join('+');
  }
  if (atoms.length === 1) {
    // Only collapse to atomic if the whole option is essentially that color
    const n = normalizeColorToken(input);
    const only = atoms[0];
    // If leftover noise is just separators/spaces, treat as single
    const stripped = n
      .replace(new RegExp(only, 'g'), '')
      .replace(/[\s/\\|+,و&-]+/g, '');
    if (!stripped || stripped.length <= 2) return only;
  }
  const exact = aliasToCanonical(input);
  if (exact) return exact;
  return normalizeColorToken(input);
}

function setsEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sb = new Set(b);
  return a.every((x) => sb.has(x));
}

function isSubset(sub: string[], full: string[]): boolean {
  const sf = new Set(full);
  return sub.length > 0 && sub.every((x) => sf.has(x));
}

/**
 * Fuzzy match between requested color and a catalog color option.
 * Compound options match as wholes (same atom set) or when request ⊆ option.
 */
export function colorsMatch(requested: string, candidate: string): boolean {
  if (!requested?.trim() || !candidate?.trim()) return false;

  const an = normalizeColorToken(requested);
  const bn = normalizeColorToken(candidate);
  if (an === bn) return true;

  const aCanon = canonicalizeColor(requested);
  const bCanon = canonicalizeColor(candidate);
  if (aCanon && bCanon && aCanon === bCanon) return true;

  const aAtoms = extractAtomicColors(requested);
  const bAtoms = extractAtomicColors(candidate);

  if (aAtoms.length > 0 && bAtoms.length > 0) {
    if (setsEqual(aAtoms, bAtoms)) return true;
    // User said one color that appears inside a compound option
    if (isSubset(aAtoms, bAtoms)) return true;
    if (isSubset(bAtoms, aAtoms)) return true;
  }

  return an.includes(bn) || bn.includes(an);
}

export interface ColorOptionMatch {
  /** Matched catalog option label (original string from product.colors) */
  matched: string | null;
  /** When multiple options partially match — ask the customer to clarify */
  ambiguous: string[];
}

/**
 * Resolve a user color mention against product color options.
 * Prefers exact / full-compound matches; partial hits become ambiguous if >1.
 */
export function matchColorOption(
  requested: string | null | undefined,
  options: string[] | null | undefined
): ColorOptionMatch {
  if (!requested?.trim() || !options?.length) {
    return { matched: null, ambiguous: [] };
  }

  // 1) Exact / full canonical match
  for (const opt of options) {
    const an = normalizeColorToken(requested);
    const bn = normalizeColorToken(opt);
    if (an === bn) return { matched: opt, ambiguous: [] };
    const ac = canonicalizeColor(requested);
    const bc = canonicalizeColor(opt);
    if (ac && bc && ac === bc) return { matched: opt, ambiguous: [] };
    const aAtoms = extractAtomicColors(requested);
    const bAtoms = extractAtomicColors(opt);
    if (aAtoms.length >= 2 && bAtoms.length >= 2 && setsEqual(aAtoms, bAtoms)) {
      return { matched: opt, ambiguous: [] };
    }
  }

  // 2) Partial / fuzzy — collect all matches
  const partial: string[] = [];
  for (const opt of options) {
    if (colorsMatch(requested, opt)) partial.push(opt);
  }

  if (partial.length === 1) return { matched: partial[0], ambiguous: [] };
  if (partial.length > 1) return { matched: null, ambiguous: partial };
  return { matched: null, ambiguous: [] };
}

/**
 * Format color options for bot / prompts.
 * Each array entry is shown as one option (compounds stay together).
 */
export function formatColorOptionsForDisplay(
  colors: string[] | null | undefined,
  language: 'arabic' | 'english' = 'arabic'
): string {
  if (!colors?.length) return '';
  const sep = language === 'arabic' ? ' — ' : ' — ';
  return colors.map((c, i) => `${i + 1}) ${c}`).join(sep);
}

/**
 * Extract a color mention from free text.
 * When availableOptions are provided, prefer the best matching product option label.
 */
export function extractColorFromText(
  text: string | null | undefined,
  availableOptions?: string[] | null
): string | null {
  if (!text?.trim()) return null;

  if (availableOptions?.length) {
    // Prefer longest option label that appears in the message (compound first)
    const sorted = [...availableOptions].sort((a, b) => b.length - a.length);
    const nText = stripArabicArticle(normalizeColorToken(text));
    for (const opt of sorted) {
      const nOpt = stripArabicArticle(normalizeColorToken(opt));
      if (nOpt && nText.includes(nOpt)) return opt;
      // Compound: all atoms mentioned in the message
      const atoms = extractAtomicColors(opt);
      if (atoms.length >= 2) {
        const mentioned = extractAtomicColors(text);
        if (setsEqual(atoms, mentioned) || isSubset(atoms, mentioned)) return opt;
      }
    }

    const mentioned = extractAtomicColors(text);
    if (mentioned.length > 0) {
      const asRequest = mentioned.join(' و ');
      const result = matchColorOption(asRequest, availableOptions);
      if (result.matched) return result.matched;
      // Ambiguous: return null so caller can ask; don't pick first atomic blindly
      if (result.ambiguous.length > 1) return null;
    }
  }

  // Fallback: first atomic color mentioned (legacy)
  for (const entry of COLOR_CANONICAL) {
    for (const alias of entry.aliases) {
      const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(`(^|\\s|[,،/])${escaped}(?=$|\\s|[,،/.!?])`, 'i');
      if (re.test(text) || text.toLowerCase().includes(alias.toLowerCase())) {
        if (/^[a-z]+$/i.test(alias)) {
          const wordRe = new RegExp(`\\b${escaped}\\b`, 'i');
          if (!wordRe.test(text)) continue;
        }
        return entry.canonical;
      }
    }
  }
  return null;
}

/**
 * Resolve/normalize an extracted color entity against product options.
 * Returns the catalog option label when unique; otherwise original or null if ambiguous.
 */
export function resolveColorEntity(
  extracted: string | null | undefined,
  options: string[] | null | undefined,
  messageText?: string | null
): { color: string | null; needsClarification: boolean; ambiguous: string[] } {
  const fromMessage =
    messageText && options?.length
      ? extractColorFromText(messageText, options)
      : null;

  const candidate = fromMessage || extracted || null;
  if (!candidate) {
    return { color: null, needsClarification: false, ambiguous: [] };
  }

  if (!options?.length) {
    return { color: candidate, needsClarification: false, ambiguous: [] };
  }

  const match = matchColorOption(candidate, options);
  if (match.matched) {
    return { color: match.matched, needsClarification: false, ambiguous: [] };
  }
  if (match.ambiguous.length > 1) {
    return { color: null, needsClarification: true, ambiguous: match.ambiguous };
  }

  // Product defines options — reject colors outside the catalog (no free-text fallback)
  return { color: null, needsClarification: false, ambiguous: [] };
}

export { COLOR_CANONICAL };
