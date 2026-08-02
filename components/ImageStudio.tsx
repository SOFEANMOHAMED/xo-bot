import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Palette, Image as ImageIcon, Sparkles, Download, Upload, RefreshCw, Layers } from 'lucide-react';
import apiService, { type MarketingImageRecord } from '../services/api';
import { logger } from '../utils/logger';
import { compressImageDataUrlForAI } from '../utils/productImage';

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
  const [referenceImage, setReferenceImage] = useState<string | null>(null);
  const [generatedImage, setGeneratedImage] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [historyImages, setHistoryImages] = useState<MarketingImageRecord[]>([]);
  const [historyImageUrls, setHistoryImageUrls] = useState<Record<string, string>>({});
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const historyObjectUrlsRef = useRef<string[]>([]);
  const isMountedRef = useRef(false);
  
  // Settings
  const [aspectRatio, setAspectRatio] = useState<'1:1' | '16:9' | '9:16' | '4:3' | '3:4'>('1:1');
  const [imageSize, setImageSize] = useState<'1K' | '2K' | '4K'>('1K');

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

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setReferenceImage(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
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
      let referenceImageBase64 = referenceImage || undefined;
      if (referenceImageBase64?.startsWith('data:')) {
        referenceImageBase64 = await compressImageDataUrlForAI(referenceImageBase64);
      }

      const result = await apiService.generateMarketingImageAI({
        prompt: prompt.trim(),
        aspectRatio,
        imageSize,
        referenceImageBase64
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
          أنشئ صوراً تسويقية لمنتجاتك وحملاتك عبر الذكاء الاصطناعي (Nano Banana Pro — دقة تصل إلى 4K).
        </p>
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

              {/* Reference Image */}
              <div className="mb-6">
                 <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                   صورة مرجعية (اختياري)
                 </label>
                 <div className="border-2 border-dashed border-gray-200 dark:border-gray-600 rounded-xl p-4 text-center hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors relative group">
                    {referenceImage ? (
                      <div className="relative">
                         <img src={referenceImage} alt="Reference" className="w-full h-32 object-cover rounded-lg" />
                         <button 
                           onClick={() => setReferenceImage(null)}
                           className="absolute top-2 right-2 bg-red-500 text-white p-1 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                         >
                           <RefreshCw size={14} />
                         </button>
                      </div>
                    ) : (
                      <label className="cursor-pointer flex flex-col items-center justify-center gap-2">
                         <Upload className="text-gray-400" size={24} />
                         <span className="text-xs text-gray-500 dark:text-gray-400">اضغط لرفع صورة</span>
                         <input type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />
                      </label>
                    )}
                 </div>
                 <p className="text-[10px] text-gray-400 mt-1">استخدم صورة لتعديلها أو كمرجع للنمط.</p>
              </div>

              {/* Settings Grid */}
              <div className="grid grid-cols-2 gap-4 mb-6">
                 <div>
                    <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1.5 flex items-center gap-1">
                      <Layers size={12} /> الأبعاد
                    </label>
                    <select 
                      value={aspectRatio}
                      onChange={(e) => setAspectRatio(e.target.value as any)}
                      className="w-full p-2 border border-gray-200 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:ring-2 focus:ring-brand outline-none"
                    >
                      <option value="1:1">مربع (1:1)</option>
                      <option value="16:9">أفقي (16:9)</option>
                      <option value="9:16">قصة (9:16)</option>
                      <option value="4:3">أفقي (4:3)</option>
                      <option value="3:4">عمودي (3:4)</option>
                    </select>
                 </div>
                 <div>
                    <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1.5 flex items-center gap-1">
                      <ImageIcon size={12} /> الدقة
                    </label>
                    <select 
                      value={imageSize}
                      onChange={(e) => setImageSize(e.target.value as any)}
                      className="w-full p-2 border border-gray-200 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:ring-2 focus:ring-brand outline-none"
                    >
                      <option value="1K">قياسي (1K)</option>
                      <option value="2K">عالي (2K)</option>
                      <option value="4K">فائق (4K)</option>
                    </select>
                 </div>
              </div>

              <button 
                onClick={handleGenerate}
                disabled={isGenerating}
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
                    <span>{image.aspectRatio} · {image.imageSize}</span>
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
