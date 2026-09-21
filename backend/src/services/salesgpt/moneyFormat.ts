/**
 * Integer-preserving money text so grounding tokens match cart numbers exactly.
 */
import { getCurrencyDisplayName } from '../../utils/currencyDisplayName.js';
import type { Language } from '../../core/types.js';

export function formatGroupedInteger(amount: number): string {
  if (!Number.isFinite(amount)) return '0';
  const negative = amount < 0;
  const abs = Math.abs(amount);
  if (Number.isInteger(abs)) {
    const grouped = String(Math.trunc(abs)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return negative ? `-${grouped}` : grouped;
  }
  const [intPart, frac] = String(abs).split('.');
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const out = `${grouped}.${frac}`;
  return negative ? `-${out}` : out;
}

export function formatCatalogMoney(
  amount: number,
  currencyCode: string | null | undefined,
  language: Language
): string {
  const label = getCurrencyDisplayName(
    currencyCode,
    language === 'arabic' ? 'arabic' : 'english'
  );
  return `${formatGroupedInteger(amount)} ${label}`;
}
