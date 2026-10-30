"""Tessera Cloud connector: manage this CSCM from the cloud dashboard and the launcher.

Optional. Without a link CSCM works exactly as before. With one, it keeps a single
outbound WebSocket to the cloud (no port forwarding) and runs the API requests the
cloud relays to it against this Flask app.

Pairing (Settings → Cloud → Connect):
  1. POST <cloud>/api/pairing           → a code like "KX7-42P" to enter in the cloud account
  2. POST <cloud>/api/pairing/exchange  (polled) → the machine credential, once the code is claimed
  3. wss://<cloud>/agent with that credential, kept open with reconnect and backoff

Who is calling: the cloud names the caller in x-cscm-user / x-cscm-role on each relayed
request. Those headers are only read here, from the socket, never from plain HTTP. The
caller is mapped to a local user (cloud_users) and the request runs with a short-lived
local token for that user, so every existing permission check applies unchanged. The
account that claimed the pairing code is linked to the local admin who started pairing;
everyone else gets a local account of their own on first use.

Frames: see cloud/src/relay/protocol.ts in the CSCM-Launcher repo.
"""

import base64
import json
import os
import random
import secrets
import socket
import sqlite3
import threading
import time
from contextlib import closing
from datetime import UTC, datetime
from urllib.parse import urlsplit

import pyotp
import requests
from websockets.exceptions import ConnectionClosed, InvalidStatus
from websockets.sync.client import connect
from werkzeug.security import generate_password_hash
from werkzeug.test import EnvironBuilder, run_wsgi_app

import auth_manager
import update_manager
from logger import get_logger

log = get_logger("cloud")

PROTOCOL = 1
LINK_KEY = "cloud_link"
REMOTE_ADMIN_KEY = "cloud_allow_remote_admin"
DEFAULT_CLOUD_URL = os.getenv("TESSERA_CLOUD_URL", "").rstrip("/")

# Responses up to this size go in one frame; bigger or open-ended ones (console, downloads) are streamed.
STREAM_THRESHOLD = 1024 * 1024
CHUNK_SIZE = 256 * 1024
MAX_FRAME = 16 * 1024 * 1024
# Close codes from the cloud
CLOSE_REMOVED = 4001

HOP_BY_HOP = {"connection", "keep-alive", "transfer-encoding", "content-length", "upgrade"}


# ── storage ────────────────────────────────────────────────────────────────

def init_storage() -> None:
    with closing(auth_manager._connect()) as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS cloud_users (
                cloud_user_id  TEXT PRIMARY KEY,
                user_id        INTEGER NOT NULL UNIQUE,
                cloud_username TEXT NOT NULL,
                -- 1 = account created for this cloud user; its admin flag follows the cloud role.
                -- 0 = linked to an existing local account, left as it is.
                managed        INTEGER NOT NULL DEFAULT 1,
                created_at     TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS cloud_audit_log (
                id             INTEGER PRIMARY KEY AUTOINCREMENT,
                at             TEXT NOT NULL,
                cloud_user_id  TEXT,
                username       TEXT,
                method         TEXT NOT NULL,
                path           TEXT NOT NULL,
                status         INTEGER NOT NULL
            );
            """
        )
        conn.commit()


def get_link() -> dict | None:
    return auth_manager.get_config_json(LINK_KEY)


def remote_admin_allowed() -> bool:
    return auth_manager.get_config_value(REMOTE_ADMIN_KEY, "0") == "1"


def set_remote_admin_allowed(allowed: bool) -> None:
    auth_manager.set_config_value(REMOTE_ADMIN_KEY, "1" if allowed else "0")


def audit(cloud_user_id: str | None, username: str | None, method: str, path: str, status: int) -> None:
    with closing(auth_manager._connect()) as conn:
        conn.execute(
            "INSERT INTO cloud_audit_log (at, cloud_user_id, username, method, path, status) VALUES (?, ?, ?, ?, ?, ?)",
            (datetime.now(UTC).isoformat(), cloud_user_id, username, method, path, status),
        )
        # keep the last 5000 entries
        conn.execute("DELETE FROM cloud_audit_log WHERE id <= (SELECT MAX(id) FROM cloud_audit_log) - 5000")
        conn.commit()


def audit_entries(limit: int = 200) -> list[dict]:
    with closing(auth_manager._connect()) as conn:
        rows = conn.execute(
            "SELECT at, username, method, path, status FROM cloud_audit_log ORDER BY id DESC LIMIT ?", (limit,)
        ).fetchall()
    return [dict(r) for r in rows]


# ── identity ───────────────────────────────────────────────────────────────

def link_cloud_user(cloud_user_id: str, cloud_username: str, user_id: int) -> None:
    """Map a cloud account to an existing local account (the admin who paired the machine)."""
    with closing(auth_manager._connect()) as conn:
        conn.execute("DELETE FROM cloud_users WHERE cloud_user_id = ? OR user_id = ?", (cloud_user_id, user_id))
        conn.execute(
            "INSERT INTO cloud_users (cloud_user_id, user_id, cloud_username, managed, created_at) VALUES (?, ?, ?, 0, ?)",
            (cloud_user_id, user_id, cloud_username, datetime.now(UTC).isoformat()),
        )
        conn.commit()


def _free_username(conn: sqlite3.Connection, wanted: str) -> str:
    base = "".join(ch for ch in wanted if ch.isalnum() or ch in "_-")[:24] or "cloud"
    if len(base) < 3:
        base = f"{base}-cloud"
    candidates = [base, f"{base}-cloud"] + [f"{base}-cloud{i}" for i in range(2, 100)]
    for name in candidates:
        if not conn.execute("SELECT 1 FROM users WHERE username = ?", (name,)).fetchone():
            return name
    return f"{base}-{secrets.token_hex(3)}"


def resolve_user(cloud_user_id: str, cloud_username: str, role: str) -> dict:
    """The local user a relayed request runs as. Creates one on first use."""
    want_admin = role == "admin"
    with closing(auth_manager._connect()) as conn:
        row = conn.execute(
            "SELECT user_id, managed FROM cloud_users WHERE cloud_user_id = ?", (cloud_user_id,)
        ).fetchone()

    if row:
        user = auth_manager.get_user(int(row["user_id"]))
        if user:
            if row["managed"] and user["is_admin"] != want_admin:
                try:
                    auth_manager.set_user_admin(user["id"], want_admin)
                except ValueError:
                    pass  # the last local admin keeps admin rights
                user = auth_manager.get_user(user["id"]) or user
            return user
        # the local account was deleted: start over
        with closing(auth_manager._connect()) as conn:
            conn.execute("DELETE FROM cloud_users WHERE cloud_user_id = ?", (cloud_user_id,))
            conn.commit()

    with closing(auth_manager._connect()) as conn:
        try:
            conn.execute("BEGIN IMMEDIATE")
            username = _free_username(conn, cloud_username)
            now = datetime.now(UTC).isoformat()
            # No usable password: this account can only be used through the cloud.
            cursor = conn.execute(
                "INSERT INTO users (username, password_hash, totp_secret, is_admin, created_at) VALUES (?, ?, ?, ?, ?)",
                (username, generate_password_hash(secrets.token_urlsafe(32)), pyotp.random_base32(), int(want_admin), now),
            )
            conn.execute(
                "INSERT INTO cloud_users (cloud_user_id, user_id, cloud_username, managed, created_at) VALUES (?, ?, ?, 1, ?)",
                (cloud_user_id, cursor.lastrowid, cloud_username, now),
            )
            conn.commit()
            log.info("Created local user %s for cloud user %s (%s)", username, cloud_username, role)
        except sqlite3.IntegrityError:
            conn.rollback()  # a concurrent request created it first
    with closing(auth_manager._connect()) as conn:
        row = conn.execute("SELECT user_id FROM cloud_users WHERE cloud_user_id = ?", (cloud_user_id,)).fetchone()
    return auth_manager.get_user(int(row["user_id"]))


# ── what the cloud may call ────────────────────────────────────────────────

READ_METHODS = {"GET", "HEAD", "OPTIONS"}
# Writes here need "Allow remote admin": secrets, accounts, updating CSCM itself.
SENSITIVE_PREFIXES = ("/api/settings", "/api/users", "/api/system/update")


def check_route(method: str, path: str) -> str | None:
    """None if the cloud may call this route, otherwise why not."""
    if not path.startswith("/api/") or ".." in path:
        return "Only API routes can be called through the cloud."
    if path == "/api/cloud" or path.startswith("/api/cloud/"):
        return "The cloud connection can only be changed on this machine."
    if path.startswith("/api/auth/"):
        if method == "GET" and path in ("/api/auth/me", "/api/auth/status"):
            return None
        return "Sign-in routes can't be called through the cloud."
    if method not in READ_METHODS and path.startswith(SENSITIVE_PREFIXES) and not remote_admin_allowed():
        return "Turn on \"Allow remote admin\" in this machine's Cloud settings first."
    return None


# ── the connector ──────────────────────────────────────────────────────────

class CloudConnector:
    def __init__(self, app):
        self.app = app
        self._lock = threading.Lock()
        self._send_lock = threading.Lock()
        self._ws = None
        self._thread: threading.Thread | None = None
        self._stop = threading.Event()
        self._cancelled: set[str] = set()
        self.connected = False
        self.last_error: str | None = None
        self.pairing: dict | None = None

    # ── status, pairing, unlinking ──

    def status(self) -> dict:
        link = get_link()
        pairing = self.pairing
        return {
            "linked": link is not None,
            "connected": self.connected,
            "cloud_url": link["cloud_url"] if link else DEFAULT_CLOUD_URL or None,
            "machine_id": link["machine_id"] if link else None,
            "paired_at": link["paired_at"] if link else None,
            "last_error": self.last_error,
            "allow_remote_admin": remote_admin_allowed(),
            "pairing": {k: pairing[k] for k in ("code", "expires_at", "error")} if pairing else None,
        }

    def start_pairing(self, cloud_url: str, user_id: int) -> dict:
        cloud_url = cloud_url.rstrip("/")
        parts = urlsplit(cloud_url)
        if parts.scheme not in ("http", "https") or not parts.netloc:
            raise ValueError("Enter the cloud address, e.g. https://cloud.example.com")
        if get_link():
            raise RuntimeError("Already connected. Disconnect first.")

        hint = os.getenv("CSCM_MACHINE_NAME") or socket.gethostname()
        resp = requests.post(
            f"{cloud_url}/api/pairing",
            json={"machine_hint": hint[:64], "version": update_manager.current_version()},
            timeout=15,
        )
        if resp.status_code != 201:
            raise RuntimeError(f"The cloud refused the pairing request ({resp.status_code}).")
        data = resp.json()
        pairing = {
            "code": data["code"],
            "secret": data["secret"],
            "expires_at": int(time.time()) + int(data["expires_in"]),
            "cloud_url": cloud_url,
            "user_id": user_id,
            "error": None,
        }
        self.pairing = pairing
        threading.Thread(target=self._poll_pairing, args=(pairing,), name="cloud-pairing", daemon=True).start()
        log.info("Pairing started with %s: code %s", cloud_url, data["code"])
        return self.status()

    def cancel_pairing(self) -> None:
        self.pairing = None

    def _poll_pairing(self, pairing: dict) -> None:
        while self.pairing is pairing:
            time.sleep(3)
            if self.pairing is not pairing:
                return
            if time.time() > pairing["expires_at"]:
                pairing["error"] = "The code expired. Start again."
                return
            try:
                resp = requests.post(
                    f"{pairing['cloud_url']}/api/pairing/exchange",
                    json={"code": pairing["code"], "secret": pairing["secret"]},
                    timeout=15,
                )
            except requests.RequestException as exc:
                log.warning("Pairing poll failed: %s", exc)
                continue
            if resp.status_code == 202:
                continue
            if resp.status_code != 200:
                pairing["error"] = f"Pairing failed ({resp.json().get('error', resp.status_code)})."
                return

            data = resp.json()
            auth_manager.set_config_json(LINK_KEY, {
                "cloud_url": pairing["cloud_url"],
                "machine_id": data["machine_id"],
                "credential": data["credential"],
                "agent_url": data["agent_url"],
                "paired_at": datetime.now(UTC).isoformat(),
            })
            owner = data.get("owner")
            if owner:
                link_cloud_user(owner["id"], owner["username"], pairing["user_id"])
            log.info("Paired with %s as machine %s", pairing["cloud_url"], data["machine_id"])
            self.pairing = None
            self.start()
            return

    def unlink(self) -> None:
        """Forget the cloud: stop the socket and drop the credential. The cloud shows the machine offline."""
        auth_manager.delete_config_value(LINK_KEY)
        self.stop()
        self.last_error = None
        log.info("Disconnected from the cloud")

    # ── connection ──

    def start(self) -> None:
        with self._lock:
            if self._thread and self._thread.is_alive():
                return
            if not get_link():
                return
            self._stop.clear()
            self._thread = threading.Thread(target=self._run, name="cloud-connector", daemon=True)
            self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        ws = self._ws
        if ws is not None:
            try:
                ws.close()
            except Exception:
                pass
        thread = self._thread
        if thread and thread is not threading.current_thread():
            thread.join(timeout=5)

    def _run(self) -> None:
        backoff = 1.0
        while not self._stop.is_set():
            link = get_link()
            if not link:
                return
            close_code = None
            try:
                with connect(
                    link["agent_url"],
                    additional_headers={"Authorization": f"Bearer {link['credential']}"},
                    max_size=MAX_FRAME,
                    open_timeout=15,
                ) as ws:
                    self._ws = ws
                    self.connected = True
                    self.last_error = None
                    backoff = 1.0
                    log.info("Connected to %s", link["cloud_url"])
                    self._send({
                        "type": "hello",
                        "version": update_manager.current_version(),
                        "protocol": PROTOCOL,
                        "capabilities": [],
                    })
                    try:
                        for message in ws:
                            if isinstance(message, str):
                                self._on_frame(message)
                    except ConnectionClosed:
                        pass
                    close_code = ws.close_code
            except InvalidStatus as exc:
                if exc.response.status_code == 401:
                    close_code = CLOSE_REMOVED
                else:
                    self.last_error = f"The cloud answered {exc.response.status_code}."
            except (OSError, TimeoutError) as exc:
                self.last_error = f"Can't reach the cloud: {exc}"
            except Exception as exc:  # keep the connector alive whatever happens
                log.exception("Cloud connection failed")
                self.last_error = str(exc)
            finally:
                self._ws = None
                self.connected = False

            if close_code == CLOSE_REMOVED:
                log.warning("This machine was removed from its cloud account; forgetting the link")
                auth_manager.delete_config_value(LINK_KEY)
                self.last_error = "This machine was removed from the cloud account."
                return
            if self._stop.is_set():
                return
            if self.last_error:
                log.warning("%s Retrying in %.0f s", self.last_error, backoff)
            self._stop.wait(backoff + random.uniform(0, backoff / 2))
            backoff = min(backoff * 2, 60.0)

    def _send(self, frame: dict) -> None:
        ws = self._ws
        if ws is None:
            raise ConnectionError("not connected")
        data = json.dumps(frame, separators=(",", ":"))
        with self._send_lock:
            ws.send(data)

    def _on_frame(self, raw: str) -> None:
        try:
            frame = json.loads(raw)
        except json.JSONDecodeError:
            return
        kind = frame.get("type")
        if kind == "request" and isinstance(frame.get("id"), str):
            threading.Thread(target=self._handle_request, args=(frame,), name="cloud-request", daemon=True).start()
        elif kind == "cancel":
            self._cancelled.add(str(frame.get("id")))

    # ── relayed requests ──

    def _handle_request(self, frame: dict) -> None:
        rid = frame["id"]
        try:
            self._execute(frame)
        except ConnectionError:
            pass  # socket gone; the cloud already failed the request
        except Exception as exc:
            log.exception("Relayed request failed: %s %s", frame.get("method"), frame.get("path"))
            try:
                self._send({"type": "error", "id": rid, "status": 500, "message": f"CSCM error: {exc}"})
            except Exception:
                pass
        finally:
            self._cancelled.discard(rid)

    def _execute(self, frame: dict) -> None:
        rid = frame["id"]
        method = str(frame.get("method", "GET")).upper()
        full_path = str(frame.get("path", ""))
        path, _, query = full_path.partition("?")

        headers = {str(k).lower(): str(v) for k, v in (frame.get("headers") or {}).items()}
        cloud_user_id = headers.pop("x-cscm-user", None)
        cloud_username = headers.pop("x-cscm-username", "") or "cloud"
        role = headers.pop("x-cscm-role", "member")
        for name in list(headers):
            if name.startswith("x-cscm-") or name in ("authorization", "cookie", "host"):
                headers.pop(name)

        if not cloud_user_id:
            self._send({"type": "error", "id": rid, "status": 400, "message": "Missing caller."})
            return
        user = resolve_user(cloud_user_id, cloud_username, role)
        refused = check_route(method, path)
        if refused:
            audit(cloud_user_id, user["username"], method, path, 403)
            self._send({"type": "error", "id": rid, "status": 403, "message": refused})
            return

        token, _ = auth_manager.issue_jwt(user["id"], user["username"])
        headers["authorization"] = f"Bearer {token}"

        body = None
        if frame.get("body") is not None:
            raw = frame["body"]
            body = base64.b64decode(raw) if frame.get("encoding") == "base64" else raw.encode()

        environ = EnvironBuilder(
            path=path,
            query_string=query,
            method=method,
            headers=headers,
            data=body,
            environ_base={"REMOTE_ADDR": "tessera-cloud"},
        ).get_environ()
        app_iter, status, resp_headers = run_wsgi_app(self.app, environ, buffered=False)
        status_code = int(status.split(" ", 1)[0])
        out_headers = {k.lower(): v for k, v in resp_headers.items() if k.lower() not in HOP_BY_HOP}
        audit(cloud_user_id, user["username"], method, path, status_code)

        try:
            length = resp_headers.get("Content-Length")
            if length is not None and int(length) <= STREAM_THRESHOLD:
                data = b"".join(app_iter)
                frame_out = {"type": "response", "id": rid, "status": status_code, "headers": out_headers}
                try:
                    frame_out.update(body=data.decode("utf-8"), encoding="utf8")
                except UnicodeDecodeError:
                    frame_out.update(body=base64.b64encode(data).decode(), encoding="base64")
                self._send(frame_out)
                return

            self._send({"type": "response", "id": rid, "status": status_code, "headers": out_headers, "stream": True})
            # Server-sent events go out as they come; downloads are sent in bigger pieces.
            live = out_headers.get("content-type", "").startswith("text/event-stream")
            buffer = bytearray()

            def flush(upto: int) -> None:
                while len(buffer) >= upto and buffer:
                    piece_out = bytes(buffer[:CHUNK_SIZE])
                    del buffer[:CHUNK_SIZE]
                    self._send({"type": "chunk", "id": rid, "data": base64.b64encode(piece_out).decode(), "encoding": "base64"})

            for piece in app_iter:
                if rid in self._cancelled:
                    return
                buffer += piece
                flush(1 if live else CHUNK_SIZE)
            flush(1)
            self._send({"type": "end", "id": rid})
        finally:
            close = getattr(app_iter, "close", None)
            if close:
                close()


_connector: CloudConnector | None = None


def init(app) -> CloudConnector:
    """Called once from app.py. Reconnects if this machine is already linked."""
    global _connector
    init_storage()
    _connector = CloudConnector(app)
    if os.getenv("CSCM_CLOUD_DISABLED", "").lower() not in ("1", "true", "yes"):
        _connector.start()
    return _connector


def connector() -> CloudConnector:
    if _connector is None:
        raise RuntimeError("cloud_connector.init() was not called")
    return _connector
