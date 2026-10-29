import Link from "next/link";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { withDb } from "@/lib/db";
import { actorFor, requireAdmin } from "@/lib/session";
import { clearEmbedding, reembed, updateDescription } from "@/app/actions/admin";
import { ActionForm } from "@/components/ActionForm";
import { AdminNav } from "@/components/AdminNav";
import { Card, Field, Loading, PageTitle, inputClass } from "@/components/ui";

export default function EditDescriptionPage({ params }: PageProps<"/admin/embeddings/[kind]/[id]">) {
  return (
    <>
      <PageTitle>Admin</PageTitle>
      <AdminNav current="/admin/embeddings" />
      <Suspense fallback={<Loading />}>
        <EditDescription params={params} />
      </Suspense>
    </>
  );
}

async function EditDescription({ params }: { params: Promise<{ kind: string; id: string }> }) {
  const p = await params;
  const id = Number(p.id);
  if ((p.kind !== "move" && p.kind !== "ability") || !Number.isInteger(id)) notFound();
  const kind = p.kind;
  const admin = await requireAdmin();

  const data = await withDb(actorFor(admin), async (db) => {
    const row = kind === "move"
      ? await db.one<{ name: string; description: string | null; has_embedding: boolean }>(
          `SELECT move_name AS name, move_effect_description AS description, description_embedding IS NOT NULL AS has_embedding
           FROM combat_move WHERE move_identification_number = $1`, [id])
      : await db.one<{ name: string; description: string | null; has_embedding: boolean }>(
          `SELECT ability_name AS name, ability_effect_description AS description, description_embedding IS NOT NULL AS has_embedding
           FROM special_ability WHERE ability_identification_number = $1`, [id]);
    if (!row) return null;
    // Nearest neighbours by its current vector: shows what the embedding "means"
    const neighbours = kind === "move"
      ? await db.all<{ name: string; similarity: number }>(
          `SELECT s.move_name AS name, s.similarity FROM combat_move c, fn_search_moves_semantic(c.description_embedding, 6) s
           WHERE c.move_identification_number = $1 AND c.description_embedding IS NOT NULL AND s.move_id <> $1`, [id])
      : await db.all<{ name: string; similarity: number }>(
          `SELECT s.ability_name AS name, s.similarity FROM special_ability a, fn_search_abilities_semantic(a.description_embedding, 6) s
           WHERE a.ability_identification_number = $1 AND a.description_embedding IS NOT NULL AND s.ability_id <> $1`, [id]);
    return { row, neighbours };
  });
  if (!data) notFound();
  const { row, neighbours } = data;

  return (
    <div className="space-y-6">
      <Link href={`/admin/embeddings?kind=${kind}`} className="text-sm text-red-700 hover:underline">← Descriptions &amp; embeddings</Link>
      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <Card title={`${row.name} (${kind})`}>
          <ActionForm action={updateDescription.bind(null, kind, id)} submitLabel="Save description">
            <Field label="Description">
              <textarea name="description" rows={5} required defaultValue={row.description ?? ""} className={inputClass} />
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="reembed" defaultChecked /> Re-embed with the new text
            </label>
            <p className="text-xs text-slate-500">
              Unticked: the database trigger clears the old vector, since it no longer matches the text.
            </p>
          </ActionForm>
        </Card>
        <Card title="Vector">
          <p className="text-sm">
            Status: {row.has_embedding ? <span className="text-emerald-700">embedded (384 dimensions)</span> : <span className="text-red-600">no embedding</span>}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <ActionForm action={reembed.bind(null, kind, id)} submitLabel="Re-embed" variant="secondary" inline />
            {row.has_embedding && <ActionForm action={clearEmbedding.bind(null, kind, id)} submitLabel="Remove vector" variant="danger" inline />}
          </div>
          {neighbours.length > 0 && (
            <>
              <h3 className="mt-4 text-sm font-medium">Nearest by meaning</h3>
              <ul className="mt-1 space-y-0.5 text-sm">
                {neighbours.map((n) => (
                  <li key={n.name} className="flex justify-between"><span>{n.name}</span><span className="font-mono text-slate-500">{n.similarity.toFixed(3)}</span></li>
                ))}
              </ul>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
