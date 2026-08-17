import { logger } from './logger.js';

const GRAPH_VERSION = process.env.FACEBOOK_GRAPH_VERSION || 'v21.0';

export type FacebookManagedPage = {
  id: string;
  name?: string;
  access_token?: string;
  category?: string;
  picture?: { data?: { url?: string } };
  instagram_business_account?: { id?: string; username?: string };
};

type GraphPaging = { next?: string };

async function fetchPagedGraphNodes<T>(
  initialUrl: string,
  context: string
): Promise<T[]> {
  const nodes: T[] = [];
  let url: string | null = initialUrl;

  while (url) {
    const resp = await fetch(url);
    const data = (await resp.json()) as {
      data?: T[];
      paging?: GraphPaging;
      error?: { message?: string; code?: number };
    };

    if (!resp.ok || data.error) {
      logger.warn(`Facebook Graph paging failed (${context})`, {
        error: data.error || { status: resp.status },
      });
      break;
    }

    if (Array.isArray(data.data)) {
      nodes.push(...data.data);
    }
    url = data.paging?.next || null;
  }

  return nodes;
}

/**
 * List pages via /me/accounts (paginated).
 * Pages linked to Meta Business Suite often require business_management
 * or may only appear via granular scope target IDs.
 */
export async function fetchAllManagedFacebookPages(
  userAccessToken: string,
  fields = 'id,name,access_token,category,picture'
): Promise<FacebookManagedPage[]> {
  return fetchPagedGraphNodes<FacebookManagedPage>(
    `https://graph.facebook.com/${GRAPH_VERSION}/me/accounts` +
      `?fields=${encodeURIComponent(fields)}` +
      `&limit=100&access_token=${encodeURIComponent(userAccessToken)}`,
    'me/accounts'
  );
}

/** Granted permission names for diagnostics. */
export async function fetchGrantedFacebookPermissions(
  userAccessToken: string
): Promise<string[]> {
  try {
    const resp = await fetch(
      `https://graph.facebook.com/${GRAPH_VERSION}/me/permissions` +
        `?access_token=${encodeURIComponent(userAccessToken)}`
    );
    const data = (await resp.json()) as {
      data?: Array<{ permission?: string; status?: string }>;
    };
    if (!resp.ok || !Array.isArray(data.data)) return [];
    return data.data
      .filter((p) => p.status === 'granted' && typeof p.permission === 'string')
      .map((p) => p.permission as string);
  } catch (error) {
    logger.warn('Failed to fetch Facebook permissions for diagnostics', {
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

type GranularScope = {
  scope?: string;
  target_ids?: Array<string | number>;
};

/**
 * Page IDs the user explicitly selected during Login (granular permissions).
 * These often exist even when /me/accounts returns [] for Business Suite pages.
 */
export async function fetchPageIdsFromGranularScopes(
  userAccessToken: string
): Promise<string[]> {
  const appId = process.env.FACEBOOK_APP_ID;
  const appSecret = process.env.FACEBOOK_APP_SECRET;
  if (!appId || !appSecret) return [];

  try {
    const appToken = `${appId}|${appSecret}`;
    const resp = await fetch(
      `https://graph.facebook.com/${GRAPH_VERSION}/debug_token` +
        `?input_token=${encodeURIComponent(userAccessToken)}` +
        `&access_token=${encodeURIComponent(appToken)}`
    );
    const body = (await resp.json()) as {
      data?: {
        granular_scopes?: GranularScope[];
        scopes?: string[];
      };
      error?: { message?: string };
    };

    if (!resp.ok || body.error || !body.data) {
      logger.warn('Facebook debug_token failed', { error: body.error || null });
      return [];
    }

    const pageRelated = new Set([
      'pages_show_list',
      'pages_messaging',
      'pages_manage_metadata',
      'pages_read_engagement',
      'pages_manage_posts',
      'publish_video',
      'pages_manage_engagement',
      'pages_read_user_content',
    ]);

    const ids = new Set<string>();
    for (const entry of body.data.granular_scopes || []) {
      if (!entry.scope || !pageRelated.has(entry.scope)) continue;
      for (const raw of entry.target_ids || []) {
        const id = String(raw).trim();
        if (id) ids.add(id);
      }
    }

    logger.info('Facebook granular page targets resolved', {
      count: ids.size,
      scopes: (body.data.granular_scopes || []).map((s) => s.scope).filter(Boolean),
    });

    return [...ids];
  } catch (error) {
    logger.warn('Failed to resolve granular page targets', {
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

async function fetchPageById(
  pageId: string,
  userAccessToken: string,
  fields: string
): Promise<FacebookManagedPage | null> {
  try {
    const resp = await fetch(
      `https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(pageId)}` +
        `?fields=${encodeURIComponent(fields)}` +
        `&access_token=${encodeURIComponent(userAccessToken)}`
    );
    const data = (await resp.json()) as FacebookManagedPage & {
      error?: { message?: string; code?: number };
    };
    if (!resp.ok || data.error || !data.id) {
      logger.warn('Failed to fetch Facebook page by id', {
        pageId,
        error: data.error || { status: resp.status },
      });
      return null;
    }
    return {
      id: String(data.id),
      name: data.name,
      access_token: data.access_token,
      category: data.category,
      picture: data.picture,
      instagram_business_account: data.instagram_business_account,
    };
  } catch (error) {
    logger.warn('Failed to fetch Facebook page by id', {
      pageId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

async function fetchAssignedPages(
  userAccessToken: string,
  fields: string
): Promise<FacebookManagedPage[]> {
  // Task-based page access (Business Manager assignments)
  return fetchPagedGraphNodes<FacebookManagedPage>(
    `https://graph.facebook.com/${GRAPH_VERSION}/me/assigned_pages` +
      `?fields=${encodeURIComponent(fields)}` +
      `&limit=100&access_token=${encodeURIComponent(userAccessToken)}`,
    'me/assigned_pages'
  );
}

async function fetchBusinessOwnedAndClientPages(
  userAccessToken: string,
  fields: string
): Promise<FacebookManagedPage[]> {
  const businesses = await fetchPagedGraphNodes<{ id: string; name?: string }>(
    `https://graph.facebook.com/${GRAPH_VERSION}/me/businesses` +
      `?fields=id,name&limit=50&access_token=${encodeURIComponent(userAccessToken)}`,
    'me/businesses'
  );

  const pages: FacebookManagedPage[] = [];
  const seen = new Set<string>();

  for (const business of businesses) {
    for (const edge of ['owned_pages', 'client_pages'] as const) {
      const batch = await fetchPagedGraphNodes<FacebookManagedPage>(
        `https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(business.id)}/${edge}` +
          `?fields=${encodeURIComponent(fields)}` +
          `&limit=100&access_token=${encodeURIComponent(userAccessToken)}`,
        `business/${edge}`
      );
      for (const page of batch) {
        const id = String(page.id);
        if (seen.has(id)) continue;
        seen.add(id);
        pages.push(page);
      }
    }
  }

  return pages;
}

function mergePages(batches: FacebookManagedPage[][]): FacebookManagedPage[] {
  const byId = new Map<string, FacebookManagedPage>();
  for (const batch of batches) {
    for (const page of batch) {
      if (!page?.id) continue;
      const id = String(page.id);
      const prev = byId.get(id);
      if (!prev) {
        byId.set(id, page);
        continue;
      }
      byId.set(id, {
        ...prev,
        ...page,
        access_token: page.access_token || prev.access_token,
        name: page.name || prev.name,
      });
    }
  }
  return [...byId.values()];
}

/**
 * Resolve managed pages with fallbacks for Meta Business Suite / granular Login.
 * Order: /me/accounts → assigned_pages → businesses → granular target IDs.
 */
export async function resolveManagedFacebookPages(
  userAccessToken: string,
  fields = 'id,name,access_token,category,picture'
): Promise<{
  pages: FacebookManagedPage[];
  source: 'accounts' | 'assigned' | 'business' | 'granular' | 'none';
}> {
  const fromAccounts = await fetchAllManagedFacebookPages(userAccessToken, fields);
  if (fromAccounts.length > 0) {
    return { pages: fromAccounts, source: 'accounts' };
  }

  const fromAssigned = await fetchAssignedPages(userAccessToken, fields);
  if (fromAssigned.length > 0) {
    logger.info('Facebook pages resolved via me/assigned_pages', {
      count: fromAssigned.length,
    });
    return { pages: fromAssigned, source: 'assigned' };
  }

  const fromBusiness = await fetchBusinessOwnedAndClientPages(userAccessToken, fields);
  if (fromBusiness.length > 0) {
    logger.info('Facebook pages resolved via businesses', {
      count: fromBusiness.length,
    });
    return { pages: fromBusiness, source: 'business' };
  }

  const targetIds = await fetchPageIdsFromGranularScopes(userAccessToken);
  if (targetIds.length > 0) {
    const fromTargets: FacebookManagedPage[] = [];
    for (const pageId of targetIds) {
      const page = await fetchPageById(pageId, userAccessToken, fields);
      if (page) fromTargets.push(page);
    }
    if (fromTargets.length > 0) {
      logger.info('Facebook pages resolved via granular target IDs', {
        count: fromTargets.length,
      });
      return { pages: fromTargets, source: 'granular' };
    }
  }

  return { pages: mergePages([fromAccounts, fromAssigned, fromBusiness]), source: 'none' };
}
