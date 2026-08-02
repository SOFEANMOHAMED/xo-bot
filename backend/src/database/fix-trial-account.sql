-- Fix trial account: Set subscription_plan to 'trial' for test accounts
-- This will exclude them from MRR calculation

-- Update accounts that should be trial (you can modify the WHERE clause to target specific accounts)
UPDATE merchants 
SET subscription_plan = 'trial',
    subscription_status = 'active',
    trial_ends_at = NOW() + INTERVAL '7 days'
WHERE subscription_plan = 'business' 
  AND role NOT IN ('owner', 'admin')
  AND (role IS NULL OR role = 'user');

-- Verify the changes
SELECT id, email, name, subscription_plan, subscription_status, role, trial_ends_at
FROM merchants
ORDER BY created_at;

