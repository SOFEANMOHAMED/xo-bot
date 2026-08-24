import nodemailer from 'nodemailer';
import { logger } from './logger.js';
import {
  BRAND,
  XO_BOT_BENEFITS_AR,
  XO_BOT_FIRST_STEPS_AR,
  escapeHtml,
  getAppName,
  getFromAddress,
  getFrontendUrl,
  renderBrandedEmail,
  renderBulletList,
  renderInfoBox,
} from './emailBrand.js';
import { getOrderSourceLabel } from './orderSource.js';
import { formatOrderNotesForMerchant, formatVariantCaption } from '../orders/merchantOrderNotes.js';

type MailPayload = {
  from: string;
  to: string;
  subject: string;
  html?: string;
  text?: string;
};

const hasMailgunConfig = () =>
  Boolean(process.env.MAILGUN_API_KEY && process.env.MAILGUN_DOMAIN);

const hasSmtpConfig = () =>
  Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);

/** True when a real delivery channel is configured (not console-only). */
const isEmailDeliveryConfigured = () => hasMailgunConfig() || hasSmtpConfig();

const createTransporter = () => {
  if (hasSmtpConfig()) {
    return nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || '587'),
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
      connectionTimeout: 15000,
      greetingTimeout: 15000,
      socketTimeout: 20000,
    });
  }

  return nodemailer.createTransport({
    streamTransport: true,
    newline: 'unix',
    buffer: true,
  });
};

const transporter = createTransporter();

const sendViaMailgun = async (payload: MailPayload): Promise<string> => {
  const apiKey = process.env.MAILGUN_API_KEY!;
  const domain = process.env.MAILGUN_DOMAIN!;
  const apiBase = (process.env.MAILGUN_API_BASE || 'https://api.mailgun.net').replace(/\/$/, '');

  const body = new URLSearchParams();
  body.set('from', payload.from);
  body.set('to', payload.to);
  body.set('subject', payload.subject);
  if (payload.html) body.set('html', payload.html);
  if (payload.text) body.set('text', payload.text);

  const response = await fetch(`${apiBase}/v3/${domain}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`api:${apiKey}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });

  const raw = await response.text();
  let parsed: { id?: string; message?: string } = {};
  try {
    parsed = JSON.parse(raw) as { id?: string; message?: string };
  } catch {
    // non-JSON error body
  }

  if (!response.ok) {
    throw new Error(parsed.message || `Mailgun HTTP ${response.status}: ${raw.slice(0, 200)}`);
  }

  return parsed.id || 'mailgun-ok';
};

const sendMailMessage = async (payload: MailPayload): Promise<string> => {
  if (hasMailgunConfig()) {
    return sendViaMailgun(payload);
  }

  if (hasSmtpConfig()) {
    const info = await transporter.sendMail(payload);
    return info.messageId || 'smtp-ok';
  }

  throw new Error('Email delivery is not configured');
};

const deliverOrLog = async (
  mailOptions: MailPayload,
  logLabel: string,
  meta: Record<string, unknown>
): Promise<boolean> => {
  try {
    if (!isEmailDeliveryConfigured()) {
      logger.info(`${logLabel} (development mode)`, meta);
      console.log(`\n📧 ${logLabel} (Development Mode)`);
      console.log(`To: ${mailOptions.to}`);
      console.log(`Subject: ${mailOptions.subject}\n`);
      return true;
    }

    const messageId = await sendMailMessage(mailOptions);
    logger.info(`${logLabel} sent`, {
      ...meta,
      messageId,
      provider: hasMailgunConfig() ? 'mailgun' : 'smtp',
    });
    return true;
  } catch (error) {
    logger.error(`Error sending ${logLabel}`, error as Error, meta);
    return false;
  }
};

const greeting = (name?: string | null): string => {
  const trimmed = name?.trim();
  return trimmed ? escapeHtml(trimmed) : 'عزيزي التاجر';
};

const dashboardUrl = (): string => `${getFrontendUrl()}/app`;
const pricingUrl = (): string => `${getFrontendUrl()}/#pricing`;
const loginUrl = (): string => `${getFrontendUrl()}/login`;

/**
 * Send password reset email
 */
export const sendPasswordResetEmail = async (
  email: string,
  resetToken: string
): Promise<boolean> => {
  const frontendUrl = getFrontendUrl();
  const appName = getAppName();
  const resetLink = `${frontendUrl}/reset-password?token=${resetToken}`;

  const bodyHtml = `
    <p style="margin:0 0 14px;">مرحباً،</p>
    <p style="margin:0 0 14px;color:${BRAND.muted};">
      تلقّينا طلباً لإعادة تعيين كلمة المرور لحسابك في ${escapeHtml(appName)}.
      اضغط الزر أدناه لإكمال العملية.
    </p>
    ${renderInfoBox(
      `<p style="margin:0;color:${BRAND.text};font-size:14px;"><strong>ملاحظة:</strong> الرابط صالح لمدة ساعة واحدة. إن لم تطلب ذلك، يمكنك تجاهل هذه الرسالة بأمان.</p>`,
      'warn'
    )}
  `;

  const mailOptions: MailPayload = {
    from: getFromAddress(),
    to: email,
    subject: `إعادة تعيين كلمة المرور — ${appName}`,
    html: renderBrandedEmail({
      title: 'إعادة تعيين كلمة المرور',
      preheader: 'رابط آمن لإعادة تعيين كلمة مرورك',
      bodyHtml,
      ctaLabel: 'إعادة تعيين كلمة المرور',
      ctaUrl: resetLink,
    }),
    text: `إعادة تعيين كلمة المرور\n\nاستخدم الرابط التالي (صالح لمدة ساعة):\n${resetLink}`,
  };

  // Never log resetLink / token — only recipient
  return deliverOrLog(mailOptions, 'Password reset email', { to: email });
};

/**
 * Welcome email — sent on email signup and Google OAuth signup
 */
export const sendWelcomeEmail = async (
  email: string,
  name?: string | null
): Promise<boolean> => {
  const appName = getAppName();
  const bodyHtml = `
    <p style="margin:0 0 14px;">مرحباً ${greeting(name)}،</p>
    <p style="margin:0 0 14px;color:${BRAND.muted};">
      أهلاً بك في <strong style="color:${BRAND.text};">${escapeHtml(appName)}</strong> —
      بوت المبيعات الذكي لمتجرك على السوشيال ميديا.
    </p>
    <p style="margin:0 0 14px;color:${BRAND.muted};">
      لديك الآن <strong style="color:${BRAND.text};">7 أيام تجربة مجانية</strong> لاستكشاف المنصة
      وبدء الرد على عملائك وبيع منتجاتك تلقائياً.
    </p>
    ${renderInfoBox(
      `<p style="margin:0;color:${BRAND.text};font-size:14px;">سنرسل لك خلال الساعة القادمة دليلاً مختصراً لخطوات البدء الأولى.</p>`
    )}
  `;

  const mailOptions: MailPayload = {
    from: getFromAddress(),
    to: email,
    subject: `مرحباً بك في ${appName}`,
    html: renderBrandedEmail({
      title: 'مرحباً بك',
      preheader: 'بدأت تجربتك المجانية — جاهز للبيع بذكاء',
      bodyHtml,
      ctaLabel: 'الدخول إلى لوحة التحكم',
      ctaUrl: dashboardUrl(),
    }),
    text: `مرحباً بك في ${appName}\n\nلديك 7 أيام تجربة مجانية. ادخل لوحتك من: ${dashboardUrl()}`,
  };

  return deliverOrLog(mailOptions, 'Welcome email', { to: email, name });
};

/**
 * First steps — ~1 hour after signup
 */
export const sendOnboardingStepsEmail = async (
  email: string,
  name?: string | null
): Promise<boolean> => {
  const appName = getAppName();
  const bodyHtml = `
    <p style="margin:0 0 14px;">مرحباً ${greeting(name)}،</p>
    <p style="margin:0 0 14px;color:${BRAND.muted};">
      للبدء مع ${escapeHtml(appName)} بسرعة، اتبع هذه الخطوات الثلاث:
    </p>
    ${renderBulletList([...XO_BOT_FIRST_STEPS_AR])}
    <p style="margin:0;color:${BRAND.muted};">
      لا تحتاج خبرة تقنية — كل شيء من لوحة عربية بسيطة.
    </p>
  `;

  const mailOptions: MailPayload = {
    from: getFromAddress(),
    to: email,
    subject: `خطواتك الأولى مع ${appName}`,
    html: renderBrandedEmail({
      title: 'ابدأ في دقائق',
      preheader: 'ثلاث خطوات لتفعيل بوت المبيعات',
      bodyHtml,
      ctaLabel: 'ابدأ الآن',
      ctaUrl: dashboardUrl(),
    }),
    text: `خطواتك الأولى مع ${appName}\n\n${XO_BOT_FIRST_STEPS_AR.map((s, i) => `${i + 1}. ${s}`).join('\n')}\n\n${dashboardUrl()}`,
  };

  return deliverOrLog(mailOptions, 'Onboarding steps email', { to: email });
};

/**
 * Day 3 — encourage usage + benefits
 */
export const sendDay3EngagementEmail = async (
  email: string,
  name?: string | null
): Promise<boolean> => {
  const appName = getAppName();
  const bodyHtml = `
    <p style="margin:0 0 14px;">مرحباً ${greeting(name)}،</p>
    <p style="margin:0 0 14px;color:${BRAND.muted};">
      مرّت ثلاثة أيام على انضمامك إلى ${escapeHtml(appName)}.
      إن لم تُكمل الإعداد بعد، هذا وقت ممتاز لتفعيل البوت والاستفادة من تجربتك.
    </p>
    <p style="margin:0 0 8px;font-weight:700;color:${BRAND.text};">ماذا ستكسب؟</p>
    ${renderBulletList([...XO_BOT_BENEFITS_AR])}
  `;

  const mailOptions: MailPayload = {
    from: getFromAddress(),
    to: email,
    subject: `لا تفوّت فرصة البيع الآلي مع ${appName}`,
    html: renderBrandedEmail({
      title: 'فعّل بوتك اليوم',
      preheader: 'فوائد واضحة لتفعيل Xo Bot في متجرك',
      bodyHtml,
      ctaLabel: 'متابعة الإعداد',
      ctaUrl: dashboardUrl(),
    }),
    text: `فعّل ${appName}\n\n${XO_BOT_BENEFITS_AR.map((b) => `• ${b}`).join('\n')}\n\n${dashboardUrl()}`,
  };

  return deliverOrLog(mailOptions, 'Day 3 engagement email', { to: email });
};

/**
 * Day 6 — trial ending soon
 */
export const sendDay6TrialEndingEmail = async (
  email: string,
  name?: string | null,
  trialEndsAt?: Date | string | null
): Promise<boolean> => {
  const appName = getAppName();
  let endsLabel = 'قريباً';
  if (trialEndsAt) {
    const d = trialEndsAt instanceof Date ? trialEndsAt : new Date(trialEndsAt);
    if (!Number.isNaN(d.getTime())) {
      endsLabel = d.toLocaleDateString('ar-EG', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });
    }
  }

  const bodyHtml = `
    <p style="margin:0 0 14px;">مرحباً ${greeting(name)}،</p>
    <p style="margin:0 0 14px;color:${BRAND.muted};">
      تنتهي فترتك التجريبية في <strong style="color:${BRAND.text};">${escapeHtml(endsLabel)}</strong>.
      لا تفقد الردود الآلية والمبيعات التي يوفّرها ${escapeHtml(appName)}.
    </p>
    ${renderInfoBox(
      `<p style="margin:0;color:${BRAND.text};font-size:14px;">اشترك الآن لتستمر قنواتك (فيسبوك، إنستغرام، تيليجرام) دون انقطاع.</p>`,
      'warn'
    )}
    <p style="margin:16px 0 8px;font-weight:700;color:${BRAND.text};">لماذا يستمر التجار معنا؟</p>
    ${renderBulletList([...XO_BOT_BENEFITS_AR])}
  `;

  const mailOptions: MailPayload = {
    from: getFromAddress(),
    to: email,
    subject: `تجربتك في ${appName} تنتهي قريباً`,
    html: renderBrandedEmail({
      title: 'تنتهي تجربتك قريباً',
      preheader: `الفترة التجريبية حتى ${endsLabel}`,
      bodyHtml,
      ctaLabel: 'عرض الباقات',
      ctaUrl: pricingUrl(),
    }),
    text: `تجربتك تنتهي في ${endsLabel}\n\nعرض الباقات: ${pricingUrl()}`,
  };

  return deliverOrLog(mailOptions, 'Day 6 trial ending email', { to: email, endsLabel });
};

/**
 * After trial ends
 */
export const sendTrialEndedEmail = async (
  email: string,
  name?: string | null
): Promise<boolean> => {
  const appName = getAppName();
  const bodyHtml = `
    <p style="margin:0 0 14px;">مرحباً ${greeting(name)}،</p>
    <p style="margin:0 0 14px;color:${BRAND.muted};">
      انتهت فترتك التجريبية في ${escapeHtml(appName)}.
      يمكنك الاشتراك في أي وقت لاستعادة بوت المبيعات والرد على عملائك تلقائياً.
    </p>
    ${renderInfoBox(
      `<p style="margin:0 0 8px;font-weight:700;color:${BRAND.text};">باقات تناسب مرحلتك</p>
       <p style="margin:0;color:${BRAND.muted};font-size:14px;">من رد التعليقات فقط إلى بوت مبيعات على واتساب وفيسبوك وإنستغرام وتيليجرام.</p>`
    )}
    <p style="margin:16px 0 0;color:${BRAND.muted};">
      بيانات متجرك محفوظة — الاشتراك يعيد تفعيل الخدمة فوراً.
    </p>
  `;

  const mailOptions: MailPayload = {
    from: getFromAddress(),
    to: email,
    subject: `انتهت تجربتك في ${appName}`,
    html: renderBrandedEmail({
      title: 'انتهت الفترة التجريبية',
      preheader: 'اشترك لاستعادة بوت المبيعات',
      bodyHtml,
      ctaLabel: 'الاشتراك الآن',
      ctaUrl: pricingUrl(),
    }),
    text: `انتهت تجربتك في ${appName}\n\nاشترك من: ${pricingUrl()}\nأو سجّل الدخول: ${loginUrl()}`,
  };

  return deliverOrLog(mailOptions, 'Trial ended email', { to: email });
};

/**
 * Send broadcast email to multiple recipients
 */
export const sendBroadcastEmail = async (
  to: string[],
  subject: string,
  message: string,
  isHtml: boolean = true
): Promise<{ sent: number; failed: number; errors: string[] }> => {
  const result = { sent: 0, failed: 0, errors: [] as string[] };
  const appName = getAppName();

  if (!to || to.length === 0) {
    result.errors.push('لا توجد عناوين بريد إلكتروني للإرسال');
    return result;
  }

  const bodyInner = isHtml
    ? message
    : `<p style="white-space:pre-wrap;margin:0;color:${BRAND.muted};">${escapeHtml(message)}</p>`;

  const htmlBody = renderBrandedEmail({
    title: subject,
    bodyHtml: bodyInner,
    footerNote: `رسالة من فريق ${appName}`,
  });

  const batchSize = 10;
  for (let i = 0; i < to.length; i += batchSize) {
    const batch = to.slice(i, i + batchSize);

    for (const email of batch) {
      try {
        if (!isEmailDeliveryConfigured()) {
          logger.info('Broadcast email (development mode)', { to: email, subject });
          console.log(`\n📧 Broadcast Email (Development Mode):\nTo: ${email}\nSubject: ${subject}\n`);
          result.sent++;
          continue;
        }

        const messageId = await sendMailMessage({
          from: getFromAddress(),
          to: email,
          subject,
          html: htmlBody,
        });
        logger.info('Broadcast email sent', {
          to: email,
          messageId,
          provider: hasMailgunConfig() ? 'mailgun' : 'smtp',
        });
        result.sent++;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        logger.error('Error sending broadcast email', error as Error, { email });
        result.failed++;
        result.errors.push(`${email}: ${errorMessage}`);
      }
    }

    if (i + batchSize < to.length && isEmailDeliveryConfigured()) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  return result;
};

export type NewOrderEmailItem = {
  productName: string;
  quantity: number;
  price: number;
  color?: string | null;
  size?: string | null;
};

export type NewOrderEmailPayload = {
  orderId: string;
  customerName?: string | null;
  customerPhone?: string | null;
  customerEmail?: string | null;
  customerAddress?: string | null;
  deliveryTime?: string | null;
  notes?: string | null;
  total: number;
  currency: string;
  source?: string | null;
  items: NewOrderEmailItem[];
};

const formatMoney = (amount: number, currency: string): string => {
  const safeCurrency = (currency || 'USD').toUpperCase();
  try {
    return new Intl.NumberFormat('ar-EG', {
      style: 'currency',
      currency: safeCurrency,
      maximumFractionDigits: 2,
    }).format(amount || 0);
  } catch {
    return `${(amount || 0).toFixed(2)} ${safeCurrency}`;
  }
};

/**
 * Notify merchant by email when a new order is created
 */
export const sendNewOrderEmail = async (
  merchantEmail: string,
  merchantName: string | null | undefined,
  order: NewOrderEmailPayload
): Promise<boolean> => {
  const appName = getAppName();
  const ordersUrl = `${getFrontendUrl()}/app/orders`;
  const shortId = order.orderId.length > 8 ? order.orderId.slice(0, 8) : order.orderId;
  const currency = order.currency || 'USD';

  const itemsRows =
    order.items?.length > 0
      ? order.items
          .map((item) => {
            const lineTotal = (item.price || 0) * (item.quantity || 1);
            const variant = formatVariantCaption(item.color, item.size);
            const nameHtml = variant
              ? `${escapeHtml(item.productName || 'منتج')}<div style="font-size:12px;color:${BRAND.muted};font-weight:400;margin-top:2px;">${escapeHtml(variant)}</div>`
              : escapeHtml(item.productName || 'منتج');
            return `
              <tr>
                <td style="padding:10px 8px;border-bottom:1px solid ${BRAND.border};">${nameHtml}</td>
                <td style="padding:10px 8px;border-bottom:1px solid ${BRAND.border};text-align:center;">${item.quantity || 1}</td>
                <td style="padding:10px 8px;border-bottom:1px solid ${BRAND.border};text-align:left;">${escapeHtml(formatMoney(lineTotal, currency))}</td>
              </tr>`;
          })
          .join('')
      : `
          <tr>
            <td colspan="3" style="padding:10px 8px;color:${BRAND.muted};">لا توجد تفاصيل منتجات</td>
          </tr>`;

  const detailRow = (label: string, value?: string | null) => {
    if (!value || !String(value).trim()) return '';
    return `
      <tr>
        <td style="padding:6px 0;color:${BRAND.muted};width:35%;vertical-align:top;">${escapeHtml(label)}</td>
        <td style="padding:6px 0;color:${BRAND.text};font-weight:600;white-space:pre-line;">${escapeHtml(String(value))}</td>
      </tr>`;
  };

  const sourceLabel = getOrderSourceLabel(order.source, order.notes);

  const bodyHtml = `
    <p style="margin:0 0 14px;">مرحباً ${greeting(merchantName)}،</p>
    <p style="margin:0 0 18px;color:${BRAND.muted};">
      وصلك طلب جديد عبر ${escapeHtml(sourceLabel)}. رقم الطلب: <strong style="color:${BRAND.text};">#${escapeHtml(shortId)}</strong>
    </p>
    <table style="width:100%;border-collapse:collapse;margin-bottom:18px;">
      ${detailRow('اسم العميل', order.customerName)}
      ${detailRow('الهاتف', order.customerPhone)}
      ${detailRow(
        'البريد',
        order.customerEmail && !String(order.customerEmail).endsWith('@chat-order.com')
          ? order.customerEmail
          : null
      )}
      ${detailRow('العنوان', order.customerAddress)}
      ${detailRow('وقت التوصيل', order.deliveryTime)}
      ${detailRow('ملاحظات', formatOrderNotesForMerchant(order.notes))}
    </table>
    <table style="width:100%;border-collapse:collapse;background:${BRAND.soft};border-radius:12px;overflow:hidden;margin-bottom:16px;">
      <thead>
        <tr style="background:${BRAND.softBorder};">
          <th style="padding:10px 8px;text-align:right;font-size:13px;color:${BRAND.primaryDark};">المنتج</th>
          <th style="padding:10px 8px;text-align:center;font-size:13px;color:${BRAND.primaryDark};">الكمية</th>
          <th style="padding:10px 8px;text-align:left;font-size:13px;color:${BRAND.primaryDark};">السعر</th>
        </tr>
      </thead>
      <tbody>${itemsRows}</tbody>
    </table>
    <p style="margin:0;font-size:18px;font-weight:700;color:${BRAND.text};">
      الإجمالي: ${escapeHtml(formatMoney(order.total || 0, currency))}
    </p>
  `;

  const mailOptions: MailPayload = {
    from: getFromAddress(),
    to: merchantEmail,
    subject: `طلب جديد #${shortId} — ${appName}`,
    html: renderBrandedEmail({
      title: `طلب جديد #${shortId}`,
      preheader: `طلب من ${order.customerName || 'عميل'} — ${formatMoney(order.total || 0, currency)}`,
      bodyHtml,
      ctaLabel: 'عرض الطلبات',
      ctaUrl: ordersUrl,
    }),
    text: `طلب جديد #${shortId}\nالعميل: ${order.customerName || '-'}\nالهاتف: ${order.customerPhone || '-'}\nالإجمالي: ${formatMoney(order.total || 0, currency)}\n${ordersUrl}`,
  };

  return deliverOrLog(mailOptions, 'New order email', {
    to: merchantEmail,
    orderId: order.orderId,
  });
};
