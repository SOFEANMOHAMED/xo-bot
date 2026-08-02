-- Per-post comment reply settings (SaaS: merchant_id scoped via social_posts)
ALTER TABLE social_posts
  ADD COLUMN IF NOT EXISTS comment_reply_enabled BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE social_posts
  ADD COLUMN IF NOT EXISTS public_reply_text TEXT;

ALTER TABLE social_posts
  ADD COLUMN IF NOT EXISTS send_dm_on_comment BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE social_posts
  ADD COLUMN IF NOT EXISTS private_reply_text TEXT;

-- New posts should not auto-reply until merchant opts in
ALTER TABLE social_posts
  ALTER COLUMN is_active_for_rules SET DEFAULT false;

-- Keyword rules: private reply is template-only (no AI first message)
ALTER TABLE social_keyword_rules
  ALTER COLUMN open_ai_conversation SET DEFAULT false;

UPDATE social_keyword_rules SET open_ai_conversation = false WHERE open_ai_conversation = true;
