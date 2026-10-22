BEGIN;
CREATE TABLE IF NOT EXISTS crm_leads (
 tenant_id uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
 contact_id text NOT NULL,
 details jsonb NOT NULL,
 synced_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,contact_id)
);
ALTER TABLE crm_leads ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_crm_leads ON crm_leads;
CREATE POLICY tenant_crm_leads ON crm_leads USING(tenant_id=current_setting('app.current_tenant',true)::uuid) WITH CHECK(tenant_id=current_setting('app.current_tenant',true)::uuid);
COMMIT;
