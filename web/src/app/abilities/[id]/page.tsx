import Link from "next/link";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { withDb } from "@/lib/db";
import { currentActor } from "@/lib/session";
import { Card, Loading, Sprite } from "@/components/ui";

export default function AbilityPage({ params }: PageProps<"/abilities/[id]">) {
  return (
    <Suspense fallback={<Loading />}>
      <AbilityDetail params={params} />
    </Suspense>
  );
}

async function AbilityDetail({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isInteger(id)) notFound();

  const data = await withDb(await currentActor(), async (db) => {
    const ability = await db.one<{ ability_name: string; ability_effect_description: string | null; has_embedding: boolean }>(
      `SELECT ability_name, ability_effect_description, description_embedding IS NOT NULL AS has_embedding
       FROM special_ability WHERE ability_identification_number = $1`,
      [id],
    );
    if (!ability) return null;
    return {
      ability,
      similar: await db.all<{ ability_id: number; ability_name: string; similarity: number }>(
        `SELECT s.ability_id, s.ability_name, s.similarity
         FROM special_ability a, fn_search_abilities_semantic(a.description_embedding, 7) s
         WHERE a.ability_identification_number = $1 AND a.description_embedding IS NOT NULL AND s.ability_id <> $1`,
        [id],
      ),
      holders: await db.all<{ species_id: number; species_name: string; is_hidden_ability: boolean }>(
        `SELECT s.species_national_pokedex_number AS species_id, s.species_name, spa.is_hidden_ability
         FROM species_possible_abilities spa JOIN pokemon_species s USING (species_national_pokedex_number)
         WHERE spa.ability_identification_number = $1 ORDER BY s.species_national_pokedex_number`,
        [id],
      ),
    };
  });
  if (!data) notFound();
  const { ability, similar, holders } = data;

  return (
    <div className="space-y-6">
      <Link href="/search?kind=abilities" className="text-sm text-red-700 hover:underline">← Abilities</Link>
      <div>
        <h1 className="text-3xl font-bold">{ability.ability_name}</h1>
        <p className="mt-3 max-w-3xl">{ability.ability_effect_description}</p>
      </div>
      {similar.length > 0 && (
        <Card title="Similar abilities (by meaning)">
          <div className="flex flex-wrap gap-2">
            {similar.map((s) => (
              <Link key={s.ability_id} href={`/abilities/${s.ability_id}`} className="rounded-md border border-slate-200 px-2 py-1 text-sm hover:border-red-300">
                {s.ability_name} <span className="text-xs text-slate-500">{s.similarity.toFixed(2)}</span>
              </Link>
            ))}
          </div>
        </Card>
      )}
      <Card title={`Pokémon with this ability (${holders.length})`}>
        <div className="flex flex-wrap gap-2">
          {holders.map((s) => (
            <Link key={s.species_id} href={`/pokedex/${s.species_id}`} className="flex items-center gap-1 rounded-md border border-slate-200 pr-2 text-sm hover:border-red-300">
              <Sprite id={s.species_id} name={s.species_name} size={36} />
              {s.species_name}
              {s.is_hidden_ability && <span className="text-xs text-slate-500">(hidden)</span>}
            </Link>
          ))}
        </div>
      </Card>
    </div>
  );
}
