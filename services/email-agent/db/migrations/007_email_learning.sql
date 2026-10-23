BEGIN;
ALTER TABLE email_sequences ADD COLUMN review_status TEXT NOT NULL DEFAULT 'Draft' CHECK (review_status IN ('Draft','Reviewed','Needs changes'));
ALTER TABLE email_sequences ADD COLUMN generation JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE email_sequences ADD CONSTRAINT email_sequence_tenant_key UNIQUE (id,tenant_id);
CREATE TABLE email_outcomes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(tenant_id),
  sequence_id UUID NOT NULL,
  email_index INTEGER NOT NULL CHECK (email_index BETWEEN 1 AND 3),
  sequence_version INTEGER NOT NULL,
  delivered INTEGER NOT NULL CHECK (delivered BETWEEN 0 AND 10000000),
  opened INTEGER NOT NULL CHECK (opened BETWEEN 0 AND delivered),
  clicked INTEGER NOT NULL CHECK (clicked BETWEEN 0 AND delivered),
  replied INTEGER NOT NULL CHECK (replied BETWEEN 0 AND delivered),
  unsubscribed INTEGER NOT NULL CHECK (unsubscribed BETWEEN 0 AND delivered),
  features JSONB NOT NULL,
  provenance TEXT NOT NULL DEFAULT 'manual' CHECK (provenance='manual'),
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (sequence_id,tenant_id) REFERENCES email_sequences(id,tenant_id) ON DELETE CASCADE,
  UNIQUE (sequence_id,email_index)
);
CREATE TABLE email_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL REFERENCES tenants(tenant_id),
  sequence_id UUID NOT NULL, sequence_version INTEGER NOT NULL, user_id UUID NOT NULL,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  verdict TEXT NOT NULL CHECK (verdict IN ('Reviewed','Needs changes')),
  note TEXT NOT NULL DEFAULT '' CHECK (length(note)<=1000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (sequence_id,tenant_id) REFERENCES email_sequences(id,tenant_id) ON DELETE CASCADE,
  UNIQUE (sequence_id,sequence_version,user_id)
);
CREATE TABLE email_learning_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL REFERENCES tenants(tenant_id),
  status TEXT NOT NULL CHECK (status IN ('validated','needs_review')),
  algorithm TEXT NOT NULL DEFAULT 'beta-binomial-v1', dataset_hash TEXT NOT NULL,
  sample_count INTEGER NOT NULL, sequence_count INTEGER NOT NULL,
  model JSONB NOT NULL, evaluation JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE email_learning_settings (
  tenant_id UUID PRIMARY KEY REFERENCES tenants(tenant_id),
  enabled BOOLEAN NOT NULL DEFAULT false, auto_train BOOLEAN NOT NULL DEFAULT false,
  active_run_id UUID REFERENCES email_learning_runs(id),
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE email_integration_preferences (
  tenant_id UUID NOT NULL REFERENCES tenants(tenant_id),
  provider TEXT NOT NULL CHECK (provider IN ('gohighlevel','meta')),
  account_reference TEXT NOT NULL DEFAULT '' CHECK (length(account_reference)<=100),
  version INTEGER NOT NULL DEFAULT 1, updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,provider)
);
DO $$ DECLARE table_name TEXT; BEGIN
  FOREACH table_name IN ARRAY ARRAY['email_outcomes','email_reviews','email_learning_runs','email_learning_settings','email_integration_preferences'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('CREATE POLICY workspace_isolation ON %I USING (tenant_id = nullif(current_setting(''app.current_tenant'', true), '''')::uuid) WITH CHECK (tenant_id = nullif(current_setting(''app.current_tenant'', true), '''')::uuid)', table_name);
    EXECUTE format('CREATE INDEX %I ON %I (tenant_id)', table_name || '_tenant', table_name);
    EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON %I TO c4_app', table_name);
  END LOOP;
END $$;
COMMIT;
