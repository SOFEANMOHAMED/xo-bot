import { AppView, AdminView } from '../types';

/** Public auth & marketing paths */
export const PATHS = {
  HOME: '/',
  LOGIN: '/login',
  SIGNUP: '/signup',
  FORGOT_PASSWORD: '/forgot-password',
  RESET_PASSWORD: '/reset-password',
  COMPLETE_PROFILE: '/complete-profile',
  /** Legacy OAuth callback alias → redirects to APP_INTEGRATIONS */
  INTEGRATIONS_LEGACY: '/integrations',
  APP: '/app',
  ADMIN: '/admin',
} as const;

/** Merchant app view → URL slug under /app/:slug */
export const APP_VIEW_SLUG: Record<AppView, string> = {
  [AppView.DASHBOARD]: 'dashboard',
  [AppView.PRODUCTS]: 'products',
  [AppView.SERVICES]: 'services',
  [AppView.SERVICE_BOT]: 'service-bot',
  [AppView.ORDERS]: 'orders',
  [AppView.IMAGE_STUDIO]: 'image-studio',
  [AppView.CHAT_TEST]: 'chat-test',
  [AppView.INTEGRATIONS]: 'integrations',
  [AppView.SOCIAL_AUTOMATION]: 'social-automation',
  [AppView.SETTINGS]: 'settings',
  [AppView.AFFILIATE]: 'affiliate',
  [AppView.NOTIFICATIONS]: 'notifications',
  [AppView.CRM]: 'crm',
  [AppView.ANALYTICS]: 'analytics',
  [AppView.SUPPORT_TICKETS]: 'support',
  [AppView.SUPER_ADMIN]: 'super-admin',
  [AppView.PROFILE]: 'profile',
};

/** Admin panel view → URL slug under /admin/:slug */
export const ADMIN_VIEW_SLUG: Record<AdminView, string> = {
  [AdminView.OVERVIEW]: 'overview',
  [AdminView.USERS]: 'users',
  [AdminView.SUBSCRIPTIONS]: 'subscriptions',
  [AdminView.USAGE]: 'usage',
  [AdminView.AFFILIATE_PROGRAM]: 'affiliate',
  [AdminView.TRIALS]: 'trials',
  [AdminView.ALERTS]: 'alerts',
  [AdminView.PAGES]: 'pages',
  [AdminView.SETTINGS]: 'settings',
  [AdminView.LOGS]: 'logs',
  [AdminView.NOTIFICATIONS]: 'notifications',
  [AdminView.EMAIL_BROADCAST]: 'email-broadcast',
  [AdminView.USER_NOTIFICATIONS]: 'user-notifications',
  [AdminView.SUPPORT_TICKETS]: 'support',
  [AdminView.PAYMENT_REQUESTS]: 'payment-requests',
};

const slugToAppView = Object.fromEntries(
  Object.entries(APP_VIEW_SLUG).map(([view, slug]) => [slug, view as AppView])
) as Record<string, AppView>;

const slugToAdminView = Object.fromEntries(
  Object.entries(ADMIN_VIEW_SLUG).map(([view, slug]) => [slug, view as AdminView])
) as Record<string, AdminView>;

export function appPath(view: AppView): string {
  return `${PATHS.APP}/${APP_VIEW_SLUG[view]}`;
}

export function adminPath(view: AdminView): string {
  return `${PATHS.ADMIN}/${ADMIN_VIEW_SLUG[view]}`;
}

export function appViewFromSlug(slug: string | undefined): AppView {
  if (!slug) return AppView.DASHBOARD;
  return slugToAppView[slug] ?? AppView.DASHBOARD;
}

export function adminViewFromSlug(slug: string | undefined): AdminView {
  if (!slug) return AdminView.OVERVIEW;
  return slugToAdminView[slug] ?? AdminView.OVERVIEW;
}

export function isKnownAppSlug(slug: string): boolean {
  return slug in slugToAppView;
}

export function isKnownAdminSlug(slug: string): boolean {
  return slug in slugToAdminView;
}

/** Reserved first-segment paths that must not be treated as CMS page slugs */
export const RESERVED_ROOT_SEGMENTS = new Set([
  'login',
  'signup',
  'forgot-password',
  'reset-password',
  'complete-profile',
  'integrations',
  'app',
  'admin',
  'api',
  'webhooks',
]);
