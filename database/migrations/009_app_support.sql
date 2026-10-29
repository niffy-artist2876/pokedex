-- 009: database support for the web application.
--   * fn_get_trainer_session: the backend re-reads the trainer's current role on
--     every request, so a demotion or deletion takes effect immediately
--   * admins may edit move / ability descriptions and their embeddings (the
--     "update / delete" side of the vector feature); editing a description
--     without supplying a new embedding clears the stale vector
--   * semantic search over abilities, mirroring fn_search_moves_semantic
--   * fn_species_evolution_line: the whole evolution family of a species


-- ---------------------------------------------------------------- sessions

CREATE FUNCTION fn_get_trainer_session(p_trainer_id INTEGER)
RETURNS TABLE (trainer_id INTEGER, account_username VARCHAR, access_role VARCHAR)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT trainer_identification_number, account_username, system_access_role
    FROM trainer
    WHERE trainer_identification_number = p_trainer_id
$$;

REVOKE EXECUTE ON FUNCTION fn_get_trainer_session(INTEGER) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION fn_get_trainer_session(INTEGER) TO pokedex_guest;


-- ---------------------------------------------------------------- description and embedding edits

GRANT UPDATE (move_effect_description, description_embedding)       ON combat_move     TO pokedex_admin;
GRANT UPDATE (ability_effect_description, description_embedding)    ON special_ability TO pokedex_admin;

CREATE FUNCTION clear_stale_description_embedding() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    -- the embedding describes the old text; drop it unless a new one came with the edit
    NEW.description_embedding := NULL;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_move_description_changed
    BEFORE UPDATE OF move_effect_description ON combat_move
    FOR EACH ROW
    WHEN (NEW.move_effect_description IS DISTINCT FROM OLD.move_effect_description
          AND NEW.description_embedding IS NOT DISTINCT FROM OLD.description_embedding)
    EXECUTE FUNCTION clear_stale_description_embedding();

CREATE TRIGGER trg_ability_description_changed
    BEFORE UPDATE OF ability_effect_description ON special_ability
    FOR EACH ROW
    WHEN (NEW.ability_effect_description IS DISTINCT FROM OLD.ability_effect_description
          AND NEW.description_embedding IS NOT DISTINCT FROM OLD.description_embedding)
    EXECUTE FUNCTION clear_stale_description_embedding();


-- ---------------------------------------------------------------- semantic ability search

CREATE FUNCTION fn_search_abilities_semantic(p_query vector, p_limit INTEGER DEFAULT 10)
RETURNS TABLE (ability_id INTEGER, ability_name TEXT, similarity NUMERIC)
LANGUAGE sql STABLE AS $$
    SELECT ability_identification_number, ability_name::TEXT,
           round((1 - (description_embedding <=> p_query))::NUMERIC, 3)
    FROM special_ability
    WHERE description_embedding IS NOT NULL
    ORDER BY description_embedding <=> p_query
    LIMIT p_limit
$$;


-- ---------------------------------------------------------------- evolution line

-- Every species in the same family: walk up to the root, then down all branches.
CREATE FUNCTION fn_species_evolution_line(p_species_id INTEGER)
RETURNS TABLE (species_id INTEGER, species_name VARCHAR, stage INTEGER, evolves_from_species_id INTEGER,
               evolution_method VARCHAR, evolution_minimum_level INTEGER)
LANGUAGE sql STABLE AS $$
    WITH RECURSIVE up AS (
        SELECT species_national_pokedex_number AS id, evolves_from_species_id AS parent
        FROM pokemon_species WHERE species_national_pokedex_number = p_species_id
      UNION ALL
        SELECT s.species_national_pokedex_number, s.evolves_from_species_id
        FROM pokemon_species s JOIN up ON s.species_national_pokedex_number = up.parent
    ),
    down AS (
        SELECT id, 1 AS stage FROM up WHERE parent IS NULL
      UNION ALL
        SELECT s.species_national_pokedex_number, d.stage + 1
        FROM pokemon_species s JOIN down d ON s.evolves_from_species_id = d.id
    )
    SELECT s.species_national_pokedex_number, s.species_name, d.stage, s.evolves_from_species_id,
           s.evolution_method, s.evolution_minimum_level
    FROM down d JOIN pokemon_species s ON s.species_national_pokedex_number = d.id
    ORDER BY d.stage, s.species_national_pokedex_number
$$;
