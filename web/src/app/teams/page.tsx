import { Suspense } from "react";
import { withDb } from "@/lib/db";
import { actorFor, requireUser } from "@/lib/session";
import { createTeam } from "@/app/actions/teams";
import { ActionForm } from "@/components/ActionForm";
import { Card, Empty, Field, Loading, PageTitle, inputClass } from "@/components/ui";
import { TeamCard, type TeamOverview } from "@/components/TeamCard";

export default function TeamsPage() {
  return (
    <>
      <PageTitle subtitle="Drafts are private; validated teams are visible to other trainers in Community.">My teams</PageTitle>
      <Suspense fallback={<Loading />}>
        <MyTeams />
      </Suspense>
    </>
  );
}

async function MyTeams() {
  const user = await requireUser();
  const { teams, formats } = await withDb(actorFor(user), async (db) => ({
    teams: await db.all<TeamOverview>(
      "SELECT * FROM v_team_overview WHERE owner_id = $1 ORDER BY last_modified_timestamp DESC",
      [user.trainerId],
    ),
    formats: await db.all<{ format_identification_number: number; format_name: string; level_cap: number }>(
      "SELECT format_identification_number, format_name, level_cap FROM battle_format WHERE is_active ORDER BY format_name",
    ),
  }));

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
      <div>
        {teams.length === 0 ? (
          <Empty>No teams yet. Create one, or clone a validated team from Community.</Empty>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {teams.map((t) => <TeamCard key={t.team_id} team={t} />)}
          </ul>
        )}
      </div>
      <Card title="New team">
        <ActionForm action={createTeam} submitLabel="Create team">
          <Field label="Name">
            <input name="name" required maxLength={80} className={inputClass} />
          </Field>
          <Field label="Format">
            <select name="format" required className={inputClass}>
              {formats.map((f) => (
                <option key={f.format_identification_number} value={f.format_identification_number}>
                  {f.format_name} (Lv. {f.level_cap})
                </option>
              ))}
            </select>
          </Field>
        </ActionForm>
      </Card>
    </div>
  );
}
