# Database test results

Run 2026-10-21 21:35 with `python database/tests/test_database.py`: **41/41 passed**.

| # | Area | Test | Result |
|---|---|---|---|
| 1 | Constraint | EV above 252 in one stat is rejected (CHECK) | PASS |
| 2 | Constraint | EVs totalling more than 510 are rejected (table CHECK) | PASS |
| 3 | Constraint | IV above 31 is rejected (CHECK) | PASS |
| 4 | Constraint | A 7th team slot is rejected (CHECK 1-6) | PASS |
| 5 | Constraint | A 5th move slot is rejected (CHECK 1-4) | PASS |
| 6 | Constraint | Species clause: the same species twice on one team is rejected (UNIQUE) | PASS |
| 7 | Constraint | Item clause: the same held item twice on one team is rejected (UNIQUE) | PASS |
| 8 | Constraint | An ability the species can't have is rejected (composite FOREIGN KEY) | PASS |
| 9 | Constraint | Bad username, e-mail and non-bcrypt password hash are rejected (CHECK regex) | PASS |
| 10 | Constraint | 'ASH' can't register when 'ash' exists (unique index on lower(username)) | PASS |
| 11 | Constraint | A type matchup multiplier outside {0, 0.5, 1, 2} is rejected (CHECK) | PASS |
| 12 | Trigger | Equipping a move the species can't learn is rejected | PASS |
| 13 | Trigger | A level-51 member in a level-50 format is rejected | PASS |
| 14 | Trigger | A species banned in the format is rejected (Koraidon in Singles OU) | PASS |
| 15 | Trigger | Creating a team in an inactive format is rejected | PASS |
| 16 | Trigger | A competitor can't be assigned as a format manager | PASS |
| 17 | Trigger | An admin who still manages formats can't be demoted | PASS |
| 18 | Trigger | Lowering a format's level cap below registered members is rejected | PASS |
| 19 | Trigger | Editing a member of a validated team puts the team back to draft and bumps last_modified | PASS |
| 20 | Trigger | Banning a species demotes validated teams that use it (Kyogre -> Rain Dance) | PASS |
| 21 | Trigger | Setting team_status = 'validated' directly is blocked | PASS |
| 22 | Trigger | Changing a member's species to one that can't learn its moves is rejected | PASS |
| 23 | Procedure | sp_validate_team rejects a 1-member team in a format needing 4 | PASS |
| 24 | Procedure | sp_validate_team rejects a second legendary (limit 1) | PASS |
| 25 | Procedure | sp_validate_team marks a legal team validated | PASS |
| 26 | Procedure | sp_clone_team copies all members and moves and returns the new id (INOUT) | PASS |
| 27 | Transaction | A clone that fails part-way leaves nothing behind (duplicate team name) | PASS |
| 28 | Function | fn_member_final_stats: Jolly 252/252 level-100 Garchomp has 358 HP / 359 Atk / 333 Spe | PASS |
| 29 | Function | fn_type_effectiveness: Ice does 4x to Garchomp, Electric 0x | PASS |
| 30 | Function | Full-text search for 'restores HP' finds Recover and Roost | PASS |
| 31 | Security | Guest can browse the Pokédex | PASS |
| 32 | Security | Guest cannot read teams or trainers | PASS |
| 33 | Security | Guest sign-up through fn_register_trainer always creates a competitor | PASS |
| 34 | Security | Competitor sees own teams + others' validated teams, not others' drafts (RLS, also through views) | PASS |
| 35 | Security | Competitor can't create a team owned by someone else | PASS |
| 36 | Security | Competitor can't rename, delete or add members to another trainer's team | PASS |
| 37 | Security | Competitor can't read password hashes or e-mails (column privileges) | PASS |
| 38 | Security | Competitor can't create formats, ban species or validate others' teams | PASS |
| 39 | Security | Competitor creates a team, adds a member and move, and validates it, all under RLS | PASS |
| 40 | Security | Admin creates formats, sees every team (including drafts) and can delete any team | PASS |
| 41 | Security | The pokedex_app login role can do nothing until it switches role (NOINHERIT) | PASS |
