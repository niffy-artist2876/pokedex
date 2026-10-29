import Link from "next/link";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { withDb } from "@/lib/db";
import { actorFor, requireUser } from "@/lib/session";
import { cloneTeam, deleteMember, deleteTeam, updateTeam, validateTeam } from "@/app/actions/teams";
import { ActionForm } from "@/components/ActionForm";
import type { TeamOverview } from "@/components/TeamCard";
import { Card, Empty, Field, Loading, STAT_LABELS, Sprite, StatusBadge, TypeBadge, inputClass, multiplierLabel } from "@/components/ui";

type Member = {
  member_id: number; team_slot_number: number; species_id: number; species_name: string; ability_name: string;
  item_name: string | null; nature_name: string; tera_type: string | null; experience_level: number;
  total_effort_values: number; moves: string | null; primary_type: string; secondary_type: string | null;
};
type FinalStat = { member_id: number; stat_name: string; final_value: number; nature_effect: string };
type Weakness = { attacking_type: string; weak_members: number; resistant_members: number; immune_members: number; members_weak: string | null };

export default function TeamPage({ params }: PageProps<"/teams/[id]">) {
  return (
    <Suspense fallback={<Loading />}>
      <TeamDetail params={params} />
    </Suspense>
  );
}

async function TeamDetail({ params }: { params: Promise<{ id: string }> }) {
  const teamId = Number((await params).id);
  if (!Number.isInteger(teamId)) notFound();
  const user = await requireUser();

  const data = await withDb(actorFor(user), async (db) => {
    // Row-level security decides visibility: own teams, other trainers' validated teams, or all for admins.
    const team = await db.one<TeamOverview>("SELECT * FROM v_team_overview WHERE team_id = $1", [teamId]);
    if (!team) return null;
    return {
      team,
      format: (await db.one<{ level_cap: number; minimum_team_size: number; maximum_legendary_members: number | null; ruleset_description: string | null; is_active: boolean }>(
        "SELECT * FROM battle_format WHERE format_identification_number = $1",
        [team.format_id],
      ))!,
      formats: await db.all<{ format_identification_number: number; format_name: string }>(
        "SELECT format_identification_number, format_name FROM battle_format WHERE is_active OR format_identification_number = $1 ORDER BY format_name",
        [team.format_id],
      ),
      members: await db.all<Member>(
        `SELECT d.*, m.base_species_id AS species_id, p.primary_type, p.secondary_type
         FROM v_team_member_detail d
         JOIN individual_team_member m ON m.member_identification_number = d.member_id
         JOIN v_species_profile p ON p.species_id = m.base_species_id
         WHERE d.team_id = $1 ORDER BY d.team_slot_number`,
        [teamId],
      ),
      stats: await db.all<FinalStat>(
        `SELECT m.member_identification_number AS member_id, f.stat_name, f.final_value, f.nature_effect
         FROM individual_team_member m CROSS JOIN LATERAL fn_member_final_stats(m.member_identification_number) f
         WHERE m.belongs_to_team_id = $1`,
        [teamId],
      ),
      weaknesses: await db.all<Weakness>("SELECT * FROM fn_team_weakness_report($1)", [teamId]),
      // Offensive coverage: best multiplier the team's damaging moves reach against each type.
      coverage: await db.all<{ defending_type: string; best: number }>(
        `WITH team_move_types AS (
             SELECT DISTINCT mv.elemental_type_identification_number AS type_id
             FROM individual_team_member m
             JOIN member_equipped_moves e ON e.member_identification_number = m.member_identification_number
             JOIN combat_move mv ON mv.move_identification_number = e.move_identification_number
             WHERE m.belongs_to_team_id = $1 AND mv.damage_category <> 'status'
         )
         SELECT t.type_name AS defending_type, coalesce(max(tm.damage_multiplier_value), 0) AS best
         FROM elemental_type t
         LEFT JOIN type_matchup_matrix tm
                ON tm.defending_type_identification_number = t.elemental_type_identification_number
               AND tm.attacking_type_identification_number IN (SELECT type_id FROM team_move_types)
         GROUP BY t.type_name
         ORDER BY best, t.type_name`,
        [teamId],
      ),
      similar: await db.all<{ team_id: number; team_name: string; similarity: number; owner_username: string; format_name: string }>(
        `SELECT s.team_id, s.team_name, s.similarity, o.owner_username, o.format_name
         FROM fn_similar_teams($1, 5) s JOIN v_team_overview o ON o.team_id = s.team_id
         ORDER BY s.similarity DESC`,
        [teamId],
      ),
    };
  });
  if (!data) notFound();
  const { team, format, formats, members, stats, weaknesses, coverage, similar } = data;
  const isOwner = team.owner_id === user.trainerId;

  return (
    <div className="space-y-6">
      <Link href={isOwner ? "/teams" : "/community"} className="text-sm text-red-700 hover:underline">
        ← {isOwner ? "My teams" : "Community"}
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold">{team.team_name}</h1>
            <StatusBadge status={team.team_status} />
          </div>
          <p className="text-slate-600">
            {team.format_name} · by {team.owner_username} · {team.member_count}/6 members
          </p>
          <p className="mt-1 text-sm text-slate-500">
            Rules: level cap {format.level_cap}, at least {format.minimum_team_size} members
            {format.maximum_legendary_members !== null && `, at most ${format.maximum_legendary_members} legendary`}
            {format.ruleset_description && ` · ${format.ruleset_description}`}
            {!format.is_active && " · this format is no longer active"}
          </p>
        </div>
        <div className="flex flex-wrap items-start gap-2">
          {isOwner && team.team_status === "draft" && (
            <ActionForm action={validateTeam.bind(null, teamId)} submitLabel="Validate team" />
          )}
          {!isOwner && (
            <ActionForm action={cloneTeam.bind(null, teamId)} submitLabel="Clone to my teams" variant="secondary" inline>
              <input name="name" required defaultValue={`${team.team_name} (copy)`} className={`${inputClass} w-48`} />
            </ActionForm>
          )}
          {(isOwner || user.role === "admin") && (
            <ActionForm
              action={deleteTeam.bind(null, teamId)}
              submitLabel={isOwner ? "Delete team" : "Delete (moderation)"}
              variant="danger"
              confirmMessage={`Delete "${team.team_name}" and all its members?`}
            />
          )}
        </div>
      </div>

      {isOwner && team.team_status === "draft" && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Draft: only you can see this team. Validate it to check it against {team.format_name} and publish it to Community.
          Any later edit puts it back to draft.
        </p>
      )}

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Members</h2>
          {isOwner && members.length < 6 && (
            <Link href={`/teams/${teamId}/members/new`} className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700">
              + Add member
            </Link>
          )}
        </div>
        {members.length === 0 ? (
          <Empty>No members yet.</Empty>
        ) : (
          <ul className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {members.map((m) => (
              <li key={m.member_id} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex items-center gap-3">
                  <Sprite id={m.species_id} name={m.species_name} size={64} />
                  <div>
                    <Link href={`/pokedex/${m.species_id}`} className="font-semibold hover:text-red-700">{m.species_name}</Link>
                    <span className="ml-2 text-sm text-slate-500">Lv. {m.experience_level}</span>
                    <div className="mt-1 flex gap-1">
                      <TypeBadge type={m.primary_type} />
                      <TypeBadge type={m.secondary_type} />
                    </div>
                  </div>
                </div>
                <dl className="mt-3 grid grid-cols-[5rem_1fr] gap-y-0.5 text-sm">
                  <dt className="text-slate-500">Ability</dt><dd>{m.ability_name}</dd>
                  <dt className="text-slate-500">Item</dt><dd>{m.item_name ?? "—"}</dd>
                  <dt className="text-slate-500">Nature</dt><dd>{m.nature_name}</dd>
                  <dt className="text-slate-500">Tera</dt><dd>{m.tera_type ? <TypeBadge type={m.tera_type} /> : "—"}</dd>
                  <dt className="text-slate-500">Moves</dt><dd>{m.moves ?? <span className="text-red-600">none</span>}</dd>
                </dl>
                <div className="mt-3 grid grid-cols-6 gap-1 text-center text-xs">
                  {stats.filter((s) => s.member_id === m.member_id).map((s) => (
                    <div key={s.stat_name} className="rounded bg-slate-50 py-1">
                      <div className="text-slate-500">{STAT_LABELS[s.stat_name].replace("Sp. ", "Sp")}</div>
                      <div className={`font-mono font-semibold ${s.nature_effect === "+" ? "text-emerald-700" : s.nature_effect === "-" ? "text-red-600" : ""}`}>
                        {s.final_value}
                      </div>
                    </div>
                  ))}
                </div>
                {isOwner && (
                  <div className="mt-3 flex items-center gap-2">
                    <Link href={`/teams/${teamId}/members/${m.member_id}`} className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50">
                      Edit
                    </Link>
                    <ActionForm
                      action={deleteMember.bind(null, teamId, m.member_id)}
                      submitLabel="Remove"
                      variant="danger"
                      inline
                      confirmMessage={`Remove ${m.species_name} from the team?`}
                    />
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {members.length > 0 && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="Defensive weaknesses">
            <table className="w-full text-sm">
              <thead className="text-left text-slate-500">
                <tr><th className="py-1">Attacking type</th><th className="text-center">Weak</th><th className="text-center">Resist</th><th className="text-center">Immune</th><th>Weak members</th></tr>
              </thead>
              <tbody>
                {weaknesses.filter((w) => w.weak_members > 0).map((w) => (
                  <tr key={w.attacking_type} className={`border-t border-slate-100 ${w.weak_members >= 3 || (w.weak_members >= 2 && w.resistant_members + w.immune_members === 0) ? "bg-red-50" : ""}`}>
                    <td className="py-1"><TypeBadge type={w.attacking_type} /></td>
                    <td className="text-center font-semibold">{w.weak_members}</td>
                    <td className="text-center">{w.resistant_members}</td>
                    <td className="text-center">{w.immune_members}</td>
                    <td className="text-xs text-slate-600">{w.members_weak}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-xs text-slate-500">Highlighted: a shared weakness the team has no answer to. Types only; abilities and Tera are not modelled.</p>
          </Card>
          <Card title="Offensive coverage">
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
              {coverage.map((c) => (
                <div key={c.defending_type} className={`rounded p-1 text-center ${c.best >= 2 ? "bg-emerald-50" : c.best === 1 ? "bg-slate-50" : "bg-red-50"}`}>
                  <TypeBadge type={c.defending_type} />
                  <div className="text-xs font-semibold">{multiplierLabel(c.best)}</div>
                </div>
              ))}
            </div>
            <p className="mt-2 text-xs text-slate-500">Best damage the team&apos;s attacking moves deal to each type.</p>
          </Card>
        </div>
      )}

      {similar.length > 0 && (
        <Card title="Similar teams (pgvector)">
          <ul className="space-y-1 text-sm">
            {similar.map((s) => (
              <li key={s.team_id} className="flex items-center justify-between gap-2">
                <Link href={`/teams/${s.team_id}`} className="text-red-700 hover:underline">{s.team_name}</Link>
                <span className="text-slate-500">{s.owner_username} · {s.format_name}</span>
                <span className="font-mono">{s.similarity.toFixed(3)}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-slate-500">Cosine similarity of team profile vectors (types, defensive matchups, average stats).</p>
        </Card>
      )}

      {isOwner && (
        <Card title="Team settings">
          <ActionForm action={updateTeam.bind(null, teamId)} submitLabel="Save" variant="secondary">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Name">
                <input name="name" required maxLength={80} defaultValue={team.team_name} className={inputClass} />
              </Field>
              <Field label="Format" hint="Changing format puts the team back to draft.">
                <select name="format" defaultValue={team.format_id} className={inputClass}>
                  {formats.map((f) => (
                    <option key={f.format_identification_number} value={f.format_identification_number}>{f.format_name}</option>
                  ))}
                </select>
              </Field>
            </div>
          </ActionForm>
        </Card>
      )}
    </div>
  );
}
