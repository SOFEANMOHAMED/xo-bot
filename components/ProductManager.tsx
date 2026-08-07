
import React, { useState, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Product } from '../types';
import { Plus, Search, Trash2, Edit2, FileSpreadsheet, Download, Upload, Sparkles, Loader2, X, AlertCircle, Package, Star } from 'lucide-react';
import { utils, writeFile } from 'xlsx';
import apiService from '../services/api';
import { useDebounce } from '../hooks/useDebounce';
import { validateProduct, validateURL, validateLength } from '../utils/validation';
import { compressImageDataUrlForAI, getProductImageDisplaySrc } from '../utils/productImage';
import SkeletonLoader from './SkeletonLoader';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';

interface ProductManagerProps {
  products: Product[];
  onAddProduct: (p: Product) => void;
  onUpdateProduct: (p: Product) => void;
  onDeleteProduct: (id: string) => void;
  isLoading?: boolean;
  storeCurrency?: string;
}

const MAX_PRODUCT_IMAGES = 10;

const ProductManager: React.FC<ProductManagerProps> = ({ products, onAddProduct, onUpdateProduct, onDeleteProduct, isLoading = false, storeCurrency = 'USD' }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const debouncedSearchTerm = useDebounce(searchTerm, 300);
  const [showModal, setShowModal] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Product | null>(null);
  const [newProduct, setNewProduct] = useState<Partial<Product>>({
    name: '',
    price: 0,
    category: '',
    stock: 0,
    description: '',
    sizes: [],
    colors: [],
    currency: storeCurrency,
    imageUrl: '',
    images: []
  });

  // Local state for AI generation
  const [keywords, setKeywords] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [selectedProducts, setSelectedProducts] = useState<Set<string>>(new Set());
  const [sizesInput, setSizesInput] = useState('');
  const [colorsInput, setColorsInput] = useState('');
  /** Color assigned to each gallery image (parallel to productImages) */
  const [imageColors, setImageColors] = useState<(string | null)[]>([]);

  const availableColors = useMemo(
    () =>
      colorsInput
        .split(/[,،]/)
        .map((c) => c.trim())
        .filter((c) => c.length > 0),
    [colorsInput]
  );

  /** Drop image↔color links for colors removed from the product colors list */
  const pruneImageColors = useCallback(
    (colors: string[], currentLinks: (string | null)[]) => {
      const allowed = new Set(colors);
      return currentLinks.map((c) => (c && allowed.has(c) ? c : null));
    },
    []
  );

  const handleColorsInputChange = (value: string) => {
    setColorsInput(value);
    const nextAvailable = value
      .split(/[,،]/)
      .map((c) => c.trim())
      .filter((c) => c.length > 0);
    setImageColors((prev) => {
      const pruned = pruneImageColors(nextAvailable, prev);
      setNewProduct((p) => ({ ...p, imageColors: pruned }));
      return pruned;
    });
  };

  const productImages = useMemo(() => {
    if (newProduct.images && newProduct.images.length > 0) return newProduct.images;
    if (newProduct.imageUrl) return [newProduct.imageUrl];
    return [];
  }, [newProduct.images, newProduct.imageUrl]);

  const filteredProducts = products.filter(p => 
    p.name.toLowerCase().includes(debouncedSearchTerm.toLowerCase()) || 
    p.category.toLowerCase().includes(debouncedSearchTerm.toLowerCase())
  );

  const setProductImages = (images: string[], colors?: (string | null)[]) => {
    setNewProduct((prev) => ({
      ...prev,
      images,
      imageUrl: images[0] || '',
      imageColors: colors !== undefined ? colors : prev.imageColors
    }));
    if (colors !== undefined) {
      setImageColors(colors);
    } else {
      setImageColors((prev) => {
        const next = images.map((_, i) => prev[i] ?? null);
        return next;
      });
    }
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (files.length === 0) return;

    const remaining = MAX_PRODUCT_IMAGES - productImages.length;
    if (remaining <= 0) {
      setValidationErrors([`يمكنك رفع ${MAX_PRODUCT_IMAGES} صور كحد أقصى للمنتج`]);
      return;
    }

    const toRead = files.slice(0, remaining);
    Promise.all(
      toRead.map(
        (file) =>
          new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result as string);
            reader.onerror = () => reject(new Error('فشل قراءة الصورة'));
            reader.readAsDataURL(file);
          })
      )
    )
      .then((dataUrls) => {
        const startIndex = productImages.length;
        const nextColors = [
          ...imageColors.slice(0, startIndex),
          ...dataUrls.map((_, i) => availableColors[startIndex + i] || null)
        ];
        setProductImages([...productImages, ...dataUrls], nextColors);
        setValidationErrors([]);
      })
      .catch(() => {
        setValidationErrors(['فشل قراءة بعض الصور']);
      });
  };

  const handleRemoveImage = (index: number) => {
    const nextImages = productImages.filter((_, i) => i !== index);
    const nextColors = imageColors.filter((_, i) => i !== index);
    setProductImages(nextImages, nextColors);
  };

  const handleSetPrimaryImage = (index: number) => {
    if (index <= 0 || index >= productImages.length) return;
    const nextImages = [...productImages];
    const nextColors = [...imageColors];
    while (nextColors.length < nextImages.length) nextColors.push(null);
    const [pickedImg] = nextImages.splice(index, 1);
    const [pickedColor] = nextColors.splice(index, 1);
    nextImages.unshift(pickedImg);
    nextColors.unshift(pickedColor ?? null);
    setProductImages(nextImages, nextColors);
  };

  const handleImageColorChange = (index: number, color: string) => {
    const next = [...imageColors];
    while (next.length < productImages.length) next.push(null);
    next[index] = color.trim() ? color.trim() : null;
    setImageColors(next);
    setNewProduct((prev) => ({ ...prev, imageColors: next }));
  };

  const handleEditClick = (product: Product) => {
    const images =
      product.images && product.images.length > 0
        ? product.images
        : product.imageUrl
          ? [product.imageUrl]
          : [];
    const linkedColors =
      product.imageColors && product.imageColors.length > 0
        ? images.map((_, i) => product.imageColors?.[i] ?? null)
        : images.map((_, i) => product.colors?.[i] ?? null);
    setNewProduct({ ...product, images, imageUrl: images[0] || '', imageColors: linkedColors });
    setImageColors(linkedColors);
    setSizesInput(product.sizes ? product.sizes.join(', ') : '');
    setColorsInput(product.colors ? product.colors.join(', ') : '');
    setKeywords(''); // Reset keywords on edit
    setGenerationError(null);
    setShowModal(true);
  };

  const handleOpenAddModal = useCallback(() => {
    setNewProduct({ name: '', price: 0, category: '', stock: 0, description: '', sizes: [], colors: [], currency: storeCurrency, imageUrl: '', images: [], imageColors: [] });
    setImageColors([]);
    setSizesInput('');
    setColorsInput('');
    setKeywords('');
    setGenerationError(null);
    setShowModal(true);
  }, [storeCurrency]);

  // Keyboard shortcuts - must be after handleOpenAddModal is defined
  const keyboardShortcuts = useMemo(() => [
    {
      key: 'n',
      ctrlKey: true,
      action: handleOpenAddModal,
      description: 'إضافة منتج جديد'
    },
    {
      key: 'f',
      ctrlKey: true,
      action: () => {
        const searchInput = document.querySelector('input[placeholder*="بحث"]') as HTMLInputElement;
        searchInput?.focus();
      },
      description: 'التركيز على البحث'
    }
  ], [handleOpenAddModal]);

  useKeyboardShortcuts(keyboardShortcuts);

  const handleSave = () => {
    const errors: string[] = [];
    
    // Validate product data
    const validation = validateProduct({
      name: newProduct.name,
      price: newProduct.price,
      category: newProduct.category,
      stock: newProduct.stock
    });

    if (!validation.isValid) {
      errors.push(...validation.errors);
    }

    // Validate description length if provided
    if (newProduct.description && newProduct.description.length > 5000) {
      errors.push('الوصف طويل جداً (الحد الأقصى 5000 حرف)');
    }

    // Validate image URLs if provided (and not base64)
    for (const img of productImages) {
      if (img && !img.startsWith('data:')) {
        const urlValidation = validateURL(img, false);
        if (!urlValidation.isValid) {
          errors.push(...urlValidation.errors);
          break;
        }
      }
    }

    if (productImages.length > MAX_PRODUCT_IMAGES) {
      errors.push(`يمكنك رفع ${MAX_PRODUCT_IMAGES} صور كحد أقصى للمنتج`);
    }

    if (errors.length > 0) {
      setValidationErrors(errors);
      return;
    }

    setValidationErrors([]);

    // Convert sizes and colors from input strings to arrays
    const sizesArray = sizesInput ? sizesInput.split(/[,،]/).map(s => s.trim()).filter(s => s.length > 0) : [];
    const colorsArray = colorsInput ? colorsInput.split(/[,،]/).map(c => c.trim()).filter(c => c.length > 0) : [];

    const primaryImage =
      productImages[0] ||
      (newProduct.id
        ? ''
        : `https://picsum.photos/200/200?random=${Math.floor(Math.random() * 1000)}`);
    const imagesPayload =
      productImages.length > 0
        ? productImages
        : primaryImage
          ? [primaryImage]
          : [];
    const linkedColors = pruneImageColors(
      colorsArray,
      imagesPayload.map((_, i) => imageColors[i] ?? null)
    );

    if (newProduct.id) {
      // Update existing product
      onUpdateProduct({
        ...newProduct,
        sizes: sizesArray,
        colors: colorsArray,
        imageUrl: primaryImage,
        images: imagesPayload,
        imageColors: linkedColors
      } as Product);
    } else {
      // Add new product
      onAddProduct({
        ...newProduct,
        sizes: sizesArray,
        colors: colorsArray,
        id: Math.random().toString(36).substring(2, 11),
        imageUrl: primaryImage,
        images: imagesPayload,
        imageColors: linkedColors
      } as Product);
    }
    
    setShowModal(false);
    setNewProduct({ name: '', price: 0, category: '', stock: 0, description: '', sizes: [], colors: [], currency: storeCurrency, imageUrl: '', images: [], imageColors: [] });
    setImageColors([]);
    setSizesInput('');
    setColorsInput('');
    setKeywords('');
    setValidationErrors([]);
  };

  const handleGenerateDescription = async () => {
    if (!newProduct.name) {
      return;
    }

    setIsGenerating(true);
    setGenerationError(null);

    const primary = productImages[0];
    let imageToSend: string | undefined = primary?.startsWith('data:') ? primary : undefined;

    try {
      // Compress before POST — full camera/phone data URLs often exceed nginx 1mb → HTTP 413
      if (imageToSend) {
        imageToSend = await compressImageDataUrlForAI(imageToSend);
      }

      const result = await apiService.generateProductDescriptionAI({
        productName: newProduct.name,
        keywords: keywords || '',
        category: newProduct.category || 'عام',
        imageBase64: imageToSend
      });

      const featuresLines = (result.features?.length ? result.features : []).map((f) => `- ${f}`).join('\n');
      const formattedDescription = [
        result.description,
        featuresLines ? `\n✨ أبرز المميزات:\n${featuresLines}` : '',
        result.cta ? `\n${result.cta}` : ''
      ]
        .filter(Boolean)
        .join('\n')
        .trim();

      setNewProduct((prev) => ({
        ...prev,
        name: result.title || prev.name,
        description: formattedDescription || result.description || ''
      }));
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'فشل توليد الوصف';
      setGenerationError(msg);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleExportExcel = () => {
    // Transform data for Excel (Arabic headers)
    const exportData = products.map(p => ({
      'المعرف': p.id,
      'اسم المنتج': p.name,
      'السعر': p.price,
      'العملة': p.currency,
      'التصنيف': p.category,
      'المخزون': p.stock,
      'الوصف': p.description,
      'المقاسات': p.sizes?.join(', ') || '',
      'الألوان': p.colors?.join(', ') || '',
      'المصدر': p.source || 'يدوي'
    }));

    // Create Worksheet
    const ws = utils.json_to_sheet(exportData);
    
    // Create Workbook and append worksheet
    const wb = utils.book_new();
    utils.book_append_sheet(wb, ws, "المنتجات");

    // Generate Excel file
    writeFile(wb, `products_export_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white">المنتجات</h2>
          <p className="text-gray-500 dark:text-gray-400">إدارة مخزون المتجر والبيانات التي يستخدمها البوت</p>
        </div>
        <div className="flex gap-3">
           <button className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
            <FileSpreadsheet size={18} />
            <span>استيراد Excel</span>
          </button>
          <button 
            onClick={handleExportExcel}
            className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
          >
            <Download size={18} />
            <span>تصدير Excel</span>
          </button>
          <button 
            onClick={handleOpenAddModal}
            className="flex items-center gap-2 px-4 py-2 bg-brand text-white rounded-xl hover:bg-brand-700 shadow-md shadow-brand/25 dark:shadow-none transition-colors focus:outline-none focus:ring-2 focus:ring-brand focus:ring-offset-2"
            aria-label="إضافة منتج جديد"
          >
            <Plus size={18} aria-hidden="true" />
            <span>منتج جديد</span>
          </button>
        </div>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden transition-colors">
        <div className="p-4 border-b border-gray-100 dark:border-gray-700 flex items-center gap-4">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
            <input 
              type="text" 
              placeholder="بحث عن منتج..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              aria-label="بحث عن منتج"
              className="w-full pr-10 pl-4 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand dark:text-white dark:placeholder-gray-400"
            />
          </div>
        </div>

        {isLoading ? (
          <SkeletonLoader type="table" rows={5} columns={6} />
        ) : (
          <>
            {selectedProducts.size > 0 && (
              <div className="p-4 bg-brand-50 dark:bg-brand-900/20 border-b border-brand-200 dark:border-brand-800 flex items-center justify-between">
                <span className="text-sm font-medium text-brand-900 dark:text-brand-300">
                  {selectedProducts.size} منتج محدد
                </span>
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      selectedProducts.forEach(id => onDeleteProduct(id));
                      setSelectedProducts(new Set());
                    }}
                    className="px-3 py-1.5 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
                  >
                    حذف المحدد ({selectedProducts.size})
                  </button>
                  <button
                    onClick={() => setSelectedProducts(new Set())}
                    className="px-3 py-1.5 text-sm bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
                  >
                    إلغاء التحديد
                  </button>
                </div>
              </div>
            )}
            <div className="overflow-x-auto">
              <table className="w-full text-right" role="table" aria-label="قائمة المنتجات">
            <thead className="bg-gray-50 dark:bg-gray-700/50 text-gray-600 dark:text-gray-300 text-sm font-medium">
              <tr>
                <th scope="col" className="px-6 py-4">
                  <span className="sr-only">تحديد المنتج</span>
                </th>
                <th scope="col" className="px-6 py-4">المنتج</th>
                <th scope="col" className="px-6 py-4">التصنيف</th>
                <th scope="col" className="px-6 py-4">السعر</th>
                <th scope="col" className="px-6 py-4">المخزون</th>
                <th scope="col" className="px-6 py-4">المقاسات</th>
                <th scope="col" className="px-6 py-4">خيارات الألوان</th>
                <th scope="col" className="px-6 py-4">الإجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {filteredProducts.map((product) => (
                <tr key={product.id} className={`hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors ${selectedProducts.has(product.id) ? 'bg-brand-50 dark:bg-brand-900/20' : ''}`}>
                  <td className="px-6 py-4">
                    <input
                      type="checkbox"
                      checked={selectedProducts.has(product.id)}
                      onChange={(e) => {
                        const newSelected = new Set(selectedProducts);
                        if (e.target.checked) {
                          newSelected.add(product.id);
                        } else {
                          newSelected.delete(product.id);
                        }
                        setSelectedProducts(newSelected);
                      }}
                      aria-label={`تحديد ${product.name}`}
                      className="w-4 h-4 text-brand rounded focus:ring-brand"
                    />
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <img 
                        src={getProductImageDisplaySrc(product.id, product.imageUrl)} 
                        alt={`صورة ${product.name}`}
                        loading="lazy"
                        decoding="async"
                        className="w-10 h-10 rounded-lg object-cover bg-gray-200 dark:bg-gray-600"
                        onError={(e) => {
                          (e.target as HTMLImageElement).src = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="40" height="40"%3E%3Crect width="40" height="40" fill="%23e5e7eb"/%3E%3Ctext x="50%25" y="50%25" dominant-baseline="middle" text-anchor="middle" font-family="sans-serif" font-size="10" fill="%236b7280"%3ENo Image%3C/text%3E%3C/svg%3E';
                        }}
                      />
                      <div>
                        <p className="font-semibold text-gray-900 dark:text-white">{product.name}</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400 truncate max-w-[150px]">{product.description}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-gray-600 dark:text-gray-300">
                    <span className="px-3 py-1 bg-gray-100 dark:bg-gray-700 rounded-full text-xs font-medium">
                      {product.category}
                    </span>
                  </td>
                  <td className="px-6 py-4 font-medium text-gray-900 dark:text-white">
                    {product.price} {product.currency}
                  </td>
                  <td className="px-6 py-4">
                    <span className={`px-2 py-1 rounded-md text-xs font-bold ${
                      product.stock > 10 ? 'text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20' : 'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20'
                    }`}>
                      {product.stock} قطعة
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-500 dark:text-gray-400">
                    {product.sizes && product.sizes.length > 0 ? product.sizes.join(', ') : '-'}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-500 dark:text-gray-400">
                    {product.colors && product.colors.length > 0 ? product.colors.join(', ') : '-'}
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex gap-2">
                      <button 
                        onClick={() => handleEditClick(product)}
                        className="p-2 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                        aria-label={`تعديل ${product.name}`}
                      >
                        <Edit2 size={16} aria-hidden="true" />
                      </button>
                      <button 
                        onClick={() => setDeleteTarget(product)}
                        className="p-2 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500"
                        aria-label={`حذف ${product.name}`}
                      >
                        <Trash2 size={16} aria-hidden="true" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
                {filteredProducts.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-6 py-16 text-center">
                      <div className="flex flex-col items-center justify-center">
                        <div className="p-4 bg-gray-100 dark:bg-gray-700 rounded-full mb-4">
                          <Package size={48} className="text-gray-400 dark:text-gray-500" />
                        </div>
                        <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-2">
                          {searchTerm ? 'لا توجد منتجات مطابقة للبحث' : 'لا توجد منتجات'}
                        </h3>
                        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
                          {searchTerm 
                            ? 'جرب كلمات بحث أخرى أو أضف منتجاً جديداً'
                            : 'ابدأ بإضافة منتج جديد لإدارة مخزون متجرك'}
                        </p>
                        {!searchTerm && (
                          <button
                            onClick={handleOpenAddModal}
                            className="flex items-center gap-2 px-4 py-2 bg-brand text-white rounded-lg hover:bg-brand-700 transition-colors"
                          >
                            <Plus size={18} />
                            <span>إضافة منتج جديد</span>
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {/* Modal for Adding/Editing Product */}
      {showModal && createPortal(
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-[10000] p-4 animate-fade-in">
          <div className="bg-white dark:bg-gray-800 rounded-2xl w-full max-w-lg shadow-2xl p-6 animate-fade-in border border-gray-100 dark:border-gray-700 max-h-[90vh] flex flex-col relative z-[10001]">
            <div className="flex items-center justify-between mb-4 shrink-0">
              <h3 className="text-xl font-bold text-gray-900 dark:text-white">
                {newProduct.id ? 'تعديل المنتج' : 'إضافة منتج جديد'}
              </h3>
              <button
                onClick={() => {
                  setShowModal(false);
                  setValidationErrors([]);
                }}
                className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
              >
                <X size={20} />
              </button>
            </div>

            {/* Validation Errors */}
            {validationErrors.length > 0 && (
              <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                <div className="flex items-start gap-2">
                  <AlertCircle size={20} className="text-red-600 dark:text-red-400 mt-0.5 shrink-0" />
                  <div className="flex-1">
                    <p className="text-sm font-medium text-red-800 dark:text-red-300 mb-1">يرجى تصحيح الأخطاء التالية:</p>
                    <ul className="list-disc list-inside text-sm text-red-700 dark:text-red-400 space-y-1">
                      {validationErrors.map((error, index) => (
                        <li key={index}>{error}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            )}
            
            <div className="space-y-4 overflow-y-auto custom-scrollbar p-1 flex-1">
              {/* Product Name */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">اسم المنتج <span className="text-red-500">*</span></label>
                <input 
                  type="text" 
                  required
                  maxLength={200}
                  className="w-full p-2 border border-gray-200 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-brand outline-none"
                  value={newProduct.name}
                  onChange={e => {
                    const value = e.target.value;
                    if (value.length <= 200) {
                      setNewProduct({...newProduct, name: value});
                    }
                  }}
                  placeholder="مثال: قميص قطني فاخر"
                  aria-required="true"
                />
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{newProduct.name.length}/200</p>
              </div>

              {/* Color options — each comma-separated entry is ONE sellable option (may combine colors) */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  خيارات الألوان
                </label>
                <input 
                  type="text" 
                  className="w-full p-2 border border-gray-200 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-brand outline-none"
                  placeholder="أسود وبني، أصفر وأحمر"
                  value={colorsInput}
                  onChange={e => handleColorsInputChange(e.target.value)}
                />
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  افصل الخيارات بفاصلة فقط. التركيبة الواحدة = خيار واحد (مثال: «أسود وبني» قطعة واحدة، وليست لونين منفصلين).
                </p>
                {availableColors.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {availableColors.map((c) => (
                      <span
                        key={c}
                        className="inline-flex items-center px-2 py-0.5 text-xs rounded-md bg-brand/10 text-brand border border-brand/20"
                        title="خيار لون واحد للبيع"
                      >
                        {c}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* Image Upload */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  صور المنتج
                  <span className="text-gray-400 font-normal mr-1">
                    ({productImages.length}/{MAX_PRODUCT_IMAGES})
                  </span>
                </label>
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
                  يمكنك رفع حتى {MAX_PRODUCT_IMAGES} صور. الصورة الأولى هي الرئيسية. اربط كل صورة بخيار لون من القائمة (التركيبة الكاملة مثل «أسود وبني»).
                </p>
                <div className="flex flex-wrap items-start gap-3">
                  {productImages.map((img, index) => {
                    const previewSrc = img.startsWith('data:')
                      ? img
                      : /^https?:\/\//i.test(img)
                        ? img
                        : getProductImageDisplaySrc(newProduct.id, img);
                    const colorValue =
                      imageColors[index] && availableColors.includes(imageColors[index]!)
                        ? imageColors[index]!
                        : '';
                    return (
                    <div
                      key={`${index}-${img.slice(0, 32)}`}
                      className="flex flex-col gap-1.5 w-[7.5rem]"
                    >
                      <div className="relative w-full aspect-square rounded-lg border border-gray-200 dark:border-gray-600 bg-gray-100 dark:bg-gray-700 overflow-hidden group">
                        <img
                          src={previewSrc}
                          alt={colorValue ? `صورة ${colorValue}` : `صورة ${index + 1}`}
                          className="w-full h-full object-cover"
                          onError={(e) => {
                            e.currentTarget.style.display = 'none';
                          }}
                        />
                        {index === 0 && (
                          <span className="absolute bottom-0 inset-x-0 bg-brand/90 text-white text-[9px] text-center py-0.5">
                            رئيسية
                          </span>
                        )}
                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1">
                          {index > 0 && (
                            <button
                              type="button"
                              title="تعيين كرئيسية"
                              onClick={() => handleSetPrimaryImage(index)}
                              className="p-1 rounded bg-white/90 text-gray-800 hover:bg-white"
                            >
                              <Star size={12} />
                            </button>
                          )}
                          <button
                            type="button"
                            title="حذف"
                            onClick={() => handleRemoveImage(index)}
                            className="p-1 rounded bg-white/90 text-red-600 hover:bg-white"
                          >
                            <X size={12} />
                          </button>
                        </div>
                      </div>
                      <select
                        className="w-full text-xs p-1.5 rounded-md border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 focus:ring-2 focus:ring-brand outline-none"
                        value={colorValue}
                        onChange={(e) => handleImageColorChange(index, e.target.value)}
                        aria-label={`لون الصورة ${index + 1}`}
                      >
                        <option value="">بدون لون</option>
                        {availableColors.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>
                    </div>
                    );
                  })}
                  {productImages.length === 0 && (
                    <div className="w-16 h-16 rounded-lg border border-dashed border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-800 flex items-center justify-center">
                      <span className="text-xs text-gray-400 text-center px-1">لا توجد صور</span>
                    </div>
                  )}
                  {productImages.length < MAX_PRODUCT_IMAGES && (
                    <label className="cursor-pointer bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg px-4 py-2 hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors flex items-center gap-2 text-gray-600 dark:text-gray-300 text-sm self-center">
                      <Upload size={18} />
                      <span>{productImages.length ? 'إضافة صور' : 'اختر صور'}</span>
                      <input
                        type="file"
                        accept="image/*"
                        multiple
                        className="hidden"
                        onChange={handleImageUpload}
                      />
                    </label>
                  )}
                </div>
                {productImages.length > 0 && availableColors.length === 0 && (
                  <p className="text-xs text-amber-600 dark:text-amber-400 mt-2">
                    أضف خيارات ألوان أعلاه لتظهر في قائمة ربط كل صورة.
                  </p>
                )}
              </div>

              {/* Price & Stock */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                   <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">السعر <span className="text-red-500">*</span></label>
                   <input 
                    type="number" 
                    required
                    min="0.01"
                    max="1000000"
                    step="0.01"
                    className="w-full p-2 border border-gray-200 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-brand outline-none"
                    value={newProduct.price || ''}
                    onChange={e => {
                      const value = parseFloat(e.target.value);
                      if (!isNaN(value) && value >= 0) {
                        setNewProduct({...newProduct, price: value});
                      } else if (e.target.value === '') {
                        setNewProduct({...newProduct, price: 0});
                      }
                    }}
                    placeholder="0.00"
                    aria-required="true"
                  />
                  {newProduct.price !== undefined && newProduct.price < 0.01 && newProduct.price !== 0 && (
                    <p className="text-xs text-red-600 dark:text-red-400 mt-1">السعر يجب أن يكون أكبر من 0.01</p>
                  )}
                </div>
                <div>
                   <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">المخزون</label>
                   <input 
                    type="number" 
                    min="0"
                    max="1000000"
                    step="1"
                    className="w-full p-2 border border-gray-200 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-brand outline-none"
                    value={newProduct.stock || ''}
                    onChange={e => {
                      const value = parseInt(e.target.value);
                      if (!isNaN(value) && value >= 0) {
                        setNewProduct({...newProduct, stock: value});
                      } else if (e.target.value === '') {
                        setNewProduct({...newProduct, stock: 0});
                      }
                    }}
                    placeholder="0"
                  />
                  {newProduct.stock !== undefined && newProduct.stock < 0 && (
                    <p className="text-xs text-red-600 dark:text-red-400 mt-1">المخزون لا يمكن أن يكون سالباً</p>
                  )}
                </div>
              </div>

              {/* Category */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">التصنيف <span className="text-red-500">*</span></label>
                <input 
                  type="text" 
                  required
                  maxLength={100}
                  className="w-full p-2 border border-gray-200 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-brand outline-none"
                  value={newProduct.category}
                  onChange={e => {
                    const value = e.target.value;
                    if (value.length <= 100) {
                      setNewProduct({...newProduct, category: value});
                    }
                  }}
                  placeholder="مثال: ملابس"
                  aria-required="true"
                />
              </div>

              {/* AI Generation Section */}
              <div className="bg-gradient-to-r from-brand-50 to-brand-50 dark:from-brand-900/20 dark:to-brand-900/20 p-4 rounded-xl border border-brand-100 dark:border-brand-800/50">
                 <div className="flex items-center gap-2 mb-2 text-brand-700 dark:text-brand-300 font-bold text-sm">
                    <Sparkles size={16} />
                    توليد وصف احترافي بالذكاء الاصطناعي
                 </div>
                 <div className="mb-3">
                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">كلمات مفتاحية / مميزات أساسية (اختياري)</label>
                    <input 
                      type="text" 
                      className="w-full p-2 border border-brand-200 dark:border-brand-800 rounded-lg bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-white focus:ring-2 focus:ring-brand outline-none"
                      placeholder="مثال: قطن 100%، مناسب للصيف، ألوان زاهية..."
                      value={keywords}
                      onChange={e => setKeywords(e.target.value)}
                    />
                 </div>
                 <button 
                   onClick={handleGenerateDescription}
                   disabled={isGenerating || !newProduct.name}
                   className="w-full py-2 bg-brand hover:bg-brand-700 text-white rounded-lg text-sm font-medium transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                 >
                   {isGenerating ? (
                     <>
                       <Loader2 size={16} className="animate-spin" />
                       جاري الكتابة...
                     </>
                   ) : (
                     <>
                       <Sparkles size={16} />
                       اكتب الوصف تلقائياً
                     </>
                   )}
                 </button>
                 {generationError && (
                   <p className="text-xs text-red-600 dark:text-red-400 mt-2 text-center" role="alert">
                     {generationError}
                   </p>
                 )}
                 {!newProduct.name && (
                   <p className="text-[10px] text-red-500 mt-1 text-center">يجب إدخال اسم المنتج أولاً</p>
                 )}
              </div>

              {/* Description Field */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">الوصف</label>
                <textarea 
                  maxLength={5000}
                  className="w-full p-2 border border-gray-200 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-brand outline-none text-sm leading-relaxed"
                  rows={6}
                  value={newProduct.description}
                  onChange={e => {
                    const value = e.target.value;
                    if (value.length <= 5000) {
                      setNewProduct({...newProduct, description: value});
                    }
                  }}
                  placeholder="سيتم ملء هذا الحقل تلقائياً عند استخدام الذكاء الاصطناعي..."
                />
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{newProduct.description.length}/5000</p>
              </div>

              {/* Sizes */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">المقاسات (مفصولة بفاصلة)</label>
                <input 
                  type="text" 
                  className="w-full p-2 border border-gray-200 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-brand outline-none"
                  placeholder="S, M, L, XL"
                  value={sizesInput}
                  onChange={e => setSizesInput(e.target.value)}
                />
              </div>
            </div>

            {/* Modal Footer */}
            <div className="mt-6 flex justify-end gap-3 shrink-0 pt-4 border-t border-gray-100 dark:border-gray-700">
              <button 
                onClick={() => setShowModal(false)}
                className="px-4 py-2 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
              >
                إلغاء
              </button>
              <button 
                onClick={handleSave}
                className="px-6 py-2 bg-brand text-white rounded-lg hover:bg-brand-700 shadow-md shadow-brand/25 dark:shadow-none"
              >
                {newProduct.id ? 'حفظ التعديلات' : 'حفظ المنتج'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Delete confirmation */}
      {deleteTarget && createPortal(
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-[10000] p-4 animate-fade-in">
          <div className="bg-white dark:bg-gray-800 rounded-2xl w-full max-w-md shadow-2xl p-6 border border-gray-100 dark:border-gray-700 animate-fade-in relative z-[10001]">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 rounded-xl">
                <Trash2 size={20} />
              </div>
              <div>
                <h3 className="text-lg font-bold text-gray-900 dark:text-white">تأكيد الحذف</h3>
                <p className="text-sm text-gray-500 dark:text-gray-400">سيتم حذف المنتج نهائياً ولا يمكن التراجع.</p>
              </div>
            </div>

            <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-3 text-sm text-gray-700 dark:text-gray-200 mb-4">
              <div className="font-bold">{deleteTarget.name}</div>
              <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">{deleteTarget.category} - {deleteTarget.price} {deleteTarget.currency}</div>
            </div>

            <div className="flex justify-end gap-3">
              <button
                onClick={() => setDeleteTarget(null)}
                className="px-4 py-2 rounded-lg text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              >
                إلغاء
              </button>
              <button
                onClick={() => {
                  onDeleteProduct(deleteTarget.id);
                  setDeleteTarget(null);
                }}
                className="px-4 py-2 rounded-lg bg-red-600 text-white hover:bg-red-700 transition-colors"
              >
                حذف المنتج
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};

export default ProductManager;
