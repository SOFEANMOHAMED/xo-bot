import nodemailer from 'nodemailer';
import { logger } from './logger.js';

type MailPayload = {
  from: string;
  to: string;
  subject: string;
  html?: string;
  text?: string;
};

const getFrontendUrl = () => {
  return process.env.FRONTEND_URL || process.env.CORS_ORIGIN || 'https://xo-bot.com';
};

const getAppName = () => {
  return process.env.APP_NAME || 'Xo Bot';
};

const getFromAddress = () => {
  const appName = getAppName();
  return process.env.SMTP_FROM || `"${appName}" <noreply@xo-bot.com>`;
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

/**
 * Prefer Mailgun HTTP API (works when outbound SMTP ports are blocked).
 * Fall back to SMTP when Mailgun is not configured.
 */
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

/**
 * Send password reset email
 */
export const sendPasswordResetEmail = async (
  email: string,
  resetToken: string
): Promise<boolean> => {
  try {
    const frontendUrl = getFrontendUrl();
    const appName = getAppName();
    const resetLink = `${frontendUrl}/reset-password?token=${resetToken}`;

    const mailOptions: MailPayload = {
      from: getFromAddress(),
      to: email,
      subject: 'إعادة تعيين كلمة المرور - Password Reset',
      html: `
        <!DOCTYPE html>
        <html dir="rtl" lang="ar">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <style>
            body {
              font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
              line-height: 1.6;
              color: #333;
              max-width: 600px;
              margin: 0 auto;
              padding: 20px;
              background-color: #f4f4f4;
            }
            .container {
              background-color: #ffffff;
              border-radius: 10px;
              padding: 30px;
              box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            }
            .header {
              text-align: center;
              margin-bottom: 30px;
            }
            .logo {
              font-size: 24px;
              font-weight: bold;
              color: #6366f1;
              margin-bottom: 10px;
            }
            .button {
              display: inline-block;
              padding: 12px 30px;
              background-color: #6366f1;
              color: #ffffff;
              text-decoration: none;
              border-radius: 5px;
              margin: 20px 0;
              text-align: center;
            }
            .button:hover {
              background-color: #4f46e5;
            }
            .footer {
              margin-top: 30px;
              padding-top: 20px;
              border-top: 1px solid #e5e7eb;
              font-size: 12px;
              color: #6b7280;
              text-align: center;
            }
            .warning {
              background-color: #fef3c7;
              border-right: 4px solid #f59e0b;
              padding: 15px;
              margin: 20px 0;
              border-radius: 5px;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <div class="logo">${appName}</div>
            </div>
            
            <h2>إعادة تعيين كلمة المرور</h2>
            <p>مرحباً،</p>
            <p>لقد طلبت إعادة تعيين كلمة المرور لحسابك. اضغط على الزر أدناه لإعادة تعيين كلمة المرور:</p>
            
            <div style="text-align: center;">
              <a href="${resetLink}" class="button">إعادة تعيين كلمة المرور</a>
            </div>
            
            <p>أو انسخ الرابط التالي إلى المتصفح:</p>
            <p style="word-break: break-all; color: #6366f1;">${resetLink}</p>
            
            <div class="warning">
              <strong>⚠️ تحذير:</strong> هذا الرابط صالح لمدة ساعة واحدة فقط. إذا لم تطلب إعادة تعيين كلمة المرور، يمكنك تجاهل هذا الإيميل.
            </div>
            
            <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 30px 0;">
            
            <h2>Password Reset</h2>
            <p>Hello,</p>
            <p>You requested to reset your password. Click the button below to reset your password:</p>
            
            <div style="text-align: center;">
              <a href="${resetLink}" class="button">Reset Password</a>
            </div>
            
            <p>Or copy this link to your browser:</p>
            <p style="word-break: break-all; color: #6366f1;">${resetLink}</p>
            
            <div class="warning">
              <strong>⚠️ Warning:</strong> This link is valid for 1 hour only. If you didn't request a password reset, you can ignore this email.
            </div>
            
            <div class="footer">
              <p>© ${new Date().getFullYear()} ${appName}. All rights reserved.</p>
              <p>This is an automated email, please do not reply.</p>
            </div>
          </div>
        </body>
        </html>
      `,
      text: `
        إعادة تعيين كلمة المرور - Password Reset
        
        مرحباً،
        لقد طلبت إعادة تعيين كلمة المرور. استخدم الرابط التالي:
        ${resetLink}
        
        هذا الرابط صالح لمدة ساعة واحدة فقط.
        
        ---
        
        Hello,
        You requested to reset your password. Use the following link:
        ${resetLink}
        
        This link is valid for 1 hour only.
      `,
    };

    if (!isEmailDeliveryConfigured()) {
      logger.info('Password reset email (development mode)', {
        to: email,
        resetLink,
      });
      console.log('\n📧 Password Reset Email (Development Mode):');
      console.log(`To: ${email}`);
      console.log(`Reset Link: ${resetLink}\n`);
      return true;
    }

    const messageId = await sendMailMessage(mailOptions);
    logger.info('Password reset email sent', {
      to: email,
      messageId,
      provider: hasMailgunConfig() ? 'mailgun' : 'smtp',
    });

    return true;
  } catch (error) {
    logger.error('Error sending password reset email', error as Error, { email });
    return false;
  }
};

/**
 * Send welcome email
 */
export const sendWelcomeEmail = async (
  email: string,
  name?: string
): Promise<boolean> => {
  try {
    const appName = getAppName();
    const frontendUrl = getFrontendUrl();

    const mailOptions: MailPayload = {
      from: getFromAddress(),
      to: email,
      subject: `مرحباً بك في ${appName} - Welcome to ${appName}`,
      html: `
        <!DOCTYPE html>
        <html dir="rtl" lang="ar">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <style>
            body {
              font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
              line-height: 1.6;
              color: #333;
              max-width: 600px;
              margin: 0 auto;
              padding: 20px;
              background-color: #f4f4f4;
            }
            .container {
              background-color: #ffffff;
              border-radius: 10px;
              padding: 30px;
              box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            }
            .header {
              text-align: center;
              margin-bottom: 30px;
            }
            .logo {
              font-size: 24px;
              font-weight: bold;
              color: #6366f1;
              margin-bottom: 10px;
            }
            .button {
              display: inline-block;
              padding: 12px 30px;
              background-color: #6366f1;
              color: #ffffff;
              text-decoration: none;
              border-radius: 5px;
              margin: 20px 0;
              text-align: center;
            }
            .footer {
              margin-top: 30px;
              padding-top: 20px;
              border-top: 1px solid #e5e7eb;
              font-size: 12px;
              color: #6b7280;
              text-align: center;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <div class="logo">${appName}</div>
            </div>
            
            <h2>مرحباً ${name || 'بك'}! 👋</h2>
            <p>شكراً لك على الانضمام إلى ${appName}. نحن سعداء بوجودك معنا!</p>
            <p>يمكنك الآن البدء في استخدام منصتنا لإدارة متجرك الذكي.</p>
            
            <div style="text-align: center;">
              <a href="${frontendUrl}/login" class="button">تسجيل الدخول</a>
            </div>
            
            <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 30px 0;">
            
            <h2>Welcome ${name || ''}! 👋</h2>
            <p>Thank you for joining ${appName}. We're excited to have you!</p>
            <p>You can now start using our platform to manage your smart store.</p>
            
            <div style="text-align: center;">
              <a href="${frontendUrl}/login" class="button">Login</a>
            </div>
            
            <div class="footer">
              <p>© ${new Date().getFullYear()} ${appName}. All rights reserved.</p>
            </div>
          </div>
        </body>
        </html>
      `,
    };

    if (!isEmailDeliveryConfigured()) {
      logger.info('Welcome email (development mode)', { to: email, name });
      console.log(`\n📧 Welcome Email (Development Mode) to: ${email}\n`);
      return true;
    }

    const messageId = await sendMailMessage(mailOptions);
    logger.info('Welcome email sent', {
      to: email,
      messageId,
      provider: hasMailgunConfig() ? 'mailgun' : 'smtp',
    });
    return true;
  } catch (error) {
    logger.error('Error sending welcome email', error as Error, { email });
    return false;
  }
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

  const htmlBody = isHtml
    ? `
        <!DOCTYPE html>
        <html dir="rtl" lang="ar">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <style>
            body {
              font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
              line-height: 1.6;
              color: #333;
              max-width: 600px;
              margin: 0 auto;
              padding: 20px;
              background-color: #f4f4f4;
            }
            .container {
              background-color: #ffffff;
              border-radius: 10px;
              padding: 30px;
              box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            }
            .header {
              text-align: center;
              margin-bottom: 30px;
            }
            .logo {
              font-size: 24px;
              font-weight: bold;
              color: #6366f1;
              margin-bottom: 10px;
            }
            .footer {
              margin-top: 30px;
              padding-top: 20px;
              border-top: 1px solid #e5e7eb;
              font-size: 12px;
              color: #6b7280;
              text-align: center;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <div class="logo">${appName}</div>
            </div>
            <div>
              ${message}
            </div>
            <div class="footer">
              <p>© ${new Date().getFullYear()} ${appName}. All rights reserved.</p>
              <p>This is an automated email, please do not reply.</p>
            </div>
          </div>
        </body>
        </html>
      `
    : undefined;

  const batchSize = 10;
  for (let i = 0; i < to.length; i += batchSize) {
    const batch = to.slice(i, i + batchSize);

    for (const email of batch) {
      try {
        if (!isEmailDeliveryConfigured()) {
          logger.info('Broadcast email (development mode)', { to: email, subject });
          console.log(`\n📧 Broadcast Email (Development Mode):`);
          console.log(`To: ${email}`);
          console.log(`Subject: ${subject}\n`);
          result.sent++;
          continue;
        }

        const messageId = await sendMailMessage({
          from: getFromAddress(),
          to: email,
          subject,
          ...(isHtml ? { html: htmlBody } : { text: message }),
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
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  return result;
};

export type NewOrderEmailItem = {
  productName: string;
  quantity: number;
  price: number;
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

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

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
  try {
    const appName = getAppName();
    const frontendUrl = getFrontendUrl().replace(/\/$/, '');
    const ordersUrl = `${frontendUrl}/app/orders`;
    const shortId = order.orderId.length > 8 ? order.orderId.slice(0, 8) : order.orderId;
    const currency = order.currency || 'USD';
    const greetingName = merchantName?.trim() || 'عزيزي التاجر';

    const itemsRows =
      order.items?.length > 0
        ? order.items
            .map((item) => {
              const lineTotal = (item.price || 0) * (item.quantity || 1);
              return `
                <tr>
                  <td style="padding:10px 8px;border-bottom:1px solid #e5e7eb;">${escapeHtml(item.productName || 'منتج')}</td>
                  <td style="padding:10px 8px;border-bottom:1px solid #e5e7eb;text-align:center;">${item.quantity || 1}</td>
                  <td style="padding:10px 8px;border-bottom:1px solid #e5e7eb;text-align:left;">${escapeHtml(formatMoney(lineTotal, currency))}</td>
                </tr>`;
            })
            .join('')
        : `
            <tr>
              <td colspan="3" style="padding:10px 8px;color:#6b7280;">لا توجد تفاصيل منتجات</td>
            </tr>`;

    const detailRow = (label: string, value?: string | null) => {
      if (!value || !String(value).trim()) return '';
      return `
        <tr>
          <td style="padding:6px 0;color:#6b7280;width:35%;vertical-align:top;">${escapeHtml(label)}</td>
          <td style="padding:6px 0;color:#111827;font-weight:600;">${escapeHtml(String(value))}</td>
        </tr>`;
    };

    const sourceLabel =
      order.source === 'shopify'
        ? 'Shopify'
        : order.source === 'bot' || order.source === 'whatsapp' || order.source === 'facebook' || order.source === 'telegram' || order.source === 'instagram'
          ? 'بوت المحادثة'
          : order.source || 'المنصة';

    const mailOptions: MailPayload = {
      from: getFromAddress(),
      to: merchantEmail,
      subject: `طلب جديد #${shortId} — ${appName}`,
      html: `
        <!DOCTYPE html>
        <html dir="rtl" lang="ar">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body style="margin:0;padding:0;background:#f4f4f5;font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif;">
          <div style="max-width:600px;margin:24px auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.06);">
            <div style="background:#4f46e5;padding:24px 28px;color:#fff;">
              <div style="font-size:14px;opacity:0.9;">${escapeHtml(appName)}</div>
              <h1 style="margin:8px 0 0;font-size:22px;">طلب جديد #${escapeHtml(shortId)}</h1>
            </div>
            <div style="padding:28px;">
              <p style="margin:0 0 16px;color:#374151;line-height:1.6;">مرحباً ${escapeHtml(greetingName)}،</p>
              <p style="margin:0 0 20px;color:#374151;line-height:1.6;">وصلك طلب جديد عبر ${escapeHtml(sourceLabel)}. تفاصيل الطلب:</p>

              <table style="width:100%;border-collapse:collapse;margin-bottom:20px;">
                ${detailRow('اسم العميل', order.customerName)}
                ${detailRow('الهاتف', order.customerPhone)}
                ${detailRow('البريد', order.customerEmail && !String(order.customerEmail).endsWith('@chat-order.com') ? order.customerEmail : null)}
                ${detailRow('العنوان', order.customerAddress)}
                ${detailRow('وقت التوصيل', order.deliveryTime)}
                ${detailRow('ملاحظات', order.notes)}
              </table>

              <table style="width:100%;border-collapse:collapse;background:#f9fafb;border-radius:8px;overflow:hidden;margin-bottom:16px;">
                <thead>
                  <tr style="background:#eef2ff;">
                    <th style="padding:10px 8px;text-align:right;font-size:13px;color:#4338ca;">المنتج</th>
                    <th style="padding:10px 8px;text-align:center;font-size:13px;color:#4338ca;">الكمية</th>
                    <th style="padding:10px 8px;text-align:left;font-size:13px;color:#4338ca;">السعر</th>
                  </tr>
                </thead>
                <tbody>
                  ${itemsRows}
                </tbody>
              </table>

              <p style="margin:0 0 24px;font-size:18px;font-weight:700;color:#111827;">
                الإجمالي: ${escapeHtml(formatMoney(order.total || 0, currency))}
              </p>

              <div style="text-align:center;margin:28px 0 8px;">
                <a href="${ordersUrl}" style="display:inline-block;background:#4f46e5;color:#ffffff;text-decoration:none;padding:14px 28px;border-radius:8px;font-weight:700;">
                  عرض الطلبات
                </a>
              </div>
              <p style="margin:12px 0 0;font-size:12px;color:#9ca3af;text-align:center;word-break:break-all;">
                أو افتح: ${escapeHtml(ordersUrl)}
              </p>
            </div>
            <div style="padding:16px 28px;border-top:1px solid #e5e7eb;text-align:center;font-size:12px;color:#9ca3af;">
              © ${new Date().getFullYear()} ${escapeHtml(appName)}
            </div>
          </div>
        </body>
        </html>
      `,
      text: `
طلب جديد #${shortId}

العميل: ${order.customerName || '-'}
الهاتف: ${order.customerPhone || '-'}
العنوان: ${order.customerAddress || '-'}
الإجمالي: ${formatMoney(order.total || 0, currency)}

عرض الطلبات: ${ordersUrl}
      `.trim(),
    };

    if (!isEmailDeliveryConfigured()) {
      logger.info('New order email (development mode)', {
        to: merchantEmail,
        orderId: order.orderId,
        ordersUrl,
      });
      return true;
    }

    const messageId = await sendMailMessage(mailOptions);
    logger.info('New order email sent', {
      to: merchantEmail,
      orderId: order.orderId,
      messageId,
      provider: hasMailgunConfig() ? 'mailgun' : 'smtp',
    });
    return true;
  } catch (error) {
    logger.error('Error sending new order email', error as Error, {
      merchantEmail,
      orderId: order.orderId,
    });
    return false;
  }
};
