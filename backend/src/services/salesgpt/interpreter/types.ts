/**
 * Phase 4 interpreter contract types — see docs/INTERPRETER_CONTRACT.md.
 * Closed vocab; ids must come from caller-built candidate lists.
 */

export type InterpreterActionType =
  | 'set_focus_product'
  | 'ask_clarification'
  | 'select_color'
  | 'select_size'
  | 'set_quantity'
  | 'add_product'
  | 'remove_line'
  | 'cancel_order'
  | 'correct_variant'
  | 'request_photo'
  | 'refuse_photo'
  | 'browse_catalog'
  | 'ask_product_info'
  | 'provide_identity_field'
  | 'affirm_order'
  | 'deny_order'
  | 'handoff_human'
  | 'noop';

export const INTERPRETER_ACTION_TYPES: readonly InterpreterActionType[] = [
  'set_focus_product',
  'ask_clarification',
  'select_color',
  'select_size',
  'set_quantity',
  'add_product',
  'remove_line',
  'cancel_order',
  'correct_variant',
  'request_photo',
  'refuse_photo',
  'browse_catalog',
  'ask_product_info',
  'provide_identity_field',
  'affirm_order',
  'deny_order',
  'handoff_human',
  'noop',
] as const;

export const DESTRUCTIVE_ACTION_TYPES: readonly InterpreterActionType[] = [
  'cancel_order',
  'remove_line',
];

export type InterpreterInfoKind = 'price' | 'details' | 'availability';
export type InterpreterIdentityField = 'name' | 'phone' | 'address';

export type InterpreterCartLine = {
  lineId: string;
  productId: string;
  productName: string;
  color: string | null;
  size: string | null;
  quantity: number;
  currency: string;
  allowedColors: string[];
  allowedSizes: string[];
};

export type InterpreterStateSummary = {
  focusProductId: string | null;
  pendingBotQuestion: string | null;
  pendingProductId: string | null;
  awaitingOrderConfirmation: boolean;
  cartStatus: 'building' | 'checking_out' | null;
};

export type InterpreterInput = {
  message: string;
  recentMessages: Array<{ role: 'user' | 'assistant'; content: string }>;
  stateSummary: InterpreterStateSummary;
  allowedProductIds: string[];
  cartLines: InterpreterCartLine[];
};

export type InterpreterAction = {
  type: InterpreterActionType;
  productId?: string;
  lineId?: string;
  color?: string;
  size?: string;
  quantity?: number;
  identityField?: InterpreterIdentityField;
  identityValue?: string;
  infoKind?: InterpreterInfoKind;
  confidence: number;
  evidence: string;
  ambiguous: boolean;
};

export type InterpreterResult = {
  actions: InterpreterAction[];
  rawModelConfidence: number;
};

export type InterpreterMode = 'shadow' | 'flip';
