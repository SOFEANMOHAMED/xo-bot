# XoBot Backend API Server

Backend API server for XoBot Arabic AI Product Assistant SaaS platform.

## 🚀 Quick Start

### Prerequisites
- Node.js 18+ 
- PostgreSQL 14+
- npm or yarn

### Installation

1. **Install dependencies:**
```bash
cd backend
npm install
```

2. **Set up environment variables:**
```bash
cp .env.example .env
# Edit .env with your configuration
```

3. **Set up database:**
```bash
# Create PostgreSQL database
createdb xobot_db

# Run schema
psql -d xobot_db -f src/database/schema.sql
```

4. **Run migrations (if needed):**
```bash
npm run migrate
```

5. **Start development server:**
```bash
npm run dev
```

The server will start on `http://localhost:3001`

## 📁 Project Structure

```
backend/
├── src/
│   ├── controllers/     # Request handlers
│   ├── routes/          # API routes
│   ├── middleware/      # Auth, error handling, etc.
│   ├── database/        # DB connection & schema
│   └── index.ts         # Entry point
├── dist/                # Compiled JavaScript
├── package.json
├── tsconfig.json
└── .env.example
```

## 🔌 API Endpoints

### Authentication
- `POST /api/auth/register` - Register new merchant
- `POST /api/auth/login` - Login
- `GET /api/auth/profile` - Get user profile
- `PUT /api/auth/profile` - Update profile

### Products
- `GET /api/products` - List all products
- `GET /api/products/:id` - Get product by ID
- `POST /api/products` - Create product
- `PUT /api/products/:id` - Update product
- `DELETE /api/products/:id` - Delete product

### Orders
- `GET /api/orders` - List all orders
- `GET /api/orders/:id` - Get order by ID
- `POST /api/orders` - Create order
- `PATCH /api/orders/:id/status` - Update order status
- `DELETE /api/orders/:id` - Delete order

### Services
- `GET /api/services` - List all services
- `GET /api/services/:id` - Get service by ID
- `POST /api/services` - Create service
- `PUT /api/services/:id` - Update service
- `DELETE /api/services/:id` - Delete service

### Settings
- `GET /api/settings` - Get merchant settings
- `PUT /api/settings` - Update settings

### Integrations
- `GET /api/integrations` - Get integration status
- `POST /api/integrations/facebook/connect` - Connect Facebook
- `DELETE /api/integrations/facebook/disconnect` - Disconnect Facebook
- `POST /api/integrations/shopify/connect` - Connect Shopify
- `DELETE /api/integrations/shopify/disconnect` - Disconnect Shopify

### Webhooks
- `POST /webhooks/facebook` - Facebook webhook
- `POST /webhooks/shopify` - Shopify webhook

## 🔐 Authentication

All API endpoints (except auth and webhooks) require authentication via JWT token:

```
Authorization: Bearer <token>
```

## 📝 Environment Variables

See `.env.example` for all required environment variables.

## 🛠️ Development

```bash
# Run in development mode with hot reload
npm run dev

# Build for production
npm run build

# Run production build
npm start
```

## 🧪 Testing

```bash
# TODO: Add tests
npm test
```

## 📚 Database Schema

See `src/database/schema.sql` for complete database schema.

## 🔒 Security Features

- JWT authentication
- Password hashing (bcrypt)
- Rate limiting
- CORS protection
- Helmet security headers
- Input validation (Zod)

## 🚧 TODO

- [ ] Implement Facebook OAuth
- [ ] Implement Shopify OAuth
- [ ] Implement webhook processing
- [ ] Add Redis for job queues
- [ ] Add file upload handling
- [ ] Add comprehensive tests
- [ ] Add API documentation (Swagger)

