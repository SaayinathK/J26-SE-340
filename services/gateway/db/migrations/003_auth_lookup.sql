
-- C4-02: Secure authentication lookup
-- Run as the database administrator.

CREATE SCHEMA IF NOT EXISTS auth_private;

REVOKE ALL ON SCHEMA auth_private FROM PUBLIC;
GRANT USAGE ON SCHEMA auth_private TO c4_app;

CREATE OR REPLACE FUNCTION auth_private.lookup_login_user(
    p_email TEXT
)
RETURNS TABLE (
    user_id UUID,
    tenant_id UUID,
    email TEXT,
    password_hash TEXT,
    role TEXT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
    SELECT
        u.user_id,
        u.tenant_id,
        u.email,
        u.password_hash,
        u.role
    FROM public.users AS u
    WHERE LOWER(u.email) = LOWER(p_email)
    LIMIT 1;
$$;

-- Only the application role can execute this function.
REVOKE ALL ON FUNCTION
    auth_private.lookup_login_user(TEXT)
FROM PUBLIC;

GRANT EXECUTE ON FUNCTION
    auth_private.lookup_login_user(TEXT)
TO c4_app;
