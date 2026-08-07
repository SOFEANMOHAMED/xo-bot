import pool from '../../database/connection.js';
import type { PublishableAccount, PublishAccountCredentials } from './types.js';

export async function listPublishableAccounts(
  merchantId: string
): Promise<PublishableAccount[]> {
  const [fb, ig] = await Promise.all([
    pool.query<{ page_id: string; page_name: string | null }>(
      `SELECT page_id, page_name
       FROM facebook_pages
       WHERE merchant_id = $1
       ORDER BY page_name ASC NULLS LAST`,
      [merchantId]
    ),
    pool.query<{
      ig_user_id: string;
      ig_username: string | null;
      page_id: string;
    }>(
      `SELECT ig_user_id, ig_username, page_id
       FROM instagram_accounts
       WHERE merchant_id = $1
       ORDER BY ig_username ASC NULLS LAST`,
      [merchantId]
    )
  ]);

  const accounts: PublishableAccount[] = [
    ...fb.rows.map((row) => ({
      platform: 'facebook' as const,
      accountRef: row.page_id,
      accountLabel: row.page_name,
      pageId: row.page_id
    })),
    ...ig.rows.map((row) => ({
      platform: 'instagram' as const,
      accountRef: row.ig_user_id,
      accountLabel: row.ig_username ? `@${row.ig_username}` : row.ig_user_id,
      pageId: row.page_id
    }))
  ];

  return accounts;
}

export async function resolveAccountCredentials(
  merchantId: string,
  platform: 'facebook' | 'instagram',
  accountRef: string
): Promise<PublishAccountCredentials | null> {
  if (platform === 'facebook') {
    const result = await pool.query<{
      page_id: string;
      page_name: string | null;
      access_token: string;
    }>(
      `SELECT page_id, page_name, access_token
       FROM facebook_pages
       WHERE merchant_id = $1 AND page_id = $2`,
      [merchantId, accountRef]
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      platform: 'facebook',
      accountRef: row.page_id,
      accountLabel: row.page_name,
      accessToken: row.access_token,
      pageId: row.page_id
    };
  }

  const result = await pool.query<{
    ig_user_id: string;
    ig_username: string | null;
    page_id: string;
    access_token: string;
  }>(
    `SELECT ig_user_id, ig_username, page_id, access_token
     FROM instagram_accounts
     WHERE merchant_id = $1 AND ig_user_id = $2`,
    [merchantId, accountRef]
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    platform: 'instagram',
    accountRef: row.ig_user_id,
    accountLabel: row.ig_username ? `@${row.ig_username}` : row.ig_user_id,
    accessToken: row.access_token,
    pageId: row.page_id
  };
}
