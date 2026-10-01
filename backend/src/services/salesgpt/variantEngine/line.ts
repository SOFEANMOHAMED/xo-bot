import type { CartItem } from '../../../core/types.js';
import { RESERVED_AXIS_COLOR, RESERVED_AXIS_SIZE } from './types.js';

/** Write one axis onto a line; mirror color/size fields for legacy readers. */
export function setLineVariant(
  line: CartItem,
  axisId: string,
  value: string
): CartItem {
  const variants: Record<string, string> = { ...(line.variants || {}) };
  if (line.color && !variants[RESERVED_AXIS_COLOR]) {
    variants[RESERVED_AXIS_COLOR] = line.color;
  }
  if (line.size && !variants[RESERVED_AXIS_SIZE]) {
    variants[RESERVED_AXIS_SIZE] = line.size;
  }
  variants[axisId] = value;
  return {
    ...line,
    variants,
    color: axisId === RESERVED_AXIS_COLOR ? value : line.color,
    size: axisId === RESERVED_AXIS_SIZE ? value : line.size,
  };
}
