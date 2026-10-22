BEGIN;
ALTER TABLE content_campaigns ADD COLUMN IF NOT EXISTS persona_set_id uuid;
UPDATE content_campaigns SET persona_set_id=id WHERE persona_set_id IS NULL;
ALTER TABLE content_campaigns ADD COLUMN IF NOT EXISTS auto_learning boolean NOT NULL DEFAULT true;
ALTER TABLE content_campaigns ADD COLUMN IF NOT EXISTS winner_source text;
UPDATE content_campaigns SET winner_source='manual',auto_learning=false WHERE winner_index IS NOT NULL AND winner_source IS NULL;
ALTER TABLE content_campaigns ADD COLUMN IF NOT EXISTS learning_guidance jsonb;
ALTER TABLE content_campaigns ADD COLUMN IF NOT EXISTS learning_evidence jsonb;
ALTER TABLE content_campaigns ADD COLUMN IF NOT EXISTS learning_evaluated_at timestamptz;
ALTER TABLE content_campaigns ADD COLUMN IF NOT EXISTS learning_revision integer NOT NULL DEFAULT 0;
ALTER TABLE prompt_performance ADD COLUMN IF NOT EXISTS negative_ratings integer NOT NULL DEFAULT 0;
-- Reconcile historical counters from actual generations, not repeated feedback submissions.
UPDATE prompt_performance p SET total_uses=s.uses,positive_ratings=s.positive,negative_ratings=s.negative,
 success_rate=CASE WHEN s.positive+s.negative>0 THEN ROUND(s.positive::decimal/(s.positive+s.negative)*100,2) ELSE 0 END,
 is_champion=(s.positive+s.negative>=5 AND s.positive::decimal/GREATEST(s.positive+s.negative,1)>=0.6)
FROM (SELECT tenant_id,prompt_hash,agent_type,count(*) AS uses,
 count(*) FILTER(WHERE rating='positive') AS positive,count(*) FILTER(WHERE rating='negative') AS negative
 FROM generations GROUP BY tenant_id,prompt_hash,agent_type) s
WHERE p.tenant_id=s.tenant_id AND p.prompt_hash=s.prompt_hash AND p.agent_type=s.agent_type;
CREATE TABLE IF NOT EXISTS creative_variants (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
 campaign_id uuid NOT NULL REFERENCES content_campaigns(id) ON DELETE CASCADE,
 generation_id uuid NOT NULL REFERENCES generations(id) ON DELETE CASCADE,
 persona_set_id uuid NOT NULL, persona_key text NOT NULL,
 persona_index integer NOT NULL, hook_index integer NOT NULL, body_index integer NOT NULL,
 snapshot jsonb NOT NULL, meta_ad_id text,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,generation_id,persona_index,hook_index,body_index),
 UNIQUE(tenant_id,meta_ad_id)
);
CREATE INDEX IF NOT EXISTS creative_variants_campaign ON creative_variants(tenant_id,campaign_id);
CREATE TABLE IF NOT EXISTS creative_metrics (
 tenant_id uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
 variant_id uuid NOT NULL REFERENCES creative_variants(id) ON DELETE CASCADE,
 day date NOT NULL, impressions bigint NOT NULL CHECK(impressions>=0),
 link_clicks bigint NOT NULL CHECK(link_clicks>=0), purchases bigint NOT NULL CHECK(purchases>=0),
 spend numeric(16,4) NOT NULL CHECK(spend>=0), currency text NOT NULL CHECK(currency ~ '^[A-Z]{3}$'),
 source text NOT NULL CHECK(source IN ('manual','meta')), updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,variant_id,day)
);
CREATE TABLE IF NOT EXISTS learning_revisions (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
 campaign_id uuid NOT NULL REFERENCES content_campaigns(id) ON DELETE CASCADE,
 revision integer NOT NULL, guidance jsonb, evidence jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,campaign_id,revision)
);
-- Tokens remain in server environment, never in this table or API responses.
CREATE TABLE IF NOT EXISTS meta_connections (
 tenant_id uuid PRIMARY KEY REFERENCES clients(id) ON DELETE CASCADE,
 account_id text NOT NULL, token_env text NOT NULL, api_version text NOT NULL,
 last_synced_at timestamptz, last_error text
);
ALTER TABLE creative_variants ENABLE ROW LEVEL SECURITY;
ALTER TABLE creative_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE learning_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE meta_connections ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_variants ON creative_variants;
CREATE POLICY tenant_variants ON creative_variants USING(tenant_id=current_setting('app.current_tenant',true)::uuid) WITH CHECK(tenant_id=current_setting('app.current_tenant',true)::uuid);
DROP POLICY IF EXISTS tenant_metrics ON creative_metrics;
CREATE POLICY tenant_metrics ON creative_metrics USING(tenant_id=current_setting('app.current_tenant',true)::uuid) WITH CHECK(tenant_id=current_setting('app.current_tenant',true)::uuid);
DROP POLICY IF EXISTS tenant_revisions ON learning_revisions;
CREATE POLICY tenant_revisions ON learning_revisions USING(tenant_id=current_setting('app.current_tenant',true)::uuid) WITH CHECK(tenant_id=current_setting('app.current_tenant',true)::uuid);
DROP POLICY IF EXISTS tenant_meta ON meta_connections;
CREATE POLICY tenant_meta ON meta_connections USING(tenant_id=current_setting('app.current_tenant',true)::uuid) WITH CHECK(tenant_id=current_setting('app.current_tenant',true)::uuid);
COMMIT;
