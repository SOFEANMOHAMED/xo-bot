-- Social posts, optional product links, keyword comment rules, and action audit
-- Multi-tenant: every row is scoped by merchant_id

ALTER TABLE facebook_pages
  ADD COLUMN IF NOT EXISTS comment_automation_mode VARCHAR(32) DEFAULT 'template_all';
-- template_all | keyword_rules | off

ALTER TABLE instagram_accounts
  ADD COLUMN IF NOT EXISTS comment_automation_mode VARCHAR(32) DEFAULT 'template_all';

CREATE TABLE IF NOT EXISTS social_posts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  platform VARCHAR(32) NOT NULL CHECK (platform IN ('facebook', 'instagram')),
  account_ref VARCHAR(255) NOT NULL,
  external_post_id VARCHAR(255) NOT NULL,
  caption TEXT,
  permalink TEXT,
  media_type VARCHAR(64),
  thumbnail_url TEXT,
  posted_at TIMESTAMP,
  synced_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  is_active_for_rules BOOLEAN DEFAULT true,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (merchant_id, platform, external_post_id)
);

CREATE INDEX IF NOT EXISTS idx_social_posts_merchant ON social_posts(merchant_id);
CREATE INDEX IF NOT EXISTS idx_social_posts_account ON social_posts(merchant_id, platform, account_ref);
CREATE INDEX IF NOT EXISTS idx_social_posts_external ON social_posts(platform, external_post_id);

CREATE TABLE IF NOT EXISTS social_content_links (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  platform VARCHAR(32) NOT NULL CHECK (platform IN ('facebook', 'instagram')),
  content_type VARCHAR(32) NOT NULL DEFAULT 'post'
    CHECK (content_type IN ('post', 'ad', 'ctm_ref', 'ice_breaker')),
  external_id VARCHAR(255),
  ref_code VARCHAR(128),
  social_post_id UUID REFERENCES social_posts(id) ON DELETE CASCADE,
  product_id UUID REFERENCES products(id) ON DELETE SET NULL,
  is_active BOOLEAN DEFAULT true,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_social_content_links_external
  ON social_content_links(merchant_id, platform, content_type, external_id)
  WHERE external_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_social_content_links_ref
  ON social_content_links(merchant_id, ref_code)
  WHERE ref_code IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_social_content_links_merchant ON social_content_links(merchant_id);
CREATE INDEX IF NOT EXISTS idx_social_content_links_post ON social_content_links(social_post_id);
CREATE INDEX IF NOT EXISTS idx_social_content_links_product ON social_content_links(merchant_id, product_id);

CREATE TABLE IF NOT EXISTS social_keyword_rules (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  platform VARCHAR(32) NOT NULL CHECK (platform IN ('facebook', 'instagram')),
  account_ref VARCHAR(255) NOT NULL,
  scope VARCHAR(16) NOT NULL DEFAULT 'account' CHECK (scope IN ('account', 'post')),
  social_post_id UUID REFERENCES social_posts(id) ON DELETE CASCADE,
  external_post_id VARCHAR(255),
  keywords TEXT[] NOT NULL DEFAULT '{}',
  match_type VARCHAR(32) NOT NULL DEFAULT 'contains'
    CHECK (match_type IN ('contains', 'exact', 'starts_with')),
  priority INTEGER NOT NULL DEFAULT 100,
  public_reply_enabled BOOLEAN NOT NULL DEFAULT true,
  public_reply_text TEXT,
  private_reply_enabled BOOLEAN NOT NULL DEFAULT true,
  private_reply_text TEXT,
  open_ai_conversation BOOLEAN NOT NULL DEFAULT true,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_social_keyword_rules_merchant ON social_keyword_rules(merchant_id);
CREATE INDEX IF NOT EXISTS idx_social_keyword_rules_lookup
  ON social_keyword_rules(merchant_id, platform, account_ref, is_active, priority DESC);

CREATE TABLE IF NOT EXISTS social_comment_actions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  platform VARCHAR(32) NOT NULL,
  account_ref VARCHAR(255) NOT NULL,
  external_comment_id VARCHAR(255) NOT NULL,
  external_post_id VARCHAR(255),
  matched_rule_id UUID REFERENCES social_keyword_rules(id) ON DELETE SET NULL,
  matched_keyword TEXT,
  public_replied BOOLEAN DEFAULT false,
  private_replied BOOLEAN DEFAULT false,
  conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  product_id UUID REFERENCES products(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (merchant_id, platform, external_comment_id)
);

CREATE INDEX IF NOT EXISTS idx_social_comment_actions_merchant ON social_comment_actions(merchant_id);
