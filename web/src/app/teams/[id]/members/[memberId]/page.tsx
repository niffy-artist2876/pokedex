import Link from "next/link";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { withDb } from "@/lib/db";
import { actorFor, requireUser } from "@/lib/session";
import { positiveInt, type SearchParams } from "@/lib/params";
import { saveMember } from "@/app/actions/teams";
import { ActionForm } from "@/components/ActionForm";
import { Card, Field, Loading, STAT_LABELS, Sprite, StatBar, TypeBadge, inputClass } from "@/components/ui";

const STATS = ["hit_points", "attack", "defense", "special_attack", "special_defense", "speed"] as const;
const SHORT: Record<string, string> = { attack: "Atk", defense: "Def", special_attack: "SpA", special_defense: "SpD", speed: "Spe" };

type MemberRow = Record<string, number | null> & {
  base_species_id: number; assigned_ability_id: number; assigned_held_item_id: number | null;
  assigned_nature_id: number; terastallize_type_id: number | null; experience_level: number;
};

export default function MemberEditorPage({ params, searchParams }: PageProps<"/teams/[id]/members/[memberId]">) {
  return (
    <Suspense fallback={<Loading />}>
      <MemberEditor params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function MemberEditor({ params, searchParams }: { params: Promise<{ id: string; memberId: string }>; searchParams: SearchParams }) {
  const { id, memberId: memberParam } = await params;
  const teamId = Number(id);
  const memberId = memberParam === "new" ? null : Number(memberParam);
  if (!Number.isInteger(teamId) || (memberId !== null && !Number.isInteger(memberId))) notFound();
  const requestedSpecies = positiveInt((await searchParams).species);
  const user = await requireUser();

  const data = await withDb(actorFor(user), async (db) => {
    const team = await db.one<{ team_name: string; owner_id: number; level_cap: number; format_name: string }>(
      `SELECT o.team_name, o.owner_id, f.level_cap, f.format_name
       FROM v_team_overview o JOIN battle_format f ON f.format_identification_number = o.format_id
       WHERE o.team_id = $1`,
      [teamId],
    );
    if (!team || team.owner_id !== user.trainerId) return null;

    const member = memberId
      ? await db.one<MemberRow>(
          "SELECT * FROM individual_team_member WHERE member_identification_number = $1 AND belongs_to_team_id = $2",
          [memberId, teamId],
        )
      : null;
    if (memberId && !member) return null;
    const currentMoves = memberId
      ? (await db.all<{ move_identification_number: number }>(
          "SELECT move_identification_number FROM member_equipped_moves WHERE member_identification_number = $1 ORDER BY move_slot_number",
          [memberId],
        )).map((m) => m.move_identification_number)
      : [];

    const speciesId = requestedSpecies ?? member?.base_species_id ?? null;
    const species = speciesId
      ? await db.one<{ species_id: number; species_name: string; primary_type: string; secondary_type: string | null } & Record<string, number>>(
          "SELECT * FROM v_species_profile WHERE species_id = $1",
          [speciesId],
        )
      : null;

    return {
      team, member, currentMoves, species,
      allSpecies: await db.all<{ species_id: number; species_name: string }>(
        "SELECT species_id, species_name FROM v_species_profile ORDER BY species_name",
      ),
      abilities: species
        ? await db.all<{ id: number; name: string; is_hidden_ability: boolean }>(
            `SELECT a.ability_identification_number AS id, a.ability_name AS name, spa.is_hidden_ability
             FROM species_possible_abilities spa JOIN special_ability a USING (ability_identification_number)
             WHERE spa.species_national_pokedex_number = $1 ORDER BY spa.is_hidden_ability, a.ability_name`,
            [species.species_id],
          )
        : [],
      moves: species
        ? await db.all<{ move_id: number; move_name: string; type_name: string; damage_category: string; base_power: number | null }>(
            `SELECT m.move_id, m.move_name, m.type_name, m.damage_category, m.base_power
             FROM species_learnable_moves l JOIN v_move_catalog m ON m.move_id = l.move_identification_number
             WHERE l.species_national_pokedex_number = $1 ORDER BY m.move_name`,
            [species.species_id],
          )
        : [],
      items: await db.all<{ id: number; name: string }>(
        "SELECT item_identification_number AS id, item_name AS name FROM held_item ORDER BY item_name",
      ),
      natures: await db.all<{ id: number; name: string; up: string | null; down: string | null }>(
        `SELECT nature_identification_number AS id, nature_name AS name, increased_stat_type AS up, decreased_stat_type AS down
         FROM statistical_nature ORDER BY nature_name`,
      ),
      types: await db.all<{ id: number; name: string }>(
        "SELECT elemental_type_identification_number AS id, type_name AS name FROM elemental_type ORDER BY type_name",
      ),
    };
  });
  if (!data) notFound();
  const { team, member, currentMoves, species, allSpecies, abilities, moves, items, natures, types } = data;
  const sameSpecies = member && species && member.base_species_id === species.species_id;
  const learnable = new Set(moves.map((m) => m.move_id));
  const keptMoves = currentMoves.filter((m) => learnable.has(m));

  return (
    <div className="space-y-6">
      <Link href={`/teams/${teamId}`} className="text-sm text-red-700 hover:underline">← {team.team_name}</Link>
      <h1 className="text-2xl font-bold">{member ? "Edit member" : "Add member"}</h1>

      <Card title="1. Species">
        <form className="flex flex-wrap items-end gap-3">
          <Field label="Pokémon">
            <select name="species" defaultValue={species?.species_id ?? ""} required className={`${inputClass} min-w-64`}>
              <option value="" disabled>Choose a Pokémon…</option>
              {allSpecies.map((s) => <option key={s.species_id} value={s.species_id}>{s.species_name}</option>)}
            </select>
          </Field>
          <button className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm hover:bg-slate-50">
            {species ? "Change species" : "Use this species"}
          </button>
        </form>
        {species && (
          <div className="mt-4 flex flex-wrap items-center gap-4">
            <Sprite id={species.species_id} name={species.species_name} size={80} />
            <div>
              <p className="font-semibold">{species.species_name}</p>
              <div className="mt-1 flex gap-1"><TypeBadge type={species.primary_type} /><TypeBadge type={species.secondary_type} /></div>
            </div>
            <div className="min-w-64 flex-1 space-y-1">
              <StatBar label="HP" value={species.base_hit_points} />
              <StatBar label="Attack" value={species.base_attack} />
              <StatBar label="Defense" value={species.base_defense} />
              <StatBar label="Sp. Atk" value={species.base_special_attack} />
              <StatBar label="Sp. Def" value={species.base_special_defense} />
              <StatBar label="Speed" value={species.base_speed} />
            </div>
          </div>
        )}
      </Card>

      {species && (
        <Card title="2. Build">
          <ActionForm
            key={species.species_id}
            action={saveMember.bind(null, teamId, memberId)}
            submitLabel={member ? "Save member" : "Add to team"}
          >
            <input type="hidden" name="species" value={species.species_id} />
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <Field label="Ability">
                <select name="ability" defaultValue={sameSpecies ? member.assigned_ability_id : abilities[0]?.id} className={inputClass}>
                  {abilities.map((a) => (
                    <option key={a.id} value={a.id}>{a.name}{a.is_hidden_ability ? " (hidden)" : ""}</option>
                  ))}
                </select>
              </Field>
              <Field label="Held item">
                <select name="item" defaultValue={member?.assigned_held_item_id ?? ""} className={inputClass}>
                  <option value="">None</option>
                  {items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
                </select>
              </Field>
              <Field label="Nature">
                <select name="nature" defaultValue={member?.assigned_nature_id ?? natures.find((n) => n.name === "Hardy")?.id} className={inputClass}>
                  {natures.map((n) => (
                    <option key={n.id} value={n.id}>
                      {n.name}{n.up ? ` (+${SHORT[n.up]} −${SHORT[n.down!]})` : " (neutral)"}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Tera type">
                <select name="tera" defaultValue={member?.terastallize_type_id ?? ""} className={inputClass}>
                  <option value="">None</option>
                  {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </Field>
              <Field label="Level" hint={`${team.format_name} cap: ${team.level_cap}`}>
                <input name="level" type="number" min={1} max={100} required defaultValue={member?.experience_level ?? team.level_cap} className={inputClass} />
              </Field>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <fieldset className="rounded-md border border-slate-200 p-3">
                <legend className="px-1 text-sm font-medium">Effort values (0-252 each, 510 total)</legend>
                <div className="grid grid-cols-3 gap-2">
                  {STATS.map((s) => (
                    <Field key={s} label={STAT_LABELS[s]}>
                      <input name={`ev_${s}`} type="number" min={0} max={252} step={4} defaultValue={member?.[`effort_value_${s}`] ?? 0} className={inputClass} />
                    </Field>
                  ))}
                </div>
              </fieldset>
              <fieldset className="rounded-md border border-slate-200 p-3">
                <legend className="px-1 text-sm font-medium">Individual values (0-31)</legend>
                <div className="grid grid-cols-3 gap-2">
                  {STATS.map((s) => (
                    <Field key={s} label={STAT_LABELS[s]}>
                      <input name={`iv_${s}`} type="number" min={0} max={31} defaultValue={member?.[`individual_value_${s}`] ?? 31} className={inputClass} />
                    </Field>
                  ))}
                </div>
              </fieldset>
            </div>

            <fieldset className="rounded-md border border-slate-200 p-3">
              <legend className="px-1 text-sm font-medium">Moves ({moves.length} learnable)</legend>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {[0, 1, 2, 3].map((i) => (
                  <select key={i} name={`move${i + 1}`} defaultValue={keptMoves[i] ?? ""} className={inputClass}>
                    <option value="">— Move {i + 1} —</option>
                    {moves.map((m) => (
                      <option key={m.move_id} value={m.move_id}>
                        {m.move_name} ({m.type_name}{m.base_power ? `, ${m.base_power}` : ""})
                      </option>
                    ))}
                  </select>
                ))}
              </div>
            </fieldset>
          </ActionForm>
        </Card>
      )}
    </div>
  );
}
