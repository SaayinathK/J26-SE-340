-- services/lead-intel/db/migrations/002_app_role.sql
-- The login the C3 service uses. It is NOT a superuser and cannot bypass row-level security,
-- so tenant isolation is enforced by the database itself (same pattern as C4's c4_app role).
-- The password is for local development only; set a secret in production.

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lead_intel_app') THEN
        CREATE ROLE lead_intel_app LOGIN PASSWORD 'c3_local_dev_only_2026' NOSUPERUSER NOBYPASSRLS;
    END IF;
    EXECUTE format('GRANT CONNECT ON DATABASE %I TO lead_intel_app', current_database());
END
$$;

GRANT USAGE ON SCHEMA public TO lead_intel_app;
GRANT SELECT, INSERT ON lead_scores, lead_outcomes TO lead_intel_app;   -- history is append-only
GRANT SELECT, INSERT, UPDATE (status) ON recommendations TO lead_intel_app;
