/**
 * Structured customer-request signals from the sales model.
 *
 * Intent understanding belongs to the model (JSON), not keyword/regex gates.
 * Code may only:
 *   - normalize/coerce the schema
 *   - enforce money/safety rails using these flags
 *   - fall back when the model omits the block entirely
 */

export interface CustomerRequestSignals {
  /** Customer wants other products / alternatives / "what else". */
  wantsAlternatives: boolean;
  /** Customer wants product details / specs / description. */
  asksProductInfo: boolean;
  /** Customer explicitly wants a product photo. */
  wantsPhoto: boolean;
  /**
   * Customer is affirming order placement (yes/confirm).
   * Never sufficient alone to persist ORDER_DATA — orderConfirmationPolicy still gates.
   */
  readyToConfirm: boolean;
}

export const EMPTY_CUSTOMER_REQUEST: CustomerRequestSignals = {
  wantsAlternatives: false,
  asksProductInfo: false,
  wantsPhoto: false,
  readyToConfirm: false
};

function asBool(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const t = value.trim().toLowerCase();
    return t === 'true' || t === '1' || t === 'yes';
  }
  return false;
}

/**
 * Coerce model JSON (camelCase or snake_case) into a safe signal object.
 * Missing/invalid block → all false (conservative).
 */
export function normalizeCustomerRequest(raw: unknown): CustomerRequestSignals {
  if (!raw || typeof raw !== 'object') {
    return { ...EMPTY_CUSTOMER_REQUEST };
  }
  const o = raw as Record<string, unknown>;
  return {
    wantsAlternatives: asBool(o.wants_alternatives ?? o.wantsAlternatives),
    asksProductInfo: asBool(o.asks_product_info ?? o.asksProductInfo),
    wantsPhoto: asBool(o.wants_photo ?? o.wantsPhoto),
    readyToConfirm: asBool(o.ready_to_confirm ?? o.readyToConfirm)
  };
}

/** True when the model returned an explicit customer_request object (even if all false). */
export function hasCustomerRequestBlock(raw: unknown): boolean {
  return !!raw && typeof raw === 'object';
}
