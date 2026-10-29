"use server";

import bcrypt from "bcryptjs";
import { redirect } from "next/navigation";
import { GUEST, dbErrorMessage, withDb } from "@/lib/db";
import { createSession, deleteSession } from "@/lib/session";
import { text, type ActionState } from "@/lib/action-state";

// Compared against when the username doesn't exist, so a failed login takes the
// same time either way and doesn't reveal which usernames are registered.
const DUMMY_HASH = bcrypt.hashSync("not-a-real-password", 12);

export async function login(_: ActionState, formData: FormData): Promise<ActionState> {
  const login = text(formData, "login");
  const password = String(formData.get("password") ?? "");
  if (!login || !password) return { error: "Enter your username (or e-mail) and password." };

  let trainerId: number | null = null;
  try {
    const row = await withDb(GUEST, (db) =>
      db.one<{ trainer_id: number; password_hash: string }>("SELECT * FROM fn_get_login_credentials($1)", [login]),
    );
    const ok = await bcrypt.compare(password, row?.password_hash ?? DUMMY_HASH);
    if (row && ok) trainerId = row.trainer_id;
  } catch (error) {
    return { error: dbErrorMessage(error) };
  }
  if (!trainerId) return { error: "Wrong username or password." };

  await createSession(trainerId);
  redirect("/teams");
}

export async function signup(_: ActionState, formData: FormData): Promise<ActionState> {
  const username = text(formData, "username");
  const email = text(formData, "email");
  const password = String(formData.get("password") ?? "");
  // Plain-text password rules can only be checked here; everything else
  // (username/e-mail format, uniqueness, bcrypt hash shape) is enforced by the database.
  if (password.length < 8) return { error: "Password must be at least 8 characters." };
  if (password !== String(formData.get("confirm") ?? "")) return { error: "Passwords don't match." };

  let trainerId: number;
  try {
    const hash = await bcrypt.hash(password, 12);
    const row = await withDb(GUEST, (db) =>
      db.one<{ id: number }>("SELECT fn_register_trainer($1, $2, $3) AS id", [username, email, hash]),
    );
    trainerId = row!.id;
  } catch (error) {
    return { error: dbErrorMessage(error) };
  }

  await createSession(trainerId);
  redirect("/teams");
}

export async function logout() {
  await deleteSession();
  redirect("/");
}
