/**
 * Human-readable currency labels for bot replies (not ISO codes like USD).
 */

export type CurrencyLanguage = 'arabic' | 'english';

export function getCurrencyDisplayName(
  code: string | null | undefined,
  language: CurrencyLanguage = 'arabic'
): string {
  const raw = code && String(code).trim() ? String(code).trim() : 'USD';
  const upper = raw.toUpperCase();
  const key = upper.length === 3 ? upper : raw;
  try {
    const locale = language === 'arabic' ? 'ar' : 'en-US';
    const dn = new Intl.DisplayNames([locale], { type: 'currency' });
    const label = dn.of(key);
    if (label) return label;
  } catch {
    /* ignore */
  }
  return upper.length === 3 ? upper : raw;
}
