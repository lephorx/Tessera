"""Default players and global bans, per CSCM user.

Every new server of a user starts with their default whitelist and
operators, and with everyone on their global ban list. Banning a player on
one server bans them on all of that user's other servers too. Unbanning is
per server; removing a player from the global list only stops future bans.

Running Java servers get the change over RCON. Stopped (or not yet started)
servers get it written into whitelist.json / ops.json / banned-players.json,
which needs the player's UUID: from Mojang for online-mode servers, derived
from the name for offline-mode ones.
"""

import hashlib
import json
import re
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path

import requests

import docker_manager
import player_manager
import properties_manager
from db import get_db
from docker_manager import BEDROCK_TYPES, server_data_dir
from logger import get_logger

log = get_logger("player_lists")

USERNAME_RE = re.compile(r"^[A-Za-z0-9_]{3,16}$")
LISTS = ("whitelist", "ops")
FILES = {"whitelist": "whitelist.json", "ops": "ops.json", "ban": "banned-players.json"}


# ── stored lists ────────────────────────────────────────────────────────────

def get_lists(owner_id: int) -> dict:
    with get_db() as conn:
        players = conn.execute(
            "SELECT list, name FROM default_players WHERE owner_id = ? ORDER BY name COLLATE NOCASE",
            (owner_id,),
        ).fetchall()
        bans = conn.execute(
            "SELECT name, reason, created_at FROM global_bans WHERE owner_id = ? ORDER BY created_at DESC",
            (owner_id,),
        ).fetchall()
    return {
        "whitelist": [p["name"] for p in players if p["list"] == "whitelist"],
        "ops": [p["name"] for p in players if p["list"] == "ops"],
        "bans": [dict(b) for b in bans],
    }


def add_default(owner_id: int, list_name: str, name: str) -> None:
    with get_db() as conn:
        conn.execute("INSERT OR IGNORE INTO default_players (owner_id, list, name) VALUES (?, ?, ?)",
                     (owner_id, list_name, name))


def remove_default(owner_id: int, list_name: str, name: str) -> None:
    with get_db() as conn:
        conn.execute("DELETE FROM default_players WHERE owner_id = ? AND list = ? AND name = ?",
                     (owner_id, list_name, name))


def remove_global_ban(owner_id: int, name: str) -> None:
    with get_db() as conn:
        conn.execute("DELETE FROM global_bans WHERE owner_id = ? AND name = ?", (owner_id, name))


def owner_of(server_id: int) -> int | None:
    with get_db() as conn:
        row = conn.execute("SELECT owner_id FROM servers WHERE id = ?", (server_id,)).fetchone()
    return row["owner_id"] if row else None


def _servers_of(owner_id: int) -> list:
    with get_db() as conn:
        return conn.execute("SELECT id, name, type FROM servers WHERE owner_id = ? ORDER BY id",
                            (owner_id,)).fetchall()


# ── UUIDs ───────────────────────────────────────────────────────────────────

def _offline_uuid(name: str) -> str:
    """The UUID an offline-mode server gives a player (Java's nameUUIDFromBytes)."""
    digest = bytearray(hashlib.md5(f"OfflinePlayer:{name}".encode()).digest())
    digest[6] = (digest[6] & 0x0F) | 0x30
    digest[8] = (digest[8] & 0x3F) | 0x80
    return str(uuid.UUID(bytes=bytes(digest)))


def _mojang_profile(name: str) -> tuple[str, str] | None:
    """(uuid, exact name) of a Minecraft account, or None if there is none."""
    try:
        res = requests.get(f"https://api.mojang.com/users/profiles/minecraft/{name}", timeout=10)
        if res.status_code == 200:
            data = res.json()
            return str(uuid.UUID(data["id"])), data["name"]
    except (requests.RequestException, ValueError, KeyError) as exc:
        log.warning("Mojang lookup failed for %s: %s", name, exc)
    return None


def _online_mode(server_id: int) -> bool:
    # a new server has no server.properties yet; it will get the defaults
    props = properties_manager.read_properties(server_id) or properties_manager.get_default_properties()
    return str(props.get("online-mode", "true")).lower() != "false"


def _profile(server_id: int, name: str) -> tuple[str, str] | None:
    if _online_mode(server_id):
        return _mojang_profile(name)
    return _offline_uuid(name), name


# ── writing to one server ───────────────────────────────────────────────────

def _write_entry(server_id: int, kind: str, name: str, reason: str | None) -> dict:
    """Add a player to a stopped Java server's JSON file."""
    profile = _profile(server_id, name)
    if not profile:
        return {"success": False, "message": f"No Minecraft account is called {name}"}
    player_uuid, exact = profile
    path = Path(server_data_dir(server_id)) / FILES[kind]
    try:
        entries = json.loads(path.read_text()) if path.exists() else []
    except (OSError, json.JSONDecodeError):
        entries = []
    if any(e.get("uuid") == player_uuid or e.get("name", "").lower() == exact.lower() for e in entries):
        return {"success": True, "message": f"{exact} is already on {FILES[kind]}"}
    entry: dict = {"uuid": player_uuid, "name": exact}
    if kind == "ops":
        entry.update(level=4, bypassesPlayerLimit=False)
    elif kind == "ban":
        entry.update(
            created=datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S +0000"),
            source="CSCM", expires="forever", reason=reason or "Banned by an operator.",
        )
    entries.append(entry)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(entries, indent=2))
    return {"success": True, "message": f"Added {exact} to {FILES[kind]}"}


def apply(server_id: int, server_type: str, kind: str, name: str, reason: str | None = None) -> dict:
    """Whitelist, op or ban a player on one server, running or not."""
    if server_type in BEDROCK_TYPES:
        if kind == "whitelist":
            return player_manager.whitelist_add(server_id, name)
        return {"success": False, "message": "Bedrock servers only support the allowlist here"}
    if docker_manager.runtime_status(server_id) in ("running", "healthy", "unhealthy"):
        command = {"whitelist": f"whitelist add {name}", "ops": f"op {name}",
                   "ban": f"ban {name} {reason}" if reason else f"ban {name}"}[kind]
        try:
            return {"success": True, "message": docker_manager.send_rcon(server_id, command)}
        except Exception as exc:
            log.warning("RCON %s failed on server %d, writing the file instead: %s", kind, server_id, exc)
    try:
        return _write_entry(server_id, kind, name, reason)
    except OSError as exc:
        return {"success": False, "message": f"Could not write {FILES[kind]}: {exc}"}


# ── whole lists ─────────────────────────────────────────────────────────────

def seed_new_server(server_id: int, server_type: str, owner_id: int | None) -> None:
    """Write the owner's default players and global bans into a new server
    before it first starts."""
    if owner_id is None:
        return
    lists = get_lists(owner_id)
    if server_type in BEDROCK_TYPES:
        # straight into allowlist.json, without turning the allowlist on
        path = Path(server_data_dir(server_id)) / "allowlist.json"
        if lists["whitelist"]:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps([{"name": n, "ignoresPlayerLimit": False} for n in lists["whitelist"]], indent=2))
        return
    for kind, names in (("whitelist", lists["whitelist"]), ("ops", lists["ops"])):
        for name in names:
            result = _write_entry(server_id, kind, name, None)
            if not result["success"]:
                log.warning("Default player %s skipped on server %d: %s", name, server_id, result["message"])
    for ban in lists["bans"]:
        result = _write_entry(server_id, "ban", ban["name"], ban["reason"])
        if not result["success"]:
            log.warning("Global ban %s skipped on server %d: %s", ban["name"], server_id, result["message"])


def apply_defaults_to_all(owner_id: int) -> list[dict]:
    """Add the default whitelist and operators to every server of a user."""
    lists = get_lists(owner_id)
    report = []
    for server in _servers_of(owner_id):
        failed = []
        for kind in LISTS:
            for name in lists[kind]:
                if kind == "ops" and server["type"] in BEDROCK_TYPES:
                    continue
                result = apply(server["id"], server["type"], kind, name)
                if not result["success"]:
                    failed.append(f"{name}: {result['message']}")
        report.append({"server": server["name"], "failed": failed})
    return report


def ban_everywhere(owner_id: int, name: str, reason: str | None, except_server: int | None = None) -> None:
    """Put a player on the user's global ban list and ban them on all of the
    user's other servers (in the background)."""
    with get_db() as conn:
        conn.execute(
            "INSERT INTO global_bans (owner_id, name, reason) VALUES (?, ?, ?)"
            " ON CONFLICT (owner_id, name) DO UPDATE SET reason = excluded.reason",
            (owner_id, name, reason),
        )

    def run():
        for server in _servers_of(owner_id):
            if server["id"] == except_server or server["type"] in BEDROCK_TYPES:
                continue
            result = apply(server["id"], server["type"], "ban", name, reason)
            log.info("Global ban of %s on server %d: %s", name, server["id"], result["message"])

    threading.Thread(target=run, daemon=True).start()
