"""
Database test suite: constraints, triggers, procedures/functions and role-based
access control. Needs the reference data and demo data:

    python database/setup_db.py --seed --demo
    python database/tests/test_database.py

Every test runs inside a transaction that is rolled back, so the database is
left exactly as it was. Results are printed and written to test_results.md.
"""

import os
import sys
import traceback
from datetime import datetime
from pathlib import Path

import psycopg
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[2]
RESULTS = Path(__file__).resolve().parent / "test_results.md"
TESTS = []


def test(category):
    def register(fn):
        TESTS.append((category, fn.__doc__.strip(), fn))
        return fn
    return register


# ---------------------------------------------------------------- helpers

def scalar(conn, query, *params):
    row = conn.execute(query, params).fetchone()
    return row[0] if row else None


def expect_error(conn, query, params=(), match=None):
    """Run in a savepoint; pass only if PostgreSQL rejects it (with `match` in the message)."""
    try:
        with conn.transaction():
            conn.execute(query, params)
    except psycopg.Error as e:
        message = str(e).splitlines()[0]
        if match and match.lower() not in message.lower():
            raise AssertionError(f"rejected for the wrong reason: {message}")
        return message
    raise AssertionError("statement succeeded but should have been rejected")


def check(condition, message):
    if not condition:
        raise AssertionError(message)


class Ids:
    def __init__(self, conn):
        self.conn = conn

    def _one(self, query, name):
        value = scalar(self.conn, query, name)
        if value is None:
            raise LookupError(f"{name!r} not found - is the demo data loaded?")
        return value

    def team(self, n):    return self._one("SELECT team_identification_number FROM competitive_team WHERE team_name = %s", n)
    def trainer(self, n): return self._one("SELECT trainer_identification_number FROM trainer WHERE account_username = %s", n)
    def species(self, n): return self._one("SELECT species_national_pokedex_number FROM pokemon_species WHERE species_name = %s", n)
    def ability(self, n): return self._one("SELECT ability_identification_number FROM special_ability WHERE ability_name = %s", n)
    def move(self, n):    return self._one("SELECT move_identification_number FROM combat_move WHERE move_name = %s", n)
    def item(self, n):    return self._one("SELECT item_identification_number FROM held_item WHERE item_name = %s", n)
    def nature(self, n):  return self._one("SELECT nature_identification_number FROM statistical_nature WHERE nature_name = %s", n)
    def format(self, n):  return self._one("SELECT format_identification_number FROM battle_format WHERE format_name = %s", n)

    def member(self, team, species):
        return scalar(self.conn, """SELECT member_identification_number FROM individual_team_member
                                    WHERE belongs_to_team_id = %s AND base_species_id = %s""",
                      self.team(team), self.species(species))


def as_role(conn, role, trainer_id=None):
    """Act like the backend for one request: SET LOCAL ROLE + the signed-in trainer."""
    conn.execute(f"SET LOCAL ROLE {role}")
    conn.execute("SELECT set_config('pokedex.trainer_id', %s, true)", (str(trainer_id or ""),))


INSERT_MEMBER = """INSERT INTO individual_team_member
    (belongs_to_team_id, team_slot_number, base_species_id, assigned_ability_id, assigned_held_item_id,
     assigned_nature_id, experience_level, effort_value_attack, effort_value_speed, individual_value_speed)
    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)"""


def member_row(ids, team="Work in Progress", slot=2, species="Garchomp", ability="Rough Skin",
               item=None, nature="Jolly", level=50, atk_ev=0, spe_ev=0, spe_iv=31):
    return (ids.team(team), slot, ids.species(species), ids.ability(ability),
            ids.item(item) if item else None, ids.nature(nature), level, atk_ev, spe_ev, spe_iv)


# ---------------------------------------------------------------- constraints

@test("Constraint")
def ev_over_252(conn, ids):
    """EV above 252 in one stat is rejected (CHECK)"""
    expect_error(conn, INSERT_MEMBER, member_row(ids, spe_ev=253), "effort_value_speed_check")

@test("Constraint")
def ev_total_over_510(conn, ids):
    """EVs totalling more than 510 are rejected (table CHECK)"""
    conn.execute(INSERT_MEMBER, member_row(ids, atk_ev=252, spe_ev=252))
    expect_error(conn, "UPDATE individual_team_member SET effort_value_hit_points = 8 WHERE belongs_to_team_id = %s AND team_slot_number = 2",
                 (ids.team("Work in Progress"),), "check")

@test("Constraint")
def iv_over_31(conn, ids):
    """IV above 31 is rejected (CHECK)"""
    expect_error(conn, INSERT_MEMBER, member_row(ids, spe_iv=32), "individual_value_speed_check")

@test("Constraint")
def seventh_slot(conn, ids):
    """A 7th team slot is rejected (CHECK 1-6)"""
    expect_error(conn, INSERT_MEMBER, member_row(ids, slot=7), "team_slot_number_check")

@test("Constraint")
def fifth_move(conn, ids):
    """A 5th move slot is rejected (CHECK 1-4)"""
    expect_error(conn, "INSERT INTO member_equipped_moves VALUES (%s, %s, 5)",
                 (ids.member("Rain Dance", "Kingdra"), ids.move("Surf")), "move_slot_number_check")

@test("Constraint")
def species_clause(conn, ids):
    """Species clause: the same species twice on one team is rejected (UNIQUE)"""
    expect_error(conn, INSERT_MEMBER, member_row(ids, species="Pelipper", ability="Drizzle"), "duplicate key")

@test("Constraint")
def item_clause(conn, ids):
    """Item clause: the same held item twice on one team is rejected (UNIQUE)"""
    expect_error(conn, INSERT_MEMBER, member_row(ids, item="Leftovers"), "duplicate key")

@test("Constraint")
def illegal_ability(conn, ids):
    """An ability the species can't have is rejected (composite FOREIGN KEY)"""
    expect_error(conn, INSERT_MEMBER, member_row(ids, ability="Drizzle"), "foreign key")

@test("Constraint")
def bad_trainer_input(conn, ids):
    """Bad username, e-mail and non-bcrypt password hash are rejected (CHECK regex)"""
    good_hash = scalar(conn, "SELECT encrypted_password_hash FROM trainer WHERE account_username = 'ash'")
    sql = "INSERT INTO trainer (account_username, email_address, encrypted_password_hash, system_access_role) VALUES (%s, %s, %s, 'competitor')"
    expect_error(conn, sql, ("no spaces allowed", "x@y.test", good_hash), "username_format")
    expect_error(conn, sql, ("gary", "not-an-email", good_hash), "email_format")
    expect_error(conn, sql, ("gary", "gary@pokedex.test", "plaintext-password"), "bcrypt")

@test("Constraint")
def username_case_insensitive(conn, ids):
    """'ASH' can't register when 'ash' exists (unique index on lower(username))"""
    good_hash = scalar(conn, "SELECT encrypted_password_hash FROM trainer WHERE account_username = 'ash'")
    expect_error(conn, """INSERT INTO trainer (account_username, email_address, encrypted_password_hash, system_access_role)
                          VALUES ('ASH', 'other@pokedex.test', %s, 'competitor')""", (good_hash,), "uq_trainer_username_ci")

@test("Constraint")
def invalid_multiplier(conn, ids):
    """A type matchup multiplier outside {0, 0.5, 1, 2} is rejected (CHECK)"""
    expect_error(conn, "UPDATE type_matchup_matrix SET damage_multiplier_value = 3 WHERE attacking_type_identification_number = 1",
                 match="check")


# ---------------------------------------------------------------- triggers

@test("Trigger")
def unlearnable_move(conn, ids):
    """Equipping a move the species can't learn is rejected"""
    expect_error(conn, "INSERT INTO member_equipped_moves VALUES (%s, %s, 3)",
                 (ids.member("Work in Progress", "Pelipper"), ids.move("Spore")), "not learnable")

@test("Trigger")
def level_above_cap(conn, ids):
    """A level-51 member in a level-50 format is rejected"""
    expect_error(conn, INSERT_MEMBER, member_row(ids, level=51), "exceeds the level cap")

@test("Trigger")
def banned_species(conn, ids):
    """A species banned in the format is rejected (Koraidon in Singles OU)"""
    expect_error(conn, INSERT_MEMBER, member_row(ids, team="Rock Solid", slot=5, species="Koraidon",
                                                 ability="Orichalcum Pulse", level=100), "banned")

@test("Trigger")
def inactive_format(conn, ids):
    """Creating a team in an inactive format is rejected"""
    expect_error(conn, "INSERT INTO competitive_team (owned_by_trainer_id, battle_format_id, team_name) VALUES (%s, %s, 'Old')",
                 (ids.trainer("ash"), ids.format("Legacy Doubles")), "not active")

@test("Trigger")
def competitor_cannot_manage_format(conn, ids):
    """A competitor can't be assigned as a format manager"""
    expect_error(conn, "UPDATE battle_format SET managed_by_trainer_id = %s WHERE format_name = 'Little Cup'",
                 (ids.trainer("ash"),), "not an admin")

@test("Trigger")
def admin_with_formats_not_demoted(conn, ids):
    """An admin who still manages formats can't be demoted"""
    expect_error(conn, "UPDATE trainer SET system_access_role = 'competitor' WHERE account_username = 'oak'",
                 match="still manages")

@test("Trigger")
def level_cap_not_lowered_below_members(conn, ids):
    """Lowering a format's level cap below registered members is rejected"""
    expect_error(conn, "UPDATE battle_format SET level_cap = 40 WHERE format_name = 'VGC Regulation G'",
                 match="cannot lower the level cap")

@test("Trigger")
def edit_resets_to_draft(conn, ids):
    """Editing a member of a validated team puts the team back to draft and bumps last_modified"""
    team = ids.team("Rain Dance")
    before = scalar(conn, "SELECT last_modified_timestamp FROM competitive_team WHERE team_identification_number = %s", team)
    conn.execute("UPDATE individual_team_member SET experience_level = 49 WHERE member_identification_number = %s",
                 (ids.member("Rain Dance", "Kingdra"),))
    status, after = conn.execute("SELECT team_status, last_modified_timestamp FROM competitive_team WHERE team_identification_number = %s",
                                 (team,)).fetchone()
    check(status == "draft", f"status is {status}")
    check(after >= before, "timestamp did not move")

@test("Trigger")
def ban_demotes_teams(conn, ids):
    """Banning a species demotes validated teams that use it (Kyogre -> Rain Dance)"""
    conn.execute("INSERT INTO format_banned_species VALUES (%s, %s)", (ids.format("VGC Regulation G"), ids.species("Kyogre")))
    check(scalar(conn, "SELECT team_status FROM competitive_team WHERE team_name = 'Rain Dance'") == "draft", "still validated")
    check(scalar(conn, "SELECT team_status FROM competitive_team WHERE team_name = 'Sun Room'") == "validated", "unrelated team demoted")

@test("Trigger")
def status_only_via_procedure(conn, ids):
    """Setting team_status = 'validated' directly is blocked"""
    expect_error(conn, "UPDATE competitive_team SET team_status = 'validated' WHERE team_name = 'Baby Steps'",
                 match="sp_validate_team")

@test("Trigger")
def species_change_keeps_moves_legal(conn, ids):
    """Changing a member's species to one that can't learn its moves is rejected"""
    expect_error(conn, "UPDATE individual_team_member SET base_species_id = %s, assigned_ability_id = %s WHERE member_identification_number = %s",
                 (ids.species("Magikarp"), ids.ability("Swift Swim"), ids.member("Rain Dance", "Kingdra")), "cannot learn")


# ---------------------------------------------------------------- procedures and functions

@test("Procedure")
def validate_too_few_members(conn, ids):
    """sp_validate_team rejects a 1-member team in a format needing 4"""
    expect_error(conn, "CALL sp_validate_team(%s)", (ids.team("Work in Progress"),), "needs at least 4 members")

@test("Procedure")
def validate_too_many_legendaries(conn, ids):
    """sp_validate_team rejects a second legendary (limit 1)"""
    conn.execute(INSERT_MEMBER, member_row(ids, team="Rain Dance", slot=6, species="Koraidon", ability="Orichalcum Pulse"))
    conn.execute("INSERT INTO member_equipped_moves VALUES (%s, %s, 1)",
                 (ids.member("Rain Dance", "Koraidon"), ids.move("Protect")))
    expect_error(conn, "CALL sp_validate_team(%s)", (ids.team("Rain Dance"),), "at most 1 legendary")

@test("Procedure")
def validate_success(conn, ids):
    """sp_validate_team marks a legal team validated"""
    team = ids.team("Baby Steps")
    conn.execute("CALL sp_validate_team(%s)", (team,))
    check(scalar(conn, "SELECT team_status FROM competitive_team WHERE team_identification_number = %s", team) == "validated", "not validated")

@test("Procedure")
def clone_team(conn, ids):
    """sp_clone_team copies all members and moves and returns the new id (INOUT)"""
    new_id = conn.execute("CALL sp_clone_team(%s, %s, 'Copy', NULL)", (ids.team("Rain Dance"), ids.trainer("misty"))).fetchone()[0]
    members = scalar(conn, "SELECT count(*) FROM individual_team_member WHERE belongs_to_team_id = %s", new_id)
    moves = scalar(conn, """SELECT count(*) FROM member_equipped_moves e JOIN individual_team_member m USING (member_identification_number)
                            WHERE m.belongs_to_team_id = %s""", new_id)
    check((members, moves) == (5, 20), f"copied {members} members / {moves} moves")

@test("Transaction")
def clone_is_atomic(conn, ids):
    """A clone that fails part-way leaves nothing behind (duplicate team name)"""
    before = scalar(conn, "SELECT count(*) FROM individual_team_member")
    expect_error(conn, "CALL sp_clone_team(%s, %s, 'Rain Dance', NULL)", (ids.team("Rain Dance"), ids.trainer("ash")), "duplicate key")
    check(scalar(conn, "SELECT count(*) FROM individual_team_member") == before, "partial copy left behind")

@test("Function")
def final_stats(conn, ids):
    """fn_member_final_stats: Jolly 252/252 level-100 Garchomp has 358 HP / 359 Atk / 333 Spe"""
    stats = dict(conn.execute("SELECT stat_name, final_value FROM fn_member_final_stats(%s)",
                              (ids.member("Rock Solid", "Garchomp"),)).fetchall())
    check((stats["hit_points"], stats["attack"], stats["speed"]) == (358, 359, 333), str(stats))

@test("Function")
def type_effectiveness(conn, ids):
    """fn_type_effectiveness: Ice does 4x to Garchomp, Electric 0x"""
    ice = scalar(conn, "SELECT fn_type_effectiveness((SELECT elemental_type_identification_number FROM elemental_type WHERE type_name = 'Ice'), %s)", ids.species("Garchomp"))
    elec = scalar(conn, "SELECT fn_type_effectiveness((SELECT elemental_type_identification_number FROM elemental_type WHERE type_name = 'Electric'), %s)", ids.species("Garchomp"))
    check((float(ice), float(elec)) == (4.0, 0.0), f"{ice}, {elec}")

@test("Function")
def full_text_search(conn, ids):
    """Full-text search for 'restores HP' finds Recover and Roost"""
    found = {r[0] for r in conn.execute("""SELECT move_name FROM combat_move
                                           WHERE search_document @@ websearch_to_tsquery('english', 'restores HP')""")}
    check({"Recover", "Roost"} <= found, f"found {sorted(found)[:10]}")


# ---------------------------------------------------------------- vector search

def team_vector(conn, team_id):
    text = scalar(conn, "SELECT team_profile_vector::text FROM competitive_team WHERE team_identification_number = %s", team_id)
    return None if text is None else [float(x) for x in text.strip("[]").split(",")]


def embedding(*entries):
    """A 384-dim vector literal, zero except for the given (index, value) entries."""
    v = [0.0] * 384
    for i, x in entries:
        v[i] = x
    return "[" + ",".join(map(str, v)) + "]"


@test("Vector")
def team_vectors_backfilled(conn, ids):
    """Every demo team has a 42-dim team_profile_vector matching fn_team_profile_vector"""
    rows = conn.execute("""SELECT team_name, vector_dims(team_profile_vector),
                                  team_profile_vector = fn_team_profile_vector(team_identification_number)
                           FROM competitive_team""").fetchall()
    check(rows and all(dims == 42 and same for _, dims, same in rows), str(rows))

@test("Vector")
def team_vector_follows_members(conn, ids):
    """Adding a member recomputes team_profile_vector; an empty team's vector is NULL"""
    team = ids.team("Work in Progress")
    dragon = scalar(conn, "SELECT elemental_type_identification_number FROM elemental_type WHERE type_name = 'Dragon'") - 1
    before = team_vector(conn, team)
    conn.execute(INSERT_MEMBER, member_row(ids))  # Garchomp joins Pelipper
    after = team_vector(conn, team)
    check((before[dragon], after[dragon]) == (0.0, 0.5), f"Dragon share {before[dragon]} -> {after[dragon]}")
    conn.execute("DELETE FROM individual_team_member WHERE belongs_to_team_id = %s", (team,))
    check(team_vector(conn, team) is None, "empty team still has a vector")

@test("Vector")
def competitor_cannot_write_team_vector(conn, ids):
    """Competitor can't set team_profile_vector on their own team (only the trigger maintains it)"""
    team = ids.team("Sun Room")
    as_role(conn, "pokedex_competitor", ids.trainer("misty"))
    expect_error(conn, "UPDATE competitive_team SET team_profile_vector = NULL WHERE team_identification_number = %s",
                 (team,), "permission denied")

@test("Vector")
def similar_teams_respects_rls(conn, ids):
    """fn_similar_teams returns only teams the caller can read; guests can't call it"""
    team = ids.team("Sun Room")
    as_role(conn, "pokedex_competitor", ids.trainer("misty"))
    found = {r[0] for r in conn.execute("SELECT team_name FROM fn_similar_teams(%s, 10)", (team,))}
    check(found == {"Rain Dance", "Rock Solid"}, f"found {found}")
    as_role(conn, "pokedex_guest")
    expect_error(conn, "SELECT * FROM fn_similar_teams(%s)", (team,), "permission denied")

@test("Vector")
def semantic_move_search(conn, ids):
    """fn_search_moves_semantic ranks by cosine similarity and skips moves without embeddings"""
    # Exact search: the HNSW index is approximate, and the hundreds of vectors just
    # replaced in this transaction can crowd a far-away match out of its candidates.
    conn.execute("SET LOCAL enable_indexscan = off")
    conn.execute("UPDATE combat_move SET description_embedding = NULL")
    for name, vec in [("Recover", embedding((0, 1))), ("Roost", embedding((0, 0.9), (1, 0.1))), ("Tackle", embedding((1, 1)))]:
        conn.execute("UPDATE combat_move SET description_embedding = %s::vector WHERE move_name = %s", (vec, name))
    found = [r[0] for r in conn.execute("SELECT move_name FROM fn_search_moves_semantic(%s::vector)", (embedding((0, 1)),))]
    check(found == ["Recover", "Roost", "Tackle"], f"found {found}")

@test("Vector")
def semantic_ability_search(conn, ids):
    """fn_search_abilities_semantic ranks abilities by cosine similarity"""
    conn.execute("SET LOCAL enable_indexscan = off")  # exact search, as above
    conn.execute("UPDATE special_ability SET description_embedding = NULL")
    for name, vec in [("Drizzle", embedding((2, 1))), ("Drought", embedding((2, 0.5), (3, 0.5))), ("Levitate", embedding((3, 1)))]:
        conn.execute("UPDATE special_ability SET description_embedding = %s::vector WHERE ability_name = %s", (vec, name))
    found = [r[0] for r in conn.execute("SELECT ability_name FROM fn_search_abilities_semantic(%s::vector)", (embedding((2, 1)),))]
    check(found == ["Drizzle", "Drought", "Levitate"], f"found {found}")

@test("Vector")
def admin_updates_description_and_vector(conn, ids):
    """Admin can update a description together with its new embedding (vector update)"""
    as_role(conn, "pokedex_admin", ids.trainer("oak"))
    conn.execute("""UPDATE combat_move SET move_effect_description = 'Heals.', description_embedding = %s::vector
                    WHERE move_name = 'Recover'""", (embedding((5, 1)),))
    check(scalar(conn, "SELECT description_embedding = %s::vector FROM combat_move WHERE move_name = 'Recover'",
                 embedding((5, 1))), "new vector not stored")

@test("Vector")
def description_edit_clears_stale_vector(conn, ids):
    """Editing a description without a new embedding clears the stale vector (trigger); admin can delete vectors"""
    as_role(conn, "pokedex_admin", ids.trainer("oak"))
    conn.execute("UPDATE combat_move SET description_embedding = %s::vector WHERE move_name = 'Recover'", (embedding((0, 1)),))
    conn.execute("UPDATE combat_move SET move_effect_description = 'Heals a lot.' WHERE move_name = 'Recover'")
    check(scalar(conn, "SELECT description_embedding IS NULL FROM combat_move WHERE move_name = 'Recover'"), "stale vector kept")
    conn.execute("UPDATE special_ability SET description_embedding = NULL WHERE ability_name = 'Drizzle'")
    check(scalar(conn, "SELECT description_embedding IS NULL FROM special_ability WHERE ability_name = 'Drizzle'"), "not deleted")

@test("Vector")
def competitor_cannot_edit_descriptions(conn, ids):
    """Competitors can't change descriptions or embeddings (column privileges)"""
    as_role(conn, "pokedex_competitor", ids.trainer("misty"))
    expect_error(conn, "UPDATE combat_move SET move_effect_description = 'x' WHERE move_name = 'Recover'", match="permission denied")
    expect_error(conn, "UPDATE special_ability SET description_embedding = NULL", match="permission denied")


# ---------------------------------------------------------------- role-based access control

@test("Security")
def guest_reads_pokedex(conn, ids):
    """Guest can browse the Pokédex"""
    as_role(conn, "pokedex_guest")
    check(scalar(conn, "SELECT count(*) FROM v_species_profile") > 700, "no species visible")

@test("Security")
def guest_cannot_read_teams(conn, ids):
    """Guest cannot read teams or trainers"""
    as_role(conn, "pokedex_guest")
    expect_error(conn, "SELECT * FROM competitive_team", match="permission denied")
    expect_error(conn, "SELECT account_username FROM trainer", match="permission denied")

@test("Security")
def guest_signup_is_competitor(conn, ids):
    """Guest sign-up through fn_register_trainer always creates a competitor"""
    good_hash = scalar(conn, "SELECT encrypted_password_hash FROM trainer WHERE account_username = 'ash'")
    as_role(conn, "pokedex_guest")
    new_id = scalar(conn, "SELECT fn_register_trainer('gary', 'gary@pokedex.test', %s)", good_hash)
    role = conn.execute("SELECT access_role FROM fn_get_login_credentials('GARY')").fetchone()[0]
    check(new_id and role == "competitor", f"role {role}")

@test("Security")
def competitor_sees_own_and_published(conn, ids):
    """Competitor sees own teams + others' validated teams, not others' drafts (RLS, also through views)"""
    as_role(conn, "pokedex_competitor", ids.trainer("misty"))
    names = {r[0] for r in conn.execute("SELECT team_name FROM competitive_team")}
    via_view = {r[0] for r in conn.execute("SELECT team_name FROM v_team_overview")}
    expected = {"Sun Room", "Rain Dance", "Rock Solid"}
    check(names == expected and via_view == expected, f"{names} / {via_view}")

@test("Security")
def competitor_cannot_create_for_others(conn, ids):
    """Competitor can't create a team owned by someone else"""
    ash, fmt = ids.trainer("ash"), ids.format("VGC Regulation G")
    as_role(conn, "pokedex_competitor", ids.trainer("misty"))
    expect_error(conn, "INSERT INTO competitive_team (owned_by_trainer_id, battle_format_id, team_name) VALUES (%s, %s, 'Sneaky')",
                 (ash, fmt), "row-level security")

@test("Security")
def competitor_cannot_edit_others(conn, ids):
    """Competitor can't rename, delete or add members to another trainer's team"""
    team = ids.team("Rain Dance")
    row = member_row(ids, team="Rain Dance", slot=6, species="Garchomp")
    as_role(conn, "pokedex_competitor", ids.trainer("misty"))
    renamed = conn.execute("UPDATE competitive_team SET team_name = 'Hacked' WHERE team_identification_number = %s", (team,)).rowcount
    deleted = conn.execute("DELETE FROM competitive_team WHERE team_identification_number = %s", (team,)).rowcount
    check((renamed, deleted) == (0, 0), f"updated {renamed}, deleted {deleted}")
    expect_error(conn, INSERT_MEMBER, row, "row-level security")

@test("Security")
def competitor_cannot_read_secrets(conn, ids):
    """Competitor can't read password hashes or e-mails (column privileges)"""
    as_role(conn, "pokedex_competitor", ids.trainer("misty"))
    expect_error(conn, "SELECT encrypted_password_hash FROM trainer", match="permission denied")
    expect_error(conn, "SELECT email_address FROM trainer", match="permission denied")
    check(scalar(conn, "SELECT count(account_username) FROM trainer") == 4, "public columns not readable")

@test("Security")
def competitor_cannot_admin(conn, ids):
    """Competitor can't create formats, ban species or validate others' teams"""
    oak, team = ids.trainer("oak"), ids.team("Baby Steps")
    as_role(conn, "pokedex_competitor", ids.trainer("misty"))
    expect_error(conn, "INSERT INTO battle_format (format_name, level_cap, managed_by_trainer_id) VALUES ('Mine', 50, %s)",
                 (oak,), "permission denied")
    expect_error(conn, "DELETE FROM format_banned_species", match="permission denied")
    expect_error(conn, "CALL sp_validate_team(%s)", (team,), "is not yours")

@test("Security")
def competitor_full_flow(conn, ids):
    """Competitor creates a team, adds a member and move, and validates it, all under RLS"""
    misty, fmt = ids.trainer("misty"), ids.format("Little Cup")
    species, ability, nature, move = ids.species("Gastly"), ids.ability("Levitate"), ids.nature("Timid"), ids.move("Shadow Ball")
    as_role(conn, "pokedex_competitor", misty)
    team = scalar(conn, """INSERT INTO competitive_team (owned_by_trainer_id, battle_format_id, team_name)
                           VALUES (%s, %s, 'Spooky') RETURNING team_identification_number""", misty, fmt)
    member = scalar(conn, """INSERT INTO individual_team_member (belongs_to_team_id, team_slot_number, base_species_id,
                             assigned_ability_id, assigned_nature_id, experience_level)
                             VALUES (%s, 1, %s, %s, %s, 5) RETURNING member_identification_number""",
                    team, species, ability, nature)
    conn.execute("INSERT INTO member_equipped_moves VALUES (%s, %s, 1)", (member, move))
    conn.execute("CALL sp_validate_team(%s)", (team,))
    check(scalar(conn, "SELECT team_status FROM competitive_team WHERE team_identification_number = %s", team) == "validated", "not validated")

@test("Security")
def admin_powers(conn, ids):
    """Admin creates formats, sees every team (including drafts) and can delete any team"""
    oak = ids.trainer("oak")
    as_role(conn, "pokedex_admin", oak)
    conn.execute("INSERT INTO battle_format (format_name, level_cap, managed_by_trainer_id) VALUES ('Admin Cup', 50, %s)", (oak,))
    check(scalar(conn, "SELECT count(*) FROM competitive_team") == 5, "admin does not see all teams")
    check(conn.execute("DELETE FROM competitive_team WHERE team_name = 'Baby Steps'").rowcount == 1, "admin delete failed")
    conn.execute("CALL sp_refresh_usage_statistics()")

@test("Security")
def guest_session_lookup(conn, ids):
    """fn_get_trainer_session lets the backend re-read a trainer's current role as guest"""
    ash = ids.trainer("ash")
    as_role(conn, "pokedex_guest")
    row = conn.execute("SELECT account_username, access_role FROM fn_get_trainer_session(%s)", (ash,)).fetchone()
    check(row == ("ash", "competitor"), str(row))

@test("Function")
def evolution_line(conn, ids):
    """fn_species_evolution_line walks up and down the family (Pikachu -> Pichu, Pikachu, Raichu)"""
    rows = conn.execute("SELECT stage, species_name FROM fn_species_evolution_line(%s)", (ids.species("Pikachu"),)).fetchall()
    check(rows == [(1, "Pichu"), (2, "Pikachu"), (3, "Raichu")], str(rows))

@test("Security")
def app_login_role_has_no_rights(conn, ids):
    """The pokedex_app login role can do nothing until it switches role (NOINHERIT)"""
    conn.execute("SET LOCAL ROLE pokedex_app")
    expect_error(conn, "SELECT count(*) FROM pokemon_species", match="permission denied")


# ---------------------------------------------------------------- runner

def main():
    sys.stdout.reconfigure(encoding="utf-8")
    load_dotenv(ROOT / ".env")
    url = os.getenv("TEST_DATABASE_URL") or os.getenv("DATABASE_URL")
    if not url:
        sys.exit("DATABASE_URL is not set (put it in .env in the repository root)")

    results = []
    with psycopg.connect(url) as conn:
        ids = Ids(conn)
        for category, description, fn in TESTS:
            try:
                with conn.transaction(force_rollback=True):
                    fn(conn, ids)
                results.append((category, description, "PASS", ""))
            except Exception as e:  # noqa: BLE001 - report every failure, keep going
                detail = str(e).splitlines()[0] if str(e) else traceback.format_exc(limit=1)
                results.append((category, description, "FAIL", detail))

    passed = sum(r[2] == "PASS" for r in results)
    width = max(len(r[1]) for r in results)
    for category, description, status, detail in results:
        print(f"{status}  {category:<11} {description:<{width}}  {detail}")
    print(f"\n{passed}/{len(results)} passed")

    lines = [f"# Database test results\n",
             f"Run {datetime.now():%Y-%m-%d %H:%M} with `python database/tests/test_database.py`: "
             f"**{passed}/{len(results)} passed**.\n",
             "| # | Area | Test | Result |", "|---|---|---|---|"]
    for i, (category, description, status, detail) in enumerate(results, 1):
        lines.append(f"| {i} | {category} | {description} | {status}{' - ' + detail if detail else ''} |")
    RESULTS.write_text("\n".join(lines) + "\n", encoding="utf-8")
    sys.exit(0 if passed == len(results) else 1)


if __name__ == "__main__":
    main()
