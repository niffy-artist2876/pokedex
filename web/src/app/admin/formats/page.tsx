import Link from "next/link";
import { Suspense } from "react";
import { withDb } from "@/lib/db";
import { actorFor, requireAdmin } from "@/lib/session";
import { createFormat } from "@/app/actions/admin";
import { ActionForm } from "@/components/ActionForm";
import { AdminNav } from "@/components/AdminNav";
import { FormatFields } from "@/components/FormatFields";
import { Card, Loading, PageTitle } from "@/components/ui";

export default function FormatsPage() {
  return (
    <>
      <PageTitle>Admin</PageTitle>
      <AdminNav current="/admin/formats" />
      <Suspense fallback={<Loading />}>
        <Formats />
      </Suspense>
    </>
  );
}

async function Formats() {
  const admin = await requireAdmin();
  const formats = await withDb(actorFor(admin), (db) =>
    db.all<{ id: number; format_name: string; level_cap: number; minimum_team_size: number; maximum_legendary_members: number | null; is_active: boolean; manager: string | null; bans: number; teams: number }>(
      `SELECT f.format_identification_number AS id, f.format_name, f.level_cap, f.minimum_team_size,
              f.maximum_legendary_members, f.is_active, m.account_username AS manager,
              (SELECT count(*) FROM format_banned_species b WHERE b.format_identification_number = f.format_identification_number) AS bans,
              (SELECT count(*) FROM competitive_team t WHERE t.battle_format_id = f.format_identification_number) AS teams
       FROM battle_format f LEFT JOIN trainer m ON m.trainer_identification_number = f.managed_by_trainer_id
       ORDER BY f.is_active DESC, f.format_name`,
    ),
  );

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
      <Card title="Formats">
        <table className="w-full text-sm">
          <thead className="text-left text-slate-500">
            <tr><th className="py-1">Name</th><th>Cap</th><th>Min</th><th>Legends</th><th>Bans</th><th>Teams</th><th>Manager</th><th></th></tr>
          </thead>
          <tbody>
            {formats.map((f) => (
              <tr key={f.id} className="border-t border-slate-100">
                <td className="py-1.5">
                  <Link href={`/admin/formats/${f.id}`} className="font-medium text-red-700 hover:underline">{f.format_name}</Link>
                </td>
                <td>{f.level_cap}</td><td>{f.minimum_team_size}</td><td>{f.maximum_legendary_members ?? "any"}</td>
                <td>{f.bans}</td><td>{f.teams}</td><td>{f.manager}</td>
                <td>{f.is_active ? <span className="text-emerald-700">active</span> : <span className="text-slate-400">inactive</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <Card title="New format">
        <ActionForm action={createFormat} submitLabel="Create format">
          <FormatFields />
        </ActionForm>
      </Card>
    </div>
  );
}
