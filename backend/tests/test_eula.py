"""Creating a server needs the user's explicit Minecraft EULA acceptance; older servers count as accepted."""

import io
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from flask import Flask, g

import db
import routes.servers as servers
import server_manager


class EulaTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.patches = [mock.patch.object(db, "DB_PATH", Path(self.tmp.name) / "cscm.db")]

        def fake_authorize():
            g.current_user = {"id": 7, "is_admin": True, "username": "admin"}
            return None

        # no Docker, Playit or threads: provisioning is recorded, not run
        self.provisioned = []
        self.patches += [
            mock.patch.object(servers, "authorize", fake_authorize),
            mock.patch.object(servers, "_provision_resources", lambda *a, **kw: self.provisioned.append(a) or {"success": True}),
            mock.patch.object(servers.threading, "Thread", lambda target, daemon: type("T", (), {"start": target})),
        ]
        for p in self.patches:
            p.start()
        db.init_schema()
        app = Flask(__name__)
        app.register_blueprint(servers.servers_bp)
        self.client = app.test_client()

    def tearDown(self):
        for p in self.patches:
            p.stop()
        self.tmp.cleanup()

    def test_create_requires_eula(self):
        for body in ({"name": "a"}, {"name": "a", "eula": False}, {"name": "a", "eula": "yes please"}):
            res = self.client.post("/api/servers", json=body)
            self.assertEqual(res.status_code, 400)
            self.assertTrue(res.json["eula_required"])
            self.assertIn("https://aka.ms/MinecraftEULA", res.json["error"])
        self.assertEqual(self.provisioned, [])

    def test_create_with_eula_stores_acceptance(self):
        res = self.client.post("/api/servers", json={"name": "a", "eula": True, "port": 25570})
        self.assertEqual(res.status_code, 202, res.json)
        with db.get_db() as conn:
            row = conn.execute("SELECT eula_accepted_at, eula_accepted_by FROM servers").fetchone()
        self.assertIsNotNone(row["eula_accepted_at"])
        self.assertEqual(row["eula_accepted_by"], 7)

    def test_from_pack_requires_eula(self):
        res = self.client.post("/api/servers/from-pack", data={"pack": (io.BytesIO(b"x"), "p.mrpack"), "name": "p"},
                               content_type="multipart/form-data")
        self.assertEqual(res.status_code, 400)
        self.assertTrue(res.json["eula_required"])
        # the launcher sends the form field eula="true": past the EULA check,
        # this (not a real) pack is then refused for itself
        for value in ("true", "TRUE", "1", "on"):
            res = self.client.post("/api/servers/from-pack",
                                   data={"pack": (io.BytesIO(b"x"), "p.mrpack"), "name": "p", "eula": value},
                                   content_type="multipart/form-data")
            self.assertEqual(res.status_code, 400)
            self.assertNotIn("eula_required", res.json)
            self.assertIn("Modrinth", res.json["error"])

    def test_json_accepts_string_true(self):
        res = self.client.post("/api/servers", json={"name": "b", "eula": "true", "port": 25572})
        self.assertEqual(res.status_code, 202, res.json)

    def test_record_refuses_without_eula(self):
        res = server_manager._create_server_record("a", "paper", "1.21.4", None, 25571, 2, 4)
        self.assertFalse(res["success"])
        self.assertTrue(res["eula_required"])

    def test_existing_servers_count_as_accepted(self):
        path = Path(self.tmp.name) / "old.db"
        with sqlite3.connect(path) as conn:
            conn.execute(
                "CREATE TABLE servers (id INTEGER PRIMARY KEY, name TEXT, slug TEXT, type TEXT, version TEXT,"
                " serverport INTEGER, rcon_password TEXT, createdat TEXT DEFAULT '2025-01-02 03:04:05')"
            )
            conn.execute("INSERT INTO servers (name, slug, type, version, serverport, rcon_password)"
                         " VALUES ('o', 'o', 'paper', '1.21', 25565, 'x')")
        with mock.patch.object(db, "DB_PATH", path):
            db.init_schema()
            with db.get_db() as conn:
                row = conn.execute("SELECT eula_accepted_at FROM servers").fetchone()
        self.assertEqual(row["eula_accepted_at"], "2025-01-02 03:04:05")


if __name__ == "__main__":
    unittest.main()
