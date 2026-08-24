/**
 * Shared product keyword extraction for SalesGPT product search fallbacks.
 */

export function extractProductKeywords(messageText: string): string[] {
  if (!messageText || messageText.trim().length === 0) return [];
  const text = messageText.trim().toLowerCase();

  const stopWords = [
    'بدي', 'ابي', 'اريد', 'ابغى', 'عاوز', 'اشتري', 'احجز', 'اطلب',
    'شو', 'ايش', 'كم', 'وين', 'متى', 'كيف', 'هل',
    'سعر', 'ثمن', 'تكلفة', 'قيمة',
    'عندكم', 'عندك', 'لديكم', 'معكم', 'موجود', 'متوفر',
    'السلام', 'عليكم', 'مرحبا', 'اهلا', 'هلا', 'صباح', 'مساء',
    'من', 'الى', 'في', 'على', 'عن', 'مع', 'هذا', 'هذه', 'ذلك',
    'نعم', 'اي', 'اه', 'طيب', 'تمام', 'ماشي',
    'لا', 'لأ', 'مو', 'ما', 'مش',
    'صورة', 'صور', 'وريني', 'فرجيني', 'ارني',
    'التنين', 'الاتنين', 'كلاهما', 'كليهما', 'بعتلي', 'ابعث',
    'want', 'need', 'buy', 'purchase', 'order', 'get',
    'what', 'how', 'where', 'when', 'which',
    'price', 'cost', 'available', 'have', 'do', 'you',
    'the', 'a', 'an', 'is', 'are',
    'yes', 'no', 'ok', 'okay',
    'image', 'picture', 'photo', 'show', 'see',
  ];

  const words = text
    .replace(/[.,;:!?()]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 2 && !stopWords.includes(w) && !/^\d+$/.test(w));

  return [...new Set(words)].slice(0, 5);
}
