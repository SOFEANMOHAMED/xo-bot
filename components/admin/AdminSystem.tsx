import React, { useEffect, useState } from 'react';
import { AdminGlobalSettings, SystemLog } from '../../types';
import apiService from '../../services/api';
import { Save, ToggleLeft, ToggleRight, AlertCircle, Info, AlertTriangle, Loader2, Upload, Copy } from 'lucide-react';
import { useAdminNotifications } from './AdminNotificationContext';
import { logger } from '../../utils/logger';

interface AdminSystemProps {
  view: 'SETTINGS' | 'LOGS';
}

const SettingsView: React.FC = () => {
    const [settings, setSettings] = useState<AdminGlobalSettings | null>(null);
    const [uploadingQr, setUploadingQr] = useState<'shamCash' | 'usdt' | null>(null);
    const { showSuccess, showError } = useAdminNotifications();

    useEffect(() => {
        const fetchSettings = async () => {
            try {
                const response = await apiService.getGlobalSettings();
                setSettings({
                    ...response,
                    paymentMethods: {
                        shamCash: {
                            enabled: response.paymentMethods?.shamCash?.enabled ?? true,
                            walletAddress: response.paymentMethods?.shamCash?.walletAddress || '',
                            qrImageUrl: response.paymentMethods?.shamCash?.qrImageUrl || '',
                            instructions: response.paymentMethods?.shamCash?.instructions ||
                              'حوّل المبلغ إلى عنوان محفظة شام كاش ثم ارفع إثبات التحويل (صورة أو PDF).'
                        },
                        usdt: {
                            enabled: response.paymentMethods?.usdt?.enabled ?? true,
                            walletAddress: response.paymentMethods?.usdt?.walletAddress || '',
                            qrImageUrl: response.paymentMethods?.usdt?.qrImageUrl || '',
                            network: response.paymentMethods?.usdt?.network || 'TRC20',
                            instructions: response.paymentMethods?.usdt?.instructions ||
                              'حوّل المبلغ بـ USDT إلى عنوان المحفظة ثم ارفع إثبات التحويل (صورة أو PDF).'
                        }
                    }
                });
            } catch (err: any) {
                logger.error('Failed to fetch global settings:', err);
            }
        };
        fetchSettings();
    }, []);

    const handleToggle = (feature: keyof AdminGlobalSettings['features']) => {
        if (settings) {
            setSettings({
                ...settings,
                features: {
                    ...settings.features,
                    [feature]: !settings.features[feature]
                }
            });
        }
    };

    const updateShamCash = (patch: Partial<NonNullable<AdminGlobalSettings['paymentMethods']>['shamCash']>) => {
        if (!settings) return;
        const current = settings.paymentMethods?.shamCash || {
            enabled: true,
            walletAddress: '',
            qrImageUrl: '',
            instructions: ''
        };
        setSettings({
            ...settings,
            paymentMethods: {
                ...settings.paymentMethods!,
                shamCash: { ...current, ...patch },
                usdt: settings.paymentMethods?.usdt || {
                    enabled: true,
                    walletAddress: '',
                    qrImageUrl: '',
                    network: 'TRC20',
                    instructions: ''
                }
            }
        });
    };

    const updateUsdt = (patch: Partial<NonNullable<AdminGlobalSettings['paymentMethods']>['usdt']>) => {
        if (!settings) return;
        const current = settings.paymentMethods?.usdt || {
            enabled: true,
            walletAddress: '',
            qrImageUrl: '',
            network: 'TRC20',
            instructions: ''
        };
        setSettings({
            ...settings,
            paymentMethods: {
                ...settings.paymentMethods!,
                shamCash: settings.paymentMethods?.shamCash || {
                    enabled: true,
                    walletAddress: '',
                    qrImageUrl: '',
                    instructions: ''
                },
                usdt: { ...current, ...patch }
            }
        });
    };

    const handleQrUpload = async (
        e: React.ChangeEvent<HTMLInputElement>,
        target: 'shamCash' | 'usdt'
    ) => {
        const file = e.target.files?.[0];
        if (!file) return;
        try {
            setUploadingQr(target);
            const result = await apiService.uploadFile(file);
            const url = result.file.path || result.file.url;
            if (target === 'shamCash') updateShamCash({ qrImageUrl: url });
            else updateUsdt({ qrImageUrl: url });
            showSuccess('تم رفع رمز QR بنجاح');
        } catch (err: any) {
            showError('فشل رفع رمز QR: ' + (err.message || 'خطأ غير معروف'));
        } finally {
            setUploadingQr(null);
            e.target.value = '';
        }
    };

    const handleSave = async () => {
        if (!settings) return;
        
        try {
            await apiService.updateGlobalSettings(settings);
            showSuccess("تم حفظ الإعدادات بنجاح!");
        } catch (err: any) {
            logger.error('Failed to save global settings:', err);
            showError('فشل حفظ الإعدادات: ' + (err.message || 'خطأ غير معروف'));
        }
    };

    if (!settings) return <Loader2 className="animate-spin text-white" />;

    const bots = settings.bots || {
        productsBot: {
            enabled: settings.features?.productsBotEnabled ?? true,
            systemMessage: ''
        },
        servicesBot: {
            enabled: settings.features?.servicesBotEnabled ?? true,
            systemMessage: ''
        }
    };

    const shamCash = settings.paymentMethods?.shamCash;
    const usdt = settings.paymentMethods?.usdt;

    return (
        <div className="max-w-3xl space-y-8 animate-fade-in">
            <h2 className="text-xl font-bold text-white mb-6">الإعدادات العامة للنظام</h2>
            
            <div className="bg-slate-800 rounded-2xl p-6 border border-slate-700 space-y-6">
                <div>
                    <h3 className="text-lg font-bold text-white mb-4 border-b border-slate-700 pb-2">إعدادات الفترة التجريبية</h3>
                    <div className="grid grid-cols-2 gap-6">
                        <div>
                            <label className="block text-sm text-slate-400 mb-2">مدة التجربة (أيام)</label>
                            <input type="number" value={settings.trialDays} readOnly className="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-2 text-white" />
                        </div>
                        <div>
                            <label className="block text-sm text-slate-400 mb-2">حد الذكاء الاصطناعي (طلبات)</label>
                            <input type="number" value={settings.trialAiLimit} readOnly className="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-2 text-white" />
                        </div>
                    </div>
                </div>

                <div className="bg-slate-900/50 rounded-xl p-6 border border-slate-700 space-y-4">
                    <div className="flex items-center justify-between border-b border-slate-700 pb-3">
                        <div>
                            <h3 className="text-lg font-bold text-white">شام كاش (دفع أوف لاين)</h3>
                            <p className="text-xs text-slate-400 mt-1">تظهر للتاجر عند الاشتراك في لوحة التحكم</p>
                        </div>
                        <ToggleItem
                            label=""
                            enabled={shamCash?.enabled ?? true}
                            onToggle={() => updateShamCash({ enabled: !(shamCash?.enabled ?? true) })}
                        />
                    </div>

                    <div>
                        <label className="block text-sm text-slate-400 mb-2">عنوان المحفظة</label>
                        <div className="flex gap-2">
                            <input
                                type="text"
                                value={shamCash?.walletAddress || ''}
                                onChange={(e) => updateShamCash({ walletAddress: e.target.value })}
                                placeholder="أدخل عنوان محفظة شام كاش"
                                className="flex-1 bg-slate-800 border border-slate-600 rounded-lg px-4 py-2 text-white font-mono text-sm"
                                dir="ltr"
                            />
                            {shamCash?.walletAddress && (
                                <button
                                    type="button"
                                    onClick={() => {
                                        navigator.clipboard.writeText(shamCash.walletAddress);
                                        showSuccess('تم نسخ العنوان');
                                    }}
                                    className="px-3 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-slate-200"
                                    title="نسخ"
                                >
                                    <Copy size={16} />
                                </button>
                            )}
                        </div>
                    </div>

                    <div>
                        <label className="block text-sm text-slate-400 mb-2">رمز QR</label>
                        <div className="flex flex-col sm:flex-row gap-4 items-start">
                            {shamCash?.qrImageUrl ? (
                                <img
                                    src={shamCash.qrImageUrl}
                                    alt="Sham Cash QR"
                                    className="w-36 h-36 object-contain rounded-xl border border-slate-600 bg-white p-2"
                                />
                            ) : (
                                <div className="w-36 h-36 rounded-xl border border-dashed border-slate-600 flex items-center justify-center text-slate-500 text-xs text-center p-2">
                                    لا توجد صورة QR
                                </div>
                            )}
                            <div>
                                <label className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl cursor-pointer text-sm font-medium">
                                    {uploadingQr === 'shamCash' ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
                                    رفع صورة QR
                                    <input
                                        type="file"
                                        accept="image/*"
                                        className="hidden"
                                        onChange={(e) => handleQrUpload(e, 'shamCash')}
                                        disabled={uploadingQr !== null}
                                    />
                                </label>
                                <p className="text-xs text-slate-500 mt-2">صورة PNG أو JPG لرمز QR الخاص بالمحفظة</p>
                            </div>
                        </div>
                    </div>

                    <div>
                        <label className="block text-sm text-slate-400 mb-2">تعليمات الدفع (اختياري)</label>
                        <textarea
                            value={shamCash?.instructions || ''}
                            onChange={(e) => updateShamCash({ instructions: e.target.value })}
                            rows={3}
                            className="w-full bg-slate-800 border border-slate-600 rounded-lg px-4 py-2 text-white text-sm"
                            placeholder="تعليمات تظهر للتاجر عند الدفع..."
                        />
                    </div>
                </div>

                <div className="bg-slate-900/50 rounded-xl p-6 border border-slate-700 space-y-4">
                    <div className="flex items-center justify-between border-b border-slate-700 pb-3">
                        <div>
                            <h3 className="text-lg font-bold text-white">USDT (دفع أوف لاين)</h3>
                            <p className="text-xs text-slate-400 mt-1">تظهر للتاجر عند الاشتراك في لوحة التحكم</p>
                        </div>
                        <ToggleItem
                            label=""
                            enabled={usdt?.enabled ?? true}
                            onToggle={() => updateUsdt({ enabled: !(usdt?.enabled ?? true) })}
                        />
                    </div>

                    <div>
                        <label className="block text-sm text-slate-400 mb-2">الشبكة (Network)</label>
                        <select
                            value={usdt?.network || 'TRC20'}
                            onChange={(e) => updateUsdt({ network: e.target.value })}
                            className="w-full bg-slate-800 border border-slate-600 rounded-lg px-4 py-2 text-white text-sm"
                        >
                            <option value="TRC20">TRC20 (Tron)</option>
                            <option value="ERC20">ERC20 (Ethereum)</option>
                            <option value="BEP20">BEP20 (BSC)</option>
                            <option value="other">أخرى</option>
                        </select>
                    </div>

                    <div>
                        <label className="block text-sm text-slate-400 mb-2">عنوان المحفظة</label>
                        <div className="flex gap-2">
                            <input
                                type="text"
                                value={usdt?.walletAddress || ''}
                                onChange={(e) => updateUsdt({ walletAddress: e.target.value })}
                                placeholder="أدخل عنوان محفظة USDT"
                                className="flex-1 bg-slate-800 border border-slate-600 rounded-lg px-4 py-2 text-white font-mono text-sm"
                                dir="ltr"
                            />
                            {usdt?.walletAddress && (
                                <button
                                    type="button"
                                    onClick={() => {
                                        navigator.clipboard.writeText(usdt.walletAddress);
                                        showSuccess('تم نسخ العنوان');
                                    }}
                                    className="px-3 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-slate-200"
                                    title="نسخ"
                                >
                                    <Copy size={16} />
                                </button>
                            )}
                        </div>
                    </div>

                    <div>
                        <label className="block text-sm text-slate-400 mb-2">رمز QR</label>
                        <div className="flex flex-col sm:flex-row gap-4 items-start">
                            {usdt?.qrImageUrl ? (
                                <img
                                    src={usdt.qrImageUrl}
                                    alt="USDT QR"
                                    className="w-36 h-36 object-contain rounded-xl border border-slate-600 bg-white p-2"
                                />
                            ) : (
                                <div className="w-36 h-36 rounded-xl border border-dashed border-slate-600 flex items-center justify-center text-slate-500 text-xs text-center p-2">
                                    لا توجد صورة QR
                                </div>
                            )}
                            <div>
                                <label className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl cursor-pointer text-sm font-medium">
                                    {uploadingQr === 'usdt' ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
                                    رفع صورة QR
                                    <input
                                        type="file"
                                        accept="image/*"
                                        className="hidden"
                                        onChange={(e) => handleQrUpload(e, 'usdt')}
                                        disabled={uploadingQr !== null}
                                    />
                                </label>
                                <p className="text-xs text-slate-500 mt-2">صورة PNG أو JPG لرمز QR الخاص بالمحفظة</p>
                            </div>
                        </div>
                    </div>

                    <div>
                        <label className="block text-sm text-slate-400 mb-2">تعليمات الدفع (اختياري)</label>
                        <textarea
                            value={usdt?.instructions || ''}
                            onChange={(e) => updateUsdt({ instructions: e.target.value })}
                            rows={3}
                            className="w-full bg-slate-800 border border-slate-600 rounded-lg px-4 py-2 text-white text-sm"
                            placeholder="تعليمات تظهر للتاجر عند الدفع..."
                        />
                    </div>
                </div>

                <div>
                    <h3 className="text-lg font-bold text-white mb-4 border-b border-slate-700 pb-2">التحكم في المميزات</h3>
                    <div className="space-y-4">
                        <ToggleItem 
                            label="تفعيل برنامج التسويق بالعمولة" 
                            enabled={settings.features.affiliateEnabled} 
                            onToggle={() => handleToggle('affiliateEnabled')}
                        />
                        <ToggleItem 
                            label="تفعيل بوت الصفحة الرئيسية (Landing Bot)" 
                            enabled={settings.features.landingBotEnabled}
                            onToggle={() => handleToggle('landingBotEnabled')}
                        />
                        <ToggleItem 
                            label="تفعيل المساعد الداخلي (Dashboard Assistant)" 
                            enabled={settings.features.dashboardBotEnabled}
                            onToggle={() => handleToggle('dashboardBotEnabled')}
                        />
                    </div>
                </div>

                <div className="bg-slate-900/50 rounded-xl p-6 border border-slate-700">
                    <div className="flex items-center justify-between mb-4">
                        <h3 className="text-lg font-bold text-white">إعدادات بوت المنتجات</h3>
                        <ToggleItem 
                            label="" 
                            enabled={bots.productsBot.enabled} 
                            onToggle={() => {
                                if (settings) {
                                    const newEnabled = !bots.productsBot.enabled;
                                    setSettings({
                                        ...settings,
                                        bots: {
                                            ...bots,
                                            productsBot: {
                                                ...bots.productsBot,
                                                enabled: newEnabled
                                            }
                                        },
                                        features: {
                                            ...settings.features,
                                            productsBotEnabled: newEnabled
                                        }
                                    });
                                }
                            }}
                        />
                    </div>
                    <div className="space-y-4">
                        <div>
                            <label className="block text-sm font-medium text-slate-300 mb-2">
                                System Message (رسالة النظام)
                            </label>
                            <textarea
                                value={bots.productsBot.systemMessage || ''}
                                onChange={(e) => {
                                    if (settings) {
                                        setSettings({
                                            ...settings,
                                            bots: {
                                                ...bots,
                                                productsBot: {
                                                    ...bots.productsBot,
                                                    systemMessage: e.target.value
                                                }
                                            }
                                        });
                                    }
                                }}
                                rows={8}
                                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-3 text-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none font-mono text-sm"
                                placeholder="أدخل System Message لبوت المنتجات..."
                            />
                        </div>
                    </div>
                </div>

                <div className="bg-slate-900/50 rounded-xl p-6 border border-slate-700">
                    <div className="flex items-center justify-between mb-4">
                        <h3 className="text-lg font-bold text-white">إعدادات بوت الخدمات</h3>
                        <ToggleItem 
                            label="" 
                            enabled={bots.servicesBot.enabled} 
                            onToggle={() => {
                                if (settings) {
                                    const newEnabled = !bots.servicesBot.enabled;
                                    setSettings({
                                        ...settings,
                                        bots: {
                                            ...bots,
                                            servicesBot: {
                                                ...bots.servicesBot,
                                                enabled: newEnabled
                                            }
                                        },
                                        features: {
                                            ...settings.features,
                                            servicesBotEnabled: newEnabled
                                        }
                                    });
                                }
                            }}
                        />
                    </div>
                    <div className="space-y-4">
                        <div>
                            <label className="block text-sm font-medium text-slate-300 mb-2">
                                System Message (رسالة النظام)
                            </label>
                            <textarea
                                value={bots.servicesBot.systemMessage || ''}
                                onChange={(e) => {
                                    if (settings) {
                                        setSettings({
                                            ...settings,
                                            bots: {
                                                ...bots,
                                                servicesBot: {
                                                    ...bots.servicesBot,
                                                    systemMessage: e.target.value
                                                }
                                            }
                                        });
                                    }
                                }}
                                rows={8}
                                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-3 text-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none font-mono text-sm"
                                placeholder="أدخل System Message لبوت الخدمات..."
                            />
                        </div>
                    </div>
                </div>

                <div className="pt-4 flex justify-end">
                    <button 
                        onClick={handleSave}
                        className="bg-indigo-600 text-white px-6 py-2 rounded-xl font-bold hover:bg-indigo-700 flex items-center gap-2 transition-colors shadow-lg shadow-indigo-900/20"
                    >
                        <Save size={18} /> حفظ الإعدادات
                    </button>
                </div>
            </div>
        </div>
    );
};

const LogsView: React.FC = () => {
    const [logs, setLogs] = useState<SystemLog[]>([]);

    useEffect(() => {
        const fetchLogs = async () => {
            try {
                const response = await apiService.getSystemLogs();
                const logsData = (Array.isArray(response) ? response : []).map((log: any) => ({
                    ...log,
                    time: new Date(log.time)
                }));
                setLogs(logsData);
            } catch (err: any) {
                logger.error('Failed to fetch system logs:', err);
            }
        };
        fetchLogs();
    }, []);

    const getIcon = (type: string) => {
        switch(type) {
            case 'error': return <AlertCircle size={18} className="text-red-500" />;
            case 'warning': return <AlertTriangle size={18} className="text-yellow-500" />;
            default: return <Info size={18} className="text-blue-500" />;
        }
    };

    return (
        <div className="space-y-6 animate-fade-in">
            <h2 className="text-xl font-bold text-white mb-4">سجلات النظام والأخطاء</h2>
            
            <div className="bg-slate-800 rounded-2xl border border-slate-700 overflow-hidden">
                <table className="w-full text-right">
                    <thead className="bg-slate-900 text-slate-400 text-xs uppercase">
                        <tr>
                            <th className="px-6 py-4">النوع</th>
                            <th className="px-6 py-4">المصدر</th>
                            <th className="px-6 py-4">الرسالة</th>
                            <th className="px-6 py-4">الوقت</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-700">
                        {logs.map((log) => (
                            <tr key={log.id} className="hover:bg-slate-700/30 font-mono text-sm transition-colors">
                                <td className="px-6 py-4">
                                    <div className="flex items-center gap-2">
                                        {getIcon(log.type)}
                                        <span className={`uppercase font-bold text-xs ${
                                            log.type === 'error' ? 'text-red-400' : 
                                            log.type === 'warning' ? 'text-yellow-400' : 'text-blue-400'
                                        }`}>{log.type}</span>
                                    </div>
                                </td>
                                <td className="px-6 py-4 text-slate-300">{log.source}</td>
                                <td className="px-6 py-4 text-white">{log.message}</td>
                                <td className="px-6 py-4 text-slate-500" dir="ltr">{log.time.toLocaleTimeString('ar-u-nu-latn')}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

const AdminSystem: React.FC<AdminSystemProps> = ({ view }) => {
    if (view === 'SETTINGS') return <SettingsView />;
    if (view === 'LOGS') return <LogsView />;
    return null;
};

const ToggleItem = ({ label, enabled, onToggle }: { label: string, enabled: boolean, onToggle: () => void }) => (
    <div className={`flex items-center justify-between ${label ? 'p-3 bg-slate-900 rounded-xl border border-slate-700 hover:border-slate-600 transition-colors' : ''}`}>
        {label && <span className="text-slate-300 font-medium">{label}</span>}
        <button 
          onClick={onToggle}
          className={`text-2xl transition-colors hover:scale-110 active:scale-95 ${enabled ? 'text-green-500' : 'text-slate-600'}`}
          title={enabled ? 'تعطيل' : 'تفعيل'}
        >
            {enabled ? <ToggleRight size={32} /> : <ToggleLeft size={32} />}
        </button>
    </div>
);

export default AdminSystem;
