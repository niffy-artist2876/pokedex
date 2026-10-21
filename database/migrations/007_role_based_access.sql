-- 007: role-based access control inside the database.
--
-- Roles (cluster-wide, created only if missing):
--   pokedex_guest       not signed in: read the Pokédex, sign up, look up login credentials
--   pokedex_competitor  inherits guest; builds and manages *their own* teams
--   pokedex_admin       inherits competitor; manages formats and bans, moderates all teams
--   pokedex_app         the only LOGIN role. NOINHERIT, so it can do nothing until the
--                       backend runs, per request and inside a transaction:
--                           SET LOCAL ROLE pokedex_competitor;   -- or guest / admin
--                           SELECT set_config('pokedex.trainer_id', '<id>', true);
--                       Its password is set by database/setup_db.py from APP_DB_PASSWORD.
--
-- Row-level security then limits competitors to their own teams (plus read-only
-- access to other trainers' validated teams). Column privileges keep password
-- hashes and e-mails out of reach. Table owners and superusers bypass RLS, so
-- the backend must never connect as the owner.


-- ---------------------------------------------------------------- roles

DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'pokedex_guest') THEN
        CREATE ROLE pokedex_guest NOLOGIN;
    END IF;
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'pokedex_competitor') THEN
        CREATE ROLE pokedex_competitor NOLOGIN;
    END IF;
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'pokedex_admin') THEN
        CREATE ROLE pokedex_admin NOLOGIN;
    END IF;
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'pokedex_app') THEN
        CREATE ROLE pokedex_app LOGIN NOINHERIT;
    END IF;
END;
$$;

GRANT pokedex_guest      TO pokedex_competitor;
GRANT pokedex_competitor TO pokedex_admin;
GRANT pokedex_guest, pokedex_competitor, pokedex_admin TO pokedex_app;

GRANT USAGE ON SCHEMA public TO pokedex_guest;


-- ---------------------------------------------------------------- request context

-- The signed-in trainer for the current transaction, or NULL.
CREATE FUNCTION app_current_trainer_id() RETURNS INTEGER
LANGUAGE sql STABLE AS $$
    SELECT nullif(current_setting('pokedex.trainer_id', true), '')::INTEGER
$$;


-- ---------------------------------------------------------------- authentication functions
-- SECURITY DEFINER so a guest can sign up / sign in without any privilege on
-- trainer itself. Password hashing and checking happen in the backend (bcrypt).

CREATE FUNCTION fn_register_trainer(p_username VARCHAR, p_email VARCHAR, p_password_hash VARCHAR)
RETURNS INTEGER
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
    INSERT INTO trainer (account_username, email_address, encrypted_password_hash, system_access_role)
    VALUES (p_username, p_email, p_password_hash, 'competitor')   -- sign-up never creates admins
    RETURNING trainer_identification_number
$$;

CREATE FUNCTION fn_get_login_credentials(p_username_or_email VARCHAR)
RETURNS TABLE (trainer_id INTEGER, account_username VARCHAR, password_hash VARCHAR, access_role VARCHAR)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT trainer_identification_number, account_username, encrypted_password_hash, system_access_role
    FROM trainer
    WHERE lower(account_username) = lower(p_username_or_email)
       OR lower(email_address)    = lower(p_username_or_email)
$$;

REVOKE EXECUTE ON FUNCTION fn_register_trainer(VARCHAR, VARCHAR, VARCHAR) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION fn_get_login_credentials(VARCHAR)               FROM PUBLIC;
REVOKE EXECUTE ON PROCEDURE sp_refresh_usage_statistics()                   FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION fn_register_trainer(VARCHAR, VARCHAR, VARCHAR) TO pokedex_guest;
GRANT  EXECUTE ON FUNCTION fn_get_login_credentials(VARCHAR)               TO pokedex_guest;
GRANT  EXECUTE ON PROCEDURE sp_refresh_usage_statistics()                   TO pokedex_admin;


-- ---------------------------------------------------------------- table privileges

-- guest: the Pokédex, formats and public statistics
GRANT SELECT ON
    elemental_type, type_matchup_matrix, pokemon_species, pokemon_elemental_types,
    special_ability, species_possible_abilities, combat_move, species_learnable_moves,
    held_item, statistical_nature, battle_format, format_banned_species,
    v_species_profile, v_move_catalog, v_species_type_defense, mv_species_usage_stats
TO pokedex_guest;

-- competitor: public trainer columns (no e-mail, no password hash) and their teams
GRANT SELECT (trainer_identification_number, account_username, system_access_role, account_creation_timestamp)
    ON trainer TO pokedex_competitor;
GRANT SELECT, INSERT, DELETE ON competitive_team TO pokedex_competitor;
GRANT UPDATE (team_name, battle_format_id, team_status) ON competitive_team TO pokedex_competitor;
GRANT SELECT, INSERT, UPDATE, DELETE ON individual_team_member, member_equipped_moves TO pokedex_competitor;
GRANT SELECT ON v_team_overview, v_team_member_detail TO pokedex_competitor;

-- admin: formats, bans and trainer moderation
GRANT INSERT, UPDATE, DELETE ON battle_format, format_banned_species TO pokedex_admin;
GRANT SELECT (email_address) ON trainer TO pokedex_admin;
GRANT UPDATE (system_access_role) ON trainer TO pokedex_admin;
GRANT DELETE ON trainer TO pokedex_admin;


-- ---------------------------------------------------------------- row-level security

ALTER TABLE competitive_team       ENABLE ROW LEVEL SECURITY;
ALTER TABLE individual_team_member ENABLE ROW LEVEL SECURITY;
ALTER TABLE member_equipped_moves  ENABLE ROW LEVEL SECURITY;

-- competitive_team
CREATE POLICY team_read_own_or_published ON competitive_team
    FOR SELECT TO pokedex_competitor
    USING (owned_by_trainer_id = app_current_trainer_id() OR team_status = 'validated');

CREATE POLICY team_insert_own ON competitive_team
    FOR INSERT TO pokedex_competitor
    WITH CHECK (owned_by_trainer_id = app_current_trainer_id());

CREATE POLICY team_update_own ON competitive_team
    FOR UPDATE TO pokedex_competitor
    USING      (owned_by_trainer_id = app_current_trainer_id())
    WITH CHECK (owned_by_trainer_id = app_current_trainer_id());

CREATE POLICY team_delete_own ON competitive_team
    FOR DELETE TO pokedex_competitor
    USING (owned_by_trainer_id = app_current_trainer_id());

CREATE POLICY team_admin_read_all ON competitive_team
    FOR SELECT TO pokedex_admin USING (true);

CREATE POLICY team_admin_delete_all ON competitive_team
    FOR DELETE TO pokedex_admin USING (true);

-- individual_team_member: visible when its team is visible (the subquery is
-- itself filtered by the competitive_team policies), writable only on own teams
CREATE POLICY member_read_visible_team ON individual_team_member
    FOR SELECT TO pokedex_competitor
    USING (belongs_to_team_id IN (SELECT team_identification_number FROM competitive_team));

CREATE POLICY member_write_own_team ON individual_team_member
    FOR ALL TO pokedex_competitor
    USING (EXISTS (SELECT 1 FROM competitive_team t
                   WHERE t.team_identification_number = belongs_to_team_id
                     AND t.owned_by_trainer_id = app_current_trainer_id()))
    WITH CHECK (EXISTS (SELECT 1 FROM competitive_team t
                        WHERE t.team_identification_number = belongs_to_team_id
                          AND t.owned_by_trainer_id = app_current_trainer_id()));

-- member_equipped_moves: same rules, one hop further
CREATE POLICY moves_read_visible_member ON member_equipped_moves
    FOR SELECT TO pokedex_competitor
    USING (member_identification_number IN (SELECT member_identification_number FROM individual_team_member));

CREATE POLICY moves_write_own_member ON member_equipped_moves
    FOR ALL TO pokedex_competitor
    USING (EXISTS (SELECT 1 FROM individual_team_member m
                   JOIN competitive_team t ON t.team_identification_number = m.belongs_to_team_id
                   WHERE m.member_identification_number = member_equipped_moves.member_identification_number
                     AND t.owned_by_trainer_id = app_current_trainer_id()))
    WITH CHECK (EXISTS (SELECT 1 FROM individual_team_member m
                        JOIN competitive_team t ON t.team_identification_number = m.belongs_to_team_id
                        WHERE m.member_identification_number = member_equipped_moves.member_identification_number
                          AND t.owned_by_trainer_id = app_current_trainer_id()));
