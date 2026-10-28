--- 008: vector search (pgvector)
--   * description_embedding on moves / abilities: 384-dimension MiniLM embeddings,
--     filled by `seed.py --embed`, with HNSW cosine indexes.
--   * team_profile_vector: 42-dimension team summary kept current by trigger
--     (1-18 share of members per type, 19-36 average damage taken per
--     attacking type, 37-42 average base stats), all scaled to 0-1.

CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE combat_move ADD COLUMN description_embedding vector(384);
ALTER TABLE special_ability ADD COLUMN description_embedding vector(384);
ALTER TABLE competitive_team ADD COLUMN team_profile_vector vector(42);

CREATE INDEX idx_move_embedding ON combat_move USING hnsw (description_embedding vector_cosine_ops);
CREATE INDEX idx_ability_embedding ON special_ability USING hnsw (description_embedding vector_cosine_ops);
CREATE FUNCTION fn_team_profile_vector(p_team_id INTEGER) RETURNS vector
LANGUAGE sql STABLE AS $$
    WITH m AS (
        SELECT base_species_id AS species_id FROM individual_team_member WHERE belongs_to_team_id = p_team_id
    ), dims AS (
        SELECT t.elemental_type_identification_number AS dim,
               avg((pet.species_national_pokedex_number IS NOT NULL)::INTEGER)::float8 AS v
        FROM elemental_type t CROSS JOIN m
        LEFT JOIN pokemon_elemental_types pet
               ON pet.species_national_pokedex_number      = m.species_id
              AND pet.elemental_type_identification_number = t.elemental_type_identification_number
        GROUP BY t.elemental_type_identification_number
        UNION ALL
        SELECT 18 + t.elemental_type_identification_number,
               avg(fn_type_effectiveness(t.elemental_type_identification_number, m.species_id))::float8 / 4
        FROM elemental_type t CROSS JOIN m
        GROUP BY t.elemental_type_identification_number
        UNION ALL
        SELECT 36 + s.n, avg(s.v)::float8 / 255
        FROM m JOIN pokemon_species p ON p.species_national_pokedex_number = m.species_id
        CROSS JOIN LATERAL (VALUES (1, p.base_hit_points), (2, p.base_attack), (3, p.base_defense),
                                   (4, p.base_special_attack), (5, p.base_special_defense), (6, p.base_speed)) s (n, v)
        GROUP BY s.n
    )
    SELECT array_agg(v ORDER BY dim)::vector FROM dims   -- NULL for a team with no members
$$;

CREATE FUNCTION refresh_team_profile_vector() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
    UPDATE competitive_team
    SET team_profile_vector = fn_team_profile_vector(team_identification_number)
    WHERE team_identification_number IN (OLD.belongs_to_team_id, NEW.belongs_to_team_id);
    RETURN NULL;
END;
$$;

CREATE TRIGGER trg_member_refreshes_team_profile
    AFTER INSERT OR DELETE OR UPDATE OF base_species_id, belongs_to_team_id ON individual_team_member
    FOR EACH ROW EXECUTE FUNCTION refresh_team_profile_vector();

UPDATE competitive_team SET team_profile_vector = fn_team_profile_vector(team_identification_number);

-- p_query is the embedding of the user's search text, computed by the backend
-- with the same model seed.py uses.
CREATE FUNCTION fn_search_moves_semantic(p_query vector, p_limit INTEGER DEFAULT 10)
RETURNS TABLE (move_id INTEGER, move_name TEXT, similarity NUMERIC)
LANGUAGE sql STABLE AS $$
    SELECT move_identification_number, move_name::TEXT,
           round((1 - (description_embedding <=> p_query))::NUMERIC, 3)
    FROM combat_move
    WHERE description_embedding IS NOT NULL
    ORDER BY description_embedding <=> p_query
    LIMIT p_limit
$$;

-- SECURITY INVOKER (the default) on purpose: RLS still applies, so a competitor
-- only gets back teams they could already read.
CREATE FUNCTION fn_similar_teams(p_team_id INTEGER, p_limit INTEGER DEFAULT 5)
RETURNS TABLE (team_id INTEGER, team_name TEXT, similarity NUMERIC)
LANGUAGE sql STABLE AS $$
    WITH q AS (SELECT team_profile_vector AS v FROM competitive_team WHERE team_identification_number = p_team_id)
    SELECT t.team_identification_number, t.team_name::TEXT,
           round((1 - (t.team_profile_vector <=> q.v))::NUMERIC, 3)
    FROM competitive_team t, q
    WHERE t.team_identification_number <> p_team_id AND t.team_profile_vector IS NOT NULL
    ORDER BY t.team_profile_vector <=> q.v
    LIMIT p_limit
$$;

REVOKE EXECUTE ON FUNCTION fn_similar_teams(INTEGER, INTEGER) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION fn_similar_teams(INTEGER, INTEGER) TO pokedex_competitor;