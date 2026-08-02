import nodemailer from 'nodemailer';
import { logger } from './logger.js';

// Email configuration
const createTransporter = () => {
  // Use SMTP if configured, otherwise use Ethereal (for development)
  if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
    return nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || '587'),
      secure: process.env.SMTP_SECURE === 'true', // true for 465, false for other ports
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
  }

  // For development: use console logging
  return nodemailer.createTransport({
    streamTransport: true,
    newline: 'unix',
    buffer: true,
  });
};

const transporter = createTransporter();

// Get frontend URL
const getFrontendUrl = () => {
  return process.env.FRONTEND_URL || process.env.CORS_ORIGIN || 'https://xo-bot.com';
};

// Get app name
const getAppName = () => {
  return process.env.APP_NAME || 'Xo Bot';
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

    const mailOptions = {
      from: process.env.SMTP_FROM || `"${appName}" <noreply@example.com>`,
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

    // In development without SMTP, log the email
    if (!process.env.SMTP_HOST) {
      logger.info('Password reset email (development mode)', {
        to: email,
        resetLink,
      });
      console.log('\n📧 Password Reset Email (Development Mode):');
      console.log(`To: ${email}`);
      console.log(`Reset Link: ${resetLink}\n`);
      return true;
    }

    // Send email
    const info = await transporter.sendMail(mailOptions);
    logger.info('Password reset email sent', {
      to: email,
      messageId: info.messageId,
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

    const mailOptions = {
      from: process.env.SMTP_FROM || `"${appName}" <noreply@example.com>`,
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

    if (!process.env.SMTP_HOST) {
      logger.info('Welcome email (development mode)', { to: email, name });
      console.log(`\n📧 Welcome Email (Development Mode) to: ${email}\n`);
      return true;
    }

    const info = await transporter.sendMail(mailOptions);
    logger.info('Welcome email sent', { to: email, messageId: info.messageId });
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

  const mailOptions = {
    from: process.env.SMTP_FROM || `"${appName}" <noreply@example.com>`,
    subject,
    ...(isHtml ? {
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
    } : {
      text: message
    })
  };

  // Send emails in batches to avoid overwhelming the SMTP server
  const batchSize = 10;
  for (let i = 0; i < to.length; i += batchSize) {
    const batch = to.slice(i, i + batchSize);
    
    for (const email of batch) {
      try {
        const emailOptions = {
          ...mailOptions,
          to: email
        };

        if (!process.env.SMTP_HOST) {
          // Development mode: just log
          logger.info('Broadcast email (development mode)', { to: email, subject });
          console.log(`\n📧 Broadcast Email (Development Mode):`);
          console.log(`To: ${email}`);
          console.log(`Subject: ${subject}\n`);
          result.sent++;
        } else {
          const info = await transporter.sendMail(emailOptions);
          logger.info('Broadcast email sent', { to: email, messageId: info.messageId });
          result.sent++;
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        logger.error('Error sending broadcast email', error as Error, { email });
        result.failed++;
        result.errors.push(`${email}: ${errorMessage}`);
      }
    }

    // Small delay between batches to avoid rate limiting
    if (i + batchSize < to.length && process.env.SMTP_HOST) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  return result;
};

