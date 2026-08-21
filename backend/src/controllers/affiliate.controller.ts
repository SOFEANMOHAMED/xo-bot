import { Response, NextFunction, Request } from 'express';
import pool from '../database/connection.js';
import { createError } from '../middleware/errorHandler.js';
import { AuthRequest } from '../middleware/auth.js';
import crypto from 'crypto';
import { recordAffiliateClick } from '../utils/affiliateReferral.js';
import { createAdminNotification } from '../services/adminNotifications.js';

/**
 * Generate or get referral code for a user
 */
const getOrCreateReferralCode = async (merchantId: string): Promise<string> => {
  // Ensure referral_code column exists
  try {
    await pool.query(`
      DO $$ 
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                      WHERE table_name='merchants' AND column_name='referral_code') THEN
          ALTER TABLE merchants ADD COLUMN referral_code VARCHAR(100) UNIQUE;
        END IF;
      END $$;
    `);
  } catch (err: any) {
    console.warn('Error ensuring referral_code column exists:', err.message);
  }

  // Check if user already has a referral code
  const existingCode = await pool.query(
    `SELECT referral_code FROM merchants WHERE id = $1 AND referral_code IS NOT NULL`,
    [merchantId]
  );

  if (existingCode.rows.length > 0 && existingCode.rows[0].referral_code) {
    return existingCode.rows[0].referral_code;
  }

  // Generate a unique referral code
  let isUnique = false;
  let attempts = 0;
  let referralCode: string = '';

  // Get user email for code generation
  const userResult = await pool.query('SELECT email FROM merchants WHERE id = $1', [merchantId]);
  const email = userResult.rows[0]?.email || '';
  const emailPrefix = email.substring(0, 3).toUpperCase().replace(/[^A-Z]/g, '') || 'REF';

  while (!isUnique && attempts < 20) {
    // Generate code: first 3 letters of email + random 5-6 digits
    const randomNum = Math.floor(10000 + Math.random() * 90000); // 5 digits
    referralCode = `${emailPrefix}${randomNum}`;

    // Check if code is unique
    const checkResult = await pool.query(
      'SELECT id FROM merchants WHERE referral_code = $1',
      [referralCode]
    );

    if (checkResult.rows.length === 0) {
      isUnique = true;
    } else {
      attempts++;
    }
  }

  if (!isUnique) {
    // Fallback: use UUID-based code (8 hex characters)
    referralCode = `REF${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    // Double check uniqueness
    const finalCheck = await pool.query(
      'SELECT id FROM merchants WHERE referral_code = $1',
      [referralCode]
    );
    if (finalCheck.rows.length > 0) {
      // Last resort: use timestamp + random
      referralCode = `REF${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 1000)}`;
    }
  }

  // Save referral code to user
  try {
    await pool.query(
      'UPDATE merchants SET referral_code = $1 WHERE id = $2',
      [referralCode, merchantId]
    );
    console.log('Successfully saved referral code:', referralCode, 'for merchant:', merchantId);
  } catch (err: any) {
    console.error('Error saving referral code:', err);
    // Still return the code even if save fails, as it might be a constraint issue
  }

  return referralCode;
};

/**
 * Update referral status from 'pending' to 'active' after 15 days
 */
const updatePendingReferralsToActive = async () => {
  try {
    // Update referrals that are pending and created more than 15 days ago
    await pool.query(`
      UPDATE affiliate_referrals
      SET status = 'active', updated_at = CURRENT_TIMESTAMP
      WHERE status = 'pending'
        AND created_at <= NOW() - INTERVAL '15 days'
    `);
  } catch (error: any) {
    console.error('Error updating pending referrals to active:', error);
  }
};

/**
 * Get affiliate stats for the current user
 */
export const getAffiliateStats = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    // Check if user is authenticated
    if (!req.merchantId) {
      return next(createError('Unauthorized: User not authenticated', 401));
    }
    
    // Update pending referrals that have passed 15 days
    await updatePendingReferralsToActive();
    
    const merchantId = req.merchantId;

    // Ensure affiliate tables exist
    await pool.query(`
      CREATE TABLE IF NOT EXISTS affiliate_referrals (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        referrer_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
        referred_user_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
        referral_code VARCHAR(100),
        status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'expired')),
        commission_amount DECIMAL(10, 2) DEFAULT 0,
        plan VARCHAR(50),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(referred_user_id)
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS affiliate_clicks (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        referrer_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
        referral_code VARCHAR(100),
        ip_address VARCHAR(45),
        user_agent TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Get or create referral code
    const referralCode = await getOrCreateReferralCode(merchantId);
    console.log('Generated referral code for merchant:', merchantId, 'Code:', referralCode);
    const referralLink = `${process.env.FRONTEND_URL || 'https://xo-bot.com'}/signup?ref=${referralCode}`;
    console.log('Generated referral link:', referralLink);

    // Get total clicks
    const clicksResult = await pool.query(
      `SELECT COUNT(*)::int as count FROM affiliate_clicks WHERE referrer_id = $1`,
      [merchantId]
    );
    const totalVisits = clicksResult.rows[0]?.count || 0;

    // Get total signups
    const signupsResult = await pool.query(
      `SELECT COUNT(*)::int as count FROM affiliate_referrals WHERE referrer_id = $1`,
      [merchantId]
    );
    const totalSignups = signupsResult.rows[0]?.count || 0;

    // Get active conversions (referrals with active status)
    const activeResult = await pool.query(
      `SELECT COUNT(*)::int as count FROM affiliate_referrals WHERE referrer_id = $1 AND status = 'active'`,
      [merchantId]
    );
    const activeConversions = activeResult.rows[0]?.count || 0;

    // Get total earnings (sum of all commissions)
    const earningsResult = await pool.query(
      `SELECT COALESCE(SUM(commission_amount), 0)::decimal as total FROM affiliate_referrals WHERE referrer_id = $1`,
      [merchantId]
    );
    const totalEarnings = parseFloat(earningsResult.rows[0]?.total || '0');

    // Get available balance (sum of active commissions)
    const balanceResult = await pool.query(
      `SELECT COALESCE(SUM(commission_amount), 0)::decimal as total FROM affiliate_referrals WHERE referrer_id = $1 AND status = 'active'`,
      [merchantId]
    );
    const availableBalance = parseFloat(balanceResult.rows[0]?.total || '0');

    // Get referrals list with days remaining for pending referrals
    const referralsResult = await pool.query(
      `SELECT 
        ar.id,
        ar.referred_user_id,
        ar.status,
        ar.commission_amount,
        ar.plan,
        ar.created_at,
        m.email as new_user_email,
        m.name as new_user_name,
        CASE 
          WHEN ar.status = 'pending' THEN 
            GREATEST(0, 15 - (EXTRACT(EPOCH FROM (NOW() - ar.created_at)) / 86400)::int)
          ELSE NULL
        END as days_remaining
       FROM affiliate_referrals ar
       LEFT JOIN merchants m ON m.id = ar.referred_user_id
       WHERE ar.referrer_id = $1
       ORDER BY ar.created_at DESC
       LIMIT 50`,
      [merchantId]
    );

    const referrals = referralsResult.rows.map((row) => ({
      id: String(row.id),
      referrerId: merchantId,
      newUserId: String(row.referred_user_id),
      newUserEmail: row.new_user_email || 'مستخدم غير معروف',
      date: new Date(row.created_at),
      status: row.status as 'pending' | 'active' | 'expired',
      commissionAmount: parseFloat(String(row.commission_amount || '0')),
      plan: (row.plan === 'starter' ? 'Starter' :
             row.plan === 'pro' ? 'Pro' :
             row.plan === 'business' ? 'Business' : 'Starter') as 'Starter' | 'Pro' | 'Business',
      daysRemaining: row.days_remaining !== null ? parseInt(String(row.days_remaining || '0'), 10) : null
    }));

    const responseData = {
      referralCode,
      referralLink,
      totalVisits,
      totalSignups,
      activeConversions,
      totalEarnings,
      availableBalance,
      referrals
    };
    
    console.log('Sending affiliate stats response:', {
      referralCode,
      referralLink,
      totalVisits,
      totalSignups,
      referralsCount: referrals.length
    });

    res.json({
      success: true,
      data: responseData
    });
  } catch (error: any) {
    console.error('Error fetching affiliate stats:', error);
    next(error);
  }
};

/**
 * Track affiliate click (public endpoint, no auth required)
 */
export const trackAffiliateClick = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { ref } = req.query;
    
    if (!ref || typeof ref !== 'string') {
      // Return success even if no ref code to avoid breaking the page
      return res.json({ success: true });
    }

    const ipAddress = req.ip || req.socket.remoteAddress || null;
    const userAgent = req.get('user-agent') || null;
    await recordAffiliateClick(pool, ref, ipAddress, userAgent);

    res.json({ success: true });
  } catch (error: any) {
    // Log error but don't fail the request to avoid breaking the signup page
    console.warn('Error tracking affiliate click:', error.message);
    res.json({ success: true });
  }
};

/**
 * Request withdrawal
 */
export const requestWithdrawal = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    // Check if user is authenticated
    if (!req.merchantId) {
      return next(createError('Unauthorized: User not authenticated', 401));
    }
    
    // Update pending referrals that have passed 15 days
    await updatePendingReferralsToActive();
    
    const merchantId = req.merchantId;
    const { amount } = req.body;

    if (!amount || amount < 50) {
      return next(createError('Minimum withdrawal amount is $50', 400));
    }

    // Get available balance (only active commissions that have passed 15 days)
    const balanceResult = await pool.query(
      `SELECT COALESCE(SUM(commission_amount), 0)::decimal as total 
       FROM affiliate_referrals 
       WHERE referrer_id = $1 AND status = 'active'`,
      [merchantId]
    );
    const availableBalance = parseFloat(balanceResult.rows[0]?.total || '0');

    if (amount > availableBalance) {
      return next(createError('Insufficient balance', 400));
    }

    // Create withdrawal request table if it doesn't exist
    await pool.query(`
      CREATE TABLE IF NOT EXISTS affiliate_withdrawals (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
        amount DECIMAL(10, 2) NOT NULL,
        status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'completed')),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Get merchant information for notification
    const merchantResult = await pool.query(
      'SELECT id, name, email FROM merchants WHERE id = $1',
      [merchantId]
    );
    const merchant = merchantResult.rows[0];

    // Create withdrawal request
    const withdrawalResult = await pool.query(
      `INSERT INTO affiliate_withdrawals (merchant_id, amount, status) 
       VALUES ($1, $2, 'pending') 
       RETURNING id, created_at`,
      [merchantId, amount]
    );
    const withdrawal = withdrawalResult.rows[0];

    // Create admin notifications table if it doesn't exist
    await pool.query(`
      CREATE TABLE IF NOT EXISTS admin_notifications (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        type VARCHAR(50) NOT NULL,
        title VARCHAR(255) NOT NULL,
        message TEXT NOT NULL,
        data JSONB,
        is_read BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        read_at TIMESTAMP
      )
    `);

    await createAdminNotification({
      type: 'withdrawal_request',
      title: 'طلب سحب أرباح جديد',
      message: `طلب المسوق ${merchant.name || merchant.email} سحب مبلغ ${amount}$`,
      data: {
        withdrawalId: withdrawal.id,
        merchantId: merchant.id,
        merchantName: merchant.name,
        merchantEmail: merchant.email,
        amount: amount,
        createdAt: withdrawal.created_at,
      },
    });

    res.json({
      success: true,
      message: 'Withdrawal request submitted successfully',
      data: {
        amount,
        status: 'pending'
      }
    });
  } catch (error: any) {
    console.error('Error requesting withdrawal:', error);
    next(error);
  }
};

