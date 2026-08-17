/**
 * Log redaction helpers — never put customer conversation content or PII in logs.
 */

export function messageMeta(text: string | null | undefined): {
  messageLength: number;
  hasContent: boolean;
} {
  const len = (text || '').length;
  return { messageLength: len, hasContent: len > 0 };
}

export function orderDataMeta(orderData: {
  customerName?: string | null;
  customerPhone?: string | null;
  customerAddress?: string | null;
  products?: unknown[];
} | null | undefined): {
  hasName: boolean;
  hasPhone: boolean;
  hasAddress: boolean;
  productsCount: number;
} {
  return {
    hasName: Boolean(orderData?.customerName?.trim()),
    hasPhone: Boolean(orderData?.customerPhone?.trim()),
    hasAddress: Boolean(orderData?.customerAddress?.trim()),
    productsCount: Array.isArray(orderData?.products) ? orderData!.products!.length : 0,
  };
}

/** Mask a secret for API responses (e.g. bot tokens). Empty → empty. */
export function maskSecret(value: string | null | undefined): string {
  const v = (value || '').trim();
  if (!v) return '';
  if (v.length <= 4) return '****';
  return `****${v.slice(-4)}`;
}

/** True when client echoed a masked secret back (do not persist). */
export function isMaskedSecret(value: string | null | undefined): boolean {
  const v = (value || '').trim();
  if (!v) return false;
  return /^\*+[A-Za-z0-9_-]{0,8}$/.test(v) || v.startsWith('****');
}
