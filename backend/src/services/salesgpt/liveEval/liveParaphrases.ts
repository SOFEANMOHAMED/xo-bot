/**
 * Dialect paraphrases for key customer turns (Syrian / Gulf / Egyptian).
 * Eight variants per key id — used to expand live measurement coverage.
 */
export type Dialect = 'syrian' | 'gulf' | 'egyptian';

export type ParaphraseSet = {
  key: string;
  variants: ReadonlyArray<{ dialect: Dialect; text: string }>;
};

export const PARAPHRASE_SETS: readonly ParaphraseSet[] = Object.freeze([
  {
    key: 'greeting',
    variants: [
      { dialect: 'syrian', text: 'السلام عليكم' },
      { dialect: 'syrian', text: 'مرحبا' },
      { dialect: 'gulf', text: 'السلام عليكم ورحمة الله' },
      { dialect: 'gulf', text: 'هلا والله' },
      { dialect: 'egyptian', text: 'السلام عليكم' },
      { dialect: 'egyptian', text: 'ازيك' },
      { dialect: 'syrian', text: 'أهلا' },
      { dialect: 'gulf', text: 'يا هلا' },
    ],
  },
  {
    key: 'browse_all',
    variants: [
      { dialect: 'syrian', text: 'حابب اعرف المنتجات الموجودة عنكن' },
      { dialect: 'syrian', text: 'شو في عندكم منتجات؟' },
      { dialect: 'gulf', text: 'وش عندكم من المنتجات؟' },
      { dialect: 'gulf', text: 'ابغى اشوف الموجود عندكم' },
      { dialect: 'egyptian', text: 'عايز اعرف المنتجات اللي عندكم' },
      { dialect: 'egyptian', text: 'فيه ايه عندكم؟' },
      { dialect: 'syrian', text: 'ممكن أعرف شو في عنكن منتجات' },
      { dialect: 'gulf', text: 'عطني نظرة على المنتجات' },
    ],
  },
  {
    key: 'price_watch',
    variants: [
      { dialect: 'syrian', text: 'كم سعر ساعة؟' },
      { dialect: 'syrian', text: 'بكم الساعة؟' },
      { dialect: 'gulf', text: 'بكم الساعة؟' },
      { dialect: 'gulf', text: 'شنو سعر الساعة؟' },
      { dialect: 'egyptian', text: 'بكام الساعة؟' },
      { dialect: 'egyptian', text: 'سعر الساعة كام؟' },
      { dialect: 'syrian', text: 'قديش ثمن الساعة؟' },
      { dialect: 'gulf', text: 'بكم هالساعة؟' },
    ],
  },
  {
    key: 'order_watch',
    variants: [
      { dialect: 'syrian', text: 'بدي اطلب الساعة' },
      { dialect: 'syrian', text: 'بدي الساعة' },
      { dialect: 'gulf', text: 'ابغى الساعة' },
      { dialect: 'gulf', text: 'ابي اطلب الساعة' },
      { dialect: 'egyptian', text: 'عايز اطلب الساعة' },
      { dialect: 'egyptian', text: 'هطلب الساعة' },
      { dialect: 'syrian', text: 'خلينا نطلب الساعة' },
      { dialect: 'gulf', text: 'ابي اكمل طلب الساعة' },
    ],
  },
  {
    key: 'color_black',
    variants: [
      { dialect: 'syrian', text: 'الأسود' },
      { dialect: 'syrian', text: 'بدي الأسود' },
      { dialect: 'gulf', text: 'الاسود' },
      { dialect: 'gulf', text: 'ابي الاسود' },
      { dialect: 'egyptian', text: 'الاسود' },
      { dialect: 'egyptian', text: 'عايز الاسود' },
      { dialect: 'syrian', text: 'خلينا على الأسود' },
      { dialect: 'gulf', text: 'بالاسود' },
    ],
  },
  {
    key: 'mobile_ask',
    variants: [
      { dialect: 'syrian', text: 'عندكم موبايلات؟' },
      { dialect: 'syrian', text: 'في موبايلات' },
      { dialect: 'gulf', text: 'عندكم جوالات؟' },
      { dialect: 'gulf', text: 'فيه جوال؟' },
      { dialect: 'egyptian', text: 'عندكم موبايلات؟' },
      { dialect: 'egyptian', text: 'في موبايل؟' },
      { dialect: 'syrian', text: 'بتبيعوا موبايل؟' },
      { dialect: 'gulf', text: 'تبيعون جوالات؟' },
    ],
  },
  {
    key: 'confirm_yes',
    variants: [
      { dialect: 'syrian', text: 'نعم أكد' },
      { dialect: 'syrian', text: 'اي أكد الطلب' },
      { dialect: 'gulf', text: 'ايه أكد' },
      { dialect: 'gulf', text: 'تم أكد الطلب' },
      { dialect: 'egyptian', text: 'ايوه أكد' },
      { dialect: 'egyptian', text: 'تمام أكد الطلب' },
      { dialect: 'syrian', text: 'أكد' },
      { dialect: 'gulf', text: 'نعم' },
    ],
  },
  {
    key: 'two_watches',
    variants: [
      { dialect: 'syrian', text: 'ساعتين' },
      { dialect: 'syrian', text: 'بدي ساعتين' },
      { dialect: 'gulf', text: 'ساعتين' },
      { dialect: 'gulf', text: 'ابي ساعتين' },
      { dialect: 'egyptian', text: 'ساعتين' },
      { dialect: 'egyptian', text: 'عايز ساعتين' },
      { dialect: 'syrian', text: 'اثنين ساعة' },
      { dialect: 'gulf', text: 'ثنتين ساعة' },
    ],
  },
]);

const byKey = new Map(PARAPHRASE_SETS.map((s) => [s.key, s]));

export function paraphrase(key: string, variantIndex: number, fallback: string): string {
  const set = byKey.get(key);
  if (!set || set.variants.length === 0) return fallback;
  const idx = ((variantIndex % set.variants.length) + set.variants.length) % set.variants.length;
  return set.variants[idx].text;
}
