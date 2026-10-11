
-- C4-01: Database initialization

-- Enable extensions
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. Tenants
CREATE TABLE IF NOT EXISTS tenants (
    tenant_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    tier TEXT DEFAULT 'starter',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Users
CREATE TABLE IF NOT EXISTS users (
    user_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(tenant_id),
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (
        role IN ('agency_admin', 'marketer', 'viewer')
    ),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable tenant isolation
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON users
USING (
    tenant_id = NULLIF(
        current_setting('app.current_tenant', true), ''
    )::UUID
)
WITH CHECK (
    tenant_id = NULLIF(
        current_setting('app.current_tenant', true), ''
    )::UUID
);

-- 3. Knowledge Base
CREATE TABLE IF NOT EXISTS knowledge_base (
    entry_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(tenant_id),
    type TEXT,
    text TEXT,
    metadata JSONB,
    embedding vector(768),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE knowledge_base ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_base FORCE ROW LEVEL SECURITY;

CREATE POLICY kb_isolation ON knowledge_base
USING (
    tenant_id = NULLIF(
        current_setting('app.current_tenant', true), ''
    )::UUID
)
WITH CHECK (
    tenant_id = NULLIF(
        current_setting('app.current_tenant', true), ''
    )::UUID
);

-- 4. Audit Log
CREATE TABLE IF NOT EXISTS audit_log (
    log_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    ts TIMESTAMPTZ DEFAULT NOW(),
    tenant_id UUID,
    user_id UUID,
    route TEXT,
    action TEXT,
    decision TEXT,
    status_code INT
);
