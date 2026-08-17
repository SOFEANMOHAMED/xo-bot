/**
 * Script to create a super admin user
 * Run with: npx tsx src/database/create-super-admin.ts
 */

import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import pool from './connection.js';

dotenv.config();

async function createSuperAdmin() {
  // Require explicit env — never fall back to weak defaults
  if (!process.env.SUPER_ADMIN_EMAIL?.trim() || !process.env.SUPER_ADMIN_PASSWORD?.trim()) {
    console.error('❌ SUPER_ADMIN_EMAIL and SUPER_ADMIN_PASSWORD must be set in the environment');
    process.exit(1);
  }

  // تطبيع البريد مثل مسار تسجيل الدخول؛ قصّ المسافات من كلمة المرور في .env لتفادي أخطاء النسخ
  const email = process.env.SUPER_ADMIN_EMAIL.trim().toLowerCase();
  const password = process.env.SUPER_ADMIN_PASSWORD.trim();
  const name = (process.env.SUPER_ADMIN_NAME || 'Super Admin').trim() || 'Super Admin';

  try {
    const existing = await pool.query(
      'SELECT id FROM merchants WHERE LOWER(TRIM(email)) = $1',
      [email]
    );

    if (existing.rows.length > 0) {
      // Update existing user to owner (مطابقة البريد بدون حساسية لحالة الأحرف)
      const saltRounds = 10;
      const passwordHash = await bcrypt.hash(password, saltRounds);
      
      await pool.query(
        `UPDATE merchants 
         SET role = 'owner', 
             password_hash = $1,
             name = $2,
             email = $4,
             updated_at = CURRENT_TIMESTAMP
         WHERE LOWER(TRIM(email)) = $3`,
        [passwordHash, name, email, email]
      );
      
      console.log('✅ Super admin updated successfully!');
      console.log(`📧 Email: ${email}`);
      console.log('🔑 Password: set from SUPER_ADMIN_PASSWORD env (not printed)');
      console.log(`👤 Role: owner`);
    } else {
      // Create new admin
      const saltRounds = 10;
      const passwordHash = await bcrypt.hash(password, saltRounds);

      const result = await pool.query(
        `INSERT INTO merchants (email, password_hash, name, role, subscription_plan, subscription_status)
         VALUES ($1, $2, $3, 'owner', 'business', 'active')
         RETURNING id, email, name, role`,
        [email, passwordHash, name]
      );

      const merchant = result.rows[0];

      // Create default settings
      await pool.query(
        `INSERT INTO merchant_settings (merchant_id, store_name, welcome_message, store_currency)
         VALUES ($1, $2, $3, $4)`,
        [
          merchant.id,
          'Admin Store',
          'Welcome to Admin Store',
          'USD'
        ]
      );

      console.log('✅ Super admin created successfully!');
      console.log(`📧 Email: ${email}`);
      console.log('🔑 Password: set from SUPER_ADMIN_PASSWORD env (not printed)');
      console.log(`👤 Role: owner`);
      console.log(`🆔 ID: ${merchant.id}`);
    }

    process.exit(0);
  } catch (error: any) {
    console.error('❌ Error creating super admin:', error.message);
    process.exit(1);
  }
}

createSuperAdmin();

