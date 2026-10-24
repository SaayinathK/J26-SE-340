-- services/lead-intel/db/migrations/001_init.sql
-- C3 Lead Intelligence database (lead_intel) - owner: Shathursini J (C3), database per service.
-- Docker runs this once, when the lead-intel-database volume is first created.
-- Stores the HISTORY of the agent: every score, every recommendation and every real outcome,
-- per tenant, never overwritten. The Strategy agent, the Email agent and Component 2
-- (continuous learning) read it through the C3 API, never directly.

CREATE EXTENSION IF NOT EXISTS vector;     -- ready for moving the knowledge base here (C3-ADR-004)

-- 1. Every score the agent gave (POST /leads/score, and the score used for advice or an outcome)
CREATE TABLE IF NOT EXISTS lead_scores (
    score_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant        TEXT NOT NULL,                        -- tenant slug sent by the gateway (from the JWT)
    lead_id       TEXT NOT NULL,                        -- CRM contact id
    score         SMALLINT NOT NULL CHECK (score BETWEEN 0 AND 100),
    segment       TEXT NOT NULL CHECK (segment IN ('hot', 'warm', 'cold')),
    top_factors   JSONB NOT NULL DEFAULT '[]',          -- SHAP reasons
    confidence    JSONB,                                -- FR9
    alert         JSONB,                                -- FR8 hot -> cold alert, if any
    model_version TEXT NOT NULL,
    source        TEXT NOT NULL DEFAULT 'api'
                  CHECK (source IN ('api', 'recommendation', 'outcome', 'seed')),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS lead_scores_by_lead ON lead_scores (tenant, lead_id, created_at DESC);

-- 2. Every grounded recommendation (GET /leads/{id}/recommendation)
CREATE TABLE IF NOT EXISTS recommendations (
    recommendation_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant            TEXT NOT NULL,
    lead_id           TEXT NOT NULL,
    score             SMALLINT,
    segment           TEXT,
    next_best_action  TEXT,
    message_draft     TEXT,
    sources           JSONB NOT NULL DEFAULT '[]',     -- S1, S4 ... the CRM notes the advice used
    grounded          BOOLEAN NOT NULL,
    policy_check      TEXT,                             -- consistent / inconsistent with the business rule
    policy_rule       TEXT,                             -- the follow-up rule for this segment
    confidence        NUMERIC(4, 2),
    llm_model         TEXT,
    retrieval_method  TEXT,
    latency_sec       NUMERIC(7, 1),
    response          JSONB NOT NULL,                   -- the full answer, for audit
    status            TEXT NOT NULL DEFAULT 'new'       -- the Email agent can mark advice as sent
                      CHECK (status IN ('new', 'sent', 'dismissed')),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS recommendations_by_lead ON recommendations (tenant, lead_id, created_at DESC);

-- 3. Every real result the marketer recorded (POST /leads/{id}/outcome) - FR7, feeds continuous learning
CREATE TABLE IF NOT EXISTS lead_outcomes (
    outcome_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant        TEXT NOT NULL,
    lead_id       TEXT NOT NULL,
    outcome       TEXT NOT NULL CHECK (outcome IN ('won', 'lost')),
    score         SMALLINT NOT NULL CHECK (score BETWEEN 0 AND 100),   -- the score at that time
    segment       TEXT NOT NULL,
    model_version TEXT NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS lead_outcomes_by_tenant ON lead_outcomes (tenant, created_at);

-- Tenant isolation: a session only sees and writes rows of app.current_tenant.
-- If the setting is missing, no rows match (fails closed).
DO $$
DECLARE t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY['lead_scores', 'recommendations', 'lead_outcomes'] LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = t AND policyname = 'tenant_isolation') THEN
            EXECUTE format('CREATE POLICY tenant_isolation ON %I
                USING (tenant = current_setting(''app.current_tenant'', true))
                WITH CHECK (tenant = current_setting(''app.current_tenant'', true))', t);
        END IF;
    END LOOP;
END
$$;
