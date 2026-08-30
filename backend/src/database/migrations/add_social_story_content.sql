-- Story ↔ product linking (merchant-scoped).
-- Stories live in social_posts with content_kind = 'story' so comment automation never treats them as posts.

ALTER TABLE social_posts
  ADD COLUMN IF NOT EXISTS content_kind VARCHAR(16) NOT NULL DEFAULT 'post';

ALTER TABLE social_posts
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'social_posts'::regclass
      AND conname = 'social_posts_content_kind_check'
  ) THEN
    ALTER TABLE social_posts
      ADD CONSTRAINT social_posts_content_kind_check
      CHECK (content_kind IN ('post', 'story'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_social_posts_content_kind
  ON social_posts(merchant_id, platform, content_kind);

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'social_content_links'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%content_type%'
  LOOP
    EXECUTE format('ALTER TABLE social_content_links DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

ALTER TABLE social_content_links
  ADD CONSTRAINT social_content_links_content_type_check
  CHECK (content_type IN ('post', 'ad', 'ctm_ref', 'ice_breaker', 'story'));
