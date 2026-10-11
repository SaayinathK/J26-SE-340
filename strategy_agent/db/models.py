"""Table definitions (plain SQL).

Production design: PostgreSQL with row-level security. Prototype: SQLite where EVERY row carries tenant_id and the
repository layer (tenant_store.py) injects `tenant_id = ?` into every query, so no code path can forget the filter.

Two physically separate databases:
  * TENANT DB  - everything a tenant owns, including the contribution ledger (the only link between a tenant and
                 its anonymised contributions).
  * SHARED DB  - opaque contributions and published insights. It has NO tenant_id column anywhere.
"""

TENANT_TABLES = (
    "tenant_profiles",
    "campaigns",
    "consent",
    "recommendations",
    "feedback",
    "outcomes",
    "rewards",
    "contribution_ledger",
    "preference_pairs",
)

TENANT_DDL = """
CREATE TABLE IF NOT EXISTS tenant_profiles (
    tenant_id TEXT PRIMARY KEY,
    profile_json TEXT NOT NULL,
    contributor_token TEXT,
    updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS campaigns (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    recommendation_id TEXT,
    industry TEXT NOT NULL,
    business_model TEXT,
    region TEXT NOT NULL,
    objective TEXT NOT NULL,
    monthly_budget REAL NOT NULL,
    channel_mix_json TEXT NOT NULL,
    duration_weeks INTEGER,
    messaging_text TEXT,
    outcome_json TEXT,
    period_date TEXT,
    status TEXT NOT NULL DEFAULT 'completed',
    share_status TEXT NOT NULL DEFAULT 'pending',
    share_note TEXT,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_campaigns_tenant ON campaigns(tenant_id, objective);
CREATE TABLE IF NOT EXISTS consent (
    tenant_id TEXT PRIMARY KEY,
    opted_in INTEGER NOT NULL DEFAULT 0,
    scopes_json TEXT NOT NULL DEFAULT '[]',
    consent_version TEXT NOT NULL DEFAULT 'v1',
    granted_by TEXT,
    granted_at TEXT,
    revoked_at TEXT
);
CREATE TABLE IF NOT EXISTS recommendations (
    recommendation_id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    request_json TEXT NOT NULL,
    strategies_json TEXT NOT NULL,
    model_version TEXT NOT NULL,
    adapter_id TEXT NOT NULL,
    generator_used TEXT NOT NULL,
    evidence_json TEXT NOT NULL,
    prompt_hash TEXT NOT NULL,
    prompt_text TEXT NOT NULL,
    ranking_json TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reco_tenant ON recommendations(tenant_id);
CREATE TABLE IF NOT EXISTS feedback (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    recommendation_id TEXT NOT NULL,
    strategy_id TEXT,
    decision TEXT NOT NULL,
    edited_version_json TEXT,
    rating INTEGER,
    comment TEXT,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_feedback_tenant ON feedback(tenant_id, recommendation_id);
CREATE TABLE IF NOT EXISTS outcomes (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    recommendation_id TEXT NOT NULL,
    metrics_json TEXT NOT NULL,
    primary_metric TEXT,
    baseline REAL,
    uplift REAL,
    period TEXT,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_outcomes_tenant ON outcomes(tenant_id, recommendation_id);
CREATE TABLE IF NOT EXISTS rewards (
    recommendation_id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    reward REAL NOT NULL,
    components_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS contribution_ledger (
    contribution_id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    campaign_id TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ledger_tenant ON contribution_ledger(tenant_id);
CREATE TABLE IF NOT EXISTS preference_pairs (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    recommendation_id TEXT NOT NULL,
    pair_kind TEXT NOT NULL,
    prompt TEXT NOT NULL,
    chosen TEXT NOT NULL,
    rejected TEXT NOT NULL,
    reward_chosen REAL,
    reward_rejected REAL,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pairs_tenant ON preference_pairs(tenant_id);
"""

# NOTE: no tenant_id anywhere below.
SHARED_DDL = """
CREATE TABLE IF NOT EXISTS contributions (
    contribution_id TEXT PRIMARY KEY,          -- opaque random id
    contributor_token TEXT NOT NULL,           -- random per-tenant token, used ONLY to count distinct contributors for k-anonymity
    industry_bucket TEXT NOT NULL,
    region TEXT NOT NULL,
    budget_band TEXT NOT NULL,
    objective TEXT NOT NULL,
    channel_mix_json TEXT NOT NULL,
    outcome_json TEXT NOT NULL,
    angle TEXT,
    duration_bucket TEXT,
    period TEXT,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS insights (
    insight_id TEXT PRIMARY KEY,
    industry_bucket TEXT NOT NULL,
    region TEXT NOT NULL,
    budget_band TEXT NOT NULL,
    objective TEXT NOT NULL,
    channel_mix_json TEXT NOT NULL,
    outcome_metrics_json TEXT NOT NULL,
    support_count INTEGER NOT NULL,
    angle TEXT,
    summary TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_insights_lookup ON insights(industry_bucket, objective);
"""
