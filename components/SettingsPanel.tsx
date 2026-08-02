import React, { useState, useEffect } from 'react';
import { MerchantSettings, BotPersona } from '../types';
import { Save, Bot, DollarSign, Sparkles, Truck, CreditCard, AlertCircle, FileText, Check, Trash2, X, ShoppingCart } from 'lucide-react';
import { DEFAULT_SETTINGS } from '../constants'; // Import default to use as fallback
import { useAuth } from '../contexts/AuthContext';
import { createPortal } from 'react-dom';

interface SettingsPanelProps {
  settings: MerchantSettings;
  onUpdateSettings: (s: MerchantSettings) => void;
}

const SettingsPanel: React.FC<SettingsPanelProps> = ({ settings, onUpdateSettings }) => {
  // Use passed settings or fallback to DEFAULT_SETTINGS to ensure object structure exists
  const initialSettings = settings || DEFAULT_SETTINGS;
  const [formData, setFormData] = useState<MerchantSettings>(initialSettings);
  const [showSuccess, setShowSuccess] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const { deleteAccount } = useAuth();

  // Sync state when props change
  useEffect(() => {
    if (settings) {
      setFormData(settings);
    }
  }, [settings]);
  
  const personaOptions: { value: BotPersona; label: string; desc: string }[] = [
    { value: 'formal', label: 'رسمي ومهني (Formal)', desc: 'نبرة محترمة، مباشرة، وبدون مبالغة.' },
    { value: 'friendly', label: 'ودود واجتماعي (Friendly)', desc: 'نبرة دافئة، مرحبة، وقريبة من القلب.' },
    { value: 'sales', label: 'رجل مبيعات (Sales Mode)', desc: 'نبرة مقنعة، حماسية، وتركز على إغلاق البيع.' },
    { value: 'fast', label: 'سريع ومختصر (Fast & Short)', desc: 'إجابات قصيرة جداً ومباشرة (مناسب للتعليقات).' },
    { value: 'luxury', label: 'فخم وراقي (Luxury)', desc: 'مفردات أنيقة تناسب العلامات التجارية الفاخرة.' },
  ];

  const updatePolicy = (field: keyof typeof formData.storePolicies, value: any) => {
    // Safety check for storePolicies
    const currentPolicies = formData.storePolicies || DEFAULT_SETTINGS.storePolicies;
    
    setFormData(prev => ({
      ...prev,
      storePolicies: {
        ...currentPolicies,
        [field]: value
      }
    }));
  };

  const handleSave = () => {
    if (!formData.storeName?.trim()) {
      setErrorMessage('يرجى إدخال اسم المتجر.');
      setTimeout(() => setErrorMessage(null), 4000);
      return;
    }
    
    setErrorMessage(null);
    onUpdateSettings(formData);
    setShowSuccess(true);
    setTimeout(() => setShowSuccess(false), 2000);
  };

  const handleDeleteAccount = async () => {
    if (deleteConfirmText !== 'حذف') {
      setErrorMessage('يرجى كتابة "حذف" للتأكيد');
      setTimeout(() => setErrorMessage(null), 4000);
      return;
    }

    setIsDeleting(true);
    try {
      await deleteAccount();
      // Account deleted, user will be logged out and redirected
      window.location.href = '/';
    } catch (error: any) {
      setErrorMessage('فشل حذف الحساب: ' + (error.message || 'حدث خطأ غير متوقع'));
      setIsDeleting(false);
      setShowDeleteModal(false);
      setShowDeleteConfirm(false);
      setDeleteConfirmText('');
      setTimeout(() => setErrorMessage(null), 5000);
    }
  };

  const handleDeleteClick = () => {
    setShowDeleteModal(true);
  };

  const handleCancelDelete = () => {
    setShowDeleteModal(false);
    setShowDeleteConfirm(false);
    setDeleteConfirmText('');
  };

  // Ensure formData has policies before rendering to avoid undefined errors
  const safeFormData = formData || DEFAULT_SETTINGS;
  const safePolicies = safeFormData.storePolicies || DEFAULT_SETTINGS.storePolicies;

  return (
    <div className="max-w-4xl mx-auto space-y-6 animate-fade-in pb-6 pt-24">
      {/* Error Message */}
      {errorMessage && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-4 shadow-lg flex items-center gap-3 animate-fade-in max-w-md">
          <AlertCircle className="text-red-600 dark:text-red-400 shrink-0" size={20} />
          <p className="text-red-800 dark:text-red-300 text-sm">{errorMessage}</p>
          <button
            onClick={() => setErrorMessage(null)}
            className="text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-200 shrink-0"
          >
            <X size={18} />
          </button>
        </div>
      )}

      {/* Fixed Save Button - يبقى ثابتاً في الأعلى دائماً */}
      <div className="sticky top-24 md:top-4 left-0 right-0 z-[60] flex justify-center px-4 pointer-events-none">
        <div className="w-full max-w-4xl pointer-events-auto">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-3 backdrop-blur-sm bg-opacity-95 dark:bg-opacity-95">
            <button 
              onClick={handleSave}
              className="w-full flex items-center justify-center gap-2 px-8 py-3 bg-brand text-white rounded-xl hover:bg-brand-700 shadow-md shadow-brand/25 dark:shadow-brand-900/50 transition-all active:scale-95 font-semibold"
            >
              {showSuccess ? <Check size={20} /> : <Save size={20} />}
              <span>{showSuccess ? 'تم الحفظ بنجاح' : 'حفظ التغييرات'}</span>
            </button>
          </div>
        </div>
      </div>
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 p-8 transition-colors">
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-6 flex items-center gap-2">
            <Bot className="text-brand dark:text-brand" />
            إعدادات البوت والربط
        </h2>
        
        <div className="space-y-8">
          {/* General Info */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">اسم المتجر <span className="text-red-500">*</span></label>
              <input 
                type="text" 
                value={safeFormData.storeName}
                onChange={(e) => setFormData({...safeFormData, storeName: e.target.value})}
                className="w-full p-3 border border-gray-200 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-brand outline-none transition-all"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">عملة المتجر الأساسية</label>
              <div className="relative">
                 <DollarSign className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                 <select
                    value={safeFormData.storeCurrency}
                    onChange={(e) => setFormData({...safeFormData, storeCurrency: e.target.value})}
                    className="w-full p-3 pr-10 border border-gray-200 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-brand outline-none transition-all appearance-none"
                 >
                    <option value="USD">دولار أمريكي (USD)</option>
                    <option value="SAR">ريال سعودي (SAR)</option>
                    <option value="EGP">جنيه مصري (EGP)</option>
                    <option value="AED">درهم إماراتي (AED)</option>
                    <option value="KWD">دينار كويتي (KWD)</option>
                    <option value="QAR">ريال قطري (QAR)</option>
                    <option value="EUR">يورو (EUR)</option>
                    <option value="ILS">شيكل إسرائيلي (ILS)</option>
                    <option value="SYP">ليرة سورية (SYP)</option>
                 </select>
              </div>
              <p className="text-xs text-gray-400 mt-1">سيقوم البوت بعرض جميع الأسعار بهذه العملة فقط.</p>
            </div>
          </div>

          {/* Store Policies & Shipping Section */}
          <div className="bg-slate-50 dark:bg-slate-900/50 p-6 rounded-xl border border-slate-200 dark:border-slate-700">
             <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
               <div className="flex items-center gap-2">
                 <Truck className="text-brand dark:text-brand" size={20} />
                 <h3 className="text-lg font-bold text-gray-800 dark:text-white">إعدادات الشحن والسياسة</h3>
               </div>
               
               {/* Toggle Switch */}
               <div className="flex items-center gap-3">
                  <span className="text-sm font-medium text-gray-600 dark:text-gray-300">
                    تفعيل الرد الذكي باستخدام السياسات
                  </span>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input 
                      type="checkbox" 
                      className="sr-only peer"
                      checked={safePolicies.enableAIInjection}
                      onChange={(e) => updatePolicy('enableAIInjection', e.target.checked)}
                    />
                    <div className="w-11 h-6 bg-gray-200 dark:bg-gray-600 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-brand"></div>
                  </label>
               </div>
             </div>

             <div className="grid gap-4">
                {/* Shipping Policy */}
                <div>
                   <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2 flex items-center gap-1">
                      <Truck size={14} className="text-gray-400" />
                      سياسة الشحن
                   </label>
                   <textarea 
                      value={safePolicies.shippingPolicy}
                      onChange={(e) => updatePolicy('shippingPolicy', e.target.value)}
                      placeholder="اشرح تكلفة الشحن والمناطق المدعومة..."
                      rows={2}
                      className="w-full p-3 border border-gray-200 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-brand outline-none text-sm"
                   />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                   {/* Delivery Time */}
                   <div>
                      <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">مدة التوصيل المتوقعة</label>
                      <input 
                        type="text" 
                        value={safePolicies.deliveryTime}
                        onChange={(e) => updatePolicy('deliveryTime', e.target.value)}
                        placeholder="مثال: 3-5 أيام عمل"
                        className="w-full p-3 border border-gray-200 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-brand outline-none text-sm"
                      />
                   </div>
                   
                   {/* Payment Methods */}
                   <div>
                      <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2 flex items-center gap-1">
                        <CreditCard size={14} className="text-gray-400" />
                        طرق الدفع المتاحة
                      </label>
                      <input 
                        type="text" 
                        value={safePolicies.paymentMethods}
                        onChange={(e) => updatePolicy('paymentMethods', e.target.value)}
                        placeholder="مثال: الدفع عند الاستلام، فيزا، مدى..."
                        className="w-full p-3 border border-gray-200 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-brand outline-none text-sm"
                      />
                   </div>
                </div>

                {/* Additional Notes */}
                <div>
                   <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2 flex items-center gap-1">
                      <FileText size={14} className="text-gray-400" />
                      ملاحظات إضافية (اختياري)
                   </label>
                   <input 
                      type="text" 
                      value={safePolicies.additionalNotes}
                      onChange={(e) => updatePolicy('additionalNotes', e.target.value)}
                      placeholder="أي معلومات أخرى تريد أن يعرفها البوت..."
                      className="w-full p-3 border border-gray-200 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-brand outline-none text-sm"
                   />
                </div>
             </div>
          </div>

          {/* Persona Settings */}
          <div className="bg-brand-50 dark:bg-brand-900/10 p-6 rounded-xl border border-brand-100 dark:border-brand-800">
             <div className="flex items-center gap-2 mb-4">
               <Sparkles className="text-brand dark:text-brand" size={20} />
               <h3 className="text-lg font-bold text-gray-800 dark:text-white">شخصية البوت (Bot Persona)</h3>
             </div>
             <p className="text-sm text-gray-600 dark:text-gray-300 mb-4">
               اختر الأسلوب الذي يتحدث به البوت مع عملائك ليعكس هوية علامتك التجارية.
             </p>
             
             <div className="grid gap-3">
               {personaOptions.map((option) => (
                 <label 
                  key={option.value}
                  className={`flex items-center justify-between p-4 rounded-xl border cursor-pointer transition-all ${
                    safeFormData.botPersona === option.value 
                    ? 'bg-white dark:bg-gray-800 border-brand ring-1 ring-brand shadow-md' 
                    : 'bg-white/50 dark:bg-gray-800/50 border-gray-200 dark:border-gray-600 hover:border-brand-300'
                  }`}
                 >
                   <div className="flex items-center gap-3">
                     <input 
                       type="radio" 
                       name="botPersona"
                       value={option.value}
                       checked={safeFormData.botPersona === option.value}
                       onChange={() => setFormData({...safeFormData, botPersona: option.value})}
                       className="w-4 h-4 text-brand focus:ring-brand"
                     />
                     <div>
                       <span className="block font-bold text-gray-800 dark:text-gray-200 text-sm">{option.label}</span>
                       <span className="block text-xs text-gray-500 dark:text-gray-400 mt-0.5">{option.desc}</span>
                     </div>
                   </div>
                 </label>
               ))}
             </div>
          </div>

          {/* Abandoned checkout recovery */}
          <div className="bg-emerald-50 dark:bg-emerald-900/10 p-6 rounded-xl border border-emerald-100 dark:border-emerald-900/40">
            <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
              <div className="flex items-center gap-2">
                <ShoppingCart className="text-emerald-600 dark:text-emerald-400" size={20} />
                <h3 className="text-lg font-bold text-gray-800 dark:text-white">استعادة الطلبات غير المكتملة</h3>
              </div>
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <span className="text-sm text-gray-600 dark:text-gray-300">تفعيل التذكير</span>
                <input
                  type="checkbox"
                  checked={safeFormData.abandonedReminderEnabled !== false}
                  onChange={(e) =>
                    setFormData({ ...safeFormData, abandonedReminderEnabled: e.target.checked })
                  }
                  className="w-4 h-4 rounded text-brand focus:ring-brand"
                />
              </label>
            </div>
            <p className="text-sm text-gray-600 dark:text-gray-300 mb-4">
              إذا أعطى العميل اسمه ورقم هاتفه ثم صمت قبل تأكيد الطلب، يرسل البوت رسالة تذكير لطيفة واحدة داخل نافذة الـ 24 ساعة.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                  مهلة الصمت قبل التذكير (بالدقائق)
                </label>
                <input
                  type="number"
                  min={5}
                  max={720}
                  value={safeFormData.abandonedReminderDelayMinutes ?? 45}
                  onChange={(e) =>
                    setFormData({
                      ...safeFormData,
                      abandonedReminderDelayMinutes: Math.min(
                        720,
                        Math.max(5, parseInt(e.target.value || '45', 10) || 45)
                      ),
                    })
                  }
                  disabled={safeFormData.abandonedReminderEnabled === false}
                  className="w-full p-3 border border-emerald-200 dark:border-emerald-800 rounded-xl bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-emerald-500 outline-none text-sm disabled:opacity-50"
                />
                <p className="text-xs text-gray-400 mt-1">الافتراضي 45 دقيقة — الحد الأدنى 5 دقائق.</p>
              </div>
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                نص التذكير (اختياري)
              </label>
              <textarea
                value={safeFormData.abandonedReminderMessage || ''}
                onChange={(e) =>
                  setFormData({ ...safeFormData, abandonedReminderMessage: e.target.value })
                }
                disabled={safeFormData.abandonedReminderEnabled === false}
                rows={3}
                placeholder="اتركه فارغاً لاستخدام النص الافتراضي. المتغيرات: {name} {product} {product_clause}"
                className="w-full p-3 border border-emerald-200 dark:border-emerald-800 rounded-xl bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-emerald-500 outline-none text-sm leading-relaxed disabled:opacity-50"
              />
            </div>
          </div>

          <div className="bg-yellow-50 dark:bg-yellow-900/10 p-6 rounded-xl border border-yellow-100 dark:border-yellow-900/30">
             <label className="block text-sm font-semibold text-yellow-800 dark:text-yellow-500 mb-2">تعليمات إضافية مخصصة (System Prompt)</label>
             <p className="text-xs text-yellow-600 dark:text-yellow-400/70 mb-3">
                يمكنك إضافة تعليمات خاصة هنا (مثلاً: "لا تقبل الدفع عند الاستلام"، "أوقات العمل من 9 إلى 5"). هذه التعليمات تضاف إلى الشخصية المختارة أعلاه.
             </p>
             <textarea 
                value={safeFormData.systemPrompt}
                onChange={(e) => setFormData({...safeFormData, systemPrompt: e.target.value})}
                rows={4}
                className="w-full p-3 border border-yellow-200 dark:border-yellow-800 rounded-xl bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-yellow-500 outline-none transition-all text-sm leading-relaxed"
            />
          </div>

        </div>
      </div>

      {/* Delete Confirmation Modal */}
      {showDeleteModal && typeof window !== 'undefined' && createPortal(
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-[10000] p-4 animate-fade-in">
          <div className="bg-white dark:bg-gray-800 rounded-2xl w-full max-w-md shadow-2xl p-6 animate-fade-in border border-gray-100 dark:border-gray-700">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Trash2 className="text-red-600 dark:text-red-400" size={24} />
                <h3 className="text-xl font-bold text-gray-900 dark:text-white">
                  تأكيد حذف الحساب
                </h3>
              </div>
              <button
                onClick={handleCancelDelete}
                disabled={isDeleting}
                className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <X size={20} />
              </button>
            </div>

            <div className="space-y-4">
              <p className="text-gray-700 dark:text-gray-300">
                هل أنت متأكد؟ سيتم حذف حسابك وجميع بياناتك بشكل نهائي ولا يمكن التراجع عن هذا الإجراء.
              </p>

              {!showDeleteConfirm ? (
                <div className="flex gap-3 pt-2">
                  <button
                    onClick={() => setShowDeleteConfirm(true)}
                    className="flex-1 px-6 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-all flex items-center justify-center gap-2"
                  >
                    <Trash2 size={16} />
                    <span>نعم، أريد الحذف</span>
                  </button>
                  <button
                    onClick={handleCancelDelete}
                    className="flex-1 px-6 py-2 bg-gray-300 dark:bg-gray-600 text-gray-700 dark:text-gray-200 rounded-lg hover:bg-gray-400 dark:hover:bg-gray-500 transition-all"
                  >
                    إلغاء
                  </button>
                </div>
              ) : (
                <div className="space-y-4 pt-2">
                  <div className="p-4 bg-red-50 dark:bg-red-900/20 rounded-xl border border-red-200 dark:border-red-800">
                    <p className="text-gray-700 dark:text-gray-200 font-semibold mb-2">
                      للتأكيد النهائي، يرجى كتابة <span className="text-red-600 dark:text-red-400 font-bold">"حذف"</span> في المربع أدناه:
                    </p>
                    <input
                      type="text"
                      value={deleteConfirmText}
                      onChange={(e) => setDeleteConfirmText(e.target.value)}
                      placeholder="اكتب 'حذف' للتأكيد"
                      className="w-full p-3 border border-red-300 dark:border-red-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-red-500 outline-none"
                      disabled={isDeleting}
                      autoFocus
                    />
                  </div>
                  <div className="flex gap-3">
                    <button
                      onClick={handleDeleteAccount}
                      disabled={isDeleting || deleteConfirmText !== 'حذف'}
                      className="flex-1 px-6 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2"
                    >
                      {isDeleting ? (
                        <>
                          <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
                          <span>جاري الحذف...</span>
                        </>
                      ) : (
                        <>
                          <Trash2 size={16} />
                          <span>تأكيد الحذف</span>
                        </>
                      )}
                    </button>
                    <button
                      onClick={handleCancelDelete}
                      disabled={isDeleting}
                      className="flex-1 px-6 py-2 bg-gray-300 dark:bg-gray-600 text-gray-700 dark:text-gray-200 rounded-lg hover:bg-gray-400 dark:hover:bg-gray-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                    >
                      إلغاء
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Delete Account Section */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-red-200 dark:border-red-900/50 p-8 transition-colors mt-6">
        <div className="flex items-center gap-2 mb-4">
          <Trash2 className="text-red-600 dark:text-red-400" size={24} />
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
            منطقة الخطر - حذف الحساب
          </h2>
        </div>
        
        <div className="space-y-4">
          <p className="text-gray-600 dark:text-gray-300">
            حذف حسابك سيؤدي إلى إزالة جميع بياناتك بشكل نهائي، بما في ذلك:
          </p>
          <ul className="list-disc list-inside text-gray-600 dark:text-gray-300 space-y-2 mr-4">
            <li>جميع المنتجات والخدمات</li>
            <li>جميع الطلبات والمحادثات</li>
            <li>إعدادات المتجر والإعدادات الشخصية</li>
            <li>جميع التكاملات (Facebook, Telegram, WhatsApp, Shopify)</li>
            <li>بيانات العملاء</li>
          </ul>
          <p className="text-red-600 dark:text-red-400 font-semibold">
            ⚠️ هذا الإجراء لا يمكن التراجع عنه!
          </p>

          <button
            onClick={handleDeleteClick}
            className="mt-4 px-6 py-3 bg-red-600 text-white rounded-xl hover:bg-red-700 transition-all flex items-center gap-2"
          >
            <Trash2 size={18} />
            <span>حذف الحساب</span>
          </button>
        </div>
      </div>
    </div>
  );
};

export default SettingsPanel;