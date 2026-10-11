-- Minimal local identity projection for gateway-authenticated service requests.
-- Passwords, sessions and account management remain in the gateway database.
BEGIN;
CREATE OR REPLACE FUNCTION auth_private.ensure_gateway_identity(
  p_tenant uuid, p_user uuid, p_email text, p_name text, p_role text, p_workspace text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF p_role NOT IN ('agency_admin','marketer','viewer') OR length(p_workspace) NOT BETWEEN 2 AND 80
    OR length(p_email) NOT BETWEEN 3 AND 254 OR length(p_name) > 80 THEN
    RAISE EXCEPTION 'Invalid gateway identity' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.tenants(tenant_id,name,slug) VALUES(p_tenant,p_workspace,'gateway-' || p_tenant::text)
    ON CONFLICT(tenant_id) DO UPDATE SET name=EXCLUDED.name;
  IF EXISTS(SELECT 1 FROM public.users WHERE user_id=p_user AND tenant_id<>p_tenant) THEN
    RAISE EXCEPTION 'Identity belongs to another workspace' USING ERRCODE='22023';
  END IF;
  INSERT INTO public.users(user_id,tenant_id,email,display_name,role,password_hash)
    VALUES(p_user,p_tenant,lower(p_email),p_name,p_role,NULL)
    ON CONFLICT(user_id) DO UPDATE SET display_name=EXCLUDED.display_name,role=EXCLUDED.role;
END;
$$;
REVOKE ALL ON FUNCTION auth_private.ensure_gateway_identity(uuid,uuid,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_private.ensure_gateway_identity(uuid,uuid,text,text,text,text) TO c4_app;
COMMIT;
