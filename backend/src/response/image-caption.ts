/**
 * Caption cleanup when the system attaches [IMAGE: ...] for bot channels.
 * Prevents contradictory replies like "I can't send photos" while a photo is delivered.
 */

import type { Language } from '../core/types.js';

/**
 * When we attach [IMAGE:], strip AI apologies like "I can't send photos"
 * so the caption matches the fact that a photo was delivered.
 */
export function sanitizeCaptionWhenImageSent(
  text: string,
  language: Language,
  productName?: string
): string {
  const fallback =
    language === 'arabic'
      ? `تفضل الصورة! 📸✨${productName ? `\n${productName} روعة صح؟` : ''} 😍`
      : `Here's the photo! 📸✨${productName ? `\n${productName} — amazing, right?` : ''} 😍`;

  if (!text?.trim()) return fallback;

  let cleaned = text
    // Arabic apology sentences about inability to send images
    .replace(
      /[^.!?\n]*(?:آسف|اسف|معذره|معذرة|عذراً|عذرا)[^.!?\n]*(?:ما\s*بقدر|ما\s*فيني|لا\s*ا?ستطيع|لا\s*يمكن|مش\s*قادر)[^.!?\n]*(?:صور|صورة|الصور)[^.!?\n]*[.!?۔]?\s*/gi,
      ''
    )
    .replace(
      /[^.!?\n]*(?:ما\s*بقدر|ما\s*فيني|لا\s*ا?ستطيع|لا\s*يمكنني|مش\s*قادر)[^.!?\n]*(?:أرسل|ارسل|إرسال|ارسال)[^.!?\n]*(?:صور|صورة|الصور)[^.!?\n]*[.!?۔]?\s*/gi,
      ''
    )
    .replace(
      /[^.!?\n]*(?:بقدرش|ما بقدرش)[^.!?\n]*(?:صور|صورة)[^.!?\n]*[.!?۔]?\s*/gi,
      ''
    )
    // English
    .replace(
      /[^.!?\n]*(?:sorry|unfortunately)[^.!?\n]*(?:can'?t|cannot|unable to|don'?t)[^.!?\n]*(?:send|share|attach)[^.!?\n]*(?:pictures?|photos?|images?)[^.!?\n]*[.!?]?\s*/gi,
      ''
    )
    .replace(
      /[^.!?\n]*(?:i\s+)?(?:can'?t|cannot|unable to)[^.!?\n]*(?:send|share|attach)[^.!?\n]*(?:pictures?|photos?|images?)[^.!?\n]*(?:directly)?[^.!?\n]*[.!?]?\s*/gi,
      ''
    )
    // Soft connectors left after stripping ("بس ", "But ")
    .replace(/^(?:بس|لكن|ولكن|but|however)\s+/i, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (!cleaned || cleaned.length < 8) return fallback;

  if (
    /(?:ما\s*بقدر|لا\s*ا?ستطيع|can'?t\s+send|cannot\s+send).{0,40}(?:صور|صورة|picture|photo|image)/i.test(
      cleaned
    )
  ) {
    return language === 'arabic'
      ? `تفضل الصورة! 📸✨${productName ? ` ${productName}` : ''} روعة صح؟ 😍`
      : `Here's the photo! 📸✨${productName ? ` ${productName}` : ''} — love it? 😍`;
  }

  return cleaned;
}

/**
 * When no [IMAGE:] is attached, strip AI phrases that falsely claim a photo was sent
 * (e.g. "تفضل الصورة!" after a price-only question).
 */
export function stripFalseImageDeliveryClaims(text: string): string {
  if (!text?.trim()) return text || '';

  let cleaned = text
    // Arabic: "here's the photo / I sent the photo / look at the photo"
    .replace(
      /(?:تفضل(?:ي|وا)?|هاي|هذه|ها?\s*هي)\s*(?:الصورة|الصوره|الصور)!?\s*(?:📸)?\s*(?:✨)?/gi,
      ''
    )
    .replace(
      /(?:أرسلت(?:لك|لِك|ها)?|ارسلت(?:لك|لِك|ها)?|بعت(?:لك)?|أرفقت|ارفقت)\s*(?:لك\s+)?(?:الصورة|الصوره|صورة|صور(?:ة)?(?:\s*المنتج)?)\s*!?\s*(?:📸)?/gi,
      ''
    )
    .replace(
      /(?:شوف(?:ي|وا)?|شوفيني|وريك)\s*(?:الصورة|الصوره)!?\s*(?:📸)?/gi,
      ''
    )
    // English delivery claims
    .replace(
      /(?:here(?:'s|\s+is)\s+(?:the\s+)?(?:photo|image|picture)!?\s*(?:📸)?\s*(?:✨)?)/gi,
      ''
    )
    .replace(
      /(?:i(?:'ve|\s+have)?\s+)?(?:sent|attached|shared)\s+(?:you\s+)?(?:the\s+)?(?:photo|image|picture)\s*!?\s*(?:📸)?/gi,
      ''
    )
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([.!?،,])/g, '$1')
    .replace(/([.!?،,])\s*([.!?،,])/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return cleaned || text.trim();
}
