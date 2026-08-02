/**
 * Shopify API Configuration
 * Centralized configuration for Shopify API version and endpoints
 */

/**
 * Get Shopify API version from environment variable
 * Defaults to '2025-01' if not set
 */
export const getShopifyApiVersion = (): string => {
  return process.env.SHOPIFY_API_VERSION || '2025-01';
};

/**
 * Build Shopify Admin API URL
 * @param shopDomain - Shopify shop domain (e.g., 'mystore.myshopify.com')
 * @param endpoint - API endpoint (e.g., 'products.json', 'orders.json')
 * @param queryParams - Optional query parameters
 * @returns Full Shopify Admin API URL
 */
export const buildShopifyAdminApiUrl = (
  shopDomain: string,
  endpoint: string,
  queryParams?: string
): string => {
  const apiVersion = getShopifyApiVersion();
  const baseUrl = `https://${shopDomain}/admin/api/${apiVersion}/${endpoint}`;
  return queryParams ? `${baseUrl}${queryParams}` : baseUrl;
};

/**
 * Get Shopify Admin API base URL (without endpoint)
 * @param shopDomain - Shopify shop domain
 * @returns Base URL for Shopify Admin API
 */
export const getShopifyAdminApiBaseUrl = (shopDomain: string): string => {
  const apiVersion = getShopifyApiVersion();
  return `https://${shopDomain}/admin/api/${apiVersion}`;
};

