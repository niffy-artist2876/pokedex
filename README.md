# Pokedex & Competitive Team Management

A PostgreSQL + pgvector database and Next.js web app for browsing Pokémon
reference data, searching moves and abilities by meaning, and building
competitive teams that the database validates against tournament formats. 

Done by:<br>
Shaurya Singh - PES1UG24CS437<br>
Shishir Hegde - PES1UG24CS438

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

## Sharing one database between several copies of the site

Every copy of the web app reads and writes whatever `APP_DATABASE_URL` points to,
and no page caches query results, so copies that share one database see each
other's changes on the next page load. To run the site on two machines:

1. Create a PostgreSQL 16+ database on a host that offers the `vector`, `pg_trgm`
   and `pgcrypto` extensions (Neon does; its owner role can create the
   `pokedex_*` roles that migration 007 needs). Copy its **direct** connection string.
2. On one machine, set `DATABASE_URL` to that string (with `?sslmode=require`),
   then run setup, seeding and embedding once:
   ```bash
   python database/setup_db.py --seed --demo
   python dataset/seed.py --embed
   ```
3. On every machine, set `APP_DATABASE_URL` to the same host as
   `pokedex_app:<APP_DB_PASSWORD>`, ending in `?sslmode=verify-full`, plus a
   `SESSION_SECRET`. Then run `cd web && npm install && npm run dev`. The other
   machines don't need Docker or Python.

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

- Each move's and ability's `"Name: description"` text, as a
  384-dimension vector (`all-MiniLM-L6-v2`, mean pooling, normalized). Each team also
  gets a 42-dimension profile (type shares, average damage taken per type, average
  base stats) kept current by a trigger.
- Vector columns are indexed with HNSW indexes and cosine distance is used as the distance metric
  (`<=>`) in `fn_search_moves_semantic`, `fn_search_abilities_semantic` and `fn_similar_teams`.
- `seed.py --embed` and the admin "embed missing"
  button create vectors. For the search feature, "similar moves" and "similar teams" are returned. The
  admin can re-embed edited text and can remove a vector. A
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
