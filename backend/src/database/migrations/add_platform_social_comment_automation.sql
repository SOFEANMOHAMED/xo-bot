-- Official XO Bot page comment automation (platform-scoped, no merchant_id)
-- Mirrors merchant social_posts / keyword_rules / comment_actions with SaaS isolation.

CREATE TABLE IF NOT EXISTS platform_social_posts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  page_id VARCHAR(255) NOT NULL,
  platform VARCHAR(32) NOT NULL DEFAULT 'facebook'
    CHECK (platform IN ('facebook', 'instagram')),
  account_ref VARCHAR(255) NOT NULL,
  external_post_id VARCHAR(255) NOT NULL,
  caption TEXT,
  permalink TEXT,
  media_type VARCHAR(64),
  thumbnail_url TEXT,
  posted_at TIMESTAMP,
  synced_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  comment_reply_enabled BOOLEAN NOT NULL DEFAULT false,
  public_reply_text TEXT,
  send_dm_on_comment BOOLEAN NOT NULL DEFAULT false,
  private_reply_text TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (platform, external_post_id)
);

CREATE INDEX IF NOT EXISTS idx_platform_social_posts_page
  ON platform_social_posts(page_id, platform);
CREATE INDEX IF NOT EXISTS idx_platform_social_posts_account
  ON platform_social_posts(platform, account_ref);

CREATE TABLE IF NOT EXISTS platform_keyword_rules (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  page_id VARCHAR(255) NOT NULL,
  platform VARCHAR(32) NOT NULL DEFAULT 'facebook'
    CHECK (platform IN ('facebook', 'instagram')),
  account_ref VARCHAR(255) NOT NULL,
  scope VARCHAR(16) NOT NULL DEFAULT 'post' CHECK (scope IN ('post')),
  social_post_id UUID REFERENCES platform_social_posts(id) ON DELETE CASCADE,
  external_post_id VARCHAR(255),
  keywords TEXT[] NOT NULL DEFAULT '{}',
  match_type VARCHAR(32) NOT NULL DEFAULT 'contains'
    CHECK (match_type IN ('contains', 'exact', 'starts_with')),
  priority INTEGER NOT NULL DEFAULT 100,
  public_reply_enabled BOOLEAN NOT NULL DEFAULT true,
  public_reply_text TEXT,
  private_reply_enabled BOOLEAN NOT NULL DEFAULT false,
  private_reply_text TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_platform_keyword_rules_lookup
  ON platform_keyword_rules(page_id, platform, account_ref, is_active, priority DESC);
CREATE INDEX IF NOT EXISTS idx_platform_keyword_rules_post
  ON platform_keyword_rules(social_post_id);

CREATE TABLE IF NOT EXISTS platform_comment_actions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  page_id VARCHAR(255) NOT NULL,
  platform VARCHAR(32) NOT NULL,
  account_ref VARCHAR(255) NOT NULL,
  external_comment_id VARCHAR(255) NOT NULL,
  external_post_id VARCHAR(255),
  matched_rule_id UUID REFERENCES platform_keyword_rules(id) ON DELETE SET NULL,
  matched_keyword TEXT,
  public_replied BOOLEAN DEFAULT false,
  private_replied BOOLEAN DEFAULT false,
  conversation_id UUID REFERENCES platform_conversations(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (page_id, platform, external_comment_id)
);

CREATE INDEX IF NOT EXISTS idx_platform_comment_actions_page
  ON platform_comment_actions(page_id);
