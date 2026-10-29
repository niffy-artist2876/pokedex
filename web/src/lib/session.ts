import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SignJWT, jwtVerify } from "jose";
import { GUEST, withDb, type Actor } from "./db";

const COOKIE = "pokedex_session";
const LIFETIME_SECONDS = 8 * 60 * 60;
const key = new TextEncoder().encode(process.env.SESSION_SECRET);

export type User = { trainerId: number; username: string; role: "competitor" | "admin" };

export async function createSession(trainerId: number) {
  const token = await new SignJWT({ tid: trainerId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${LIFETIME_SECONDS}s`)
    .sign(key);
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: LIFETIME_SECONDS,
  });
}

export async function deleteSession() {
  (await cookies()).delete(COOKIE);
}

/**
 * The signed-in trainer, or null. The cookie only carries the trainer id; the
 * username and role are re-read from the database on every request, so a role
 * change or account deletion applies immediately.
 */
export async function getCurrentUser(): Promise<User | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  return token ? userFromToken(token) : null;
}

// Deduplicated per request. The cookie is read outside: a cached call must not
// capture the cookie store of one rendering phase and reuse it in another.
const userFromToken = cache(async (token: string): Promise<User | null> => {
  let trainerId: number;
  try {
    const { payload } = await jwtVerify(token, key);
    trainerId = Number(payload.tid);
  } catch {
    return null;
  }
  const row = await withDb(GUEST, (db) =>
    db.one<{ trainer_id: number; account_username: string; access_role: User["role"] }>(
      "SELECT * FROM fn_get_trainer_session($1)",
      [trainerId],
    ),
  );
  return row ? { trainerId: row.trainer_id, username: row.account_username, role: row.access_role } : null;
});

export function actorFor(user: User | null): Actor {
  return user ? { role: user.role, trainerId: user.trainerId } : GUEST;
}

export async function currentActor(): Promise<Actor> {
  return actorFor(await getCurrentUser());
}

export async function requireUser(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

export async function requireAdmin(): Promise<User> {
  const user = await requireUser();
  if (user.role !== "admin") redirect("/");
  return user;
}
