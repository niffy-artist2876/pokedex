-- 004: drop indexes that duplicate ones PostgreSQL already builds for UNIQUE
-- constraints. A B-tree on (a, b) also serves lookups on a alone, so these
-- only cost write time and disk space.

-- covered by UNIQUE (belongs_to_team_id, team_slot_number) on individual_team_member
DROP INDEX IF EXISTS idx_member_team;

-- covered by UNIQUE (owned_by_trainer_id, team_name) on competitive_team
DROP INDEX IF EXISTS idx_team_owner;
