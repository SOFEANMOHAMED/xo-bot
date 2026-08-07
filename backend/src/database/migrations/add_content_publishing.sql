-- Content publishing & scheduling (Facebook Pages + Instagram Business)
-- Multi-tenant: every row is scoped by merchant_id. Never query by external ids alone.

CREATE TABLE IF NOT EXISTS content_publications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  caption TEXT,
  media_kind VARCHAR(32) NOT NULL DEFAULT 'image'
    CHECK (media_kind IN ('none', 'image', 'video', 'carousel')),
  status VARCHAR(32) NOT NULL DEFAULT 'draft'
    CHECK (status IN (
      'draft',
      'scheduled',
      'publishing',
      'published',
      'partial',
      'failed',
      'cancelled'
    )),
  scheduled_at TIMESTAMPTZ,
  published_at TIMESTAMPTZ,
  created_by UUID REFERENCES merchants(id) ON DELETE SET NULL,
  error_summary TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_content_publications_merchant
  ON content_publications(merchant_id);

CREATE INDEX IF NOT EXISTS idx_content_publications_merchant_status
  ON content_publications(merchant_id, status);

CREATE INDEX IF NOT EXISTS idx_content_publications_due
  ON content_publications(scheduled_at)
  WHERE status = 'scheduled';

CREATE TABLE IF NOT EXISTS content_publication_media (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  publication_id UUID NOT NULL REFERENCES content_publications(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  media_type VARCHAR(16) NOT NULL CHECK (media_type IN ('image', 'video')),
  media_url TEXT NOT NULL,
  thumbnail_url TEXT,
  alt_text TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_content_publication_media_order UNIQUE (publication_id, sort_order)
);

CREATE INDEX IF NOT EXISTS idx_content_publication_media_merchant
  ON content_publication_media(merchant_id);

CREATE INDEX IF NOT EXISTS idx_content_publication_media_pub
  ON content_publication_media(publication_id);

CREATE TABLE IF NOT EXISTS content_publication_targets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  publication_id UUID NOT NULL REFERENCES content_publications(id) ON DELETE CASCADE,
  platform VARCHAR(32) NOT NULL CHECK (platform IN ('facebook', 'instagram')),
  account_ref VARCHAR(255) NOT NULL,
  account_label VARCHAR(255),
  status VARCHAR(32) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'publishing', 'published', 'failed', 'skipped')),
  external_post_id VARCHAR(255),
  permalink TEXT,
  container_id VARCHAR(255),
  error_message TEXT,
  published_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_content_publication_target
    UNIQUE (publication_id, platform, account_ref)
);

CREATE INDEX IF NOT EXISTS idx_content_publication_targets_merchant
  ON content_publication_targets(merchant_id);

CREATE INDEX IF NOT EXISTS idx_content_publication_targets_pub
  ON content_publication_targets(publication_id);

CREATE INDEX IF NOT EXISTS idx_content_publication_targets_status
  ON content_publication_targets(merchant_id, status);
