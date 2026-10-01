/**
 * Which action types are live (FLIP) vs shadow-only.
 * Contract §6: rows 1–6 flipped; browse stays flipped with ask_product_info.
 */
import type { InterpreterActionType } from './types.js';

/** Live interpreter action types — one interpretation per type per turn. */
export const FLIPPED_INTERPRETER_TYPES: readonly InterpreterActionType[] = [
  'set_focus_product',
  'ask_clarification',
  'request_photo',
  'refuse_photo',
  'set_quantity',
  'ask_product_info',
  'select_color',
  'select_size',
  'correct_variant',
  'add_product',
  'remove_line',
  'cancel_order',
  'browse_catalog',
  'provide_identity_field',
];

export function isFlippedType(type: InterpreterActionType): boolean {
  return (FLIPPED_INTERPRETER_TYPES as readonly string[]).includes(type);
}

export function parseInterpreterMode(raw: string | undefined): 'shadow' | 'flip' {
  return raw === 'shadow' ? 'shadow' : 'flip';
}
