"""
Create or upgrade the Pokedex database.

Applies every pending file in database/migrations/ in name order, each in its
own transaction, and records it in schema_migration so re-runs only apply new
files. A database built before this runner existed (001 applied by hand) is
detected and baselined automatically.

Usage (from the repository root):
    python database/setup_db.py                  # apply pending migrations
    python database/setup_db.py --seed --demo    # ... then seed reference data and load demo teams
    python database/setup_db.py --reset --seed --demo   # DROP everything first (destroys all data)

Environment (.env in the repository root):
    DATABASE_URL     owner/superuser connection, used for setup only
    APP_DB_PASSWORD  optional; sets the password of the pokedex_app login role
"""

import argparse
import os
import subprocess
import sys
from pathlib import Path

import psycopg
from psycopg import sql
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
MIGRATIONS = ROOT / "database" / "migrations"
DEMO_DATA = ROOT / "database" / "demo_data.sql"
SEED = ROOT / "dataset" / "seed.py"


def reset(conn):
    with conn.transaction():
        conn.execute("DROP SCHEMA public CASCADE")
        conn.execute("CREATE SCHEMA public")
        conn.execute("GRANT USAGE ON SCHEMA public TO PUBLIC")
    print("  dropped and recreated schema public")


def apply_migrations(conn):
    with conn.transaction():
        conn.execute("""CREATE TABLE IF NOT EXISTS schema_migration (
                            migration_file VARCHAR(200) PRIMARY KEY,
                            applied_at     TIMESTAMP NOT NULL DEFAULT now())""")
        applied = {r[0] for r in conn.execute("SELECT migration_file FROM schema_migration")}
        base_exists = conn.execute("SELECT to_regclass('public.trainer') IS NOT NULL").fetchone()[0]
        if not applied and base_exists:
            conn.execute("INSERT INTO schema_migration (migration_file) VALUES ('001_base_schema.sql')")
            applied.add("001_base_schema.sql")
            print("  existing schema found, recorded 001_base_schema.sql as applied")

    pending = [f for f in sorted(MIGRATIONS.glob("*.sql")) if f.name not in applied]
    for f in pending:
        with conn.transaction():
            conn.execute(f.read_text(encoding="utf-8"))
            conn.execute("INSERT INTO schema_migration (migration_file) VALUES (%s)", (f.name,))
        print(f"  applied {f.name}")
    if not pending:
        print("  nothing to apply, schema is up to date")


def set_app_password(conn):
    password = os.getenv("APP_DB_PASSWORD")
    if not password:
        print("  APP_DB_PASSWORD not set, pokedex_app has no password (it cannot log in)")
        return
    with conn.transaction():
        conn.execute(sql.SQL("ALTER ROLE pokedex_app PASSWORD {}").format(sql.Literal(password)))
    print("  pokedex_app password set from APP_DB_PASSWORD")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--reset", action="store_true", help="drop ALL tables and data first")
    parser.add_argument("--seed", action="store_true", help="run dataset/seed.py after migrating")
    parser.add_argument("--demo", action="store_true", help="load database/demo_data.sql (demo trainers and teams)")
    args = parser.parse_args()

    load_dotenv(ROOT / ".env")
    url = os.getenv("DATABASE_URL")
    if not url:
        sys.exit("DATABASE_URL is not set (put it in .env in the repository root)")

    with psycopg.connect(url, autocommit=True) as conn:
        if args.reset:
            print("Resetting")
            reset(conn)
        print("Migrating")
        apply_migrations(conn)
        set_app_password(conn)

    if args.seed:
        print("Seeding")
        subprocess.run([sys.executable, str(SEED)], check=True)

    if args.demo:
        print("Loading demo data")
        with psycopg.connect(url, autocommit=True) as conn:
            if conn.execute("SELECT 1 FROM trainer WHERE account_username = 'oak'").fetchone():
                print("  already loaded, skipping")
            else:
                with conn.transaction():
                    conn.execute(DEMO_DATA.read_text(encoding="utf-8"))
                    conn.execute("CALL sp_refresh_usage_statistics()")
                print("  demo trainers, formats and teams loaded")
    print("Done")


if __name__ == "__main__":
    main()
