-- Database Indexes for Performance Optimization
-- Run this file after creating the main schema

-- Orders table indexes
CREATE INDEX IF NOT EXISTS idx_orders_merchant_id ON orders(merchant_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_merchant_status ON orders(merchant_id, status);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_merchant_created ON orders(merchant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_customer_email ON orders(customer_email);
CREATE INDEX IF NOT EXISTS idx_orders_external_id ON orders(external_id) WHERE external_id IS NOT NULL;

-- Products table indexes
CREATE INDEX IF NOT EXISTS idx_products_merchant_id ON products(merchant_id);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category) WHERE category IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_products_merchant_category ON products(merchant_id, category);
CREATE INDEX IF NOT EXISTS idx_products_created_at ON products(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_products_external_id ON products(external_id) WHERE external_id IS NOT NULL;

-- Services table indexes
CREATE INDEX IF NOT EXISTS idx_services_merchant_id ON services(merchant_id);
CREATE INDEX IF NOT EXISTS idx_services_category ON services(category) WHERE category IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_services_merchant_category ON services(merchant_id, category);
CREATE INDEX IF NOT EXISTS idx_services_created_at ON services(created_at DESC);

-- Merchants table indexes
CREATE INDEX IF NOT EXISTS idx_merchants_email ON merchants(email);
CREATE INDEX IF NOT EXISTS idx_merchants_role ON merchants(role);
CREATE INDEX IF NOT EXISTS idx_merchants_subscription_plan ON merchants(subscription_plan);
CREATE INDEX IF NOT EXISTS idx_merchants_referral_code ON merchants(referral_code) WHERE referral_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_merchants_created_at ON merchants(created_at DESC);

-- Affiliate referrals table indexes
CREATE INDEX IF NOT EXISTS idx_affiliate_referrals_referrer_id ON affiliate_referrals(referrer_id);
CREATE INDEX IF NOT EXISTS idx_affiliate_referrals_referred_user_id ON affiliate_referrals(referred_user_id);
CREATE INDEX IF NOT EXISTS idx_affiliate_referrals_status ON affiliate_referrals(status);
CREATE INDEX IF NOT EXISTS idx_affiliate_referrals_referrer_status ON affiliate_referrals(referrer_id, status);
CREATE INDEX IF NOT EXISTS idx_affiliate_referrals_created_at ON affiliate_referrals(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_affiliate_referrals_referral_code ON affiliate_referrals(referral_code);

-- Affiliate withdrawals table indexes
CREATE INDEX IF NOT EXISTS idx_affiliate_withdrawals_merchant_id ON affiliate_withdrawals(merchant_id);
CREATE INDEX IF NOT EXISTS idx_affiliate_withdrawals_status ON affiliate_withdrawals(status);
CREATE INDEX IF NOT EXISTS idx_affiliate_withdrawals_merchant_status ON affiliate_withdrawals(merchant_id, status);
CREATE INDEX IF NOT EXISTS idx_affiliate_withdrawals_created_at ON affiliate_withdrawals(created_at DESC);

-- Admin notifications table indexes
CREATE INDEX IF NOT EXISTS idx_admin_notifications_is_read ON admin_notifications(is_read);
CREATE INDEX IF NOT EXISTS idx_admin_notifications_type ON admin_notifications(type);
CREATE INDEX IF NOT EXISTS idx_admin_notifications_created_at ON admin_notifications(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_notifications_unread ON admin_notifications(is_read, created_at DESC) WHERE is_read = FALSE;

-- Settings table indexes
CREATE INDEX IF NOT EXISTS idx_settings_merchant_id ON settings(merchant_id);

-- Order items table indexes (if exists)
CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_product_id ON order_items(product_id) WHERE product_id IS NOT NULL;

-- Analyze tables for query optimization
ANALYZE orders;
ANALYZE products;
ANALYZE services;
ANALYZE merchants;
ANALYZE affiliate_referrals;
ANALYZE affiliate_withdrawals;
ANALYZE admin_notifications;

