import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Navigate, useNavigate, useParams, useSearchParams, useLocation } from 'react-router-dom';
import { DEFAULT_SETTINGS } from '../constants';
import { Product, MerchantSettings, AppView, IntegrationStatus, Order, Service, BotPersona } from '../types';
import Layout from './Layout';
import DashboardStats from './DashboardStats';
import ProductManager from './ProductManager';
import OrderManager from './OrderManager';
import BotPlayground from './BotPlayground';
import SettingsPanel from './SettingsPanel';
import IntegrationsPanel from './IntegrationsPanel';
import SocialAutomationPage from './SocialAutomationPage';
import AffiliateDashboard from './AffiliateDashboard';
import ImageStudio from './ImageStudio';
import OnboardingWizard from './OnboardingWizard';
import ErrorBoundary from './ErrorBoundary';
import UserNotifications from './UserNotifications';
import CrmPage from './CrmPage';
import AnalyticsPage from './AnalyticsPage';
import UserSupportTickets from './UserSupportTickets';
import ProfilePage from './ProfilePage';
import NotificationContainer, { Notification } from './Notification';
import OrderNotification from './OrderNotification';
import { OrderStatus } from '../types';
import apiService from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { logger } from '../utils/logger';
import { PATHS, appPath, appViewFromSlug, isKnownAppSlug } from '../routes/paths';

const FACEBOOK_OAUTH_ERROR_MESSAGES: Record<string, string> = {
  no_pages:
    'لا توجد صفحات فيسبوك لحسابك أو لم يُمنح التطبيق صلاحية الوصول إليها. أنشئ صفحة فيسبوك أو امنح التطبيق الصلاحية ثم أعد المحاولة.',
  oauth_failed:
    'تعذّر إتمام تسجيل الدخول إلى فيسبوك. أعد المحاولة أو راجع إعدادات التطبيق في ميتا.',
  invalid_state: 'انتهت صلاحية خطوة الربط. افتح «التكاملات» من لوحة التحكم وأعد ربط فيسبوك.',
  missing_params: 'لم يكتمل تسجيل الدخول. أعد المحاولة من صفحة التكاملات.',
  server_error: 'حدث خطأ غير متوقع أثناء ربط فيسبوك. حاول مرة أخرى لاحقاً.',
};

const INSTAGRAM_OAUTH_ERROR_MESSAGES: Record<string, string> = {
  no_business:
    'لم يعثر التطبيق على حساب إنستغرام مهني مربوط بأي صفحة فيسبوك تديرها عبر واجهة ميتا. تأكد أنك تسجّل الدخول بنفس حساب فيسبوك المدير للصفحة، وأن الربط ظاهر في إعدادات الصفحة (Instagram Management) أو تطبيق إنستغرام (الملف → إعدادات → حسابات مركزية → مشاركة مع صفحة فيسبوك). إذا كانت الصفحة ضمن Business Manager فعّل صلاحية business_management للتطبيق. إضافة الحساب في «حسابات التجريبية» وحدها لا تكفي — أعد الربط ثم جرّب مرة أخرى.',
  no_pages:
    'لا توجد صفحات فيسبوك لحسابك أو لم يُمنح التطبيق صلاحية الوصول إليها. أنشئ صفحة أو جرّب حساباً يدير صفحة فيسبوك.',
  oauth_failed:
    'تعذّر إتمام تسجيل الدخول إلى إنستغرام. أعد المحاولة أو راجع إعدادات التطبيق في ميتا.',
  invalid_state: 'انتهت صلاحية خطوة الربط. افتح «التكاملات» من لوحة التحكم وأعد ربط إنستغرام.',
  missing_params: 'لم يكتمل تسجيل الدخول. أعد المحاولة من صفحة التكاملات.',
  server_error: 'حدث خطأ غير متوقع أثناء ربط إنستغرام. حاول مرة أخرى لاحقاً.',
};

/** Resize/compress image from data URL to stay under typical proxy limit (avoids 413 on POST /upload/single) */
function compressImageForUpload(dataurl: string, filename: string, maxSize = 1200, quality = 0.82): Promise<File> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      let w = img.width;
      let h = img.height;
      if (w > maxSize || h > maxSize) {
        if (w > h) {
          h = Math.round((h * maxSize) / w);
          w = maxSize;
        } else {
          w = Math.round((w * maxSize) / h);
          h = maxSize;
        }
      }
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Canvas not supported'));
        return;
      }
      ctx.drawImage(img, 0, 0, w, h);
      canvas.toBlob(
        (blob) => {
          if (!blob) {
            reject(new Error('Failed to compress image'));
            return;
          }
          resolve(new File([blob], filename, { type: 'image/jpeg' }));
        },
        'image/jpeg',
        quality
      );
    };
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = dataurl;
  });
}

const MerchantApp: React.FC = () => {
  const { isAuthenticated, isLoading: authLoading, logout: authLogout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { viewSlug } = useParams<{ viewSlug: string }>();
  const [searchParams] = useSearchParams();
  const [isDarkMode, setIsDarkMode] = useState(false);

  const currentView = appViewFromSlug(viewSlug);
  const navigateToView = (view: AppView) => navigate(appPath(view));

  const [products, setProducts] = useState<Product[]>([]);
  const [services, setServices] = useState<Service[]>([]); 
  const [orders, setOrders] = useState<Order[]>([]);
  const [isSyncingOrders, setIsSyncingOrders] = useState(false);
  const [newOrders, setNewOrders] = useState<Order[]>([]);
  const previousOrdersRef = useRef<Set<string>>(new Set());
  
  // Loading states
  const [isLoadingProducts, setIsLoadingProducts] = useState(false);
  const [isLoadingServices, setIsLoadingServices] = useState(false);
  const [isLoadingOrders, setIsLoadingOrders] = useState(false);
  const [isLoadingSettings, setIsLoadingSettings] = useState(false);
  
  // Use a fallback for settings initialization to prevent undefined crash
  const [settings, setSettings] = useState<MerchantSettings>(DEFAULT_SETTINGS || {
    storeName: 'متجر افتراضي',
    telegramBotToken: '',
    welcomeMessage: 'أهلاً بك',
    systemPrompt: '',
    autoReplyComments: false,
    autoReplyMessenger: false,
    storeCurrency: 'USD',
    botPersona: 'friendly',
    storePolicies: {
        shippingPolicy: '',
        deliveryTime: '',
        paymentMethods: '',
        returnPolicy: '',
        additionalNotes: '',
        enableAIInjection: false
    },
    signupDate: new Date()
  });

  // Integrations State
  const [fbLinkingSessionId, setFbLinkingSessionId] = useState<string>('');
  const [fbStatus, setFbStatus] = useState<IntegrationStatus>({ isConnected: false });
  const [shopifyStatus, setShopifyStatus] = useState<IntegrationStatus>({ isConnected: false });
  const [telegramStatus, setTelegramStatus] = useState<IntegrationStatus>({ isConnected: false });
  const [whatsappStatus, setWhatsappStatus] = useState<IntegrationStatus>({ isConnected: false });

  // Notifications State
  const [notifications, setNotifications] = useState<Notification[]>([]);

  const showNotification = (message: string, type: Notification['type'] = 'success', duration?: number) => {
    const id = Math.random().toString(36).substring(2, 11);
    const newNotification: Notification = {
      id,
      message,
      type,
      duration
    };
    setNotifications(prev => [...prev, newNotification]);
  };

  const removeNotification = (id: string) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
  };

  // Helper function to extract error message
  const getErrorMessage = (error: unknown): string => {
    if (error instanceof Error) {
      return error.message;
    }
    if (typeof error === 'string') {
      return error;
    }
    if (error && typeof error === 'object' && 'message' in error) {
      return String(error.message);
    }
    return 'حدث خطأ غير متوقع';
  };

  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [isDarkMode]);


  // Integration OAuth query params (shopify / facebook / Instagram) on /app/integrations
  useEffect(() => {
    if (authLoading || !isAuthenticated) return;

    const pathname = location.pathname;
    const isIntegrationsRoute =
      pathname === appPath(AppView.INTEGRATIONS) ||
      pathname === PATHS.INTEGRATIONS_LEGACY ||
      pathname.endsWith('/integrations');
    if (!isIntegrationsRoute) return;

    const shopify = searchParams.get('shopify');
    const instagram = searchParams.get('instagram');
    const facebook = searchParams.get('facebook');
    const reason = searchParams.get('reason') || '';
    const skipped = searchParams.get('facebook_pages_skipped');
    const fbSession = searchParams.get('fb_session') || '';

    let handled = false;

    if (shopify === 'connected') {
      showNotification('تم ربط متجر Shopify بنجاح! 🎉', 'success');
      handled = true;
    } else if (facebook === 'connected') {
      if (skipped && Number(skipped) > 0) {
        showNotification(
          `تم ربط فيسبوك بنجاح، لكن تم تخطي ${skipped} صفحة لأنك وصلت لحد الباقة الحالية.`,
          'warning',
          8000
        );
      } else {
        showNotification('تم ربط صفحة فيسبوك بنجاح.', 'success');
      }
      handled = true;
    } else if (facebook === 'select_pages') {
      setFbLinkingSessionId(fbSession);
      handled = true;
    } else if (facebook === 'error') {
      const msg =
        FACEBOOK_OAUTH_ERROR_MESSAGES[reason] ||
        'تعذّر ربط فيسبوك. تحقق من إعدادات الحساب وأعد المحاولة.';
      showNotification(msg, 'error', 10000);
      handled = true;
    } else if (instagram === 'connected') {
      showNotification('تم ربط إنستغرام بنجاح.', 'success');
      handled = true;
    } else if (instagram === 'error') {
      const msg =
        INSTAGRAM_OAUTH_ERROR_MESSAGES[reason] ||
        'تعذّر ربط إنستغرام. تحقق من إعدادات الحساب وأعد المحاولة.';
      showNotification(msg, 'error', 10000);
      handled = true;
    }

    if (handled) {
      navigate(appPath(AppView.INTEGRATIONS), { replace: true });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, isAuthenticated, location.pathname, searchParams, navigate]);

  const toggleDarkMode = () => {
    setIsDarkMode(!isDarkMode);
  };

  // Load data functions
  const loadProducts = useCallback(async () => {
    try {
      setIsLoadingProducts(true);
      const response = await apiService.getProducts();
      const productsList: Product[] = response.products.map((p: any) => ({
        id: p.id,
        name: p.name,
        description: p.description || '',
        price: p.price,
        currency: p.currency,
        category: p.category || '',
        stock: p.stock,
        sizes: p.sizes || [],
        colors: p.colors || [],
        imageUrl: p.imageUrl || '',
        images: p.images || (p.imageUrl ? [p.imageUrl] : []),
        imageColors: p.imageColors || [],
        externalId: p.externalId || undefined,
      }));
      setProducts(productsList);
    } catch (error: unknown) {
      logger.error('Failed to load products:', error);
      showNotification('فشل تحميل المنتجات', 'error');
    } finally {
      setIsLoadingProducts(false);
    }
  }, [showNotification]);

  const loadServices = useCallback(async () => {
    try {
      setIsLoadingServices(true);
      const response = await apiService.getServices();
      const servicesList: Service[] = response.services.map((s: any) => ({
        id: s.id,
        name: s.name,
        category: s.category || '',
        type: s.type || '',
        shortDescription: s.shortDescription || '',
        fullDescription: s.fullDescription || '',
        priceLabel: s.priceLabel || '',
        pricingType: s.pricingType || 'fixed',
        duration: s.duration || '',
        deliveryTime: s.deliveryTime || '',
        includedItems: s.includedItems || [],
        requirements: s.requirements || [],
        previousWorkTemplates: s.previousWorkTemplates || [],
        bookingLink: s.bookingLink || '',
        contactChannel: s.contactChannel || '',
      }));
      setServices(servicesList);
    } catch (error: unknown) {
      logger.error('Failed to load services:', error);
      showNotification('فشل تحميل الخدمات', 'error');
    } finally {
      setIsLoadingServices(false);
    }
  }, [showNotification]);

  const loadOrders = useCallback(async () => {
    try {
      setIsLoadingOrders(true);
      const response = await apiService.getOrders();
      const ordersList: Order[] = response.orders.map((o: any) => {
        // Ensure viewedAt is properly handled - it might be null, undefined, or a timestamp string
        const viewedAt = o.viewedAt && o.viewedAt !== null && o.viewedAt !== '' ? o.viewedAt : null;
        return {
          id: o.id,
          externalId: o.externalId || null,
          customerName: o.customerName,
          customerEmail: o.customerEmail || '',
          customerPhone: o.customerPhone || '',
          customerAddress: o.customerAddress || '',
          total: o.total,
          currency: o.currency,
          status: o.status as OrderStatus,
          items: o.items.map((item: any) => ({
            productId: item.productId || '',
            productName: item.productName,
            quantity: item.quantity,
            price: item.price,
            currency: item.currency || o.currency,
          })),
          date: new Date(o.date || o.createdAt || Date.now()),
          notes: o.notes || '',
          source: o.source || 'manual',
          viewedAt: viewedAt,
        };
      });
      setOrders(ordersList);
    } catch (error: unknown) {
      logger.error('Failed to load orders:', error);
      showNotification('فشل تحميل الطلبات', 'error');
    } finally {
      setIsLoadingOrders(false);
    }
  }, [showNotification]);

  const loadSettings = useCallback(async () => {
    try {
      setIsLoadingSettings(true);
      const response = await apiService.getSettings();
      const settingsData: MerchantSettings = {
        storeName: response.settings.storeName || '',
        telegramBotToken: response.settings.telegramBotToken || '',
        welcomeMessage: response.settings.welcomeMessage || '',
        systemPrompt: response.settings.systemPrompt || '',
        autoReplyComments: response.settings.autoReplyComments || false,
        autoReplyMessenger: response.settings.autoReplyMessenger || false,
        storeCurrency: response.settings.storeCurrency || 'USD',
        botPersona: (response.settings.botPersona || 'friendly') as BotPersona,
        storePolicies: {
          shippingPolicy: response.settings.storePolicies?.shippingPolicy || '',
          deliveryTime: response.settings.storePolicies?.deliveryTime || '',
          paymentMethods: response.settings.storePolicies?.paymentMethods || '',
          returnPolicy: response.settings.storePolicies?.returnPolicy || '',
          additionalNotes: response.settings.storePolicies?.additionalNotes || '',
          enableAIInjection: response.settings.storePolicies?.enableAIInjection ?? false,
        },
        signupDate: new Date(response.settings.signupDate || Date.now()),
      };
      setSettings(settingsData);
    } catch (error: unknown) {
      logger.error('Failed to load settings:', error);
      // Don't show error notification for settings as it might not exist yet
    } finally {
      setIsLoadingSettings(false);
    }
  }, []);

  const loadIntegrations = useCallback(async () => {
    try {
      const integrations = await apiService.getIntegrations();
      
      if (integrations.facebook) {
        setFbStatus({
          isConnected: integrations.facebook.isConnected || false,
          accountName: integrations.facebook.accountName,
          platformId: integrations.facebook.platformId,
          lastSync: integrations.facebook.lastSync ? new Date(integrations.facebook.lastSync) : undefined
        });
      }
      
      if (integrations.shopify) {
        setShopifyStatus({
          isConnected: integrations.shopify.isConnected || false,
          accountName: integrations.shopify.accountName || '',
          lastSync: integrations.shopify.lastSync ? new Date(integrations.shopify.lastSync) : undefined
        });
      }
      
      if ((integrations as any).telegram) {
        setTelegramStatus({
          isConnected: (integrations as any).telegram.isConnected || false,
          accountName: (integrations as any).telegram.accountName || '',
          platformId: (integrations as any).telegram.botId?.toString() || '',
        });
      }
      
      if ((integrations as any).whatsapp) {
        setWhatsappStatus({
          isConnected: (integrations as any).whatsapp.isConnected || false,
          accountName: (integrations as any).whatsapp.accountName || '',
          platformId: (integrations as any).whatsapp.platformId || '',
          lastSync: (integrations as any).whatsapp.lastSync ? new Date((integrations as any).whatsapp.lastSync) : undefined
        });
      }
    } catch (error: unknown) {
      logger.error('Failed to load integrations:', error);
      // Don't show error notification - integrations might not be set up yet
    }
  }, []);

  useEffect(() => {
    if (isAuthenticated) {
      loadProducts();
      loadServices();
      loadOrders();
      loadSettings();
      loadIntegrations();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated]);

  const handleLogout = () => {
    authLogout();
    setProducts([]);
    setServices([]);
    setOrders([]);
    setNewOrders([]);
    previousOrdersRef.current = new Set();
    setFbLinkingSessionId('');
    setFbStatus({ isConnected: false });
    setShopifyStatus({ isConnected: false });
    setTelegramStatus({ isConnected: false });
    setWhatsappStatus({ isConnected: false });
    setIsDarkMode(false);
    navigate(PATHS.HOME);
  };

  // Product Handlers
  const resolveProductImagesWithColors = async (
    product: Product
  ): Promise<{ images: string[]; imageColors: (string | null)[] }> => {
    const raw =
      product.images && product.images.length > 0
        ? product.images
        : product.imageUrl
          ? [product.imageUrl]
          : [];
    const sourceColors = product.imageColors || [];

    const images: string[] = [];
    const imageColors: (string | null)[] = [];
    for (let i = 0; i < raw.length; i++) {
      const src = raw[i];
      const color = sourceColors[i]?.trim() ? sourceColors[i]!.trim() : null;
      if (src.startsWith('data:')) {
        const file = await compressImageForUpload(src, `product-image-${i + 1}.jpg`);
        const uploadRes = await apiService.uploadFile(file);
        const url = uploadRes.file?.url ?? uploadRes.file?.path;
        if (url) {
          images.push(url);
          imageColors.push(color);
        }
      } else if (src.trim()) {
        images.push(src.trim());
        imageColors.push(color);
      }
    }
    return { images, imageColors };
  };

  const handleAddProduct = async (newProduct: Product) => {
    try {
      setIsLoadingProducts(true);
      const { images, imageColors } = await resolveProductImagesWithColors(newProduct);
      const imageUrlToSend = images[0] || undefined;
      const response = await apiService.createProduct({
        name: newProduct.name,
        description: newProduct.description || undefined,
        price: newProduct.price,
        currency: newProduct.currency || 'USD',
        category: newProduct.category || undefined,
        stock: newProduct.stock || 0,
        sizes: newProduct.sizes || [],
        colors: newProduct.colors || [],
        imageUrl: imageUrlToSend,
        images,
        imageColors,
        source: 'manual',
      });
      
      // Convert API response to Product type
      const product: Product = {
        id: response.product.id,
        name: response.product.name,
        description: response.product.description || '',
        price: response.product.price,
        currency: response.product.currency,
        category: response.product.category || '',
        stock: response.product.stock,
        sizes: response.product.sizes || [],
        colors: response.product.colors || [],
        imageUrl: response.product.imageUrl || '',
        images: response.product.images || (response.product.imageUrl ? [response.product.imageUrl] : []),
        imageColors: response.product.imageColors || [],
        externalId: response.product.externalId || undefined,
      };
      
      setProducts([...products, product]);
      showNotification('تم إضافة المنتج بنجاح', 'success');
    } catch (error: unknown) {
      showNotification(getErrorMessage(error) || 'فشل إضافة المنتج', 'error');
    } finally {
      setIsLoadingProducts(false);
    }
  };
  
  const handleUpdateProduct = async (updatedProduct: Product) => {
    try {
      setIsLoadingProducts(true);
      const { images, imageColors } = await resolveProductImagesWithColors(updatedProduct);
      const imageUrlToSend = images[0] || '';
      const response = await apiService.updateProduct(updatedProduct.id, {
        name: updatedProduct.name,
        description: updatedProduct.description,
        price: updatedProduct.price,
        currency: updatedProduct.currency,
        category: updatedProduct.category,
        stock: updatedProduct.stock,
        sizes: updatedProduct.sizes,
        colors: updatedProduct.colors,
        imageUrl: imageUrlToSend,
        images,
        imageColors,
      });
      
      // Convert API response to Product type
      const product: Product = {
        id: response.product.id,
        name: response.product.name,
        description: response.product.description || '',
        price: response.product.price,
        currency: response.product.currency,
        category: response.product.category || '',
        stock: response.product.stock,
        sizes: response.product.sizes || [],
        colors: response.product.colors || [],
        imageUrl: response.product.imageUrl || '',
        images: response.product.images || (response.product.imageUrl ? [response.product.imageUrl] : []),
        imageColors: response.product.imageColors || [],
        externalId: response.product.externalId || undefined,
      };
      
      setProducts(products.map(p => p.id === product.id ? product : p));
      showNotification('تم حفظ التعديلات بنجاح', 'success');
    } catch (error: unknown) {
      showNotification(getErrorMessage(error) || 'فشل تحديث المنتج', 'error');
    } finally {
      setIsLoadingProducts(false);
    }
  };
  
  const handleDeleteProduct = async (id: string) => {
    try {
      setIsLoadingProducts(true);
      await apiService.deleteProduct(id);
      setProducts(products.filter(p => p.id !== id));
      showNotification('تم حذف المنتج بنجاح', 'success');
    } catch (error: unknown) {
      showNotification(getErrorMessage(error) || 'فشل حذف المنتج', 'error');
    } finally {
      setIsLoadingProducts(false);
    }
  };
  
  const handleSyncProducts = async (syncedProducts: Product[]) => {
    try {
      setIsLoadingProducts(true);
      // Add synced products via API
      for (const product of syncedProducts) {
        try {
          await apiService.createProduct({
            name: product.name,
            description: product.description || undefined,
            price: product.price,
            currency: product.currency || 'USD',
            category: product.category || undefined,
            stock: product.stock || 0,
            sizes: product.sizes || [],
            imageUrl: product.imageUrl || undefined,
            source: 'shopify',
            externalId: product.externalId,
          });
        } catch (error) {
          // Skip if product already exists
          logger.error('Failed to sync product:', product.name);
        }
      }
      
      // Reload products
      await loadProducts();
      showNotification(`تم مزامنة ${syncedProducts.length} منتج`, 'success');
    } catch (error: unknown) {
      showNotification(getErrorMessage(error) || 'فشل مزامنة المنتجات', 'error');
    } finally {
      setIsLoadingProducts(false);
    }
  };

  // Service Handlers
  const handleAddService = async (newService: Service) => {
    try {
      setIsLoadingServices(true);
      const response = await apiService.createService({
        name: newService.name,
        category: newService.category || undefined,
        type: newService.type || undefined,
        shortDescription: newService.shortDescription || '',
        fullDescription: newService.fullDescription || undefined,
        priceLabel: newService.priceLabel || '',
        pricingType: newService.pricingType || 'fixed',
        duration: newService.duration || undefined,
        deliveryTime: newService.deliveryTime || undefined,
        includedItems: newService.includedItems || [],
        requirements: newService.requirements || [],
        previousWorkTemplates: newService.previousWorkTemplates || [],
        bookingLink: newService.bookingLink || undefined,
        contactChannel: newService.contactChannel || undefined,
      });
      
      // Convert API response to Service type
      const service: Service = {
        id: response.service.id,
        name: response.service.name,
        category: response.service.category || '',
        type: response.service.type || '',
        shortDescription: response.service.shortDescription || '',
        fullDescription: response.service.fullDescription || '',
        priceLabel: response.service.priceLabel || '',
        pricingType: response.service.pricingType || 'fixed',
        duration: response.service.duration || '',
        deliveryTime: response.service.deliveryTime || '',
        includedItems: response.service.includedItems || [],
        requirements: response.service.requirements || [],
        previousWorkTemplates: response.service.previousWorkTemplates || [],
        bookingLink: response.service.bookingLink || '',
        contactChannel: response.service.contactChannel || '',
      };
      
      setServices([...services, service]);
      showNotification('تم إضافة الخدمة بنجاح', 'success');
    } catch (error: unknown) {
      showNotification(getErrorMessage(error) || 'فشل إضافة الخدمة', 'error');
    } finally {
      setIsLoadingServices(false);
    }
  };
  
  const handleUpdateService = async (updatedService: Service) => {
    try {
      setIsLoadingServices(true);
      const response = await apiService.updateService(updatedService.id, {
        name: updatedService.name,
        category: updatedService.category || undefined,
        type: updatedService.type || undefined,
        shortDescription: updatedService.shortDescription || '',
        fullDescription: updatedService.fullDescription || undefined,
        priceLabel: updatedService.priceLabel || '',
        pricingType: updatedService.pricingType || 'fixed',
        duration: updatedService.duration || undefined,
        deliveryTime: updatedService.deliveryTime || undefined,
        includedItems: updatedService.includedItems || [],
        requirements: updatedService.requirements || [],
        previousWorkTemplates: updatedService.previousWorkTemplates || [],
        bookingLink: updatedService.bookingLink || undefined,
        contactChannel: updatedService.contactChannel || undefined,
      });
      
      // Convert API response to Service type
      const service: Service = {
        id: response.service.id,
        name: response.service.name,
        category: response.service.category || '',
        type: response.service.type || '',
        shortDescription: response.service.shortDescription || '',
        fullDescription: response.service.fullDescription || '',
        priceLabel: response.service.priceLabel || '',
        pricingType: response.service.pricingType || 'fixed',
        duration: response.service.duration || '',
        deliveryTime: response.service.deliveryTime || '',
        includedItems: response.service.includedItems || [],
        requirements: response.service.requirements || [],
        previousWorkTemplates: response.service.previousWorkTemplates || [],
        bookingLink: response.service.bookingLink || '',
        contactChannel: response.service.contactChannel || '',
      };
      
      setServices(services.map(s => s.id === service.id ? service : s));
      showNotification('تم حفظ التعديلات بنجاح', 'success');
    } catch (error: unknown) {
      showNotification(getErrorMessage(error) || 'فشل تحديث الخدمة', 'error');
    } finally {
      setIsLoadingServices(false);
    }
  };
  
  const handleDeleteService = async (id: string) => {
    try {
      setIsLoadingServices(true);
      await apiService.deleteService(id);
      setServices(services.filter(s => s.id !== id));
      showNotification('تم حذف الخدمة بنجاح', 'success');
    } catch (error: unknown) {
      showNotification(getErrorMessage(error) || 'فشل حذف الخدمة', 'error');
    } finally {
      setIsLoadingServices(false);
    }
  };

  // Order Handlers
  const handleSyncOrders = async () => {
    setIsSyncingOrders(true);
    try {
      // Reload orders from API
      await loadOrders();
      showNotification('تم مزامنة الطلبات بنجاح', 'success');
    } catch (error: unknown) {
      showNotification(getErrorMessage(error) || 'فشل مزامنة الطلبات', 'error');
    } finally {
      setIsSyncingOrders(false);
    }
  };

  const handleAddOrder = async (newOrder: Order) => {
    try {
      setIsLoadingOrders(true);
      const response = await apiService.createOrder({
        customerName: newOrder.customerName,
        customerEmail: newOrder.customerEmail || undefined,
        customerPhone: newOrder.customerPhone || undefined,
        customerAddress: newOrder.customerAddress || undefined,
        total: newOrder.total,
        currency: newOrder.currency || 'USD',
        status: newOrder.status || 'pending',
        source: 'manual',
        items: newOrder.items.map(item => ({
          productId: item.productId || undefined,
          productName: item.productName,
          quantity: item.quantity,
          price: item.price,
          currency: item.currency || 'USD',
        })),
        notes: newOrder.notes || undefined,
      });
      
      // Convert API response to Order type
      const order: Order = {
        id: response.order.id,
        externalId: response.order.externalId || null,
        customerName: response.order.customerName,
        customerEmail: response.order.customerEmail || '',
        customerPhone: response.order.customerPhone || '',
        customerAddress: response.order.customerAddress || '',
        total: response.order.total,
        currency: response.order.currency,
        status: response.order.status as OrderStatus,
        items: response.order.items.map((item: any) => ({
          productId: item.productId || '',
          productName: item.productName,
          quantity: item.quantity,
          price: item.price,
          currency: item.currency || response.order.currency,
        })),
        date: new Date(response.order.date || response.order.createdAt || Date.now()),
        notes: response.order.notes || '',
        source: (response.order.source || 'manual') as 'manual' | 'shopify',
      };
      
      setOrders(prevOrders => [order, ...prevOrders]);
      // Only add to newOrders if it hasn't been viewed (new orders won't have viewedAt)
      if (!order.viewedAt) {
        setNewOrders(prev => {
          if (!prev.find(o => o.id === order.id)) {
            return [order, ...prev];
          }
          return prev;
        });
        showNotification('تم إضافة طلب جديد', 'success');
      }
      previousOrdersRef.current.add(order.id);
    } catch (error: unknown) {
      showNotification(getErrorMessage(error) || 'فشل إضافة الطلب', 'error');
    } finally {
      setIsLoadingOrders(false);
    }
  };

  // Track new orders when orders array changes
  // New orders are those that don't have viewedAt set (viewedAt is null or undefined)
  useEffect(() => {
    // Filter orders that haven't been viewed
    // viewedAt is null/undefined/empty string means order hasn't been viewed
    const unviewedOrders = orders.filter(order => {
      const viewedAt = order.viewedAt;
      // Order is unviewed if viewedAt is null, undefined, or empty string
      const isUnviewed = viewedAt === null || viewedAt === undefined || viewedAt === '';
      return isUnviewed;
    });
    
    // Simply set newOrders to unviewed orders
    // This ensures that when page refreshes, only unviewed orders are marked as new
    setNewOrders(unviewedOrders);
  }, [orders]);

  const handleUpdateOrderStatus = async (orderId: string, newStatus: OrderStatus) => {
    try {
      setIsLoadingOrders(true);
      await apiService.updateOrderStatus(orderId, newStatus);
      
      setOrders(prevOrders => 
        prevOrders.map(order => 
          order.id === orderId ? { ...order, status: newStatus } : order
        )
      );
      setNewOrders(prev => 
        prev.map(order => 
          order.id === orderId ? { ...order, status: newStatus } : order
        )
      );
      showNotification('تم تحديث حالة الطلب بنجاح', 'success');
    } catch (error: unknown) {
      showNotification(getErrorMessage(error) || 'فشل تحديث حالة الطلب', 'error');
    } finally {
      setIsLoadingOrders(false);
    }
  };

  const handleDeleteOrder = async (orderId: string) => {
    try {
      setIsLoadingOrders(true);
      await apiService.deleteOrder(orderId);
      
      setOrders(prevOrders => prevOrders.filter(order => order.id !== orderId));
      setNewOrders(prev => prev.filter(order => order.id !== orderId));
      showNotification('تم حذف الطلب بنجاح', 'success');
    } catch (error: unknown) {
      logger.error('Failed to delete order:', error);
      showNotification(getErrorMessage(error) || 'فشل حذف الطلب', 'error');
    } finally {
      setIsLoadingOrders(false);
    }
  };

  const handleDismissNewOrders = () => {
    // Mark all current new orders as seen
    newOrders.forEach(order => previousOrdersRef.current.add(order.id));
    setNewOrders([]);
  };

  const handleOrderViewed = async (orderId: string) => {
    try {
      // Mark order as viewed in the backend
      const response = await apiService.markOrderAsViewed(orderId);
      const viewedAtTimestamp = response.order?.viewedAt || new Date().toISOString();
      
      // Update local state with the timestamp from server
      setOrders(prevOrders => 
        prevOrders.map(order => 
          order.id === orderId ? { ...order, viewedAt: viewedAtTimestamp } : order
        )
      );
      
      // Remove from new orders
      setNewOrders(prev => prev.filter(order => order.id !== orderId));
      previousOrdersRef.current.add(orderId);
    } catch (error: unknown) {
      logger.error('Failed to mark order as viewed:', error);
      // Still update local state even if API call fails
      const viewedAtTimestamp = new Date().toISOString();
      setOrders(prevOrders => 
        prevOrders.map(order => 
          order.id === orderId ? { ...order, viewedAt: viewedAtTimestamp } : order
        )
      );
      setNewOrders(prev => prev.filter(order => order.id !== orderId));
      previousOrdersRef.current.add(orderId);
    }
  };

  const handleViewOrders = () => {
    navigateToView(AppView.ORDERS);
    setNewOrders([]);
  };

  const handleNewQuery = () => {
    // Query count is now tracked in the database and fetched from API
    // This function is kept for compatibility with BotPlayground
  };

  const renderContent = () => {
    switch (currentView) {
      case AppView.DASHBOARD:
        return <DashboardStats products={products} />;
      case AppView.PRODUCTS:
        return (
          <ProductManager 
            products={products} 
            onAddProduct={handleAddProduct} 
            onUpdateProduct={handleUpdateProduct}
            onDeleteProduct={handleDeleteProduct}
            storeCurrency={settings?.storeCurrency || 'USD'}
          />
        );
      case AppView.SERVICES:
        return (
          <div className="flex flex-col items-center justify-center min-h-[50vh] animate-fade-in px-4 text-center">
            <div className="max-w-md rounded-2xl border border-dashed border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-800/50 p-10">
              <h2 className="text-xl font-bold text-gray-800 dark:text-white mb-2">الخدمات</h2>
              <p className="text-gray-600 dark:text-gray-400 text-sm mb-6">
                هذا القسم غير متاح حالياً وسيُفعَّل في تحديث قادم.
              </p>
              <span className="inline-block text-sm font-bold px-4 py-2 rounded-full bg-red-600 text-white shadow-md animate-blink">
                قريباً
              </span>
            </div>
          </div>
        );
      case AppView.SERVICE_BOT:
        return (
          <div className="flex flex-col items-center justify-center min-h-[50vh] animate-fade-in px-4 text-center">
            <div className="max-w-md rounded-2xl border border-dashed border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-800/50 p-10">
              <h2 className="text-xl font-bold text-gray-800 dark:text-white mb-2">بوت الخدمات</h2>
              <p className="text-gray-600 dark:text-gray-400 text-sm mb-6">
                هذا القسم غير متاح حالياً وسيُفعَّل في تحديث قادم.
              </p>
              <span className="inline-block text-sm font-bold px-4 py-2 rounded-full bg-red-600 text-white shadow-md animate-blink">
                قريباً
              </span>
            </div>
          </div>
        );
      case AppView.ORDERS:
        return (
          <OrderManager 
            orders={orders}
            storeCurrency={settings?.storeCurrency || 'USD'}
            onUpdateOrderStatus={handleUpdateOrderStatus}
            onDeleteOrder={handleDeleteOrder}
            onOrderViewed={handleOrderViewed}
          />
        );
      case AppView.IMAGE_STUDIO: 
        return <ImageStudio />;
      case AppView.CHAT_TEST:
        return (
          <ErrorBoundary>
          <BotPlayground 
            products={products}
            services={services} // ✅ Pass services to bot
            settings={settings}
            onNewQuery={handleNewQuery}
            onAddOrder={handleAddOrder}
          />
          </ErrorBoundary>
        );
      case AppView.INTEGRATIONS:
        return (
          <IntegrationsPanel 
             settings={settings}
             onUpdateSettings={async (newSettings) => {
               try {
                 setIsLoadingSettings(true);
                 await apiService.updateSettings({
                   storeName: newSettings.storeName,
                   telegramBotToken: newSettings.telegramBotToken,
                   welcomeMessage: newSettings.welcomeMessage,
                   systemPrompt: newSettings.systemPrompt,
                   autoReplyComments: newSettings.autoReplyComments,
                   autoReplyMessenger: newSettings.autoReplyMessenger,
                   storeCurrency: newSettings.storeCurrency,
                   botPersona: newSettings.botPersona,
                   shippingPolicy: newSettings.storePolicies?.shippingPolicy || '',
                   deliveryTime: newSettings.storePolicies?.deliveryTime || '',
                   paymentMethods: newSettings.storePolicies?.paymentMethods || '',
                   returnPolicy: newSettings.storePolicies?.returnPolicy || '',
                   additionalNotes: newSettings.storePolicies?.additionalNotes || '',
                   enableAIInjection: newSettings.storePolicies?.enableAIInjection !== undefined 
                     ? newSettings.storePolicies.enableAIInjection 
                     : false,
                 });
                 setSettings(newSettings);
                 showNotification('تم حفظ التعديلات بنجاح', 'success');
               } catch (error: unknown) {
                 showNotification(getErrorMessage(error) || 'فشل حفظ التعديلات', 'error');
               } finally {
                 setIsLoadingSettings(false);
               }
             }}
             onSyncProducts={handleSyncProducts}
             onSyncOrders={handleSyncOrders}
             fbStatus={fbStatus}
             setFbStatus={setFbStatus}
             fbLinkingSessionId={fbLinkingSessionId}
             setFbLinkingSessionId={setFbLinkingSessionId}
             shopifyStatus={shopifyStatus}
             setShopifyStatus={setShopifyStatus}
             telegramStatus={telegramStatus}
             setTelegramStatus={setTelegramStatus}
             whatsappStatus={whatsappStatus}
             setWhatsappStatus={setWhatsappStatus}
             showNotification={showNotification}
          />
        );
      case AppView.SOCIAL_AUTOMATION:
        return (
          <SocialAutomationPage
            settings={settings}
            onUpdateSettings={async (newSettings) => {
              try {
                setIsLoadingSettings(true);
                await apiService.updateSettings({
                  storeName: newSettings.storeName,
                  telegramBotToken: newSettings.telegramBotToken,
                  welcomeMessage: newSettings.welcomeMessage,
                  systemPrompt: newSettings.systemPrompt,
                  autoReplyComments: newSettings.autoReplyComments,
                  autoReplyMessenger: newSettings.autoReplyMessenger,
                  storeCurrency: newSettings.storeCurrency,
                  botPersona: newSettings.botPersona,
                  shippingPolicy: newSettings.storePolicies?.shippingPolicy || '',
                  deliveryTime: newSettings.storePolicies?.deliveryTime || '',
                  paymentMethods: newSettings.storePolicies?.paymentMethods || '',
                  returnPolicy: newSettings.storePolicies?.returnPolicy || '',
                  additionalNotes: newSettings.storePolicies?.additionalNotes || '',
                  enableAIInjection:
                    newSettings.storePolicies?.enableAIInjection !== undefined
                      ? newSettings.storePolicies.enableAIInjection
                      : false
                });
                setSettings(newSettings);
                showNotification('تم حفظ التعديلات بنجاح', 'success');
              } catch (error: unknown) {
                showNotification(getErrorMessage(error) || 'فشل حفظ التعديلات', 'error');
              } finally {
                setIsLoadingSettings(false);
              }
            }}
            showNotification={showNotification}
            onGoToIntegrations={() => navigateToView(AppView.INTEGRATIONS)}
          />
        );
      case AppView.AFFILIATE: 
        return (
          <AffiliateDashboard settings={settings} />
        );
      case AppView.NOTIFICATIONS:
        return <UserNotifications />;
      case AppView.CRM:
        return <CrmPage storeCurrency={settings?.storeCurrency || 'USD'} />;
      case AppView.ANALYTICS:
        return <AnalyticsPage storeCurrency={settings?.storeCurrency || 'USD'} />;
      case AppView.SUPPORT_TICKETS:
        return <UserSupportTickets />;
      case AppView.PROFILE:
        return <ProfilePage showNotification={showNotification} />;
      case AppView.SETTINGS:
        return (
          <SettingsPanel 
            settings={settings} 
            onUpdateSettings={async (newSettings) => {
              try {
                setIsLoadingSettings(true);
                await apiService.updateSettings({
                  storeName: newSettings.storeName,
                  telegramBotToken: newSettings.telegramBotToken,
                  systemPrompt: newSettings.systemPrompt,
                  autoReplyComments: newSettings.autoReplyComments,
                  autoReplyMessenger: newSettings.autoReplyMessenger,
                  storeCurrency: newSettings.storeCurrency,
                  botPersona: newSettings.botPersona,
                  shippingPolicy: newSettings.storePolicies?.shippingPolicy || '',
                  deliveryTime: newSettings.storePolicies?.deliveryTime || '',
                  paymentMethods: newSettings.storePolicies?.paymentMethods || '',
                  returnPolicy: newSettings.storePolicies?.returnPolicy || '',
                  additionalNotes: newSettings.storePolicies?.additionalNotes || '',
                  enableAIInjection: newSettings.storePolicies?.enableAIInjection !== undefined 
                    ? newSettings.storePolicies.enableAIInjection 
                    : false,
                });
                setSettings(newSettings);
                showNotification('تم حفظ التعديلات بنجاح', 'success');
              } catch (error: unknown) {
                showNotification(getErrorMessage(error) || 'فشل حفظ التعديلات', 'error');
              } finally {
                setIsLoadingSettings(false);
              }
            }} 
          />
        );
      default:
        return <DashboardStats products={products} />;
    }
  };


  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mx-auto"></div>
          <p className="mt-4 text-gray-600 dark:text-gray-400">جاري التحميل...</p>
        </div>
      </div>
    );
  }

  if (viewSlug && !isKnownAppSlug(viewSlug)) {
    return <Navigate to={appPath(AppView.DASHBOARD)} replace />;
  }

  return (
    <>
      <div className={isDarkMode ? 'dark' : ''}>
        <Layout 
          currentView={currentView} 
          onChangeView={navigateToView}
          isDarkMode={isDarkMode}
          toggleDarkMode={toggleDarkMode}
          onLogout={handleLogout}
          newOrdersCount={newOrders.length}
        >
          {renderContent()}
        </Layout>
      </div>
      
      <OnboardingWizard 
        onNavigate={navigateToView} 
        onComplete={() => {}} 
      />

      <NotificationContainer 
        notifications={notifications}
        onClose={removeNotification}
      />

      <OrderNotification
        newOrders={newOrders}
        onViewOrders={handleViewOrders}
        onUpdateOrderStatus={handleUpdateOrderStatus}
        onDismiss={handleDismissNewOrders}
        onOrderViewed={handleOrderViewed}
      />
    </>
  );
};


export default MerchantApp;