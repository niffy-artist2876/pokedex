import Link from "next/link";
import { Suspense } from "react";
import { withDb } from "@/lib/db";
import { currentActor, getCurrentUser } from "@/lib/session";
import { Card, Loading } from "@/components/ui";

export default function Home() {
  return (
    <div className="space-y-8">
      <section className="rounded-xl bg-gradient-to-br from-red-600 to-red-500 p-8 text-white shadow">
        <h1 className="text-3xl font-bold">Pokédex Team Lab</h1>
        <p className="mt-2 max-w-2xl text-red-50">
          Browse every Pokémon in Scarlet &amp; Violet, find moves by what they do, build teams and have the
          database check them against tournament rules.
        </p>
      </section>
      <Suspense fallback={<Loading />}>
        <Overview />
      </Suspense>
    </div>
  );
}

async function Overview() {
  const user = await getCurrentUser();
  const counts = await withDb(await currentActor(), (db) =>
    db.one<{ species: number; moves: number; abilities: number; formats: number }>(
      `SELECT (SELECT count(*) FROM pokemon_species) AS species,
              (SELECT count(*) FROM combat_move) AS moves,
              (SELECT count(*) FROM special_ability) AS abilities,
              (SELECT count(*) FROM battle_format WHERE is_active) AS formats`,
    ),
  );

  const tiles = [
    { label: "Pokémon", value: counts!.species, href: "/pokedex" },
    { label: "Moves", value: counts!.moves, href: "/search?kind=moves" },
    { label: "Abilities", value: counts!.abilities, href: "/search?kind=abilities" },
    { label: "Active formats", value: counts!.formats, href: "/stats" },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {tiles.map((t) => (
          <Link key={t.label} href={t.href} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm hover:border-red-300">
            <div className="text-3xl font-bold tabular-nums">{t.value}</div>
            <div className="text-sm text-slate-600">{t.label}</div>
          </Link>
        ))}
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <Card title="Search by meaning">
          <p className="text-sm text-slate-600">
            Type &ldquo;heal myself&rdquo; or &ldquo;boost speed in rain&rdquo;: semantic search finds moves and abilities by what
            they do, not just by their words.
          </p>
          <Link href="/search?mode=semantic" className="mt-3 inline-block text-sm text-red-700 hover:underline">Try it →</Link>
        </Card>
        <Card title="Build and validate teams">
          <p className="text-sm text-slate-600">
            Species clause, item clause, legal abilities and moves, level caps and bans are all enforced by the database.
          </p>
          <Link href={user ? "/teams" : "/signup"} className="mt-3 inline-block text-sm text-red-700 hover:underline">
            {user ? "Your teams →" : "Create an account →"}
          </Link>
        </Card>
        <Card title="Analyse">
          <p className="text-sm text-slate-600">
            Final stats, shared weaknesses, offensive coverage, similar teams and format usage statistics.
          </p>
          <Link href="/stats" className="mt-3 inline-block text-sm text-red-700 hover:underline">Usage stats →</Link>
        </Card>
      </div>
      {user && (
        <p className="text-sm text-slate-600">
          Signed in as <strong>{user.username}</strong> ({user.role}).
        </p>
      )}
    </div>
  );
}
