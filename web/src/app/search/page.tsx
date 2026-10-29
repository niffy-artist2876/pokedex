import Link from "next/link";
import { Suspense } from "react";
import { withDb } from "@/lib/db";
import { currentActor } from "@/lib/session";
import { embed } from "@/lib/embeddings";
import { param, type SearchParams } from "@/lib/params";
import { Empty, Loading, PageTitle, TypeBadge, inputClass } from "@/components/ui";

type Result = {
  id: number;
  name: string;
  type_name?: string;
  damage_category?: string;
  base_power?: number | null;
  description: string | null;
  score: number;
};

const EXAMPLES = {
  semantic: ["heal myself", "raise my speed", "hit hard but hurt myself too", "protect from status conditions", "stronger in the rain"],
  keyword: ["restores HP", "burn", "critical hit", "switch out"],
};

export default function SearchPage({ searchParams }: PageProps<"/search">) {
  return (
    <>
      <PageTitle subtitle="Keyword search uses PostgreSQL full-text search; semantic search compares meaning with pgvector embeddings.">
        Moves &amp; Abilities
      </PageTitle>
      <Suspense fallback={<Loading label="Searching…" />}>
        <SearchResults searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function SearchResults({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const q = param(sp.q);
  const kind = param(sp.kind) === "abilities" ? "abilities" : "moves";
  const mode = param(sp.mode) === "semantic" ? "semantic" : "keyword";
  const type = param(sp.type);

  const vector = q && mode === "semantic" ? await embed(q) : null;

  const { types, results } = await withDb(await currentActor(), async (db) => {
    const types = await db.all<{ type_name: string }>("SELECT type_name FROM elemental_type ORDER BY 1");
    let results: Result[] = [];
    if (q && kind === "moves" && mode === "keyword") {
      results = await db.all<Result>(
        `SELECT m.move_id AS id, m.move_name AS name, m.type_name, m.damage_category, m.base_power,
                ts_headline('english', coalesce(m.move_effect_description, ''), query,
                            'StartSel=[[, StopSel=]], HighlightAll=true') AS description,
                round(ts_rank(c.search_document, query)::numeric, 3) AS score
         FROM combat_move c
         JOIN v_move_catalog m ON m.move_id = c.move_identification_number,
              websearch_to_tsquery('english', $1) AS query
         WHERE c.search_document @@ query AND ($2 = '' OR m.type_name = $2)
         ORDER BY score DESC, m.move_name LIMIT 30`,
        [q, type],
      );
    } else if (q && kind === "moves") {
      results = await db.all<Result>(
        `SELECT m.move_id AS id, m.move_name AS name, m.type_name, m.damage_category, m.base_power,
                m.move_effect_description AS description, s.similarity AS score
         FROM fn_search_moves_semantic($1::vector, 60) s
         JOIN v_move_catalog m ON m.move_id = s.move_id
         WHERE ($2 = '' OR m.type_name = $2)
         ORDER BY s.similarity DESC LIMIT 20`,
        [vector, type],
      );
    } else if (q && mode === "keyword") {
      results = await db.all<Result>(
        `SELECT a.ability_identification_number AS id, a.ability_name AS name,
                ts_headline('english', coalesce(a.ability_effect_description, ''), query,
                            'StartSel=[[, StopSel=]], HighlightAll=true') AS description,
                round(ts_rank(a.search_document, query)::numeric, 3) AS score
         FROM special_ability a, websearch_to_tsquery('english', $1) AS query
         WHERE a.search_document @@ query
         ORDER BY score DESC, a.ability_name LIMIT 30`,
        [q],
      );
    } else if (q) {
      results = await db.all<Result>(
        `SELECT a.ability_identification_number AS id, a.ability_name AS name,
                a.ability_effect_description AS description, s.similarity AS score
         FROM fn_search_abilities_semantic($1::vector, 20) s
         JOIN special_ability a ON a.ability_identification_number = s.ability_id
         ORDER BY s.similarity DESC`,
        [vector],
      );
    }
    return { types, results };
  });

  const tab = (label: string, params: Record<string, string>, active: boolean) => (
    <Link
      href={`/search?${new URLSearchParams({ q, kind, mode, type, ...params })}`}
      className={`rounded-md px-3 py-1.5 text-sm ${active ? "bg-slate-900 text-white" : "bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50"}`}
    >
      {label}
    </Link>
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-2">
        {tab("Moves", { kind: "moves" }, kind === "moves")}
        {tab("Abilities", { kind: "abilities", type: "" }, kind === "abilities")}
        <span className="mx-2 border-l border-slate-300" />
        {tab("Keyword", { mode: "keyword" }, mode === "keyword")}
        {tab("Semantic (meaning)", { mode: "semantic" }, mode === "semantic")}
      </div>

      <form className="flex flex-wrap gap-2 rounded-lg border border-slate-200 bg-white p-4">
        <input type="hidden" name="kind" value={kind} />
        <input type="hidden" name="mode" value={mode} />
        <input
          name="q"
          defaultValue={q}
          placeholder={mode === "semantic" ? "Describe what it should do…" : "Words in the name or description…"}
          className={`${inputClass} min-w-64 flex-1`}
        />
        {kind === "moves" && (
          <select name="type" defaultValue={type} className={`${inputClass} w-40`}>
            <option value="">Any type</option>
            {types.map((t) => <option key={t.type_name}>{t.type_name}</option>)}
          </select>
        )}
        <button className="rounded-md bg-red-600 px-4 text-sm font-medium text-white hover:bg-red-700">Search</button>
      </form>

      {!q ? (
        <div className="text-sm text-slate-600">
          Try:{" "}
          {EXAMPLES[mode].map((ex) => (
            <Link key={ex} href={`/search?${new URLSearchParams({ q: ex, kind, mode })}`} className="mr-3 text-red-700 hover:underline">
              &ldquo;{ex}&rdquo;
            </Link>
          ))}
        </div>
      ) : results.length === 0 ? (
        <Empty>No {kind} found for &ldquo;{q}&rdquo;.</Empty>
      ) : (
        <ul className="space-y-2">
          {results.map((r) => (
            <li key={r.id} className="rounded-lg border border-slate-200 bg-white p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Link href={`/${kind}/${r.id}`} className="font-medium text-red-700 hover:underline">{r.name}</Link>
                {r.type_name && <TypeBadge type={r.type_name} />}
                {r.damage_category && <span className="text-xs capitalize text-slate-500">{r.damage_category}</span>}
                {r.base_power ? <span className="text-xs text-slate-500">Power {r.base_power}</span> : null}
                <span className="ml-auto text-xs text-slate-500">
                  {mode === "semantic" ? `similarity ${r.score.toFixed(3)}` : `rank ${r.score}`}
                </span>
              </div>
              <p className="mt-1 text-sm text-slate-700"><Highlighted text={r.description ?? ""} /></p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** ts_headline marks matches with [[ ]]; render them as <mark> without injecting HTML. */
function Highlighted({ text }: { text: string }) {
  const parts = text.split(/(\[\[.*?\]\])/g);
  return (
    <>
      {parts.map((part, i) =>
        part.startsWith("[[") && part.endsWith("]]") ? <mark key={i}>{part.slice(2, -2)}</mark> : <span key={i}>{part}</span>,
      )}
    </>
  );
}
