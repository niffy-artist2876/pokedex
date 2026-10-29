import "server-only";
import pg from "pg";

// int8 (counts) and numeric come back as strings by default; the values in
// this schema are small enough to be plain JavaScript numbers.
pg.types.setTypeParser(20, (v) => parseInt(v, 10));
pg.types.setTypeParser(1700, (v) => parseFloat(v));

const globalForPool = globalThis as unknown as { pokedexPool?: pg.Pool };

// The app always connects as pokedex_app, which has no privileges of its own
// (NOINHERIT); every request switches to the role of whoever is signed in.
const pool =
  globalForPool.pokedexPool ??
  new pg.Pool({ connectionString: process.env.APP_DATABASE_URL, max: 10 });
if (process.env.NODE_ENV !== "production") globalForPool.pokedexPool = pool;

export type Role = "guest" | "competitor" | "admin";
export type Actor = { role: Role; trainerId: number | null };
export const GUEST: Actor = { role: "guest", trainerId: null };

const DATABASE_ROLES: Record<Role, string> = {
  guest: "pokedex_guest",
  competitor: "pokedex_competitor",
  admin: "pokedex_admin",
};

export class Db {
  constructor(private client: pg.PoolClient) {}

  async all<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
    return (await this.client.query(sql, params)).rows as T[];
  }

  async one<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T | null> {
    return ((await this.client.query(sql, params)).rows[0] as T) ?? null;
  }

  async run(sql: string, params: unknown[] = []): Promise<number> {
    return (await this.client.query(sql, params)).rowCount ?? 0;
  }
}

/**
 * Runs `work` in one transaction as the given actor: SET LOCAL ROLE picks the
 * database role and pokedex.trainer_id drives the row-level security policies.
 * Both reset automatically at COMMIT / ROLLBACK, so pooled connections never
 * leak one user's identity into another request.
 */
export async function withDb<T>(actor: Actor, work: (db: Db) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`SET LOCAL ROLE ${DATABASE_ROLES[actor.role]}`);
    await client.query("SELECT set_config('pokedex.trainer_id', $1, true)", [
      actor.trainerId ? String(actor.trainerId) : "",
    ]);
    const result = await work(new Db(client));
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

const CONSTRAINT_MESSAGES: Record<string, string> = {
  individual_team_member_belongs_to_team_id_base_species_id_key: "Species clause: that species is already on this team.",
  individual_team_member_belongs_to_team_id_assigned_held_ite_key: "Item clause: another member already holds that item.",
  individual_team_member_belongs_to_team_id_team_slot_number_key: "That team slot is already taken.",
  individual_team_member_base_species_id_assigned_ability_id_fkey: "That ability isn't available to this species.",
  individual_team_member_check: "EVs can total at most 510.",
  individual_team_member_experience_level_check: "Level must be between 1 and 100.",
  member_equipped_moves_pkey: "A member can't know the same move twice.",
  competitive_team_owned_by_trainer_id_team_name_key: "You already have a team with that name.",
  trainer_account_username_key: "That username is taken.",
  uq_trainer_username_ci: "That username is taken.",
  trainer_email_address_key: "That e-mail is already registered.",
  uq_trainer_email_ci: "That e-mail is already registered.",
  chk_trainer_username_format: "Username must be 3-40 letters, digits or underscores.",
  chk_trainer_email_format: "Enter a valid e-mail address.",
  battle_format_format_name_key: "A format with that name already exists.",
  battle_format_level_cap_check: "Level cap must be between 1 and 100.",
  battle_format_minimum_team_size_check: "Minimum team size must be between 1 and 6.",
  battle_format_maximum_legendary_members_check: "Legendary limit must be between 0 and 6.",
  format_banned_species_pkey: "That species is already banned in this format.",
  battle_format_managed_by_trainer_id_fkey: "This trainer still manages formats; reassign them first.",
};

/** Turns a PostgreSQL error into a message a player can act on. */
export function dbErrorMessage(error: unknown): string {
  if (!(error instanceof pg.DatabaseError)) {
    console.error(error);
    return "Something went wrong. Please try again.";
  }
  if (error.constraint && CONSTRAINT_MESSAGES[error.constraint]) return CONSTRAINT_MESSAGES[error.constraint];
  if (error.code === "P0001" || (error.code === "23514" && !error.constraint)) return error.message; // RAISE EXCEPTION in triggers/procedures
  if (error.code === "23514" && error.constraint) {
    const field = error.constraint.replace(/^individual_team_member_/, "").replace(/_check$/, "").replaceAll("_", " ");
    return `Value out of range: ${field}.`;
  }
  if (error.code === "42501") return "You don't have permission to do that.";
  return error.message;
}
