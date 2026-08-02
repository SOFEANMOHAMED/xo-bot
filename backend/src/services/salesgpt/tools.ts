/**
 * SalesGPT Tools - External tools the sales agent can use
 * Integrates with existing product search, catalog, and order system
 */

import {
    searchProducts,
    getTopProducts,
    getProductsOverview,
    getCatalogMeta
} from '../../catalog/product-search.js';
import type { Product, MerchantConfig } from '../../core/types.js';
import { logger } from '../../utils/logger.js';
import { getCurrencyDisplayName } from '../../utils/currencyDisplayName.js';

// ==================== TOOL DEFINITIONS ====================

export interface SalesGPTTool {
    name: string;
    description: string;
    func: (input: string, context: ToolContext) => Promise<string>;
}

export interface ToolContext {
    merchantId: string;
    merchantConfig: MerchantConfig;
    products: Product[];
}

// ==================== PRODUCT SEARCH TOOL ====================

const productSearchTool = async (query: string, context: ToolContext): Promise<string> => {
    try {
        const products = await searchProducts(context.merchantId, query, {}, 5);

        if (products.length === 0) {
            return context.merchantConfig.botLanguage === 'auto' || !context.merchantConfig.botLanguage
                ? `عذراً، لم أجد منتجات تطابق "${query}". جرب كلمات بحث مختلفة.`
                : `Sorry, no products found matching "${query}". Try different search terms.`;
        }

        const currencyCode = context.merchantConfig.storeCurrency || 'USD';
        const currencyLabel = getCurrencyDisplayName(
            currencyCode,
            context.merchantConfig.botLanguage === 'english' ? 'english' : 'arabic'
        );
        const productList = products.map((p, i) => {
            let info = `${i + 1}. ${p.name} - ${p.price} ${currencyLabel}`;
            if (p.stock !== undefined) {
                info += p.stock > 0 ? ` (متوفر: ${p.stock})` : ` (غير متوفر)`;
            }
            if (p.colors && p.colors.length > 0) {
                info += ` | ألوان: ${p.colors.join('، ')}`;
            }
            if (p.sizes && p.sizes.length > 0) {
                info += ` | مقاسات: ${p.sizes.join('، ')}`;
            }
            return info;
        }).join('\n');

        return productList;
    } catch (error) {
        logger.error('Product search tool failed', error as Error);
        return 'عذراً، حدث خطأ في البحث. يرجى المحاولة مرة أخرى.';
    }
};

// ==================== PRODUCT DETAILS TOOL ====================

const productDetailsTool = async (productName: string, context: ToolContext): Promise<string> => {
    try {
        // First try to find from already loaded products
        let product = context.products.find(
            p => p.name.toLowerCase().includes(productName.toLowerCase()) ||
                productName.toLowerCase().includes(p.name.toLowerCase())
        );

        // If not found, search
        if (!product) {
            const results = await searchProducts(context.merchantId, productName, {}, 1);
            product = results[0];
        }

        if (!product) {
            return `عذراً، لم أجد منتج "${productName}".`;
        }

        const currencyCode = context.merchantConfig.storeCurrency || 'USD';
        const currencyLabel = getCurrencyDisplayName(
            currencyCode,
            context.merchantConfig.botLanguage === 'english' ? 'english' : 'arabic'
        );
        let details = `📦 ${product.name}\n`;
        details += `💰 السعر: ${product.price} ${currencyLabel}\n`;

        if (product.description) {
            details += `📝 الوصف: ${product.description}\n`;
        }
        if (product.stock !== undefined) {
            details += `📊 المخزون: ${product.stock > 0 ? `${product.stock} قطعة` : 'غير متوفر'}\n`;
        }
        if (product.colors && product.colors.length > 0) {
            details += `🎨 الألوان: ${product.colors.join('، ')}\n`;
        }
        if (product.sizes && product.sizes.length > 0) {
            details += `📏 المقاسات: ${product.sizes.join('، ')}\n`;
        }
        if (product.imageUrl) {
            details += `📸 صورة متوفرة\n`;
        }

        return details;
    } catch (error) {
        logger.error('Product details tool failed', error as Error);
        return 'عذراً، حدث خطأ. يرجى المحاولة مرة أخرى.';
    }
};

// ==================== CATALOG TOOL ====================

const catalogTool = async (_input: string, context: ToolContext): Promise<string> => {
    try {
        const products = await getTopProducts(context.merchantId, 5);

        if (products.length === 0) {
            return 'عذراً، لا توجد منتجات متوفرة حالياً.';
        }

        const currencyCode = context.merchantConfig.storeCurrency || 'USD';
        const currencyLabel = getCurrencyDisplayName(
            currencyCode,
            context.merchantConfig.botLanguage === 'english' ? 'english' : 'arabic'
        );
        const catalog = products.map((p, i) => {
            return `${i + 1}. ${p.name} - ${p.price} ${currencyLabel}${p.stock && p.stock > 0 ? ' ✅' : ' ❌'}`;
        }).join('\n');

        return `📦 المنتجات المتوفرة:\n${catalog}`;
    } catch (error) {
        logger.error('Catalog tool failed', error as Error);
        return 'عذراً، حدث خطأ في عرض المنتجات.';
    }
};

// ==================== CATALOG OVERVIEW TOOL ====================

const catalogOverviewTool = async (_input: string, context: ToolContext): Promise<string> => {
    try {
        const [overview, meta] = await Promise.all([
            getProductsOverview(context.merchantId, 20),
            getCatalogMeta(context.merchantId)
        ]);

        if (overview.length === 0) {
            return 'عذراً، لا توجد منتجات متوفرة حالياً.';
        }

        const list = overview.slice(0, 10).map((p, i) => {
            const currencyLabel = getCurrencyDisplayName(
                p.currency || context.merchantConfig.storeCurrency || 'USD',
                context.merchantConfig.botLanguage === 'english' ? 'english' : 'arabic'
            );
            const stock = p.inStock ? '✅' : '❌';
            const category = p.category ? ` | ${p.category}` : '';
            return `${i + 1}. ${p.name}${category} - ${p.price} ${currencyLabel} ${stock}`;
        }).join('\n');

        const categories = meta.categories
            .slice(0, 5)
            .map(c => `${c.name}(${c.count})`)
            .join('، ');

        return `📚 نظرة عامة على الكتالوج:\n${list}\n\nإجمالي المنتجات: ${meta.totalProducts} | المتوفر: ${meta.inStockProducts}\nأبرز التصنيفات: ${categories}`;
    } catch (error) {
        logger.error('Catalog overview tool failed', error as Error);
        return 'عذراً، حدث خطأ في عرض الكتالوج.';
    }
};

// ==================== CHECK AVAILABILITY TOOL ====================

const checkAvailabilityTool = async (productName: string, context: ToolContext): Promise<string> => {
    try {
        const results = await searchProducts(context.merchantId, productName, {}, 1);

        if (results.length === 0) {
            return `عذراً، لم أجد منتج "${productName}".`;
        }

        const product = results[0];
        if (product.stock === undefined || product.stock <= 0) {
            return `${product.name} غير متوفر حالياً ❌`;
        }

        if (product.stock <= 3) {
            return `${product.name} متوفر ✅ لكن متبقي ${product.stock} قطع فقط! 🔥 سارع بالطلب!`;
        }

        if (product.stock <= 10) {
            return `${product.name} متوفر ✅ (${product.stock} قطعة) ⚡`;
        }

        return `${product.name} متوفر بكميات جيدة ✅ (${product.stock} قطعة)`;
    } catch (error) {
        logger.error('Check availability tool failed', error as Error);
        return 'عذراً، حدث خطأ في التحقق من التوفر.';
    }
};

// ==================== GET ALL TOOLS ====================

export const getSalesGPTTools = (): SalesGPTTool[] => {
    return [
        {
            name: "ProductSearch",
            description: "مفيدة للبحث عن المنتجات واقتراح منتجات للعميل بناءً على طلبه. المدخل هو كلمة البحث.",
            func: productSearchTool
        },
        {
            name: "ProductDetails",
            description: "مفيدة لعرض تفاصيل منتج محدد (السعر، الوصف، الألوان، المقاسات). المدخل هو اسم المنتج.",
            func: productDetailsTool
        },
        {
            name: "ShowCatalog",
            description: "مفيدة لعرض كتالوج المنتجات المتوفرة في المتجر. المدخل غير مهم.",
            func: catalogTool
        },
        {
            name: "CatalogOverview",
            description: "مفيدة لإعطاء نظرة عامة مختصرة على الكتالوج (أبرز منتجات + عدد المنتجات + التصنيفات).",
            func: catalogOverviewTool
        },
        {
            name: "CheckAvailability",
            description: "مفيدة للتحقق من توفر منتج معين ومعرفة الكمية المتاحة. المدخل هو اسم المنتج.",
            func: checkAvailabilityTool
        }
    ];
};

/**
 * Execute a tool by name
 */
export const executeTool = async (
    toolName: string,
    toolInput: string,
    context: ToolContext
): Promise<string> => {
    const tools = getSalesGPTTools();
    const tool = tools.find(t => t.name === toolName);

    if (!tool) {
        return `أداة "${toolName}" غير متوفرة.`;
    }

    logger.info('Executing SalesGPT tool', { toolName, toolInput });
    return await tool.func(toolInput, context);
};
