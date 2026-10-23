BEGIN;
ALTER TABLE email_sequences DROP CONSTRAINT email_sequences_review_status_check;
ALTER TABLE email_sequences ADD CONSTRAINT email_sequences_review_status_check CHECK (review_status IN ('Draft','Reviewed','Needs changes','Needs review'));
ALTER TABLE email_sequences ADD COLUMN guardrail_flags JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(guardrail_flags)='array');
ALTER TABLE email_sequences ADD COLUMN guardrail_checked_at TIMESTAMPTZ;
COMMIT;
