/**
 * Merchant-facing order notes.
 * Channel/source lives on orders.source; line items live on order_items.
 * Notes are only extra context the merchant cannot see elsewhere.
 */

const CHANNEL_NOISE =
  /order\s+(?:via|created\s+via)|full\s*ai\s*mode/i;

const CHANNEL_NAME_ONLY =
  /^(?:facebook(?:\s+messenger)?|instagram|telegram|whatsapp(?:\s+cloud|\s+web)?|bot\s+playground(?:\s*\(.+\))?|messenger)$/i;

function trimNote(value?: string | null): string {
  return (value || '').replace(/\s+/g, ' ').trim();
}

function isBareProductQtyLine(line: string): boolean {
  if (/اللون:|المقاس:|وقت التوصيل/i.test(line)) return false;
  return /^\d+\s*[×xX]\s+\S/.test(line) || /\S.+\s+[×xX]\s*\d+$/.test(line);
}

export function formatVariantCaption(
  color?: string | null,
  size?: string | null
): string {
  const parts: string[] = [];
  const c = trimNote(color);
  const s = trimNote(size);
  if (c) parts.push(`اللون: ${c}`);
  if (s) parts.push(`المقاس: ${s}`);
  return parts.join(' · ');
}

/**
 * Turn stored / legacy blobs into readable Arabic lines.
 * Safe on already-clean notes (idempotent).
 */
export function formatOrderNotesForMerchant(raw?: string | null): string {
  if (!raw?.trim()) return '';

  const segments = raw
    .split(/\||│|｜|\n/)
    .map((part) =>
      part
        .replace(/\(\s*full\s*ai\s*mode\s*\)/gi, '')
        .replace(/\bfull\s*ai\s*mode\b/gi, '')
        .trim()
    )
    .filter(Boolean);

  const lines: string[] = [];

  for (const segment of segments) {
    if (CHANNEL_NOISE.test(segment) || CHANNEL_NAME_ONLY.test(segment)) {
      continue;
    }

    const colorOnly = segment.match(/^(?:color|اللون)\s*:\s*(.+)$/i);
    if (colorOnly) {
      const value = colorOnly[1].trim();
      if (!value) continue;
      if (lines.length > 0) {
        lines[lines.length - 1] = `${lines[lines.length - 1]} — اللون: ${value}`;
      } else {
        lines.push(`اللون: ${value}`);
      }
      continue;
    }

    const sizeOnly = segment.match(/^(?:size|المقاس)\s*:\s*(.+)$/i);
    if (sizeOnly) {
      const value = sizeOnly[1].trim();
      if (!value) continue;
      if (lines.length > 0) {
        lines[lines.length - 1] = `${lines[lines.length - 1]} — المقاس: ${value}`;
      } else {
        lines.push(`المقاس: ${value}`);
      }
      continue;
    }

    const cleaned = segment
      .replace(/^Product:\s*/i, '')
      .replace(/\bColor:\s*/gi, 'اللون: ')
      .replace(/\bSize:\s*/gi, 'المقاس: ')
      .replace(/\s+/g, ' ')
      .trim();

    if (cleaned) lines.push(cleaned);
  }

  return lines.filter((line) => !isBareProductQtyLine(line)).join('\n');
}

/** Notes stored on new bot orders — never channel jargon or cart copies. */
export function buildMerchantOrderNotes(input: {
  notes?: string | null;
  deliveryTime?: string | null;
}): string | null {
  const extra = formatOrderNotesForMerchant(input.notes);
  const delivery = trimNote(input.deliveryTime);
  const parts: string[] = [];
  if (extra) parts.push(extra);
  if (delivery) parts.push(`وقت التوصيل: ${delivery}`);
  return parts.length > 0 ? parts.join('\n') : null;
}
