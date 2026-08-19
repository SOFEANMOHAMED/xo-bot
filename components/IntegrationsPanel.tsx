
import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom';
import { Facebook, ShoppingBag, CheckCircle, XCircle, RefreshCw, Activity, MessageCircle, Clock, Link as LinkIcon, AlertCircle, Trash2, Send, AlertTriangle, ShoppingCart, MessageSquare, Plus, Edit2, Settings, Store } from 'lucide-react';
import { IntegrationStatus, IntegrationLog, MerchantSettings, DEFAULT_PLAN_CAPABILITIES } from '../types';
import { generateLog } from '../services/mockBackend';
import { apiService } from '../services/api';
import { Product } from '../types';
import { logger } from '../utils/logger';
import { useWhatsAppPairing } from '../hooks/useWhatsAppPairing';

interface FacebookPageInfo {
  id: string;
  name: string;
  category: string | null;
  pictureUrl: string | null;
  alreadyLinked: boolean;
}

interface IntegrationsPanelProps {
  settings: MerchantSettings;
  onUpdateSettings: (s: MerchantSettings) => void;
  onSyncProducts: (products: Product[]) => void;
  onSyncOrders: () => void;
  fbStatus: IntegrationStatus;
  setFbStatus: (status: IntegrationStatus) => void;
  fbLinkingSessionId: string;
  setFbLinkingSessionId: (id: string) => void;
  shopifyStatus: IntegrationStatus;
  setShopifyStatus: (status: IntegrationStatus) => void;
  storifyStatus: IntegrationStatus;
  setStorifyStatus: (status: IntegrationStatus) => void;
  telegramStatus: IntegrationStatus;
  setTelegramStatus: (status: IntegrationStatus) => void;
  whatsappStatus: IntegrationStatus;
  setWhatsappStatus: (status: IntegrationStatus) => void;
  showNotification?: (message: string, type: 'success' | 'error' | 'info' | 'warning', duration?: number) => void;
}

const IntegrationsPanel: React.FC<IntegrationsPanelProps> = ({ 
  settings, 
  onUpdateSettings, 
  onSyncProducts,
  onSyncOrders,
  fbStatus,
  setFbStatus,
  fbLinkingSessionId,
  setFbLinkingSessionId,
  shopifyStatus,
  setShopifyStatus,
  storifyStatus,
  setStorifyStatus,
  telegramStatus,
  setTelegramStatus,
  whatsappStatus,
  setWhatsappStatus,
  showNotification
}) => {
  
  const [shopifyUrl, setShopifyUrl] = useState('');
  const [storifyForm, setStorifyForm] = useState({
    storeDomain: '',
    apiBaseUrl: '',
    accessToken: '',
    productsEndpoint: '/api/storefront/products'
  });
  const [telegramToken, setTelegramToken] = useState(settings.telegramBotToken || '');
  
  // Multiple Telegram Bots State
  const [telegramBots, setTelegramBots] = useState<Array<{
    id: string;
    botName: string | null;
    botUsername: string | null;
    botType: 'products' | 'services' | 'both';
    isActive: boolean;
    tokenPreview: string | null;
    createdAt: string;
    updatedAt: string;
  }>>([]);
  const [showTelegramBotModal, setShowTelegramBotModal] = useState(false);
  const [editingBot, setEditingBot] = useState<string | null>(null);
  const [newBotData, setNewBotData] = useState({
    botToken: '',
    botName: '',
    botType: 'both' as 'products' | 'services' | 'both'
  });
  
  // Facebook Pages Selection State
  const [showFbPageSelector, setShowFbPageSelector] = useState(false);
  const [fbAvailablePages, setFbAvailablePages] = useState<FacebookPageInfo[]>([]);
  const [fbSelectedPageIds, setFbSelectedPageIds] = useState<Set<string>>(new Set());
  const [fbPlanLimits, setFbPlanLimits] = useState<{ maxFacebookPages: number; currentLinkedCount: number; remainingSlots: number } | null>(null);
  const [isLoadingFbPages, setIsLoadingFbPages] = useState(false);
  const [isLinkingFbPages, setIsLinkingFbPages] = useState(false);
  const [fbConnectedPages, setFbConnectedPages] = useState<Array<{ pageId: string; pageName: string }>>([]);

  const [isLoadingFb, setIsLoadingFb] = useState(false);
  const [isLoadingShopify, setIsLoadingShopify] = useState(false);
  const [isLoadingStorify, setIsLoadingStorify] = useState(false);
  const [isLoadingTelegram, setIsLoadingTelegram] = useState(false);
  const [isLoadingWhatsApp, setIsLoadingWhatsApp] = useState(false);
  
  // WhatsApp form state
  const [whatsappFormData, setWhatsappFormData] = useState({
    phoneNumberId: '',
    phoneNumber: '',
    businessAccountId: '',
    accessToken: '',
    appId: '',
    appSecret: '',
    webhookVerifyToken: ''
  });
  const [showWhatsAppModal, setShowWhatsAppModal] = useState(false);
  const [whatsappAutoReply, setWhatsappAutoReply] = useState(false);
  const [whatsappQrDataUrl, setWhatsappQrDataUrl] = useState<string | null>(null);
  const [whatsappPairingError, setWhatsappPairingError] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isSyncingOrders, setIsSyncingOrders] = useState(false);
  
  // Sync progress state
  const [syncProgress, setSyncProgress] = useState<{
    isVisible: boolean;
    status: 'running' | 'completed' | 'failed';
    message: string;
    totalItems: number;
    processedItems: number;
    createdItems: number;
    updatedItems: number;
    failedItems: number;
  } | null>(null);
  
  // Shopify settings state
  const [shopifySettings, setShopifySettings] = useState({
    autoSync: false,
    syncInterval: 24,
    syncProducts: true,
    syncOrders: true
  });
  const [showShopifySettings, setShowShopifySettings] = useState(false);
  
  const [logs, setLogs] = useState<IntegrationLog[]>([]);

  // Disconnect Modal State
  // Instagram state
  const [igStatus, setIgStatus] = useState<IntegrationStatus>({ isConnected: false });
  const [isLoadingIg, setIsLoadingIg] = useState(false);

  const [showDisconnectModal, setShowDisconnectModal] = useState(false);
  const [disconnectTarget, setDisconnectTarget] = useState<'facebook' | 'shopify' | 'storify' | 'telegram' | 'whatsapp' | 'instagram' | null>(null);
  const [disconnectBotId, setDisconnectBotId] = useState<string | null>(null);

  const addLog = (log: IntegrationLog) => {
    setLogs(prev => [log, ...prev]);
  };

  const formatDate = (date?: Date | string) => {
    if (!date) return 'غير متوفر';
    const dateObj = typeof date === 'string' ? new Date(date) : date;
    return dateObj.toLocaleString('ar-EG-u-nu-latn', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  useEffect(() => {
    loadTelegramBots();
    loadSocialCommentTemplates();
  }, []);

  useEffect(() => {
    if (!whatsappStatus.isConnected) return;
    void apiService.getWhatsAppStatus().then((status) => {
      if (typeof status.autoReplyEnabled === 'boolean') {
        setWhatsappAutoReply(status.autoReplyEnabled);
      }
    }).catch(() => undefined);
  }, [whatsappStatus.isConnected]);

  useEffect(() => {
    if (!showWhatsAppModal || whatsappStatus.isConnected || whatsappQrDataUrl || whatsappPairingError) {
      return;
    }
    const timer = setTimeout(() => {
      setWhatsappPairingError((prev) => prev || 'تأخر ظهور الرمز. اضغط «تحديث الرمز» للمحاولة من جديد.');
      setIsLoadingWhatsApp(false);
    }, 25000);
    return () => clearTimeout(timer);
  }, [showWhatsAppModal, whatsappStatus.isConnected, whatsappQrDataUrl, whatsappPairingError]);

  useWhatsAppPairing({
    enabled: showWhatsAppModal && !whatsappStatus.isConnected,
    onEvent: (event) => {
      if (event.type === 'qr') {
        setWhatsappQrDataUrl(event.qrDataUrl);
        setWhatsappPairingError(null);
        setIsLoadingWhatsApp(false);
        return;
      }
      if (event.type === 'status' && event.status === 'connected') {
        setWhatsappStatus({
          isConnected: true,
          accountName: event.phoneNumber || whatsappStatus.accountName || '',
          lastSync: new Date()
        });
        setShowWhatsAppModal(false);
        setWhatsappQrDataUrl(null);
        addLog(generateLog('WhatsApp', 'تم ربط واتساب بنجاح', 'success'));
        showNotification?.('تم ربط واتساب بنجاح', 'success');
        return;
      }
      if (event.type === 'error') {
        setWhatsappPairingError(event.message);
        setIsLoadingWhatsApp(false);
      }
    }
  });

  useEffect(() => {
    if (fbLinkingSessionId) {
      loadFbAvailablePages(fbLinkingSessionId);
    }
  }, [fbLinkingSessionId]);

  const loadFbAvailablePages = async (sessionId: string) => {
    setIsLoadingFbPages(true);
    try {
      const data = await apiService.getAvailableFacebookPages(sessionId);
      setFbAvailablePages(data.pages);
      setFbPlanLimits(data.limits);

      const preSelected = new Set<string>();
      for (const p of data.pages) {
        if (p.alreadyLinked) {
          preSelected.add(p.id);
        }
      }
      setFbSelectedPageIds(preSelected);
      setShowFbPageSelector(true);
    } catch (error: any) {
      logger.error('Failed to load available Facebook pages:', error);
      if (showNotification) {
        showNotification(error?.message || 'فشل تحميل الصفحات المتاحة', 'error', 6000);
      }
      setFbLinkingSessionId('');
    } finally {
      setIsLoadingFbPages(false);
    }
  };

  const handleToggleFbPage = (pageId: string, alreadyLinked: boolean) => {
    if (alreadyLinked) return;
    setFbSelectedPageIds(prev => {
      const next = new Set(prev);
      if (next.has(pageId)) {
        next.delete(pageId);
      } else {
        if (fbPlanLimits && fbPlanLimits.maxFacebookPages !== -1) {
          const newSelectCount = [...next].filter(
            id => !fbAvailablePages.find(p => p.id === id)?.alreadyLinked
          ).length + 1;
          if (newSelectCount > fbPlanLimits.remainingSlots) {
            if (showNotification) {
              showNotification(
                `لا يمكنك إضافة أكثر من ${fbPlanLimits.remainingSlots} صفحة إضافية في باقتك الحالية.`,
                'warning',
                5000
              );
            }
            return prev;
          }
        }
        next.add(pageId);
      }
      return next;
    });
  };

  const handleLinkFbPages = async () => {
    if (!fbLinkingSessionId) return;
    const newPageIds = [...fbSelectedPageIds].filter(
      id => !fbAvailablePages.find(p => p.id === id)?.alreadyLinked
    );
    if (newPageIds.length === 0) {
      if (showNotification) showNotification('لم يتم اختيار أي صفحة جديدة للربط', 'info');
      setShowFbPageSelector(false);
      setFbLinkingSessionId('');
      return;
    }
    setIsLinkingFbPages(true);
    try {
      const result = await apiService.linkFacebookPages(fbLinkingSessionId, newPageIds);
      if (showNotification) {
        showNotification(result.message || `تم ربط ${result.newlyLinked} صفحة بنجاح`, 'success');
      }
      addLog(generateLog('Facebook', `تم ربط ${result.newlyLinked} صفحة جديدة`, 'success'));
      const integrations = await apiService.getIntegrations();
      if (integrations.facebook?.isConnected) {
        setFbStatus({
          isConnected: true,
          accountName: integrations.facebook.accountName || 'Facebook Page',
          platformId: integrations.facebook.platformId || '',
          lastSync: integrations.facebook.lastSync ? new Date(integrations.facebook.lastSync) : undefined,
        });
        setFbConnectedPages(integrations.facebook.pages || []);
      }
      setShowFbPageSelector(false);
      setFbLinkingSessionId('');
    } catch (error: any) {
      logger.error('Failed to link Facebook pages:', error);
      if (showNotification) {
        showNotification(error?.message || 'فشل ربط الصفحات', 'error', 8000);
      }
    } finally {
      setIsLinkingFbPages(false);
    }
  };

  const handleDisconnectFbPage = async (pageId: string) => {
    try {
      await apiService.disconnectFacebookPage(pageId);
      if (showNotification) showNotification('تم إلغاء ربط الصفحة', 'success');
      const integrations = await apiService.getIntegrations();
      if (integrations.facebook?.isConnected) {
        setFbStatus({
          isConnected: true,
          accountName: integrations.facebook.accountName || 'Facebook Page',
          platformId: integrations.facebook.platformId || '',
        });
        setFbConnectedPages(integrations.facebook.pages || []);
      } else {
        setFbStatus({ isConnected: false });
        setFbConnectedPages([]);
      }
    } catch (error: any) {
      if (showNotification) showNotification(error?.message || 'فشل إلغاء ربط الصفحة', 'error');
    }
  };

  const loadTelegramBots = async () => {
    try {
      console.log('[IntegrationsPanel] Loading Telegram bots...');
      const response = await apiService.getTelegramBots();
      console.log('[IntegrationsPanel] Telegram bots loaded:', response);
      
      const bots = response.bots || [];
      setTelegramBots(bots);
      
      // Update telegramStatus based on bots
      const activeBots = bots.filter(b => b.isActive);
      if (activeBots.length > 0) {
        setTelegramStatus({
          isConnected: true,
          accountName: activeBots.length === 1 
            ? activeBots[0].botUsername || activeBots[0].botName || 'بوت تيليجرام'
            : `${activeBots.length} بوت متصل`
        });
      } else {
        setTelegramStatus({ isConnected: false });
      }
    } catch (error: any) {
      console.error('[IntegrationsPanel] Failed to load Telegram bots:', error);
      logger.error('Failed to load Telegram bots:', error);
      
      // Always set empty array on error to show "Add Bot" button
      setTelegramBots([]);
      
      // If error, check legacy connection
      if (settings.telegramBotToken) {
        setTelegramStatus({ isConnected: true });
      } else {
        setTelegramStatus({ isConnected: false });
      }
    }
  };

  const loadSocialCommentTemplates = async () => {
    try {
      const integrations = await apiService.getIntegrations();
      if (integrations.instagram?.isConnected) {
        setIgStatus({
          isConnected: true,
          accountName: integrations.instagram.accountName || 'Instagram',
          platformId: integrations.instagram.platformId
        });
      }
      if (integrations.facebook?.isConnected) {
        setFbConnectedPages(integrations.facebook.pages || []);
      }
    } catch {
      // Silently fail if integrations API unavailable
    }
  };

  const handleConnectInstagram = async () => {
    setIsLoadingIg(true);
    try {
      const response = await apiService.connectInstagram();
      if (response.authUrl) {
        addLog(generateLog('Facebook', 'جاري التوجيه إلى Instagram...', 'info'));
        window.location.href = response.authUrl;
        return;
      } else if ((response as any).requiresSetup) {
        const errorMsg = 'Instagram OAuth يتطلب FACEBOOK_APP_ID و FACEBOOK_APP_SECRET في ملف .env';
        if (showNotification) showNotification(errorMsg, 'error', 5000);
        addLog(generateLog('Facebook', 'OAuth غير مضبوط (Instagram)', 'error'));
      }
    } catch (error: any) {
      logger.error('Failed to connect Instagram:', error);
      addLog(generateLog('Facebook', `فشل ربط Instagram: ${error.message}`, 'error'));
    } finally {
      setIsLoadingIg(false);
    }
  };

  const handleConnectFacebook = async () => {
    setIsLoadingFb(true);
    try {
      // TODO: Facebook OAuth flow - redirect to Facebook login
      // For now, show message that OAuth needs to be implemented
      const response = await apiService.connectFacebook();
      
      // Check if OAuth URL is returned (response is already data.data from API)
      if (response.authUrl) {
        // Redirect to Facebook OAuth
        addLog(generateLog('Facebook', 'جاري التوجيه إلى Facebook...', 'info'));
        window.location.href = response.authUrl;
        return;
      } else if ((response as any).requiresSetup) {
        const errorMsg = 'Facebook OAuth غير مضبوط. يرجى إضافة FACEBOOK_APP_ID و FACEBOOK_APP_SECRET في ملف .env';
        if (showNotification) {
          showNotification(errorMsg, 'error', 5000);
        } else {
          alert(errorMsg);
        }
        addLog(generateLog('Facebook', 'OAuth غير مضبوط', 'error'));
      } else {
        // Reload integrations to check status
        const integrations = await apiService.getIntegrations();
        if (integrations.facebook?.isConnected) {
          setFbStatus({
            isConnected: true,
            accountName: integrations.facebook.accountName || 'Facebook Page',
            platformId: integrations.facebook.platformId || '',
            lastSync: integrations.facebook.lastSync ? new Date(integrations.facebook.lastSync) : undefined
          });
          addLog(generateLog('Facebook', 'ربط الصفحة (OAuth)', 'success'));
        }
      }
    } catch (error: any) {
      logger.error('Failed to connect Facebook:', error);
      const msg = error?.message || 'فشل بدء ربط فيسبوك';
      addLog(generateLog('Facebook', `فشل الربط: ${msg}`, 'error'));
      if (error?.code === 'FACEBOOK_PAGES_LIMIT') {
        if (showNotification) {
          showNotification(msg, 'warning', 12000);
        } else {
          alert(msg);
        }
      } else if (showNotification) {
        showNotification(msg, 'error', 8000);
      } else {
        alert(msg);
      }
    } finally {
      setIsLoadingFb(false);
    }
  };

  const initiateDisconnect = (
    target: 'facebook' | 'shopify' | 'storify' | 'telegram' | 'whatsapp' | 'instagram',
    botId?: string
  ) => {
    setDisconnectTarget(target);
    setDisconnectBotId(botId || null);
    setShowDisconnectModal(true);
  };

  const confirmDisconnect = async () => {
    if (disconnectTarget === 'facebook') {
      try {
        await apiService.disconnectFacebook();
        setFbStatus({ isConnected: false });
        addLog(generateLog('Facebook', 'إلغاء الربط', 'info'));
      } catch (error: any) {
        logger.error('Failed to disconnect Facebook:', error);
        addLog(generateLog('Facebook', `فشل إلغاء الربط: ${error.message}`, 'error'));
      }
    } else if (disconnectTarget === 'shopify') {
      try {
        await apiService.disconnectShopify();
        setShopifyStatus({ isConnected: false });
        addLog(generateLog('Shopify', 'إلغاء الربط', 'info'));
      } catch (error: any) {
        logger.error('Failed to disconnect Shopify:', error);
        addLog(generateLog('Shopify', `فشل إلغاء الربط: ${error.message}`, 'error'));
      }
    } else if (disconnectTarget === 'storify') {
      try {
        await apiService.disconnectStorify();
        setStorifyStatus({ isConnected: false });
        setStorifyForm({
          storeDomain: '',
          apiBaseUrl: '',
          accessToken: '',
          productsEndpoint: '/api/storefront/products'
        });
        addLog(generateLog('Storify', 'إلغاء الربط', 'info'));
        if (showNotification) showNotification('تم إلغاء ربط متجر Storify', 'success');
      } catch (error: any) {
        logger.error('Failed to disconnect Storify:', error);
        addLog(generateLog('Storify', `فشل إلغاء الربط: ${error.message}`, 'error'));
        if (showNotification) showNotification(error?.message || 'فشل إلغاء ربط Storify', 'error');
      }
    } else if (disconnectTarget === 'telegram') {
      if (disconnectBotId) {
        await handleDeleteTelegramBot(disconnectBotId);
        addLog(generateLog('Telegram', 'تم إلغاء الربط', 'info'));
      } else {
        // Legacy disconnect
        try {
          await apiService.disconnectTelegram();
          setTelegramStatus({ isConnected: false });
          onUpdateSettings({ ...settings, telegramBotToken: '' });
          setTelegramToken('');
          addLog(generateLog('Telegram', 'تم إلغاء الربط', 'info'));
        } catch (error: any) {
          logger.error('Failed to disconnect Telegram:', error);
          addLog(generateLog('Telegram', `فشل إلغاء الربط: ${error.message}`, 'error'));
        }
      }
    } else if (disconnectTarget === 'whatsapp') {
      try {
        await apiService.disconnectWhatsApp();
        setWhatsappStatus({ isConnected: false });
        addLog(generateLog('WhatsApp', 'تم إلغاء الربط', 'info'));
      } catch (error: any) {
        logger.error('Failed to disconnect WhatsApp:', error);
        addLog(generateLog('WhatsApp', `فشل إلغاء الربط: ${error.message}`, 'error'));
      }
    } else if (disconnectTarget === 'instagram') {
      try {
        await apiService.disconnectInstagram();
        setIgStatus({ isConnected: false });
        addLog(generateLog('Instagram', 'تم إلغاء الربط', 'info'));
        if (showNotification) showNotification('تم إلغاء ربط حساب إنستغرام', 'success');
      } catch (error: any) {
        logger.error('Failed to disconnect Instagram:', error);
        addLog(generateLog('Instagram', `فشل إلغاء الربط: ${error.message}`, 'error'));
        if (showNotification) showNotification(error?.message || 'فشل إلغاء ربط إنستغرام', 'error');
      }
    }
    setShowDisconnectModal(false);
    setDisconnectTarget(null);
  };

  const handleConnectShopify = async () => {
    if (!shopifyUrl.trim()) {
      addLog(generateLog('Shopify', 'يرجى إدخال رابط المتجر', 'error'));
      return;
    }

    setIsLoadingShopify(true);
    try {
      // Extract shop domain from URL (e.g., "mystore.myshopify.com" or "mystore")
      let shopDomain = shopifyUrl.trim();
      shopDomain = shopDomain.replace(/^https?:\/\//, ''); // Remove http:// or https://
      shopDomain = shopDomain.replace(/\/.*$/, ''); // Remove path
      shopDomain = shopDomain.replace(/\.myshopify\.com$/, ''); // Remove .myshopify.com if present
      shopDomain = shopDomain.replace(/\.com$/, ''); // Remove .com if user entered it by mistake
      shopDomain = shopDomain.replace(/\.$/, ''); // Remove trailing dot

      const response = await apiService.connectShopify(shopDomain);
      
      console.log('[Shopify Connect] Response:', response);
      
      // Check if OAuth URL is returned (response is already data.data from API)
      if (response.authUrl) {
        // Redirect to Shopify OAuth
        addLog(generateLog('Shopify', 'جاري التوجيه إلى Shopify...', 'info'));
        window.location.href = response.authUrl;
        return;
      } else if ((response as any).requiresSetup) {
        const errorMsg = 'Shopify OAuth غير مضبوط. يرجى إضافة SHOPIFY_API_KEY و SHOPIFY_API_SECRET في ملف .env';
        if (showNotification) {
          showNotification(errorMsg, 'error', 5000);
        } else {
          alert(errorMsg);
        }
        addLog(generateLog('Shopify', 'OAuth غير مضبوط', 'error'));
      } else {
        // Reload integrations to check status
        const integrations = await apiService.getIntegrations();
        if (integrations.shopify?.isConnected) {
          setShopifyStatus({
            isConnected: true,
            accountName: integrations.shopify.accountName || shopDomain,
            lastSync: integrations.shopify.lastSync ? new Date(integrations.shopify.lastSync) : undefined
          });
          addLog(generateLog('Shopify', 'ربط المتجر (OAuth)', 'success'));
        }
      }
    } catch (error: any) {
      logger.error('Failed to connect Shopify:', error);
      addLog(generateLog('Shopify', `فشل الربط: ${error.message}`, 'error'));
    } finally {
      setIsLoadingShopify(false);
    }
  };

  const handleConnectStorify = async () => {
    if (!storifyForm.storeDomain.trim() || !storifyForm.accessToken.trim()) {
      const errorMsg = 'أدخل رابط متجر Storify وAccess Token أولاً.';
      addLog(generateLog('Storify', errorMsg, 'error'));
      if (showNotification) showNotification(errorMsg, 'error');
      return;
    }

    setIsLoadingStorify(true);
    try {
      const response = await apiService.connectStorify({
        storeDomain: storifyForm.storeDomain.trim(),
        apiBaseUrl: storifyForm.apiBaseUrl.trim() || undefined,
        accessToken: storifyForm.accessToken.trim(),
        productsEndpoint: storifyForm.productsEndpoint.trim() || undefined
      });

      setStorifyStatus({
        isConnected: true,
        accountName: response.accountName || storifyForm.storeDomain.trim(),
        lastSync: storifyStatus.lastSync
      });
      addLog(generateLog('Storify', 'تم ربط المتجر بنجاح', 'success'));
      if (showNotification) {
        showNotification('تم ربط متجر Storify بنجاح', 'success');
      }
    } catch (error: any) {
      logger.error('Failed to connect Storify:', error);
      addLog(generateLog('Storify', `فشل الربط: ${error.message}`, 'error'));
      if (showNotification) {
        showNotification(error?.message || 'فشل ربط Storify', 'error', 8000);
      }
    } finally {
      setIsLoadingStorify(false);
    }
  };

  const handleCreateTelegramBot = async () => {
    if (!newBotData.botToken) {
      const errorMsg = "يرجى إدخال رمز البوت (Bot Token).";
      if (showNotification) {
        showNotification(errorMsg, 'error');
      } else {
        alert(errorMsg);
      }
      return;
    }
    setIsLoadingTelegram(true);
    try {
      const response = await apiService.createTelegramBot({
        botToken: newBotData.botToken,
        botName: newBotData.botName || undefined,
        botType: newBotData.botType
      });
      
      if (response.bot) {
        await loadTelegramBots();
        setShowTelegramBotModal(false);
        setNewBotData({ botToken: '', botName: '', botType: 'both' });
        addLog(generateLog('Telegram', `تم ربط البوت ${response.bot.botName || response.bot.botUsername || 'جديد'} بنجاح`, 'success'));
        if (showNotification) {
          showNotification(`تم ربط البوت بنجاح`, 'success');
        }
      }
    } catch (e: any) {
      let errorMsg = 'فشل ربط البوت. تأكد من صحة Bot Token.';
      if (e.message) {
        errorMsg = e.message;
      } else if (e.response?.data?.message) {
        errorMsg = e.response.data.message;
      } else if (typeof e === 'string') {
        errorMsg = e;
      }
      
      addLog(generateLog('Telegram', `فشل ربط البوت: ${errorMsg}`, 'error'));
      
      if (showNotification) {
        showNotification(errorMsg, 'error', 6000);
      } else {
        alert(errorMsg);
      }
    } finally {
      setIsLoadingTelegram(false);
    }
  };

  const handleUpdateTelegramBot = async (botId: string, updates: { botName?: string; botType?: 'products' | 'services' | 'both'; isActive?: boolean }) => {
    try {
      await apiService.updateTelegramBot(botId, updates);
      await loadTelegramBots();
      setEditingBot(null);
      if (showNotification) {
        showNotification('تم تحديث البوت بنجاح', 'success');
      }
    } catch (error: any) {
      logger.error('Failed to update Telegram bot:', error);
      if (showNotification) {
        showNotification(`فشل تحديث البوت: ${error.message}`, 'error');
      }
    }
  };

  const handleDeleteTelegramBot = async (botId: string) => {
    try {
      await apiService.deleteTelegramBot(botId);
      await loadTelegramBots();
      setShowDisconnectModal(false);
      setDisconnectBotId(null);
      if (showNotification) {
        showNotification('تم حذف البوت بنجاح', 'success');
      }
    } catch (error: any) {
      logger.error('Failed to delete Telegram bot:', error);
      if (showNotification) {
        showNotification(`فشل حذف البوت: ${error.message}`, 'error');
      }
    }
  };

  const handleSyncShopify = async () => {
    if (!shopifyStatus.isConnected) return;
    setIsSyncing(true);
    
    // Show initial progress
    setSyncProgress({
      isVisible: true,
      status: 'running',
      message: 'جاري استيراد المنتجات من Shopify...',
      totalItems: 0,
      processedItems: 0,
      createdItems: 0,
      updatedItems: 0,
      failedItems: 0
    });
    
    try {
      const response = await apiService.syncShopifyProducts();
      
      // Update progress with results
      setSyncProgress({
        isVisible: true,
        status: 'completed',
        message: response.message || `تم استيراد ${response.imported || 0} منتج بنجاح`,
        totalItems: response.imported || 0,
        processedItems: response.imported || 0,
        createdItems: response.created || 0,
        updatedItems: response.updated || 0,
        failedItems: response.failed || 0
      });
      
      if (response.products && response.products.length > 0) {
        // Transform Shopify products to our Product format
        const transformedProducts = response.products.map((p: any) => ({
          id: p.id || `shopify_${p.externalId}`,
          externalId: p.externalId || p.id,
          name: p.name,
          description: p.description || '',
          price: parseFloat(p.price) || 0,
          currency: p.currency || 'USD',
          category: p.category || '',
          stock: p.stock || p.totalInventory || 0,
          sizes: p.sizes || [],
          imageUrl: p.imageUrl || p.image_url || '',
          source: 'shopify',
          vendor: p.vendor || '',
          productType: p.productType || '',
          tags: p.tags || [],
          hasVariants: p.hasVariants || false
        }));
        onSyncProducts(transformedProducts);
        setShopifyStatus({ ...shopifyStatus, lastSync: new Date() });
        addLog(generateLog('Shopify', `تم استيراد ${transformedProducts.length} منتج (${response.created} جديد، ${response.updated} محدث)`, 'success'));
      } else {
        addLog(generateLog('Shopify', 'لا توجد منتجات للمزامنة', 'info'));
      }
    } catch (error: any) {
      logger.error('Failed to sync Shopify products:', error);
      setSyncProgress({
        isVisible: true,
        status: 'failed',
        message: `فشل المزامنة: ${error.message}`,
        totalItems: 0,
        processedItems: 0,
        createdItems: 0,
        updatedItems: 0,
        failedItems: 0
      });
      addLog(generateLog('Shopify', `فشل المزامنة: ${error.message}`, 'error'));
    } finally {
      setIsSyncing(false);
    }
  };

  const handleSyncStorify = async () => {
    if (!storifyStatus.isConnected) return;
    setIsSyncing(true);
    setSyncProgress({
      isVisible: true,
      status: 'running',
      message: 'جاري استيراد المنتجات من Storify...',
      totalItems: 0,
      processedItems: 0,
      createdItems: 0,
      updatedItems: 0,
      failedItems: 0
    });

    try {
      const response = await apiService.syncStorifyProducts();
      setSyncProgress({
        isVisible: true,
        status: 'completed',
        message: response.message || `تم استيراد ${response.imported || 0} منتج بنجاح`,
        totalItems: response.imported || 0,
        processedItems: response.imported || 0,
        createdItems: response.created || 0,
        updatedItems: response.updated || 0,
        failedItems: response.failed || 0
      });

      if (response.products && response.products.length > 0) {
        const transformedProducts = response.products.map((p: any) => ({
          id: p.id || `storify_${p.externalId}`,
          externalId: p.externalId || p.id,
          name: p.name,
          description: p.description || '',
          price: parseFloat(p.price) || 0,
          currency: p.currency || 'USD',
          category: p.category || '',
          stock: p.stock || 0,
          imageUrl: p.imageUrl || '',
          source: 'storify',
        }));
        onSyncProducts(transformedProducts);
        setStorifyStatus({ ...storifyStatus, lastSync: new Date() });
        addLog(generateLog('Storify', `تم استيراد ${transformedProducts.length} منتج (${response.created} جديد، ${response.updated} محدث)`, 'success'));
      } else {
        addLog(generateLog('Storify', 'لا توجد منتجات للمزامنة', 'info'));
      }
    } catch (error: any) {
      logger.error('Failed to sync Storify products:', error);
      setSyncProgress({
        isVisible: true,
        status: 'failed',
        message: `فشل المزامنة: ${error.message}`,
        totalItems: 0,
        processedItems: 0,
        createdItems: 0,
        updatedItems: 0,
        failedItems: 0
      });
      addLog(generateLog('Storify', `فشل المزامنة: ${error.message}`, 'error'));
      if (showNotification) {
        showNotification(error?.message || 'فشل مزامنة منتجات Storify', 'error', 8000);
      }
    } finally {
      setIsSyncing(false);
    }
  };
  
  // Handle updating Shopify settings
  const handleUpdateShopifySettings = async () => {
    try {
      await apiService.updateShopifySettings(shopifySettings);
      addLog(generateLog('Shopify', 'تم تحديث إعدادات المزامنة بنجاح', 'success'));
      setShowShopifySettings(false);
    } catch (error: any) {
      logger.error('Failed to update Shopify settings:', error);
      addLog(generateLog('Shopify', `فشل تحديث الإعدادات: ${error.message}`, 'error'));
    }
  };
  
  // Load Shopify health/settings on mount
  useEffect(() => {
    const loadShopifyHealth = async () => {
      if (shopifyStatus.isConnected) {
        try {
          const health = await apiService.getShopifyHealth();
          if (health.shopify) {
            setShopifySettings({
              autoSync: health.shopify.autoSync || false,
              syncInterval: health.shopify.syncInterval || 24,
              syncProducts: true,
              syncOrders: true
            });
          }
        } catch (error) {
          logger.error('Failed to load Shopify health:', error);
        }
      }
    };
    loadShopifyHealth();
  }, [shopifyStatus.isConnected]);

  useEffect(() => {
    const loadStorifyHealth = async () => {
      if (!storifyStatus.isConnected) return;
      try {
        const health = await apiService.getStorifyHealth();
        if (health.storify?.connected) {
          setStorifyForm((prev) => ({
            ...prev,
            storeDomain: health.storify.storeDomain || prev.storeDomain,
            apiBaseUrl: health.storify.apiBaseUrl || prev.apiBaseUrl,
            productsEndpoint: health.storify.productsEndpoint || prev.productsEndpoint,
            accessToken: prev.accessToken
          }));
        }
      } catch (error) {
        logger.error('Failed to load Storify health:', error);
      }
    };
    loadStorifyHealth();
  }, [storifyStatus.isConnected]);

  const handleSyncOrders = async () => {
    if (!shopifyStatus.isConnected) return;
    setIsSyncingOrders(true);
    try {
      const response = await apiService.syncShopifyOrders();
      if (response.orders && response.orders.length > 0) {
        addLog(generateLog('Shopify', `تم مزامنة ${response.orders.length} طلب`, 'success'));
        // Note: Orders will be loaded automatically via loadOrders in App.tsx
      } else {
        addLog(generateLog('Shopify', 'لا توجد طلبات للمزامنة', 'info'));
      }
    } catch (error: any) {
      logger.error('Failed to sync Shopify orders:', error);
      addLog(generateLog('Shopify', `فشل مزامنة الطلبات: ${error.message}`, 'error'));
    } finally {
      setIsSyncingOrders(false);
    }
  };

  const caps = settings.planCapabilities ?? DEFAULT_PLAN_CAPABILITIES;
  const connectedChannelCount =
    (fbStatus.isConnected ? 1 : 0) +
    (igStatus.isConnected ? 1 : 0) +
    (telegramBots.length > 0 ? 1 : 0) +
    (whatsappStatus.isConnected ? 1 : 0);
  const singleChannelPlan = caps.maxTotalChannels === 1;
  const showTelegramCard = caps.maxTelegramBots > 0 || telegramBots.length > 0;
  const showShopifyCard = caps.maxShopifyStores > 0 || shopifyStatus.isConnected;
  const showStorifyCard = caps.maxStorifyStores > 0 || storifyStatus.isConnected;
  const showWhatsAppCard = caps.maxWhatsAppAccounts > 0 || whatsappStatus.isConnected;

  return (
    <div className="space-y-8 animate-fade-in pb-10 relative">
      <div>
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white">الربط والتكامل</h2>
        <p className="text-gray-500 dark:text-gray-400 mt-1">قم بربط متجرك وحسابات التواصل الاجتماعي في مكان واحد.</p>
      </div>

      {!caps.hasSalesBot && (
        <div className="rounded-xl border border-amber-200 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-900/20 px-4 py-3 text-sm text-amber-900 dark:text-amber-100">
          باقتك مخصّصة للرد على التعليقات. يمكنك ربط فيسبوك وإنستغرام للتعليقات فقط — بوت المبيعات (Messenger / DM / Telegram) غير متاح.
        </div>
      )}

      {singleChannelPlan && caps.hasSalesBot && (
        <div className="rounded-xl border border-indigo-200 dark:border-indigo-900/50 bg-indigo-50 dark:bg-indigo-900/20 px-4 py-3 text-sm text-indigo-900 dark:text-indigo-100">
          باقتك تسمح بربط <strong>قناة مبيعات واحدة</strong> فقط (فيسبوك أو إنستغرام أو تيليجرام أو واتساب).
          {connectedChannelCount >= 1
            ? ' لربط قناة أخرى، افصل القناة الحالية أولاً أو رقِّ الباقة.'
            : ' اختر القناة التي تناسبك.'}
        </div>
      )}

      {caps.hasSalesBot && caps.maxTelegramBots === 0 && (
        <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40 px-4 py-3 text-sm text-slate-700 dark:text-slate-300">
          تيليجرام غير متاح في باقتك الحالية — متاح في <strong>الباقة السنوية</strong>.
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        
        {/* Facebook Card */}
        <div className={`bg-white dark:bg-gray-800 rounded-2xl shadow-sm border transition-all duration-300 overflow-hidden ${fbStatus.isConnected ? 'border-blue-200 dark:border-blue-900 ring-1 ring-blue-100 dark:ring-blue-900/50' : 'border-gray-100 dark:border-gray-700'}`}>
          <div className="p-6 border-b border-gray-100 dark:border-gray-700 bg-gradient-to-l from-white to-blue-50/50 dark:from-gray-800 dark:to-blue-900/20 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className={`p-2 rounded-xl transition-colors ${fbStatus.isConnected ? 'bg-blue-600 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400'}`}>
                <Facebook size={24} />
              </div>
              <div>
                <h3 className="font-bold text-gray-800 dark:text-white text-lg">Facebook</h3>
                <p className="text-xs text-blue-600 dark:text-blue-400 font-medium">Messenger & Comments</p>
              </div>
            </div>
            {fbStatus.isConnected ? (
              <span className="flex items-center gap-1.5 text-green-700 dark:text-green-400 text-xs font-bold bg-green-50 dark:bg-green-900/30 border border-green-100 dark:border-green-800 px-3 py-1.5 rounded-full shadow-sm">
                <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
                متصل
              </span>
            ) : (
              <span className="flex items-center gap-1.5 text-gray-500 dark:text-gray-400 text-xs font-medium bg-gray-100 dark:bg-gray-700 px-3 py-1.5 rounded-full">
                <span className="w-2 h-2 rounded-full bg-gray-400"></span>
                غير متصل
              </span>
            )}
          </div>
          
          <div className="p-6">
            {!fbStatus.isConnected ? (
              <div className="text-center py-6">
                <p className="text-gray-600 dark:text-gray-400 mb-6 text-sm max-w-xs mx-auto">اربط صفحتك لتمكين الرد الآلي الذكي على رسائل الماسنجر والتعليقات فوراً.</p>
                <button 
                  onClick={handleConnectFacebook}
                  disabled={isLoadingFb}
                  className="bg-[#1877F2] text-white px-6 py-2.5 rounded-xl hover:bg-blue-700 transition-all shadow-md shadow-blue-100 dark:shadow-none flex items-center gap-2 mx-auto disabled:opacity-70 disabled:cursor-not-allowed"
                >
                  {isLoadingFb ? (
                    <>
                      <RefreshCw size={18} className="animate-spin" />
                      جاري الاتصال...
                    </>
                  ) : (
                    <>
                      <Facebook size={18} />
                      ربط حساب فيسبوك
                    </>
                  )}
                </button>
              </div>
            ) : (
              <div className="space-y-6">
                <div className="p-4 bg-blue-50/50 dark:bg-blue-900/10 border border-blue-100 dark:border-blue-800 rounded-xl flex flex-col gap-3">
                   <div className="flex justify-between items-center mb-1">
                      <span className="text-sm font-semibold text-gray-600 dark:text-gray-300">الصفحات المربوطة ({fbConnectedPages.length || 1}):</span>
                      <button
                        onClick={handleConnectFacebook}
                        disabled={isLoadingFb}
                        className="text-xs text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 font-medium flex items-center gap-1"
                      >
                        <Plus size={14} />
                        إضافة صفحة
                      </button>
                   </div>
                   {fbConnectedPages.length > 0 ? (
                     <div className="space-y-2">
                       {fbConnectedPages.map((pg) => (
                         <div key={pg.pageId} className="flex items-center justify-between py-1.5 px-2 bg-white dark:bg-gray-800 rounded-lg border border-blue-100 dark:border-blue-900/40">
                           <div className="flex items-center gap-2">
                             <Facebook size={14} className="text-blue-500" />
                             <span className="text-sm font-bold text-gray-800 dark:text-gray-200">{pg.pageName}</span>
                           </div>
                           <button
                             onClick={() => handleDisconnectFbPage(pg.pageId)}
                             className="text-red-400 hover:text-red-600 p-1 rounded-md hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                             title="إلغاء ربط هذه الصفحة"
                           >
                             <XCircle size={14} />
                           </button>
                         </div>
                       ))}
                     </div>
                   ) : (
                     <span className="text-blue-700 dark:text-blue-400 font-bold">{fbStatus.accountName}</span>
                   )}
                   <div className="h-px bg-blue-100 dark:bg-blue-800 w-full"></div>
                   <div className="flex justify-between items-center text-xs">
                      <span className="text-gray-500 dark:text-gray-400 flex items-center gap-1">
                        <Clock size={12} />
                        آخر تزامن:
                      </span>
                      <span className="text-gray-700 dark:text-gray-300 font-medium" dir="ltr">{formatDate(fbStatus.lastSync)}</span>
                   </div>
                </div>

                <p className="text-xs text-gray-500 dark:text-gray-400 bg-indigo-50/60 dark:bg-indigo-950/30 border border-indigo-100 dark:border-indigo-900/40 rounded-xl p-3">
                  إعدادات الرد على التعليقات والرسائل الخاصة أصبحت في تبويب{' '}
                  <span className="font-semibold text-indigo-700 dark:text-indigo-300">أتمتة المنشورات والتعليقات</span>.
                </p>

                <div className="pt-2 border-t border-gray-100 dark:border-gray-700">
                   <button onClick={() => initiateDisconnect('facebook')} className="flex items-center gap-2 text-red-500 hover:text-red-700 text-sm font-medium w-full justify-center p-2 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors">
                      <Trash2 size={16} />
                      إلغاء الربط
                   </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Instagram Card */}
        <div className={`bg-white dark:bg-gray-800 rounded-2xl shadow-sm border transition-all duration-300 overflow-hidden ${igStatus.isConnected ? 'border-pink-200 dark:border-pink-900 ring-1 ring-pink-100 dark:ring-pink-900/50' : 'border-gray-100 dark:border-gray-700'}`}>
          <div className="p-6 border-b border-gray-100 dark:border-gray-700 bg-gradient-to-l from-white to-pink-50/50 dark:from-gray-800 dark:to-pink-900/20 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className={`p-2 rounded-xl transition-colors ${igStatus.isConnected ? 'bg-gradient-to-tr from-pink-500 to-orange-400 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400'}`}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="2" width="20" height="20" rx="5" ry="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/></svg>
              </div>
              <div>
                <h3 className="font-bold text-gray-800 dark:text-white text-lg">Instagram</h3>
                <p className="text-xs text-pink-600 dark:text-pink-400 font-medium">التعليقات والرسائل المباشرة</p>
              </div>
            </div>
            {igStatus.isConnected ? (
              <span className="flex items-center gap-1.5 text-green-700 dark:text-green-400 text-xs font-bold bg-green-50 dark:bg-green-900/30 border border-green-100 dark:border-green-800 px-3 py-1.5 rounded-full shadow-sm">
                <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
                متصل
              </span>
            ) : (
              <span className="flex items-center gap-1.5 text-gray-500 dark:text-gray-400 text-xs font-medium bg-gray-100 dark:bg-gray-700 px-3 py-1.5 rounded-full">
                <span className="w-2 h-2 rounded-full bg-gray-400"></span>
                غير متصل
              </span>
            )}
          </div>

          <div className="p-6">
            {!igStatus.isConnected ? (
              <div className="text-center py-6">
                <p className="text-gray-600 dark:text-gray-400 mb-6 text-sm max-w-xs mx-auto">اربط حسابك التجاري على إنستغرام للرد تلقائياً على التعليقات وإرسال رسائل مباشرة.</p>
                <button
                  onClick={handleConnectInstagram}
                  disabled={isLoadingIg}
                  className="bg-gradient-to-r from-pink-500 to-orange-400 text-white px-6 py-2.5 rounded-xl hover:from-pink-600 hover:to-orange-500 transition-all shadow-md shadow-pink-100 dark:shadow-none flex items-center gap-2 mx-auto disabled:opacity-70 disabled:cursor-not-allowed"
                >
                  {isLoadingIg ? (
                    <>
                      <RefreshCw size={18} className="animate-spin" />
                      جاري الاتصال...
                    </>
                  ) : (
                    <>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="2" width="20" height="20" rx="5" ry="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/></svg>
                      ربط حساب إنستغرام
                    </>
                  )}
                </button>
                <p className="text-[10px] text-gray-400 mt-3">يتطلب حساب أعمال إنستغرام مرتبطاً بصفحة فيسبوك</p>
              </div>
            ) : (
              <div className="space-y-6">
                <div className="p-4 bg-pink-50/50 dark:bg-pink-900/10 border border-pink-100 dark:border-pink-800 rounded-xl flex flex-col gap-3">
                  <div className="flex justify-between items-center">
                    <span className="text-sm font-semibold text-gray-600 dark:text-gray-300">الحساب:</span>
                    <span className="text-pink-700 dark:text-pink-400 font-bold text-lg">@{igStatus.accountName}</span>
                  </div>
                </div>

                <p className="text-xs text-gray-500 dark:text-gray-400 bg-indigo-50/60 dark:bg-indigo-950/30 border border-indigo-100 dark:border-indigo-900/40 rounded-xl p-3">
                  إعدادات التعليقات والرسائل الخاصة لإنستغرام أصبحت في تبويب{' '}
                  <span className="font-semibold text-indigo-700 dark:text-indigo-300">أتمتة المنشورات والتعليقات</span>.
                </p>

                <button
                  onClick={() => initiateDisconnect('instagram')}
                  className="w-full text-center text-xs text-red-500 hover:text-red-700 dark:hover:text-red-400 mt-2 flex items-center justify-center gap-1 py-2 hover:bg-red-50 dark:hover:bg-red-900/10 rounded-lg transition-colors"
                >
                  <Trash2 size={12} />
                  إلغاء ربط إنستغرام
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Storify Card */}
        {showStorifyCard && (
        <div className={`bg-white dark:bg-gray-800 rounded-2xl shadow-sm border transition-all duration-300 overflow-hidden ${storifyStatus.isConnected ? 'border-lime-200 dark:border-lime-900 ring-1 ring-lime-100 dark:ring-lime-900/50' : 'border-gray-100 dark:border-gray-700'}`}>
          <div className="p-6 border-b border-gray-100 dark:border-gray-700 bg-gradient-to-l from-white to-lime-50/50 dark:from-gray-800 dark:to-lime-900/20 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className={`p-2 rounded-xl transition-colors ${storifyStatus.isConnected ? 'bg-lime-600 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400'}`}>
                <Store size={24} />
              </div>
              <div>
                <h3 className="font-bold text-gray-800 dark:text-white text-lg">Storify</h3>
                <p className="text-xs text-lime-600 dark:text-lime-400 font-medium">مزامنة المنتجات عبر Storefront API</p>
              </div>
            </div>
            {storifyStatus.isConnected ? (
              <span className="flex items-center gap-1.5 text-lime-700 dark:text-lime-400 text-xs font-bold bg-lime-50 dark:bg-lime-900/30 border border-lime-100 dark:border-lime-800 px-3 py-1.5 rounded-full shadow-sm">
                <span className="w-2 h-2 rounded-full bg-lime-500 animate-pulse"></span>
                متصل
              </span>
            ) : (
              <span className="flex items-center gap-1.5 text-gray-500 dark:text-gray-400 text-xs font-medium bg-gray-100 dark:bg-gray-700 px-3 py-1.5 rounded-full">
                <span className="w-2 h-2 rounded-full bg-gray-400"></span>
                غير متصل
              </span>
            )}
          </div>

          <div className="p-6">
            {!storifyStatus.isConnected ? (
              <div className="space-y-4">
                <p className="text-sm text-gray-600 dark:text-gray-400 text-center">
                  اربط متجر Storify عبر رابط المتجر وAccess Token وواجهة المنتجات.
                </p>
                <input
                  type="text"
                  placeholder="store.example.com"
                  value={storifyForm.storeDomain}
                  onChange={(e) => setStorifyForm({ ...storifyForm, storeDomain: e.target.value })}
                  className="w-full px-4 py-2.5 border border-gray-200 dark:border-gray-600 rounded-xl bg-gray-50 dark:bg-gray-700 text-gray-800 dark:text-white focus:ring-2 focus:ring-lime-500 outline-none dir-ltr text-left"
                />
                <input
                  type="text"
                  placeholder="https://store.example.com"
                  value={storifyForm.apiBaseUrl}
                  onChange={(e) => setStorifyForm({ ...storifyForm, apiBaseUrl: e.target.value })}
                  className="w-full px-4 py-2.5 border border-gray-200 dark:border-gray-600 rounded-xl bg-gray-50 dark:bg-gray-700 text-gray-800 dark:text-white focus:ring-2 focus:ring-lime-500 outline-none dir-ltr text-left"
                />
                <input
                  type="text"
                  placeholder="/api/storefront/products"
                  value={storifyForm.productsEndpoint}
                  onChange={(e) => setStorifyForm({ ...storifyForm, productsEndpoint: e.target.value })}
                  className="w-full px-4 py-2.5 border border-gray-200 dark:border-gray-600 rounded-xl bg-gray-50 dark:bg-gray-700 text-gray-800 dark:text-white focus:ring-2 focus:ring-lime-500 outline-none dir-ltr text-left"
                />
                <input
                  type="password"
                  placeholder="Access Token"
                  value={storifyForm.accessToken}
                  onChange={(e) => setStorifyForm({ ...storifyForm, accessToken: e.target.value })}
                  className="w-full px-4 py-2.5 border border-gray-200 dark:border-gray-600 rounded-xl bg-gray-50 dark:bg-gray-700 text-gray-800 dark:text-white focus:ring-2 focus:ring-lime-500 outline-none dir-ltr text-left"
                />
                <button
                  onClick={handleConnectStorify}
                  disabled={isLoadingStorify}
                  className="w-full bg-lime-600 hover:bg-lime-700 text-white px-6 py-2.5 rounded-xl transition-all font-bold shadow-md shadow-lime-100 dark:shadow-none flex items-center justify-center gap-2 disabled:opacity-70"
                >
                  {isLoadingStorify ? 'جاري الربط...' : 'ربط Storify الآن'}
                </button>
              </div>
            ) : (
              <div className="space-y-6">
                <div className="p-4 bg-lime-50/50 dark:bg-lime-900/10 border border-lime-100 dark:border-lime-800 rounded-xl flex flex-col gap-3">
                  <div className="flex justify-between items-center">
                    <span className="text-sm font-semibold text-gray-600 dark:text-gray-300">المتجر:</span>
                    <span className="text-lime-700 dark:text-lime-400 font-bold text-lg">{storifyStatus.accountName}</span>
                  </div>
                  <div className="h-px bg-lime-100 dark:bg-lime-800 w-full"></div>
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-gray-500 dark:text-gray-400 flex items-center gap-1">
                      <Clock size={12} />
                      آخر تزامن:
                    </span>
                    <span className="text-gray-700 dark:text-gray-300 font-medium" dir="ltr">{formatDate(storifyStatus.lastSync)}</span>
                  </div>
                </div>

                <div className="flex gap-3">
                  <button
                    onClick={handleSyncStorify}
                    disabled={isSyncing}
                    className="flex-1 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-200 px-4 py-2.5 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors flex items-center justify-center gap-2 text-sm font-bold"
                  >
                    <RefreshCw size={16} className={isSyncing ? "animate-spin" : ""} />
                    {isSyncing ? 'جاري المزامنة...' : 'مزامنة المنتجات'}
                  </button>
                  <button
                    onClick={() => initiateDisconnect('storify')}
                    className="flex-1 flex items-center gap-2 text-red-500 hover:text-red-700 text-sm font-medium justify-center p-2 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors border border-red-100 dark:border-red-900/30"
                  >
                    <Trash2 size={16} />
                    إلغاء الربط
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
        )}

        {/* Shopify Card */}
        {showShopifyCard && (
        <div className="relative pointer-events-none opacity-60 grayscale bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 transition-all duration-300 overflow-hidden">
          <div className="absolute top-4 left-4 bg-gray-700 dark:bg-gray-600 text-white text-xs font-bold px-3 py-1 rounded-full z-10 border border-gray-600 shadow-sm">قريباً</div>
          <div className="p-6 border-b border-gray-100 dark:border-gray-700 bg-gradient-to-l from-white to-green-50/50 dark:from-gray-800 dark:to-green-900/20 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className={`p-2 rounded-xl transition-colors ${shopifyStatus.isConnected ? 'bg-green-600 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400'}`}>
                <ShoppingBag size={24} />
              </div>
              <div>
                <h3 className="font-bold text-gray-800 dark:text-white text-lg">Shopify</h3>
                <p className="text-xs text-green-600 dark:text-green-400 font-medium">مزامنة المنتجات والطلبات</p>
              </div>
            </div>
            {shopifyStatus.isConnected ? (
              <span className="flex items-center gap-1.5 text-green-700 dark:text-green-400 text-xs font-bold bg-green-50 dark:bg-green-900/30 border border-green-100 dark:border-green-800 px-3 py-1.5 rounded-full shadow-sm">
                <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
                متصل
              </span>
            ) : (
              <span className="flex items-center gap-1.5 text-gray-500 dark:text-gray-400 text-xs font-medium bg-gray-100 dark:bg-gray-700 px-3 py-1.5 rounded-full">
                <span className="w-2 h-2 rounded-full bg-gray-400"></span>
                غير متصل
              </span>
            )}
          </div>

          <div className="p-6">
            {!shopifyStatus.isConnected ? (
              <div className="space-y-4">
                 <p className="text-sm text-gray-600 dark:text-gray-400 text-center mb-4">أدخل رابط متجرك على Shopify للبدء باستيراد المنتجات تلقائياً.</p>
                 <div className="relative">
                    <LinkIcon className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                    <input 
                      type="text" 
                      placeholder="example.myshopify.com" 
                      value={shopifyUrl}
                      onChange={(e) => setShopifyUrl(e.target.value)}
                      className="w-full pr-10 pl-4 py-2.5 border border-gray-200 dark:border-gray-600 rounded-xl bg-gray-50 dark:bg-gray-700 text-gray-800 dark:text-white focus:ring-2 focus:ring-green-500 outline-none dir-ltr text-left"
                    />
                 </div>
                 <button 
                  onClick={handleConnectShopify}
                  disabled={isLoadingShopify}
                  className="w-full bg-[#95BF47] hover:bg-[#86ad3d] text-white px-6 py-2.5 rounded-xl transition-all font-bold shadow-md shadow-green-100 dark:shadow-none flex items-center justify-center gap-2 disabled:opacity-70"
                >
                  {isLoadingShopify ? 'جاري الربط...' : 'ربط المتجر الآن'}
                </button>
              </div>
            ) : (
              <div className="space-y-6">
                 <div className="p-4 bg-green-50/50 dark:bg-green-900/10 border border-green-100 dark:border-green-800 rounded-xl flex flex-col gap-3">
                   <div className="flex justify-between items-center">
                      <span className="text-sm font-semibold text-gray-600 dark:text-gray-300">المتجر:</span>
                      <span className="text-green-700 dark:text-green-400 font-bold text-lg">{shopifyStatus.accountName}</span>
                   </div>
                   <div className="h-px bg-green-100 dark:bg-green-800 w-full"></div>
                   <div className="flex justify-between items-center text-xs">
                      <span className="text-gray-500 dark:text-gray-400 flex items-center gap-1">
                        <Clock size={12} />
                        آخر تزامن:
                      </span>
                      <span className="text-gray-700 dark:text-gray-300 font-medium" dir="ltr">{formatDate(shopifyStatus.lastSync)}</span>
                   </div>
                </div>

                <div className="flex gap-3">
                  <button 
                    onClick={handleSyncShopify}
                    disabled={isSyncing}
                    className="flex-1 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-200 px-4 py-2.5 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors flex items-center justify-center gap-2 text-sm font-bold"
                  >
                    <RefreshCw size={16} className={isSyncing ? "animate-spin" : ""} />
                    {isSyncing ? 'جاري المزامنة...' : 'مزامنة المنتجات'}
                  </button>
                  <button 
                    onClick={handleSyncOrders}
                    disabled={isSyncingOrders}
                    className="flex-1 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-200 px-4 py-2.5 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors flex items-center justify-center gap-2 text-sm font-bold"
                  >
                    <ShoppingCart size={16} className={isSyncingOrders ? "animate-spin" : ""} />
                    {isSyncingOrders ? 'جاري المزامنة...' : 'مزامنة الطلبات'}
                  </button>
                </div>
                
                <div className="pt-2 border-t border-gray-100 dark:border-gray-700 flex gap-2">
                   <button 
                     onClick={() => setShowShopifySettings(true)} 
                     className="flex-1 flex items-center gap-2 text-gray-600 dark:text-gray-300 hover:text-gray-800 dark:hover:text-white text-sm font-medium justify-center p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                   >
                      <Settings size={16} />
                      الإعدادات
                   </button>
                   <button 
                     onClick={() => initiateDisconnect('shopify')} 
                     className="flex-1 flex items-center gap-2 text-red-500 hover:text-red-700 text-sm font-medium justify-center p-2 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                   >
                      <Trash2 size={16} />
                      إلغاء الربط
                   </button>
                </div>
              </div>
            )}
          </div>
        </div>
        )}

        {/* Telegram Card */}
        {showTelegramCard && (
        <div className={`bg-white dark:bg-gray-800 rounded-2xl shadow-sm border transition-all duration-300 overflow-hidden ${telegramStatus.isConnected ? 'border-sky-200 dark:border-sky-900 ring-1 ring-sky-100 dark:ring-sky-900/50' : 'border-gray-100 dark:border-gray-700'}`}>
          <div className="p-6 border-b border-gray-100 dark:border-gray-700 bg-gradient-to-l from-white to-sky-50/50 dark:from-gray-800 dark:to-sky-900/20 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className={`p-2 rounded-xl transition-colors ${telegramStatus.isConnected ? 'bg-sky-500 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400'}`}>
                <Send size={24} />
              </div>
              <div>
                <h3 className="font-bold text-gray-800 dark:text-white text-lg">Telegram</h3>
                <p className="text-xs text-sky-600 dark:text-sky-400 font-medium">بوت الردود التلقائية</p>
              </div>
            </div>
            {telegramStatus.isConnected ? (
              <span className="flex items-center gap-1.5 text-green-700 dark:text-green-400 text-xs font-bold bg-green-50 dark:bg-green-900/30 border border-green-100 dark:border-green-800 px-3 py-1.5 rounded-full shadow-sm">
                <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
                متصل
              </span>
            ) : (
              <span className="flex items-center gap-1.5 text-gray-500 dark:text-gray-400 text-xs font-medium bg-gray-100 dark:bg-gray-700 px-3 py-1.5 rounded-full">
                <span className="w-2 h-2 rounded-full bg-gray-400"></span>
                غير متصل
              </span>
            )}
          </div>

          <div className="p-6">
            <div className="space-y-4">
              {/* Header with Add Button */}
              <div className="flex items-center justify-between mb-4">
                <h4 className="text-sm font-bold text-gray-700 dark:text-gray-300">
                  البوتات المتصلة ({telegramBots.length})
                </h4>
                <button
                  onClick={() => {
                    console.log('[IntegrationsPanel] Add bot button clicked');
                    setEditingBot(null);
                    setNewBotData({ botToken: '', botName: '', botType: 'both' });
                    setShowTelegramBotModal(true);
                  }}
                  className="bg-sky-500 hover:bg-sky-600 text-white px-4 py-2 rounded-lg transition-all font-bold text-sm flex items-center justify-center gap-2 shadow-md shadow-sky-100 dark:shadow-none"
                >
                  <Plus size={16} />
                  إضافة بوت جديد
                </button>
              </div>

              {/* Bots List */}
              {telegramBots.length > 0 ? (
                <div className="space-y-3">
                  {telegramBots.map((bot) => (
                    <div key={bot.id} className="p-4 bg-sky-50/50 dark:bg-sky-900/10 border border-sky-100 dark:border-sky-800 rounded-xl">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-2">
                            <span className="text-sky-700 dark:text-sky-400 font-bold text-sm">
                              {bot.botName || bot.botUsername || 'بوت تيليجرام'}
                            </span>
                            {bot.botUsername && (
                              <span className="text-xs text-gray-500 dark:text-gray-400">@{bot.botUsername}</span>
                            )}
                            {bot.isActive ? (
                              <span className="flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
                                <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
                                نشط
                              </span>
                            ) : (
                              <span className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
                                <span className="w-2 h-2 rounded-full bg-gray-400"></span>
                                غير نشط
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400">
                            <span className="font-semibold">نوع البوت:</span>
                            <span className="px-2 py-0.5 bg-sky-100 dark:bg-sky-900/30 rounded text-sky-700 dark:text-sky-400">
                              {bot.botType === 'products' ? 'المنتجات' : 
                               bot.botType === 'services' ? 'الخدمات' : 
                               'المنتجات والخدمات'}
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => {
                              setEditingBot(bot.id);
                              setNewBotData({
                                botToken: '',
                                botName: bot.botName || '',
                                botType: bot.botType
                              });
                              setShowTelegramBotModal(true);
                            }}
                            className="p-1.5 text-sky-600 dark:text-sky-400 hover:bg-sky-100 dark:hover:bg-sky-900/30 rounded-lg transition-colors"
                            title="تعديل البوت"
                          >
                            <Edit2 size={16} />
                          </button>
                          <button
                            onClick={() => initiateDisconnect('telegram', bot.id)}
                            className="p-1.5 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                            title="حذف البوت"
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 border-2 border-dashed border-gray-200 dark:border-gray-700 rounded-xl">
                  <Send size={48} className="mx-auto text-gray-300 dark:text-gray-600 mb-3" />
                  <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">
                    لا توجد بوتات متصلة حالياً
                  </p>
                  <p className="text-xs text-gray-400 dark:text-gray-500">
                    استخدم الزر "إضافة بوت جديد" أعلاه للبدء
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
        )}

        {/* WhatsApp Card */}
        {showWhatsAppCard && (
        <div className={`bg-white dark:bg-gray-800 rounded-2xl shadow-sm border transition-all duration-300 overflow-hidden ${whatsappStatus.isConnected ? 'border-green-200 dark:border-green-900 ring-1 ring-green-100 dark:ring-green-900/50' : 'border-gray-100 dark:border-gray-700'}`}>
          <div className="p-6 border-b border-gray-100 dark:border-gray-700 bg-gradient-to-l from-white to-green-50/50 dark:from-gray-800 dark:to-green-900/20 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className={`p-2 rounded-xl transition-colors ${whatsappStatus.isConnected ? 'bg-green-600 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400'}`}>
                <MessageSquare size={24} />
              </div>
              <div>
                <h3 className="font-bold text-gray-800 dark:text-white text-lg">WhatsApp Business</h3>
                <p className="text-xs text-green-600 dark:text-green-400 font-medium">الردود التلقائية</p>
              </div>
            </div>
            {whatsappStatus.isConnected ? (
              <span className="flex items-center gap-1.5 text-green-700 dark:text-green-400 text-xs font-bold bg-green-50 dark:bg-green-900/30 border border-green-100 dark:border-green-800 px-3 py-1.5 rounded-full shadow-sm">
                <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
                متصل
              </span>
            ) : (
              <span className="flex items-center gap-1.5 text-gray-500 dark:text-gray-400 text-xs font-medium bg-gray-100 dark:bg-gray-700 px-3 py-1.5 rounded-full">
                <span className="w-2 h-2 rounded-full bg-gray-400"></span>
                غير متصل
              </span>
            )}
          </div>
          
          <div className="p-6">
            {!whatsappStatus.isConnected ? (
              <div className="text-center py-6">
                <p className="text-gray-600 dark:text-gray-400 mb-6 text-sm max-w-xs mx-auto">امسح رمز QR من واتساب لربط رقم المتجر بالبوت والرد تلقائياً على الزبائن.</p>
                <button 
                  onClick={() => {
                    if (singleChannelPlan && connectedChannelCount >= 1) {
                      showNotification?.('باقتك تسمح بقناة واحدة. افصل القناة الحالية أولاً.', 'warning');
                      return;
                    }
                    setWhatsappQrDataUrl(null);
                    setWhatsappPairingError(null);
                    setIsLoadingWhatsApp(true);
                    setShowWhatsAppModal(true);
                  }}
                  disabled={isLoadingWhatsApp}
                  className="bg-[#25D366] text-white px-6 py-2.5 rounded-xl hover:bg-green-600 transition-all shadow-md shadow-green-100 dark:shadow-none flex items-center gap-2 mx-auto disabled:opacity-70 disabled:cursor-not-allowed"
                >
                  {isLoadingWhatsApp ? (
                    <>
                      <RefreshCw size={18} className="animate-spin" />
                      جاري الاتصال...
                    </>
                  ) : (
                    <>
                      <MessageSquare size={18} />
                      ربط حساب WhatsApp
                    </>
                  )}
                </button>
              </div>
            ) : (
              <div className="space-y-6">
                <div className="p-4 bg-green-50/50 dark:bg-green-900/10 border border-green-100 dark:border-green-800 rounded-xl flex flex-col gap-3">
                   <div className="flex justify-between items-center">
                      <span className="text-sm font-semibold text-gray-600 dark:text-gray-300">رقم الهاتف:</span>
                      <span className="text-green-700 dark:text-green-400 font-bold text-lg">{whatsappStatus.accountName}</span>
                   </div>
                   <div className="h-px bg-green-100 dark:bg-green-800 w-full"></div>
                   <div className="flex justify-between items-center text-xs">
                      <span className="text-gray-500 dark:text-gray-400 flex items-center gap-1">
                        <Clock size={12} />
                        آخر تزامن:
                      </span>
                      <span className="text-gray-700 dark:text-gray-300 font-medium" dir="ltr">{formatDate(whatsappStatus.lastSync)}</span>
                   </div>
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between p-3 border border-gray-100 dark:border-gray-700 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-green-50 dark:bg-green-900/20 flex items-center justify-center text-green-600 dark:text-green-400">
                        <MessageCircle size={16} />
                      </div>
                      <p className="text-sm font-bold text-gray-800 dark:text-gray-200">الرد التلقائي</p>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input 
                        type="checkbox" 
                        className="sr-only peer"
                        checked={whatsappAutoReply}
                        onChange={async (e) => {
                          const next = e.target.checked;
                          setWhatsappAutoReply(next);
                          try {
                            await apiService.updateWhatsAppSettings({ autoReplyEnabled: next });
                            addLog(generateLog('WhatsApp', next ? 'تم تفعيل الرد التلقائي' : 'تم إيقاف الرد التلقائي', 'info'));
                          } catch (error: any) {
                            setWhatsappAutoReply(!next);
                            logger.error('Failed to update WhatsApp settings:', error);
                            addLog(generateLog('WhatsApp', `فشل تحديث الإعدادات: ${error.message}`, 'error'));
                            showNotification?.('تعذر تحديث الرد التلقائي', 'error');
                          }
                        }}
                      />
                      <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-green-300 dark:peer-focus:ring-green-800 rounded-full peer dark:bg-gray-600 peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-500 peer-checked:bg-green-500"></div>
                    </label>
                  </div>
                </div>

                <div className="pt-2 border-t border-gray-100 dark:border-gray-700">
                   <button onClick={() => initiateDisconnect('whatsapp')} className="flex items-center gap-2 text-red-500 hover:text-red-700 text-sm font-medium w-full justify-center p-2 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors">
                      <Trash2 size={16} />
                      إلغاء الربط
                   </button>
                </div>
              </div>
            )}
          </div>
        </div>
        )}

      </div>

      {/* Connection Logs */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 p-6">
        <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-4">سجل العمليات</h3>
        <div className="space-y-3 max-h-60 overflow-y-auto custom-scrollbar pr-2">
           {logs.length === 0 && (
             <p className="text-gray-400 text-center text-sm py-4">لا توجد عمليات مسجلة بعد.</p>
           )}
           {logs.map((log) => (
             <div key={log.id} className="flex items-start gap-3 p-3 bg-gray-50 dark:bg-gray-700/50 rounded-xl">
               <div className={`mt-1 w-2 h-2 rounded-full shrink-0 ${
                 log.status === 'success' ? 'bg-green-500' : 
                 log.status === 'error' ? 'bg-red-500' : 'bg-blue-500'
               }`}></div>
               <div className="flex-1">
                 <p className="text-sm font-bold text-gray-800 dark:text-gray-200 flex justify-between">
                    <span>{log.platform}: {log.action}</span>
                    <span className="text-[10px] text-gray-400 font-normal dir-ltr">{formatDate(log.timestamp)}</span>
                 </p>
                 <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{log.details}</p>
               </div>
             </div>
           ))}
        </div>
      </div>

      {/* Disconnect Confirmation Modal — portal so it centers on the viewport */}
      {showDisconnectModal && typeof document !== 'undefined' && ReactDOM.createPortal(
        <div
          className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[9999] flex items-center justify-center p-4 animate-fade-in"
          style={{ margin: 0 }}
          onClick={() => {
            setShowDisconnectModal(false);
            setDisconnectTarget(null);
          }}
        >
          <div
            className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-md p-6 border border-gray-100 dark:border-gray-700"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 text-red-600 mb-4">
              <div className="p-2 bg-red-50 dark:bg-red-900/20 rounded-full">
                <AlertTriangle size={24} />
              </div>
              <h3 className="text-lg font-bold">تحذير: إلغاء الربط</h3>
            </div>
            
            <p className="text-gray-600 dark:text-gray-300 mb-6 leading-relaxed">
              هل أنت متأكد من رغبتك في إلغاء ربط{' '}
              <span className="font-bold text-gray-900 dark:text-white">
                {disconnectTarget === 'facebook'
                  ? 'صفحة فيسبوك'
                  : disconnectTarget === 'instagram'
                    ? 'حساب إنستغرام'
                    : disconnectTarget === 'storify'
                      ? 'متجر Storify'
                    : disconnectTarget === 'shopify'
                      ? 'متجر Shopify'
                      : disconnectTarget === 'whatsapp'
                        ? 'حساب WhatsApp'
                        : 'بوت تيليجرام'}
              </span>
              ؟
              <br/>
              <span className="text-red-500 text-sm font-bold block mt-2">
                {disconnectTarget === 'instagram'
                  ? 'سيتوقف البوت عن الرد على تعليقات ورسائل إنستغرام فوراً ولن تتم مزامنة البيانات بعد الآن.'
                  : 'سيتوقف البوت عن الرد فوراً ولن تتم مزامنة البيانات بعد الآن.'}
              </span>
            </p>

            <div className="flex justify-end gap-3">
              <button 
                onClick={() => {
                  setShowDisconnectModal(false);
                  setDisconnectTarget(null);
                }}
                className="px-4 py-2 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg font-medium transition-colors"
              >
                تراجع
              </button>
              <button 
                onClick={confirmDisconnect}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg font-bold shadow-md shadow-red-200 dark:shadow-none transition-colors"
              >
                تأكيد الإلغاء
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {showWhatsAppModal && ReactDOM.createPortal(
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[9999] flex items-center justify-center p-4" style={{ margin: 0 }}>
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-md p-6 border border-gray-100 dark:border-gray-700">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-gray-900 dark:text-white">ربط واتساب</h3>
              <button
                onClick={() => {
                  setShowWhatsAppModal(false);
                  setWhatsappQrDataUrl(null);
                  setWhatsappPairingError(null);
                  setIsLoadingWhatsApp(false);
                }}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
              >
                <XCircle size={24} />
              </button>
            </div>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-5">
              افتح واتساب على الجوال ← الأجهزة المرتبطة ← مسح رمز QR. الرقم يبقى على هاتفك، والمنصة تظهر كجهاز مرتبط.
            </p>
            <div className="flex flex-col items-center gap-4">
              {whatsappQrDataUrl ? (
                <img
                  src={whatsappQrDataUrl}
                  alt="رمز QR لواتساب"
                  className="w-64 h-64 rounded-xl border border-gray-200 dark:border-gray-600 bg-white p-2"
                />
              ) : (
                <div className="w-64 h-64 rounded-xl border border-dashed border-gray-300 dark:border-gray-600 flex flex-col items-center justify-center text-gray-500 dark:text-gray-400">
                  <RefreshCw size={28} className="animate-spin mb-3" />
                  <span className="text-sm">جاري تجهيز الرمز...</span>
                </div>
              )}
              {whatsappPairingError && (
                <p className="text-sm text-red-600 dark:text-red-400 text-center">{whatsappPairingError}</p>
              )}
              <button
                type="button"
                onClick={() => {
                  setWhatsappQrDataUrl(null);
                  setWhatsappPairingError(null);
                  setIsLoadingWhatsApp(true);
                  void apiService.startWhatsAppWebPairing().catch((error: Error) => {
                    setWhatsappPairingError(error.message || 'تعذر تحديث الرمز');
                    setIsLoadingWhatsApp(false);
                  });
                }}
                className="text-sm font-medium text-green-700 dark:text-green-400 hover:underline"
              >
                تحديث الرمز
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Telegram Bot Modal */}
      {showTelegramBotModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-md p-6 border border-gray-100 dark:border-gray-700">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-bold text-gray-900 dark:text-white">
                {editingBot ? 'تعديل البوت' : 'إضافة بوت جديد'}
              </h3>
              <button
                onClick={() => {
                  setShowTelegramBotModal(false);
                  setEditingBot(null);
                  setNewBotData({ botToken: '', botName: '', botType: 'both' });
                }}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
              >
                <XCircle size={24} />
              </button>
            </div>

            <div className="space-y-4">
              {!editingBot && (
                <div>
                  <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                    رمز البوت (Bot Token) *
                  </label>
                  <input
                    type="text"
                    placeholder="123456789:ABCdefGHIjklMNOpqrs..."
                    value={newBotData.botToken}
                    onChange={(e) => setNewBotData({ ...newBotData, botToken: e.target.value })}
                    className="w-full px-4 py-2.5 border border-gray-200 dark:border-gray-600 rounded-xl bg-gray-50 dark:bg-gray-700 text-gray-800 dark:text-white focus:ring-2 focus:ring-sky-500 outline-none dir-ltr text-left font-mono text-sm"
                  />
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    احصل على رمز البوت من @BotFather في Telegram
                  </p>
                </div>
              )}

              <div>
                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                  اسم البوت (اختياري)
                </label>
                <input
                  type="text"
                  placeholder="مثال: بوت المبيعات"
                  value={newBotData.botName}
                  onChange={(e) => setNewBotData({ ...newBotData, botName: e.target.value })}
                  className="w-full px-4 py-2.5 border border-gray-200 dark:border-gray-600 rounded-xl bg-gray-50 dark:bg-gray-700 text-gray-800 dark:text-white focus:ring-2 focus:ring-sky-500 outline-none"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                  نوع البوت *
                </label>
                <select
                  value={newBotData.botType}
                  onChange={(e) => setNewBotData({ ...newBotData, botType: e.target.value as 'products' | 'services' | 'both' })}
                  className="w-full px-4 py-2.5 border border-gray-200 dark:border-gray-600 rounded-xl bg-gray-50 dark:bg-gray-700 text-gray-800 dark:text-white focus:ring-2 focus:ring-sky-500 outline-none"
                >
                  <option value="products">المنتجات فقط</option>
                  <option value="services">الخدمات فقط</option>
                  <option value="both">المنتجات والخدمات معاً</option>
                </select>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  اختر نوع المحتوى الذي سيرد عليه البوت
                </p>
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  onClick={() => {
                    setShowTelegramBotModal(false);
                    setEditingBot(null);
                    setNewBotData({ botToken: '', botName: '', botType: 'both' });
                  }}
                  className="flex-1 px-4 py-2.5 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-xl font-medium transition-colors"
                >
                  إلغاء
                </button>
                <button
                  onClick={editingBot ? () => {
                    const bot = telegramBots.find(b => b.id === editingBot);
                    if (bot) {
                      handleUpdateTelegramBot(editingBot, {
                        botName: newBotData.botName || undefined,
                        botType: newBotData.botType
                      });
                      setShowTelegramBotModal(false);
                      setEditingBot(null);
                    }
                  } : handleCreateTelegramBot}
                  disabled={isLoadingTelegram || (!editingBot && !newBotData.botToken)}
                  className="flex-1 px-4 py-2.5 bg-sky-500 hover:bg-sky-600 text-white rounded-xl font-bold shadow-md shadow-sky-100 dark:shadow-none transition-colors disabled:opacity-70 disabled:cursor-not-allowed"
                >
                  {isLoadingTelegram ? 'جاري الحفظ...' : editingBot ? 'حفظ التعديلات' : 'إضافة البوت'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Sync Progress Modal */}
      {syncProgress?.isVisible && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-md p-6 border border-gray-100 dark:border-gray-700">
            <div className="flex items-center gap-3 mb-6">
              <div className={`p-2 rounded-full ${
                syncProgress.status === 'running' ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-500' :
                syncProgress.status === 'completed' ? 'bg-green-50 dark:bg-green-900/20 text-green-500' :
                'bg-red-50 dark:bg-red-900/20 text-red-500'
              }`}>
                {syncProgress.status === 'running' ? (
                  <RefreshCw size={24} className="animate-spin" />
                ) : syncProgress.status === 'completed' ? (
                  <CheckCircle size={24} />
                ) : (
                  <XCircle size={24} />
                )}
              </div>
              <h3 className="text-lg font-bold text-gray-900 dark:text-white">
                {syncProgress.status === 'running' ? 'جاري الاستيراد...' :
                 syncProgress.status === 'completed' ? 'اكتمل الاستيراد' : 'فشل الاستيراد'}
              </h3>
            </div>

            {syncProgress.status === 'running' && (
              <div className="mb-6">
                <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                  <div className="h-full bg-gradient-to-r from-green-500 to-emerald-500 rounded-full animate-pulse" style={{ width: '100%' }}></div>
                </div>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-2 text-center">
                  {syncProgress.message}
                </p>
              </div>
            )}

            {syncProgress.status !== 'running' && (
              <div className="space-y-4">
                <p className="text-gray-600 dark:text-gray-300 text-center mb-4">
                  {syncProgress.message}
                </p>

                {syncProgress.status === 'completed' && (
                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-blue-50 dark:bg-blue-900/20 rounded-xl p-3 text-center">
                      <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">{syncProgress.totalItems}</div>
                      <div className="text-xs text-blue-500 dark:text-blue-300">إجمالي المنتجات</div>
                    </div>
                    <div className="bg-green-50 dark:bg-green-900/20 rounded-xl p-3 text-center">
                      <div className="text-2xl font-bold text-green-600 dark:text-green-400">{syncProgress.createdItems}</div>
                      <div className="text-xs text-green-500 dark:text-green-300">منتجات جديدة</div>
                    </div>
                    <div className="bg-amber-50 dark:bg-amber-900/20 rounded-xl p-3 text-center">
                      <div className="text-2xl font-bold text-amber-600 dark:text-amber-400">{syncProgress.updatedItems}</div>
                      <div className="text-xs text-amber-500 dark:text-amber-300">منتجات محدثة</div>
                    </div>
                    {syncProgress.failedItems > 0 && (
                      <div className="bg-red-50 dark:bg-red-900/20 rounded-xl p-3 text-center">
                        <div className="text-2xl font-bold text-red-600 dark:text-red-400">{syncProgress.failedItems}</div>
                        <div className="text-xs text-red-500 dark:text-red-300">منتجات فشلت</div>
                      </div>
                    )}
                  </div>
                )}

                <button
                  onClick={() => setSyncProgress(null)}
                  className="w-full mt-4 px-4 py-2.5 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 rounded-xl font-bold transition-colors"
                >
                  إغلاق
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Facebook Page Selection Modal — rendered via portal to avoid parent transform/overflow issues */}
      {showFbPageSelector && ReactDOM.createPortal(
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[9999] flex items-center justify-center p-4" style={{ margin: 0 }}>
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-lg p-6 border border-gray-100 dark:border-gray-700 max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-blue-600 rounded-xl text-white">
                  <Facebook size={22} />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-gray-900 dark:text-white">اختر الصفحات للربط</h3>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    حدد صفحات فيسبوك التي تريد ربطها بالبوت
                  </p>
                </div>
              </div>
              <button
                onClick={() => {
                  setShowFbPageSelector(false);
                  setFbLinkingSessionId('');
                }}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
              >
                <XCircle size={24} />
              </button>
            </div>

            {fbPlanLimits && (
              <div className={`mb-4 p-3 rounded-xl border text-sm flex items-center gap-2 ${
                fbPlanLimits.maxFacebookPages === -1
                  ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800 text-green-700 dark:text-green-400'
                  : fbPlanLimits.remainingSlots > 0
                    ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-400'
                    : 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-400'
              }`}>
                <AlertCircle size={16} className="shrink-0" />
                <span>
                  {fbPlanLimits.maxFacebookPages === -1 ? (
                    'باقتك تسمح بربط عدد غير محدود من الصفحات.'
                  ) : (
                    <>
                      باقتك تسمح بربط <strong>{fbPlanLimits.maxFacebookPages}</strong> صفحة
                      {fbPlanLimits.currentLinkedCount > 0 && (
                        <> — مربوط حالياً <strong>{fbPlanLimits.currentLinkedCount}</strong></>
                      )}
                      {fbPlanLimits.remainingSlots > 0 ? (
                        <> — يمكنك إضافة <strong>{fbPlanLimits.remainingSlots}</strong> صفحة أخرى</>
                      ) : (
                        <> — وصلت للحد الأقصى</>
                      )}
                    </>
                  )}
                </span>
              </div>
            )}

            <div className="flex-1 overflow-y-auto custom-scrollbar space-y-2 mb-4 min-h-0">
              {isLoadingFbPages ? (
                <div className="flex items-center justify-center py-12">
                  <RefreshCw size={24} className="animate-spin text-blue-500" />
                  <span className="mr-2 text-gray-500">جاري تحميل الصفحات...</span>
                </div>
              ) : fbAvailablePages.length === 0 ? (
                <div className="text-center py-12 text-gray-500">
                  <Facebook size={48} className="mx-auto text-gray-300 dark:text-gray-600 mb-3" />
                  <p>لا توجد صفحات متاحة</p>
                </div>
              ) : (
                fbAvailablePages.map((pg) => {
                  const isSelected = fbSelectedPageIds.has(pg.id);
                  const isLinked = pg.alreadyLinked;
                  const isDisabled = isLinked || (
                    !isSelected && fbPlanLimits && fbPlanLimits.maxFacebookPages !== -1 &&
                    [...fbSelectedPageIds].filter(id => !fbAvailablePages.find(p => p.id === id)?.alreadyLinked).length >= fbPlanLimits.remainingSlots
                  );

                  return (
                    <button
                      key={pg.id}
                      onClick={() => handleToggleFbPage(pg.id, isLinked)}
                      disabled={!!isDisabled}
                      className={`w-full flex items-center gap-3 p-3 rounded-xl border transition-all text-right ${
                        isLinked
                          ? 'bg-green-50/50 dark:bg-green-900/10 border-green-200 dark:border-green-800 opacity-70 cursor-default'
                          : isSelected
                            ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-300 dark:border-blue-700 ring-2 ring-blue-200 dark:ring-blue-800'
                            : isDisabled
                              ? 'bg-gray-50 dark:bg-gray-700/50 border-gray-200 dark:border-gray-600 opacity-50 cursor-not-allowed'
                              : 'bg-white dark:bg-gray-700 border-gray-200 dark:border-gray-600 hover:border-blue-300 dark:hover:border-blue-600 hover:bg-blue-50/50 dark:hover:bg-blue-900/10'
                      }`}
                    >
                      <div className="w-10 h-10 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center overflow-hidden shrink-0">
                        {pg.pictureUrl ? (
                          <img src={pg.pictureUrl} alt={pg.name} className="w-10 h-10 rounded-full object-cover" />
                        ) : (
                          <Facebook size={20} className="text-blue-500" />
                        )}
                      </div>

                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-gray-900 dark:text-white truncate">{pg.name}</p>
                        {pg.category && (
                          <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{pg.category}</p>
                        )}
                      </div>

                      <div className="shrink-0">
                        {isLinked ? (
                          <span className="flex items-center gap-1 text-xs text-green-600 dark:text-green-400 bg-green-100 dark:bg-green-900/30 px-2 py-1 rounded-full font-medium">
                            <CheckCircle size={12} />
                            مربوطة
                          </span>
                        ) : isSelected ? (
                          <div className="w-6 h-6 rounded-full bg-blue-600 flex items-center justify-center">
                            <CheckCircle size={14} className="text-white" />
                          </div>
                        ) : (
                          <div className="w-6 h-6 rounded-full border-2 border-gray-300 dark:border-gray-500"></div>
                        )}
                      </div>
                    </button>
                  );
                })
              )}
            </div>

            <div className="flex gap-3 pt-4 border-t border-gray-100 dark:border-gray-700">
              <button
                onClick={() => {
                  setShowFbPageSelector(false);
                  setFbLinkingSessionId('');
                }}
                className="flex-1 px-4 py-2.5 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-xl font-medium transition-colors"
              >
                إلغاء
              </button>
              <button
                onClick={handleLinkFbPages}
                disabled={isLinkingFbPages || [...fbSelectedPageIds].filter(id => !fbAvailablePages.find(p => p.id === id)?.alreadyLinked).length === 0}
                className="flex-1 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold shadow-md shadow-blue-100 dark:shadow-none transition-colors disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {isLinkingFbPages ? (
                  <>
                    <RefreshCw size={16} className="animate-spin" />
                    جاري الربط...
                  </>
                ) : (
                  <>
                    <LinkIcon size={16} />
                    ربط الصفحات المحددة
                    {(() => {
                      const newCount = [...fbSelectedPageIds].filter(id => !fbAvailablePages.find(p => p.id === id)?.alreadyLinked).length;
                      return newCount > 0 ? ` (${newCount})` : '';
                    })()}
                  </>
                )}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Shopify Settings Modal */}
      {showShopifySettings && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-md p-6 border border-gray-100 dark:border-gray-700">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-green-50 dark:bg-green-900/20 rounded-full text-green-500">
                  <Settings size={24} />
                </div>
                <h3 className="text-lg font-bold text-gray-900 dark:text-white">إعدادات Shopify</h3>
              </div>
              <button
                onClick={() => setShowShopifySettings(false)}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
              >
                <XCircle size={24} />
              </button>
            </div>

            <div className="space-y-4">
              {/* Auto Sync Toggle */}
              <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700/50 rounded-xl">
                <div>
                  <div className="font-medium text-gray-900 dark:text-white">المزامنة التلقائية</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">مزامنة المنتجات تلقائياً</div>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={shopifySettings.autoSync}
                    onChange={(e) => setShopifySettings({ ...shopifySettings, autoSync: e.target.checked })}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-green-300 dark:peer-focus:ring-green-800 rounded-full peer dark:bg-gray-600 peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-500 peer-checked:bg-green-500"></div>
                </label>
              </div>

              {/* Sync Interval */}
              {shopifySettings.autoSync && (
                <div>
                  <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                    فترة المزامنة (بالساعات)
                  </label>
                  <select
                    value={shopifySettings.syncInterval}
                    onChange={(e) => setShopifySettings({ ...shopifySettings, syncInterval: parseInt(e.target.value) })}
                    className="w-full px-4 py-2.5 border border-gray-200 dark:border-gray-600 rounded-xl bg-gray-50 dark:bg-gray-700 text-gray-800 dark:text-white focus:ring-2 focus:ring-green-500 outline-none"
                  >
                    <option value={1}>كل ساعة</option>
                    <option value={6}>كل 6 ساعات</option>
                    <option value={12}>كل 12 ساعة</option>
                    <option value={24}>يومياً</option>
                    <option value={48}>كل يومين</option>
                    <option value={168}>أسبوعياً</option>
                  </select>
                </div>
              )}

              {/* Sync Products Toggle */}
              <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700/50 rounded-xl">
                <div>
                  <div className="font-medium text-gray-900 dark:text-white">مزامنة المنتجات</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">استيراد المنتجات من Shopify</div>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={shopifySettings.syncProducts}
                    onChange={(e) => setShopifySettings({ ...shopifySettings, syncProducts: e.target.checked })}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-green-300 dark:peer-focus:ring-green-800 rounded-full peer dark:bg-gray-600 peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-500 peer-checked:bg-green-500"></div>
                </label>
              </div>

              {/* Sync Orders Toggle */}
              <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700/50 rounded-xl">
                <div>
                  <div className="font-medium text-gray-900 dark:text-white">مزامنة الطلبات</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">استيراد الطلبات من Shopify</div>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={shopifySettings.syncOrders}
                    onChange={(e) => setShopifySettings({ ...shopifySettings, syncOrders: e.target.checked })}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-green-300 dark:peer-focus:ring-green-800 rounded-full peer dark:bg-gray-600 peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-500 peer-checked:bg-green-500"></div>
                </label>
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  onClick={() => setShowShopifySettings(false)}
                  className="flex-1 px-4 py-2.5 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-xl font-medium transition-colors"
                >
                  إلغاء
                </button>
                <button
                  onClick={handleUpdateShopifySettings}
                  className="flex-1 px-4 py-2.5 bg-green-500 hover:bg-green-600 text-white rounded-xl font-bold shadow-md shadow-green-100 dark:shadow-none transition-colors"
                >
                  حفظ الإعدادات
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default IntegrationsPanel;
