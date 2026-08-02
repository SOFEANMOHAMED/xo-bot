-- Add attachments column to support_ticket_replies table
ALTER TABLE support_ticket_replies 
ADD COLUMN IF NOT EXISTS attachments JSONB DEFAULT '[]'::jsonb;

COMMENT ON COLUMN support_ticket_replies.attachments IS 'Array of attachment objects with url, filename, mimetype, size';

