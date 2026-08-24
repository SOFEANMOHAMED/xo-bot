/**
 * Publishable accounts for the official XO Bot page (Facebook + linked IG).
 * Isolated from merchant facebook_pages / instagram_accounts.
 */

import type { PublishableAccount, PublishAccountCredentials } from '../contentPublishing/types.js';
import {
  fetchLinkedInstagramBusinessAccount,
  getLinkedPlatformFacebookPage,
  persistPlatformInstagramAccount,
} from '../platformFacebookPage.js';
import { ensurePlatformContentPublishingTables } from './ensure.js';

export async function listPlatformPublishableAccounts(): Promise<PublishableAccount[]> {
  await ensurePlatformContentPublishingTables();
  const page = await getLinkedPlatformFacebookPage();
  if (!page) return [];

  const accounts: PublishableAccount[] = [
    {
      platform: 'facebook',
      accountRef: page.page_id,
      accountLabel: page.page_name,
      pageId: page.page_id,
    },
  ];

  let igUserId = page.ig_user_id;
  let igUsername = page.ig_username;

  if (!igUserId) {
    const ig = await fetchLinkedInstagramBusinessAccount({
      pageId: page.page_id,
      accessToken: page.access_token,
    });
    if (ig) {
      igUserId = ig.igUserId;
      igUsername = ig.igUsername;
      await persistPlatformInstagramAccount({
        pageId: page.page_id,
        igUserId: ig.igUserId,
        igUsername: ig.igUsername,
      });
    }
  }

  if (igUserId) {
    accounts.push({
      platform: 'instagram',
      accountRef: igUserId,
      accountLabel: igUsername ? `@${igUsername}` : igUserId,
      pageId: page.page_id,
    });
  }

  return accounts;
}

export async function resolvePlatformAccountCredentials(
  platform: 'facebook' | 'instagram',
  accountRef: string
): Promise<PublishAccountCredentials | null> {
  await ensurePlatformContentPublishingTables();
  const page = await getLinkedPlatformFacebookPage();
  if (!page) return null;

  if (platform === 'facebook') {
    if (page.page_id !== accountRef) return null;
    return {
      platform: 'facebook',
      accountRef: page.page_id,
      accountLabel: page.page_name,
      accessToken: page.access_token,
      pageId: page.page_id,
    };
  }

  const igUserId = page.ig_user_id;
  if (!igUserId || igUserId !== accountRef) return null;
  return {
    platform: 'instagram',
    accountRef: igUserId,
    accountLabel: page.ig_username ? `@${page.ig_username}` : igUserId,
    accessToken: page.access_token,
    pageId: page.page_id,
  };
}
