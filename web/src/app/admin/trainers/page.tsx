import { Suspense } from "react";
import { withDb } from "@/lib/db";
import { actorFor, requireAdmin } from "@/lib/session";
import { changeRole, deleteTrainer } from "@/app/actions/admin";
import { ActionForm } from "@/components/ActionForm";
import { AdminNav } from "@/components/AdminNav";
import { Card, Loading, PageTitle } from "@/components/ui";

export default function TrainersPage() {
  return (
    <>
      <PageTitle>Admin</PageTitle>
      <AdminNav current="/admin/trainers" />
      <Suspense fallback={<Loading />}>
        <Trainers />
      </Suspense>
    </>
  );
}

async function Trainers() {
  const admin = await requireAdmin();
  // Admins may read e-mail addresses (column privilege); competitors can't.
  const trainers = await withDb(actorFor(admin), (db) =>
    db.all<{ id: number; account_username: string; email_address: string; system_access_role: string; joined: string; teams: number }>(
      `SELECT tr.trainer_identification_number AS id, tr.account_username, tr.email_address, tr.system_access_role,
              to_char(tr.account_creation_timestamp, 'YYYY-MM-DD') AS joined,
              (SELECT count(*) FROM competitive_team t WHERE t.owned_by_trainer_id = tr.trainer_identification_number) AS teams
       FROM trainer tr ORDER BY tr.account_creation_timestamp`,
    ),
  );

  return (
    <Card title={`Trainers (${trainers.length})`}>
      <table className="w-full text-sm">
        <thead className="text-left text-slate-500">
          <tr><th className="py-1">Username</th><th>E-mail</th><th>Joined</th><th>Teams</th><th>Role</th><th></th></tr>
        </thead>
        <tbody>
          {trainers.map((t) => (
            <tr key={t.id} className="border-t border-slate-100 align-top">
              <td className="py-2 font-medium">{t.account_username}{t.id === admin.trainerId && " (you)"}</td>
              <td>{t.email_address}</td>
              <td>{t.joined}</td>
              <td>{t.teams}</td>
              <td>
                {t.id === admin.trainerId ? t.system_access_role : (
                  <ActionForm action={changeRole.bind(null, t.id)} submitLabel="Set" variant="secondary" inline>
                    <select name="role" defaultValue={t.system_access_role} className="rounded border border-slate-300 px-2 py-1 text-sm">
                      <option value="competitor">competitor</option>
                      <option value="admin">admin</option>
                    </select>
                  </ActionForm>
                )}
              </td>
              <td>
                {t.id !== admin.trainerId && (
                  <ActionForm
                    action={deleteTrainer.bind(null, t.id)}
                    submitLabel="Delete"
                    variant="danger"
                    inline
                    confirmMessage={`Delete ${t.account_username} and all their teams?`}
                  />
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
