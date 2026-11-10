"""
Generate a Chen-notation ER diagram (Graphviz DOT) from the live PostgreSQL schema.

    python database/tools/er_to_chen.py              # writes er-chen.dot at the repo root
    neato -Tpng -Goverlap=false er-chen.dot -o er-chen.png   # needs Graphviz installed

Mapping:
  table                      -> entity (rectangle)
  column                     -> attribute (oval); primary key columns are underlined
  foreign key (non-junction) -> relationship (diamond) between child and parent
  junction table (PK made of foreign keys, e.g. SPECIES_LEARNABLE_MOVES)
                             -> relationship (diamond) between its parents; its
                                non-key columns become attributes of the diamond
  foreign key columns        -> not drawn as attributes (the diamond replaces them)

Cardinality: the child side is 1 (or 0..1 if the foreign key is nullable), the parent
side is N. Junction legs are labelled N/M. Foreign keys that point at a junction table
(e.g. composite keys onto SPECIES_POSSIBLE_ABILITIES) are skipped, because Chen notation
does not allow a relationship to another relationship.
"""

import os
import re
import shutil
import subprocess
import sys
from collections import defaultdict
from pathlib import Path

import psycopg
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[2]
OUTPUT = ROOT / "er-chen.dot"
SKIP_TABLES = {"schema_migration"}  # migration bookkeeping, not part of the data model


def html_escape(text):
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def quote(text):
    return '"' + text.replace('"', '\\"') + '"'


def role_name(column):
    """Readable relationship name from a foreign key column, e.g. Owned_By_Trainer_ID -> Owned By Trainer."""
    name = re.sub(r"_(ID|Identification_Number|Number)$", "", column, flags=re.IGNORECASE)
    return name.replace("_", " ")


def introspect(conn):
    tables = [r[0] for r in conn.execute("""
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name""")]

    columns = defaultdict(list)        # table -> [column names in order]
    nullable = {}                      # (table, column) -> bool
    for table, column, is_nullable in conn.execute("""
        SELECT table_name, column_name, is_nullable = 'YES' FROM information_schema.columns
        WHERE table_schema = 'public' ORDER BY table_name, ordinal_position"""):
        columns[table].append(column)
        nullable[(table, column)] = is_nullable

    primary = defaultdict(set)
    for table, column in conn.execute("""
        SELECT c.conrelid::regclass::text, a.attname
        FROM pg_constraint c
        JOIN LATERAL unnest(c.conkey) AS k(n) ON true
        JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.n
        WHERE c.contype = 'p' AND c.connamespace = 'public'::regnamespace"""):
        primary[table].add(column)

    foreign_keys = []                  # (child, parent, child_columns, parent_columns)
    for child, parent, child_cols, parent_cols in conn.execute("""
        SELECT cl.relname, pl.relname,
               ARRAY(SELECT a.attname FROM unnest(c.conkey) WITH ORDINALITY k(n, i)
                     JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.n ORDER BY k.i),
               ARRAY(SELECT a.attname FROM unnest(c.confkey) WITH ORDINALITY k(n, i)
                     JOIN pg_attribute a ON a.attrelid = c.confrelid AND a.attnum = k.n ORDER BY k.i)
        FROM pg_constraint c
        JOIN pg_class cl ON cl.oid = c.conrelid
        JOIN pg_class pl ON pl.oid = c.confrelid
        WHERE c.contype = 'f' AND cl.relnamespace = 'public'::regnamespace"""):
        foreign_keys.append((child, parent, list(child_cols), list(parent_cols)))

    return tables, columns, nullable, primary, foreign_keys


def build_dot(tables, columns, nullable, primary, foreign_keys):
    # Junction table: every primary key column is a foreign key column, and it has
    # at least two foreign keys. Its foreign keys are the relationship's legs.
    fk_by_child = defaultdict(list)
    for fk in foreign_keys:
        fk_by_child[fk[0]].append(fk)

    tables = [t for t in tables if t not in SKIP_TABLES]
    junctions = {}
    for table in tables:
        fks = fk_by_child[table]
        fk_cols = {c for _, _, cols, _ in fks for c in cols}
        if len(fks) >= 2 and primary[table] and primary[table] <= fk_cols:
            junctions[table] = fks

    entities = [t for t in tables if t not in junctions]
    lines = [
        "graph ER {",
        '  graph [overlap=false, splines=true, fontname="Helvetica", label="Pokedex - Chen notation", labelloc=t];',
        '  node [fontname="Helvetica", fontsize=10];',
        '  edge [fontname="Helvetica", fontsize=9, len=1.2];',
    ]

    def add_attributes(owner_id, table, skip_cols):
        for column in columns[table]:
            if column in skip_cols:
                continue
            attr_id = quote(f"attr:{table}.{column}")
            label = f"<U>{html_escape(column)}</U>" if column in primary[table] else html_escape(column)
            lines.append(f"  {attr_id} [shape=ellipse, label=<{label}>];")
            lines.append(f"  {quote(owner_id)} -- {attr_id};")

    # Entities with their attributes (foreign key columns are not attributes).
    for table in entities:
        fk_cols = {c for _, _, cols, _ in fk_by_child[table] for c in cols}
        entity_id = f"entity:{table}"
        lines.append(f"  {quote(entity_id)} [shape=box, style=bold, label={quote(table.replace('_', ' '))}];")
        add_attributes(entity_id, table, fk_cols)

    # Junction tables -> many-to-many relationship diamonds.
    for table, fks in junctions.items():
        rel_id = f"rel:{table}"
        lines.append(f"  {quote(rel_id)} [shape=diamond, label={quote(table.replace('_', ' '))}];")
        parents = [parent for _, parent, _, _ in fks]
        for child, parent, cols, _ in fks:
            if parent in junctions:
                continue
            # Role names are only needed when the same entity appears twice (e.g. a type
            # matching itself); otherwise the diamond name already says what it is.
            label = f", headlabel={quote(role_name(cols[0]))}" if parents.count(parent) > 1 else ""
            lines.append(f"  {quote(rel_id)} -- {quote('entity:' + parent)} "
                         f"[taillabel={quote('N')}{label}];")
        # Non-key columns of a junction table are attributes of the relationship itself.
        fk_cols = {c for _, _, cols, _ in fks for c in cols}
        for column in columns[table]:
            if column in fk_cols:
                continue
            attr_id = quote(f"attr:{table}.{column}")
            lines.append(f"  {attr_id} [shape=ellipse, label={quote(column)}];")
            lines.append(f"  {quote(rel_id)} -- {attr_id};")

    # Ordinary foreign keys -> one-to-many relationship diamonds.
    for child, parent, cols, _ in foreign_keys:
        if child in junctions or child not in entities:
            continue
        if parent in junctions:
            print(f"skipped: {child}({', '.join(cols)}) -> {parent} (relationship to a relationship)",
                  file=sys.stderr)
            continue
        rel_id = f"rel:{child}.{'+'.join(cols)}"
        child_min = "0..1" if nullable[(child, cols[0])] else "1"
        lines.append(f"  {quote(rel_id)} [shape=diamond, label={quote(role_name(cols[0]))}];")
        lines.append(f"  {quote('entity:' + child)} -- {quote(rel_id)} [taillabel={quote(child_min)}];")
        lines.append(f"  {quote(rel_id)} -- {quote('entity:' + parent)} [headlabel={quote('N')}];")

    lines.append("}")
    return "\n".join(lines) + "\n"


PAPER_INCHES = {  # landscape width, height in inches
    "A4": (11.69, 8.27), "A3": (16.54, 11.69), "A2": (23.39, 16.54),
    "A1": (33.11, 23.39), "A0": (46.81, 33.11),
}


def main():
    paper = sys.argv[sys.argv.index("--paper") + 1] if "--paper" in sys.argv else "A0"
    if paper not in PAPER_INCHES:
        sys.exit(f"--paper must be one of {', '.join(PAPER_INCHES)}")
    load_dotenv(ROOT / ".env")
    url = os.getenv("DATABASE_URL") or os.getenv("TEST_DATABASE_URL")
    if not url:
        sys.exit("DATABASE_URL is not set (put it in .env in the repository root)")

    with psycopg.connect(url) as conn:
        schema = introspect(conn)

    OUTPUT.write_text(build_dot(*schema), encoding="utf-8")
    print(f"wrote {OUTPUT}")

    renderer = shutil.which("neato") or next(
        (p for p in (r"C:\Program Files\Graphviz\bin\neato.exe",) if os.path.exists(p)), None)
    if renderer:
        # SVG scales to any size without blurring; the PNG is rendered at 200 dpi for sharing.
        # Spread the nodes out (sep) and scale the drawing to fill the chosen landscape paper.
        width, height = PAPER_INCHES[paper]
        spread = [f"-Gsize={width},{height}!", "-Goverlap=scale", "-Gsep=+25", "-Gepsilon=0.0001"]
        svg = OUTPUT.with_suffix(".svg")
        pdf = OUTPUT.with_suffix(".pdf")
        subprocess.run([renderer, "-Tsvg", "-Goverlap=prism", str(OUTPUT), "-o", str(svg)], check=True)
        subprocess.run([renderer, "-Tpdf", *spread, str(OUTPUT), "-o", str(pdf)], check=True)
        print(f"rendered {svg}\nrendered {pdf} ({paper} landscape)")
    else:
        print("Graphviz not found. Install it (winget install graphviz), then run:\n"
              f"  neato -Tpng -Goverlap=false {OUTPUT.name} -o er-chen.png")


if __name__ == "__main__":
    main()
