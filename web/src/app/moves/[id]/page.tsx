import Link from "next/link";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { withDb } from "@/lib/db";
import { currentActor } from "@/lib/session";
import { Card, Loading, Sprite, TypeBadge } from "@/components/ui";

export default function MovePage({ params }: PageProps<"/moves/[id]">) {
  return (
    <Suspense fallback={<Loading />}>
      <MoveDetail params={params} />
    </Suspense>
  );
}

async function MoveDetail({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isInteger(id)) notFound();

  const data = await withDb(await currentActor(), async (db) => {
    const move = await db.one<{
      move_id: number; move_name: string; type_name: string; damage_category: string; base_power: number | null;
      accuracy_percentage: number | null; base_power_points: number; move_effect_description: string | null;
    }>("SELECT * FROM v_move_catalog WHERE move_id = $1", [id]);
    if (!move) return null;
    return {
      move,
      // Moves whose meaning is closest to this one (pgvector cosine distance)
      similar: await db.all<{ move_id: number; move_name: string; similarity: number }>(
        `SELECT s.move_id, s.move_name, s.similarity
         FROM combat_move c, fn_search_moves_semantic(c.description_embedding, 7) s
         WHERE c.move_identification_number = $1 AND c.description_embedding IS NOT NULL AND s.move_id <> $1`,
        [id],
      ),
      learners: await db.all<{ species_id: number; species_name: string }>(
        `SELECT s.species_national_pokedex_number AS species_id, s.species_name
         FROM species_learnable_moves l JOIN pokemon_species s USING (species_national_pokedex_number)
         WHERE l.move_identification_number = $1 ORDER BY s.species_national_pokedex_number`,
        [id],
      ),
    };
  });
  if (!data) notFound();
  const { move: m, similar, learners } = data;

  return (
    <div className="space-y-6">
      <Link href="/search?kind=moves" className="text-sm text-red-700 hover:underline">← Moves</Link>
      <div>
        <h1 className="text-3xl font-bold">{m.move_name}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-slate-600">
          <TypeBadge type={m.type_name} />
          <span className="capitalize">{m.damage_category}</span>
          <span>Power {m.base_power ?? "—"}</span>
          <span>Accuracy {m.accuracy_percentage ?? "never misses"}</span>
          <span>PP {m.base_power_points}</span>
        </div>
        <p className="mt-3 max-w-3xl">{m.move_effect_description}</p>
      </div>
      {similar.length > 0 && (
        <Card title="Similar moves (by meaning)">
          <div className="flex flex-wrap gap-2">
            {similar.map((s) => (
              <Link key={s.move_id} href={`/moves/${s.move_id}`} className="rounded-md border border-slate-200 px-2 py-1 text-sm hover:border-red-300">
                {s.move_name} <span className="text-xs text-slate-500">{s.similarity.toFixed(2)}</span>
              </Link>
            ))}
          </div>
        </Card>
      )}
      <Card title={`Pokémon that can learn it (${learners.length})`}>
        <div className="flex flex-wrap gap-2">
          {learners.map((s) => (
            <Link key={s.species_id} href={`/pokedex/${s.species_id}`} className="flex items-center gap-1 rounded-md border border-slate-200 pr-2 text-sm hover:border-red-300">
              <Sprite id={s.species_id} name={s.species_name} size={36} />
              {s.species_name}
            </Link>
          ))}
        </div>
      </Card>
    </div>
  );
}
