import React, { useCallback, useEffect, useState } from 'react';
import { HelpCircle, Plus, Pencil, Trash2, X, Check, Loader2 } from 'lucide-react';
import apiService from '../services/api';
import type { MerchantFaq } from '../types';

type FaqFormState = {
  question: string;
  answer: string;
  priority: number;
  isActive: boolean;
};

const EMPTY_FORM: FaqFormState = {
  question: '',
  answer: '',
  priority: 100,
  isActive: true,
};

const FaqSettingsSection: React.FC = () => {
  const [faqs, setFaqs] = useState<MerchantFaq[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FaqFormState>(EMPTY_FORM);

  const loadFaqs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiService.getFaqs();
      setFaqs(res.faqs || []);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'فشل تحميل الأسئلة الشائعة';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadFaqs();
  }, [loadFaqs]);

  const openCreate = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setShowForm(true);
    setError(null);
  };

  const openEdit = (faq: MerchantFaq) => {
    setEditingId(faq.id);
    setForm({
      question: faq.question,
      answer: faq.answer,
      priority: faq.priority ?? 100,
      isActive: faq.isActive !== false,
    });
    setShowForm(true);
    setError(null);
  };

  const closeForm = () => {
    setShowForm(false);
    setEditingId(null);
    setForm(EMPTY_FORM);
  };

  const handleSave = async () => {
    if (!form.question.trim() || !form.answer.trim()) {
      setError('السؤال والجواب مطلوبان');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      if (editingId) {
        await apiService.updateFaq(editingId, {
          question: form.question.trim(),
          answer: form.answer.trim(),
          priority: form.priority,
          isActive: form.isActive,
        });
      } else {
        await apiService.createFaq({
          question: form.question.trim(),
          answer: form.answer.trim(),
          priority: form.priority,
          isActive: form.isActive,
        });
      }
      closeForm();
      await loadFaqs();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'فشل حفظ السؤال';
      setError(msg);
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (faq: MerchantFaq) => {
    setError(null);
    try {
      await apiService.updateFaq(faq.id, { isActive: !faq.isActive });
      await loadFaqs();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'فشل تحديث الحالة';
      setError(msg);
    }
  };

  const handleDelete = async (faq: MerchantFaq) => {
    if (!window.confirm(`حذف السؤال: «${faq.question.slice(0, 60)}»؟`)) return;
    setError(null);
    try {
      await apiService.deleteFaq(faq.id);
      await loadFaqs();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'فشل حذف السؤال';
      setError(msg);
    }
  };

  return (
    <div className="bg-slate-50 dark:bg-slate-900/50 p-6 rounded-xl border border-slate-200 dark:border-slate-700">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <HelpCircle className="text-brand dark:text-brand" size={20} />
          <h3 className="text-lg font-bold text-gray-800 dark:text-white">الأسئلة الشائعة</h3>
        </div>
        {!showForm && (
          <button
            type="button"
            onClick={openCreate}
            className="flex items-center gap-1.5 px-3 py-2 text-sm font-semibold bg-brand text-white rounded-xl hover:bg-brand-700 transition-colors"
          >
            <Plus size={16} />
            إضافة سؤال
          </button>
        )}
      </div>

      <p className="text-sm text-gray-600 dark:text-gray-300 mb-4">
        عند تطابق سؤال العميل مع أحد هذه الأسئلة، يُرسل الجواب الجاهز حرفيًا بدل رد الذكاء الاصطناعي.
      </p>

      {error && (
        <div className="mb-4 p-3 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-sm text-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      {showForm && (
        <div className="mb-4 p-4 rounded-xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-bold text-gray-800 dark:text-white">
              {editingId ? 'تعديل السؤال' : 'سؤال جديد'}
            </span>
            <button type="button" onClick={closeForm} className="text-gray-400 hover:text-gray-600">
              <X size={18} />
            </button>
          </div>
          <div>
            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">
              السؤال
            </label>
            <input
              type="text"
              value={form.question}
              onChange={(e) => setForm({ ...form, question: e.target.value })}
              placeholder="مثال: ما هي سياسة الاستبدال؟"
              className="w-full p-3 border border-gray-200 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-brand outline-none text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">
              الجواب الجاهز
            </label>
            <textarea
              value={form.answer}
              onChange={(e) => setForm({ ...form, answer: e.target.value })}
              placeholder="اكتب الرد الذي سيُرسل للعميل كما هو..."
              rows={3}
              className="w-full p-3 border border-gray-200 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-brand outline-none text-sm"
            />
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1">
                الأولوية
              </label>
              <input
                type="number"
                min={0}
                max={10000}
                value={form.priority}
                onChange={(e) =>
                  setForm({ ...form, priority: Number(e.target.value) || 0 })
                }
                className="w-24 p-2 border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm"
              />
            </div>
            <label className="flex items-center gap-2 cursor-pointer mt-4">
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
                className="w-4 h-4 rounded text-brand focus:ring-brand"
              />
              <span className="text-sm text-gray-700 dark:text-gray-300">مفعّل</span>
            </label>
          </div>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-brand text-white rounded-xl hover:bg-brand-700 font-semibold text-sm disabled:opacity-60"
          >
            {saving ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
            {saving ? 'جاري الحفظ...' : 'حفظ'}
          </button>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-8 text-gray-500 text-sm">
          <Loader2 size={18} className="animate-spin" />
          جاري التحميل...
        </div>
      ) : faqs.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-6">
          لا توجد أسئلة شائعة بعد. أضف سؤالًا ليُرد عليه البوت بجواب جاهز.
        </p>
      ) : (
        <ul className="space-y-3">
          {faqs.map((faq) => (
            <li
              key={faq.id}
              className="p-4 rounded-xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className="font-bold text-sm text-gray-900 dark:text-white">
                      {faq.question}
                    </span>
                    <span
                      className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${
                        faq.isActive
                          ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                          : 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400'
                      }`}
                    >
                      {faq.isActive ? 'مفعّل' : 'متوقف'}
                    </span>
                  </div>
                  <p className="text-sm text-gray-600 dark:text-gray-300 whitespace-pre-wrap">
                    {faq.answer}
                  </p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    title={faq.isActive ? 'إيقاف' : 'تفعيل'}
                    onClick={() => void handleToggleActive(faq)}
                    className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700"
                  >
                    <Check
                      size={16}
                      className={faq.isActive ? 'text-emerald-600' : 'text-gray-400'}
                    />
                  </button>
                  <button
                    type="button"
                    title="تعديل"
                    onClick={() => openEdit(faq)}
                    className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700"
                  >
                    <Pencil size={16} />
                  </button>
                  <button
                    type="button"
                    title="حذف"
                    onClick={() => void handleDelete(faq)}
                    className="p-2 rounded-lg text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default FaqSettingsSection;
