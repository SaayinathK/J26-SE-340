BEGIN;
ALTER TABLE workspace_invitations ADD COLUMN delivery_status text NOT NULL DEFAULT 'not_sent' CHECK(delivery_status IN ('not_sent','sent','failed'));
ALTER TABLE workspace_invitations ADD COLUMN delivery_sent_at timestamptz;
ALTER TABLE workspace_invitations ADD COLUMN delivery_message_id text;
GRANT UPDATE(delivery_status,delivery_sent_at,delivery_message_id) ON workspace_invitations TO c4_app;
CREATE OR REPLACE FUNCTION auth_private.invitation_recipient_status(p_email text,p_tenant uuid)
RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
  SELECT coalesce((SELECT CASE WHEN u.tenant_id=p_tenant THEN CASE WHEN u.is_active THEN 'already_member' ELSE 'inactive_member' END ELSE 'registered_elsewhere' END FROM public.users u WHERE lower(u.email)=lower(p_email) LIMIT 1),'new');
$$;
CREATE OR REPLACE FUNCTION auth_private.describe_invitation(p_hash text)
RETURNS TABLE(email text,role text,workspace_id uuid,workspace_name text,expires_at timestamptz,account_status text)
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
  SELECT i.email,i.role,t.tenant_id,t.name,i.expires_at,auth_private.invitation_recipient_status(i.email,i.tenant_id)
  FROM public.workspace_invitations i JOIN public.tenants t USING(tenant_id)
  JOIN public.users actor ON actor.user_id=i.created_by AND actor.tenant_id=i.tenant_id
  WHERE i.token_hash=p_hash AND i.accepted_at IS NULL AND i.expires_at>now()
    AND actor.is_active AND actor.role='agency_admin';
$$;
CREATE OR REPLACE FUNCTION auth_private.register_account(
  p_name text,p_email text,p_password_hash text,p_google_sub text,p_workspace_name text,p_invitation_hash text
) RETURNS TABLE(user_id uuid,tenant_id uuid,email text,role text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE
  v_tenant uuid;
  v_role text := 'agency_admin';
  v_invitation public.workspace_invitations%ROWTYPE;
BEGIN
  IF length(trim(p_name)) NOT BETWEEN 2 AND 80 OR length(p_email) NOT BETWEEN 3 AND 254 OR (p_password_hash IS NULL AND p_google_sub IS NULL) THEN
    RAISE EXCEPTION 'Invalid account details' USING ERRCODE='22023';
  END IF;
  IF p_invitation_hash IS NOT NULL THEN
    SELECT * INTO v_invitation FROM public.workspace_invitations i
    WHERE i.token_hash=p_invitation_hash AND i.accepted_at IS NULL AND i.expires_at>now() FOR UPDATE;
    IF NOT FOUND OR lower(v_invitation.email)<>lower(trim(p_email)) OR NOT EXISTS(
      SELECT 1 FROM public.users actor WHERE actor.user_id=v_invitation.created_by AND actor.tenant_id=v_invitation.tenant_id AND actor.is_active AND actor.role='agency_admin'
    ) THEN RAISE EXCEPTION 'Invitation is invalid, expired, or belongs to another email' USING ERRCODE='22023'; END IF;
    v_tenant:=v_invitation.tenant_id;
    v_role:=v_invitation.role;
  ELSE
    IF p_workspace_name IS NULL OR length(trim(p_workspace_name)) NOT BETWEEN 2 AND 80 THEN RAISE EXCEPTION 'A workspace name is required' USING ERRCODE='22023'; END IF;
    INSERT INTO public.tenants AS t(name,slug) VALUES(trim(p_workspace_name),trim(both '-' from regexp_replace(lower(p_workspace_name),'[^a-z0-9]+','-','g')) || '-' || substr(gen_random_uuid()::text,1,8)) RETURNING t.tenant_id INTO v_tenant;
  END IF;
  RETURN QUERY INSERT INTO public.users AS u(tenant_id,email,password_hash,role,display_name,google_sub)
    VALUES(v_tenant,lower(trim(p_email)),p_password_hash,v_role,trim(p_name),p_google_sub)
    RETURNING u.user_id,u.tenant_id,u.email,u.role;
  IF p_invitation_hash IS NOT NULL THEN UPDATE public.workspace_invitations SET accepted_at=now() WHERE invitation_id=v_invitation.invitation_id; END IF;
END;
$$;
REVOKE ALL ON FUNCTION auth_private.invitation_recipient_status(text,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION auth_private.describe_invitation(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_private.invitation_recipient_status(text,uuid) TO c4_app;
GRANT EXECUTE ON FUNCTION auth_private.describe_invitation(text) TO c4_app;
COMMIT;
