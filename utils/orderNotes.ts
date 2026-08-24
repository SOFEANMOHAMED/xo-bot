/**
 * Merchant-facing order notes (dashboard).
 * Keep in sync with backend/src/orders/merchantOrderNotes.ts
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
