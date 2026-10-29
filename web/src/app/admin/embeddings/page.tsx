import Link from "next/link";
import { Suspense } from "react";
import { withDb } from "@/lib/db";
import { actorFor, requireAdmin } from "@/lib/session";
import { param, type SearchParams } from "@/lib/params";
import { clearEmbedding, embedMissing, reembed } from "@/app/actions/admin";
import { ActionForm } from "@/components/ActionForm";
import { AdminNav } from "@/components/AdminNav";
import { Card, Loading, PageTitle, inputClass } from "@/components/ui";

export default function EmbeddingsPage({ searchParams }: PageProps<"/admin/embeddings">) {
  return (
    <>
      <PageTitle subtitle="Every move and ability description has a 384-dimension MiniLM embedding used by semantic search. Edit text, re-embed or remove vectors here.">
        Admin
      </PageTitle>
      <AdminNav current="/admin/embeddings" />
      <Suspense fallback={<Loading />}>
        <Embeddings searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function Embeddings({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const kind = param(sp.kind) === "ability" ? "ability" : "move";
  const q = param(sp.q);
  const missingOnly = param(sp.missing) === "1";
  const admin = await requireAdmin();

  const table = kind === "move"
    ? { t: "combat_move", id: "move_identification_number", name: "move_name", desc: "move_effect_description" }
    : { t: "special_ability", id: "ability_identification_number", name: "ability_name", desc: "ability_effect_description" };

  const { coverage, rows } = await withDb(actorFor(admin), async (db) => ({
    coverage: await db.all<{ kind: string; total: number; embedded: number; missing_with_text: number }>(
      `SELECT 'move' AS kind, count(*) AS total, count(description_embedding) AS embedded,
              count(*) FILTER (WHERE description_embedding IS NULL AND move_effect_description IS NOT NULL) AS missing_with_text
       FROM combat_move
       UNION ALL
       SELECT 'ability', count(*), count(description_embedding),
              count(*) FILTER (WHERE description_embedding IS NULL AND ability_effect_description IS NOT NULL)
       FROM special_ability`,
    ),
    rows: await db.all<{ id: number; name: string; description: string | null; has_embedding: boolean }>(
      `SELECT ${table.id} AS id, ${table.name} AS name, ${table.desc} AS description,
              description_embedding IS NOT NULL AS has_embedding
       FROM ${table.t}
       WHERE ($1 = '' OR ${table.name} ILIKE '%' || $1 || '%' OR ${table.name} % $1)
         AND (NOT $2 OR description_embedding IS NULL)
       ORDER BY description_embedding IS NULL DESC, ${table.name}
       LIMIT 40`,
      [q, missingOnly],
    ),
  }));

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2">
        {coverage.map((c) => (
          <div key={c.kind} className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white p-4">
            <div>
              <div className="text-xl font-bold tabular-nums">{c.embedded}/{c.total}</div>
              <div className="text-sm text-slate-600">{c.kind === "move" ? "Moves" : "Abilities"} embedded</div>
            </div>
            {c.missing_with_text > 0 && (
              <ActionForm action={embedMissing.bind(null, c.kind as "move" | "ability")} submitLabel={`Embed ${c.missing_with_text} missing`} />
            )}
          </div>
        ))}
      </div>

      <form className="flex flex-wrap items-center gap-2">
        <select name="kind" defaultValue={kind} className={`${inputClass} w-36`}>
          <option value="move">Moves</option>
          <option value="ability">Abilities</option>
        </select>
        <input name="q" defaultValue={q} placeholder="Name…" className={`${inputClass} w-56`} />
        <label className="flex items-center gap-1 text-sm"><input type="checkbox" name="missing" value="1" defaultChecked={missingOnly} /> missing only</label>
        <button className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700">Find</button>
      </form>

      <Card>
        <table className="w-full text-sm">
          <thead className="text-left text-slate-500">
            <tr><th className="py-1">Name</th><th>Description</th><th>Vector</th><th className="w-64"></th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-slate-100 align-top">
                <td className="py-2 font-medium">{r.name}</td>
                <td className="pr-3 text-slate-600">{r.description ?? <span className="text-slate-400">none</span>}</td>
                <td>{r.has_embedding ? <span className="text-emerald-700">yes</span> : <span className="text-red-600">missing</span>}</td>
                <td>
                  <div className="flex flex-wrap gap-1">
                    <Link href={`/admin/embeddings/${kind}/${r.id}`} className="rounded-md border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50">Edit</Link>
                    <ActionForm action={reembed.bind(null, kind, r.id)} submitLabel="Re-embed" variant="secondary" inline />
                    {r.has_embedding && (
                      <ActionForm action={clearEmbedding.bind(null, kind, r.id)} submitLabel="Remove" variant="danger" inline />
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
