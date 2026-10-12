BEGIN;
CREATE TABLE IF NOT EXISTS campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(tenant_id),
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
  audience TEXT NOT NULL CHECK (length(audience) BETWEEN 1 AND 150),
  status TEXT NOT NULL DEFAULT 'Draft' CHECK (status IN ('Draft', 'Archived')),
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS email_sequences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(tenant_id),
  name TEXT NOT NULL,
  audience TEXT NOT NULL,
  tone TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'all',
  emails JSONB NOT NULL CHECK (jsonb_typeof(emails) = 'array'),
  origin TEXT NOT NULL CHECK (origin IN ('manual', 'ollama')),
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS workspace_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(tenant_id),
  user_id UUID NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  icon TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
DO $$ DECLARE table_name TEXT; BEGIN
  FOREACH table_name IN ARRAY ARRAY['campaigns', 'email_sequences', 'workspace_events'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = table_name AND policyname = 'workspace_isolation') THEN
      EXECUTE format('CREATE POLICY workspace_isolation ON %I USING (tenant_id = nullif(current_setting(''app.current_tenant'', true), '''')::uuid) WITH CHECK (tenant_id = nullif(current_setting(''app.current_tenant'', true), '''')::uuid)', table_name);
    END IF;
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I (tenant_id, created_at DESC)', table_name || '_tenant_created', table_name);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO c4_app', table_name);
  END LOOP;
END $$;
CREATE INDEX IF NOT EXISTS knowledge_tenant_created ON knowledge_base (tenant_id, created_at DESC);
COMMIT;
