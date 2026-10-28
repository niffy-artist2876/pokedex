# Pokedex & Competitive Team Management

A PostgreSQL database for browsing Pokémon reference data and building
competitive teams that are validated against tournament formats. See
`er-diagram.png` for the entity-relationship model.

## Layout

```
.env.example                 copy to .env; database settings (never committed)
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
  demo_data.sql              demo trainers, formats and teams
  queries/
    important_queries.sql    28 labelled queries (joins, subqueries, CTEs, windows, vectors, ...)
    important_queries_output.txt
  tests/
    test_database.py         46 tests for constraints, triggers, procedures, security, vectors
    test_results.md
```

## Setup

Needs PostgreSQL 15+ (tested on 18) and Python 3.10+.

```bash
pip install -r requirements.txt
createdb -U postgres pokedex
copy .env.example .env        # then fill in DATABASE_URL and APP_DB_PASSWORD
python database/setup_db.py --seed --demo
python database/tests/test_database.py
psql -U postgres -d pokedex -f database/queries/important_queries.sql
```

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

## Not yet included

- The vector-search part (pgvector embeddings and similarity search). The ER diagram
  already shows `description_embedding` and `team_profile_vector`;
  `seed.py --embed` exits with a message until they're added.
- The Next.js web application.
