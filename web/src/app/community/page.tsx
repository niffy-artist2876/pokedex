import Link from "next/link";
import { Suspense } from "react";
import { withDb } from "@/lib/db";
import { actorFor, requireUser } from "@/lib/session";
import { param, positiveInt, type SearchParams } from "@/lib/params";
import { TeamCard, type TeamOverview } from "@/components/TeamCard";
import { Empty, Loading, PageTitle } from "@/components/ui";

export default function CommunityPage({ searchParams }: PageProps<"/community">) {
  return (
    <>
      <PageTitle subtitle="Validated teams published by other trainers. Open one to see its analysis or clone it.">
        Community teams
      </PageTitle>
      <Suspense fallback={<Loading />}>
        <CommunityTeams searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function CommunityTeams({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const formatId = positiveInt(sp.format);
  const species = param(sp.species);
  const user = await requireUser();
  const isAdmin = user.role === "admin";

  const { formats, teams } = await withDb(actorFor(user), async (db) => ({
    formats: await db.all<{ format_identification_number: number; format_name: string }>(
      "SELECT format_identification_number, format_name FROM battle_format ORDER BY format_name",
    ),
    // RLS already limits competitors to their own + validated teams; admins see drafts too.
    teams: await db.all<TeamOverview>(
      `SELECT * FROM v_team_overview
       WHERE owner_id <> $1
         AND ($2::int IS NULL OR format_id = $2)
         AND ($3 = '' OR roster ILIKE '%' || $3 || '%')
       ORDER BY team_status DESC, last_modified_timestamp DESC`,
      [user.trainerId, formatId, species],
    ),
  }));

  return (
    <div className="space-y-4">
      <form className="flex flex-wrap gap-2">
        <select name="format" defaultValue={formatId ?? ""} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm">
          <option value="">All formats</option>
          {formats.map((f) => <option key={f.format_identification_number} value={f.format_identification_number}>{f.format_name}</option>)}
        </select>
        <input name="species" defaultValue={species} placeholder="Uses Pokémon…" className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm" />
        <button className="rounded-md bg-red-600 px-3 text-sm font-medium text-white hover:bg-red-700">Filter</button>
        {(formatId || species) && <Link href="/community" className="self-center text-sm text-slate-600 hover:underline">Clear</Link>}
      </form>
      {isAdmin && <p className="text-sm text-slate-600">As an admin you also see other trainers&apos; drafts.</p>}
      {teams.length === 0 ? (
        <Empty>No teams found.</Empty>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {teams.map((t) => <TeamCard key={t.team_id} team={t} showOwner />)}
        </ul>
      )}
    </div>
  );
}
