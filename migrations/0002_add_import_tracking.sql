-- Add tracking fields to import_staging table
-- consumed flag for one-time use, issue_code for preview row validation status

ALTER TABLE import_staging ADD COLUMN consumed INTEGER NOT NULL DEFAULT 0 CHECK (consumed IN (0, 1));
ALTER TABLE import_staging ADD COLUMN issue_code TEXT;
ALTER TABLE import_staging ADD COLUMN claim_token TEXT;
