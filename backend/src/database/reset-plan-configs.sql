-- Reset plan configurations to use new defaults
-- This will delete old plan configs so the system uses the new defaults

DELETE FROM global_settings 
WHERE key IN ('plan_starter', 'plan_pro', 'plan_business');

-- Optional: Also reset plan limits if you want to use new defaults
-- DELETE FROM global_settings 
-- WHERE key IN ('plan_limits_starter', 'plan_limits_pro', 'plan_limits_business');

