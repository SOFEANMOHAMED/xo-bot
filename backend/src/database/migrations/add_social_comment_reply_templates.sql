-- Fixed reply templates for Facebook / Instagram comments (merchant-editable)
ALTER TABLE facebook_pages ADD COLUMN IF NOT EXISTS comment_reply_template TEXT;
ALTER TABLE facebook_pages ADD COLUMN IF NOT EXISTS comment_dm_template TEXT;
ALTER TABLE facebook_pages ADD COLUMN IF NOT EXISTS send_dm_on_comment BOOLEAN DEFAULT false;

ALTER TABLE instagram_accounts ADD COLUMN IF NOT EXISTS comment_reply_template TEXT;
ALTER TABLE instagram_accounts ADD COLUMN IF NOT EXISTS comment_dm_template TEXT;
