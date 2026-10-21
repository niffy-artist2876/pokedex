-- 005: views.
-- Reference-data views flatten the normalized tables for browsing. Team views
-- are security_invoker so the row-level security from 007 still applies when a
-- competitor reads through them (a plain view would run as its owner and
-- bypass RLS). mv_species_usage_stats is materialized because it aggregates
-- every validated team and is refreshed on demand by an admin.


-- One row per species: types, stats, total, abilities and pre-evolution.
CREATE VIEW v_species_profile AS
SELECT s.species_national_pokedex_number AS species_id,
       s.species_name,
       t1.type_name                       AS primary_type,
       t2.type_name                       AS secondary_type,
       s.base_hit_points, s.base_attack, s.base_defense,
       s.base_special_attack, s.base_special_defense, s.base_speed,
       s.base_hit_points + s.base_attack + s.base_defense
         + s.base_special_attack + s.base_special_defense + s.base_speed AS base_stat_total,
       s.generation_number,
       s.is_legendary,
       s.is_mythical,
       prevo.species_name                 AS evolves_from,
       (SELECT string_agg(a.ability_name || CASE WHEN spa.is_hidden_ability THEN ' (hidden)' ELSE '' END,
                          ', ' ORDER BY spa.is_hidden_ability, a.ability_name)
          FROM species_possible_abilities spa
          JOIN special_ability a USING (ability_identification_number)
         WHERE spa.species_national_pokedex_number = s.species_national_pokedex_number) AS abilities
FROM pokemon_species s
JOIN pokemon_elemental_types pt1
  ON pt1.species_national_pokedex_number = s.species_national_pokedex_number AND pt1.type_slot_order = 1
JOIN elemental_type t1
  ON t1.elemental_type_identification_number = pt1.elemental_type_identification_number
LEFT JOIN pokemon_elemental_types pt2
  ON pt2.species_national_pokedex_number = s.species_national_pokedex_number AND pt2.type_slot_order = 2
LEFT JOIN elemental_type t2
  ON t2.elemental_type_identification_number = pt2.elemental_type_identification_number
LEFT JOIN pokemon_species prevo
  ON prevo.species_national_pokedex_number = s.evolves_from_species_id;


-- Moves with their type name.
CREATE VIEW v_move_catalog AS
SELECT m.move_identification_number AS move_id,
       m.move_name,
       t.type_name,
       m.damage_category,
       m.base_power,
       m.accuracy_percentage,
       m.base_power_points,
       m.move_effect_description
FROM combat_move m
JOIN elemental_type t USING (elemental_type_identification_number);


-- How much damage each attacking type does to each species: the product of the
-- matchups against both of its types (so 4x, 2x, 1x, 0.5x, 0.25x or 0x).
CREATE VIEW v_species_type_defense AS
SELECT s.species_national_pokedex_number AS species_id,
       s.species_name,
       atk.elemental_type_identification_number AS attacking_type_id,
       atk.type_name                            AS attacking_type,
       m1.damage_multiplier_value * coalesce(m2.damage_multiplier_value, 1) AS damage_multiplier
FROM pokemon_species s
CROSS JOIN elemental_type atk
JOIN pokemon_elemental_types pt1
  ON pt1.species_national_pokedex_number = s.species_national_pokedex_number AND pt1.type_slot_order = 1
JOIN type_matchup_matrix m1
  ON m1.attacking_type_identification_number = atk.elemental_type_identification_number
 AND m1.defending_type_identification_number = pt1.elemental_type_identification_number
LEFT JOIN pokemon_elemental_types pt2
  ON pt2.species_national_pokedex_number = s.species_national_pokedex_number AND pt2.type_slot_order = 2
LEFT JOIN type_matchup_matrix m2
  ON m2.attacking_type_identification_number = atk.elemental_type_identification_number
 AND m2.defending_type_identification_number = pt2.elemental_type_identification_number;


-- One row per team with owner, format and roll-up figures.
CREATE VIEW v_team_overview WITH (security_invoker = true) AS
SELECT t.team_identification_number AS team_id,
       t.team_name,
       t.team_status,
       tr.trainer_identification_number AS owner_id,
       tr.account_username              AS owner_username,
       f.format_identification_number   AS format_id,
       f.format_name,
       count(m.member_identification_number)                       AS member_count,
       round(avg(m.experience_level), 1)                           AS average_level,
       count(*) FILTER (WHERE s.is_legendary OR s.is_mythical)     AS legendary_members,
       string_agg(s.species_name, ', ' ORDER BY m.team_slot_number) AS roster,
       t.creation_timestamp,
       t.last_modified_timestamp
FROM competitive_team t
JOIN trainer tr      ON tr.trainer_identification_number = t.owned_by_trainer_id
JOIN battle_format f ON f.format_identification_number   = t.battle_format_id
LEFT JOIN individual_team_member m ON m.belongs_to_team_id = t.team_identification_number
LEFT JOIN pokemon_species s        ON s.species_national_pokedex_number = m.base_species_id
GROUP BY t.team_identification_number, tr.trainer_identification_number, f.format_identification_number;


-- One row per team member, with every foreign key resolved to a name.
CREATE VIEW v_team_member_detail WITH (security_invoker = true) AS
SELECT m.belongs_to_team_id AS team_id,
       m.member_identification_number AS member_id,
       m.team_slot_number,
       s.species_name,
       a.ability_name,
       i.item_name,
       n.nature_name,
       tera.type_name AS tera_type,
       m.experience_level,
       m.effort_value_hit_points + m.effort_value_attack + m.effort_value_defense
         + m.effort_value_special_attack + m.effort_value_special_defense + m.effort_value_speed AS total_effort_values,
       (SELECT string_agg(mv.move_name, ' / ' ORDER BY e.move_slot_number)
          FROM member_equipped_moves e
          JOIN combat_move mv USING (move_identification_number)
         WHERE e.member_identification_number = m.member_identification_number) AS moves
FROM individual_team_member m
JOIN pokemon_species s    ON s.species_national_pokedex_number = m.base_species_id
JOIN special_ability a    ON a.ability_identification_number   = m.assigned_ability_id
JOIN statistical_nature n ON n.nature_identification_number    = m.assigned_nature_id
LEFT JOIN held_item i     ON i.item_identification_number      = m.assigned_held_item_id
LEFT JOIN elemental_type tera ON tera.elemental_type_identification_number = m.terastallize_type_id;


-- Usage statistics per format over validated teams (the "metagame" report).
CREATE MATERIALIZED VIEW mv_species_usage_stats AS
WITH validated AS (
    SELECT t.team_identification_number, t.battle_format_id
    FROM competitive_team t
    WHERE t.team_status = 'validated'
),
teams_per_format AS (
    SELECT battle_format_id, count(*) AS team_count
    FROM validated
    GROUP BY battle_format_id
)
SELECT v.battle_format_id               AS format_id,
       m.base_species_id                AS species_id,
       s.species_name,
       count(*)                         AS teams_using,
       round(100.0 * count(*) / tpf.team_count, 1) AS usage_percent
FROM validated v
JOIN individual_team_member m ON m.belongs_to_team_id = v.team_identification_number
JOIN pokemon_species s        ON s.species_national_pokedex_number = m.base_species_id
JOIN teams_per_format tpf     ON tpf.battle_format_id = v.battle_format_id
GROUP BY v.battle_format_id, m.base_species_id, s.species_name, tpf.team_count;

-- A unique index is what allows REFRESH MATERIALIZED VIEW CONCURRENTLY.
CREATE UNIQUE INDEX uq_usage_stats_format_species ON mv_species_usage_stats (format_id, species_id);
