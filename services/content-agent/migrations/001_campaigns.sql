BEGIN;
CREATE TABLE IF NOT EXISTS content_campaigns (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  profile jsonb NOT NULL DEFAULT '{}',
  personas jsonb NOT NULL DEFAULT '[]',
  winner_index integer CHECK (winner_index BETWEEN 0 AND 2),
  draft jsonb,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS content_campaigns_tenant ON content_campaigns(tenant_id);
ALTER TABLE content_campaigns ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS campaign_tenant ON content_campaigns;
CREATE POLICY campaign_tenant ON content_campaigns
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);
COMMIT;
