BEGIN;
CREATE TABLE email_finetune_settings (
 tenant_id uuid PRIMARY KEY REFERENCES tenants(tenant_id),
 enabled boolean NOT NULL DEFAULT false, auto_queue boolean NOT NULL DEFAULT false,
 auto_activate boolean NOT NULL DEFAULT false, active_job_id uuid,
 version integer NOT NULL DEFAULT 1, updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(enabled OR NOT(auto_queue OR auto_activate))
);
CREATE TABLE email_finetune_jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(tenant_id),
 created_by uuid NOT NULL, status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','validated','rejected','failed','cancelled')),
 dataset_hash text NOT NULL, dataset jsonb NOT NULL, example_count integer NOT NULL,
 candidate_model text NOT NULL, baseline_model text NOT NULL, worker_id uuid, lease_hash text,
 lease_expires_at timestamptz, attempts integer NOT NULL DEFAULT 0,
 stage text NOT NULL DEFAULT 'Queued', evaluation jsonb, artifact jsonb, error text,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(id,tenant_id), UNIQUE(tenant_id,dataset_hash)
);
CREATE UNIQUE INDEX email_finetune_one_active_job ON email_finetune_jobs(tenant_id) WHERE status IN ('queued','running');
ALTER TABLE email_finetune_settings ADD CONSTRAINT active_finetune_tenant
 FOREIGN KEY(active_job_id,tenant_id) REFERENCES email_finetune_jobs(id,tenant_id);
CREATE TABLE email_finetune_workers (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants(tenant_id), created_by uuid NOT NULL,
 token_hash text NOT NULL, name text NOT NULL DEFAULT 'Colab session',
 expires_at timestamptz NOT NULL, revoked_at timestamptz, last_seen_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(id,tenant_id)
);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['email_finetune_settings','email_finetune_jobs','email_finetune_workers'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY workspace_isolation ON %I USING(tenant_id=nullif(current_setting(''app.current_tenant'',true),'''')::uuid) WITH CHECK(tenant_id=nullif(current_setting(''app.current_tenant'',true),'''')::uuid)',t);
  EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON %I TO c4_app',t);
 END LOOP;
END $$;
-- The shared Colab GPU cannot safely train and serve requests concurrently.
-- Exposes only a busy boolean, never another tenant's training data or identity.
CREATE FUNCTION auth_private.finetune_gpu_busy() RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT EXISTS(SELECT 1 FROM public.email_finetune_jobs WHERE status='running' AND lease_expires_at>now());
$$;
REVOKE ALL ON FUNCTION auth_private.finetune_gpu_busy() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_private.finetune_gpu_busy() TO c4_app;
COMMIT;
