-- Make password_hash nullable to support OAuth (Google) login
-- Users who sign up via OAuth don't need a password

DO $$
BEGIN
    -- First, update any existing NULL values to a placeholder (if any exist)
    -- This shouldn't be necessary, but just in case
    UPDATE merchants 
    SET password_hash = NULL 
    WHERE password_hash IS NULL AND auth_provider != 'email';
    
    -- Make password_hash nullable
    ALTER TABLE merchants 
    ALTER COLUMN password_hash DROP NOT NULL;
    
    RAISE NOTICE 'password_hash column is now nullable';
END $$;

