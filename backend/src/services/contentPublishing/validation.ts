import {
  FB_CAPTION_MAX,
  IG_CAPTION_MAX,
  MAX_CAROUSEL_ITEMS,
  MIN_CAROUSEL_ITEMS
} from './constants.js';
import type {
  ContentPlatform,
  PublicationMediaInput,
  PublicationTargetInput
} from './types.js';

const HTTPS_URL = /^https:\/\//i;

export function normalizeMedia(media: PublicationMediaInput[] | undefined): PublicationMediaInput[] {
  if (!Array.isArray(media)) return [];
  return media
    .filter((item) => item && typeof item.mediaUrl === 'string' && item.mediaUrl.trim())
    .map((item, index) => ({
      mediaUrl: item.mediaUrl.trim(),
      mediaType: item.mediaType === 'video' ? 'video' : 'image',
      thumbnailUrl: item.thumbnailUrl?.trim() || null,
      altText: item.altText?.trim() || null,
      sortOrder: item.sortOrder ?? index
    }));
}

export function normalizeTargets(
  targets: PublicationTargetInput[] | undefined
): PublicationTargetInput[] {
  if (!Array.isArray(targets)) return [];
  const seen = new Set<string>();
  const out: PublicationTargetInput[] = [];
  for (const target of targets) {
    if (!target?.platform || !target?.accountRef) continue;
    if (target.platform !== 'facebook' && target.platform !== 'instagram') continue;
    const key = `${target.platform}:${target.accountRef}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      platform: target.platform,
      accountRef: String(target.accountRef).trim(),
      accountLabel: target.accountLabel?.trim() || null
    });
  }
  return out;
}

export function validatePublicationPayload(input: {
  caption?: string | null;
  media: PublicationMediaInput[];
  targets: PublicationTargetInput[];
  scheduledAt?: Date | null;
  requireFutureSchedule?: boolean;
}): string | null {
  const caption = (input.caption || '').trim();
  const { media, targets } = input;

  if (!targets.length) {
    return 'اختر حساب فيسبوك أو إنستغرام واحداً على الأقل';
  }

  for (const item of media) {
    if (!HTTPS_URL.test(item.mediaUrl)) {
      return 'روابط الوسائط يجب أن تكون HTTPS عامة (مطلوب من Meta)';
    }
  }

  if (media.length > MAX_CAROUSEL_ITEMS) {
    return `الحد الأقصى للوسائط هو ${MAX_CAROUSEL_ITEMS}`;
  }

  const hasIg = targets.some((t) => t.platform === 'instagram');
  const hasFb = targets.some((t) => t.platform === 'facebook');

  if (hasIg && media.length === 0) {
    return 'إنستغرام يتطلب صورة أو فيديو على الأقل';
  }

  if (hasFb && !caption && media.length === 0) {
    return 'أضف نصاً أو وسائط للمنشور';
  }

  const videoCount = media.filter((m) => m.mediaType === 'video').length;
  if (hasFb && media.length > 1 && videoCount > 0) {
    return 'فيسبوك يدعم فيديو واحد لكل منشور، أو كاروسيل صور فقط — لا يمكن خلط فيديو مع صور';
  }

  if (media.length > 1 && media.length < MIN_CAROUSEL_ITEMS) {
    return `الكاروسيل يحتاج ${MIN_CAROUSEL_ITEMS} عناصر على الأقل`;
  }

  if (hasIg && caption.length > IG_CAPTION_MAX) {
    return `نص إنستغرام يتجاوز الحد (${IG_CAPTION_MAX} حرفاً)`;
  }

  if (hasFb && caption.length > FB_CAPTION_MAX) {
    return 'نص فيسبوك طويل جداً';
  }

  if (input.requireFutureSchedule) {
    if (!input.scheduledAt || Number.isNaN(input.scheduledAt.getTime())) {
      return 'حدد وقت جدولة صالحاً';
    }
    if (input.scheduledAt.getTime() <= Date.now() + 30_000) {
      return 'وقت الجدولة يجب أن يكون بعد دقيقة على الأقل من الآن';
    }
  }

  return null;
}

export function platformsInTargets(targets: PublicationTargetInput[]): ContentPlatform[] {
  return Array.from(new Set(targets.map((t) => t.platform)));
}

export function parseScheduleDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}
