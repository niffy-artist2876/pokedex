import Link from "next/link";
import { Suspense } from "react";
import { withDb } from "@/lib/db";
import { actorFor, getCurrentUser } from "@/lib/session";
import { refreshUsageStats } from "@/app/actions/admin";
import { ActionForm } from "@/components/ActionForm";
import { Card, Empty, Loading, PageTitle, Sprite } from "@/components/ui";

type Usage = { format_id: number; format_name: string; species_id: number; species_name: string; teams_using: number; usage_percent: number };

export default function StatsPage() {
  return (
    <>
      <PageTitle subtitle="How often each Pokémon appears on validated teams, per format (materialized view).">
        Usage statistics
      </PageTitle>
      <Suspense fallback={<Loading />}>
        <UsageStats />
      </Suspense>
    </>
  );
}

async function UsageStats() {
  const user = await getCurrentUser();
  const { usage, formats } = await withDb(actorFor(user), async (db) => ({
    usage: await db.all<Usage>(
      `SELECT u.format_id, f.format_name, u.species_id, u.species_name, u.teams_using, u.usage_percent
       FROM mv_species_usage_stats u JOIN battle_format f ON f.format_identification_number = u.format_id
       ORDER BY f.format_name, u.usage_percent DESC, u.species_name`,
    ),
    // Formats overview: GROUP BY over the ban list
    formats: await db.all<{ format_name: string; level_cap: number; is_active: boolean; bans: number }>(
      `SELECT f.format_name, f.level_cap, f.is_active, count(b.species_national_pokedex_number) AS bans
       FROM battle_format f LEFT JOIN format_banned_species b USING (format_identification_number)
       GROUP BY f.format_identification_number ORDER BY f.is_active DESC, f.format_name`,
    ),
  }));

  const byFormat = Map.groupBy(usage, (u) => u.format_name);

  return (
    <div className="space-y-6">
      {user?.role === "admin" && (
        <ActionForm action={refreshUsageStats} submitLabel="Refresh statistics" variant="secondary" />
      )}
      {byFormat.size === 0 ? (
        <Empty>No validated teams yet.</Empty>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {[...byFormat].map(([format, rows]) => (
            <Card key={format} title={format}>
              <ul className="space-y-1">
                {rows.slice(0, 12).map((r) => (
                  <li key={r.species_id} className="grid grid-cols-[2.5rem_8rem_1fr_3.5rem] items-center gap-2 text-sm">
                    <Sprite id={r.species_id} name={r.species_name} size={36} />
                    <Link href={`/pokedex/${r.species_id}`} className="truncate hover:text-red-700">{r.species_name}</Link>
                    <div className="h-2 rounded bg-slate-100">
                      <div className="h-2 rounded bg-red-500" style={{ width: `${r.usage_percent}%` }} />
                    </div>
                    <span className="text-right font-mono tabular-nums">{r.usage_percent}%</span>
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
      )}
      <Card title="Formats">
        <table className="w-full text-sm">
          <thead className="text-left text-slate-500"><tr><th className="py-1">Format</th><th>Level cap</th><th>Banned species</th><th>Status</th></tr></thead>
          <tbody>
            {formats.map((f) => (
              <tr key={f.format_name} className="border-t border-slate-100">
                <td className="py-1">{f.format_name}</td><td>{f.level_cap}</td><td>{f.bans}</td>
                <td>{f.is_active ? "active" : <span className="text-slate-400">retired</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
