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
