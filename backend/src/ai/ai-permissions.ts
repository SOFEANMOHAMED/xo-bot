export interface AIPermissions {
  allowClarifyingQuestions: boolean;
  allowPolicyUsage: boolean;
  allowOrderInfoCollection: boolean;
  allowRecommendations: boolean;
  allowUpsell: boolean;
  allowEmojis: boolean;
}

export const DEFAULT_AI_PERMISSIONS: AIPermissions = {
  allowClarifyingQuestions: true,
  allowPolicyUsage: true,
  allowOrderInfoCollection: true,
  allowRecommendations: true,
  allowUpsell: true,
  allowEmojis: true
};

export const buildPermissionInstructions = (
  language: 'arabic' | 'english',
  permissions: AIPermissions
): string => {
  const allowed: string[] = [];

  if (permissions.allowClarifyingQuestions) {
    allowed.push(
      language === 'arabic'
        ? 'يمكنك طلب توضيح المقاس/اللون/الكمية/الميزانية/المدينة عند الحاجة.'
        : 'You may ask for size/color/quantity/budget/city when needed.'
    );
  }

  if (permissions.allowPolicyUsage) {
    allowed.push(
      language === 'arabic'
        ? 'يمكنك ذكر سياسات الشحن/التوصيل/الدفع/الإرجاع إذا كانت متاحة ضمن سياسات المتجر.'
        : 'You may mention shipping/delivery/payment/return policies if provided in store policies.'
    );
  }

  if (permissions.allowOrderInfoCollection) {
    allowed.push(
      language === 'arabic'
        ? 'يمكنك طلب بيانات الطلب (الاسم، الهاتف، العنوان) فقط عند نية الشراء.'
        : 'You may request order details (name, phone, address, ) only when purchase intent is clear.'
    );
  }

  if (permissions.allowRecommendations) {
    allowed.push(
      language === 'arabic'
        ? 'يمكنك اقتراح بدائل عامة أو توجيه العميل للتفضيلات دون ذكر أسماء/أسعار منتجات.'
        : 'You may suggest general alternatives or ask about preferences without naming/pricing products.'
    );
  }

  if (permissions.allowUpsell) {
    allowed.push(
      language === 'arabic'
        ? 'مسموح تقديم ترقية/إضافة قيمة بشكل عام (بدون تفاصيل منتجات).'
        : 'You may offer a general upgrade/add-on (without product details).'
    );
  }

  if (permissions.allowEmojis) {
    allowed.push(
      language === 'arabic'
        ? 'مسموح استخدام رموز تعبيرية بسيطة باعتدال.'
        : 'You may use simple emojis sparingly.'
    );
  }

  if (allowed.length === 0) {
    return '';
  }

  return language === 'arabic'
    ? `\nصلاحيات مسموحة:\n- ${allowed.join('\n- ')}`
    : `\nAllowed permissions:\n- ${allowed.join('\n- ')}`;
};
