# Pokedex & Competitive Team Management

PostgreSQL database for browsing Pokémon reference data and building
competitive teams. See `er-diagram.png` for the entity-relationship model.

## Layout

- `dataset/schema_novector.sql`: tables, constraints, indexes and business-rule triggers
- `dataset/seed.py`: loads reference data from PokeAPI CSVs (cached in `dataset/.pokeapi_cache/`)
- `requirements.txt`: Python dependencies

## Setup

```bash
pip install -r requirements.txt
createdb -U postgres pokedex
psql -U postgres -d pokedex -v ON_ERROR_STOP=1 -f dataset/schema_novector.sql
cp dataset/.env.example dataset/.env   # then fill in DATABASE_URL (and ADMIN_* if wanted)
python dataset/seed.py                 # Scarlet/Violet; --version-group champions for others
```

The seed is one transaction and fully re-runnable; it never touches team data.

## Rules enforced in the database

| Rule | How |
|---|---|
| Species clause / item clause | `UNIQUE` on team + species / team + item |
| Ability must be legal for the species | composite FK to `species_possible_abilities` |
| EVs 0–252 each, 510 total; IVs 0–31; 6 slots; 4 moves | `CHECK` / `UNIQUE` |
| Only admins manage formats; can't demote an active manager | triggers on `battle_format`, `trainer` |
| Teams only in active formats | trigger on `competitive_team` |
| Member level ≤ format level cap; no banned species | trigger on `individual_team_member` (and on team format change) |
| Equipped moves must be learnable by the species | trigger on `member_equipped_moves` (and on species change) |
| `last_modified_timestamp` stays current | triggers on team, member and move changes |

## Not yet included

The ER diagram also shows pgvector columns (`description_embedding`,
`team_profile_vector`). They aren't in `schema_novector.sql`, so
`seed.py --embed` exits with a message until a pgvector schema is added.
