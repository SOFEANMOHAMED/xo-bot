/**
 * Platform-owned Facebook page (official XO Bot page).
 * Isolated from merchant facebook_pages for SaaS tenancy safety.
 */

import pool from '../database/connection.js';
import { logger } from '../utils/logger.js';

export interface PlatformFacebookPage {
  id: string;
  page_id: string;
  page_name: string | null;
  access_token: string;
  linked_by_merchant_id: string | null;
  created_at: Date;
  updated_at: Date;
}

let tablesEnsured = false;

export async function ensurePlatformFacebookTables(): Promise<void> {
  if (tablesEnsured) return;

  await pool.query(`
    CREATE TABLE IF NOT EXISTS platform_facebook_pages (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      page_id VARCHAR(255) NOT NULL UNIQUE,
      page_name VARCHAR(255),
      access_token TEXT NOT NULL,
      linked_by_merchant_id UUID REFERENCES merchants(id) ON DELETE SET NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS platform_conversations (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      page_id VARCHAR(255) NOT NULL,
      user_id VARCHAR(255) NOT NULL,
      user_name VARCHAR(255),
      conversation_state JSONB NOT NULL DEFAULT '{}'::jsonb,
      last_message_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(page_id, user_id)
    )
  `);

  // Human takeover flags (mirror merchant conversations — SaaS-isolated)
  await pool.query(`
    ALTER TABLE platform_conversations
      ADD COLUMN IF NOT EXISTS bot_disabled BOOLEAN NOT NULL DEFAULT false
  `);
  await pool.query(`
    ALTER TABLE platform_conversations
      ADD COLUMN IF NOT EXISTS status VARCHAR(32) NOT NULL DEFAULT 'bot'
  `);
  await pool.query(`
    ALTER TABLE platform_conversations
      ADD COLUMN IF NOT EXISTS last_human_response_at TIMESTAMP
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS platform_messages (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      conversation_id UUID NOT NULL REFERENCES platform_conversations(id) ON DELETE CASCADE,
      role VARCHAR(20) NOT NULL,
      content TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    ALTER TABLE platform_messages
      ADD COLUMN IF NOT EXISTS external_message_id VARCHAR(255)
  `);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_platform_messages_external
      ON platform_messages(conversation_id, external_message_id)
      WHERE external_message_id IS NOT NULL
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_platform_messages_conversation
      ON platform_messages(conversation_id, created_at)
  `);

  tablesEnsured = true;
}

export async function getPlatformFacebookPageByPageId(
  pageId: string
): Promise<PlatformFacebookPage | null> {
  await ensurePlatformFacebookTables();
  const result = await pool.query(
    `SELECT id, page_id, page_name, access_token, linked_by_merchant_id, created_at, updated_at
     FROM platform_facebook_pages
     WHERE page_id = $1
     LIMIT 1`,
    [pageId]
  );
  return result.rows[0] || null;
}

export async function getLinkedPlatformFacebookPage(): Promise<PlatformFacebookPage | null> {
  await ensurePlatformFacebookTables();
  const result = await pool.query(
    `SELECT id, page_id, page_name, access_token, linked_by_merchant_id, created_at, updated_at
     FROM platform_facebook_pages
     ORDER BY updated_at DESC NULLS LAST, created_at DESC
     LIMIT 1`
  );
  return result.rows[0] || null;
}

export async function isPlatformFacebookPageId(pageId: string): Promise<boolean> {
  const page = await getPlatformFacebookPageByPageId(pageId);
  return !!page;
}

/**
 * Upsert the single official page. Replaces any previously linked platform page.
 * Also removes the same page_id from merchant facebook_pages to avoid tenancy conflicts.
 */
export async function linkPlatformFacebookPage(params: {
  pageId: string;
  pageName: string;
  accessToken: string;
  linkedByMerchantId: string | null;
}): Promise<PlatformFacebookPage> {
  await ensurePlatformFacebookTables();

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(`DELETE FROM platform_facebook_pages`);

    const merchantUnlink = await client.query(
      `DELETE FROM facebook_pages WHERE page_id = $1 RETURNING merchant_id`,
      [params.pageId]
    );
    if (merchantUnlink.rowCount && merchantUnlink.rowCount > 0) {
      logger.warn('Removed merchant Facebook page link — page claimed as official platform page', {
        pageId: params.pageId,
        affectedMerchants: merchantUnlink.rows.map((r: { merchant_id: string }) => r.merchant_id),
      });
    }

    const inserted = await client.query(
      `INSERT INTO platform_facebook_pages (page_id, page_name, access_token, linked_by_merchant_id)
       VALUES ($1, $2, $3, $4)
       RETURNING id, page_id, page_name, access_token, linked_by_merchant_id, created_at, updated_at`,
      [params.pageId, params.pageName, params.accessToken, params.linkedByMerchantId]
    );

    await client.query('COMMIT');
    return inserted.rows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function unlinkPlatformFacebookPage(): Promise<boolean> {
  await ensurePlatformFacebookTables();
  const result = await pool.query(`DELETE FROM platform_facebook_pages`);
  return (result.rowCount || 0) > 0;
}

export function toPublicPlatformPage(page: PlatformFacebookPage | null) {
  if (!page) return null;
  return {
    pageId: page.page_id,
    pageName: page.page_name,
    linkedAt: page.updated_at || page.created_at,
  };
}
