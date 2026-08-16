/**
 * Shared Xo Bot email chrome — brand orange (#FF9A00), RTL Arabic.
 */

export const BRAND = {
  primary: '#FF9A00',
  primaryDark: '#E68A00',
  soft: '#FFF8EB',
  softBorder: '#FFDB99',
  text: '#0f172a',
  muted: '#64748b',
  border: '#e2e8f0',
  white: '#ffffff',
  successBg: '#ecfdf5',
  successBorder: '#6ee7b7',
  warnBg: '#FFF8EB',
  warnBorder: '#FFAD33',
} as const;

export const getFrontendUrl = (): string =>
  (process.env.FRONTEND_URL || process.env.CORS_ORIGIN || 'https://xo-bot.com').replace(/\/$/, '');

export const getAppName = (): string => process.env.APP_NAME || 'Xo Bot';

export const getFromAddress = (): string => {
  const appName = getAppName();
  return process.env.SMTP_FROM || `"${appName}" <noreply@xo-bot.com>`;
};

export const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

export type BrandedEmailOptions = {
  title: string;
  preheader?: string;
  bodyHtml: string;
  ctaLabel?: string;
  ctaUrl?: string;
  footerNote?: string;
};

/**
 * Full HTML document with Xo Bot visual identity.
 */
export function renderBrandedEmail(options: BrandedEmailOptions): string {
  const appName = getAppName();
  const year = new Date().getFullYear();
  const preheader = options.preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(options.preheader)}</div>`
    : '';

  const cta =
    options.ctaLabel && options.ctaUrl
      ? `
        <div style="text-align:center;margin:28px 0 8px;">
          <a href="${escapeHtml(options.ctaUrl)}"
             style="display:inline-block;background:${BRAND.primary};color:${BRAND.white};text-decoration:none;padding:14px 28px;border-radius:12px;font-weight:700;font-size:15px;">
            ${escapeHtml(options.ctaLabel)}
          </a>
        </div>
        <p style="margin:10px 0 0;font-size:12px;color:${BRAND.muted};text-align:center;word-break:break-all;line-height:1.5;">
          أو افتح الرابط:<br/>${escapeHtml(options.ctaUrl)}
        </p>`
      : '';

  return `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(options.title)}</title>
</head>
<body style="margin:0;padding:0;background:${BRAND.soft};font-family:'Segoe UI','Tahoma','Cairo',Geneva,Verdana,sans-serif;">
  ${preheader}
  <div style="max-width:600px;margin:24px auto;padding:0 12px;">
    <div style="background:${BRAND.white};border-radius:16px;overflow:hidden;border:1px solid ${BRAND.softBorder};box-shadow:0 8px 24px rgba(255,154,0,0.08);">
      <div style="background:linear-gradient(135deg,${BRAND.primary} 0%,${BRAND.primaryDark} 100%);padding:22px 28px;">
        <div style="font-size:22px;font-weight:800;color:${BRAND.white};letter-spacing:-0.02em;">
          Xo <span style="opacity:0.95;">Bot</span>
        </div>
        <div style="margin-top:4px;font-size:13px;color:rgba(255,255,255,0.9);">${escapeHtml(options.title)}</div>
      </div>
      <div style="padding:28px;color:${BRAND.text};font-size:15px;line-height:1.75;">
        ${options.bodyHtml}
        ${cta}
      </div>
      <div style="padding:16px 28px;background:${BRAND.soft};border-top:1px solid ${BRAND.softBorder};text-align:center;font-size:12px;color:${BRAND.muted};line-height:1.6;">
        ${options.footerNote ? `<p style="margin:0 0 8px;">${escapeHtml(options.footerNote)}</p>` : ''}
        <p style="margin:0;">© ${year} ${escapeHtml(appName)}. جميع الحقوق محفوظة.</p>
        <p style="margin:4px 0 0;">رسالة تلقائية — يُفضّل عدم الرد على هذا البريد.</p>
      </div>
    </div>
  </div>
</body>
</html>`;
}

export function renderBulletList(items: string[]): string {
  const lis = items
    .map(
      (item) =>
        `<li style="margin:0 0 10px;padding-right:4px;">${escapeHtml(item)}</li>`
    )
    .join('');
  return `<ul style="margin:12px 0 20px;padding-right:20px;color:${BRAND.text};">${lis}</ul>`;
}

export function renderInfoBox(html: string, variant: 'soft' | 'warn' = 'soft'): string {
  const bg = variant === 'warn' ? BRAND.warnBg : BRAND.soft;
  const border = variant === 'warn' ? BRAND.warnBorder : BRAND.softBorder;
  return `<div style="background:${bg};border:1px solid ${border};border-radius:12px;padding:14px 16px;margin:18px 0;">${html}</div>`;
}

/** Shared product benefits used across lifecycle emails */
export const XO_BOT_BENEFITS_AR = [
  'بوت مبيعات يرد على عملائك بلهجة عربية طبيعية على مدار الساعة',
  'العمل على فيسبوك ماسنجر، إنستغرام، وتيليجرام من لوحة واحدة',
  'تحويل تعليقات المنشورات إلى محادثات بيع تلقائياً',
  'إدارة المنتجات والطلبات وصندوق وارد موحّد',
  'عزل كامل لبيانات متجرك عن بقية التجار',
] as const;

export const XO_BOT_FIRST_STEPS_AR = [
  'أضف منتجاتك يدوياً أو عبر ملف Excel من صفحة إدارة المنتجات',
  'جرّب البوت داخل اللوحة للتأكد من أسلوب الرد قبل الربط',
  'اربط قناة فيسبوك أو إنستغرام أو تيليجرام من صفحة الربط والتكامل',
] as const;
