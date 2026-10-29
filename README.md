# Pokedex & Competitive Team Management

A PostgreSQL + pgvector database and Next.js web app for browsing Pokémon
reference data, searching moves and abilities by meaning, and building
competitive teams that the database validates against tournament formats. See
`er-diagram.png` for the entity-relationship model.

## Layout

```
.env.example                 copy to .env; settings for the database, scripts and web app (never committed)
docker-compose.yml           PostgreSQL 18 + pgvector on port 5433
requirements.txt             Python dependencies
er-diagram.png
dataset/
  seed.py                    loads reference data from PokeAPI CSVs (one transaction)
  .pokeapi_cache/            the CSVs, so seeding works offline
database/
  setup_db.py                applies migrations in order; --seed, --demo, --reset
  migrations/
    001_base_schema.sql      CREATE: 16 tables, keys, CHECKs, indexes, rule triggers
    002_alter_...sql         ALTER: evolutions, format limits, trainer input validation
    003_search_indexes.sql   full-text search (tsvector + GIN) and trigram fuzzy search
    004_drop_...sql          DROP: indexes made redundant by UNIQUE constraints
    005_views.sql            views + a materialized usage-statistics view
    006_functions_...sql     functions, procedures, team-status triggers
    007_role_based_access.sql  database roles, grants, row-level security
    008_vector_search.sql    pgvector: description embeddings, team profile vectors, similarity search
    009_app_support.sql      session lookup, admin description/embedding edits, ability search, evolution line
  demo_data.sql              demo trainers, formats and teams
  queries/
    important_queries.sql    28 labelled queries (joins, subqueries, CTEs, windows, vectors, ...)
    important_queries_output.txt
  tests/
    test_database.py         52 tests for constraints, triggers, procedures, security, vectors
    test_results.md
web/                         Next.js 16 app (App Router, server actions)
  src/lib/db.ts              connection pool; runs every request as the signed-in user's database role
  src/lib/session.ts         signed session cookie; role re-read from the database each request
  src/lib/embeddings.ts      same MiniLM model as seed.py, so search text and stored vectors match
  src/app/                   pages and server actions
```

## Setup

Needs Docker (or PostgreSQL 15+ with the pgvector extension), Python 3.10+ and Node 20+.

```bash
copy .env.example .env                  # fill in every value (see comments in the file)
docker compose up -d                    # PostgreSQL 18 + pgvector on port 5433
pip install -r requirements.txt
python database/setup_db.py --seed --demo
python dataset/seed.py --embed          # move/ability embeddings (downloads the MiniLM model once)
python database/tests/test_database.py
cd web && npm install && npm run dev    # http://localhost:3000
```

If the model download fails asking for `hf_xet`, set `HF_HUB_DISABLE_XET=1` before
`--embed`. The queries file runs with
`docker exec -i pokedex-db psql -U postgres -d pokedex < database/queries/important_queries.sql`.

`setup_db.py` records applied files in `schema_migration`, so it is safe to
re-run; new migrations are applied, old ones skipped. `--reset` drops every
table first (all data is lost). Seeding defaults to Scarlet/Violet; run
`python dataset/seed.py --version-group champions` for another game.

Demo accounts (password `Pokedex@123`): `oak` (admin), `ash`, `misty`, `brock`
(competitors).

## Rules enforced in the database

| Rule | How |
|---|---|
| Species clause / item clause | `UNIQUE` on team + species / team + item |
| Ability must be legal for the species | composite FK to `species_possible_abilities` |
| EVs 0–252 each, 510 total; IVs 0–31; 6 slots; 4 moves | `CHECK` / `UNIQUE` |
| Username, e-mail and bcrypt-hash formats; case-insensitive uniqueness | `CHECK` regex, unique indexes on `lower()` |
| Only admins manage formats; can't demote an active manager | triggers on `battle_format`, `trainer` |
| Teams only in active formats | trigger on `competitive_team` |
| Member level ≤ level cap; no banned species; cap can't drop below members | triggers |
| Equipped moves must be learnable by the species | trigger (also on species change) |
| Team-size and legendary limits per format | `sp_validate_team` |
| Only `sp_validate_team` can mark a team validated; any edit resets it to draft; a new ban demotes affected teams | triggers |

## Roles and access control

| Role | Can |
|---|---|
| `pokedex_guest` | read the Pokédex, formats and usage stats; sign up and fetch login credentials through `SECURITY DEFINER` functions |
| `pokedex_competitor` | everything a guest can, plus create/edit/delete **their own** teams and read others' validated teams (row-level security) |
| `pokedex_admin` | everything a competitor can, plus manage formats and bans, see and delete any team, change trainer roles |
| `pokedex_app` | the only login role; has no rights of its own (NOINHERIT) |

The backend connects as `pokedex_app` and, per request inside a transaction, runs
`SET LOCAL ROLE pokedex_competitor` (or guest/admin) and
`SELECT set_config('pokedex.trainer_id', '<id>', true)`. Password hashes and
e-mails are hidden from competitors by column privileges.

## Vector search

- **What is embedded:** each move's and ability's `"Name: description"` text, as a
  384-dimension vector (`all-MiniLM-L6-v2`, mean pooling, normalized). Each team also
  gets a 42-dimension profile (type shares, average damage taken per type, average
  base stats) kept current by a trigger.
- **Storage and retrieval:** `vector` columns with HNSW indexes; cosine distance
  (`<=>`) in `fn_search_moves_semantic`, `fn_search_abilities_semantic` and `fn_similar_teams`.
- **Create / read / update / delete:** `seed.py --embed` and the admin "embed missing"
  button create vectors; search, "similar moves" and "similar teams" read them; the
  admin description editor re-embeds edited text; admins can remove a vector, and a
  trigger clears a vector whose description changed without a new one.

## Web app

| Page | Who | Database features used |
|---|---|---|
| Pokédex, species pages | everyone | views, trigram fuzzy search, recursive evolution function, type-matchup view |
| Moves & Abilities search | everyone | full-text search (`ts_rank`, `ts_headline`), semantic search (pgvector) |
| My Teams, team builder | competitors | RLS, triggers and constraints (errors shown on the form), `sp_validate_team`, stat and weakness functions, coverage CTE, similar teams |
| Community | competitors | RLS shows only validated teams of others; `sp_clone_team` |
| Usage Stats | everyone | materialized view; admins refresh it |
| Admin: formats, bans, trainers, descriptions & embeddings | admins | admin-only grants, ban trigger, column privileges, vector update/delete |

Every request runs in one transaction as `pokedex_guest`, `pokedex_competitor` or
`pokedex_admin`, so the database, not the app, decides what each user can see and change.
