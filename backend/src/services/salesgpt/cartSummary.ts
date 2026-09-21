/**
 * Pure priced cart summary — numbers from cart lines only (never invented FX).
 * Totals are per currency; a missing unit price marks the total incomplete.
 */
import type { CartItem, Language } from '../../core/types.js';
import { formatCatalogMoney } from './moneyFormat.js';

export type CartSummaryOptions = {
  shippingPolicy?: string | null;
};

/** Catalog unit price is present and usable. 0 / NaN are missing — never guess. */
export function cartLineHasUnitPrice(item: CartItem): boolean {
  return (
    typeof item.unitPrice === 'number' &&
    Number.isFinite(item.unitPrice) &&
    item.unitPrice > 0
  );
}

/** Line total from quantity × unit price, or null when the unit price is missing. */
export function cartLineTotal(item: CartItem): number | null {
  if (!cartLineHasUnitPrice(item)) return null;
  const qty =
    typeof item.quantity === 'number' && Number.isFinite(item.quantity) && item.quantity > 0
      ? item.quantity
      : 1;
  return item.unitPrice * qty;
}

function cartLineLabel(item: CartItem): string {
  const parts = [item.productName];
  if (item.color) parts.push(item.color);
  if (item.size) parts.push(item.size);
  return parts.join(' — ');
}

export function formatCartLine(item: CartItem, language: Language): string {
  const label = cartLineLabel(item);
  const qty =
    typeof item.quantity === 'number' && item.quantity > 0 ? item.quantity : 1;

  if (!cartLineHasUnitPrice(item)) {
    if (language === 'arabic') {
      return qty > 1
        ? `• ${label} × ${qty} — السعر غير متوفر لهذا السطر`
        : `• ${label} — السعر غير متوفر لهذا السطر`;
    }
    return qty > 1
      ? `• ${label} × ${qty} — price unavailable for this line`
      : `• ${label} — price unavailable for this line`;
  }

  const unit = formatCatalogMoney(item.unitPrice, item.currency, language);
  if (qty === 1) {
    return `• ${label} — ${unit}`;
  }
  const total = formatCatalogMoney(cartLineTotal(item)!, item.currency, language);
  return language === 'arabic'
    ? `• ${label} × ${qty} — ${unit} للقطعة — ${total}`
    : `• ${label} × ${qty} — ${unit} each — ${total}`;
}

/** One total per currency. Missing unit prices are omitted from the amounts. */
export function computeCartTotalsByCurrency(
  items: CartItem[]
): Array<{ currency: string; amount: number }> {
  const map = new Map<string, number>();
  for (const item of items) {
    if (!cartLineHasUnitPrice(item)) continue;
    const currency =
      typeof item.currency === 'string' && item.currency.trim()
        ? item.currency.trim()
        : '';
    if (!currency) continue;
    const lineTotal = cartLineTotal(item);
    if (lineTotal === null) continue;
    map.set(currency, (map.get(currency) || 0) + lineTotal);
  }
  return [...map.entries()].map(([currency, amount]) => ({ currency, amount }));
}

export function formatCartSubtotalLine(items: CartItem[], language: Language): string {
  const missingPrice =
    items.length === 0 || items.some((item) => !cartLineHasUnitPrice(item));
  if (missingPrice) {
    return language === 'arabic'
      ? 'مجموع المنتجات: غير مكتمل — سعر بعض الأسطر غير متوفر'
      : 'Products total: incomplete — some line prices are unavailable';
  }
  const totals = computeCartTotalsByCurrency(items);
  if (totals.length === 1) {
    const only = totals[0];
    return language === 'arabic'
      ? `مجموع المنتجات: ${formatCatalogMoney(only.amount, only.currency, language)}`
      : `Products total: ${formatCatalogMoney(only.amount, only.currency, language)}`;
  }
  return totals
    .map((row) =>
      language === 'arabic'
        ? `مجموع المنتجات: ${formatCatalogMoney(row.amount, row.currency, language)}`
        : `Products total: ${formatCatalogMoney(row.amount, row.currency, language)}`
    )
    .join('\n');
}

function formatShippingPolicyFooter(
  shippingPolicy: string | null | undefined,
  language: Language
): string {
  if (!shippingPolicy || !shippingPolicy.trim()) return '';
  return language === 'arabic'
    ? 'تكلفة التوصيل حسب سياسة الشحن في المتجر.'
    : "Delivery cost follows the store's shipping policy.";
}

export function formatCartSummary(
  items: CartItem[],
  language: Language,
  opts?: CartSummaryOptions
): string {
  if (items.length === 0) {
    return language === 'arabic' ? 'السلة فارغة' : 'Cart is empty';
  }
  const lines = `${items.map((item) => formatCartLine(item, language)).join('\n')}\n${formatCartSubtotalLine(items, language)}`;
  const ship = formatShippingPolicyFooter(opts?.shippingPolicy, language);
  return ship ? `${lines}\n${ship}` : lines;
}
