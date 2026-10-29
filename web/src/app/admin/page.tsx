import { Suspense } from "react";
import { withDb } from "@/lib/db";
import { actorFor, requireAdmin } from "@/lib/session";
import { AdminNav } from "@/components/AdminNav";
import { Card, Loading, PageTitle } from "@/components/ui";

export default function AdminPage() {
  return (
    <>
      <PageTitle>Admin</PageTitle>
      <AdminNav current="/admin" />
      <Suspense fallback={<Loading />}>
        <Overview />
      </Suspense>
    </>
  );
}

async function Overview() {
  const admin = await requireAdmin();
  const { counts, recent } = await withDb(actorFor(admin), async (db) => ({
    counts: (await db.one<Record<string, number>>(
      `SELECT (SELECT count(*) FROM trainer) AS trainers,
              (SELECT count(*) FROM trainer WHERE system_access_role = 'admin') AS admins,
              (SELECT count(*) FROM competitive_team) AS teams,
              (SELECT count(*) FROM competitive_team WHERE team_status = 'validated') AS validated,
              (SELECT count(*) FROM battle_format WHERE is_active) AS active_formats,
              (SELECT count(*) FROM combat_move WHERE description_embedding IS NOT NULL) AS embedded_moves,
              (SELECT count(*) FROM combat_move) AS moves,
              (SELECT count(*) FROM special_ability WHERE description_embedding IS NOT NULL) AS embedded_abilities,
              (SELECT count(*) FROM special_ability) AS abilities`,
    ))!,
    // Teams per trainer: GROUP BY with HAVING, newest activity first
    recent: await db.all<{ account_username: string; teams: number; validated: number; last_activity: string }>(
      `SELECT tr.account_username, count(t.team_identification_number) AS teams,
              count(*) FILTER (WHERE t.team_status = 'validated') AS validated,
              to_char(max(t.last_modified_timestamp), 'YYYY-MM-DD HH24:MI') AS last_activity
       FROM trainer tr JOIN competitive_team t ON t.owned_by_trainer_id = tr.trainer_identification_number
       GROUP BY tr.account_username
       HAVING count(t.team_identification_number) > 0
       ORDER BY max(t.last_modified_timestamp) DESC`,
    ),
  }));

  const tiles = [
    ["Trainers", `${counts.trainers}`, `${counts.admins} admin`],
    ["Teams", `${counts.teams}`, `${counts.validated} validated`],
    ["Active formats", `${counts.active_formats}`, ""],
    ["Embedded moves", `${counts.embedded_moves}/${counts.moves}`, ""],
    ["Embedded abilities", `${counts.embedded_abilities}/${counts.abilities}`, ""],
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {tiles.map(([label, value, sub]) => (
          <div key={label} className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="text-2xl font-bold tabular-nums">{value}</div>
            <div className="text-sm text-slate-600">{label}</div>
            {sub && <div className="text-xs text-slate-500">{sub}</div>}
          </div>
        ))}
      </div>
      <Card title="Trainer activity">
        <table className="w-full text-sm">
          <thead className="text-left text-slate-500"><tr><th className="py-1">Trainer</th><th>Teams</th><th>Validated</th><th>Last activity</th></tr></thead>
          <tbody>
            {recent.map((r) => (
              <tr key={r.account_username} className="border-t border-slate-100">
                <td className="py-1">{r.account_username}</td><td>{r.teams}</td><td>{r.validated}</td><td>{r.last_activity}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
