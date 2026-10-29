import Link from "next/link";
import { Suspense } from "react";
import { withDb } from "@/lib/db";
import { currentActor } from "@/lib/session";
import { param, positiveInt, type SearchParams } from "@/lib/params";
import { Empty, Loading, PageTitle, Sprite, TypeBadge, inputClass } from "@/components/ui";

const PAGE_SIZE = 48;
const SORTS: Record<string, { label: string; sql: string }> = {
  number: { label: "Pokédex number", sql: "species_id" },
  name: { label: "Name", sql: "species_name" },
  total: { label: "Base stat total", sql: "base_stat_total DESC, species_id" },
  speed: { label: "Speed", sql: "base_speed DESC, species_id" },
  attack: { label: "Attack", sql: "base_attack DESC, species_id" },
  special_attack: { label: "Sp. Atk", sql: "base_special_attack DESC, species_id" },
};

type Species = {
  species_id: number;
  species_name: string;
  primary_type: string;
  secondary_type: string | null;
  base_stat_total: number;
  is_legendary: boolean;
  is_mythical: boolean;
  total: number;
};

export default function PokedexPage({ searchParams }: PageProps<"/pokedex">) {
  return (
    <>
      <PageTitle subtitle="Every Pokémon available in Scarlet & Violet. Search tolerates typos (trigram matching).">
        Pokédex
      </PageTitle>
      <Suspense fallback={<Loading />}>
        <PokedexResults searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function PokedexResults({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const q = param(sp.q);
  const type = param(sp.type);
  const generation = positiveInt(sp.gen);
  const legendary = param(sp.legendary);
  const sort = SORTS[param(sp.sort)] ? param(sp.sort) : "number";
  const page = positiveInt(sp.page) ?? 1;

  const { types, generations, rows } = await withDb(await currentActor(), async (db) => ({
    types: await db.all<{ type_name: string }>("SELECT type_name FROM elemental_type ORDER BY type_name"),
    generations: await db.all<{ g: number }>(
      "SELECT DISTINCT generation_number AS g FROM pokemon_species ORDER BY 1",
    ),
    // Fuzzy name match: substring OR trigram similarity, best matches first when searching.
    rows: await db.all<Species>(
      `SELECT species_id, species_name, primary_type, secondary_type, base_stat_total, is_legendary, is_mythical,
              count(*) OVER () AS total
       FROM v_species_profile
       WHERE ($1 = '' OR species_name ILIKE '%' || $1 || '%' OR species_name % $1)
         AND ($2 = '' OR $2 IN (primary_type, secondary_type))
         AND ($3::int IS NULL OR generation_number = $3)
         AND ($4 = '' OR ($4 = 'yes') = (is_legendary OR is_mythical))
       ORDER BY CASE WHEN $1 = '' THEN 0 ELSE similarity(species_name, $1) END DESC, ${SORTS[sort].sql}
       LIMIT ${PAGE_SIZE} OFFSET $5`,
      [q, type, generation, legendary, (page - 1) * PAGE_SIZE],
    ),
  }));

  const total = rows[0]?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pageHref = (p: number) => {
    const next = new URLSearchParams({ q, type, gen: generation ? String(generation) : "", legendary, sort, page: String(p) });
    return `/pokedex?${next}`;
  };

  return (
    <div className="space-y-6">
      <form className="grid gap-3 rounded-lg border border-slate-200 bg-white p-4 md:grid-cols-6">
        <input name="q" defaultValue={q} placeholder="Search by name…" className={`${inputClass} md:col-span-2`} />
        <select name="type" defaultValue={type} className={inputClass}>
          <option value="">Any type</option>
          {types.map((t) => <option key={t.type_name}>{t.type_name}</option>)}
        </select>
        <select name="gen" defaultValue={generation ?? ""} className={inputClass}>
          <option value="">Any generation</option>
          {generations.map((g) => <option key={g.g} value={g.g}>Generation {g.g}</option>)}
        </select>
        <select name="legendary" defaultValue={legendary} className={inputClass}>
          <option value="">Legendary or not</option>
          <option value="yes">Legendary / mythical</option>
          <option value="no">Not legendary</option>
        </select>
        <div className="flex gap-2">
          <select name="sort" defaultValue={sort} className={inputClass}>
            {Object.entries(SORTS).map(([k, s]) => <option key={k} value={k}>{s.label}</option>)}
          </select>
          <button className="rounded-md bg-red-600 px-3 text-sm font-medium text-white hover:bg-red-700">Go</button>
        </div>
      </form>

      <p className="text-sm text-slate-600">{total} Pokémon found</p>
      {rows.length === 0 ? (
        <Empty>No Pokémon match those filters.</Empty>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
          {rows.map((s) => (
            <li key={s.species_id}>
              <Link
                href={`/pokedex/${s.species_id}`}
                className="flex h-full flex-col items-center rounded-lg border border-slate-200 bg-white p-3 text-center shadow-sm transition hover:border-red-300 hover:shadow"
              >
                <Sprite id={s.species_id} name={s.species_name} />
                <span className="text-xs text-slate-500">#{String(s.species_id).padStart(4, "0")}</span>
                <span className="font-medium">
                  {s.species_name}
                  {(s.is_legendary || s.is_mythical) && <span title="Legendary / mythical"> ★</span>}
                </span>
                <span className="mt-1 flex gap-1">
                  <TypeBadge type={s.primary_type} />
                  <TypeBadge type={s.secondary_type} />
                </span>
                <span className="mt-1 text-xs text-slate-500">BST {s.base_stat_total}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {pages > 1 && (
        <nav className="flex items-center justify-center gap-3 text-sm">
          {page > 1 && <Link href={pageHref(page - 1)} className="text-red-700 hover:underline">← Previous</Link>}
          <span className="text-slate-600">Page {page} of {pages}</span>
          {page < pages && <Link href={pageHref(page + 1)} className="text-red-700 hover:underline">Next →</Link>}
        </nav>
      )}
    </div>
  );
}
