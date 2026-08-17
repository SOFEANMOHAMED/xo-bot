import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import session from 'express-session';
import passport from 'passport';
import { errorHandler } from './middleware/errorHandler.js';
import { rateLimiter } from './middleware/rateLimiter.js';
import { logger } from './utils/logger.js';
import './config/passport.js'; // Initialize passport
import authRoutes from './routes/auth.routes.js';
import productRoutes from './routes/product.routes.js';
import orderRoutes from './routes/order.routes.js';
import serviceRoutes from './routes/service.routes.js';
import settingsRoutes from './routes/settings.routes.js';
import integrationRoutes from './routes/integration.routes.js';
import adminRoutes from './routes/admin.routes.js';
import affiliateRoutes from './routes/affiliate.routes.js';
import webhookRoutes from './routes/webhook.routes.js';
import conversationRoutes from './routes/conversation.routes.js';
import aiRoutes from './routes/ai.routes.js';
import uploadRoutes from './routes/upload.routes.js';
import billingRoutes from './routes/billing.routes.js';
import notificationRoutes from './routes/notification.routes.js';
import crmRoutes from './routes/crm.routes.js';
import analyticsRoutes from './routes/analytics.routes.js';
import whatsappRoutes from './routes/whatsapp.routes.js';
import pagesRoutes from './routes/pages.routes.js';
import supportRoutes from './routes/support.routes.js';
import { autoReenableBot } from './controllers/conversation.controller.js';
import pool from './database/connection.js';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const swaggerUi = require('swagger-ui-express');
import { swaggerSpec } from './config/swagger.js';
import { initializeTools } from './services/tools/index.js';
import { startSyncScheduler } from './services/syncScheduler.js';
import { startAbandonedCheckoutScheduler } from './services/abandonedCheckout/index.js';
import { startContentPublishingScheduler } from './services/contentPublishing/index.js';
import { startLifecycleEmailsScheduler } from './services/lifecycleEmails/index.js';
import contentPublishingRoutes from './routes/contentPublishing.routes.js';
import { startInboxRealtime, stopInboxRealtime } from './services/inbox/inboxRealtime.js';
import {
  ensureWhatsAppWebSessionsSchema,
  restoreConnectedWhatsAppSessions,
  shutdownWhatsAppWebSessions
} from './services/whatsappWeb/index.js';

const app = express();
const PORT = process.env.PORT || 3001;

// So req.ip reflects client IP when behind a reverse proxy (affiliate click tracking, rate limits)
app.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS) || 1);

// Security Middleware
// Configure Helmet but exclude image routes
const helmetConfig = {
  crossOriginResourcePolicy: { policy: "cross-origin" as const },
  crossOriginEmbedderPolicy: false,
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      baseUri: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
      formAction: ["'self'"],
      // Scripts: same-origin only (no CDNs, no inline/eval)
      scriptSrc: ["'self'"],
      scriptSrcAttr: ["'none'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      workerSrc: ["'self'"],
      manifestSrc: ["'self'"],
    }
  }
};

// Apply Helmet to all routes except image routes
app.use((req, res, next) => {
  if (req.path.startsWith('/api/products/') && req.path.endsWith('/image')) {
    // Skip Helmet for image routes
    return next();
  }
  return helmet(helmetConfig)(req, res, next);
});

app.use(cors({
  origin: (origin, callback) => {
    const raw = process.env.CORS_ORIGIN || 'https://xo-bot.com';
    const allowed = raw.split(',').map((s) => s.trim()).filter(Boolean);
    // Allow non-browser clients (no Origin) and exact allowlist matches
    if (!origin || allowed.includes(origin)) {
      return callback(null, true);
    }
    return callback(null, false);
  },
  credentials: true
}));

// Default JSON body limit is small; large payloads only on known heavy routes
const attachRawBody = (req: any, _res: any, buf: Buffer) => {
  req.rawBody = buf;
};
const jsonSmall = express.json({ limit: '1mb', verify: attachRawBody });
const jsonLarge = express.json({ limit: '50mb', verify: attachRawBody });
app.use((req, res, next) => {
  const p = req.path || '';
  const needsLarge =
    p.startsWith('/api/products') ||
    p.startsWith('/api/upload') ||
    p.startsWith('/api/ai/marketing') ||
    p.startsWith('/api/settings') ||
    p.startsWith('/webhooks');
  return (needsLarge ? jsonLarge : jsonSmall)(req, res, next);
});
app.use((req, res, next) => {
  const p = req.path || '';
  const needsLarge =
    p.startsWith('/api/products') ||
    p.startsWith('/api/upload') ||
    p.startsWith('/api/ai/marketing') ||
    p.startsWith('/api/settings') ||
    p.startsWith('/webhooks');
  return express.urlencoded({ extended: true, limit: needsLarge ? '50mb' : '1mb' })(req, res, next);
});

// Session Configuration (for OAuth)
const sessionSecret = process.env.SESSION_SECRET || process.env.JWT_SECRET;
if (!sessionSecret) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('SESSION_SECRET or JWT_SECRET is required in production');
  }
  logger.warn('SESSION_SECRET/JWT_SECRET missing — using insecure dev session secret');
}
app.use(session({
  secret: sessionSecret || 'dev-only-insecure-session-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production', // HTTPS only in production
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

// Passport Middleware
app.use(passport.initialize());
app.use(passport.session());

// Compression & Logging (skip SSE stream — must not buffer)
app.use(
  compression({
    filter: (req, res) => {
      if (req.path.includes('/conversations/stream')) return false;
      if (req.path.includes('/whatsapp/web/events')) return false;
      return compression.filter(req, res);
    },
  })
);
app.use(morgan('combined'));

// Rate Limiting
app.use('/api/', rateLimiter);

async function checkDatabaseHealth(): Promise<boolean> {
  try {
    const client = await pool.connect();
    await client.query('SELECT 1');
    client.release();
    return true;
  } catch {
    return false;
  }
}

// Health Check
app.get('/health', async (req, res) => {
  const dbOk = await checkDatabaseHealth();
  res.status(dbOk ? 200 : 503).json({
    status: dbOk ? 'ok' : 'degraded',
    db: dbOk ? 'connected' : 'disconnected',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// Health Check (API endpoint)
app.get('/api/health', async (req, res) => {
  const dbOk = await checkDatabaseHealth();
  res.status(dbOk ? 200 : 503).json({
    status: dbOk ? 'ok' : 'degraded',
    db: dbOk ? 'connected' : 'disconnected',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// API Documentation (Swagger)
if (process.env.NODE_ENV !== 'production') {
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
    customCss: '.swagger-ui .topbar { display: none }',
    customSiteTitle: 'Al-Musaid API Documentation'
  }));
}

// Request logging middleware (skip for webhooks to avoid noise)
app.use((req, res, next) => {
  if (!req.path.startsWith('/webhooks')) {
    logger.info(`${req.method} ${req.path}`, {
      ip: req.ip,
      userAgent: req.get('user-agent')
    });
  }
  next();
});

// Public API Routes (no authentication required)
// Product images endpoint - must be before authenticated routes
app.get('/api/products/:productId/image', (req, res, next) => {
  // Remove Helmet's restrictive headers for images
  res.removeHeader('Cross-Origin-Resource-Policy');
  res.removeHeader('Cross-Origin-Embedder-Policy');
  next();
}, cors({
  origin: '*', // Allow all origins for images
  credentials: false,
  methods: ['GET', 'OPTIONS'],
  allowedHeaders: ['Content-Type']
}), async (req, res, next) => {
  const { getProductImage } = await import('./controllers/product.controller.js');
  return getProductImage(req, res, next);
});

// API Info Route (root /api endpoint)
app.get('/api', (req, res) => {
  res.json({
    success: true,
    message: 'Xo Bot API is running',
    version: '1.0.0',
    endpoints: {
      auth: '/api/auth',
      products: '/api/products',
      orders: '/api/orders',
      services: '/api/services',
      settings: '/api/settings',
      integrations: '/api/integrations',
      conversations: '/api/conversations',
      ai: '/api/ai',
      upload: '/api/upload',
      billing: '/api/billing',
      notifications: '/api/notifications',
      crm: '/api/crm',
      analytics: '/api/analytics',
      whatsapp: '/api/whatsapp',
      pages: '/api/pages',
      support: '/api/support',
      webhooks: '/webhooks',
      health: '/api/health'
    },
    documentation: process.env.NODE_ENV !== 'production' ? '/api-docs' : null
  });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/products', productRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/services', serviceRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/integrations', integrationRoutes);
  app.use('/api/content', contentPublishingRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/affiliate', affiliateRoutes);
app.use('/api/conversations', conversationRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/billing', billingRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/crm', crmRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/whatsapp', whatsappRoutes);
app.use('/api/pages', pagesRoutes);
app.use('/api/support', supportRoutes);
app.use('/webhooks', webhookRoutes);

// Serve uploaded files (product images for channels). Sensitive dirs stay private.
app.use('/uploads', (req, res, next) => {
  const p = req.path.toLowerCase();
  if (
    p.includes('/payment-proofs/') ||
    p.includes('/design-studio/') ||
    p.endsWith('.pdf')
  ) {
    return res.status(404).end();
  }
  next();
}, express.static('uploads', { index: false, dotfiles: 'deny' }));

// 404 Handler
app.use((req, res) => {
  res.status(404).json({
    error: 'Not Found',
    message: `Route ${req.method} ${req.path} not found`
  });
});

// Error Handler (must be last)
app.use(errorHandler);

let server: ReturnType<typeof app.listen> | null = null;

async function connectDatabaseWithRetry(maxAttempts = 15, delayMs = 3000): Promise<void> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const client = await pool.connect();
      console.log('✅ Database connection test successful');
      client.release();
      return;
    } catch (error) {
      logger.warn(`Database connection attempt ${attempt}/${maxAttempts} failed`, {
        error: error instanceof Error ? error.message : String(error)
      });
      if (attempt === maxAttempts) throw error;
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
}

async function shutdown(signal: string) {
  logger.info(`Received ${signal}, shutting down gracefully`);
  await stopInboxRealtime().catch(() => undefined);
  await shutdownWhatsAppWebSessions().catch(() => undefined);
  if (server) {
    await new Promise<void>((resolve) => server!.close(() => resolve()));
  }
  await pool.end();
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception — process will exit', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection — process will exit', reason instanceof Error ? reason : new Error(String(reason)));
  process.exit(1);
});

async function startServer() {
  try {
    await connectDatabaseWithRetry();

    await initializeTools();
    console.log('🔧 Tools system initialized');

    try {
      await ensureWhatsAppWebSessionsSchema();
      console.log('📱 WhatsApp Web sessions schema ready');
    } catch (error) {
      logger.error('WhatsApp Web schema failed', error as Error);
      console.error('❌ WhatsApp Web schema failed:', error);
    }

    try {
      await startInboxRealtime();
      console.log('📥 Inbox realtime (LISTEN/NOTIFY + SSE) ready');
    } catch (error) {
      logger.error('Inbox realtime failed to start (inbox will fall back to polling)', error as Error);
    }

    server = app.listen(PORT, () => {
      logger.info(`Server started successfully`, {
        port: PORT,
        environment: process.env.NODE_ENV || 'development',
        healthCheck: `${process.env.BACKEND_URL || 'https://xo-bot.com'}/api/health`,
        apiBase: `${process.env.BACKEND_URL || 'https://xo-bot.com'}/api`
      });
      console.log(`🚀 Server running on port ${PORT}`);
      console.log(`📝 Environment: ${process.env.NODE_ENV || 'development'}`);
      const backendUrl = process.env.BACKEND_URL || 'https://xo-bot.com';
      console.log(`🔗 Health check: ${backendUrl}/api/health`);
      console.log(`🔗 API base: ${backendUrl}/api`);

      setInterval(() => {
        autoReenableBot().catch(err => {
          logger.error('Error in auto re-enable bot job', err);
        });
      }, 15 * 60 * 1000);

      autoReenableBot().catch(err => {
        logger.error('Error in initial auto re-enable bot', err);
      });

      startSyncScheduler(15);
      console.log('📦 Sync scheduler started (checking every 15 minutes)');

      startAbandonedCheckoutScheduler(5);
      console.log('🛒 Abandoned checkout reminder scheduler started (every 5 minutes)');

      startContentPublishingScheduler(1);
      console.log('📣 Content publishing scheduler started (every 1 minute)');

      startLifecycleEmailsScheduler(15);
      console.log('📧 Lifecycle emails scheduler started (every 15 minutes)');

      void restoreConnectedWhatsAppSessions()
        .then(() => console.log('📱 WhatsApp Web sessions restore started'))
        .catch((error) => {
          logger.error('WhatsApp Web session restore failed', error as Error);
        });
    });
  } catch (error) {
    console.error('❌ Failed to connect to database:', error);
    console.error('Please check your database configuration in .env file');
    process.exit(1);
  }
}

startServer();

export default app;

