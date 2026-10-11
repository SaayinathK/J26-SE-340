
-- C4-01: Restricted application database role

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_roles
        WHERE rolname = 'c4_app'
    ) THEN
        CREATE ROLE c4_app
        LOGIN PASSWORD 'c4_local_dev_only_2026'
        NOSUPERUSER NOBYPASSRLS;
    END IF;
END
$$;

-- Allow connection
DO $$
BEGIN
    EXECUTE format('GRANT CONNECT ON DATABASE %I TO c4_app', current_database());
END
$$;
GRANT USAGE ON SCHEMA public TO c4_app;

-- Application permissions
GRANT SELECT ON tenants TO c4_app;

GRANT SELECT, INSERT, UPDATE, DELETE
ON users, knowledge_base TO c4_app;

GRANT INSERT ON audit_log TO c4_app;
