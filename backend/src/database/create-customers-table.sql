-- Create Customers Table (CRM)
CREATE TABLE IF NOT EXISTS customers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255),
    phone VARCHAR(50),
    address TEXT,
    city VARCHAR(100),
    country VARCHAR(100),
    customer_type VARCHAR(50) DEFAULT 'regular' CHECK (customer_type IN ('regular', 'vip', 'wholesale', 'new')),
    status VARCHAR(50) DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'blocked')),
    total_orders INTEGER DEFAULT 0,
    total_spent DECIMAL(10, 2) DEFAULT 0,
    last_order_date TIMESTAMP,
    last_interaction_date TIMESTAMP,
    notes TEXT,
    tags TEXT[],
    metadata JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create Customer Interactions Table
CREATE TABLE IF NOT EXISTS customer_interactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    interaction_type VARCHAR(50) NOT NULL CHECK (interaction_type IN ('message', 'call', 'email', 'order', 'complaint', 'review', 'note')),
    title VARCHAR(255),
    description TEXT,
    platform VARCHAR(50),
    related_order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
    related_conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
    created_by UUID REFERENCES merchants(id) ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create Customer Tags Table
CREATE TABLE IF NOT EXISTS customer_tags (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    color VARCHAR(20) DEFAULT '#3B82F6',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(merchant_id, name)
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_customers_merchant_id ON customers(merchant_id);
CREATE INDEX IF NOT EXISTS idx_customers_email ON customers(email);
CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone);
CREATE INDEX IF NOT EXISTS idx_customers_customer_type ON customers(customer_type);
CREATE INDEX IF NOT EXISTS idx_customers_status ON customers(status);
CREATE INDEX IF NOT EXISTS idx_customers_last_order_date ON customers(last_order_date DESC);
CREATE INDEX IF NOT EXISTS idx_customer_interactions_customer_id ON customer_interactions(customer_id);
CREATE INDEX IF NOT EXISTS idx_customer_interactions_merchant_id ON customer_interactions(merchant_id);
CREATE INDEX IF NOT EXISTS idx_customer_interactions_type ON customer_interactions(interaction_type);
CREATE INDEX IF NOT EXISTS idx_customer_interactions_created_at ON customer_interactions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_customer_tags_merchant_id ON customer_tags(merchant_id);

-- Partial unique index for customer email (only when email is not null and not empty)
CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_merchant_email_unique 
ON customers(merchant_id, email) 
WHERE email IS NOT NULL AND email != '';

-- Add comments
COMMENT ON TABLE customers IS 'CRM customers table for managing customer information';
COMMENT ON TABLE customer_interactions IS 'Customer interaction history (messages, calls, orders, etc.)';
COMMENT ON TABLE customer_tags IS 'Custom tags for categorizing customers';

