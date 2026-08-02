-- Migration: Add viewed_at column to orders table
-- This allows tracking which orders have been viewed by the merchant

-- Check if column exists, if not add it
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public'
        AND table_name = 'orders' 
        AND column_name = 'viewed_at'
    ) THEN
        ALTER TABLE public.orders 
        ADD COLUMN viewed_at TIMESTAMP;
        
        RAISE NOTICE 'Column viewed_at added to orders table';
    ELSE
        RAISE NOTICE 'Column viewed_at already exists in orders table';
    END IF;
EXCEPTION
    WHEN insufficient_privilege THEN
        RAISE NOTICE 'Insufficient privileges. Please run as database owner or superuser.';
    WHEN OTHERS THEN
        RAISE NOTICE 'Error: %', SQLERRM;
END $$;

