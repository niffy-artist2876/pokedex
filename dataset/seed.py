"""
Seed the Pokedex & Competitive Team Management database from PokeAPI's CSV dumps.

Loads reference data only (types, matchups, species, abilities, moves, learnsets,
items, natures). User-owned tables (trainer, competitive_team, members, moves)
are left alone, except for an optional bootstrap admin + default format.

Run database/setup_db.py first (or pass --seed to it): this script fills
columns added by the migrations in database/migrations/.

Usage:
    python seed.py                          # seed for Scarlet/Violet
    python seed.py --version-group champions
    python seed.py --embed                  # also fill pgvector description embeddings

Environment (.env in the repository root):
    DATABASE_URL=postgresql://user:pass@localhost:5432/pokedex
    ADMIN_USERNAME=... ADMIN_EMAIL=... ADMIN_PASSWORD=...   (optional bootstrap admin)

Re-runnable: everything is an upsert inside a single transaction, so a failure
rolls back the whole seed and a re-run never duplicates or wipes team data.
"""

import argparse
import os
import re
import sys
import urllib.request
from pathlib import Path

import pandas as pd
import psycopg
from dotenv import load_dotenv

CSV_BASE = "https://raw.githubusercontent.com/PokeAPI/pokeapi/master/data/v2/csv/"
ENGLISH = 9
CSV_FILES = [
    "types", "type_names", "type_efficacy",
    "pokemon", "pokemon_species", "pokemon_species_names", "pokemon_stats", "pokemon_types",
    "pokemon_evolution", "evolution_triggers",
    "abilities", "ability_names", "ability_flavor_text", "ability_prose", "pokemon_abilities",
    "moves", "move_names", "move_flavor_text", "move_effect_prose", "pokemon_moves",
    "items", "item_names", "item_flavor_text", "item_prose",
    "natures", "nature_names", "version_groups",
]

# PokeAPI stat ids -> values allowed by the CHECK on statistical_nature
STAT_NAMES = {2: "attack", 3: "defense", 4: "special_attack", 5: "special_defense", 6: "speed"}
DAMAGE_CLASSES = {1: "status", 2: "physical", 3: "special"}

# Item categories that matter competitively: held items, choice items, orbs,
# plates, signature items, type boosters, and battle berries.
HELD_ITEM_CATEGORIES = {3, 4, 5, 6, 7, 12, 13, 15, 17, 18, 19}

DEFAULT_LEVEL_CAP = 50
EMBED_MODEL = "sentence-transformers/all-MiniLM-L6-v2"  # 384-dim, matches vector(384)


# ---------------------------------------------------------------- data loading

def fetch_csvs(cache: Path, refresh: bool) -> dict[str, pd.DataFrame]:
    cache.mkdir(parents=True, exist_ok=True)
    frames = {}
    for name in CSV_FILES:
        path = cache / f"{name}.csv"
        if refresh or not path.exists():
            print(f"  downloading {name}.csv")
            urllib.request.urlretrieve(CSV_BASE + f"{name}.csv", path)
        frames[name] = pd.read_csv(path, keep_default_na=True)
    return frames


def clean_text(text) -> str | None:
    """Collapse game-text line breaks, form feeds and soft hyphens."""
    if not isinstance(text, str):
        return None
    text = text.replace("\u00ad", "").replace("\f", " ").replace("-\n", "")
    return re.sub(r"\s+", " ", text).strip() or None


def strip_markup(text, effect_chance=None) -> str | None:
    """PokeAPI prose uses [label]{kind:target}; an empty label means 'use the target'."""
    if not isinstance(text, str):
        return None
    def repl(m):
        label, target = m.group(1), m.group(2)
        return label or target.split(":", 1)[-1].replace("-", " ")
    text = re.sub(r"\[([^\]]*)\]\{([^}]*)\}", repl, text)
    if effect_chance is not None and not pd.isna(effect_chance):
        text = text.replace("$effect_chance", str(int(effect_chance)))
    return clean_text(text)


def english_names(df: pd.DataFrame, id_col: str) -> dict[int, str]:
    en = df[df.local_language_id == ENGLISH]
    return dict(zip(en[id_col], en["name"]))


def latest_flavor_text(df, id_col, vg_order, preferred_vg) -> dict[int, str]:
    """English flavor text from the target version group if present, else the latest one."""
    en = df[df.language_id == ENGLISH].copy()
    en["rank"] = en.version_group_id.map(vg_order).astype(float)
    en.loc[en.version_group_id == preferred_vg, "rank"] = float("inf")
    en = en.sort_values("rank").drop_duplicates(id_col, keep="last")
    return {k: clean_text(v) for k, v in zip(en[id_col], en["flavor_text"])}


def none_if_nan(v):
    return None if pd.isna(v) else int(v)


def build(frames: dict[str, pd.DataFrame], vg_identifier: str) -> dict[str, list[tuple]]:
    vgs = frames["version_groups"]
    match = vgs[vgs.identifier == vg_identifier]
    if match.empty:
        sys.exit(f"Unknown version group '{vg_identifier}'. Options: {', '.join(vgs.identifier)}")
    vg_id = int(match.id.iloc[0])
    vg_order = dict(zip(vgs.id, vgs["order"]))

    # Types: only the 18 with a full matchup row (drops stellar/unknown/shadow)
    eff = frames["type_efficacy"]
    type_ids = sorted(set(eff.damage_type_id))
    type_name = english_names(frames["type_names"], "type_id")
    types = [(t, type_name[t]) for t in type_ids]
    matchups = [(int(a), int(d), f / 100) for a, d, f in eff.itertuples(index=False)]

    # Species: default forms that have a learnset in the chosen version group
    pk = frames["pokemon"]
    defaults = pk[pk.is_default == 1]
    poke_to_species = dict(zip(defaults.id, defaults.species_id))
    lm = frames["pokemon_moves"]
    lm = lm[(lm.version_group_id == vg_id) & lm.pokemon_id.isin(poke_to_species)]
    if lm.empty:
        sys.exit(f"No learnset data for '{vg_identifier}' in this PokeAPI snapshot.")
    lm = lm.assign(species=lm.pokemon_id.map(poke_to_species))
    learnsets = lm[["species", "move_id"]].drop_duplicates()
    species_ids = set(learnsets.species)
    included_pokemon = {p for p, s in poke_to_species.items() if s in species_ids}

    species_name = english_names(frames["pokemon_species_names"], "pokemon_species_id")
    sp = frames["pokemon_species"].set_index("id")
    st = frames["pokemon_stats"]
    st = st[st.pokemon_id.isin(included_pokemon)].pivot(index="pokemon_id", columns="stat_id", values="base_stat")
    species = []
    for p, row in st.iterrows():
        s = poke_to_species[p]
        species.append((int(s), species_name[s], *(int(row[k]) for k in range(1, 7)),
                        int(sp.at[s, "generation_id"]), bool(sp.at[s, "is_legendary"]), bool(sp.at[s, "is_mythical"])))

    # Evolutions: only links where both species are in the game. A species can
    # have several evolution methods; keep PokeAPI's default (else the first).
    trigger_name = dict(zip(frames["evolution_triggers"].id, frames["evolution_triggers"].identifier))
    ev = frames["pokemon_evolution"].sort_values(["is_default", "id"], ascending=[False, True])
    ev = ev.drop_duplicates("evolved_species_id").set_index("evolved_species_id")
    evolutions = []
    for s in sorted(species_ids):
        prevo = sp.at[s, "evolves_from_species_id"]
        if pd.isna(prevo) or int(prevo) not in species_ids:
            continue
        method, level = None, None
        if s in ev.index:
            method = trigger_name.get(ev.at[s, "evolution_trigger_id"])
            level = none_if_nan(ev.at[s, "minimum_level"])
        evolutions.append((int(prevo), method, level, int(s)))

    pt = frames["pokemon_types"]
    pt = pt[pt.pokemon_id.isin(included_pokemon)]
    species_types = [(int(poke_to_species[p]), int(t), int(s)) for p, t, s in pt.itertuples(index=False)]

    # Abilities
    ab = frames["abilities"]
    main_abilities = set(ab[ab.is_main_series == 1].id)
    pa = frames["pokemon_abilities"]
    pa = pa[pa.pokemon_id.isin(included_pokemon) & pa.ability_id.isin(main_abilities)]
    pa = pa.assign(species=pa.pokemon_id.map(poke_to_species)).sort_values("is_hidden")
    pa = pa.drop_duplicates(["species", "ability_id"], keep="first")  # prefer non-hidden if listed twice
    species_abilities = [(int(s), int(a), bool(h)) for s, a, h in pa[["species", "ability_id", "is_hidden"]].itertuples(index=False)]

    ability_name = english_names(frames["ability_names"], "ability_id")
    ability_flavor = latest_flavor_text(frames["ability_flavor_text"], "ability_id", vg_order, vg_id)
    ap = frames["ability_prose"]
    ability_prose = {a: strip_markup(t) for a, t in zip(ap[ap.local_language_id == ENGLISH].ability_id,
                                                        ap[ap.local_language_id == ENGLISH].short_effect)}
    abilities = [(int(a), ability_name[a], ability_flavor.get(a) or ability_prose.get(a))
                 for a in sorted(set(pa.ability_id))]

    # Moves: everything learnable in the version group
    mv = frames["moves"]
    mv = mv[mv.id.isin(set(learnsets.move_id)) & mv.type_id.isin(type_ids) & mv.pp.notna()]
    move_name = english_names(frames["move_names"], "move_id")
    move_flavor = latest_flavor_text(frames["move_flavor_text"], "move_id", vg_order, vg_id)
    mp = frames["move_effect_prose"]
    mp = mp[mp.local_language_id == ENGLISH]
    effect_prose = dict(zip(mp.move_effect_id, mp.short_effect))
    moves = []
    for m in mv.itertuples(index=False):
        desc = move_flavor.get(m.id) or strip_markup(effect_prose.get(m.effect_id), m.effect_chance)
        category = DAMAGE_CLASSES[int(m.damage_class_id)]
        power = none_if_nan(m.power) or None  # 0 and NaN both mean "no fixed power"
        if category == "status":
            power = None
        moves.append((int(m.id), move_name[m.id], int(m.type_id), category,
                      power, none_if_nan(m.accuracy) or None, int(m.pp), desc))
    valid_moves = {m[0] for m in moves}
    learnsets = [(int(s), int(m)) for s, m in learnsets.itertuples(index=False) if m in valid_moves]

    # Held items
    it = frames["items"]
    it = it[it.category_id.isin(HELD_ITEM_CATEGORIES)]
    item_name = english_names(frames["item_names"], "item_id")
    item_flavor = latest_flavor_text(frames["item_flavor_text"], "item_id", vg_order, vg_id)
    ip = frames["item_prose"]
    ip = ip[ip.local_language_id == ENGLISH]
    item_prose = {i: strip_markup(t) for i, t in zip(ip.item_id, ip.short_effect)}
    items, seen_names = [], set()
    for i in sorted(it.id):
        name = item_name.get(i)
        if name and name not in seen_names:  # item_name is UNIQUE
            seen_names.add(name)
            items.append((int(i), name, item_flavor.get(i) or item_prose.get(i)))

    # Natures: increased == decreased means neutral -> NULL both
    nature_name = english_names(frames["nature_names"], "nature_id")
    natures = []
    for n in frames["natures"].itertuples(index=False):
        neutral = n.increased_stat_id == n.decreased_stat_id
        natures.append((int(n.id), nature_name[n.id],
                        None if neutral else STAT_NAMES[n.increased_stat_id],
                        None if neutral else STAT_NAMES[n.decreased_stat_id]))

    return dict(types=types, matchups=matchups, species=species, evolutions=evolutions, species_types=species_types,
                abilities=abilities, species_abilities=species_abilities, moves=moves,
                learnsets=learnsets, items=items, natures=natures)


# ---------------------------------------------------------------- database writes

def upsert(cur, table, cols, rows, key_cols, update=True):
    placeholders = ", ".join(["%s"] * len(cols))
    sql = f"INSERT INTO {table} ({', '.join(cols)}) VALUES ({placeholders}) ON CONFLICT ({', '.join(key_cols)}) "
    rest = [c for c in cols if c not in key_cols]
    if update and rest:
        sql += "DO UPDATE SET " + ", ".join(f"{c} = EXCLUDED.{c}" for c in rest)
    else:
        sql += "DO NOTHING"
    cur.executemany(sql, rows)
    print(f"  {table:<28} {len(rows):>6} rows")


def require_migrations(conn):
    row = conn.execute("""SELECT count(*) FROM information_schema.columns
                          WHERE table_name = 'pokemon_species' AND column_name = 'evolves_from_species_id'""").fetchone()
    if row[0] == 0:
        sys.exit("The database is missing migrations; run: python database/setup_db.py")


def seed(conn, data):
    with conn.transaction(), conn.cursor() as cur:
        upsert(cur, "elemental_type", ["elemental_type_identification_number", "type_name"],
               data["types"], ["elemental_type_identification_number"])
        upsert(cur, "type_matchup_matrix",
               ["attacking_type_identification_number", "defending_type_identification_number", "damage_multiplier_value"],
               data["matchups"], ["attacking_type_identification_number", "defending_type_identification_number"])
        upsert(cur, "pokemon_species",
               ["species_national_pokedex_number", "species_name", "base_hit_points", "base_attack", "base_defense",
                "base_special_attack", "base_special_defense", "base_speed",
                "generation_number", "is_legendary", "is_mythical"],
               data["species"], ["species_national_pokedex_number"])
        # second pass: evolves_from references pokemon_species itself
        cur.executemany("""UPDATE pokemon_species
                           SET evolves_from_species_id = %s, evolution_method = %s, evolution_minimum_level = %s
                           WHERE species_national_pokedex_number = %s""", data["evolutions"])
        print(f"  {'species evolution links':<28} {len(data['evolutions']):>6} rows")
        upsert(cur, "pokemon_elemental_types",
               ["species_national_pokedex_number", "elemental_type_identification_number", "type_slot_order"],
               data["species_types"], ["species_national_pokedex_number", "elemental_type_identification_number"])
        upsert(cur, "special_ability", ["ability_identification_number", "ability_name", "ability_effect_description"],
               data["abilities"], ["ability_identification_number"])
        upsert(cur, "species_possible_abilities",
               ["species_national_pokedex_number", "ability_identification_number", "is_hidden_ability"],
               data["species_abilities"], ["species_national_pokedex_number", "ability_identification_number"])
        upsert(cur, "combat_move",
               ["move_identification_number", "move_name", "elemental_type_identification_number", "damage_category",
                "base_power", "accuracy_percentage", "base_power_points", "move_effect_description"],
               data["moves"], ["move_identification_number"])
        upsert(cur, "species_learnable_moves", ["species_national_pokedex_number", "move_identification_number"],
               data["learnsets"], ["species_national_pokedex_number", "move_identification_number"], update=False)
        upsert(cur, "held_item", ["item_identification_number", "item_name", "item_effect_description"],
               data["items"], ["item_identification_number"])
        upsert(cur, "statistical_nature",
               ["nature_identification_number", "nature_name", "increased_stat_type", "decreased_stat_type"],
               data["natures"], ["nature_identification_number"])


def bootstrap_admin(conn, vg_identifier):
    """Signup only creates competitors, so the first admin has to come from here."""
    username, email, password = (os.getenv(k) for k in ("ADMIN_USERNAME", "ADMIN_EMAIL", "ADMIN_PASSWORD"))
    if not (username and email and password):
        print("  ADMIN_* not set, skipping bootstrap admin and default format")
        return
    import bcrypt
    pw_hash = bcrypt.hashpw(password.encode(), bcrypt.gensalt(rounds=12)).decode()
    with conn.transaction(), conn.cursor() as cur:
        cur.execute("""INSERT INTO trainer (account_username, email_address, encrypted_password_hash, system_access_role)
                       VALUES (%s, %s, %s, 'admin') ON CONFLICT (account_username) DO NOTHING""",
                    (username, email, pw_hash))
        cur.execute("SELECT trainer_identification_number FROM trainer WHERE account_username = %s", (username,))
        admin_id = cur.fetchone()[0]
        cur.execute("""INSERT INTO battle_format (format_name, level_cap, ruleset_description, managed_by_trainer_id,
                                                  minimum_team_size, maximum_legendary_members)
                       VALUES (%s, %s, %s, %s, 4, 1) ON CONFLICT (format_name) DO NOTHING""",
                    (f"VGC Doubles ({vg_identifier})", DEFAULT_LEVEL_CAP,
                     "Doubles, bring 6 pick 4, species clause, item clause, level 50, one legendary.", admin_id))
    print(f"  admin '{username}' and default format ready")


def get_encoder(model_name):
    from sentence_transformers import SentenceTransformer
    model = SentenceTransformer(model_name)
    return lambda texts: model.encode(texts, normalize_embeddings=True, batch_size=64, show_progress_bar=False)


def embed_descriptions(conn, model_name):
    with conn.cursor() as cur:
        cur.execute("""SELECT count(*) FROM information_schema.columns
                       WHERE table_name IN ('combat_move', 'special_ability')
                         AND column_name = 'description_embedding'""")
        if cur.fetchone()[0] < 2:
            sys.exit("--embed needs the pgvector schema (description_embedding columns); "
                     "schema_novector.sql doesn't have them")
    encode = get_encoder(model_name)
    targets = [("combat_move", "move_identification_number", "move_name", "move_effect_description"),
               ("special_ability", "ability_identification_number", "ability_name", "ability_effect_description")]
    with conn.transaction(), conn.cursor() as cur:
        for table, pk, name_col, desc_col in targets:
            cur.execute(f"SELECT {pk}, {name_col}, {desc_col} FROM {table} WHERE {desc_col} IS NOT NULL")
            rows = cur.fetchall()
            vectors = encode([f"{name}: {desc}" for _, name, desc in rows])
            literal = lambda v: "[" + ",".join(f"{x:.6f}" for x in v) + "]"
            cur.executemany(f"UPDATE {table} SET description_embedding = %s::vector WHERE {pk} = %s",
                            [(literal(v), r[0]) for v, r in zip(vectors, rows)])
            print(f"  {table:<28} {len(rows):>6} embeddings")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--version-group", default="scarlet-violet", help="PokeAPI version group for learnsets")
    parser.add_argument("--cache-dir", default=Path(__file__).resolve().parent / ".pokeapi_cache", type=Path)
    parser.add_argument("--refresh", action="store_true", help="re-download CSVs")
    parser.add_argument("--embed", action="store_true", help="fill pgvector embeddings (needs sentence-transformers)")
    parser.add_argument("--model", default=EMBED_MODEL)
    args = parser.parse_args()

    load_dotenv(Path(__file__).resolve().parent.parent / ".env")
    url = os.getenv("DATABASE_URL")
    if not url:
        sys.exit("DATABASE_URL is not set (put it in .env)")

    print("Loading PokeAPI CSVs")
    data = build(fetch_csvs(args.cache_dir, args.refresh), args.version_group)

    with psycopg.connect(url) as conn:
        require_migrations(conn)
        print("Seeding reference tables (single transaction)")
        seed(conn, data)
        bootstrap_admin(conn, args.version_group)
        if args.embed:
            print(f"Embedding descriptions with {args.model}")
            embed_descriptions(conn, args.model)
    print("Done")


if __name__ == "__main__":
    main()
