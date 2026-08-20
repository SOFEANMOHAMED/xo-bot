import React, { useEffect, useState, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AdminGlobalSettings, SystemLog } from '../../types';
import apiService from '../../services/api';
import { Save, ToggleLeft, ToggleRight, AlertCircle, Info, AlertTriangle, Loader2, Upload, Copy, Link2, Unlink, Facebook } from 'lucide-react';
import { useAdminNotifications } from './AdminNotificationContext';
import { logger } from '../../utils/logger';
import { PATHS } from '../../routes/paths';

interface AdminSystemProps {
  view: 'SETTINGS' | 'LOGS';
}

const SettingsView: React.FC = () => {
    const [settings, setSettings] = useState<AdminGlobalSettings | null>(null);
    const [uploadingQr, setUploadingQr] = useState<'shamCash' | 'usdt' | null>(null);
    const { showSuccess, showError } = useAdminNotifications();
    const [searchParams, setSearchParams] = useSearchParams();

    const [officialPage, setOfficialPage] = useState<{
      pageId: string;
      pageName: string | null;
      linkedAt: string;
    } | null>(null);
    const [fbConnecting, setFbConnecting] = useState(false);
    const [fbLinkingSessionId, setFbLinkingSessionId] = useState('');
    const [fbAvailablePages, setFbAvailablePages] = useState<Array<{
      id: string;
      name: string;
      category: string | null;
      pictureUrl: string | null;
    }>>([]);
    const [fbLoadingPages, setFbLoadingPages] = useState(false);
    const [fbLinking, setFbLinking] = useState(false);
    const [selectedOfficialPageId, setSelectedOfficialPageId] = useState<string>('');

    const refreshOfficialStatus = useCallback(async () => {
      try {
        const status = await apiService.getOfficialFacebookStatus();
        setOfficialPage(status.page);
      } catch (err: any) {
        logger.error('Failed to fetch official Facebook status:', err);
      }
    }, []);

    useEffect(() => {
        const fetchSettings = async () => {
            try {
                const response = await apiService.getGlobalSettings();
                setSettings({
                    ...response,
                    features: {
                        affiliateEnabled: response.features?.affiliateEnabled ?? true,
                        landingBotEnabled: response.features?.landingBotEnabled ?? true,
                        dashboardBotEnabled: response.features?.dashboardBotEnabled ?? true,
                        productsBotEnabled: response.features?.productsBotEnabled ?? true,
                        servicesBotEnabled: response.features?.servicesBotEnabled ?? true,
                        officialPageBotEnabled: response.features?.officialPageBotEnabled ?? false,
                    },
                    bots: {
                        productsBot: {
                            enabled: response.bots?.productsBot?.enabled ?? true,
                            systemMessage: response.bots?.productsBot?.systemMessage || '',
                        },
                        servicesBot: {
                            enabled: response.bots?.servicesBot?.enabled ?? true,
                            systemMessage: response.bots?.servicesBot?.systemMessage || '',
                        },
                        officialPageBot: {
                            enabled: response.bots?.officialPageBot?.enabled ?? false,
                            systemMessage: response.bots?.officialPageBot?.systemMessage || '',
                        },
                    },
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
        refreshOfficialStatus();
    }, [refreshOfficialStatus]);

    useEffect(() => {
        const facebook = searchParams.get('facebook');
        const session = searchParams.get('fb_session');
        const reason = searchParams.get('reason');

        if (facebook === 'error') {
            showError(
                reason === 'no_pages'
                    ? 'لم يتم العثور على صفحات فيسبوك. تأكد من صلاحيات الصفحة.'
                    : reason === 'business_pages'
                      ? 'قد تحتاج صلاحية Business Management لرؤية صفحات Business Suite.'
                      : 'فشل ربط فيسبوك. حاول مرة أخرى.'
            );
            setSearchParams({}, { replace: true });
            return;
        }

        if (facebook === 'select_pages' && session) {
            setFbLinkingSessionId(session);
            setFbLoadingPages(true);
            apiService
                .getOfficialAvailableFacebookPages(session)
                .then(async (data) => {
                    const pages = data.pages || [];
                    setFbAvailablePages(pages);
                    if (pages.length === 1) {
                        setSelectedOfficialPageId(pages[0].id);
                        // Auto-confirm when Meta returns a single page — avoids unfinished OAuth.
                        try {
                            setFbLinking(true);
                            const result = await apiService.linkOfficialFacebookPage(session, pages[0].id);
                            setOfficialPage(result.page);
                            setFbLinkingSessionId('');
                            setFbAvailablePages([]);
                            setSelectedOfficialPageId('');
                            showSuccess(result.message || 'تم ربط الصفحة الرسمية تلقائياً');
                        } catch (err: any) {
                            showError(err?.message || 'فشل الربط التلقائي — اختر الصفحة يدوياً');
                        } finally {
                            setFbLinking(false);
                        }
                    }
                })
                .catch((err: any) => {
                    showError(err?.message || 'تعذر تحميل صفحات فيسبوك');
                    setFbLinkingSessionId('');
                })
                .finally(() => {
                    setFbLoadingPages(false);
                    setSearchParams({}, { replace: true });
                });
        }
    }, [searchParams, setSearchParams, showError]);

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

    const handleConnectOfficialFacebook = async () => {
        try {
            setFbConnecting(true);
            const result = await apiService.connectOfficialFacebook(PATHS.ADMIN);
            if ((result as any).requiresSetup || !result.authUrl) {
                showError((result as any).message || 'Facebook OAuth غير مضبوط على الخادم');
                return;
            }
            window.location.href = result.authUrl;
        } catch (err: any) {
            showError(err?.message || 'فشل بدء ربط فيسبوك');
        } finally {
            setFbConnecting(false);
        }
    };

    const handleLinkOfficialPage = async () => {
        if (!fbLinkingSessionId || !selectedOfficialPageId) {
            showError('اختر صفحة للربط');
            return;
        }
        try {
            setFbLinking(true);
            const result = await apiService.linkOfficialFacebookPage(
                fbLinkingSessionId,
                selectedOfficialPageId
            );
            setOfficialPage(result.page);
            setFbLinkingSessionId('');
            setFbAvailablePages([]);
            setSelectedOfficialPageId('');
            showSuccess(result.message || 'تم ربط الصفحة الرسمية');
        } catch (err: any) {
            showError(err?.message || 'فشل ربط الصفحة');
        } finally {
            setFbLinking(false);
        }
    };

    const handleDisconnectOfficialFacebook = async () => {
        if (!confirm('هل تريد فصل الصفحة الرسمية؟ سيتوقف البوت عن الرد على رسائلها.')) return;
        try {
            await apiService.disconnectOfficialFacebook();
            setOfficialPage(null);
            showSuccess('تم فصل الصفحة الرسمية');
        } catch (err: any) {
            showError(err?.message || 'فشل فصل الصفحة');
        }
    };

    const handleSave = async () => {
        if (!settings) return;
        
        try {
            const payload: AdminGlobalSettings = {
                ...settings,
                features: {
                    ...settings.features,
                    officialPageBotEnabled: settings.bots.officialPageBot.enabled,
                },
            };
            await apiService.updateGlobalSettings(payload);
            showSuccess("تم حفظ الإعدادات بنجاح!");
        } catch (err: any) {
            logger.error('Failed to save global settings:', err);
            showError('فشل حفظ الإعدادات: ' + (err.message || 'خطأ غير معروف'));
        }
    };

    if (!settings) return <Loader2 className="animate-spin text-white" />;

    const bots = settings.bots;

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

                <div className="bg-slate-900/50 rounded-xl p-6 border border-slate-700 space-y-5">
                    <div className="flex items-center justify-between gap-4">
                        <div>
                            <h3 className="text-lg font-bold text-white flex items-center gap-2">
                                <Facebook size={20} className="text-blue-400" />
                                بوت صفحة XO Bot الرسمية
                            </h3>
                            <p className="text-xs text-slate-400 mt-1">
                                بوت مستقل عن بوتات التجار — يُربط ويُدار من السوبر أدمن فقط
                            </p>
                        </div>
                        <ToggleItem
                            label=""
                            enabled={bots.officialPageBot?.enabled ?? false}
                            onToggle={() => {
                                if (!settings) return;
                                const newEnabled = !(bots.officialPageBot?.enabled ?? false);
                                setSettings({
                                    ...settings,
                                    bots: {
                                        ...bots,
                                        officialPageBot: {
                                            ...(bots.officialPageBot || { systemMessage: '' }),
                                            enabled: newEnabled,
                                            systemMessage: bots.officialPageBot?.systemMessage || '',
                                        },
                                    },
                                    features: {
                                        ...settings.features,
                                        officialPageBotEnabled: newEnabled,
                                    },
                                });
                            }}
                        />
                    </div>

                    <div className="rounded-xl border border-slate-700 bg-slate-800/60 p-4 space-y-3">
                        <div className="flex items-center justify-between gap-3 flex-wrap">
                            <div>
                                <p className="text-sm font-medium text-slate-200">ربط صفحة فيسبوك الرسمية</p>
                                {officialPage ? (
                                    <p className="text-xs text-emerald-400 mt-1">
                                        مربوطة: {officialPage.pageName || officialPage.pageId}
                                        <span className="text-slate-500 mr-2" dir="ltr"> ({officialPage.pageId})</span>
                                    </p>
                                ) : (
                                    <p className="text-xs text-amber-400 mt-1">لا توجد صفحة مربوطة حالياً</p>
                                )}
                            </div>
                            <div className="flex gap-2">
                                {officialPage ? (
                                    <button
                                        type="button"
                                        onClick={handleDisconnectOfficialFacebook}
                                        className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-700 hover:bg-red-900/40 text-slate-200 text-sm"
                                    >
                                        <Unlink size={16} /> فصل
                                    </button>
                                ) : null}
                                <button
                                    type="button"
                                    onClick={handleConnectOfficialFacebook}
                                    disabled={fbConnecting}
                                    className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium disabled:opacity-60"
                                >
                                    {fbConnecting ? <Loader2 size={16} className="animate-spin" /> : <Link2 size={16} />}
                                    {officialPage ? 'إعادة الربط' : 'ربط عبر فيسبوك'}
                                </button>
                            </div>
                        </div>

                        {(fbLoadingPages || fbLinkingSessionId) && (
                            <div className="border-t border-slate-700 pt-3 space-y-3">
                                <p className="text-sm text-slate-300 font-medium">اختر الصفحة الرسمية</p>
                                {fbLoadingPages ? (
                                    <div className="flex items-center gap-2 text-slate-400 text-sm">
                                        <Loader2 size={16} className="animate-spin" /> جاري تحميل الصفحات...
                                    </div>
                                ) : fbAvailablePages.length === 0 ? (
                                    <p className="text-xs text-amber-400">لا توجد صفحات متاحة في هذه الجلسة</p>
                                ) : (
                                    <div className="space-y-2 max-h-56 overflow-y-auto">
                                        {fbAvailablePages.map((p) => (
                                            <label
                                                key={p.id}
                                                className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                                                    selectedOfficialPageId === p.id
                                                        ? 'border-indigo-500 bg-indigo-950/40'
                                                        : 'border-slate-700 hover:border-slate-500'
                                                }`}
                                            >
                                                <input
                                                    type="radio"
                                                    name="officialPage"
                                                    checked={selectedOfficialPageId === p.id}
                                                    onChange={() => setSelectedOfficialPageId(p.id)}
                                                    className="accent-indigo-500"
                                                />
                                                {p.pictureUrl ? (
                                                    <img src={p.pictureUrl} alt="" className="w-8 h-8 rounded-full" />
                                                ) : (
                                                    <div className="w-8 h-8 rounded-full bg-slate-700" />
                                                )}
                                                <div className="min-w-0">
                                                    <p className="text-sm text-white truncate">{p.name}</p>
                                                    <p className="text-xs text-slate-500" dir="ltr">{p.id}</p>
                                                </div>
                                            </label>
                                        ))}
                                    </div>
                                )}
                                {fbLinkingSessionId && !fbLoadingPages && fbAvailablePages.length > 0 && (
                                    <button
                                        type="button"
                                        onClick={handleLinkOfficialPage}
                                        disabled={fbLinking || !selectedOfficialPageId}
                                        className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-bold disabled:opacity-60"
                                    >
                                        {fbLinking ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                                        تأكيد ربط الصفحة
                                    </button>
                                )}
                            </div>
                        )}
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-slate-300 mb-2">
                            System Prompt (رسالة النظام لبوت الصفحة الرسمية)
                        </label>
                        <textarea
                            value={bots.officialPageBot?.systemMessage || ''}
                            onChange={(e) => {
                                if (!settings) return;
                                setSettings({
                                    ...settings,
                                    bots: {
                                        ...bots,
                                        officialPageBot: {
                                            enabled: bots.officialPageBot?.enabled ?? false,
                                            systemMessage: e.target.value,
                                        },
                                    },
                                });
                            }}
                            rows={10}
                            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-3 text-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none font-mono text-sm"
                            placeholder="اكتب تعليمات شخصية البوت وسيناريو الرد (مثلاً مقابلة العمل التفاعلية)..."
                        />
                        <p className="text-xs text-slate-500 mt-2">
                            عند الإيقاف يتوقف الرد فوراً على الصفحة الرسمية دون التأثير على صفحات التجار.
                        </p>
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
