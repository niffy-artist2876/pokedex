
-- psql -U postgres -d pokedex -v ON_ERROR_STOP=1 -f schema_novector.sql


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



-- ---------------------------------------------------------------- business-rule triggers
-- Rules that span tables and so can't be plain CHECK / FK constraints.

-- Only admins may manage a battle format.
CREATE FUNCTION enforce_format_manager_is_admin() RETURNS trigger AS $$
BEGIN
    IF NEW.managed_by_trainer_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM trainer
        WHERE trainer_identification_number = NEW.managed_by_trainer_id
          AND system_access_role = 'admin'
    ) THEN
        RAISE EXCEPTION 'trainer % is not an admin and cannot manage a battle format', NEW.managed_by_trainer_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_format_manager_is_admin
    BEFORE INSERT OR UPDATE OF managed_by_trainer_id ON battle_format
    FOR EACH ROW EXECUTE FUNCTION enforce_format_manager_is_admin();

-- An admin who still manages formats can't be demoted.
CREATE FUNCTION prevent_demoting_format_manager() RETURNS trigger AS $$
BEGIN
    IF NEW.system_access_role <> 'admin' AND EXISTS (
        SELECT 1 FROM battle_format WHERE managed_by_trainer_id = NEW.trainer_identification_number
    ) THEN
        RAISE EXCEPTION 'trainer % still manages battle formats; reassign them before demoting', NEW.trainer_identification_number;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_prevent_demoting_format_manager
    BEFORE UPDATE OF system_access_role ON trainer
    FOR EACH ROW EXECUTE FUNCTION prevent_demoting_format_manager();

-- Teams can only be created for (or moved to) an active format, and every
-- existing member must satisfy the new format's level cap and ban list.
CREATE FUNCTION enforce_team_format_rules() RETURNS trigger AS $$
DECLARE
    fmt battle_format%ROWTYPE;
BEGIN
    IF TG_OP = 'UPDATE' AND NEW.battle_format_id = OLD.battle_format_id THEN
        RETURN NEW;
    END IF;
    SELECT * INTO fmt FROM battle_format WHERE format_identification_number = NEW.battle_format_id;
    IF NOT fmt.is_active THEN
        RAISE EXCEPTION 'battle format "%" is not active', fmt.format_name;
    END IF;
    IF TG_OP = 'UPDATE' THEN
        IF EXISTS (SELECT 1 FROM individual_team_member
                   WHERE belongs_to_team_id = NEW.team_identification_number
                     AND experience_level > fmt.level_cap) THEN
            RAISE EXCEPTION 'team has members above the level cap (%) of "%"', fmt.level_cap, fmt.format_name;
        END IF;
        IF EXISTS (SELECT 1 FROM individual_team_member m
                   JOIN format_banned_species b
                     ON b.species_national_pokedex_number = m.base_species_id
                    AND b.format_identification_number = fmt.format_identification_number
                   WHERE m.belongs_to_team_id = NEW.team_identification_number) THEN
            RAISE EXCEPTION 'team contains species banned in "%"', fmt.format_name;
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_team_format_rules
    BEFORE INSERT OR UPDATE OF battle_format_id ON competitive_team
    FOR EACH ROW EXECUTE FUNCTION enforce_team_format_rules();

-- A member must respect its team's format (level cap, banned species), and if
-- its species changes, every move it already knows must still be learnable.
CREATE FUNCTION enforce_member_rules() RETURNS trigger AS $$
DECLARE
    fmt battle_format%ROWTYPE;
BEGIN
    SELECT f.* INTO fmt
    FROM competitive_team t
    JOIN battle_format f ON f.format_identification_number = t.battle_format_id
    WHERE t.team_identification_number = NEW.belongs_to_team_id;

    IF NEW.experience_level > fmt.level_cap THEN
        RAISE EXCEPTION 'level % exceeds the level cap (%) of "%"', NEW.experience_level, fmt.level_cap, fmt.format_name;
    END IF;
    IF EXISTS (SELECT 1 FROM format_banned_species
               WHERE format_identification_number = fmt.format_identification_number
                 AND species_national_pokedex_number = NEW.base_species_id) THEN
        RAISE EXCEPTION 'species % is banned in "%"', NEW.base_species_id, fmt.format_name;
    END IF;
    IF TG_OP = 'UPDATE' AND NEW.base_species_id <> OLD.base_species_id AND EXISTS (
        SELECT 1 FROM member_equipped_moves e
        WHERE e.member_identification_number = NEW.member_identification_number
          AND NOT EXISTS (SELECT 1 FROM species_learnable_moves l
                          WHERE l.species_national_pokedex_number = NEW.base_species_id
                            AND l.move_identification_number = e.move_identification_number)
    ) THEN
        RAISE EXCEPTION 'species % cannot learn all of this member''s equipped moves', NEW.base_species_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_member_rules
    BEFORE INSERT OR UPDATE ON individual_team_member
    FOR EACH ROW EXECUTE FUNCTION enforce_member_rules();

-- A member can only equip moves its species can learn.
CREATE FUNCTION enforce_learnable_move() RETURNS trigger AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM individual_team_member m
        JOIN species_learnable_moves l
          ON l.species_national_pokedex_number = m.base_species_id
         AND l.move_identification_number = NEW.move_identification_number
        WHERE m.member_identification_number = NEW.member_identification_number
    ) THEN
        RAISE EXCEPTION 'move % is not learnable by this member''s species', NEW.move_identification_number;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_learnable_move
    BEFORE INSERT OR UPDATE ON member_equipped_moves
    FOR EACH ROW EXECUTE FUNCTION enforce_learnable_move();

-- Keep competitive_team.last_modified_timestamp current, including when its
-- members or their moves change.
CREATE FUNCTION touch_team_on_update() RETURNS trigger AS $$
BEGIN
    NEW.last_modified_timestamp := now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_team_touch
    BEFORE UPDATE ON competitive_team
    FOR EACH ROW EXECUTE FUNCTION touch_team_on_update();

CREATE FUNCTION touch_team_from_member() RETURNS trigger AS $$
BEGIN
    UPDATE competitive_team SET last_modified_timestamp = now()
    WHERE team_identification_number IN (OLD.belongs_to_team_id, NEW.belongs_to_team_id);
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_member_touch_team
    AFTER INSERT OR UPDATE OR DELETE ON individual_team_member
    FOR EACH ROW EXECUTE FUNCTION touch_team_from_member();

CREATE FUNCTION touch_team_from_move() RETURNS trigger AS $$
BEGIN
    UPDATE competitive_team SET last_modified_timestamp = now()
    WHERE team_identification_number IN (
        SELECT belongs_to_team_id FROM individual_team_member
        WHERE member_identification_number IN (OLD.member_identification_number, NEW.member_identification_number));
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_move_touch_team
    AFTER INSERT OR UPDATE OR DELETE ON member_equipped_moves
    FOR EACH ROW EXECUTE FUNCTION touch_team_from_move();
