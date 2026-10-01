-- Paid subscription period start (pairs with subscription_ends_at)
ALTER TABLE merchants
  ADD COLUMN IF NOT EXISTS subscription_starts_at TIMESTAMP;
