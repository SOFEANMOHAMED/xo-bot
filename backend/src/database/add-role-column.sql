-- Add role column to merchants table
ALTER TABLE merchants 
ADD COLUMN IF NOT EXISTS role VARCHAR(20) DEFAULT 'user' CHECK (role IN ('owner', 'admin', 'user'));

-- Create index for role
CREATE INDEX IF NOT EXISTS idx_merchants_role ON merchants(role);

