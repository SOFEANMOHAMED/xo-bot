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
