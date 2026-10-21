-- Important queries for the Pokedex & Competitive Team Management database.
-- Run after: python database/setup_db.py --seed --demo
--     psql -U postgres -d pokedex -f database/queries/important_queries.sql
-- Each query is labelled with the concept it demonstrates; the app's features
-- (Pokédex browser, team builder, analysis dashboard, admin pages) are built on
-- these. Sample output: important_queries_output.txt next to this file.

\pset footer off


-- =====================================================================
-- A. JOINS
-- =====================================================================

\echo '== Q1  Multi-table JOIN: species card (types, stats, abilities) =='
SELECT s.species_name,
       string_agg(DISTINCT t.type_name, '/')  AS types,
       s.base_hit_points AS hp, s.base_attack AS atk, s.base_defense AS def,
       s.base_special_attack AS spa, s.base_special_defense AS spd, s.base_speed AS spe,
       string_agg(DISTINCT a.ability_name || CASE WHEN spa.is_hidden_ability THEN ' (H)' ELSE '' END, ', ') AS abilities
FROM pokemon_species s
JOIN pokemon_elemental_types pt   ON pt.species_national_pokedex_number = s.species_national_pokedex_number
JOIN elemental_type t             ON t.elemental_type_identification_number = pt.elemental_type_identification_number
JOIN species_possible_abilities spa ON spa.species_national_pokedex_number = s.species_national_pokedex_number
JOIN special_ability a            ON a.ability_identification_number = spa.ability_identification_number
WHERE s.species_name IN ('Garchomp', 'Gholdengo', 'Amoonguss')
GROUP BY s.species_national_pokedex_number
ORDER BY s.species_name;

\echo '== Q2  JOIN across 7 tables: full team sheet for "Rain Dance" =='
SELECT m.team_slot_number AS slot, s.species_name, a.ability_name, i.item_name, n.nature_name,
       tera.type_name AS tera, m.experience_level AS lvl,
       string_agg(mv.move_name, ' / ' ORDER BY e.move_slot_number) AS moves
FROM competitive_team ct
JOIN individual_team_member m ON m.belongs_to_team_id = ct.team_identification_number
JOIN pokemon_species s        ON s.species_national_pokedex_number = m.base_species_id
JOIN special_ability a        ON a.ability_identification_number = m.assigned_ability_id
JOIN statistical_nature n     ON n.nature_identification_number = m.assigned_nature_id
LEFT JOIN held_item i         ON i.item_identification_number = m.assigned_held_item_id
LEFT JOIN elemental_type tera ON tera.elemental_type_identification_number = m.terastallize_type_id
LEFT JOIN member_equipped_moves e ON e.member_identification_number = m.member_identification_number
LEFT JOIN combat_move mv      ON mv.move_identification_number = e.move_identification_number
WHERE ct.team_name = 'Rain Dance'
GROUP BY m.member_identification_number, s.species_name, a.ability_name, i.item_name, n.nature_name, tera.type_name
ORDER BY slot;

\echo '== Q3  LEFT JOIN + IS NULL (anti-join): trainers who have not built any team =='
SELECT tr.account_username, tr.system_access_role
FROM trainer tr
LEFT JOIN competitive_team ct ON ct.owned_by_trainer_id = tr.trainer_identification_number
WHERE ct.team_identification_number IS NULL;

\echo '== Q4  SELF JOIN: species that evolve by trading (pre-evolution -> evolution) =='
SELECT prevo.species_name AS from_species, evo.species_name AS to_species, evo.evolution_method
FROM pokemon_species evo
JOIN pokemon_species prevo ON prevo.species_national_pokedex_number = evo.evolves_from_species_id
WHERE evo.evolution_method = 'trade'
ORDER BY evo.species_national_pokedex_number
LIMIT 8;


-- =====================================================================
-- B. AGGREGATES, GROUP BY, HAVING, ORDER BY
-- =====================================================================

\echo '== Q5  GROUP BY + HAVING: types with more than 60 species, by average stat total =='
SELECT t.type_name,
       count(*)                                AS species_count,
       round(avg(p.base_stat_total), 1)        AS avg_stat_total,
       max(p.base_stat_total)                  AS best_total,
       round(100.0 * count(*) FILTER (WHERE p.is_legendary) / count(*), 1) AS pct_legendary
FROM v_species_profile p
JOIN elemental_type t ON t.type_name IN (p.primary_type, p.secondary_type)
GROUP BY t.type_name
HAVING count(*) > 60
ORDER BY avg_stat_total DESC;

\echo '== Q6  GROUP BY + HAVING: team weaknesses shared by 2+ members of "Rain Dance" =='
SELECT d.attacking_type,
       count(*) FILTER (WHERE d.damage_multiplier > 1)  AS weak,
       count(*) FILTER (WHERE d.damage_multiplier < 1)  AS resist_or_immune,
       string_agg(d.species_name, ', ') FILTER (WHERE d.damage_multiplier > 1) AS weak_members
FROM competitive_team ct
JOIN individual_team_member m  ON m.belongs_to_team_id = ct.team_identification_number
JOIN v_species_type_defense d  ON d.species_id = m.base_species_id
WHERE ct.team_name = 'Rain Dance'
GROUP BY d.attacking_type
HAVING count(*) FILTER (WHERE d.damage_multiplier > 1) >= 2
ORDER BY weak DESC, resist_or_immune;

\echo '== Q7  Aggregates per generation (COUNT, AVG, MAX, FILTER) =='
SELECT generation_number AS gen,
       count(*) AS species,
       count(*) FILTER (WHERE is_legendary OR is_mythical) AS legendary_or_mythical,
       round(avg(base_stat_total), 1) AS avg_total,
       max(base_speed) AS fastest
FROM v_species_profile
GROUP BY generation_number
ORDER BY gen;


-- =====================================================================
-- C. SUBQUERIES: nested, correlated, EXISTS / NOT EXISTS, relational division
-- =====================================================================

\echo '== Q8  Nested subquery: species faster than every member of "Rock Solid" =='
SELECT species_name, base_speed
FROM pokemon_species
WHERE base_speed > ALL (SELECT s.base_speed
                        FROM individual_team_member m
                        JOIN competitive_team ct ON ct.team_identification_number = m.belongs_to_team_id
                        JOIN pokemon_species s   ON s.species_national_pokedex_number = m.base_species_id
                        WHERE ct.team_name = 'Rock Solid')
ORDER BY base_speed DESC
LIMIT 10;

\echo '== Q9  Correlated subquery: strongest species (by stat total) of each primary type =='
SELECT p.primary_type, p.species_name, p.base_stat_total
FROM v_species_profile p
WHERE NOT p.is_legendary AND NOT p.is_mythical
  AND p.base_stat_total = (SELECT max(q.base_stat_total)
                           FROM v_species_profile q
                           WHERE q.primary_type = p.primary_type
                             AND NOT q.is_legendary AND NOT q.is_mythical)
ORDER BY p.primary_type, p.species_name;

\echo '== Q10 Correlated subquery in SELECT: fastest member of each team =='
SELECT ct.team_name,
       (SELECT s.species_name
        FROM individual_team_member m
        JOIN pokemon_species s ON s.species_national_pokedex_number = m.base_species_id
        WHERE m.belongs_to_team_id = ct.team_identification_number
        ORDER BY s.base_speed DESC
        LIMIT 1) AS fastest_member
FROM competitive_team ct
ORDER BY ct.team_identification_number;

\echo '== Q11 Relational division (double NOT EXISTS): species that can learn ALL of Trick Room, Protect and Helping Hand =='
SELECT s.species_name
FROM pokemon_species s
WHERE NOT EXISTS (
    SELECT 1 FROM combat_move wanted
    WHERE wanted.move_name IN ('Trick Room', 'Protect', 'Helping Hand')
      AND NOT EXISTS (SELECT 1 FROM species_learnable_moves l
                      WHERE l.species_national_pokedex_number = s.species_national_pokedex_number
                        AND l.move_identification_number = wanted.move_identification_number))
ORDER BY s.base_attack DESC
LIMIT 10;

\echo '== Q12 IN subquery: abilities held by exactly one species (signature abilities) =='
SELECT a.ability_name, s.species_name
FROM special_ability a
JOIN species_possible_abilities spa USING (ability_identification_number)
JOIN pokemon_species s USING (species_national_pokedex_number)
WHERE a.ability_identification_number IN (SELECT ability_identification_number
                                          FROM species_possible_abilities
                                          GROUP BY ability_identification_number
                                          HAVING count(*) = 1)
ORDER BY a.ability_name
LIMIT 10;


-- =====================================================================
-- D. CTEs: recursive and non-recursive
-- =====================================================================

\echo '== Q13 Recursive CTE: full evolution family of Eevee (walk down the tree) =='
WITH RECURSIVE family AS (
    SELECT species_national_pokedex_number AS id, species_name, 0 AS stage,
           species_name::TEXT AS path
    FROM pokemon_species
    WHERE species_name = 'Eevee'
  UNION ALL
    SELECT s.species_national_pokedex_number, s.species_name, f.stage + 1,
           f.path || ' -> ' || s.species_name
    FROM pokemon_species s
    JOIN family f ON s.evolves_from_species_id = f.id
)
SELECT stage, species_name, path FROM family ORDER BY stage, species_name;

\echo '== Q14 Recursive CTE: walk UP from Pikachu to its root, then back down the whole line =='
WITH RECURSIVE ancestors AS (
    SELECT species_national_pokedex_number AS id, evolves_from_species_id AS parent
    FROM pokemon_species WHERE species_name = 'Pikachu'
  UNION ALL
    SELECT s.species_national_pokedex_number, s.evolves_from_species_id
    FROM pokemon_species s JOIN ancestors a ON s.species_national_pokedex_number = a.parent
),
line AS (
    SELECT id, 1 AS stage FROM ancestors WHERE parent IS NULL
  UNION ALL
    SELECT s.species_national_pokedex_number, l.stage + 1
    FROM pokemon_species s JOIN line l ON s.evolves_from_species_id = l.id
)
SELECT l.stage, s.species_name, s.evolution_method, s.evolution_minimum_level
FROM line l JOIN pokemon_species s ON s.species_national_pokedex_number = l.id
ORDER BY l.stage, s.species_name;

\echo '== Q15 Recursive CTE + aggregate: longest evolution chains =='
WITH RECURSIVE chain AS (
    SELECT species_national_pokedex_number AS root, species_national_pokedex_number AS id, 1 AS depth
    FROM pokemon_species WHERE evolves_from_species_id IS NULL
  UNION ALL
    SELECT c.root, s.species_national_pokedex_number, c.depth + 1
    FROM chain c JOIN pokemon_species s ON s.evolves_from_species_id = c.id
)
SELECT r.species_name AS chain_root, max(c.depth) AS stages, count(*) AS species_in_family
FROM chain c JOIN pokemon_species r ON r.species_national_pokedex_number = c.root
GROUP BY r.species_name
HAVING max(c.depth) = 3
ORDER BY species_in_family DESC, chain_root
LIMIT 8;

\echo '== Q16 Multi-step CTE: offensive coverage of "Sun Room" (types its damaging moves hit super-effectively) =='
WITH team_moves AS (
    SELECT DISTINCT mv.elemental_type_identification_number AS move_type
    FROM competitive_team ct
    JOIN individual_team_member m  ON m.belongs_to_team_id = ct.team_identification_number
    JOIN member_equipped_moves e   ON e.member_identification_number = m.member_identification_number
    JOIN combat_move mv            ON mv.move_identification_number = e.move_identification_number
    WHERE ct.team_name = 'Sun Room' AND mv.damage_category <> 'status'
),
coverage AS (
    SELECT tm.defending_type_identification_number AS defending_type,
           max(tm.damage_multiplier_value) AS best_multiplier
    FROM type_matchup_matrix tm
    JOIN team_moves m ON m.move_type = tm.attacking_type_identification_number
    GROUP BY tm.defending_type_identification_number
)
SELECT t.type_name AS defending_type, c.best_multiplier,
       CASE WHEN c.best_multiplier >= 2 THEN 'super effective'
            WHEN c.best_multiplier = 1 THEN 'neutral'
            ELSE 'walled' END AS coverage
FROM coverage c JOIN elemental_type t ON t.elemental_type_identification_number = c.defending_type
ORDER BY c.best_multiplier, t.type_name;


-- =====================================================================
-- E. WINDOW FUNCTIONS and SET OPERATIONS
-- =====================================================================

\echo '== Q17 Window function: speed ranking within each team (RANK, running share) =='
SELECT ct.team_name, s.species_name, s.base_speed,
       rank() OVER (PARTITION BY ct.team_identification_number ORDER BY s.base_speed DESC) AS speed_rank,
       round(100.0 * s.base_speed / sum(s.base_speed) OVER (PARTITION BY ct.team_identification_number), 1) AS pct_of_team_speed
FROM competitive_team ct
JOIN individual_team_member m ON m.belongs_to_team_id = ct.team_identification_number
JOIN pokemon_species s        ON s.species_national_pokedex_number = m.base_species_id
WHERE ct.team_status = 'validated'
ORDER BY ct.team_name, speed_rank;

\echo '== Q18 Window function: top 3 strongest moves of each type (ROW_NUMBER) =='
SELECT type_name, move_name, base_power, damage_category
FROM (SELECT type_name, move_name, base_power, damage_category,
             row_number() OVER (PARTITION BY type_name ORDER BY base_power DESC, move_name) AS rn
      FROM v_move_catalog
      WHERE base_power IS NOT NULL) ranked
WHERE rn <= 3 AND type_name IN ('Fire', 'Water', 'Dragon')
ORDER BY type_name, rn;

\echo '== Q19 Set operations: moves Garchomp can learn that Tyranitar cannot (EXCEPT), and shared ones (INTERSECT) =='
(SELECT 'only Garchomp' AS which, count(*) AS moves FROM (
    SELECT l.move_identification_number FROM species_learnable_moves l
    JOIN pokemon_species s USING (species_national_pokedex_number) WHERE s.species_name = 'Garchomp'
  EXCEPT
    SELECT l.move_identification_number FROM species_learnable_moves l
    JOIN pokemon_species s USING (species_national_pokedex_number) WHERE s.species_name = 'Tyranitar') x)
UNION ALL
(SELECT 'both', count(*) FROM (
    SELECT l.move_identification_number FROM species_learnable_moves l
    JOIN pokemon_species s USING (species_national_pokedex_number) WHERE s.species_name = 'Garchomp'
  INTERSECT
    SELECT l.move_identification_number FROM species_learnable_moves l
    JOIN pokemon_species s USING (species_national_pokedex_number) WHERE s.species_name = 'Tyranitar') y);


-- =====================================================================
-- F. VIEWS, FUNCTIONS, PROCEDURES
-- =====================================================================

\echo '== Q20 View: team overview =='
SELECT team_name, owner_username, format_name, team_status, member_count, legendary_members, roster
FROM v_team_overview ORDER BY team_id;

\echo '== Q21 Function: final level-100 stats of Garchomp in "Rock Solid" (Jolly, 252 Atk / 252 Spe) =='
SELECT f.*
FROM individual_team_member m
JOIN competitive_team ct ON ct.team_identification_number = m.belongs_to_team_id
JOIN pokemon_species s   ON s.species_national_pokedex_number = m.base_species_id
CROSS JOIN LATERAL fn_member_final_stats(m.member_identification_number) f
WHERE ct.team_name = 'Rock Solid' AND s.species_name = 'Garchomp';

\echo '== Q22 Function: weakness report for "Sun Room" =='
SELECT * FROM fn_team_weakness_report((SELECT team_identification_number FROM competitive_team WHERE team_name = 'Sun Room'))
WHERE weak_members > 0;

\echo '== Q23 Materialized view: species usage in VGC Regulation G =='
SELECT u.species_name, u.teams_using, u.usage_percent
FROM mv_species_usage_stats u
JOIN battle_format f ON f.format_identification_number = u.format_id
WHERE f.format_name = 'VGC Regulation G'
ORDER BY u.usage_percent DESC, u.species_name;


-- =====================================================================
-- G. SEARCH
-- =====================================================================

\echo '== Q24 Full-text search: moves matching "restores HP" ranked by relevance =='
SELECT move_name, ts_rank(search_document, q) AS rank, left(move_effect_description, 70) AS description
FROM combat_move, websearch_to_tsquery('english', 'restores HP') q
WHERE search_document @@ q
ORDER BY rank DESC, move_name
LIMIT 8;

\echo '== Q25 Trigram fuzzy search: misspelled "charzard" and "garchomb" =='
SELECT species_name, round(similarity(species_name, 'charzard')::NUMERIC, 2) AS similarity
FROM pokemon_species
WHERE species_name % 'charzard'
UNION ALL
SELECT species_name, round(similarity(species_name, 'garchomb')::NUMERIC, 2)
FROM pokemon_species
WHERE species_name % 'garchomb'
ORDER BY similarity DESC;


-- =====================================================================
-- H. DML inside a TRANSACTION (rolled back, so the demo data is unchanged)
-- =====================================================================

\echo '== Q26 INSERT / UPDATE / DELETE with SAVEPOINT and procedures, then ROLLBACK =='
BEGIN;

-- INSERT ... RETURNING: misty starts a new team
INSERT INTO competitive_team (owned_by_trainer_id, battle_format_id, team_name)
SELECT t.trainer_identification_number, f.format_identification_number, 'Trick Room Test'
FROM trainer t, battle_format f
WHERE t.account_username = 'misty' AND f.format_name = 'VGC Regulation G'
RETURNING team_identification_number, team_name, team_status;

-- CALL with INOUT: clone ash's validated team into misty's account
-- (CALL arguments can't be subqueries, so look the ids up into psql variables first)
SELECT (SELECT team_identification_number FROM competitive_team WHERE team_name = 'Rain Dance') AS source_team,
       (SELECT trainer_identification_number FROM trainer WHERE account_username = 'misty')  AS misty_id
\gset
CALL sp_clone_team(:source_team, :misty_id, 'Rain Dance (copy)', NULL)
\gset
\echo 'cloned into team' :p_new_team_id

-- UPDATE with a subquery: max out Kingdra's speed on the copy (team goes back to draft by trigger)
UPDATE individual_team_member
SET effort_value_speed = 252, effort_value_hit_points = 4
WHERE belongs_to_team_id = :p_new_team_id
  AND base_species_id = (SELECT species_national_pokedex_number FROM pokemon_species WHERE species_name = 'Kingdra');

SAVEPOINT before_delete;
-- DELETE: drop Kyogre from the copy...
DELETE FROM individual_team_member
WHERE belongs_to_team_id = :p_new_team_id
  AND base_species_id = (SELECT species_national_pokedex_number FROM pokemon_species WHERE species_name = 'Kyogre');
SELECT team_name, member_count, roster FROM v_team_overview WHERE team_name = 'Rain Dance (copy)';
-- ...then change our mind
ROLLBACK TO SAVEPOINT before_delete;

CALL sp_validate_team(:p_new_team_id);
SELECT team_name, owner_username, team_status, member_count, roster
FROM v_team_overview WHERE team_name LIKE 'Rain Dance%' OR team_name = 'Trick Room Test'
ORDER BY team_id;

ROLLBACK;
