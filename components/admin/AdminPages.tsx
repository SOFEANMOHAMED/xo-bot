import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Plus, Edit, Trash2, Eye, EyeOff, Save, X, FileText, Search, ExternalLink } from 'lucide-react';
import apiService from '../../services/api';
import { useAdminNotifications } from './AdminNotificationContext';
import { logger } from '../../utils/logger';
import ConfirmDialog from './ConfirmDialog';

interface Page {
  id: string;
  slug: string;
  title: string;
  content: string;
  meta_description?: string;
  is_published: boolean;
  created_at: string;
  updated_at: string;
}

const AdminPages: React.FC = () => {
  const [pages, setPages] = useState<Page[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const { showError, showSuccess } = useAdminNotifications();

  // Modal states
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [selectedPage, setSelectedPage] = useState<Page | null>(null);
  const [pageToDelete, setPageToDelete] = useState<string | null>(null);

  // Form state
  const [formData, setFormData] = useState({
    slug: '',
    title: '',
    content: '',
    meta_description: '',
    is_published: true
  });

  useEffect(() => {
    fetchPages();
  }, []);

  const fetchPages = async () => {
    try {
      setIsLoading(true);
      const response = await apiService.getPages();
      setPages(response);
    } catch (err: any) {
      logger.error('Failed to fetch pages:', err);
      showError('فشل تحميل الصفحات');
    } finally {
      setIsLoading(false);
    }
  };

  const filteredPages = pages.filter(page =>
    page.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
    page.slug.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleAddPage = () => {
    setFormData({
      slug: '',
      title: '',
      content: '',
      meta_description: '',
      is_published: true
    });
    setSelectedPage(null);
    setShowAddModal(true);
  };

  const handleEditPage = async (page: Page) => {
    try {
      // Fetch full page data including content
      const fullPage = await apiService.getPage(page.id);
      setFormData({
        slug: fullPage.slug,
        title: fullPage.title,
        content: fullPage.content || '',
        meta_description: fullPage.meta_description || '',
        is_published: fullPage.is_published
      });
      setSelectedPage(fullPage);
      setShowEditModal(true);
    } catch (err: any) {
      logger.error('Failed to fetch page details:', err);
      showError('فشل تحميل بيانات الصفحة');
    }
  };

  const handleSavePage = async () => {
    try {
      if (!formData.slug || !formData.title || !formData.content) {
        showError('الرجاء ملء جميع الحقول المطلوبة');
        return;
      }

      // Validate slug format (only lowercase letters, numbers, and hyphens)
      if (!/^[a-z0-9-]+$/.test(formData.slug)) {
        showError('الـ slug يجب أن يحتوي على أحرف صغيرة وأرقام وشرطات فقط');
        return;
      }

      if (selectedPage) {
        await apiService.updatePage(selectedPage.id, formData);
        showSuccess('تم تحديث الصفحة بنجاح');
      } else {
        await apiService.createPage(formData);
        showSuccess('تم إنشاء الصفحة بنجاح');
      }

      setShowAddModal(false);
      setShowEditModal(false);
      setSelectedPage(null);
      fetchPages();
    } catch (err: any) {
      logger.error('Failed to save page:', err);
      showError('فشل حفظ الصفحة: ' + (err.message || 'خطأ غير معروف'));
    }
  };

  const handleDeletePage = (page: Page) => {
    setPageToDelete(page.id);
    setShowDeleteConfirm(true);
  };

  const confirmDelete = async () => {
    if (!pageToDelete) return;

    try {
      await apiService.deletePage(pageToDelete);
      showSuccess('تم حذف الصفحة بنجاح');
      setShowDeleteConfirm(false);
      setPageToDelete(null);
      fetchPages();
    } catch (err: any) {
      logger.error('Failed to delete page:', err);
      showError('فشل حذف الصفحة: ' + (err.message || 'خطأ غير معروف'));
    }
  };

  const togglePublish = async (page: Page) => {
    try {
      await apiService.updatePage(page.id, { is_published: !page.is_published });
      showSuccess(`تم ${page.is_published ? 'إلغاء نشر' : 'نشر'} الصفحة بنجاح`);
      fetchPages();
    } catch (err: any) {
      logger.error('Failed to toggle publish:', err);
      showError('فشل تحديث حالة الصفحة');
    }
  };

  if (isLoading) {
    return (
      <div className="flex h-96 items-center justify-center">
        <div className="animate-spin text-indigo-500" />
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col md:flex-row justify-between items-center gap-4">
        <div>
          <h2 className="text-xl font-bold text-white mb-1">إدارة الصفحات</h2>
          <p className="text-sm text-slate-400">إنشاء وتعديل صفحات الموقع (سياسة الخصوصية، الشروط، إلخ)</p>
          <p className="text-xs text-amber-200/90 mt-2 max-w-2xl leading-relaxed">
            روابط التذييل والموقع تفتح الصفحة حسب الـ Slug (مثل <code className="bg-slate-800 px-1 rounded">privacy-policy</code>).
            إذا أنشأت صفحة بـ Slug مختلف، المحتوى يظهر على <code className="bg-slate-800 px-1 rounded">/your-slug</code> فقط؛ عدّل الصفحة ذات الـ Slug نفسه أو غيّر الروابط في الواجهة.
          </p>
        </div>
        <div className="flex items-center gap-3 w-full md:w-auto">
          <div className="relative flex-1 md:w-64">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
            <input
              type="text"
              placeholder="بحث..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg pr-10 pl-4 py-2 text-white focus:ring-2 focus:ring-indigo-500 outline-none placeholder-slate-500"
            />
          </div>
          <button
            onClick={handleAddPage}
            className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg font-bold transition-colors shadow-lg shadow-indigo-900/20 whitespace-nowrap"
          >
            <Plus size={18} />
            <span>صفحة جديدة</span>
          </button>
        </div>
      </div>

      <div className="bg-slate-800 rounded-2xl border border-slate-700 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-right">
            <thead className="bg-slate-900/50 text-slate-400 text-xs font-bold uppercase">
              <tr>
                <th className="px-6 py-4">العنوان</th>
                <th className="px-6 py-4">الرابط (Slug)</th>
                <th className="px-6 py-4">الحالة</th>
                <th className="px-6 py-4">آخر تحديث</th>
                <th className="px-6 py-4">إجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700">
              {filteredPages.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-slate-400">
                    {searchTerm ? 'لا توجد صفحات تطابق البحث' : 'لا توجد صفحات. اضغط "صفحة جديدة" لإنشاء صفحة'}
                  </td>
                </tr>
              ) : (
                filteredPages.map((page) => (
                  <tr key={page.id} className="hover:bg-slate-700/50 transition-colors">
                    <td className="px-6 py-4">
                      <div className="font-bold text-white">{page.title}</div>
                    </td>
                    <td className="px-6 py-4">
                      <code className="text-xs bg-slate-900 px-2 py-1 rounded text-slate-300">
                        /{page.slug}
                      </code>
                    </td>
                    <td className="px-6 py-4">
                      <button
                        onClick={() => togglePublish(page)}
                        className={`flex items-center gap-1 px-2 py-1 rounded-full text-xs font-bold ${
                          page.is_published
                            ? 'bg-green-900/30 text-green-400'
                            : 'bg-slate-700 text-slate-400'
                        }`}
                      >
                        {page.is_published ? <Eye size={14} /> : <EyeOff size={14} />}
                        <span>{page.is_published ? 'منشورة' : 'مسودة'}</span>
                      </button>
                    </td>
                    <td className="px-6 py-4 text-sm text-slate-400">
                      {new Date(page.updated_at).toLocaleDateString('ar-SA-u-nu-latn')}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleEditPage(page)}
                          className="p-2 text-slate-400 hover:text-white hover:bg-slate-700 rounded transition-colors"
                          title="تعديل"
                        >
                          <Edit size={16} />
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            window.open(
                              `${window.location.origin}/${encodeURIComponent(page.slug)}`,
                              '_blank',
                              'noopener,noreferrer'
                            )
                          }
                          className="p-2 text-slate-400 hover:text-indigo-400 hover:bg-slate-700 rounded transition-colors"
                          title="معاينة كما يراها الزائر"
                        >
                          <ExternalLink size={16} />
                        </button>
                        <button
                          onClick={() => handleDeletePage(page)}
                          className="p-2 text-slate-400 hover:text-red-400 hover:bg-red-900/20 rounded transition-colors"
                          title="حذف"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add/Edit Modal */}
      {(showAddModal || showEditModal) && typeof document !== 'undefined' && createPortal(
        <div
          className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-[99999]"
          onClick={() => {
            setShowAddModal(false);
            setShowEditModal(false);
          }}
        >
          <div
            className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-4xl shadow-2xl max-h-[90vh] overflow-y-auto z-[100000]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-6 border-b border-slate-700 flex items-center justify-between">
              <h3 className="text-xl font-bold text-white">
                {selectedPage ? 'تعديل الصفحة' : 'صفحة جديدة'}
              </h3>
              <button
                onClick={() => {
                  setShowAddModal(false);
                  setShowEditModal(false);
                }}
                className="text-slate-400 hover:text-white"
              >
                <X size={24} />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  الرابط (Slug) <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={formData.slug}
                  onChange={(e) => setFormData({ ...formData, slug: e.target.value.toLowerCase().replace(/\s+/g, '-') })}
                  placeholder="privacy-policy"
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-2 text-white focus:ring-2 focus:ring-indigo-500 outline-none"
                />
                <p className="text-xs text-slate-500 mt-1">أحرف صغيرة وأرقام وشرطات فقط (مثال: privacy-policy)</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  العنوان <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={formData.title}
                  onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                  placeholder="سياسة الخصوصية"
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-2 text-white focus:ring-2 focus:ring-indigo-500 outline-none"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  الوصف (Meta Description)
                </label>
                <input
                  type="text"
                  value={formData.meta_description}
                  onChange={(e) => setFormData({ ...formData, meta_description: e.target.value })}
                  placeholder="وصف مختصر للصفحة"
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-2 text-white focus:ring-2 focus:ring-indigo-500 outline-none"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  المحتوى <span className="text-red-400">*</span>
                </label>
                <textarea
                  value={formData.content}
                  onChange={(e) => setFormData({ ...formData, content: e.target.value })}
                  placeholder="محتوى الصفحة (يدعم HTML)"
                  rows={15}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-2 text-white focus:ring-2 focus:ring-indigo-500 outline-none font-mono text-sm"
                />
                <p className="text-xs text-slate-500 mt-1">يمكنك استخدام HTML tags مثل &lt;h1&gt;, &lt;p&gt;, &lt;ul&gt;, إلخ</p>
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="is_published"
                  checked={formData.is_published}
                  onChange={(e) => setFormData({ ...formData, is_published: e.target.checked })}
                  className="w-4 h-4 text-indigo-600 bg-slate-800 border-slate-700 rounded focus:ring-indigo-500"
                />
                <label htmlFor="is_published" className="text-sm text-slate-300">
                  نشر الصفحة (ستكون مرئية للجميع)
                </label>
              </div>
            </div>

            <div className="p-6 border-t border-slate-700 flex items-center justify-end gap-3">
              <button
                onClick={() => {
                  setShowAddModal(false);
                  setShowEditModal(false);
                }}
                className="px-4 py-2 text-slate-400 hover:text-white transition-colors"
              >
                إلغاء
              </button>
              <button
                onClick={handleSavePage}
                className="px-6 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-lg shadow-lg shadow-indigo-900/20 flex items-center gap-2"
              >
                <Save size={18} />
                <span>حفظ</span>
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Delete Confirmation */}
      {showDeleteConfirm && (
        <ConfirmDialog
          isOpen={showDeleteConfirm}
          title="حذف الصفحة"
          message="هل أنت متأكد من رغبتك في حذف هذه الصفحة؟ هذا الإجراء لا يمكن التراجع عنه."
          type="danger"
          onConfirm={confirmDelete}
          onCancel={() => {
            setShowDeleteConfirm(false);
            setPageToDelete(null);
          }}
        />
      )}
    </div>
  );
};

export default AdminPages;

