-- Agency seats system: parent agency accounts, per-agency pricing, client seats, seat payments.
-- Safe to run multiple times.

ALTER TABLE merchants
  ADD COLUMN IF NOT EXISTS account_type VARCHAR(30) NOT NULL DEFAULT 'merchant';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'merchants_account_type_check'
  ) THEN
    ALTER TABLE merchants
      ADD CONSTRAINT merchants_account_type_check
      CHECK (account_type IN ('merchant', 'agency', 'agency_client'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_merchants_account_type ON merchants(account_type);

CREATE TABLE IF NOT EXISTS agencies (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  owner_merchant_id UUID NOT NULL UNIQUE REFERENCES merchants(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'suspended')),
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_agencies_status ON agencies(status);

CREATE TABLE IF NOT EXISTS agency_pricing (
  agency_id UUID NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
  plan_key VARCHAR(50) NOT NULL,
  unit_price DECIMAL(10, 2) NOT NULL CHECK (unit_price > 0),
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (agency_id, plan_key)
);

CREATE TABLE IF NOT EXISTS agency_seats (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  agency_id UUID NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
  client_merchant_id UUID NOT NULL UNIQUE REFERENCES merchants(id) ON DELETE CASCADE,
  plan_key VARCHAR(50) NOT NULL,
  agency_unit_price_snapshot DECIMAL(10, 2) NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'pending_payment'
    CHECK (status IN ('pending_payment', 'active', 'suspended', 'cancelled')),
  client_label VARCHAR(255),
  starts_at TIMESTAMP,
  ends_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_agency_seats_agency ON agency_seats(agency_id);
CREATE INDEX IF NOT EXISTS idx_agency_seats_status ON agency_seats(status);

CREATE TABLE IF NOT EXISTS agency_seat_payments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  agency_id UUID NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
  seat_id UUID NOT NULL REFERENCES agency_seats(id) ON DELETE CASCADE,
  plan_key VARCHAR(50) NOT NULL,
  amount DECIMAL(10, 2) NOT NULL,
  purpose VARCHAR(30) NOT NULL DEFAULT 'activate'
    CHECK (purpose IN ('activate', 'renew', 'change_plan')),
  method VARCHAR(50) NOT NULL DEFAULT 'sham_cash',
  proof_url TEXT NOT NULL,
  status VARCHAR(50) DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected')),
  admin_note TEXT,
  reviewed_by UUID REFERENCES merchants(id),
  reviewed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_agency_seat_payments_agency ON agency_seat_payments(agency_id);
CREATE INDEX IF NOT EXISTS idx_agency_seat_payments_status ON agency_seat_payments(status);
CREATE INDEX IF NOT EXISTS idx_agency_seat_payments_seat ON agency_seat_payments(seat_id);
