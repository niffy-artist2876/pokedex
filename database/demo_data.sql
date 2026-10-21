-- Demo data for presentations and for database/queries/important_queries.sql.
-- Loaded by: python database/setup_db.py --demo   (after the reference data is seeded)
--
-- Trainers (all with the demo password  Pokedex@123 , bcrypt-hashed by pgcrypto):
--   oak    admin       ash, misty, brock    competitors
-- Formats: VGC Regulation G, Singles OU, Little Cup, Legacy Doubles (inactive)
-- Teams:   3 validated, 2 drafts

CREATE EXTENSION IF NOT EXISTS pgcrypto;


-- ---------------------------------------------------------------- trainers

INSERT INTO trainer (account_username, email_address, encrypted_password_hash, system_access_role)
SELECT u.username, u.username || '@pokedex.test', crypt('Pokedex@123', gen_salt('bf', 10)), u.role
FROM (VALUES ('oak', 'admin'), ('ash', 'competitor'), ('misty', 'competitor'), ('brock', 'competitor'))
     AS u (username, role);


-- ---------------------------------------------------------------- formats and bans

INSERT INTO battle_format (format_name, level_cap, ruleset_description, managed_by_trainer_id,
                           minimum_team_size, maximum_legendary_members, is_active)
SELECT f.name, f.cap, f.rules, oak.trainer_identification_number, f.min_size, f.max_legends, f.active
FROM trainer oak
CROSS JOIN (VALUES
    ('VGC Regulation G', 50,  'Doubles, bring 6 pick 4, one restricted legendary, no mythicals.', 4, 1,    TRUE),
    ('Singles OU',       100, 'Singles 6v6, legendary and mythical Pokémon banned.',               1, 0,    TRUE),
    ('Little Cup',       5,   'Level 5, only Pokémon that are unevolved and able to evolve.',      1, NULL, TRUE),
    ('Legacy Doubles',   50,  'Retired ruleset kept for history.',                                 4, NULL, FALSE)
) AS f (name, cap, rules, min_size, max_legends, active)
WHERE oak.account_username = 'oak';

-- VGC: no mythicals
INSERT INTO format_banned_species (format_identification_number, species_national_pokedex_number)
SELECT f.format_identification_number, s.species_national_pokedex_number
FROM battle_format f, pokemon_species s
WHERE f.format_name = 'VGC Regulation G' AND s.is_mythical;

-- OU: no legendaries or mythicals
INSERT INTO format_banned_species (format_identification_number, species_national_pokedex_number)
SELECT f.format_identification_number, s.species_national_pokedex_number
FROM battle_format f, pokemon_species s
WHERE f.format_name = 'Singles OU' AND (s.is_legendary OR s.is_mythical);

-- Little Cup: ban anything that has evolved, or that never evolves
INSERT INTO format_banned_species (format_identification_number, species_national_pokedex_number)
SELECT f.format_identification_number, s.species_national_pokedex_number
FROM battle_format f, pokemon_species s
WHERE f.format_name = 'Little Cup'
  AND (s.evolves_from_species_id IS NOT NULL
       OR NOT EXISTS (SELECT 1 FROM pokemon_species nxt
                      WHERE nxt.evolves_from_species_id = s.species_national_pokedex_number));


-- ---------------------------------------------------------------- helpers (session-only)

CREATE FUNCTION pg_temp.new_team(p_owner TEXT, p_format TEXT, p_name TEXT) RETURNS INTEGER
LANGUAGE sql AS $$
    INSERT INTO competitive_team (owned_by_trainer_id, battle_format_id, team_name)
    SELECT t.trainer_identification_number, f.format_identification_number, p_name
    FROM trainer t, battle_format f
    WHERE t.account_username = p_owner AND f.format_name = p_format
    RETURNING team_identification_number
$$;

-- Adds a member by names; EVs are {hp, atk, def, spa, spd, spe}.
CREATE FUNCTION pg_temp.add_member(
    p_team INTEGER, p_slot INTEGER, p_species TEXT, p_ability TEXT, p_item TEXT, p_nature TEXT,
    p_tera TEXT, p_level INTEGER, p_evs INTEGER[], p_moves TEXT[]
) RETURNS VOID
LANGUAGE plpgsql AS $$
DECLARE
    v_member INTEGER;
    v_i      INTEGER;
BEGIN
    INSERT INTO individual_team_member (
        belongs_to_team_id, team_slot_number, base_species_id, assigned_ability_id, assigned_held_item_id,
        assigned_nature_id, terastallize_type_id, experience_level,
        effort_value_hit_points, effort_value_attack, effort_value_defense,
        effort_value_special_attack, effort_value_special_defense, effort_value_speed)
    VALUES (
        p_team, p_slot,
        (SELECT species_national_pokedex_number FROM pokemon_species WHERE species_name = p_species),
        (SELECT ability_identification_number   FROM special_ability WHERE ability_name = p_ability),
        (SELECT item_identification_number      FROM held_item       WHERE item_name    = p_item),
        (SELECT nature_identification_number    FROM statistical_nature WHERE nature_name = p_nature),
        (SELECT elemental_type_identification_number FROM elemental_type WHERE type_name = p_tera),
        p_level, p_evs[1], p_evs[2], p_evs[3], p_evs[4], p_evs[5], p_evs[6])
    RETURNING member_identification_number INTO v_member;

    FOR v_i IN 1 .. cardinality(p_moves) LOOP
        INSERT INTO member_equipped_moves (member_identification_number, move_identification_number, move_slot_number)
        SELECT v_member, move_identification_number, v_i FROM combat_move WHERE move_name = p_moves[v_i];
        IF NOT FOUND THEN
            RAISE EXCEPTION 'unknown move %', p_moves[v_i];
        END IF;
    END LOOP;
END;
$$;


-- ---------------------------------------------------------------- teams

DO $$
DECLARE
    t INTEGER;
BEGIN
    -- ash: rain offense for VGC (one legendary: Kyogre)
    t := pg_temp.new_team('ash', 'VGC Regulation G', 'Rain Dance');
    PERFORM pg_temp.add_member(t, 1, 'Pelipper',   'Drizzle',     'Focus Sash',     'Modest',  'Water',  50, '{252,0,4,252,0,0}',   '{Hurricane,Weather Ball,Tailwind,Protect}');
    PERFORM pg_temp.add_member(t, 2, 'Kingdra',    'Swift Swim',  'Life Orb',       'Modest',  'Dragon', 50, '{4,0,0,252,0,252}',   '{Muddy Water,Draco Meteor,Hurricane,Protect}');
    PERFORM pg_temp.add_member(t, 3, 'Amoonguss',  'Regenerator', 'Sitrus Berry',   'Relaxed', 'Water',  50, '{252,0,252,0,4,0}',   '{Spore,Rage Powder,Pollen Puff,Protect}');
    PERFORM pg_temp.add_member(t, 4, 'Incineroar', 'Intimidate',  'Safety Goggles', 'Careful', 'Ghost',  50, '{252,4,0,0,252,0}',   '{Fake Out,Parting Shot,Flare Blitz,Knock Off}');
    PERFORM pg_temp.add_member(t, 5, 'Kyogre',     'Drizzle',     'Mystic Water',   'Modest',  'Water',  50, '{252,0,0,252,4,0}',   '{Water Spout,Origin Pulse,Ice Beam,Protect}');
    CALL sp_validate_team(t);

    -- ash: an unfinished draft
    t := pg_temp.new_team('ash', 'VGC Regulation G', 'Work in Progress');
    PERFORM pg_temp.add_member(t, 1, 'Pelipper',   'Drizzle',     'Leftovers',      'Bold',    'Ground', 50, '{252,0,252,0,4,0}',   '{Hurricane,Tailwind}');

    -- misty: sun team for VGC (one legendary: Koraidon)
    t := pg_temp.new_team('misty', 'VGC Regulation G', 'Sun Room');
    PERFORM pg_temp.add_member(t, 1, 'Torkoal',      'Drought',          'Charcoal',       'Quiet',   'Fire',  50, '{252,0,4,252,0,0}', '{Eruption,Heat Wave,Earth Power,Protect}');
    PERFORM pg_temp.add_member(t, 2, 'Venusaur',     'Chlorophyll',      'Miracle Seed',   'Modest',  'Grass', 50, '{4,0,0,252,0,252}', '{Giga Drain,Sludge Bomb,Sleep Powder,Protect}');
    PERFORM pg_temp.add_member(t, 3, 'Flutter Mane', 'Protosynthesis',   'Booster Energy', 'Timid',   'Fairy', 50, '{4,0,0,252,0,252}', '{Moonblast,Shadow Ball,Dazzling Gleam,Protect}');
    PERFORM pg_temp.add_member(t, 4, 'Koraidon',     'Orichalcum Pulse', 'Life Orb',       'Adamant', 'Fire',  50, '{4,252,0,0,0,252}', '{Flare Blitz,Collision Course,Drain Punch,Protect}');
    CALL sp_validate_team(t);

    -- brock: singles OU at level 100
    t := pg_temp.new_team('brock', 'Singles OU', 'Rock Solid');
    PERFORM pg_temp.add_member(t, 1, 'Garchomp',    'Rough Skin',   'Rocky Helmet', 'Jolly',   'Steel',  100, '{4,252,0,0,0,252}',   '{Earthquake,Stealth Rock,Dragon Tail,Spikes}');
    PERFORM pg_temp.add_member(t, 2, 'Tyranitar',   'Sand Stream',  'Smooth Rock',  'Adamant', 'Rock',   100, '{252,252,0,0,4,0}',   '{Stone Edge,Crunch,Earthquake,Stealth Rock}');
    PERFORM pg_temp.add_member(t, 3, 'Corviknight', 'Pressure',     'Leftovers',    'Impish',  'Dragon', 100, '{252,0,168,0,88,0}',  '{Brave Bird,Roost,Defog,U-turn}');
    PERFORM pg_temp.add_member(t, 4, 'Gholdengo',   'Good as Gold', 'Choice Scarf', 'Timid',   'Steel',  100, '{0,0,4,252,0,252}',   '{Make It Rain,Shadow Ball,Trick,Nasty Plot}');
    CALL sp_validate_team(t);

    -- brock: Little Cup draft
    t := pg_temp.new_team('brock', 'Little Cup', 'Baby Steps');
    PERFORM pg_temp.add_member(t, 1, 'Pichu',   'Lightning Rod', 'Eviolite',     'Timid',   'Electric', 5, '{0,0,0,252,0,252}', '{Thunderbolt,Volt Switch,Nasty Plot,Protect}');
    PERFORM pg_temp.add_member(t, 2, 'Gastly',  'Levitate',      'Focus Sash',   'Timid',   'Ghost',    5, '{0,0,0,252,0,252}', '{Shadow Ball,Sludge Bomb,Hypnosis,Protect}');
    PERFORM pg_temp.add_member(t, 3, 'Mudbray', 'Own Tempo',     'Sitrus Berry', 'Adamant', 'Ground',   5, '{252,252,0,0,4,0}', '{High Horsepower,Rock Slide,Protect}');
END;
$$;
