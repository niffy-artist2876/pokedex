"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { dbErrorMessage, withDb } from "@/lib/db";
import { actorFor, requireAdmin } from "@/lib/session";
import { descriptionText, embed } from "@/lib/embeddings";
import { int, text, type ActionState } from "@/lib/action-state";

// ---------------------------------------------------------------- formats

function formatValues(formData: FormData) {
  const maxLegends = text(formData, "max_legendaries");
  return [
    text(formData, "name"),
    int(formData, "level_cap"),
    text(formData, "rules") || null,
    int(formData, "min_team_size"),
    maxLegends === "" ? null : Number(maxLegends),
    formData.get("active") === "on",
  ];
}

export async function createFormat(_: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  let id: number;
  try {
    const row = await withDb(actorFor(admin), (db) =>
      db.one<{ id: number }>(
        `INSERT INTO battle_format (format_name, level_cap, ruleset_description, minimum_team_size,
                                    maximum_legendary_members, is_active, managed_by_trainer_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING format_identification_number AS id`,
        [...formatValues(formData), admin.trainerId],
      ),
    );
    id = row!.id;
  } catch (error) {
    return { error: dbErrorMessage(error) };
  }
  redirect(`/admin/formats/${id}`);
}

export async function updateFormat(formatId: number, _: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  try {
    await withDb(actorFor(admin), (db) =>
      db.run(
        `UPDATE battle_format SET format_name = $2, level_cap = $3, ruleset_description = $4,
                minimum_team_size = $5, maximum_legendary_members = $6, is_active = $7
         WHERE format_identification_number = $1`,
        [formatId, ...formatValues(formData)],
      ),
    );
  } catch (error) {
    return { error: dbErrorMessage(error) };
  }
  refresh();
  return { message: "Format saved." };
}

export async function deleteFormat(formatId: number): Promise<ActionState> {
  const admin = await requireAdmin();
  try {
    await withDb(actorFor(admin), (db) =>
      db.run("DELETE FROM battle_format WHERE format_identification_number = $1", [formatId]),
    );
  } catch (error) {
    const message = dbErrorMessage(error);
    return { error: message.includes("competitive_team") ? "Teams still use this format; deactivate it instead." : message };
  }
  redirect("/admin/formats");
}

export async function addBan(formatId: number, _: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  const species = text(formData, "species");
  try {
    const added = await withDb(actorFor(admin), (db) =>
      db.run(
        `INSERT INTO format_banned_species (format_identification_number, species_national_pokedex_number)
         SELECT $1, species_national_pokedex_number FROM pokemon_species WHERE lower(species_name) = lower($2)`,
        [formatId, species],
      ),
    );
    if (!added) return { error: `No species called "${species}".` };
  } catch (error) {
    return { error: dbErrorMessage(error) };
  }
  refresh();
  return { message: `${species} banned. Validated teams using it were moved back to draft.` };
}

export async function removeBan(formatId: number, speciesId: number): Promise<ActionState> {
  const admin = await requireAdmin();
  try {
    await withDb(actorFor(admin), (db) =>
      db.run(
        "DELETE FROM format_banned_species WHERE format_identification_number = $1 AND species_national_pokedex_number = $2",
        [formatId, speciesId],
      ),
    );
  } catch (error) {
    return { error: dbErrorMessage(error) };
  }
  refresh();
  return {};
}

// ---------------------------------------------------------------- trainers and statistics

export async function changeRole(trainerId: number, _: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  if (trainerId === admin.trainerId) return { error: "You can't change your own role." };
  try {
    await withDb(actorFor(admin), (db) =>
      db.run("UPDATE trainer SET system_access_role = $2 WHERE trainer_identification_number = $1", [
        trainerId,
        text(formData, "role"),
      ]),
    );
  } catch (error) {
    return { error: dbErrorMessage(error) };
  }
  refresh();
  return { message: "Role updated." };
}

export async function deleteTrainer(trainerId: number): Promise<ActionState> {
  const admin = await requireAdmin();
  if (trainerId === admin.trainerId) return { error: "You can't delete your own account here." };
  try {
    await withDb(actorFor(admin), (db) =>
      db.run("DELETE FROM trainer WHERE trainer_identification_number = $1", [trainerId]),
    );
  } catch (error) {
    return { error: dbErrorMessage(error) };
  }
  refresh();
  return {};
}

export async function refreshUsageStats(): Promise<ActionState> {
  const admin = await requireAdmin();
  try {
    await withDb(actorFor(admin), (db) => db.run("CALL sp_refresh_usage_statistics()"));
  } catch (error) {
    return { error: dbErrorMessage(error) };
  }
  refresh();
  return { message: "Usage statistics refreshed." };
}

// ---------------------------------------------------------------- descriptions and embeddings

const KINDS = {
  move: { table: "combat_move", id: "move_identification_number", name: "move_name", desc: "move_effect_description" },
  ability: { table: "special_ability", id: "ability_identification_number", name: "ability_name", desc: "ability_effect_description" },
} as const;
export type DescriptionKind = keyof typeof KINDS;

/** Update: save new description text and (by default) a fresh embedding with it. */
export async function updateDescription(
  kind: DescriptionKind,
  id: number,
  _: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const admin = await requireAdmin();
  const k = KINDS[kind];
  const description = text(formData, "description");
  if (!description) return { error: "The description can't be empty." };
  try {
    await withDb(actorFor(admin), async (db) => {
      const row = await db.one<{ name: string }>(`SELECT ${k.name} AS name FROM ${k.table} WHERE ${k.id} = $1`, [id]);
      if (!row) throw new Error("not-found");
      if (formData.get("reembed") === "on") {
        const vector = await embed(descriptionText(row.name, description));
        await db.run(`UPDATE ${k.table} SET ${k.desc} = $2, description_embedding = $3::vector WHERE ${k.id} = $1`, [
          id,
          description,
          vector,
        ]);
      } else {
        // trg_*_description_changed clears the now-stale embedding
        await db.run(`UPDATE ${k.table} SET ${k.desc} = $2 WHERE ${k.id} = $1`, [id, description]);
      }
    });
  } catch (error) {
    return { error: dbErrorMessage(error) };
  }
  refresh();
  return { message: formData.get("reembed") === "on" ? "Saved and re-embedded." : "Saved; embedding cleared." };
}

/** Re-embed one row from its current text. */
export async function reembed(kind: DescriptionKind, id: number): Promise<ActionState> {
  const admin = await requireAdmin();
  const k = KINDS[kind];
  try {
    await withDb(actorFor(admin), async (db) => {
      const row = await db.one<{ name: string; description: string | null }>(
        `SELECT ${k.name} AS name, ${k.desc} AS description FROM ${k.table} WHERE ${k.id} = $1`,
        [id],
      );
      if (!row?.description) throw new Error("no-description");
      const vector = await embed(descriptionText(row.name, row.description));
      await db.run(`UPDATE ${k.table} SET description_embedding = $2::vector WHERE ${k.id} = $1`, [id, vector]);
    });
  } catch (error) {
    if (error instanceof Error && error.message === "no-description") return { error: "Nothing to embed: no description." };
    return { error: dbErrorMessage(error) };
  }
  refresh();
  return { message: "Embedding updated." };
}

/** Delete: remove a row's embedding, taking it out of semantic search. */
export async function clearEmbedding(kind: DescriptionKind, id: number): Promise<ActionState> {
  const admin = await requireAdmin();
  const k = KINDS[kind];
  try {
    await withDb(actorFor(admin), (db) =>
      db.run(`UPDATE ${k.table} SET description_embedding = NULL WHERE ${k.id} = $1`, [id]),
    );
  } catch (error) {
    return { error: dbErrorMessage(error) };
  }
  refresh();
  return { message: "Embedding removed; it no longer appears in semantic search." };
}

/** Create: embed every row that has a description but no vector yet. */
export async function embedMissing(kind: DescriptionKind): Promise<ActionState> {
  const admin = await requireAdmin();
  const k = KINDS[kind];
  let count = 0;
  try {
    await withDb(actorFor(admin), async (db) => {
      const rows = await db.all<{ id: number; name: string; description: string }>(
        `SELECT ${k.id} AS id, ${k.name} AS name, ${k.desc} AS description FROM ${k.table}
         WHERE description_embedding IS NULL AND ${k.desc} IS NOT NULL`,
      );
      for (const row of rows) {
        const vector = await embed(descriptionText(row.name, row.description));
        await db.run(`UPDATE ${k.table} SET description_embedding = $2::vector WHERE ${k.id} = $1`, [row.id, vector]);
      }
      count = rows.length;
    });
  } catch (error) {
    return { error: dbErrorMessage(error) };
  }
  refresh();
  return { message: `Embedded ${count} ${kind === "move" ? "moves" : "abilities"}.` };
}
