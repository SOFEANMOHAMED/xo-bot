/**
 * Arabic UI locales with Latin digits (0-9 / 12345).
 * Display-only — do not use in bot reply / orchestration paths.
 */
export const AR_LATN = 'ar-u-nu-latn';
export const AR_EG_LATN = 'ar-EG-u-nu-latn';
export const AR_SA_LATN = 'ar-SA-u-nu-latn';
export const AR_SY_LATN = 'ar-SY-u-nu-latn';

/** Numbers with Latin digits (keeps Arabic grouping when desired). */
export function formatNumber(
  value: number,
  options?: Intl.NumberFormatOptions,
  locale: string = AR_EG_LATN
): string {
  return new Intl.NumberFormat(locale, options).format(value);
}

export type FormatCurrencyOptions = Intl.NumberFormatOptions & {
  /** Round before formatting (orders list uses whole units). */
  round?: boolean;
};

/** Currency with Latin digits. Invalid ISO codes fall back to USD. */
export function formatCurrency(
  amount: number,
  currency: string = 'USD',
  options?: FormatCurrencyOptions,
  locale: string = AR_EG_LATN
): string {
  const { round, ...intlOptions } = options || {};
  const value = round ? Math.round(amount) : amount;
  const code = (currency || 'USD').trim().toUpperCase() || 'USD';
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: code,
      ...intlOptions
    }).format(value);
  } catch {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: 'USD',
      ...intlOptions
    }).format(value);
  }
}

export function formatDate(
  value: Date | string | number,
  options?: Intl.DateTimeFormatOptions,
  locale: string = AR_SA_LATN
): string {
  const date = value instanceof Date ? value : new Date(value);
  return date.toLocaleDateString(locale, options);
}

export function formatDateTime(
  value: Date | string | number,
  options?: Intl.DateTimeFormatOptions,
  locale: string = AR_EG_LATN
): string {
  const date = value instanceof Date ? value : new Date(value);
  return date.toLocaleString(locale, options);
}

export function formatTime(
  value: Date | string | number,
  options?: Intl.DateTimeFormatOptions,
  locale: string = AR_EG_LATN
): string {
  const date = value instanceof Date ? value : new Date(value);
  return date.toLocaleTimeString(locale, options);
}
