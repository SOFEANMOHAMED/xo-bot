/**
 * Agency self-signup requests (pending admin approval).
 * Safe to run multiple times.
 */

CREATE TABLE IF NOT EXISTS agency_signup_requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email VARCHAR(255) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  phone VARCHAR(40) NOT NULL,
  agency_name VARCHAR(255) NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected')),
  admin_note TEXT,
  reviewed_by UUID REFERENCES merchants(id),
  reviewed_at TIMESTAMP,
  created_merchant_id UUID REFERENCES merchants(id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_agency_signup_requests_email_pending
  ON agency_signup_requests (LOWER(TRIM(email)))
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_agency_signup_requests_status
  ON agency_signup_requests (status, created_at DESC);
