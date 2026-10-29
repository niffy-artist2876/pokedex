"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { dbErrorMessage, withDb } from "@/lib/db";
import { actorFor, requireUser } from "@/lib/session";
import { int, text, type ActionState } from "@/lib/action-state";

const STATS = ["hit_points", "attack", "defense", "special_attack", "special_defense", "speed"] as const;

export async function createTeam(_: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  const name = text(formData, "name");
  const formatId = int(formData, "format");
  if (!name) return { error: "Give the team a name." };
  if (!formatId) return { error: "Pick a format." };

  let teamId: number;
  try {
    const row = await withDb(actorFor(user), (db) =>
      db.one<{ id: number }>(
        `INSERT INTO competitive_team (owned_by_trainer_id, battle_format_id, team_name)
         VALUES ($1, $2, $3) RETURNING team_identification_number AS id`,
        [user.trainerId, formatId, name],
      ),
    );
    teamId = row!.id;
  } catch (error) {
    return { error: dbErrorMessage(error) };
  }
  redirect(`/teams/${teamId}`);
}

export async function updateTeam(teamId: number, _: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  try {
    const changed = await withDb(actorFor(user), (db) =>
      db.run(
        "UPDATE competitive_team SET team_name = $2, battle_format_id = $3 WHERE team_identification_number = $1",
        [teamId, text(formData, "name"), int(formData, "format")],
      ),
    );
    if (!changed) return { error: "That team doesn't exist or isn't yours." };
  } catch (error) {
    return { error: dbErrorMessage(error) };
  }
  refresh();
  return { message: "Saved." };
}

export async function deleteTeam(teamId: number): Promise<ActionState> {
  const user = await requireUser();
  try {
    const deleted = await withDb(actorFor(user), (db) =>
      db.run("DELETE FROM competitive_team WHERE team_identification_number = $1", [teamId]),
    );
    if (!deleted) return { error: "That team doesn't exist or you can't delete it." };
  } catch (error) {
    return { error: dbErrorMessage(error) };
  }
  redirect(user.role === "admin" ? "/community" : "/teams");
}

export async function validateTeam(teamId: number): Promise<ActionState> {
  const user = await requireUser();
  try {
    await withDb(actorFor(user), (db) => db.run("CALL sp_validate_team($1)", [teamId]));
  } catch (error) {
    return { error: dbErrorMessage(error) };
  }
  refresh();
  return { message: "Team is valid for its format." };
}

export async function cloneTeam(teamId: number, _: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  let newId: number;
  try {
    const row = await withDb(actorFor(user), (db) =>
      db.one<{ p_new_team_id: number }>("CALL sp_clone_team($1, $2, $3, NULL)", [
        teamId,
        user.trainerId,
        text(formData, "name"),
      ]),
    );
    newId = row!.p_new_team_id;
  } catch (error) {
    return { error: dbErrorMessage(error) };
  }
  redirect(`/teams/${newId}`);
}

/** Adds (memberId = null) or edits a team member and its moves in one transaction. */
export async function saveMember(
  teamId: number,
  memberId: number | null,
  _: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  const evs = STATS.map((s) => int(formData, `ev_${s}`) ?? 0);
  const ivs = STATS.map((s) => int(formData, `iv_${s}`) ?? 31);
  if ([...evs, ...ivs].some(Number.isNaN)) return { error: "EVs and IVs must be whole numbers." };
  const moves = [1, 2, 3, 4].map((i) => int(formData, `move${i}`)).filter((m): m is number => m !== null);
  if (moves.length === 0) return { error: "Pick at least one move." };

  const values = [
    int(formData, "species"),
    int(formData, "ability"),
    int(formData, "item"),
    int(formData, "nature"),
    int(formData, "tera"),
    int(formData, "level"),
    ...evs,
    ...ivs,
  ];

  try {
    await withDb(actorFor(user), async (db) => {
      let id = memberId;
      if (id) {
        // Old moves go first: the species-change trigger checks equipped moves.
        await db.run("DELETE FROM member_equipped_moves WHERE member_identification_number = $1", [id]);
        const changed = await db.run(
          `UPDATE individual_team_member SET
             base_species_id = $3, assigned_ability_id = $4, assigned_held_item_id = $5, assigned_nature_id = $6,
             terastallize_type_id = $7, experience_level = $8,
             effort_value_hit_points = $9, effort_value_attack = $10, effort_value_defense = $11,
             effort_value_special_attack = $12, effort_value_special_defense = $13, effort_value_speed = $14,
             individual_value_hit_points = $15, individual_value_attack = $16, individual_value_defense = $17,
             individual_value_special_attack = $18, individual_value_special_defense = $19, individual_value_speed = $20
           WHERE member_identification_number = $1 AND belongs_to_team_id = $2`,
          [id, teamId, ...values],
        );
        if (!changed) throw new Error("not-found");
      } else {
        const slot = await db.one<{ slot: number }>(
          `SELECT s AS slot FROM generate_series(1, 6) s
           WHERE s NOT IN (SELECT team_slot_number FROM individual_team_member WHERE belongs_to_team_id = $1)
           ORDER BY s LIMIT 1`,
          [teamId],
        );
        if (!slot) throw new Error("team-full");
        const row = await db.one<{ id: number }>(
          `INSERT INTO individual_team_member (
             belongs_to_team_id, team_slot_number, base_species_id, assigned_ability_id, assigned_held_item_id,
             assigned_nature_id, terastallize_type_id, experience_level,
             effort_value_hit_points, effort_value_attack, effort_value_defense,
             effort_value_special_attack, effort_value_special_defense, effort_value_speed,
             individual_value_hit_points, individual_value_attack, individual_value_defense,
             individual_value_special_attack, individual_value_special_defense, individual_value_speed)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
           RETURNING member_identification_number AS id`,
          [teamId, slot.slot, ...values],
        );
        id = row!.id;
      }
      for (const [i, move] of moves.entries()) {
        await db.run("INSERT INTO member_equipped_moves VALUES ($1, $2, $3)", [id, move, i + 1]);
      }
    });
  } catch (error) {
    if (error instanceof Error && error.message === "team-full") return { error: "The team already has 6 members." };
    if (error instanceof Error && error.message === "not-found") return { error: "That member doesn't exist or isn't yours." };
    return { error: dbErrorMessage(error) };
  }
  redirect(`/teams/${teamId}`);
}

export async function deleteMember(teamId: number, memberId: number): Promise<ActionState> {
  const user = await requireUser();
  try {
    const deleted = await withDb(actorFor(user), (db) =>
      db.run("DELETE FROM individual_team_member WHERE member_identification_number = $1 AND belongs_to_team_id = $2", [
        memberId,
        teamId,
      ]),
    );
    if (!deleted) return { error: "That member doesn't exist or isn't yours." };
  } catch (error) {
    return { error: dbErrorMessage(error) };
  }
  refresh();
  return { message: "Removed." };
}
