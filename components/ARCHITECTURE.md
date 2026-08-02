
# XoBot SaaS Architecture & Integration Blueprint

This document outlines the backend architecture, database schema, and API structure required to support Facebook and Shopify integrations for the Arabic AI Product Assistant.

## 1. System Architecture

The system follows a microservices-ready monolithic architecture using Node.js/Express (or Python FastAPI).

### Core Components:
1.  **Frontend (Next.js):** Dashboard for merchants.
2.  **API Server:** Handles Auth, Product Management, and Webhooks.
3.  **Worker Queue (BullMQ/Redis):** Asynchronously processes incoming webhooks (Facebook Messages, Comments) to prevent timeouts.
4.  **AI Engine:** Gemini API + Vector DB (Pinecone/Pgvector) for RAG (Retrieval-Augmented Generation).
5.  **Database:** PostgreSQL.

### Data Flow for Facebook Message:
1.  Customer sends message on Messenger.
2.  FB Webhook -> API Server (`POST /webhooks/facebook`).
3.  Server validates signature -> Pushes job to `message-queue`.
4.  Worker picks job -> Fetches Chat History & Context.
5.  Worker queries Vector DB for relevant products.
6.  Worker calls Gemini API with Context + Product Data.
7.  Worker calls Facebook Graph API to send reply.

---

## 2. Database Schema (PostgreSQL)

### `merchants`
- `id` (UUID, PK)
- `email` (VARCHAR)
- `password_hash` (VARCHAR)
- `subscription_plan` (ENUM: starter, pro, business)
- `created_at` (TIMESTAMP)

### `products`
- `id` (UUID, PK)
- `merchant_id` (UUID, FK)
- `external_id` (VARCHAR) -- Shopify ID
- `source` (ENUM: manual, shopify, excel)
- `name` (VARCHAR)
- `description` (TEXT)
- `price` (DECIMAL)
- `stock` (INT)
- `embedding` (VECTOR) -- For semantic search
- `updated_at` (TIMESTAMP)

### `facebook_pages`
- `id` (UUID, PK)
- `merchant_id` (UUID, FK)
- `page_id` (VARCHAR) -- FB Page ID
- `page_name` (VARCHAR)
- `access_token` (TEXT) -- Encrypted
- `auto_reply_messenger` (BOOLEAN)
- `auto_reply_comments` (BOOLEAN)

### `shopify_stores`
- `id` (UUID, PK)
- `merchant_id` (UUID, FK)
- `shop_domain` (VARCHAR) -- e.g., store.myshopify.com
- `access_token` (TEXT) -- Encrypted
- `last_sync` (TIMESTAMP)

### `conversations`
- `id` (UUID, PK)
- `merchant_id` (UUID, FK)
- `platform` (ENUM: messenger, comment)
- `user_id` (VARCHAR) -- FB User PSID
- `user_name` (VARCHAR)
- `last_message_at` (TIMESTAMP)

### `messages`
- `id` (UUID, PK)
- `conversation_id` (UUID, FK)
- `role` (ENUM: user, assistant)
- `content` (TEXT)
- `created_at` (TIMESTAMP)

---

## 3. API Endpoints

### Authentication & Dashboard
- `POST /api/auth/login`
- `POST /api/auth/register`
- `GET /api/products` (List products)
- `POST /api/products` (Add manual product)

### Facebook Integration
- `GET /api/auth/facebook` (Initiate OAuth)
- `GET /api/auth/facebook/callback` (Handle Redirect & Token Exchange)
- `POST /webhooks/facebook` (Receive Messages/Comments)
    - **Logic:**
        ```javascript
        // Pseudo-code for Webhook
        if (event.object === 'page') {
          for (entry of event.entry) {
             // Handle Messenger
             if (entry.messaging) processMessage(entry.messaging[0]);
             // Handle Feed/Comments
             if (entry.changes && entry.changes[0].field === 'feed') processComment(entry.changes[0]);
          }
        }
        ```

### Shopify Integration
- `GET /api/auth/shopify` (Initiate OAuth)
- `GET /api/auth/shopify/callback` (Exchange Code for Token)
- `POST /webhooks/shopify/products/create` (Product Created Event)
- `POST /webhooks/shopify/products/update` (Product Updated Event)
- `POST /api/shopify/sync` (Manual Sync Trigger)

---

## 4. Security & Scalability

1.  **Secret Management:** Store FB & Shopify tokens encrypted (AES-256) in the DB.
2.  **Webhook Validation:** Always verify `X-Hub-Signature` from Facebook and `X-Shopify-Hmac-Sha256` to prevent spoofing.
3.  **Rate Limiting:** Use Redis to limit API calls per merchant (e.g., 50 requests/minute).
4.  **Job Queues:** Use BullMQ to decouple webhook reception from AI processing. If Gemini API is slow, the webhook won't timeout.

