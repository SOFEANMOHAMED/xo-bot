import React, { useState, useEffect } from 'react';
import { X, Save, Plus, Trash2 } from 'lucide-react';
import { useAdminNotifications } from './AdminNotificationContext';

interface PlanLimits {
  maxProducts: number;
  maxMonthlyAIResponses: number;
  maxFacebookPages: number;
  maxInstagramAccounts: number;
  maxWhatsAppAccounts: number;
  maxShopifyStores: number;
  maxTelegramBots: number;
  maxTotalChannels: number;
  maxCustomers: number;
  hasAdvancedAnalytics: boolean;
  hasAPIAccess: boolean;
  hasSalesBot: boolean;
  billingPeriod?: 'monthly' | 'yearly';
}

interface Plan {
  name: string;
  planKey: string;
  price: number;
  users: number;
  features: string[];
  billingPeriod?: 'monthly' | 'yearly';
  description?: string;
  limits?: PlanLimits;
}

interface EditPlanModalProps {
  isOpen: boolean;
  plan: Plan | null;
  onClose: () => void;
  onSave: (updatedPlan: Plan) => Promise<void>;
}

const defaultLimits = (): PlanLimits => ({
  maxProducts: -1,
  maxMonthlyAIResponses: -1,
  maxFacebookPages: 1,
  maxInstagramAccounts: 1,
  maxWhatsAppAccounts: 0,
  maxShopifyStores: 0,
  maxTelegramBots: 0,
  maxTotalChannels: -1,
  maxCustomers: -1,
  hasAdvancedAnalytics: false,
  hasAPIAccess: false,
  hasSalesBot: true,
  billingPeriod: 'monthly'
});

const EditPlanModal: React.FC<EditPlanModalProps> = ({ isOpen, plan, onClose, onSave }) => {
  const { showError, showSuccess } = useAdminNotifications();
  const [formData, setFormData] = useState<Plan | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [newFeature, setNewFeature] = useState('');
  const [showLimits, setShowLimits] = useState(false);
  const [limits, setLimits] = useState<PlanLimits | null>(null);
  const [isLoadingLimits, setIsLoadingLimits] = useState(false);

  useEffect(() => {
    if (plan) {
      setFormData({ ...plan });
      setLimits(plan.limits || null);
      setShowLimits(false);
    }
  }, [plan]);

  useEffect(() => {
    const loadLimits = async () => {
      if (plan && showLimits && !limits) {
        try {
          setIsLoadingLimits(true);
          const { apiService } = await import('../../services/api');
          const response = await apiService.getAdminPlanLimits();
          const data = (response as any)?.data || response;
          const planLimits = data?.[plan.planKey];
          if (planLimits) {
            setLimits({ ...defaultLimits(), ...planLimits });
          } else {
            setLimits(defaultLimits());
          }
        } catch (error) {
          console.error('Failed to load limits:', error);
          setLimits(defaultLimits());
        } finally {
          setIsLoadingLimits(false);
        }
      }
    };
    loadLimits();
  }, [plan, showLimits, limits]);

  if (!isOpen || !plan || !formData) return null;

  const handleSave = async () => {
    if (!formData.name || formData.name.trim() === '') {
      showError('اسم الباقة مطلوب');
      return;
    }

    if (formData.price == null || formData.price < 0) {
      showError('السعر يجب أن يكون رقمًا صحيحًا');
      return;
    }

    if (formData.features.length === 0) {
      showError('يجب إضافة ميزة واحدة على الأقل');
      return;
    }

    try {
      setIsSaving(true);
      if (limits && showLimits) {
        const { apiService } = await import('../../services/api');
        await apiService.updateAdminPlanLimits(formData.planKey, limits);
      }
      await onSave({
        ...formData,
        limits: limits || undefined
      });
      showSuccess('تم تحديث الباقة بنجاح');
      onClose();
    } catch (err: any) {
      showError(err.message || 'فشل تحديث الباقة');
    } finally {
      setIsSaving(false);
    }
  };

  const handleAddFeature = () => {
    if (newFeature.trim()) {
      setFormData({
        ...formData,
        features: [...formData.features, newFeature.trim()]
      });
      setNewFeature('');
    }
  };

  const handleRemoveFeature = (index: number) => {
    setFormData({
      ...formData,
      features: formData.features.filter((_, i) => i !== index)
    });
  };

  const handleUpdateFeature = (index: number, value: string) => {
    const updatedFeatures = [...formData.features];
    updatedFeatures[index] = value;
    setFormData({
      ...formData,
      features: updatedFeatures
    });
  };

  const numberField = (
    label: string,
    key: keyof PlanLimits,
    value: number
  ) => (
    <div>
      <label className="block text-sm font-medium text-slate-300 mb-2">{label}</label>
      <input
        type="number"
        value={value}
        onChange={(e) => setLimits({ ...limits!, [key]: parseInt(e.target.value, 10) || -1 })}
        className="w-full bg-slate-800 border border-slate-700 text-white rounded-lg py-2 px-4 focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
        disabled={isSaving}
      />
    </div>
  );

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-[10000] p-4 animate-fade-in">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-2xl shadow-2xl animate-scale-in max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center p-6 border-b border-slate-800 sticky top-0 bg-slate-900">
          <h3 className="text-xl font-bold text-white">تعديل الباقة</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors" disabled={isSaving}>
            <X size={24} />
          </button>
        </div>

        <div className="p-6 space-y-6">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">اسم الباقة</label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="w-full bg-slate-800 border border-slate-700 text-white rounded-lg py-2 px-4 focus:ring-2 focus:ring-indigo-500 outline-none"
              disabled={isSaving}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">السعر ($)</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={formData.price}
                onChange={(e) => setFormData({ ...formData, price: parseFloat(e.target.value) || 0 })}
                className="w-full bg-slate-800 border border-slate-700 text-white rounded-lg py-2 px-4 focus:ring-2 focus:ring-indigo-500 outline-none"
                disabled={isSaving}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">دورة الفوترة</label>
              <select
                value={formData.billingPeriod || (formData.planKey === 'yearly' ? 'yearly' : 'monthly')}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    billingPeriod: e.target.value as 'monthly' | 'yearly'
                  })
                }
                className="w-full bg-slate-800 border border-slate-700 text-white rounded-lg py-2 px-4 focus:ring-2 focus:ring-indigo-500 outline-none"
                disabled={isSaving}
              >
                <option value="monthly">شهري</option>
                <option value="yearly">سنوي</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">الوصف</label>
            <textarea
              value={formData.description || ''}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              rows={2}
              className="w-full bg-slate-800 border border-slate-700 text-white rounded-lg py-2 px-4 focus:ring-2 focus:ring-indigo-500 outline-none"
              disabled={isSaving}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              الميزات <span className="text-xs text-slate-500 font-normal">({formData.features.length})</span>
            </label>
            <div className="space-y-2 mb-3 max-h-64 overflow-y-auto">
              {formData.features.map((feature, index) => (
                <div key={index} className="flex items-center gap-2">
                  <span className="text-xs text-slate-500 w-6 flex-shrink-0">{index + 1}.</span>
                  <input
                    type="text"
                    value={feature}
                    onChange={(e) => handleUpdateFeature(index, e.target.value)}
                    className="flex-1 bg-slate-800 border border-slate-700 text-white rounded-lg py-2 px-4 focus:ring-2 focus:ring-indigo-500 outline-none"
                    disabled={isSaving}
                  />
                  <button
                    onClick={() => handleRemoveFeature(index)}
                    className="p-2 text-red-400 hover:text-red-300 hover:bg-red-900/20 rounded-lg"
                    disabled={isSaving}
                  >
                    <Trash2 size={18} />
                  </button>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={newFeature}
                onChange={(e) => setNewFeature(e.target.value)}
                onKeyPress={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddFeature();
                  }
                }}
                placeholder="أضف ميزة جديدة..."
                className="flex-1 bg-slate-800 border border-slate-700 text-white rounded-lg py-2 px-4 focus:ring-2 focus:ring-indigo-500 outline-none"
                disabled={isSaving}
              />
              <button
                onClick={handleAddFeature}
                className="p-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg disabled:opacity-50"
                disabled={isSaving || !newFeature.trim()}
              >
                <Plus size={18} />
              </button>
            </div>
          </div>

          <div className="border-t border-slate-800 pt-6">
            <div className="flex items-center justify-between mb-4">
              <h4 className="text-lg font-bold text-white">الحدود والقيود</h4>
              <button
                onClick={() => setShowLimits(!showLimits)}
                className="text-sm text-indigo-400 hover:text-indigo-300"
                disabled={isSaving}
              >
                {showLimits ? 'إخفاء' : 'إظهار'}
              </button>
            </div>

            {showLimits && (
              <div className="space-y-4 bg-slate-800/50 rounded-lg p-4 border border-slate-700">
                {isLoadingLimits ? (
                  <div className="text-center py-4 text-slate-400">جاري التحميل...</div>
                ) : limits ? (
                  <>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {numberField('المنتجات (-1 غير محدود)', 'maxProducts', limits.maxProducts)}
                      {numberField('ردود AI شهرياً (-1 غير محدود)', 'maxMonthlyAIResponses', limits.maxMonthlyAIResponses)}
                      {numberField('صفحات فيسبوك', 'maxFacebookPages', limits.maxFacebookPages)}
                      {numberField('حسابات إنستغرام', 'maxInstagramAccounts', limits.maxInstagramAccounts ?? 0)}
                      {numberField('بوتات تيليجرام', 'maxTelegramBots', limits.maxTelegramBots ?? 0)}
                      {numberField('إجمالي القنوات (للقناة الواحدة=1)', 'maxTotalChannels', limits.maxTotalChannels ?? -1)}
                      {numberField('واتساب', 'maxWhatsAppAccounts', limits.maxWhatsAppAccounts)}
                      {numberField('شوبيفاي', 'maxShopifyStores', limits.maxShopifyStores)}
                      {numberField('العملاء', 'maxCustomers', limits.maxCustomers)}
                    </div>

                    <div className="flex flex-wrap items-center gap-6 pt-4 border-t border-slate-700">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={!!limits.hasSalesBot}
                          onChange={(e) => setLimits({ ...limits, hasSalesBot: e.target.checked })}
                          className="w-4 h-4 text-indigo-600 bg-slate-800 border-slate-700 rounded"
                          disabled={isSaving}
                        />
                        <span className="text-sm text-slate-300">بوت المبيعات (رسائل خاصة)</span>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={limits.hasAdvancedAnalytics}
                          onChange={(e) => setLimits({ ...limits, hasAdvancedAnalytics: e.target.checked })}
                          className="w-4 h-4 text-indigo-600 bg-slate-800 border-slate-700 rounded"
                          disabled={isSaving}
                        />
                        <span className="text-sm text-slate-300">تحليلات متقدمة</span>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={limits.hasAPIAccess}
                          onChange={(e) => setLimits({ ...limits, hasAPIAccess: e.target.checked })}
                          className="w-4 h-4 text-indigo-600 bg-slate-800 border-slate-700 rounded"
                          disabled={isSaving}
                        />
                        <span className="text-sm text-slate-300">وصول API</span>
                      </label>
                    </div>
                  </>
                ) : (
                  <div className="text-center py-4 text-slate-400">لا توجد حدود محددة</div>
                )}
              </div>
            )}
          </div>

          <div className="bg-slate-800/50 rounded-lg p-4 border border-slate-700">
            <p className="text-sm text-slate-400">
              <span className="font-medium text-slate-300">عدد المشتركين الحالي:</span> {formData.users}
            </p>
            <p className="text-xs text-slate-500 mt-1">
              مفتاح الباقة ({formData.planKey}) لا يمكن تعديله
            </p>
          </div>
        </div>

        <div className="p-6 border-t border-slate-800 flex justify-end gap-3 sticky bottom-0 bg-slate-900">
          <button
            onClick={onClose}
            className="px-4 py-2 text-slate-300 hover:text-white hover:bg-slate-800 rounded-lg"
            disabled={isSaving}
          >
            إلغاء
          </button>
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="px-6 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-lg flex items-center gap-2 disabled:opacity-50"
          >
            {isSaving ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                جاري الحفظ...
              </>
            ) : (
              <>
                <Save size={18} />
                حفظ التغييرات
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default EditPlanModal;
