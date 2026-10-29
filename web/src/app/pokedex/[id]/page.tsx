import Link from "next/link";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { withDb } from "@/lib/db";
import { currentActor } from "@/lib/session";
import { Card, Loading, Sprite, StatBar, TypeBadge, multiplierLabel } from "@/components/ui";

type Profile = {
  species_id: number; species_name: string; primary_type: string; secondary_type: string | null;
  base_hit_points: number; base_attack: number; base_defense: number; base_special_attack: number;
  base_special_defense: number; base_speed: number; base_stat_total: number; generation_number: number;
  is_legendary: boolean; is_mythical: boolean;
};

export default function SpeciesPage({ params }: PageProps<"/pokedex/[id]">) {
  return (
    <Suspense fallback={<Loading />}>
      <SpeciesDetail params={params} />
    </Suspense>
  );
}

async function SpeciesDetail({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isInteger(id)) notFound();

  const data = await withDb(await currentActor(), async (db) => {
    const profile = await db.one<Profile>("SELECT * FROM v_species_profile WHERE species_id = $1", [id]);
    if (!profile) return null;
    return {
      profile,
      abilities: await db.all<{ ability_id: number; ability_name: string; is_hidden_ability: boolean; description: string | null }>(
        `SELECT a.ability_identification_number AS ability_id, a.ability_name, spa.is_hidden_ability,
                a.ability_effect_description AS description
         FROM species_possible_abilities spa
         JOIN special_ability a USING (ability_identification_number)
         WHERE spa.species_national_pokedex_number = $1
         ORDER BY spa.is_hidden_ability, a.ability_name`,
        [id],
      ),
      evolution: await db.all<{ species_id: number; species_name: string; stage: number; evolution_method: string | null; evolution_minimum_level: number | null }>(
        "SELECT * FROM fn_species_evolution_line($1)",
        [id],
      ),
      defense: await db.all<{ attacking_type: string; damage_multiplier: number }>(
        "SELECT attacking_type, damage_multiplier FROM v_species_type_defense WHERE species_id = $1 ORDER BY damage_multiplier DESC, attacking_type",
        [id],
      ),
      moves: await db.all<{ move_id: number; move_name: string; type_name: string; damage_category: string; base_power: number | null; accuracy_percentage: number | null; base_power_points: number }>(
        `SELECT m.* FROM species_learnable_moves l
         JOIN v_move_catalog m ON m.move_id = l.move_identification_number
         WHERE l.species_national_pokedex_number = $1
         ORDER BY m.type_name, m.base_power DESC NULLS LAST, m.move_name`,
        [id],
      ),
      bannedIn: await db.all<{ format_name: string }>(
        `SELECT f.format_name FROM format_banned_species b
         JOIN battle_format f USING (format_identification_number)
         WHERE b.species_national_pokedex_number = $1 AND f.is_active ORDER BY 1`,
        [id],
      ),
    };
  });
  if (!data) notFound();
  const { profile: p, abilities, evolution, defense, moves, bannedIn } = data;

  const groups = [
    { label: "Weak to", filter: (m: number) => m > 1 },
    { label: "Resists", filter: (m: number) => m > 0 && m < 1 },
    { label: "Immune to", filter: (m: number) => m === 0 },
  ];
  const stages = [...new Set(evolution.map((e) => e.stage))];

  return (
    <div className="space-y-6">
      <Link href="/pokedex" className="text-sm text-red-700 hover:underline">← Pokédex</Link>
      <div className="flex flex-wrap items-center gap-6">
        <Sprite id={p.species_id} name={p.species_name} size={160} />
        <div>
          <p className="text-slate-500">#{String(p.species_id).padStart(4, "0")} · Generation {p.generation_number}</p>
          <h1 className="text-3xl font-bold">{p.species_name}</h1>
          <div className="mt-2 flex gap-2">
            <TypeBadge type={p.primary_type} />
            <TypeBadge type={p.secondary_type} />
            {p.is_legendary && <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">Legendary</span>}
            {p.is_mythical && <span className="rounded bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-800">Mythical</span>}
          </div>
          {bannedIn.length > 0 && (
            <p className="mt-2 text-sm text-red-700">Banned in: {bannedIn.map((b) => b.format_name).join(", ")}</p>
          )}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Base stats">
          <div className="space-y-1.5">
            <StatBar label="HP" value={p.base_hit_points} />
            <StatBar label="Attack" value={p.base_attack} />
            <StatBar label="Defense" value={p.base_defense} />
            <StatBar label="Sp. Atk" value={p.base_special_attack} />
            <StatBar label="Sp. Def" value={p.base_special_defense} />
            <StatBar label="Speed" value={p.base_speed} />
            <p className="pt-1 text-right text-sm font-medium">Total {p.base_stat_total}</p>
          </div>
        </Card>
        <Card title="Abilities">
          <ul className="space-y-2">
            {abilities.map((a) => (
              <li key={a.ability_id}>
                <Link href={`/abilities/${a.ability_id}`} className="font-medium text-red-700 hover:underline">{a.ability_name}</Link>
                {a.is_hidden_ability && <span className="ml-2 text-xs text-slate-500">hidden</span>}
                <p className="text-sm text-slate-600">{a.description}</p>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Card title="Type matchups (defending)">
        <div className="space-y-2">
          {groups.map((g) => {
            const list = defense.filter((d) => g.filter(d.damage_multiplier));
            return (
              <div key={g.label} className="flex flex-wrap items-center gap-2">
                <span className="w-20 text-sm text-slate-600">{g.label}</span>
                {list.length === 0 && <span className="text-sm text-slate-400">nothing</span>}
                {list.map((d) => (
                  <span key={d.attacking_type} className="inline-flex items-center gap-1">
                    <TypeBadge type={d.attacking_type} />
                    <span className="text-xs font-semibold">{multiplierLabel(d.damage_multiplier)}</span>
                  </span>
                ))}
              </div>
            );
          })}
        </div>
      </Card>

      {evolution.length > 1 && (
        <Card title="Evolution family (recursive query)">
          <div className="flex flex-wrap items-start gap-6">
            {stages.map((stage) => (
              <div key={stage} className="space-y-2">
                <p className="text-xs uppercase text-slate-500">Stage {stage}</p>
                {evolution.filter((e) => e.stage === stage).map((e) => (
                  <Link
                    key={e.species_id}
                    href={`/pokedex/${e.species_id}`}
                    className={`flex items-center gap-2 rounded-md border p-1 pr-3 ${e.species_id === id ? "border-red-400 bg-red-50" : "border-slate-200 hover:border-red-300"}`}
                  >
                    <Sprite id={e.species_id} name={e.species_name} size={48} />
                    <span>
                      <span className="block text-sm font-medium">{e.species_name}</span>
                      {e.evolution_method && (
                        <span className="block text-xs text-slate-500">
                          {e.evolution_method}
                          {e.evolution_minimum_level ? ` (Lv. ${e.evolution_minimum_level})` : ""}
                        </span>
                      )}
                    </span>
                  </Link>
                ))}
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card title={`Learnable moves (${moves.length})`}>
        <div className="max-h-[28rem] overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-white text-left text-slate-500">
              <tr><th className="py-1">Move</th><th>Type</th><th>Category</th><th className="text-right">Power</th><th className="text-right">Acc.</th><th className="text-right">PP</th></tr>
            </thead>
            <tbody>
              {moves.map((m) => (
                <tr key={m.move_id} className="border-t border-slate-100">
                  <td className="py-1"><Link href={`/moves/${m.move_id}`} className="hover:text-red-700">{m.move_name}</Link></td>
                  <td><TypeBadge type={m.type_name} /></td>
                  <td className="capitalize">{m.damage_category}</td>
                  <td className="text-right tabular-nums">{m.base_power ?? "—"}</td>
                  <td className="text-right tabular-nums">{m.accuracy_percentage ?? "—"}</td>
                  <td className="text-right tabular-nums">{m.base_power_points}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
