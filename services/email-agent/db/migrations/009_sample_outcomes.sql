BEGIN;
ALTER TABLE email_outcomes DROP CONSTRAINT email_outcomes_provenance_check;
ALTER TABLE email_outcomes ADD CONSTRAINT email_outcomes_provenance_check CHECK (provenance IN ('manual','synthetic'));
COMMIT;
