import type { Product } from '../../core/types.js';

/**
 * Real playground catalog captured by the regression backup.
 * Keep these values exact: several tests guard cross-product/currency leakage.
 */
export const REAL_TEST_WATCH: Product = {
  id: 'watch-sar-200',
  name: 'ساعة',
  price: 200,
  currency: 'SAR',
  stock: 15,
  description: 'ساعة يد',
  category: 'ساعات',
  colors: ['أسود', 'أحمر'],
  sizes: [],
  imageUrl: 'https://cdn.example.test/watch.jpg',
};

export const REAL_TEST_SHIRT: Product = {
  id: 'shirt-usd-553',
  name: 'قميص',
  price: 553,
  currency: 'USD',
  stock: 529,
  description: 'قميص',
  category: 'قمصان',
  colors: [],
  sizes: [],
  imageUrl: 'https://cdn.example.test/shirt.jpg',
};

export const REAL_TEST_MOBILE: Product = {
  id: 'mobile-sar-1000',
  name: 'موبايل',
  price: 1000,
  currency: 'SAR',
  stock: 0,
  description: 'هاتف',
  category: 'هواتف',
  colors: ['Samsung', 'Apple', 'Xiaomi'],
  sizes: [],
  imageUrl: 'https://cdn.example.test/mobile.jpg',
};

export const REAL_TEST_CATALOG: readonly Product[] = Object.freeze([
  REAL_TEST_WATCH,
  REAL_TEST_SHIRT,
  REAL_TEST_MOBILE,
]);
