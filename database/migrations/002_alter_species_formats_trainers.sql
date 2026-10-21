-- 002: extend the base schema on a live database with ALTER TABLE.
--   * species: generation, legendary/mythical flags and evolution links
--     (evolves_from is a self-reference, used by the recursive evolution queries)
--   * battle_format: team-size and legendary limits checked by sp_validate_team
--   * trainer: input validation for usernames, e-mails and password hashes


-- ---------------------------------------------------------------- species

ALTER TABLE pokemon_species
    ADD COLUMN generation_number       INTEGER CHECK (generation_number > 0),
    ADD COLUMN is_legendary            BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN is_mythical             BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN evolves_from_species_id INTEGER REFERENCES pokemon_species (species_national_pokedex_number),
    ADD COLUMN evolution_method        VARCHAR(30),   -- PokeAPI trigger: level-up, trade, use-item, ...
    ADD COLUMN evolution_minimum_level INTEGER CHECK (evolution_minimum_level BETWEEN 1 AND 100);

ALTER TABLE pokemon_species
    ADD CONSTRAINT chk_species_not_own_prevo
        CHECK (evolves_from_species_id <> species_national_pokedex_number),
    ADD CONSTRAINT chk_evolution_details_need_prevo
        CHECK (evolves_from_species_id IS NOT NULL
               OR (evolution_method IS NULL AND evolution_minimum_level IS NULL));

CREATE INDEX idx_species_evolves_from ON pokemon_species (evolves_from_species_id);


-- ---------------------------------------------------------------- battle formats

ALTER TABLE battle_format
    ADD COLUMN minimum_team_size         INTEGER NOT NULL DEFAULT 1
        CHECK (minimum_team_size BETWEEN 1 AND 6),
    ADD COLUMN maximum_legendary_members INTEGER                       -- NULL = no limit
        CHECK (maximum_legendary_members BETWEEN 0 AND 6);


-- ---------------------------------------------------------------- trainers

ALTER TABLE trainer
    ADD CONSTRAINT chk_trainer_username_format
        CHECK (account_username ~ '^[A-Za-z0-9_]{3,40}$'),
    ADD CONSTRAINT chk_trainer_email_format
        CHECK (email_address ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
    ADD CONSTRAINT chk_trainer_password_is_bcrypt
        CHECK (encrypted_password_hash ~ '^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$');

-- "Ash" and "ash" must not be two different accounts.
CREATE UNIQUE INDEX uq_trainer_username_ci ON trainer (lower(account_username));
CREATE UNIQUE INDEX uq_trainer_email_ci    ON trainer (lower(email_address));
