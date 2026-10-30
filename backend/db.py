"""Local SQLite connection helper shared by server_manager, app, and CLI scripts.

Single source of truth for the on-disk database location and connection
settings. Foreign keys are off by default in SQLite, so every connection
must explicitly enable them to get the ON DELETE CASCADE behaviour the
schema relies on.
"""

import os
import sqlite3
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

DB_PATH = Path(os.getenv("DB_PATH", Path(__file__).with_name("cscm.db")))


def get_db() -> sqlite3.Connection:
    """Open a new SQLite connection with foreign keys enabled and Row access."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_schema() -> None:
    """Create all tables from schema.sql if they don't already exist."""
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    schema_path = Path(__file__).with_name("schema.sql")
    with get_db() as conn:
        conn.executescript(schema_path.read_text())
    _migrate_schema()


def _migrate_schema() -> None:
    """Add columns introduced after initial deploy (non-destructive, idempotent)."""
    with get_db() as conn:
        server_cols = {row[1] for row in conn.execute("PRAGMA table_info(servers)").fetchall()}
        if "loader_version" not in server_cols:
            conn.execute("ALTER TABLE servers ADD COLUMN loader_version TEXT")
        if "local_only" not in server_cols:
            conn.execute("ALTER TABLE servers ADD COLUMN local_only INTEGER NOT NULL DEFAULT 0")
        if "tunnel_error" not in server_cols:
            conn.execute("ALTER TABLE servers ADD COLUMN tunnel_error TEXT")
        if "dns_error" not in server_cols:
            conn.execute("ALTER TABLE servers ADD COLUMN dns_error TEXT")
        if "owner_id" not in server_cols:
            conn.execute("ALTER TABLE servers ADD COLUMN owner_id INTEGER")
            # servers from before user ownership belong to the first account
            # (the users table lives in this file in the default setup)
            try:
                conn.execute("UPDATE servers SET owner_id = (SELECT MIN(id) FROM users) WHERE owner_id IS NULL")
            except sqlite3.OperationalError:
                pass
        if "eula_accepted_at" not in server_cols:
            conn.execute("ALTER TABLE servers ADD COLUMN eula_accepted_at TEXT")
            # servers from before explicit acceptance were already running with
            # EULA=TRUE; treat them as accepted when they were created
            conn.execute("UPDATE servers SET eula_accepted_at = createdat WHERE eula_accepted_at IS NULL")
        if "eula_accepted_by" not in server_cols:
            conn.execute("ALTER TABLE servers ADD COLUMN eula_accepted_by INTEGER")


def fetch_server(server_id: int) -> sqlite3.Row | None:
    with get_db() as conn:
        return conn.execute("SELECT * FROM servers WHERE id = ?", (server_id,)).fetchone()
