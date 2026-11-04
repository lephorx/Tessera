"""Horizon servers' content mods: Tessera Launcher uploads a zip of .hmod files, and the start
script installs them into horizon-mods/ and turns them on in horizon-mods.txt."""

import io
import json
import os
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest import mock

from horizon import horizon_server


def hmod(mod_id: str) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("horizon-mod.toml", f'id = "{mod_id}"\nname = "{mod_id}"\nversion = "1"\napi = "0.2"\nside = "both"\n')
    return buf.getvalue()


def bundle(files: dict) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        for name, data in files.items():
            zf.writestr(name, data)
    return buf.getvalue()


class InstallModsTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.data = Path(self.tmp.name)
        (self.data / ".tessera").mkdir()
        self.patches = [
            mock.patch.object(horizon_server, "DATA", str(self.data)),
            mock.patch.object(horizon_server, "MODS_ZIP", str(self.data / ".tessera" / "horizon-mods.zip")),
            mock.patch.object(horizon_server, "MODS_RECORD", str(self.data / ".tessera" / "horizon-mods.json")),
        ]
        for p in self.patches:
            p.start()

    def tearDown(self):
        for p in self.patches:
            p.stop()
        self.tmp.cleanup()

    def send(self, files: dict):
        (self.data / ".tessera" / "horizon-mods.zip").write_bytes(bundle(files))
        horizon_server.install_mods()

    def test_installs_and_turns_on(self):
        (self.data / "horizon-mods.txt").write_text("mod.ruby:false\nkey.ruby.glow:key.keyboard.g\n")
        self.send({"ruby-1.hmod": hmod("ruby"), "rules-2.hmod": hmod("rules")})
        self.assertEqual((self.data / "horizon-mods" / "ruby-1.hmod").read_bytes(), hmod("ruby"))
        self.assertEqual((self.data / "horizon-mods.txt").read_text(), "key.ruby.glow:key.keyboard.g\nmod.ruby:true\nmod.rules:true\n")
        self.assertFalse((self.data / ".tessera" / "horizon-mods.zip").exists())

    def test_removes_only_what_it_sent_before(self):
        (self.data / "horizon-mods").mkdir()
        (self.data / "horizon-mods" / "by-hand.hmod").write_bytes(hmod("by_hand"))
        (self.data / "horizon-mods.txt").write_text("mod.by_hand:true\n")
        self.send({"ruby-1.hmod": hmod("ruby")})
        self.send({"ruby-2.hmod": hmod("ruby")})
        self.assertEqual(sorted(os.listdir(self.data / "horizon-mods")), ["by-hand.hmod", "ruby-2.hmod"])
        self.send({})
        self.assertEqual(os.listdir(self.data / "horizon-mods"), ["by-hand.hmod"])
        self.assertEqual((self.data / "horizon-mods.txt").read_text(), "mod.by_hand:true\n")

    def test_leaves_out_odd_files(self):
        self.send({"../evil.hmod": hmod("evil"), "notes.txt": b"x", "noid.hmod": bundle({"a": b"b"}), "ok.hmod": hmod("ok")})
        self.assertEqual(os.listdir(self.data / "horizon-mods"), ["ok.hmod"])
        self.assertFalse((self.data.parent / "evil.hmod").exists())
        self.assertEqual(json.loads((self.data / ".tessera" / "horizon-mods.json").read_text()), {"ok.hmod": "ok"})


class UploadTests(unittest.TestCase):
    """PUT /api/servers/<id>/horizon-mods stages the zip for the next start; only for Horizon servers."""

    def setUp(self):
        from flask import Flask, g

        import db
        import routes.servers as servers

        self.tmp = tempfile.TemporaryDirectory()
        self.patches = [
            mock.patch.object(db, "DB_PATH", Path(self.tmp.name) / "cscm.db"),
            mock.patch.object(servers, "server_data_dir", lambda sid: str(Path(self.tmp.name) / str(sid))),
            mock.patch.object(servers.docker_manager, "server_data_dir", lambda sid: str(Path(self.tmp.name) / str(sid))),
        ]
        for p in self.patches:
            p.start()
        db.init_schema()
        with db.get_db() as conn:
            for sid, kind in ((1, "horizon"), (2, "fabric")):
                conn.execute(
                    "INSERT INTO servers (id, name, slug, type, version, serverport, rcon_password) VALUES (?, ?, ?, ?, '26.3', ?, 'x')",
                    (sid, f"s{sid}", f"s{sid}", kind, 25564 + sid),
                )

        def fake_authorize():
            g.current_user = {"id": 1, "is_admin": True, "username": "admin"}
            return None

        self.state = "healthy"
        self.patches += [
            mock.patch.object(servers, "authorize", fake_authorize),
            mock.patch.object(servers.docker_manager, "runtime_status", lambda sid: self.state),
        ]
        for p in self.patches[3:]:
            p.start()
        app = Flask(__name__)
        app.register_blueprint(servers.servers_bp)
        self.client = app.test_client()
        self.dir = Path(self.tmp.name)

    def tearDown(self):
        for p in self.patches:
            p.stop()
        self.tmp.cleanup()

    def put(self, sid, data):
        return self.client.put(f"/api/servers/{sid}/horizon-mods", data={"mods": (io.BytesIO(data), "horizon-mods.zip")},
                               content_type="multipart/form-data")

    def test_stages_the_mods_and_refreshes_the_script(self):
        (self.dir / "1" / ".tessera").mkdir(parents=True)
        (self.dir / "1" / ".tessera" / "horizon.py").write_text("old")
        mods = bundle({"ruby-1.hmod": hmod("ruby")})
        res = self.put(1, mods)
        self.assertEqual(res.status_code, 200, res.json)
        self.assertTrue(res.json["needs_restart"])
        self.assertEqual((self.dir / "1" / ".tessera" / "horizon-mods.zip").read_bytes(), mods)
        self.assertIn("install_mods", (self.dir / "1" / ".tessera" / "horizon.py").read_text())

    def test_empty_zip_is_fine_and_stopped_needs_no_restart(self):
        self.state = "stopped"
        res = self.put(1, bundle({}))
        self.assertEqual(res.status_code, 200, res.json)
        self.assertFalse(res.json["needs_restart"])

    def test_refuses_other_servers_and_bad_files(self):
        self.assertEqual(self.put(2, bundle({"a.hmod": hmod("a")})).status_code, 400)
        self.assertEqual(self.put(1, b"nope").status_code, 400)
        self.assertEqual(self.put(1, bundle({"a.jar": b"x"})).status_code, 400)
        self.assertEqual(self.put(1, bundle({"a.hmod": bundle({"x": b"y"})})).status_code, 400)
        self.assertEqual(self.put(99, b"nope").status_code, 404)


if __name__ == "__main__":
    unittest.main()
