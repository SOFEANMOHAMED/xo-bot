/**
 * Merchant-facing labels and badge styles for order.source (channel).
 */

const CHANNEL_ALIASES: Record<string, string> = {
  facebook: 'facebook',
  facebook_messenger: 'facebook',
  facebook_comment: 'facebook',
  messenger: 'facebook',
  instagram: 'instagram',
  telegram: 'telegram',
  whatsapp: 'whatsapp',
  shopify: 'shopify',
  manual: 'manual',
};

const SOURCE_LABELS_AR: Record<string, string> = {
  facebook: 'فيسبوك',
  instagram: 'إنستغرام',
  telegram: 'تيليجرام',
  whatsapp: 'واتساب',
  shopify: 'Shopify',
  manual: 'يدوي',
  playground: 'تجربة البوت',
  web: 'الموقع',
  bot: 'بوت',
};

const SOURCE_BADGE_CLASSES: Record<string, string> = {
  facebook: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  instagram: 'bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-400',
  telegram: 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400',
  whatsapp: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  shopify: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
};

const DEFAULT_BADGE_CLASS = 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300';

function inferChannelFromNotes(notes?: string | null): string | null {
  if (!notes) return null;
  const n = notes.toLowerCase();
  if (n.includes('instagram')) return 'instagram';
  if (n.includes('facebook') || n.includes('messenger')) return 'facebook';
  if (n.includes('telegram')) return 'telegram';
  if (n.includes('whatsapp')) return 'whatsapp';
  return null;
}

export function resolveOrderSource(source?: string | null, notes?: string | null): string {
  const key = (source || '').trim().toLowerCase();
  if (key && CHANNEL_ALIASES[key]) return CHANNEL_ALIASES[key];
  const inferred = inferChannelFromNotes(notes);
  if (inferred) return inferred;
  if (key) return key;
  return 'manual';
}

export function getOrderSourceLabel(source?: string | null, notes?: string | null): string {
  const resolved = resolveOrderSource(source, notes);
  return SOURCE_LABELS_AR[resolved] || resolved || 'يدوي';
}

export function getOrderSourceBadgeClass(source?: string | null, notes?: string | null): string {
  const resolved = resolveOrderSource(source, notes);
  return SOURCE_BADGE_CLASSES[resolved] || DEFAULT_BADGE_CLASS;
}
