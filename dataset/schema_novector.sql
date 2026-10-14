
-- psql -U postgres -d pokedex -v ON_ERROR_STOP=1 -f schema.sql


CREATE TABLE trainer (
    trainer_identification_number INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    account_username              VARCHAR(40)  NOT NULL UNIQUE,
    email_address                 VARCHAR(255) NOT NULL UNIQUE,
    encrypted_password_hash       VARCHAR(100) NOT NULL,
    system_access_role            VARCHAR(20)  NOT NULL
        CHECK (system_access_role IN ('competitor', 'admin')),
    account_creation_timestamp    TIMESTAMP    NOT NULL DEFAULT now()
);

CREATE TABLE battle_format (
    format_identification_number  INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    format_name                   VARCHAR(80)  NOT NULL UNIQUE,
    level_cap                     INTEGER      NOT NULL CHECK (level_cap BETWEEN 1 AND 100),
    ruleset_description           TEXT,
    is_active                     BOOLEAN      NOT NULL DEFAULT TRUE,
    managed_by_trainer_id         INTEGER REFERENCES trainer (trainer_identification_number)
);


CREATE TABLE elemental_type (
    elemental_type_identification_number INTEGER PRIMARY KEY,
    type_name                            VARCHAR(20) NOT NULL UNIQUE
);

CREATE TABLE type_matchup_matrix (
    attacking_type_identification_number INTEGER NOT NULL REFERENCES elemental_type (elemental_type_identification_number),
    defending_type_identification_number INTEGER NOT NULL REFERENCES elemental_type (elemental_type_identification_number),
    damage_multiplier_value             DECIMAL(2,1) NOT NULL
        CHECK (damage_multiplier_value IN (0, 0.5, 1, 2)),
    PRIMARY KEY (attacking_type_identification_number, defending_type_identification_number)
);

CREATE TABLE pokemon_species (
    species_national_pokedex_number INTEGER PRIMARY KEY,
    species_name                    VARCHAR(40) NOT NULL UNIQUE,
    base_hit_points                 INTEGER NOT NULL CHECK (base_hit_points BETWEEN 1 AND 255),
    base_attack                     INTEGER NOT NULL CHECK (base_attack BETWEEN 1 AND 255),
    base_defense                    INTEGER NOT NULL CHECK (base_defense BETWEEN 1 AND 255),
    base_special_attack             INTEGER NOT NULL CHECK (base_special_attack BETWEEN 1 AND 255),
    base_special_defense            INTEGER NOT NULL CHECK (base_special_defense BETWEEN 1 AND 255),
    base_speed                      INTEGER NOT NULL CHECK (base_speed BETWEEN 1 AND 255)
);

CREATE TABLE pokemon_elemental_types (
    species_national_pokedex_number     INTEGER NOT NULL REFERENCES pokemon_species (species_national_pokedex_number),
    elemental_type_identification_number INTEGER NOT NULL REFERENCES elemental_type (elemental_type_identification_number),
    type_slot_order                     INTEGER NOT NULL CHECK (type_slot_order IN (1, 2)),
    PRIMARY KEY (species_national_pokedex_number, elemental_type_identification_number),
    UNIQUE (species_national_pokedex_number, type_slot_order)
);

CREATE TABLE special_ability (
    ability_identification_number INTEGER PRIMARY KEY,
    ability_name                  VARCHAR(40) NOT NULL UNIQUE,
    ability_effect_description    TEXT
);

CREATE TABLE species_possible_abilities (
    species_national_pokedex_number INTEGER NOT NULL REFERENCES pokemon_species (species_national_pokedex_number),
    ability_identification_number   INTEGER NOT NULL REFERENCES special_ability (ability_identification_number),
    is_hidden_ability               BOOLEAN NOT NULL,
    PRIMARY KEY (species_national_pokedex_number, ability_identification_number)
);

CREATE TABLE combat_move (
    move_identification_number          INTEGER PRIMARY KEY,
    move_name                           VARCHAR(40) NOT NULL UNIQUE,
    elemental_type_identification_number INTEGER NOT NULL REFERENCES elemental_type (elemental_type_identification_number),
    damage_category                     VARCHAR(10) NOT NULL
        CHECK (damage_category IN ('physical', 'special', 'status')),
    base_power                          INTEGER CHECK (base_power > 0),          -- NULL for status and variable-power moves
    accuracy_percentage                 INTEGER CHECK (accuracy_percentage BETWEEN 1 AND 100),  -- NULL = never misses
    base_power_points                   INTEGER NOT NULL CHECK (base_power_points > 0),
    move_effect_description             TEXT
);

CREATE TABLE species_learnable_moves (
    species_national_pokedex_number INTEGER NOT NULL REFERENCES pokemon_species (species_national_pokedex_number),
    move_identification_number      INTEGER NOT NULL REFERENCES combat_move (move_identification_number),
    PRIMARY KEY (species_national_pokedex_number, move_identification_number)
);

CREATE TABLE held_item (
    item_identification_number INTEGER PRIMARY KEY,
    item_name                  VARCHAR(40) NOT NULL UNIQUE,
    item_effect_description    TEXT
);

CREATE TABLE statistical_nature (
    nature_identification_number INTEGER PRIMARY KEY,
    nature_name                  VARCHAR(20) NOT NULL UNIQUE,
    increased_stat_type          VARCHAR(20)
        CHECK (increased_stat_type IN ('attack', 'defense', 'special_attack', 'special_defense', 'speed')),
    decreased_stat_type          VARCHAR(20)
        CHECK (decreased_stat_type IN ('attack', 'defense', 'special_attack', 'special_defense', 'speed')),
    CHECK ((increased_stat_type IS NULL) = (decreased_stat_type IS NULL))  
);


CREATE TABLE format_banned_species (
    format_identification_number    INTEGER NOT NULL REFERENCES battle_format (format_identification_number) ON DELETE CASCADE,
    species_national_pokedex_number INTEGER NOT NULL REFERENCES pokemon_species (species_national_pokedex_number),
    PRIMARY KEY (format_identification_number, species_national_pokedex_number)
);


CREATE TABLE competitive_team (
    team_identification_number INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    owned_by_trainer_id        INTEGER NOT NULL REFERENCES trainer (trainer_identification_number) ON DELETE CASCADE,
    battle_format_id           INTEGER NOT NULL REFERENCES battle_format (format_identification_number),
    team_name                  VARCHAR(80) NOT NULL,
    team_status                VARCHAR(10) NOT NULL DEFAULT 'draft'
        CHECK (team_status IN ('draft', 'validated')),
    creation_timestamp         TIMESTAMP NOT NULL DEFAULT now(),
    last_modified_timestamp    TIMESTAMP NOT NULL DEFAULT now(),
    UNIQUE (owned_by_trainer_id, team_name)
);

CREATE TABLE individual_team_member (
    member_identification_number INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    belongs_to_team_id           INTEGER NOT NULL REFERENCES competitive_team (team_identification_number) ON DELETE CASCADE,
    team_slot_number             INTEGER NOT NULL CHECK (team_slot_number BETWEEN 1 AND 6),
    base_species_id              INTEGER NOT NULL REFERENCES pokemon_species (species_national_pokedex_number),
    assigned_ability_id          INTEGER NOT NULL,
    assigned_held_item_id        INTEGER REFERENCES held_item (item_identification_number),
    assigned_nature_id           INTEGER NOT NULL REFERENCES statistical_nature (nature_identification_number),
    terastallize_type_id         INTEGER REFERENCES elemental_type (elemental_type_identification_number),
    experience_level             INTEGER NOT NULL DEFAULT 50 CHECK (experience_level BETWEEN 1 AND 100),

    effort_value_hit_points         INTEGER NOT NULL DEFAULT 0 CHECK (effort_value_hit_points BETWEEN 0 AND 252),
    effort_value_attack             INTEGER NOT NULL DEFAULT 0 CHECK (effort_value_attack BETWEEN 0 AND 252),
    effort_value_defense            INTEGER NOT NULL DEFAULT 0 CHECK (effort_value_defense BETWEEN 0 AND 252),
    effort_value_special_attack     INTEGER NOT NULL DEFAULT 0 CHECK (effort_value_special_attack BETWEEN 0 AND 252),
    effort_value_special_defense    INTEGER NOT NULL DEFAULT 0 CHECK (effort_value_special_defense BETWEEN 0 AND 252),
    effort_value_speed              INTEGER NOT NULL DEFAULT 0 CHECK (effort_value_speed BETWEEN 0 AND 252),

    individual_value_hit_points     INTEGER NOT NULL DEFAULT 31 CHECK (individual_value_hit_points BETWEEN 0 AND 31),
    individual_value_attack         INTEGER NOT NULL DEFAULT 31 CHECK (individual_value_attack BETWEEN 0 AND 31),
    individual_value_defense        INTEGER NOT NULL DEFAULT 31 CHECK (individual_value_defense BETWEEN 0 AND 31),
    individual_value_special_attack INTEGER NOT NULL DEFAULT 31 CHECK (individual_value_special_attack BETWEEN 0 AND 31),
    individual_value_special_defense INTEGER NOT NULL DEFAULT 31 CHECK (individual_value_special_defense BETWEEN 0 AND 31),
    individual_value_speed          INTEGER NOT NULL DEFAULT 31 CHECK (individual_value_speed BETWEEN 0 AND 31),

    CHECK (effort_value_hit_points + effort_value_attack + effort_value_defense
         + effort_value_special_attack + effort_value_special_defense + effort_value_speed <= 510),

    UNIQUE (belongs_to_team_id, team_slot_number),
    UNIQUE (belongs_to_team_id, base_species_id),
    UNIQUE (belongs_to_team_id, assigned_held_item_id),  

    FOREIGN KEY (base_species_id, assigned_ability_id)
        REFERENCES species_possible_abilities (species_national_pokedex_number, ability_identification_number)
);

CREATE TABLE member_equipped_moves (
    member_identification_number INTEGER NOT NULL REFERENCES individual_team_member (member_identification_number) ON DELETE CASCADE,
    move_identification_number   INTEGER NOT NULL REFERENCES combat_move (move_identification_number),
    move_slot_number             INTEGER NOT NULL CHECK (move_slot_number BETWEEN 1 AND 4),
    PRIMARY KEY (member_identification_number, move_identification_number),
    UNIQUE (member_identification_number, move_slot_number)
);


CREATE INDEX idx_team_owner            ON competitive_team (owned_by_trainer_id);
CREATE INDEX idx_team_format           ON competitive_team (battle_format_id);
CREATE INDEX idx_member_team           ON individual_team_member (belongs_to_team_id);
CREATE INDEX idx_member_species        ON individual_team_member (base_species_id);
CREATE INDEX idx_member_moves_move     ON member_equipped_moves (move_identification_number);
CREATE INDEX idx_species_moves_move    ON species_learnable_moves (move_identification_number);
CREATE INDEX idx_pokemon_types_type    ON pokemon_elemental_types (elemental_type_identification_number);
CREATE INDEX idx_move_type             ON combat_move (elemental_type_identification_number);

