import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Palette, Image as ImageIcon, Sparkles, Download, Upload, RefreshCw, Layers, X } from 'lucide-react';
import apiService, { type MarketingImageRecord } from '../services/api';
import { logger } from '../utils/logger';
import { compressImageDataUrlForAI } from '../utils/productImage';

const MAX_REFERENCE_IMAGES = 8;

const readFileAsDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
        return;
      }
      reject(new Error('فشل قراءة الصورة'));
    };
    reader.onerror = () => reject(new Error('فشل قراءة الصورة'));
    reader.readAsDataURL(file);
  });

const getImageExtension = (mimeType: string) => {
  if (mimeType === 'image/jpeg') return 'jpg';
  if (mimeType === 'image/webp') return 'webp';
  return 'png';
};

const buildImageFilename = (image: MarketingImageRecord) => {
  const datePart = new Date(image.createdAt).toISOString().slice(0, 10);
  return `design-studio-${datePart}-${image.id.slice(0, 8)}.${getImageExtension(image.mimeType)}`;
};

const formatImageDate = (date: string) => {
  try {
    return new Intl.DateTimeFormat('ar-u-nu-latn', {
      dateStyle: 'medium',
      timeStyle: 'short'
    }).format(new Date(date));
  } catch {
    return date;
  }
};

const ImageStudio: React.FC = () => {
  const [prompt, setPrompt] = useState('');
  const [referenceImages, setReferenceImages] = useState<string[]>([]);
  const [generatedImage, setGeneratedImage] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [historyImages, setHistoryImages] = useState<MarketingImageRecord[]>([]);
  const [historyImageUrls, setHistoryImageUrls] = useState<Record<string, string>>({});
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [imageQuota, setImageQuota] = useState<{
    used: number;
    limit: number;
    remaining: number;
    billingPeriod: 'monthly' | 'yearly';
  } | null>(null);
  const historyObjectUrlsRef = useRef<string[]>([]);
  const isMountedRef = useRef(false);
  
  const [aspectRatio, setAspectRatio] = useState<'1:1' | '16:9' | '9:16' | '4:3' | '3:4'>('1:1');

  const downloadUrl = (url: string, filename: string) => {
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const loadHistory = useCallback(async () => {
    setIsLoadingHistory(true);
    setHistoryError(null);
    const createdObjectUrls: string[] = [];

    try {
      const result = await apiService.getMarketingImageHistory(24);
      const entries = await Promise.all(
        result.images.map(async (image) => {
          try {
            const blob = await apiService.getMarketingImageBlob(image.id);
            const objectUrl = URL.createObjectURL(blob);
            createdObjectUrls.push(objectUrl);
            return [image.id, objectUrl] as [string, string];
          } catch (err) {
            logger.error('Failed to load marketing image content:', err);
            return null;
          }
        })
      );

      if (!isMountedRef.current) {
        createdObjectUrls.forEach((url) => URL.revokeObjectURL(url));
        return;
      }

      const previousObjectUrls = historyObjectUrlsRef.current;
      historyObjectUrlsRef.current = createdObjectUrls;

      setHistoryImages(result.images);
      if (result.quota) {
        setImageQuota(result.quota);
      }
      setHistoryImageUrls(
        Object.fromEntries(entries.filter((entry): entry is [string, string] => entry !== null))
      );
      previousObjectUrls.forEach((url) => URL.revokeObjectURL(url));
    } catch (err) {
      createdObjectUrls.forEach((url) => URL.revokeObjectURL(url));
      if (isMountedRef.current) {
        setHistoryError('تعذر تحميل التصاميم السابقة.');
      }
      logger.error('Failed to load marketing image history:', err);
    } finally {
      if (isMountedRef.current) {
        setIsLoadingHistory(false);
      }
    }
  }, []);

  useEffect(() => {
    isMountedRef.current = true;
    void loadHistory();

    return () => {
      isMountedRef.current = false;
      historyObjectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      historyObjectUrlsRef.current = [];
    };
  }, [loadHistory]);

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []).filter((file) => file.type.startsWith('image/'));
    e.target.value = '';
    if (files.length === 0) {
      return;
    }

    const remaining = MAX_REFERENCE_IMAGES - referenceImages.length;
    if (remaining <= 0) {
      setError(`يمكنك رفع ${MAX_REFERENCE_IMAGES} صور مرجعية كحد أقصى.`);
      return;
    }

    try {
      const selected = files.slice(0, remaining);
      const dataUrls = await Promise.all(selected.map(readFileAsDataUrl));
      setReferenceImages((prev) => [...prev, ...dataUrls].slice(0, MAX_REFERENCE_IMAGES));
      if (files.length > remaining) {
        setError(`تم رفع ${remaining} صور فقط. الحد الأقصى ${MAX_REFERENCE_IMAGES} صور.`);
      }
    } catch (err) {
      logger.error('Failed to read reference images:', err);
      setError('فشل قراءة بعض الصور المرجعية.');
    }
  };

  const removeReferenceImage = (index: number) => {
    setReferenceImages((prev) => prev.filter((_, i) => i !== index));
  };

  const handleGenerate = async () => {
    if (!prompt.trim()) {
      setError("يرجى إدخال وصف الصورة (Prompt).");
      return;
    }

    setIsGenerating(true);
    setError(null);
    setGeneratedImage(null);

    try {
      let referenceImageBase64s: string[] | undefined;
      if (referenceImages.length > 0) {
        referenceImageBase64s = await Promise.all(
          referenceImages.map((image) =>
            image.startsWith('data:') ? compressImageDataUrlForAI(image) : image
          )
        );
      }

      const result = await apiService.generateMarketingImageAI({
        prompt: prompt.trim(),
        aspectRatio,
        referenceImageBase64s
      });
      if (result?.imageDataUrl) {
        setGeneratedImage(result.imageDataUrl);
        void loadHistory();
      } else {
        setError('تعذر توليد الصورة. يرجى المحاولة مرة أخرى.');
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message || 'حدث خطأ أثناء توليد الصورة.');
      logger.error('Image generation error:', err);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleDownload = () => {
    if (generatedImage) {
      downloadUrl(generatedImage, `generated-image-${Date.now()}.png`);
    }
  };

  const handleHistoryDownload = async (image: MarketingImageRecord) => {
    try {
      const existingUrl = historyImageUrls[image.id];
      if (existingUrl) {
        downloadUrl(existingUrl, buildImageFilename(image));
        return;
      }

      const blob = await apiService.getMarketingImageBlob(image.id, true);
      const objectUrl = URL.createObjectURL(blob);
      downloadUrl(objectUrl, buildImageFilename(image));
      setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    } catch (err) {
      setError('تعذر تحميل الصورة المحددة.');
      logger.error('Failed to download marketing image:', err);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in pb-12">
      <div>
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
          <Palette className="text-brand dark:text-brand" />
          ستوديو التصميم الذكي
          <span className="text-xs font-bold bg-gradient-to-r from-red-500 to-pink-500 text-white px-2 py-0.5 rounded-full shadow-sm animate-pulse">
             HOT
          </span>
        </h2>
        <p className="text-gray-500 dark:text-gray-400 mt-1">
          أنشئ صوراً تسويقية لمنتجاتك وحملاتك عبر الذكاء الاصطناعي (Nano Banana Pro).
        </p>
        {imageQuota && imageQuota.limit !== -1 && (
          <p className={`text-sm mt-2 ${imageQuota.remaining === 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-600 dark:text-gray-300'}`}>
            {imageQuota.billingPeriod === 'yearly' ? 'الصور المتبقية هذا العام' : 'الصور المتبقية هذا الشهر'}:{' '}
            <span className="font-semibold">{imageQuota.remaining}</span>
            {' '}من {imageQuota.limit}
            {imageQuota.remaining === 0 && ' — رقِّ باقتك للمزيد من الصور'}
          </p>
        )}
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        
        {/* Controls Panel */}
        <div className="lg:col-span-1 space-y-6">
           <div className="bg-white dark:bg-gray-800 p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700">
              {/* Prompt Input */}
              <div className="mb-6">
                 <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                   وصف الصورة (Prompt) <span className="text-red-500">*</span>
                 </label>
                 <textarea 
                   value={prompt}
                   onChange={(e) => setPrompt(e.target.value)}
                   placeholder="صف الصورة التي تريدها بدقة... مثال: زجاجة عطر فاخرة على خلفية من الرخام الأسود مع إضاءة ذهبية"
                   rows={5}
                   className="w-full p-3 border border-gray-200 dark:border-gray-600 rounded-xl bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-brand outline-none text-sm leading-relaxed resize-none"
                 />
              </div>

              <div className="mb-6">
                 <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                   صور مرجعية (اختياري)
                 </label>
                 <div className="grid grid-cols-3 gap-2">
                    {referenceImages.map((image, index) => (
                      <div key={`${index}-${image.slice(-24)}`} className="relative group aspect-square">
                         <img src={image} alt={`مرجع ${index + 1}`} className="w-full h-full object-cover rounded-lg border border-gray-200 dark:border-gray-600" />
                         <button
                           type="button"
                           onClick={() => removeReferenceImage(index)}
                           className="absolute top-1 right-1 bg-red-500 text-white p-1 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                           aria-label={`حذف الصورة ${index + 1}`}
                         >
                           <X size={12} />
                         </button>
                      </div>
                    ))}
                    {referenceImages.length < MAX_REFERENCE_IMAGES && (
                      <label className="aspect-square cursor-pointer flex flex-col items-center justify-center gap-1 border-2 border-dashed border-gray-200 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                         <Upload className="text-gray-400" size={20} />
                         <span className="text-[10px] text-gray-500 dark:text-gray-400 text-center px-1">
                           {referenceImages.length === 0 ? 'رفع صور' : 'إضافة'}
                         </span>
                         <input
                           type="file"
                           accept="image/jpeg,image/png,image/webp,image/*"
                           multiple
                           className="hidden"
                           onChange={handleImageUpload}
                         />
                      </label>
                    )}
                 </div>
                 <p className="text-[10px] text-gray-400 mt-1">
                   حتى {MAX_REFERENCE_IMAGES} صور كمرجع للمنتج أو النمط. {referenceImages.length}/{MAX_REFERENCE_IMAGES}
                 </p>
              </div>

              <div className="mb-6">
                 <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1.5 flex items-center gap-1">
                   <Layers size={12} /> الأبعاد
                 </label>
                 <select
                   value={aspectRatio}
                   onChange={(e) => setAspectRatio(e.target.value as typeof aspectRatio)}
                   className="w-full p-2 border border-gray-200 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:ring-2 focus:ring-brand outline-none"
                 >
                   <option value="1:1">مربع (1:1)</option>
                   <option value="16:9">أفقي (16:9)</option>
                   <option value="9:16">قصة (9:16)</option>
                   <option value="4:3">أفقي (4:3)</option>
                   <option value="3:4">عمودي (3:4)</option>
                 </select>
              </div>

              <button 
                onClick={handleGenerate}
                disabled={isGenerating || (imageQuota !== null && imageQuota.limit !== -1 && imageQuota.remaining <= 0)}
                className="w-full py-3 bg-brand hover:bg-brand-600 text-white rounded-xl font-bold shadow-lg shadow-brand/25 dark:shadow-none transition-all flex items-center justify-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed"
              >
                {isGenerating ? (
                  <>
                    <RefreshCw size={20} className="animate-spin" />
                    جاري التصميم...
                  </>
                ) : (
                  <>
                    <Sparkles size={20} />
                    توليد الصورة
                  </>
                )}
              </button>
           </div>
        </div>

        {/* Preview Panel */}
        <div className="lg:col-span-2">
           <div className="bg-gray-100 dark:bg-gray-800/50 border-2 border-dashed border-gray-300 dark:border-gray-700 rounded-2xl h-full min-h-[500px] flex items-center justify-center relative overflow-hidden group">
              
              {generatedImage ? (
                <>
                  <img src={generatedImage} alt="Generated" className="max-w-full max-h-full object-contain shadow-2xl" />
                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-4 backdrop-blur-sm">
                     <button 
                       onClick={handleDownload}
                       className="bg-white text-gray-900 px-6 py-3 rounded-xl font-bold flex items-center gap-2 hover:scale-105 transition-transform"
                     >
                       <Download size={20} />
                       تحميل الصورة
                     </button>
                  </div>
                </>
              ) : (
                <div className="text-center p-8 opacity-50">
                   {isGenerating ? (
                     <div className="flex flex-col items-center gap-4">
                       <div className="w-16 h-16 border-4 border-brand border-t-transparent rounded-full animate-spin"></div>
                       <p className="text-brand font-medium animate-pulse">الذكاء الاصطناعي يرسم أفكارك...</p>
                     </div>
                   ) : (
                     <>
                       <div className="w-24 h-24 bg-gray-200 dark:bg-gray-700 rounded-full flex items-center justify-center mx-auto mb-4">
                         <ImageIcon size={40} className="text-gray-400" />
                       </div>
                       <h3 className="text-xl font-bold text-gray-500 dark:text-gray-400">مساحة العمل فارغة</h3>
                       <p className="text-sm text-gray-400 mt-2">أدخل الوصف واضغط على "توليد الصورة" لترى السحر ✨</p>
                     </>
                   )}
                </div>
              )}

              {error && (
                <div className="absolute bottom-6 left-6 right-6 bg-red-100 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-300 p-4 rounded-xl text-center text-sm font-medium">
                  {error}
                </div>
              )}
           </div>
        </div>

      </div>

      <div className="bg-white dark:bg-gray-800 p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700">
        <div className="flex items-center justify-between gap-4 mb-5">
          <div>
            <h3 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
              <ImageIcon size={20} className="text-brand dark:text-brand" />
              التصاميم السابقة
            </h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              كل الصور التي صممتها سابقاً محفوظة هنا ويمكنك تحميلها في أي وقت.
            </p>
          </div>
          <button
            onClick={() => void loadHistory()}
            disabled={isLoadingHistory}
            className="px-3 py-2 text-sm font-semibold rounded-xl border border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors flex items-center gap-2 disabled:opacity-60"
          >
            <RefreshCw size={16} className={isLoadingHistory ? 'animate-spin' : ''} />
            تحديث
          </button>
        </div>

        {historyError && (
          <div className="mb-4 bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-800 text-red-600 dark:text-red-300 p-3 rounded-xl text-sm">
            {historyError}
          </div>
        )}

        {isLoadingHistory && historyImages.length === 0 ? (
          <div className="py-10 text-center text-gray-500 dark:text-gray-400">
            <RefreshCw size={24} className="animate-spin mx-auto mb-3 text-brand" />
            جاري تحميل التصاميم السابقة...
          </div>
        ) : historyImages.length === 0 ? (
          <div className="py-10 text-center border border-dashed border-gray-200 dark:border-gray-700 rounded-2xl">
            <ImageIcon size={34} className="mx-auto text-gray-300 dark:text-gray-600 mb-3" />
            <p className="font-semibold text-gray-600 dark:text-gray-300">لا توجد تصاميم محفوظة بعد</p>
            <p className="text-sm text-gray-400 mt-1">عند توليد صورة جديدة ستظهر هنا تلقائياً.</p>
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {historyImages.map((image) => (
              <div
                key={image.id}
                className="group rounded-2xl border border-gray-100 dark:border-gray-700 overflow-hidden bg-gray-50 dark:bg-gray-900/40"
              >
                <div className="relative aspect-square bg-gray-100 dark:bg-gray-900">
                  {historyImageUrls[image.id] ? (
                    <img
                      src={historyImageUrls[image.id]}
                      alt={image.prompt}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-gray-400">
                      <ImageIcon size={32} />
                    </div>
                  )}
                  <div className="absolute inset-0 bg-black/45 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    <button
                      onClick={() => void handleHistoryDownload(image)}
                      className="bg-white text-gray-900 px-4 py-2 rounded-xl font-bold flex items-center gap-2 hover:scale-105 transition-transform text-sm"
                    >
                      <Download size={16} />
                      تحميل
                    </button>
                  </div>
                </div>
                <div className="p-3">
                  <p className="text-sm font-semibold text-gray-800 dark:text-gray-100 line-clamp-2 min-h-[2.5rem]">
                    {image.prompt}
                  </p>
                  <div className="mt-2 flex items-center justify-between text-xs text-gray-400">
                    <span>{image.aspectRatio}</span>
                    <span>{formatImageDate(image.createdAt)}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default ImageStudio;
