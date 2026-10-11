-- Run with the database migration/owner role, after migrations 001–003.
BEGIN;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS display_name TEXT NOT NULL DEFAULT '';
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS google_sub TEXT UNIQUE;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE public.users ALTER COLUMN password_hash DROP NOT NULL;
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS domain TEXT NOT NULL DEFAULT '';
CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_unique ON public.users (LOWER(email));

CREATE TABLE IF NOT EXISTS public.auth_sessions (
  session_id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES public.users(user_id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES public.tenants(tenant_id),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS auth_sessions_user_idx ON public.auth_sessions(user_id);
ALTER TABLE public.auth_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auth_sessions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_sessions ON public.auth_sessions
  USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
GRANT SELECT, INSERT, DELETE ON public.auth_sessions TO c4_app;

CREATE TABLE IF NOT EXISTS public.workspace_invitations (
  invitation_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(tenant_id),
  email TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('agency_admin', 'marketer', 'viewer')),
  token_hash TEXT NOT NULL UNIQUE,
  created_by UUID NOT NULL REFERENCES public.users(user_id),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT now() + interval '7 days',
  accepted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.workspace_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_invitations FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_invitations ON public.workspace_invitations
  USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
GRANT SELECT, INSERT, DELETE ON public.workspace_invitations TO c4_app;

CREATE TABLE IF NOT EXISTS public.auth_google_challenges (
  challenge_hash TEXT PRIMARY KEY,
  intent TEXT NOT NULL CHECK (intent IN ('login', 'register', 'link')),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT now() + interval '5 minutes'
);
REVOKE ALL ON public.auth_google_challenges FROM PUBLIC;
GRANT SELECT, INSERT, DELETE ON public.auth_google_challenges TO c4_app;

CREATE OR REPLACE FUNCTION auth_private.resolve_session(p_session UUID, p_user UUID, p_tenant UUID)
RETURNS TABLE (user_id UUID, tenant_id UUID, email TEXT, display_name TEXT, role TEXT, google_sub TEXT,
  workspace_name TEXT, workspace_slug TEXT, workspace_tier TEXT, workspace_domain TEXT)
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT u.user_id, u.tenant_id, u.email, u.display_name, u.role, u.google_sub, t.name, t.slug, t.tier, t.domain
  FROM public.auth_sessions s JOIN public.users u ON u.user_id = s.user_id AND u.tenant_id = s.tenant_id
  JOIN public.tenants t ON t.tenant_id = u.tenant_id
  WHERE s.session_id = p_session AND u.user_id = p_user AND u.tenant_id = p_tenant
    AND s.expires_at > now() AND u.is_active = true;
$$;
CREATE OR REPLACE FUNCTION auth_private.lookup_google_user(p_sub TEXT)
RETURNS TABLE (user_id UUID, tenant_id UUID, email TEXT, role TEXT)
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT u.user_id, u.tenant_id, u.email, u.role FROM public.users u WHERE u.google_sub = p_sub AND u.is_active = true;
$$;
CREATE OR REPLACE FUNCTION auth_private.register_account(
  p_name TEXT, p_email TEXT, p_password_hash TEXT, p_google_sub TEXT, p_workspace_name TEXT, p_invitation_hash TEXT
)
RETURNS TABLE (user_id UUID, tenant_id UUID, email TEXT, role TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_tenant UUID;
  v_role TEXT := 'agency_admin';
  v_invitation public.workspace_invitations%ROWTYPE;
BEGIN
  IF length(trim(p_name)) NOT BETWEEN 2 AND 80 OR length(p_email) NOT BETWEEN 3 AND 254 OR
     (p_password_hash IS NULL AND p_google_sub IS NULL) THEN
    RAISE EXCEPTION 'Invalid account details' USING ERRCODE = '22023';
  END IF;
  IF p_invitation_hash IS NOT NULL THEN
    SELECT * INTO v_invitation FROM public.workspace_invitations i
    WHERE i.token_hash = p_invitation_hash AND i.accepted_at IS NULL AND i.expires_at > now() FOR UPDATE;
    IF NOT FOUND OR lower(v_invitation.email) <> lower(p_email) THEN
      RAISE EXCEPTION 'Invitation is invalid, expired, or belongs to another email' USING ERRCODE = '22023';
    END IF;
    v_tenant := v_invitation.tenant_id;
    v_role := v_invitation.role;
  ELSE
    IF p_workspace_name IS NULL OR length(trim(p_workspace_name)) NOT BETWEEN 2 AND 80 THEN
      RAISE EXCEPTION 'A workspace name is required' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.tenants AS t(name, slug) VALUES (trim(p_workspace_name),
      trim(both '-' from regexp_replace(lower(p_workspace_name), '[^a-z0-9]+', '-', 'g')) || '-' || substr(gen_random_uuid()::text, 1, 8))
    RETURNING t.tenant_id INTO v_tenant;
  END IF;
  RETURN QUERY INSERT INTO public.users AS u (tenant_id, email, password_hash, role, display_name, google_sub)
    VALUES (v_tenant, lower(trim(p_email)), p_password_hash, v_role, trim(p_name), p_google_sub)
    RETURNING u.user_id, u.tenant_id, u.email, u.role;
  IF p_invitation_hash IS NOT NULL THEN
    UPDATE public.workspace_invitations SET accepted_at = now() WHERE invitation_id = v_invitation.invitation_id;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION auth_private.resolve_session(UUID, UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION auth_private.lookup_google_user(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION auth_private.register_account(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_private.resolve_session(UUID, UUID, UUID) TO c4_app;
GRANT EXECUTE ON FUNCTION auth_private.lookup_google_user(TEXT) TO c4_app;
GRANT EXECUTE ON FUNCTION auth_private.register_account(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO c4_app;
GRANT UPDATE (name, domain) ON public.tenants TO c4_app;
CREATE OR REPLACE FUNCTION auth_private.lookup_login_user(p_email TEXT)
RETURNS TABLE (user_id UUID, tenant_id UUID, email TEXT, password_hash TEXT, role TEXT)
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT u.user_id, u.tenant_id, u.email, u.password_hash, u.role
  FROM public.users u WHERE lower(u.email) = lower(p_email) AND u.is_active = true LIMIT 1;
$$;
COMMIT;
