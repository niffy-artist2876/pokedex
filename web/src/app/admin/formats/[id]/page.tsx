import Link from "next/link";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { withDb } from "@/lib/db";
import { actorFor, requireAdmin } from "@/lib/session";
import { addBan, deleteFormat, removeBan, updateFormat } from "@/app/actions/admin";
import { ActionForm } from "@/components/ActionForm";
import { AdminNav } from "@/components/AdminNav";
import { FormatFields, type FormatValues } from "@/components/FormatFields";
import { Card, Loading, PageTitle, Sprite, inputClass } from "@/components/ui";

export default function FormatPage({ params }: PageProps<"/admin/formats/[id]">) {
  return (
    <>
      <PageTitle>Admin</PageTitle>
      <AdminNav current="/admin/formats" />
      <Suspense fallback={<Loading />}>
        <FormatEditor params={params} />
      </Suspense>
    </>
  );
}

async function FormatEditor({ params }: { params: Promise<{ id: string }> }) {
  const formatId = Number((await params).id);
  if (!Number.isInteger(formatId)) notFound();
  const admin = await requireAdmin();

  const data = await withDb(actorFor(admin), async (db) => {
    const format = await db.one<FormatValues>("SELECT * FROM battle_format WHERE format_identification_number = $1", [formatId]);
    if (!format) return null;
    return {
      format,
      bans: await db.all<{ species_id: number; species_name: string }>(
        `SELECT s.species_national_pokedex_number AS species_id, s.species_name
         FROM format_banned_species b JOIN pokemon_species s USING (species_national_pokedex_number)
         WHERE b.format_identification_number = $1 ORDER BY s.species_name`,
        [formatId],
      ),
      allowed: await db.all<{ species_name: string }>(
        `SELECT species_name FROM pokemon_species s
         WHERE NOT EXISTS (SELECT 1 FROM format_banned_species b
                           WHERE b.format_identification_number = $1
                             AND b.species_national_pokedex_number = s.species_national_pokedex_number)
         ORDER BY species_name`,
        [formatId],
      ),
    };
  });
  if (!data) notFound();
  const { format, bans, allowed } = data;

  return (
    <div className="space-y-6">
      <Link href="/admin/formats" className="text-sm text-red-700 hover:underline">← All formats</Link>
      <div className="grid gap-6 lg:grid-cols-[22rem_1fr]">
        <div className="space-y-4">
          <Card title={format.format_name}>
            <ActionForm action={updateFormat.bind(null, formatId)} submitLabel="Save format">
              <FormatFields format={format} />
            </ActionForm>
          </Card>
          <ActionForm
            action={deleteFormat.bind(null, formatId)}
            submitLabel="Delete format"
            variant="danger"
            confirmMessage={`Delete ${format.format_name}? This only works if no team uses it.`}
          />
        </div>
        <Card title={`Banned species (${bans.length})`}>
          <ActionForm action={addBan.bind(null, formatId)} submitLabel="Ban" inline>
            <input name="species" list="allowed-species" required placeholder="Species name…" className={`${inputClass} w-56`} />
            <datalist id="allowed-species">
              {allowed.map((s) => <option key={s.species_name} value={s.species_name} />)}
            </datalist>
          </ActionForm>
          <p className="mt-2 text-xs text-slate-500">A new ban moves validated teams using that species back to draft (trigger).</p>
          <ul className="mt-4 grid max-h-[32rem] grid-cols-1 gap-1 overflow-auto sm:grid-cols-2 xl:grid-cols-3">
            {bans.map((b) => (
              <li key={b.species_id} className="flex items-center gap-1 rounded border border-slate-100 pr-2 text-sm">
                <Sprite id={b.species_id} name={b.species_name} size={32} />
                <span className="flex-1 truncate">{b.species_name}</span>
                <ActionForm action={removeBan.bind(null, formatId, b.species_id)} submitLabel="Unban" variant="secondary" inline />
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}
