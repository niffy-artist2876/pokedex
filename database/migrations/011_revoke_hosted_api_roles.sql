-- 011: lock out a hosted database's public API roles.
--
-- Supabase pre-creates the anon and authenticated roles for its Data API and,
-- through default privileges, grants them ALL on every table, sequence and
-- function created in schema public. Left alone, anyone holding the project URL
-- and its public API key could read password hashes (trainer,
-- fn_get_login_credentials) and edit tables that have no row-level security,
-- bypassing the pokedex_* roles entirely. The app never uses these roles, so
-- take everything back, now and for objects created by later migrations.
--
-- Does nothing where the roles don't exist (local Docker, Neon).

DO $$
DECLARE
    api_role TEXT;
BEGIN
    FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
        CONTINUE WHEN NOT EXISTS (SELECT FROM pg_roles WHERE rolname = api_role);
        EXECUTE format('REVOKE ALL ON ALL TABLES    IN SCHEMA public FROM %I', api_role);
        EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM %I', api_role);
        EXECUTE format('REVOKE ALL ON ALL ROUTINES  IN SCHEMA public FROM %I', api_role);
        EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES    FROM %I', api_role);
        EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM %I', api_role);
        EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON ROUTINES  FROM %I', api_role);
    END LOOP;
END;
$$;
