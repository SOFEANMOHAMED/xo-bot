/**
 * PHASE 1A — recovered verification cases M24–M35 (KNOWN_PENDING on current main).
 * Spec source: backend/dist.bak-20260920T212631Z/.../test_verification_matrix.js
 * Run: npm run test-verification-matrix-pending
 *
 * These cases require exports that are not on main yet (validateCatalogReplyGrounding
 * reasons, isExplicitHumanHandoffRequest, mergeGroundedSalesMemoryNotes, spoken-tone
 * copy, prompt version salesgpt-2026-09-20.2, etc.). They FAIL deliberately and are
 * allow-listed as KNOWN_PENDING — never counted as PASS.
 */

type PendingCase = {
  id: string;
  scenario: string;
  requiredCapability: string;
};

const PENDING_CASES: readonly PendingCase[] = [
  {
    id: 'M24',
    scenario: 'Grounding عام — عبارة عدم التوفر لا تسمح بسعر مختلق',
    requiredCapability: 'violatesCatalogPriceGrounding',
  },
  {
    id: 'M25',
    scenario: 'طلب موظف بشري يُكتشف بدون الاعتماد على LLM',
    requiredCapability: 'isExplicitHumanHandoffRequest',
  },
  {
    id: 'M26',
    scenario: 'ذاكرة العميل تحفظ المعلومة الصريحة وترفض الاستنتاج المختلق',
    requiredCapability: 'mergeGroundedSalesMemoryNotes',
  },
  {
    id: 'M27',
    scenario: 'مدقق الادعاءات يرفض اللون والمقاس والميزة والمخزون المختلق',
    requiredCapability: 'validateCatalogReplyGrounding (false_stock_claim / ungrounded_*)',
  },
  {
    id: 'M28',
    scenario: 'وضع الخدمات لا يمر إلى كتالوج المنتجات أو النموذج',
    requiredCapability: 'requiresServiceCatalogHandoff',
  },
  {
    id: 'M29',
    scenario: 'إعدادات البيع وحقن تعليمات التاجر تُطبّق فعلياً',
    requiredCapability: 'enable_ai_injection / salesSettings mapping',
  },
  {
    id: 'M30',
    scenario: 'سياسات الشحن والدفع لا تُخترع عند غياب المصدر',
    requiredCapability: 'validateCatalogReplyGrounding unsupported_policy_claim',
  },
  {
    id: 'M31',
    scenario: 'نبرة منطوقة — لا «اكتب نعم» ولا قوالب ✅ في السلة/التأكيد',
    requiredCapability: 'spoken tone templates + formatCustomerOrderNumber',
  },
  {
    id: 'M32',
    scenario: 'هوية موظف باسم أول — لا «مساعد المتجر» ولا اعتراف استباقي أنه بوت',
    requiredCapability: 'resolveSalespersonName + SALESGPT_PROMPT_VERSION salesgpt-2026-09-20.2',
  },
  {
    id: 'M33',
    scenario: 'كلمات تفضيل ناعمة لا تقود بحث كتالوج خاطئ',
    requiredCapability: 'catalogSearchKeywordsFromMessage / shouldSuppressCatalogKeywordSearch',
  },
  {
    id: 'M34',
    scenario: 'عدم تطابق — ادعاء «عندنا X» لصنف العميل المخترع يُرفض',
    requiredCapability: 'violatesNoMatchGrounding with customerMessage context',
  },
  {
    id: 'M35',
    scenario: 'ذاكرة صريحة من الرسالة بدون انتظار النموذج + الإبقاء عبر الأدوار',
    requiredCapability: 'mergeGroundedSalesMemoryNotes from raw message',
  },
];

let failed = 0;

for (const row of PENDING_CASES) {
  failed += 1;
  console.error(
    `FAIL ${row.id} ${row.scenario}: required capability missing on main — ${row.requiredCapability}`,
  );
}

console.log(`Pending matrix: 0 passed, ${failed} failed (of ${PENDING_CASES.length})`);
console.error(
  'KNOWN_PENDING: recovered M24–M35 require SalesGPT slices absent from current main (see bak test_verification_matrix.js)',
);
process.exit(1);
