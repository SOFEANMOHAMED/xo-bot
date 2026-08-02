import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { Service } from '../types';
import { Plus, Search, Trash2, Edit2, Briefcase, Check, X, ListPlus, Minus, Link as LinkIcon, AlertCircle } from 'lucide-react';
import { useDebounce } from '../hooks/useDebounce';
import { validateService, validateLength } from '../utils/validation';
import SkeletonLoader from './SkeletonLoader';

interface ServiceManagerProps {
  services: Service[];
  onAddService: (s: Service) => void;
  onUpdateService: (s: Service) => void;
  onDeleteService: (id: string) => void;
}

const ServiceManager: React.FC<ServiceManagerProps> = ({ services, onAddService, onUpdateService, onDeleteService, isLoading = false }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const debouncedSearchTerm = useDebounce(searchTerm, 300);
  const [showModal, setShowModal] = useState(false);
  
  // Initial empty state for new service
  const initialServiceState: Partial<Service> = {
    name: '',
    category: '',
    type: 'باقة',
    shortDescription: '',
    fullDescription: '',
    priceLabel: '',
    pricingType: 'one_time',
    duration: '',
    deliveryTime: '',
    includedItems: [''], // Start with one empty field
    requirements: [''], // Start with one empty field
    previousWorkTemplates: [''], // Start with one empty field for templates
    bookingLink: '',
    contactChannel: ''
  };

  const [currentService, setCurrentService] = useState<Partial<Service>>(initialServiceState);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);

  const filteredServices = services.filter(s => 
    s.name.toLowerCase().includes(debouncedSearchTerm.toLowerCase()) || 
    s.category?.toLowerCase().includes(debouncedSearchTerm.toLowerCase())
  );

  const handleOpenAddModal = () => {
    setCurrentService(initialServiceState);
    setShowModal(true);
  };

  const handleEditClick = (service: Service) => {
    setCurrentService({ 
      ...service,
      // Ensure arrays exist if editing old data
      previousWorkTemplates: service.previousWorkTemplates || ['']
    });
    setShowModal(true);
  };

  const handleListChange = (field: 'includedItems' | 'requirements' | 'previousWorkTemplates', index: number, value: string) => {
    const list = [...(currentService[field] || [])];
    list[index] = value;
    setCurrentService({ ...currentService, [field]: list });
  };

  const addListItem = (field: 'includedItems' | 'requirements' | 'previousWorkTemplates') => {
    const list = [...(currentService[field] || [])];
    list.push('');
    setCurrentService({ ...currentService, [field]: list });
  };

  const removeListItem = (field: 'includedItems' | 'requirements' | 'previousWorkTemplates', index: number) => {
    const list = [...(currentService[field] || [])];
    list.splice(index, 1);
    setCurrentService({ ...currentService, [field]: list });
  };

  const handleSave = () => {
    const errors: string[] = [];
    
    // Validate service data
    const validation = validateService({
      name: currentService.name,
      shortDescription: currentService.shortDescription,
      priceLabel: currentService.priceLabel
    });

    if (!validation.isValid) {
      errors.push(...validation.errors);
    }

    // Validate full description length if provided
    if (currentService.fullDescription && currentService.fullDescription.length > 2000) {
      errors.push('الوصف التفصيلي طويل جداً (الحد الأقصى 2000 حرف)');
    }

    if (errors.length > 0) {
      setValidationErrors(errors);
      return;
    }

    setValidationErrors([]);

    // Clean up empty list items
    const cleanedService = {
        ...currentService,
        includedItems: currentService.includedItems?.filter(i => i.trim() !== '') || [],
        requirements: currentService.requirements?.filter(i => i.trim() !== '') || [],
        previousWorkTemplates: currentService.previousWorkTemplates?.filter(i => i.trim() !== '') || []
    } as Service;

    if (cleanedService.id) {
      onUpdateService(cleanedService);
    } else {
      onAddService({
        ...cleanedService,
        id: `svc_${Date.now()}`
      });
    }
    
    setShowModal(false);
    setValidationErrors([]);
    // Notification will be shown by App.tsx handler
  };

  return (
    <div className="space-y-6 animate-fade-in pb-12">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <Briefcase className="text-brand dark:text-brand" />
            الخدمات
          </h2>
          <p className="text-gray-500 dark:text-gray-400">إدارة الباقات والخدمات التي تقدمها للعملاء.</p>
        </div>
        <button 
          onClick={handleOpenAddModal}
          className="flex items-center gap-2 px-4 py-2 bg-brand text-white rounded-xl hover:bg-brand-700 shadow-md transition-colors"
        >
          <Plus size={18} />
          <span>إضافة خدمة جديدة</span>
        </button>
      </div>

      {/* List / Table */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden transition-colors">
        <div className="p-4 border-b border-gray-100 dark:border-gray-700">
          <div className="relative max-w-md">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
            <input 
              type="text" 
              placeholder="بحث عن خدمة..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pr-10 pl-4 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand dark:text-white"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-right">
            <thead className="bg-gray-50 dark:bg-gray-700/50 text-gray-600 dark:text-gray-300 text-sm font-medium">
              <tr>
                <th className="px-6 py-4">اسم الخدمة</th>
                <th className="px-6 py-4">الفئة</th>
                <th className="px-6 py-4">نوع الخدمة</th>
                <th className="px-6 py-4">السعر</th>
                <th className="px-6 py-4">الإجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {filteredServices.map((svc) => (
                <tr key={svc.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors">
                  <td className="px-6 py-4">
                    <div>
                        <p className="font-bold text-gray-900 dark:text-white">{svc.name}</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400 truncate max-w-[200px]">{svc.shortDescription}</p>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-gray-600 dark:text-gray-300">
                    <span className="px-3 py-1 bg-gray-100 dark:bg-gray-700 rounded-full text-xs font-medium">
                      {svc.category || 'عام'}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-600 dark:text-gray-300">
                     {svc.type}
                  </td>
                  <td className="px-6 py-4 font-bold text-brand dark:text-brand">
                     {svc.priceLabel}
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex gap-2">
                      <button 
                        onClick={() => handleEditClick(svc)}
                        className="p-2 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg"
                      >
                        <Edit2 size={16} />
                      </button>
                      <button 
                        onClick={() => onDeleteService(svc.id)}
                        className="p-2 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {filteredServices.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-gray-400 dark:text-gray-500">
                    لا توجد خدمات مضافة حالياً.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add/Edit Modal */}
      {showModal && createPortal(
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-[10000] p-4 animate-fade-in">
          <div className="bg-white dark:bg-gray-800 rounded-2xl w-full max-w-3xl shadow-2xl flex flex-col max-h-[90vh] border border-gray-100 dark:border-gray-700 animate-fade-in relative z-[10001]">
            {/* Modal Header */}
            <div className="p-6 border-b border-gray-100 dark:border-gray-700 flex justify-between items-center bg-gray-50 dark:bg-gray-900/50 rounded-t-2xl">
                <div>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">لوحة التحكم &gt; الخدمات &gt; {currentService.id ? 'تعديل' : 'إضافة'}</p>
                    <h3 className="text-xl font-bold text-gray-900 dark:text-white">
                    {currentService.id ? 'تعديل الخدمة' : 'إضافة خدمة جديدة'}
                    </h3>
                </div>
                <button onClick={() => {
                  setShowModal(false);
                  setValidationErrors([]);
                }} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
                    <X size={24} />
                </button>
            </div>

            {/* Validation Errors */}
            {validationErrors.length > 0 && (
              <div className="mx-6 mt-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
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
            
            {/* Modal Body */}
            <div className="p-6 overflow-y-auto custom-scrollbar space-y-6">
               
               {/* Section 1: Basic Info */}
               <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">اسم الخدمة <span className="text-red-500">*</span></label>
                    <input 
                      type="text" 
                      required
                      maxLength={200}
                      className="w-full p-2 border border-gray-200 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-brand outline-none"
                      value={currentService.name || ''}
                      onChange={e => {
                        const value = e.target.value;
                        if (value.length <= 200) {
                          setCurrentService({...currentService, name: value});
                        }
                      }}
                      placeholder="مثال: إدارة حملات إعلانية"
                      aria-required="true"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">الفئة</label>
                    <input 
                      type="text" 
                      maxLength={100}
                      className="w-full p-2 border border-gray-200 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-brand outline-none"
                      value={currentService.category || ''}
                      onChange={e => {
                        const value = e.target.value;
                        if (value.length <= 100) {
                          setCurrentService({...currentService, category: value});
                        }
                      }}
                      placeholder="مثال: تسويق، برمجة..."
                    />
                  </div>
               </div>

               <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">نوع الخدمة</label>
                  <select 
                    className="w-full p-2 border border-gray-200 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-brand outline-none"
                    value={currentService.type}
                    onChange={e => setCurrentService({...currentService, type: e.target.value})}
                  >
                      <option value="باقة">باقة</option>
                      <option value="جلسة واحدة">جلسة واحدة</option>
                      <option value="اشتراك شهري">اشتراك شهري</option>
                  </select>
               </div>

               {/* Section 2: Descriptions */}
               <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">وصف مختصر <span className="text-red-500">*</span></label>
                  <input 
                    type="text" 
                    required
                    maxLength={500}
                    className="w-full p-2 border border-gray-200 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-brand outline-none"
                    value={currentService.shortDescription || ''}
                    onChange={e => {
                      const value = e.target.value;
                      if (value.length <= 500) {
                        setCurrentService({...currentService, shortDescription: value});
                      }
                    }}
                    placeholder="وصف يظهر في القوائم المختصرة"
                    aria-required="true"
                  />
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{(currentService.shortDescription || '').length}/500</p>
               </div>
               <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">وصف تفصيلي</label>
                  <textarea 
                    rows={3}
                    maxLength={2000}
                    className="w-full p-2 border border-gray-200 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-brand outline-none"
                    value={currentService.fullDescription || ''}
                    onChange={e => {
                      const value = e.target.value;
                      if (value.length <= 2000) {
                        setCurrentService({...currentService, fullDescription: value});
                      }
                    }}
                    placeholder="شرح كامل للخدمة..."
                  />
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{(currentService.fullDescription || '').length}/2000</p>
               </div>

               {/* Section 3: Pricing & Timing */}
               <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-gray-50 dark:bg-gray-700/30 p-4 rounded-xl border border-gray-100 dark:border-gray-700">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">صيغة السعر <span className="text-red-500">*</span></label>
                    <input 
                      type="text" 
                      required
                      maxLength={100}
                      className="w-full p-2 border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-brand outline-none"
                      value={currentService.priceLabel || ''}
                      onChange={e => {
                        const value = e.target.value;
                        if (value.length <= 100) {
                          setCurrentService({...currentService, priceLabel: value});
                        }
                      }}
                      placeholder="مثال: ابتداءً من 100 دولار"
                      aria-required="true"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">نوع التسعير</label>
                    <select 
                      className="w-full p-2 border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-brand outline-none"
                      value={currentService.pricingType}
                      onChange={e => setCurrentService({...currentService, pricingType: e.target.value as any})}
                    >
                        <option value="one_time">مرة واحدة</option>
                        <option value="subscription">اشتراك دوري</option>
                        <option value="per_hour">بالساعة</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">مدة التنفيذ</label>
                    <input 
                      type="text" 
                      className="w-full p-2 border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-brand outline-none"
                      value={currentService.duration}
                      onChange={e => setCurrentService({...currentService, duration: e.target.value})}
                      placeholder="مثال: شهر كامل"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">وقت بدء التنفيذ</label>
                    <input 
                      type="text" 
                      className="w-full p-2 border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-brand outline-none"
                      value={currentService.deliveryTime}
                      onChange={e => setCurrentService({...currentService, deliveryTime: e.target.value})}
                      placeholder="مثال: خلال 48 ساعة"
                    />
                  </div>
               </div>

               {/* Section 4: Dynamic Lists (Included & Requirements & Previous Work) */}
               <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                   
                   {/* Included Items */}
                   <div>
                      <div className="flex justify-between items-center mb-2">
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">ما الذي يشمله العرض؟</label>
                        <button onClick={() => addListItem('includedItems')} className="text-brand text-xs font-bold hover:underline flex items-center gap-1">
                            <ListPlus size={14} /> إضافة عنصر
                        </button>
                      </div>
                      <div className="space-y-2">
                        {currentService.includedItems?.map((item, idx) => (
                            <div key={idx} className="flex gap-2">
                                <input 
                                    type="text"
                                    value={item}
                                    onChange={e => handleListChange('includedItems', idx, e.target.value)}
                                    className="flex-1 p-2 border border-gray-200 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:ring-2 focus:ring-brand outline-none"
                                    placeholder="أدخل ميزة..."
                                />
                                <button onClick={() => removeListItem('includedItems', idx)} className="text-red-400 hover:text-red-600 p-1">
                                    <Trash2 size={16} />
                                </button>
                            </div>
                        ))}
                        {(!currentService.includedItems || currentService.includedItems.length === 0) && (
                            <p className="text-xs text-gray-400 italic">لا توجد عناصر مضافة.</p>
                        )}
                      </div>
                   </div>

                   {/* Requirements */}
                   <div>
                      <div className="flex justify-between items-center mb-2">
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">ما الذي تحتاجه من العميل؟</label>
                        <button onClick={() => addListItem('requirements')} className="text-brand text-xs font-bold hover:underline flex items-center gap-1">
                            <ListPlus size={14} /> إضافة عنصر
                        </button>
                      </div>
                      <div className="space-y-2">
                        {currentService.requirements?.map((item, idx) => (
                            <div key={idx} className="flex gap-2">
                                <input 
                                    type="text"
                                    value={item}
                                    onChange={e => handleListChange('requirements', idx, e.target.value)}
                                    className="flex-1 p-2 border border-gray-200 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:ring-2 focus:ring-brand outline-none"
                                    placeholder="أدخل متطلب..."
                                />
                                <button onClick={() => removeListItem('requirements', idx)} className="text-red-400 hover:text-red-600 p-1">
                                    <Trash2 size={16} />
                                </button>
                            </div>
                        ))}
                         {(!currentService.requirements || currentService.requirements.length === 0) && (
                            <p className="text-xs text-gray-400 italic">لا توجد متطلبات مضافة.</p>
                        )}
                      </div>
                   </div>

                   {/* Previous Work Templates (New Section) */}
                   <div className="md:col-span-2">
                      <div className="flex justify-between items-center mb-2">
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center gap-2">
                            نماذج أعمال سابقة (اختياري)
                            <span className="text-xs text-gray-400 font-normal">(روابط أو وصف)</span>
                        </label>
                        <button onClick={() => addListItem('previousWorkTemplates')} className="text-brand text-xs font-bold hover:underline flex items-center gap-1">
                            <ListPlus size={14} /> إضافة نموذج
                        </button>
                      </div>
                      <div className="space-y-2">
                        {currentService.previousWorkTemplates?.map((item, idx) => (
                            <div key={idx} className="flex gap-2">
                                <div className="relative flex-1">
                                    <LinkIcon className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" size={14} />
                                    <input 
                                        type="text"
                                        value={item}
                                        onChange={e => handleListChange('previousWorkTemplates', idx, e.target.value)}
                                        className="w-full p-2 pr-9 border border-gray-200 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:ring-2 focus:ring-brand outline-none text-left dir-ltr placeholder:text-right"
                                        placeholder="رابط أو وصف لعمل سابق..."
                                    />
                                </div>
                                <button onClick={() => removeListItem('previousWorkTemplates', idx)} className="text-red-400 hover:text-red-600 p-1">
                                    <Trash2 size={16} />
                                </button>
                            </div>
                        ))}
                         {(!currentService.previousWorkTemplates || currentService.previousWorkTemplates.length === 0) && (
                            <p className="text-xs text-gray-400 italic">لا توجد نماذج مضافة.</p>
                        )}
                      </div>
                   </div>
               </div>
               
               {/* Section 5: Links & Contact */}
               <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">رابط حجز أو طلب الخدمة</label>
                    <input 
                      type="text" 
                      className="w-full p-2 border border-gray-200 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-brand outline-none text-left dir-ltr"
                      value={currentService.bookingLink}
                      onChange={e => setCurrentService({...currentService, bookingLink: e.target.value})}
                      placeholder="https://calendly.com/..."
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">قناة التواصل المفضلة</label>
                    <input 
                      type="text" 
                      className="w-full p-2 border border-gray-200 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-brand outline-none"
                      value={currentService.contactChannel}
                      onChange={e => setCurrentService({...currentService, contactChannel: e.target.value})}
                      placeholder="WhatsApp, Email, Phone..."
                    />
                  </div>
               </div>

            </div>

            {/* Modal Footer */}
            <div className="p-6 border-t border-gray-100 dark:border-gray-700 flex justify-end gap-3 bg-gray-50 dark:bg-gray-900/50 rounded-b-2xl">
              <button 
                onClick={() => setShowModal(false)}
                className="px-4 py-2 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
              >
                إلغاء
              </button>
              <button 
                onClick={handleSave}
                className="px-6 py-2 bg-brand text-white rounded-lg hover:bg-brand-700 shadow-md flex items-center gap-2"
              >
                <Check size={18} />
                <span>حفظ الخدمة</span>
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};

export default ServiceManager;