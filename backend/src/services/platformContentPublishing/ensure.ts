/**
 * Ensure platform content-publishing tables exist (SaaS-isolated from merchants).
 */

import pool from '../../database/connection.js';
import { ensurePlatformFacebookTables } from '../platformFacebookPage.js';

let tablesEnsured = false;

export async function ensurePlatformContentPublishingTables(): Promise<void> {
  if (tablesEnsured) return;
  await ensurePlatformFacebookTables();

  await pool.query(`
    ALTER TABLE platform_facebook_pages
      ADD COLUMN IF NOT EXISTS ig_user_id VARCHAR(255)
  `);
  await pool.query(`
    ALTER TABLE platform_facebook_pages
      ADD COLUMN IF NOT EXISTS ig_username VARCHAR(255)
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS platform_content_publications (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      page_id VARCHAR(255) NOT NULL,
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
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_platform_content_publications_page
      ON platform_content_publications(page_id)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_platform_content_publications_status
      ON platform_content_publications(status)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_platform_content_publications_due
      ON platform_content_publications(scheduled_at)
      WHERE status = 'scheduled'
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS platform_content_publication_media (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      publication_id UUID NOT NULL REFERENCES platform_content_publications(id) ON DELETE CASCADE,
      sort_order INTEGER NOT NULL DEFAULT 0,
      media_type VARCHAR(16) NOT NULL CHECK (media_type IN ('image', 'video')),
      media_url TEXT NOT NULL,
      thumbnail_url TEXT,
      alt_text TEXT,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT uq_platform_content_publication_media_order UNIQUE (publication_id, sort_order)
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_platform_content_publication_media_pub
      ON platform_content_publication_media(publication_id)
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS platform_content_publication_targets (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      publication_id UUID NOT NULL REFERENCES platform_content_publications(id) ON DELETE CASCADE,
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
      CONSTRAINT uq_platform_content_publication_target
        UNIQUE (publication_id, platform, account_ref)
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_platform_content_publication_targets_pub
      ON platform_content_publication_targets(publication_id)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_platform_content_publication_targets_status
      ON platform_content_publication_targets(status)
  `);

  tablesEnsured = true;
}
