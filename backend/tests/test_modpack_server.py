"""Modpack servers: the upload must be a real .mrpack, and the container gets the pack, not a VERSION."""

import io
import json
import unittest
import zipfile

from routes.servers import _read_mrpack


def mrpack(index) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("modrinth.index.json", json.dumps(index))
    return buf.getvalue()


class ModpackTests(unittest.TestCase):
    def test_reads_index(self):
        index = _read_mrpack(mrpack({"name": "P", "dependencies": {"minecraft": "1.21.1", "fabric-loader": "0.16.9"}, "files": []}))
        self.assertEqual(index["dependencies"]["minecraft"], "1.21.1")

    def test_rejects_non_packs(self):
        with self.assertRaisesRegex(ValueError, "isn't a Modrinth modpack"):
            _read_mrpack(b"not a zip")
        with self.assertRaisesRegex(ValueError, "Minecraft version"):
            _read_mrpack(mrpack({"name": "P", "dependencies": {}}))

    def test_container_env(self):
        import docker_manager

        captured = {}

        class FakeContainers:
            def run(self, image, **kw):
                captured.update(kw["environment"])
                return type("C", (), {"id": "x"})()

        docker_manager._client = type("Client", (), {"containers": FakeContainers()})()
        row = {"id": 1, "type": "modpack", "version": "1.21.1", "mem_min_gb": 2, "mem_max_gb": 4,
               "rcon_password": "r", "serverport": 25565, "loader_version": "fabric-loader 0.16.9"}
        docker_manager._create_java_container(row)
        self.assertEqual(captured["TYPE"], "MODRINTH")
        self.assertEqual(captured["MODRINTH_MODPACK"], "/data/.tessera/pack.mrpack")
        self.assertNotIn("VERSION", captured)
        docker_manager._client = None


class UpdatePackTests(unittest.TestCase):
    """PUT /api/servers/<id>/pack swaps the pack and records the new versions; a running server keeps running."""

    def setUp(self):
        import tempfile
        from pathlib import Path
        from unittest import mock

        from flask import Flask, g

        import db
        import routes.servers as servers

        self.tmp = tempfile.TemporaryDirectory()
        self.patches = [
            mock.patch.object(db, "DB_PATH", Path(self.tmp.name) / "cscm.db"),
            mock.patch.object(servers, "server_data_dir", lambda sid: str(Path(self.tmp.name) / str(sid))),
        ]
        for p in self.patches:
            p.start()
        db.init_schema()
        with db.get_db() as conn:
            for sid, kind in ((1, "modpack"), (2, "fabric")):
                conn.execute(
                    "INSERT INTO servers (id, name, slug, type, version, serverport, rcon_password) VALUES (?, ?, ?, ?, '1.21.1', ?, 'x')",
                    (sid, f"s{sid}", f"s{sid}", kind, 25564 + sid),
                )

        def fake_authorize():
            g.current_user = {"id": 1, "is_admin": True, "username": "admin"}
            return None

        self.restarted = []
        self.state = "healthy"
        self.patches += [
            mock.patch.object(servers, "authorize", fake_authorize),
            mock.patch.object(servers.docker_manager, "runtime_status", lambda sid: self.state),
            mock.patch.object(servers.docker_manager, "restart_server", lambda sid: self.restarted.append(sid)),
        ]
        for p in self.patches[2:]:
            p.start()
        app = Flask(__name__)
        app.register_blueprint(servers.servers_bp)
        self.client = app.test_client()
        self.servers = servers

    def tearDown(self):
        for p in self.patches:
            p.stop()
        self.tmp.cleanup()

    def put(self, sid, data):
        return self.client.put(f"/api/servers/{sid}/pack", data={"pack": (io.BytesIO(data), "pack.mrpack")},
                               content_type="multipart/form-data")

    def test_swaps_pack_without_restarting(self):
        import os
        import time

        pack = mrpack({"name": "P", "dependencies": {"minecraft": "1.21.4", "neoforge": "21.4.1"}, "files": []})
        res = self.put(1, pack)
        self.assertEqual(res.status_code, 200, res.json)
        self.assertFalse(res.json["restarted"])
        self.assertTrue(res.json["needs_restart"])
        path = os.path.join(self.servers.server_data_dir(1), self.servers.MODPACK_FILE)
        with open(path, "rb") as fh:
            self.assertEqual(fh.read(), pack)
        import db
        with db.get_db() as conn:
            row = conn.execute("SELECT version, loader_version FROM servers WHERE id = 1").fetchone()
        self.assertEqual((row["version"], row["loader_version"]), ("1.21.4", "neoforge 21.4.1"))
        time.sleep(0.2)
        self.assertEqual(self.restarted, [])

    def test_stopped_server_is_not_started(self):
        self.state = "stopped"
        res = self.put(1, mrpack({"name": "P", "dependencies": {"minecraft": "1.21.1"}, "files": []}))
        self.assertFalse(res.json["restarted"])
        self.assertFalse(res.json["needs_restart"])
        self.assertEqual(self.restarted, [])

    def test_refuses_other_servers_and_bad_files(self):
        self.assertEqual(self.put(2, mrpack({"name": "P", "dependencies": {"minecraft": "1.21.1"}})).status_code, 400)
        self.assertEqual(self.put(1, b"nope").status_code, 400)
        self.assertEqual(self.put(99, b"nope").status_code, 404)


if __name__ == "__main__":
    unittest.main()
