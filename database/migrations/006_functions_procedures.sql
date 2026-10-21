-- 006: stored functions, procedures and the triggers that keep team status honest.
--
--   fn_calculate_stat            game stat formula (pure, IMMUTABLE)
--   fn_member_final_stats        all six final stats of a team member
--   fn_type_effectiveness        damage multiplier of a type against a species
--   fn_team_weakness_report      per attacking type: who on a team is weak / resists / is immune
--   sp_validate_team             checks a team against its format and marks it validated
--   sp_clone_team                copies a team with all members and moves (one transaction)
--   sp_refresh_usage_statistics  refreshes mv_species_usage_stats
--
-- Team status rules: any change to a team, its members or their moves puts it
-- back to 'draft'; only sp_validate_team may set 'validated'; banning a species
-- demotes validated teams that use it; a format's level cap can't drop below a
-- member that is already registered in it.


-- ---------------------------------------------------------------- stat functions

-- HP  = floor((2B + IV + floor(EV/4)) * L / 100) + L + 10
-- other = floor((floor((2B + IV + floor(EV/4)) * L / 100) + 5) * nature)
CREATE FUNCTION fn_calculate_stat(
    p_base              INTEGER,
    p_individual_value  INTEGER,
    p_effort_value      INTEGER,
    p_level             INTEGER,
    p_nature_multiplier NUMERIC DEFAULT 1.0,
    p_is_hit_points     BOOLEAN DEFAULT FALSE
) RETURNS INTEGER
LANGUAGE sql IMMUTABLE STRICT AS $$
    SELECT CASE
        WHEN p_is_hit_points THEN
            (2 * p_base + p_individual_value + p_effort_value / 4) * p_level / 100 + p_level + 10
        ELSE
            floor(((2 * p_base + p_individual_value + p_effort_value / 4) * p_level / 100 + 5)
                  * p_nature_multiplier)::INTEGER
    END
$$;

CREATE FUNCTION fn_member_final_stats(p_member_id INTEGER)
RETURNS TABLE (stat_name TEXT, base_value INTEGER, effort_value INTEGER,
               individual_value INTEGER, nature_effect TEXT, final_value INTEGER)
LANGUAGE sql STABLE AS $$
    SELECT v.stat_name,
           v.base,
           v.ev,
           v.iv,
           CASE WHEN n.increased_stat_type = v.stat_name THEN '+'
                WHEN n.decreased_stat_type = v.stat_name THEN '-'
                ELSE '' END,
           CASE WHEN v.stat_name = 'hit_points' AND s.species_name = 'Shedinja' THEN 1  -- always 1 HP
                ELSE fn_calculate_stat(
                         v.base, v.iv, v.ev, m.experience_level,
                         CASE WHEN n.increased_stat_type = v.stat_name THEN 1.1
                              WHEN n.decreased_stat_type = v.stat_name THEN 0.9
                              ELSE 1.0 END,
                         v.stat_name = 'hit_points')
           END
    FROM individual_team_member m
    JOIN pokemon_species s    ON s.species_national_pokedex_number = m.base_species_id
    JOIN statistical_nature n ON n.nature_identification_number    = m.assigned_nature_id
    CROSS JOIN LATERAL (VALUES
        (1, 'hit_points',      s.base_hit_points,      m.effort_value_hit_points,      m.individual_value_hit_points),
        (2, 'attack',          s.base_attack,          m.effort_value_attack,          m.individual_value_attack),
        (3, 'defense',         s.base_defense,         m.effort_value_defense,         m.individual_value_defense),
        (4, 'special_attack',  s.base_special_attack,  m.effort_value_special_attack,  m.individual_value_special_attack),
        (5, 'special_defense', s.base_special_defense, m.effort_value_special_defense, m.individual_value_special_defense),
        (6, 'speed',           s.base_speed,           m.effort_value_speed,           m.individual_value_speed)
    ) AS v (stat_order, stat_name, base, ev, iv)
    WHERE m.member_identification_number = p_member_id
    ORDER BY v.stat_order
$$;


-- ---------------------------------------------------------------- type analysis

CREATE FUNCTION fn_type_effectiveness(p_attacking_type_id INTEGER, p_species_id INTEGER)
RETURNS NUMERIC
LANGUAGE sql STABLE STRICT AS $$
    SELECT damage_multiplier
    FROM v_species_type_defense
    WHERE attacking_type_id = p_attacking_type_id AND species_id = p_species_id
$$;

-- Types only; abilities such as Levitate and Terastallization are not modelled.
CREATE FUNCTION fn_team_weakness_report(p_team_id INTEGER)
RETURNS TABLE (attacking_type VARCHAR, weak_members BIGINT, resistant_members BIGINT,
               immune_members BIGINT, members_weak TEXT)
LANGUAGE sql STABLE AS $$
    SELECT d.attacking_type,
           count(*) FILTER (WHERE d.damage_multiplier > 1),
           count(*) FILTER (WHERE d.damage_multiplier > 0 AND d.damage_multiplier < 1),
           count(*) FILTER (WHERE d.damage_multiplier = 0),
           string_agg(d.species_name || ' (' || trim_scale(d.damage_multiplier) || 'x)', ', '
                      ORDER BY d.species_name) FILTER (WHERE d.damage_multiplier > 1)
    FROM individual_team_member m
    JOIN v_species_type_defense d ON d.species_id = m.base_species_id
    WHERE m.belongs_to_team_id = p_team_id
    GROUP BY d.attacking_type_id, d.attacking_type
    ORDER BY 2 DESC, 3, d.attacking_type
$$;


-- ---------------------------------------------------------------- team status triggers

-- Replaces the 001 versions. touch_team_on_update also resets status on a format
-- change and only lets sp_validate_team (which sets pokedex.validating_team) mark
-- a team validated. The member/move versions also reset status to draft, and are
-- SECURITY DEFINER because competitors may not write last_modified_timestamp.
CREATE OR REPLACE FUNCTION touch_team_on_update() RETURNS trigger AS $$
BEGIN
    NEW.last_modified_timestamp := now();
    IF NEW.battle_format_id <> OLD.battle_format_id THEN
        NEW.team_status := 'draft';
    END IF;
    IF NEW.team_status = 'validated' AND OLD.team_status <> 'validated'
       AND current_setting('pokedex.validating_team', true) IS DISTINCT FROM NEW.team_identification_number::TEXT THEN
        RAISE EXCEPTION 'teams can only be marked validated through CALL sp_validate_team(%)',
                        NEW.team_identification_number;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION touch_team_from_member() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
    UPDATE competitive_team
    SET last_modified_timestamp = now(), team_status = 'draft'
    WHERE team_identification_number IN (OLD.belongs_to_team_id, NEW.belongs_to_team_id);
    RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION touch_team_from_move() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
    UPDATE competitive_team
    SET last_modified_timestamp = now(), team_status = 'draft'
    WHERE team_identification_number IN (
        SELECT belongs_to_team_id FROM individual_team_member
        WHERE member_identification_number IN (OLD.member_identification_number, NEW.member_identification_number));
    RETURN NULL;
END;
$$;

-- Banning a species sends every validated team in that format using it back to
-- draft. SECURITY DEFINER because the admin who adds the ban can't update other
-- trainers' teams under row-level security.
CREATE FUNCTION demote_teams_using_banned_species() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
    UPDATE competitive_team t
    SET team_status = 'draft'
    WHERE t.battle_format_id = NEW.format_identification_number
      AND t.team_status = 'validated'
      AND EXISTS (SELECT 1 FROM individual_team_member m
                  WHERE m.belongs_to_team_id = t.team_identification_number
                    AND m.base_species_id = NEW.species_national_pokedex_number);
    RETURN NULL;
END;
$$;

CREATE TRIGGER trg_ban_demotes_teams
    AFTER INSERT ON format_banned_species
    FOR EACH ROW EXECUTE FUNCTION demote_teams_using_banned_species();

CREATE FUNCTION enforce_level_cap_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_offenders INTEGER;
BEGIN
    SELECT count(*) INTO v_offenders
    FROM competitive_team t
    JOIN individual_team_member m ON m.belongs_to_team_id = t.team_identification_number
    WHERE t.battle_format_id = NEW.format_identification_number
      AND m.experience_level > NEW.level_cap;
    IF v_offenders > 0 THEN
        RAISE EXCEPTION 'cannot lower the level cap of "%" to %: % registered member(s) are above it',
                        NEW.format_name, NEW.level_cap, v_offenders;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_level_cap_change
    BEFORE UPDATE OF level_cap ON battle_format
    FOR EACH ROW WHEN (NEW.level_cap < OLD.level_cap)
    EXECUTE FUNCTION enforce_level_cap_change();


-- ---------------------------------------------------------------- procedures

-- Re-checks every format rule (including ones that may have changed since the
-- members were added) and either marks the team validated or raises one error
-- listing every problem. Runs as the caller, so RLS limits it to own teams.
CREATE PROCEDURE sp_validate_team(p_team_id INTEGER)
LANGUAGE plpgsql AS $$
DECLARE
    v_team         competitive_team%ROWTYPE;
    v_format       battle_format%ROWTYPE;
    v_problems     TEXT[] := '{}';
    v_member_count INTEGER;
    v_legendaries  INTEGER;
    r              RECORD;
BEGIN
    SELECT * INTO v_team FROM competitive_team
    WHERE team_identification_number = p_team_id
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'team % does not exist or is not yours', p_team_id;
    END IF;

    SELECT * INTO v_format FROM battle_format
    WHERE format_identification_number = v_team.battle_format_id;

    IF NOT v_format.is_active THEN
        v_problems := v_problems || format('format "%s" is no longer active', v_format.format_name);
    END IF;

    SELECT count(*), count(*) FILTER (WHERE s.is_legendary OR s.is_mythical)
    INTO v_member_count, v_legendaries
    FROM individual_team_member m
    JOIN pokemon_species s ON s.species_national_pokedex_number = m.base_species_id
    WHERE m.belongs_to_team_id = p_team_id;

    IF v_member_count < v_format.minimum_team_size THEN
        v_problems := v_problems || format('needs at least %s members, has %s',
                                           v_format.minimum_team_size, v_member_count);
    END IF;
    IF v_legendaries > v_format.maximum_legendary_members THEN
        v_problems := v_problems || format('at most %s legendary/mythical member(s) allowed, has %s',
                                           v_format.maximum_legendary_members, v_legendaries);
    END IF;

    FOR r IN
        SELECT s.species_name, m.experience_level,
               EXISTS (SELECT 1 FROM format_banned_species b
                       WHERE b.format_identification_number = v_format.format_identification_number
                         AND b.species_national_pokedex_number = m.base_species_id) AS is_banned,
               NOT EXISTS (SELECT 1 FROM member_equipped_moves e
                           WHERE e.member_identification_number = m.member_identification_number) AS has_no_moves
        FROM individual_team_member m
        JOIN pokemon_species s ON s.species_national_pokedex_number = m.base_species_id
        WHERE m.belongs_to_team_id = p_team_id
        ORDER BY m.team_slot_number
    LOOP
        IF r.is_banned THEN
            v_problems := v_problems || format('%s is banned', r.species_name);
        END IF;
        IF r.experience_level > v_format.level_cap THEN
            v_problems := v_problems || format('%s is level %s, cap is %s',
                                               r.species_name, r.experience_level, v_format.level_cap);
        END IF;
        IF r.has_no_moves THEN
            v_problems := v_problems || format('%s knows no moves', r.species_name);
        END IF;
    END LOOP;

    IF cardinality(v_problems) > 0 THEN
        RAISE EXCEPTION 'team "%" is not valid for "%": %',
                        v_team.team_name, v_format.format_name, array_to_string(v_problems, '; ')
              USING ERRCODE = 'check_violation';
    END IF;

    PERFORM set_config('pokedex.validating_team', p_team_id::TEXT, true);
    UPDATE competitive_team SET team_status = 'validated' WHERE team_identification_number = p_team_id;
    PERFORM set_config('pokedex.validating_team', '', true);
END;
$$;

-- Copies a team (e.g. a published validated team) into p_new_owner_id's account.
-- Every insert happens in the caller's transaction, so a failure part-way
-- (name taken, format inactive, ...) leaves nothing behind.
CREATE PROCEDURE sp_clone_team(
    p_source_team_id INTEGER,
    p_new_owner_id   INTEGER,
    p_new_team_name  VARCHAR,
    INOUT p_new_team_id INTEGER DEFAULT NULL
)
LANGUAGE plpgsql AS $$
DECLARE
    v_source     competitive_team%ROWTYPE;
    v_member     individual_team_member%ROWTYPE;
    v_new_member INTEGER;
BEGIN
    SELECT * INTO v_source FROM competitive_team WHERE team_identification_number = p_source_team_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'team % does not exist or is not visible to you', p_source_team_id;
    END IF;

    INSERT INTO competitive_team (owned_by_trainer_id, battle_format_id, team_name)
    VALUES (p_new_owner_id, v_source.battle_format_id, p_new_team_name)
    RETURNING team_identification_number INTO p_new_team_id;

    FOR v_member IN
        SELECT * FROM individual_team_member
        WHERE belongs_to_team_id = p_source_team_id
        ORDER BY team_slot_number
    LOOP
        INSERT INTO individual_team_member (
            belongs_to_team_id, team_slot_number, base_species_id, assigned_ability_id,
            assigned_held_item_id, assigned_nature_id, terastallize_type_id, experience_level,
            effort_value_hit_points, effort_value_attack, effort_value_defense,
            effort_value_special_attack, effort_value_special_defense, effort_value_speed,
            individual_value_hit_points, individual_value_attack, individual_value_defense,
            individual_value_special_attack, individual_value_special_defense, individual_value_speed)
        VALUES (
            p_new_team_id, v_member.team_slot_number, v_member.base_species_id, v_member.assigned_ability_id,
            v_member.assigned_held_item_id, v_member.assigned_nature_id, v_member.terastallize_type_id,
            v_member.experience_level,
            v_member.effort_value_hit_points, v_member.effort_value_attack, v_member.effort_value_defense,
            v_member.effort_value_special_attack, v_member.effort_value_special_defense, v_member.effort_value_speed,
            v_member.individual_value_hit_points, v_member.individual_value_attack, v_member.individual_value_defense,
            v_member.individual_value_special_attack, v_member.individual_value_special_defense,
            v_member.individual_value_speed)
        RETURNING member_identification_number INTO v_new_member;

        INSERT INTO member_equipped_moves (member_identification_number, move_identification_number, move_slot_number)
        SELECT v_new_member, move_identification_number, move_slot_number
        FROM member_equipped_moves
        WHERE member_identification_number = v_member.member_identification_number;
    END LOOP;
END;
$$;

-- SECURITY DEFINER: only the view's owner may refresh it, and admins should be
-- able to without owning it.
CREATE PROCEDURE sp_refresh_usage_statistics()
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_species_usage_stats;
$$;
