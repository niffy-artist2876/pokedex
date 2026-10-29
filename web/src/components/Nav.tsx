import Link from "next/link";
import { getCurrentUser } from "@/lib/session";
import { logout } from "@/app/actions/auth";

const linkClass = "text-sm text-slate-700 hover:text-red-600";

export async function NavLinks() {
  const user = await getCurrentUser();
  return (
    <nav className="flex flex-1 flex-wrap items-center gap-x-4 gap-y-1">
      <Link href="/pokedex" className={linkClass}>Pokédex</Link>
      <Link href="/search" className={linkClass}>Moves & Abilities</Link>
      {user && <Link href="/teams" className={linkClass}>My Teams</Link>}
      {user && <Link href="/community" className={linkClass}>Community</Link>}
      <Link href="/stats" className={linkClass}>Usage Stats</Link>
      {user?.role === "admin" && (
        <Link href="/admin" className="text-sm font-medium text-red-700 hover:text-red-800">Admin</Link>
      )}
    </nav>
  );
}

export async function UserMenu() {
  const user = await getCurrentUser();
  if (!user) {
    return (
      <div className="flex items-center gap-3 text-sm">
        <Link href="/login" className="text-slate-700 hover:text-red-600">Log in</Link>
        <Link href="/signup" className="rounded-md bg-red-600 px-3 py-1.5 font-medium text-white hover:bg-red-700">
          Sign up
        </Link>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="text-slate-700">
        {user.username}
        <span className="ml-1.5 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">{user.role}</span>
      </span>
      <form action={logout}>
        <button className="text-slate-600 hover:text-red-600">Log out</button>
      </form>
    </div>
  );
}
