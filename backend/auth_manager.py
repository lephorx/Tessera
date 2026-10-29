import base64
import io
import json
import os
import secrets
import sqlite3
from contextlib import closing
from datetime import UTC, datetime, timedelta
from pathlib import Path

import jwt
import pyotp
import qrcode
import qrcode.image.svg
from dotenv import load_dotenv
from werkzeug.security import check_password_hash, generate_password_hash

load_dotenv()

AUTH_DB_PATH = Path(os.getenv("AUTH_DB_PATH", Path(__file__).with_name("auth.db")))
JWT_LIFETIME_HOURS = int(os.getenv("JWT_LIFETIME_HOURS", "8"))
SETUP_TTL_SECONDS = 15 * 60


def _connect() -> sqlite3.Connection:
    connection = sqlite3.connect(AUTH_DB_PATH)
    connection.row_factory = sqlite3.Row
    return connection


def _utcnow() -> datetime:
    return datetime.now(UTC)


def initialize_auth_storage() -> None:
    AUTH_DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with closing(_connect()) as connection:
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL UNIQUE,
                password_hash TEXT NOT NULL,
                totp_secret TEXT NOT NULL,
                created_at TEXT NOT NULL
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS app_config (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS pending_setups (
                token TEXT PRIMARY KEY,
                username TEXT NOT NULL,
                password_hash TEXT NOT NULL,
                totp_secret TEXT NOT NULL,
                expires_at INTEGER NOT NULL
            )
            """
        )
        connection.commit()
    _migrate_auth_schema()

    _get_or_create_config("jwt_secret", secrets.token_urlsafe(64))


def _migrate_auth_schema() -> None:
    with closing(_connect()) as connection:
        user_cols = {row[1] for row in connection.execute("PRAGMA table_info(users)").fetchall()}
        if "is_admin" not in user_cols:
            connection.execute("ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0")
            # installs from before roles: the first account becomes the admin
            connection.execute("UPDATE users SET is_admin = 1 WHERE id = (SELECT MIN(id) FROM users)")
        pending_cols = {row[1] for row in connection.execute("PRAGMA table_info(pending_setups)").fetchall()}
        if "is_admin" not in pending_cols:
            connection.execute("ALTER TABLE pending_setups ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0")
        connection.commit()


def _get_or_create_config(key: str, default_value: str) -> str:
    with closing(_connect()) as connection:
        row = connection.execute(
            "SELECT value FROM app_config WHERE key = ?",
            (key,),
        ).fetchone()
        if row:
            return str(row["value"])

        connection.execute(
            "INSERT OR IGNORE INTO app_config (key, value) VALUES (?, ?)",
            (key, default_value),
        )
        connection.commit()
        row = connection.execute(
            "SELECT value FROM app_config WHERE key = ?",
            (key,),
        ).fetchone()
        return str(row["value"]) if row else default_value


def get_config_value(key: str, default: str | None = None) -> str | None:
    with closing(_connect()) as connection:
        row = connection.execute(
            "SELECT value FROM app_config WHERE key = ?",
            (key,),
        ).fetchone()
    if row is None:
        return default
    return str(row["value"])


def set_config_value(key: str, value: str) -> None:
    with closing(_connect()) as connection:
        connection.execute(
            "INSERT INTO app_config (key, value) VALUES (?, ?)"
            " ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (key, value),
        )
        connection.commit()


def delete_config_value(key: str) -> None:
    with closing(_connect()) as connection:
        connection.execute("DELETE FROM app_config WHERE key = ?", (key,))
        connection.commit()


def get_config_json(key: str, default: dict | list | None = None):
    raw = get_config_value(key)
    if raw is None:
        return default
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return default


def set_config_json(key: str, value) -> None:
    set_config_value(key, json.dumps(value, sort_keys=True))


def has_users() -> bool:
    with closing(_connect()) as connection:
        row = connection.execute("SELECT 1 FROM users LIMIT 1").fetchone()
        return row is not None


def begin_initial_user_setup(username: str, password: str) -> dict:
    normalized_username = username.strip()
    if not normalized_username:
        raise ValueError("Username is required")
    if len(normalized_username) < 3:
        raise ValueError("Username must be at least 3 characters long")
    if len(password) < 12:
        raise ValueError("Password must be at least 12 characters long")
    if has_users():
        raise RuntimeError("Initial setup has already been completed")

    totp_secret = pyotp.random_base32()
    setup_token = secrets.token_urlsafe(32)
    setup_payload = build_totp_setup_payload(normalized_username, totp_secret)
    password_hash = generate_password_hash(password, method="scrypt")
    expires_at = int(_utcnow().timestamp()) + SETUP_TTL_SECONDS

    with closing(_connect()) as connection:
        connection.execute("BEGIN IMMEDIATE")
        if connection.execute("SELECT 1 FROM users LIMIT 1").fetchone():
            raise RuntimeError("Initial setup has already been completed")
        connection.execute("DELETE FROM pending_setups WHERE expires_at <= ?", (int(_utcnow().timestamp()),))
        connection.execute(
            "INSERT INTO pending_setups (token, username, password_hash, totp_secret, expires_at)"
            " VALUES (?, ?, ?, ?, ?)",
            (setup_token, normalized_username, password_hash, totp_secret, expires_at),
        )
        connection.commit()

    return {"setup_token": setup_token, "expires_at": expires_at, **setup_payload}


def complete_initial_user_setup(setup_token: str, otp_code: str) -> dict:
    if not setup_token:
        raise ValueError("Setup session is missing. Start again.")
    if len(otp_code) != 6 or not otp_code.isdigit():
        raise ValueError("Enter the six-digit code from your authenticator app")

    with closing(_connect()) as connection:
        connection.execute("BEGIN IMMEDIATE")
        if connection.execute("SELECT 1 FROM users LIMIT 1").fetchone():
            raise RuntimeError("Initial setup has already been completed")
        pending = connection.execute(
            "SELECT username, password_hash, totp_secret, expires_at"
            " FROM pending_setups WHERE token = ?",
            (setup_token,),
        ).fetchone()
        if pending is None or int(pending["expires_at"]) <= int(_utcnow().timestamp()):
            raise ValueError("Setup session expired. Start again.")
        if not pyotp.TOTP(str(pending["totp_secret"])).verify(otp_code, valid_window=1):
            raise ValueError("Invalid one-time code. Try the current code from your authenticator app.")

        # the account that completes the first-run setup is always an admin
        cursor = connection.execute(
            "INSERT INTO users (username, password_hash, totp_secret, is_admin, created_at) VALUES (?, ?, ?, 1, ?)",
            (pending["username"], pending["password_hash"], pending["totp_secret"], _utcnow().isoformat()),
        )
        connection.execute("DELETE FROM pending_setups")
        connection.commit()

    return {"id": int(cursor.lastrowid), "username": str(pending["username"]), "is_admin": True}


# ── user management ─────────────────────────────────────────────────────────
# Admins see and manage every server, the users and the settings. Other users
# only see and manage the servers they own (servers.owner_id).

def _validate_credentials(username: str, password: str) -> str:
    normalized_username = username.strip()
    if len(normalized_username) < 3:
        raise ValueError("Username must be at least 3 characters long")
    if len(password) < 12:
        raise ValueError("Password must be at least 12 characters long")
    return normalized_username


def _user_dict(row) -> dict:
    return {
        "id": int(row["id"]),
        "username": str(row["username"]),
        "is_admin": bool(row["is_admin"]),
        "created_at": str(row["created_at"]),
    }


def list_users() -> list[dict]:
    with closing(_connect()) as connection:
        rows = connection.execute("SELECT id, username, is_admin, created_at FROM users ORDER BY id").fetchall()
    return [_user_dict(r) for r in rows]


def get_user(user_id: int) -> dict | None:
    with closing(_connect()) as connection:
        row = connection.execute(
            "SELECT id, username, is_admin, created_at FROM users WHERE id = ?", (user_id,)
        ).fetchone()
    return _user_dict(row) if row else None


def count_admins() -> int:
    with closing(_connect()) as connection:
        return int(connection.execute("SELECT COUNT(*) FROM users WHERE is_admin = 1").fetchone()[0])


def primary_admin_id() -> int | None:
    """Owner of servers that have none stored (created via the CLI or before ownership)."""
    with closing(_connect()) as connection:
        row = connection.execute("SELECT MIN(id) FROM users WHERE is_admin = 1").fetchone()
    return int(row[0]) if row and row[0] is not None else None


def set_user_admin(user_id: int, is_admin: bool) -> None:
    with closing(_connect()) as connection:
        connection.execute("BEGIN IMMEDIATE")
        row = connection.execute("SELECT is_admin FROM users WHERE id = ?", (user_id,)).fetchone()
        if row is None:
            raise LookupError("User not found")
        if row["is_admin"] and not is_admin and \
                connection.execute("SELECT COUNT(*) FROM users WHERE is_admin = 1").fetchone()[0] <= 1:
            raise ValueError("The last admin can't lose admin rights")
        connection.execute("UPDATE users SET is_admin = ? WHERE id = ?", (int(is_admin), user_id))
        connection.commit()


def begin_user_enrollment(username: str, password: str, is_admin: bool = False) -> dict:
    """Start adding another user; finished by complete_user_enrollment with a TOTP code."""
    normalized_username = _validate_credentials(username, password)
    totp_secret = pyotp.random_base32()
    setup_token = secrets.token_urlsafe(32)
    now = int(_utcnow().timestamp())
    with closing(_connect()) as connection:
        if connection.execute("SELECT 1 FROM users WHERE username = ?", (normalized_username,)).fetchone():
            raise RuntimeError(f"A user named '{normalized_username}' already exists")
        connection.execute("DELETE FROM pending_setups WHERE expires_at <= ?", (now,))
        connection.execute(
            "INSERT INTO pending_setups (token, username, password_hash, totp_secret, expires_at, is_admin)"
            " VALUES (?, ?, ?, ?, ?, ?)",
            (setup_token, normalized_username, generate_password_hash(password, method="scrypt"),
             totp_secret, now + SETUP_TTL_SECONDS, int(is_admin)),
        )
        connection.commit()
    return {"setup_token": setup_token, **build_totp_setup_payload(normalized_username, totp_secret)}


def complete_user_enrollment(setup_token: str, otp_code: str) -> dict:
    if len(otp_code) != 6 or not otp_code.isdigit():
        raise ValueError("Enter the six-digit code from the authenticator app")
    with closing(_connect()) as connection:
        connection.execute("BEGIN IMMEDIATE")
        pending = connection.execute(
            "SELECT username, password_hash, totp_secret, expires_at, is_admin FROM pending_setups WHERE token = ?",
            (setup_token,),
        ).fetchone()
        if pending is None or int(pending["expires_at"]) <= int(_utcnow().timestamp()):
            raise ValueError("This sign-up expired. Start again.")
        if not pyotp.TOTP(str(pending["totp_secret"])).verify(otp_code, valid_window=1):
            raise ValueError("Invalid one-time code. Try the current code from the authenticator app.")
        if connection.execute("SELECT 1 FROM users WHERE username = ?", (pending["username"],)).fetchone():
            raise RuntimeError(f"A user named '{pending['username']}' already exists")
        cursor = connection.execute(
            "INSERT INTO users (username, password_hash, totp_secret, is_admin, created_at) VALUES (?, ?, ?, ?, ?)",
            (pending["username"], pending["password_hash"], pending["totp_secret"],
             int(pending["is_admin"]), _utcnow().isoformat()),
        )
        connection.execute("DELETE FROM pending_setups WHERE token = ?", (setup_token,))
        connection.commit()
    return {"id": int(cursor.lastrowid), "username": str(pending["username"]), "is_admin": bool(pending["is_admin"])}


def delete_user(user_id: int, current_user_id: int) -> None:
    if user_id == current_user_id:
        raise ValueError("You can't remove your own account")
    with closing(_connect()) as connection:
        connection.execute("BEGIN IMMEDIATE")
        row = connection.execute("SELECT is_admin FROM users WHERE id = ?", (user_id,)).fetchone()
        if row is None:
            raise LookupError("User not found")
        if row["is_admin"] and connection.execute("SELECT COUNT(*) FROM users WHERE is_admin = 1").fetchone()[0] <= 1:
            raise ValueError("The last admin can't be removed")
        connection.execute("DELETE FROM users WHERE id = ?", (user_id,))
        connection.commit()


def change_password(user_id: int, current_password: str, new_password: str) -> None:
    if len(new_password) < 12:
        raise ValueError("The new password must be at least 12 characters long")
    with closing(_connect()) as connection:
        row = connection.execute("SELECT password_hash FROM users WHERE id = ?", (user_id,)).fetchone()
        if row is None or not check_password_hash(str(row["password_hash"]), current_password):
            raise PermissionError("The current password is wrong")
        connection.execute(
            "UPDATE users SET password_hash = ? WHERE id = ?",
            (generate_password_hash(new_password, method="scrypt"), user_id),
        )
        connection.commit()


def build_totp_setup_payload(username: str, totp_secret: str) -> dict:
    issuer = os.getenv("TOTP_ISSUER", "CSCM Tool")
    uri = pyotp.TOTP(totp_secret).provisioning_uri(name=username, issuer_name=issuer)
    image = qrcode.make(uri, image_factory=qrcode.image.svg.SvgImage)
    buffer = io.BytesIO()
    image.save(buffer)
    svg_bytes = buffer.getvalue()
    qr_code_data_uri = "data:image/svg+xml;base64," + base64.b64encode(svg_bytes).decode("ascii")
    return {
        "totp_secret": totp_secret,
        "totp_uri": uri,
        "qr_code_data_uri": qr_code_data_uri,
    }


def authenticate_user(username: str, password: str, otp_code: str) -> dict | None:
    normalized_username = username.strip()
    with closing(_connect()) as connection:
        row = connection.execute(
            "SELECT id, username, password_hash, totp_secret, is_admin FROM users WHERE username = ?",
            (normalized_username,),
        ).fetchone()

    if row is None:
        return None
    if not check_password_hash(str(row["password_hash"]), password):
        return None

    totp = pyotp.TOTP(str(row["totp_secret"]))
    if not totp.verify(otp_code.strip(), valid_window=1):
        return None

    return {
        "id": int(row["id"]),
        "username": str(row["username"]),
        "is_admin": bool(row["is_admin"]),
    }


def issue_jwt(user_id: int, username: str) -> tuple[str, int]:
    expires_at = _utcnow() + timedelta(hours=JWT_LIFETIME_HOURS)
    payload = {
        "sub": str(user_id),
        "username": username,
        "iat": int(_utcnow().timestamp()),
        "exp": int(expires_at.timestamp()),
    }
    token = jwt.encode(payload, _get_or_create_config("jwt_secret", secrets.token_urlsafe(64)), algorithm="HS256")
    return token, int(expires_at.timestamp())


def verify_jwt(token: str) -> dict | None:
    import logging as _logging
    _log = _logging.getLogger("cscm.api")
    try:
        payload = jwt.decode(
            token,
            _get_or_create_config("jwt_secret", secrets.token_urlsafe(64)),
            algorithms=["HS256"],
        )
    except jwt.PyJWTError as exc:
        _log.warning("JWT verification failed: %s: %s", type(exc).__name__, exc)
        return None

    # Read the account on every request, so removing a user or changing
    # their admin rights applies right away instead of when the token expires.
    user = get_user(int(payload["sub"]))
    if user is None:
        _log.warning("JWT for a removed user: id=%s", payload["sub"])
        return None
    return {"id": user["id"], "username": user["username"], "is_admin": user["is_admin"]}
