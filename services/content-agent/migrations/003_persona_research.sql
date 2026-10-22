BEGIN;
CREATE TABLE IF NOT EXISTS persona_evidence (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
 campaign_id uuid NOT NULL REFERENCES content_campaigns(id) ON DELETE CASCADE,
 source_type text NOT NULL CHECK(source_type IN ('interview','survey','crm')),
 source_reference text NOT NULL,collected_on date NOT NULL,sample_size integer NOT NULL CHECK(sample_size>0),
 audience text NOT NULL,finding text NOT NULL,limitations text NOT NULL,
 withdrawn_at timestamptz,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS persona_research_reviews (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
 campaign_id uuid NOT NULL REFERENCES content_campaigns(id) ON DELETE CASCADE,
 persona_set_id uuid NOT NULL,persona_key text NOT NULL,links jsonb NOT NULL,
 reviewer_note text NOT NULL,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS evidence_campaign ON persona_evidence(tenant_id,campaign_id);
CREATE INDEX IF NOT EXISTS research_review_campaign ON persona_research_reviews(tenant_id,campaign_id,persona_set_id);
ALTER TABLE persona_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE persona_research_reviews ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_evidence ON persona_evidence;
CREATE POLICY tenant_evidence ON persona_evidence USING(tenant_id=current_setting('app.current_tenant',true)::uuid) WITH CHECK(tenant_id=current_setting('app.current_tenant',true)::uuid);
DROP POLICY IF EXISTS tenant_research_review ON persona_research_reviews;
CREATE POLICY tenant_research_review ON persona_research_reviews USING(tenant_id=current_setting('app.current_tenant',true)::uuid) WITH CHECK(tenant_id=current_setting('app.current_tenant',true)::uuid);
COMMIT;
