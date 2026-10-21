-- 003: search support.
--   * Full-text search over move / ability / item descriptions: a stored,
--     generated tsvector per row (name weighted above description) + GIN index.
--   * Fuzzy name lookup ("charzard" -> Charizard, autocomplete with ILIKE)
--     through pg_trgm trigram GIN indexes.

CREATE EXTENSION IF NOT EXISTS pg_trgm;


ALTER TABLE combat_move
    ADD COLUMN search_document tsvector GENERATED ALWAYS AS (
        setweight(to_tsvector('english', move_name), 'A') ||
        setweight(to_tsvector('english', coalesce(move_effect_description, '')), 'B')
    ) STORED;

ALTER TABLE special_ability
    ADD COLUMN search_document tsvector GENERATED ALWAYS AS (
        setweight(to_tsvector('english', ability_name), 'A') ||
        setweight(to_tsvector('english', coalesce(ability_effect_description, '')), 'B')
    ) STORED;

ALTER TABLE held_item
    ADD COLUMN search_document tsvector GENERATED ALWAYS AS (
        setweight(to_tsvector('english', item_name), 'A') ||
        setweight(to_tsvector('english', coalesce(item_effect_description, '')), 'B')
    ) STORED;

CREATE INDEX idx_move_search    ON combat_move     USING gin (search_document);
CREATE INDEX idx_ability_search ON special_ability USING gin (search_document);
CREATE INDEX idx_item_search    ON held_item       USING gin (search_document);


CREATE INDEX idx_species_name_trgm ON pokemon_species USING gin (species_name gin_trgm_ops);
CREATE INDEX idx_move_name_trgm    ON combat_move     USING gin (move_name    gin_trgm_ops);
CREATE INDEX idx_ability_name_trgm ON special_ability USING gin (ability_name gin_trgm_ops);
CREATE INDEX idx_item_name_trgm    ON held_item       USING gin (item_name    gin_trgm_ops);
