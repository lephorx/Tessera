"""The cloud connector runs relayed requests as the right local user and only on allowed routes."""

import base64
import json
import queue
import tempfile
import threading
import time
import unittest
from datetime import UTC, datetime
from pathlib import Path

from flask import Flask, Response, g, jsonify, request
from websockets.exceptions import ConnectionClosed
from websockets.sync.server import serve

import auth_manager
import cloud_connector
from auth_helpers import authorize, require_admin


def make_app() -> Flask:
    app = Flask(__name__)

    @app.get("/api/whoami")
    def whoami():
        err = authorize()
        if err:
            return err
        return jsonify({"user": g.current_user, "headers": {k.lower(): v for k, v in request.headers.items()}})

    @app.post("/api/echo")
    def echo():
        err = authorize()
        if err:
            return err
        return jsonify({"body": request.get_data(as_text=True), "query": request.args.get("q")})

    @app.put("/api/settings")
    def settings():
        err = require_admin()
        if err:
            return err
        return jsonify({"ok": True})

    @app.get("/api/stream")
    def stream():
        def gen():
            for i in range(3):
                yield f"data: {i}\n\n"
        return Response(gen(), mimetype="text/event-stream")

    @app.get("/api/big")
    def big():
        return Response(b"x" * (2 * 1024 * 1024 + 5), mimetype="application/octet-stream")

    return app


class FakeCloud:
    """Accepts the agent socket and lets the test send requests over it."""

    def __init__(self):
        self.frames: queue.Queue = queue.Queue()
        self.conn = None
        self.connected = threading.Event()
        self.auth = None
        self.server = serve(self._handler, "127.0.0.1", 0)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.url = f"ws://127.0.0.1:{self.server.socket.getsockname()[1]}/agent"

    def _handler(self, conn):
        self.auth = conn.request.headers.get("Authorization")
        self.conn = conn
        self.connected.set()
        try:
            for message in conn:
                self.frames.put(json.loads(message))
        except ConnectionClosed:
            pass

    def next_frame(self, rid=None, timeout=5):
        end = time.time() + timeout
        while time.time() < end:
            frame = self.frames.get(timeout=end - time.time())
            if rid is None or frame.get("id") == rid:
                return frame
        raise TimeoutError

    def request(self, rid, method, path, user="cloud-1", username="alex", role="member", body=None, headers=None):
        frame = {
            "type": "request", "id": rid, "method": method, "path": path,
            "headers": {"x-cscm-user": user, "x-cscm-username": username, "x-cscm-role": role, **(headers or {})},
        }
        if body is not None:
            frame.update(body=base64.b64encode(body.encode()).decode(), encoding="base64")
        self.conn.send(json.dumps(frame))

    def read_body(self, rid) -> tuple[dict, bytes]:
        head = self.next_frame(rid)
        if head["type"] != "response":
            return head, b""
        if not head.get("stream"):
            raw = head.get("body", "")
            return head, base64.b64decode(raw) if head.get("encoding") == "base64" else raw.encode()
        data = b""
        while True:
            f = self.next_frame(rid)
            if f["type"] == "end":
                return head, data
            data += base64.b64decode(f["data"]) if f.get("encoding") == "base64" else f["data"].encode()

    def close(self):
        self.server.shutdown()


class CloudConnectorTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.original_db_path = auth_manager.AUTH_DB_PATH
        auth_manager.AUTH_DB_PATH = Path(self.temp_dir.name) / "auth.db"
        auth_manager.initialize_auth_storage()
        cloud_connector.init_storage()
        with auth_manager._connect() as conn:
            cur = conn.execute(
                "INSERT INTO users (username, password_hash, totp_secret, is_admin, created_at) VALUES ('admin', 'x', 'x', 1, ?)",
                (datetime.now(UTC).isoformat(),),
            )
            self.admin_id = cur.lastrowid

        self.cloud = FakeCloud()
        auth_manager.set_config_json(cloud_connector.LINK_KEY, {
            "cloud_url": "http://cloud.test", "machine_id": "m1", "credential": "cred-123",
            "agent_url": self.cloud.url, "paired_at": "now",
        })
        # the test routes aren't member routes; the tests about the switch turn it off again
        cloud_connector.set_remote_admin_allowed(True)
        self.connector = cloud_connector.CloudConnector(make_app())
        self.connector.start()
        self.assertTrue(self.cloud.connected.wait(5))
        self.hello = self.cloud.next_frame()

    def tearDown(self):
        self.connector.stop()
        self.cloud.close()
        auth_manager.AUTH_DB_PATH = self.original_db_path
        self.temp_dir.cleanup()

    def test_connects_with_credential_and_says_hello(self):
        self.assertEqual(self.cloud.auth, "Bearer cred-123")
        self.assertEqual(self.hello["type"], "hello")
        self.assertEqual(self.hello["protocol"], 1)

    def test_new_cloud_user_gets_own_local_account(self):
        self.cloud.request("r1", "GET", "/api/whoami", user="cloud-9", username="alex", role="member")
        head, body = self.cloud.read_body("r1")
        self.assertEqual(head["status"], 200)
        data = json.loads(body)
        self.assertEqual(data["user"]["username"], "alex")
        self.assertFalse(data["user"]["is_admin"])
        # the cloud's identity headers never reach the route
        self.assertNotIn("x-cscm-user", data["headers"])

        # same cloud user, now admin in the cloud → same local account, admin
        self.cloud.request("r2", "GET", "/api/whoami", user="cloud-9", username="alex", role="admin")
        data2 = json.loads(self.cloud.read_body("r2")[1])
        self.assertEqual(data2["user"]["id"], data["user"]["id"])
        self.assertTrue(data2["user"]["is_admin"])

    def test_owner_is_linked_to_the_local_admin(self):
        cloud_connector.link_cloud_user("cloud-owner", "ramon", self.admin_id)
        self.cloud.request("r1", "GET", "/api/whoami", user="cloud-owner", username="ramon", role="admin")
        data = json.loads(self.cloud.read_body("r1")[1])
        self.assertEqual(data["user"]["id"], self.admin_id)
        self.assertEqual(data["user"]["username"], "admin")

    def test_username_clash_gets_a_suffix(self):
        self.cloud.request("r1", "GET", "/api/whoami", user="cloud-x", username="admin")
        data = json.loads(self.cloud.read_body("r1")[1])
        self.assertEqual(data["user"]["username"], "admin-cloud")

    def test_body_and_query_are_passed_on(self):
        self.cloud.request("r1", "POST", "/api/echo?q=hi", body='{"a":1}', headers={"content-type": "application/json"})
        data = json.loads(self.cloud.read_body("r1")[1])
        self.assertEqual(data, {"body": '{"a":1}', "query": "hi"})

    def test_sensitive_writes_need_remote_admin(self):
        cloud_connector.set_remote_admin_allowed(False)
        self.cloud.request("r1", "PUT", "/api/settings", role="admin", body="{}")
        refused = self.cloud.next_frame("r1")
        self.assertEqual(refused["type"], "error")
        self.assertEqual(refused["status"], 403)

        cloud_connector.set_remote_admin_allowed(True)
        self.cloud.request("r2", "PUT", "/api/settings", role="admin", body="{}")
        self.assertEqual(self.cloud.read_body("r2")[0]["status"], 200)

    def test_encoded_paths_are_checked_decoded(self):
        # S3: /api/cl%6Fud/... is /api/cloud/... once Flask decodes it
        cloud_connector.set_remote_admin_allowed(False)
        for rid, path in [
            ("a", "/api/cl%6Fud/settings"), ("b", "/api/%75sers"), ("c", "/api/%73ettings"),
            ("d", "/api/servers/1/../../users"), ("e", "/api/servers/%2e%2e/users"),
            ("f", "/api/%2575sers"), ("g", "/api/servers/1/files%3Fpath=x"), ("h", "/api//users"),
        ]:
            self.cloud.request(rid, "PUT", path, role="admin", body="{}")
            frame = self.cloud.next_frame(rid)
            self.assertEqual((frame["type"], frame["status"]), ("error", 403), path)

    def test_normalize_path(self):
        n = cloud_connector.normalize_path
        self.assertEqual(n("/api/cl%6Fud/settings"), "/api/cloud/settings")
        self.assertEqual(n("/api/servers/3/start"), "/api/servers/3/start")
        for bad in ("/api/%2575sers", "/api/a/../b", "/api/./x", "/api//x", "/api/a%5Cb", "/api/a b", "api/x", "/api/%ff"):
            self.assertIsNone(n(bad), bad)
        # anything not already normalized is refused by the check itself
        self.assertIsNotNone(cloud_connector.check_route("GET", "/api/%75sers"))

    def test_without_remote_admin_only_member_routes(self):
        # Q5: no console, files, players, backups etc. for anyone without the switch
        cloud_connector.set_remote_admin_allowed(False)
        check = cloud_connector.check_route
        for method, path in [
            ("GET", "/api/servers/1/console/stream"), ("POST", "/api/servers/1/command"),
            ("GET", "/api/servers/1/logs"), ("GET", "/api/servers/1/files"),
            ("GET", "/api/servers/1/files/download"), ("PUT", "/api/servers/1/files/content"),
            ("POST", "/api/servers/1/files/upload"), ("GET", "/api/servers/1/backups/2/download"),
            ("POST", "/api/servers/1/players/alex/op"), ("PATCH", "/api/servers/1/properties"),
            ("GET", "/api/settings"), ("GET", "/api/users"), ("POST", "/api/system/update"),
            ("DELETE", "/api/servers/1"), ("GET", "/api/whoami"),
        ]:
            self.assertIsNotNone(check(method, path), f"{method} {path}")
        for method, path in [
            ("GET", "/api/servers"), ("GET", "/api/servers/1"), ("HEAD", "/api/servers/1"),
            ("POST", "/api/servers/1/start"), ("POST", "/api/servers/from-pack"),
            ("PUT", "/api/servers/1/pack"), ("GET", "/api/auth/me"),
        ]:
            self.assertIsNone(check(method, path), f"{method} {path}")
        # a relayed request is refused before it reaches the app
        self.cloud.request("r1", "GET", "/api/whoami", role="admin")
        self.assertEqual(self.cloud.next_frame("r1")["status"], 403)

        cloud_connector.set_remote_admin_allowed(True)
        self.assertIsNone(check("GET", "/api/servers/1/console/stream"))
        self.assertIsNone(check("GET", "/api/servers/1/files"))
        # still never: the link itself and sign-in
        self.assertIsNotNone(check("PUT", "/api/cloud/settings"))
        self.assertIsNotNone(check("POST", "/api/auth/login"))

    def test_cloud_and_sign_in_routes_are_refused(self):
        for rid, method, path in [("a", "DELETE", "/api/cloud"), ("b", "POST", "/api/auth/login"), ("c", "GET", "/etc/passwd")]:
            self.cloud.request(rid, method, path, role="admin")
            self.assertEqual(self.cloud.next_frame(rid)["type"], "error")
        entries = cloud_connector.audit_entries()
        self.assertEqual(len(entries), 3)
        self.assertTrue(all(e["status"] == 403 for e in entries))

    def test_event_streams_and_big_responses_are_streamed(self):
        self.cloud.request("s", "GET", "/api/stream")
        head, body = self.cloud.read_body("s")
        self.assertTrue(head["stream"])
        self.assertEqual(body, b"data: 0\n\ndata: 1\n\ndata: 2\n\n")

        self.cloud.request("b", "GET", "/api/big")
        head, body = self.cloud.read_body("b")
        self.assertTrue(head["stream"])
        self.assertEqual(len(body), 2 * 1024 * 1024 + 5)

    def test_removed_machine_forgets_the_link(self):
        self.cloud.conn.close(4001, "machine removed from account")
        deadline = time.time() + 5
        while cloud_connector.get_link() is not None and time.time() < deadline:
            time.sleep(0.05)
        self.assertIsNone(cloud_connector.get_link())
        self.assertFalse(self.connector.connected)


if __name__ == "__main__":
    unittest.main()
