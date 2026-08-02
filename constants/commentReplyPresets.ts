/** Ready-made Arabic templates for Facebook / Instagram comment auto-replies. Placeholders: {{name}}, {{comment}} */

export type CommentReplyPreset = { id: string; label: string; body: string };

export const COMMENT_PUBLIC_REPLY_PRESETS: CommentReplyPreset[] = [
  {
    id: 'thanks_dm',
    label: 'شكر + توجيه للخاص',
    body: 'شكراً لتعليقك! 💬 يسعدنا اهتمامك. يمكنك مراسلتنا في الخاص لأي استفسار أو طلب.'
  },
  {
    id: 'price_stock',
    label: 'سعر أو توفر',
    body: 'شكراً لاهتمامك! 💰 للأسعار والتوفر والطلب، راسلنا في الرسائل الخاصة وسنخدمك مباشرة.'
  },
  {
    id: 'short_thanks',
    label: 'شكر مختصر',
    body: 'شكراً جزيلاً! 🙏 نقدّر تفاعلك معنا.'
  },
  {
    id: 'order_help',
    label: 'مساعدة في الطلب',
    body: 'أهلاً! لمساعدتك في الطلب أو الاستفسار عن منتج معيّن، تواصل معنا عبر الخاص وسنرشدك خطوة بخطوة.'
  },
  {
    id: 'working_hours',
    label: 'سيتم الرد لاحقاً',
    body: 'شكراً لتعليقك! ⏰ فريقنا سيراجع رسالتك ويرد عليك في أقرب وقت.'
  }
];

export const COMMENT_DM_AFTER_PRESETS: CommentReplyPreset[] = [
  {
    id: 'welcome_default',
    label: 'ترحيب عام',
    body: 'مرحباً {{name}}! شكراً لتواصلك معنا. كيف نقدر نخدمك اليوم؟'
  },
  {
    id: 'welcome_product',
    label: 'ترحيب + منتجات',
    body: 'أهلاً {{name}}! 👋 شكراً لتعليقك. أخبرنا ما الذي تبحث عنه وسنعرض لك الخيارات المناسبة.'
  },
  {
    id: 'welcome_order',
    label: 'جاهزون لاستلام الطلب',
    body: 'مرحباً {{name}}! يسعدنا خدمتك. يمكنك إرسال تفاصيل طلبك هنا وسنؤكد لك مباشرة.'
  },
  {
    id: 'minimal',
    label: 'قصير',
    body: 'أهلاً {{name}}! كيف نساعدك؟'
  }
];
