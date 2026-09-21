/**
 * 10-product live-eval catalog: varied colors, sizes, stock, currencies.
 * Complements REAL_TEST_CATALOG (watch/shirt/mobile).
 */
import type { Product } from '../../../core/types.js';
import { REAL_TEST_CATALOG } from '../realTestCatalog.js';

export const LIVE_EXTRA_CATALOG: readonly Product[] = Object.freeze([
  {
    id: 'shoes-sar-350',
    name: 'حذاء رياضي',
    price: 350,
    currency: 'SAR',
    stock: 40,
    description: 'حذاء جري',
    category: 'أحذية',
    colors: ['أبيض', 'أسود'],
    sizes: ['40', '41', '42', '43'],
    imageUrl: 'https://cdn.example.test/shoes.jpg',
  },
  {
    id: 'bag-usd-89',
    name: 'حقيبة يد',
    price: 89,
    currency: 'USD',
    stock: 12,
    description: 'حقيبة جلد',
    category: 'حقائب',
    colors: ['بني', 'أسود'],
    sizes: [],
    imageUrl: 'https://cdn.example.test/bag.jpg',
  },
  {
    id: 'perfume-aed-220',
    name: 'عطر',
    price: 220,
    currency: 'AED',
    stock: 8,
    description: 'عطر رجالي',
    category: 'عطور',
    colors: [],
    sizes: ['50ml', '100ml'],
    imageUrl: 'https://cdn.example.test/perfume.jpg',
  },
  {
    id: 'headphones-sar-499',
    name: 'سماعة',
    price: 499,
    currency: 'SAR',
    stock: 25,
    description: 'سماعة لاسلكية',
    category: 'إلكترونيات',
    colors: ['أسود', 'أزرق'],
    sizes: [],
    imageUrl: 'https://cdn.example.test/headphones.jpg',
  },
  {
    id: 'dress-usd-120',
    name: 'فستان',
    price: 120,
    currency: 'USD',
    stock: 6,
    description: 'فستان سهرة',
    category: 'ملابس',
    colors: ['أحمر', 'أسود', 'ذهبي'],
    sizes: ['S', 'M', 'L'],
    imageUrl: 'https://cdn.example.test/dress.jpg',
  },
  {
    id: 'tablet-sar-1500',
    name: 'تابلت',
    price: 1500,
    currency: 'SAR',
    stock: 0,
    description: 'تابلت 10 إنش',
    category: 'إلكترونيات',
    colors: ['رمادي', 'أسود'],
    sizes: [],
    imageUrl: 'https://cdn.example.test/tablet.jpg',
  },
  {
    id: 'mug-sar-45',
    name: 'كوب',
    price: 45,
    currency: 'SAR',
    stock: 100,
    description: 'كوب سيراميك',
    category: 'منزل',
    colors: ['أبيض', 'أزرق', 'أخضر'],
    sizes: [],
    imageUrl: 'https://cdn.example.test/mug.jpg',
  },
]);

/** Combined 10 SKUs: 3 real-test + 7 extras. */
export const LIVE_TEN_PRODUCT_CATALOG: readonly Product[] = Object.freeze([
  ...REAL_TEST_CATALOG,
  ...LIVE_EXTRA_CATALOG,
]);
