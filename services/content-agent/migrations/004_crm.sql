BEGIN;
CREATE TABLE IF NOT EXISTS crm_connections (
 tenant_id uuid PRIMARY KEY REFERENCES clients(id) ON DELETE CASCADE,
 location_id text NOT NULL UNIQUE,token_cipher text NOT NULL,
 enabled boolean NOT NULL DEFAULT true,status text NOT NULL DEFAULT 'connected',
 business jsonb NOT NULL DEFAULT '{}',catalog jsonb NOT NULL DEFAULT '{}',
 last_synced_at timestamptz,last_attempt_at timestamptz,last_error text,
 contact_count integer NOT NULL DEFAULT 0,opportunity_count integer NOT NULL DEFAULT 0,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS crm_campaign_context (
 tenant_id uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
 campaign_id uuid PRIMARY KEY REFERENCES content_campaigns(id) ON DELETE CASCADE,
 mapping jsonb NOT NULL DEFAULT '{}',summary jsonb,revision text,synced_at timestamptz
);
CREATE TABLE IF NOT EXISTS crm_sync_runs (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
 started_at timestamptz NOT NULL DEFAULT now(),finished_at timestamptz,status text NOT NULL,
 contact_count integer,opportunity_count integer,error text
);
ALTER TABLE crm_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_campaign_context ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_sync_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_crm_connections ON crm_connections;
CREATE POLICY tenant_crm_connections ON crm_connections USING(tenant_id=current_setting('app.current_tenant',true)::uuid) WITH CHECK(tenant_id=current_setting('app.current_tenant',true)::uuid);
DROP POLICY IF EXISTS tenant_crm_context ON crm_campaign_context;
CREATE POLICY tenant_crm_context ON crm_campaign_context USING(tenant_id=current_setting('app.current_tenant',true)::uuid) WITH CHECK(tenant_id=current_setting('app.current_tenant',true)::uuid);
DROP POLICY IF EXISTS tenant_crm_runs ON crm_sync_runs;
CREATE POLICY tenant_crm_runs ON crm_sync_runs USING(tenant_id=current_setting('app.current_tenant',true)::uuid) WITH CHECK(tenant_id=current_setting('app.current_tenant',true)::uuid);
COMMIT;
