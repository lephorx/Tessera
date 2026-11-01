"""The file manager, backups and the console stay inside the caller's own server.

Runs the real app (app.py) against temporary folders: one owner per server,
servers 1 and 12 side by side (12 starts with 1), and symlinks planted the
way a plugin in the Minecraft container could.
"""

import io
import json
import os
import tempfile
import unittest
import zipfile
from datetime import UTC, datetime
from pathlib import Path
from unittest import mock


class ServerFilesSecurityTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        root = Path(cls.tmp.name)
        cls.servers_dir = root / "servers"
        cls.backups_dir = root / "backups"
        cls.secret = root / "app-data" / "cscm.db"  # stands in for /app/data/cscm.db
        cls.secret.parent.mkdir()
        cls.secret.write_text("JWT-SECRET-STAND-IN")
        env = {
            "SERVERS_DIR": str(cls.servers_dir), "BACKUPS_DIR": str(cls.backups_dir),
            "DB_PATH": str(root / "cscm.db"), "AUTH_DB_PATH": str(root / "cscm.db"),
            "CSCM_CLOUD_DISABLED": "1",
        }

        import auth_manager
        import backup_manager
        import db
        import docker_manager

        # modules other tests imported first keep their paths unless patched
        cls.patches = [
            mock.patch.dict(os.environ, env),
            mock.patch.object(db, "DB_PATH", Path(env["DB_PATH"])),
            mock.patch.object(auth_manager, "AUTH_DB_PATH", Path(env["AUTH_DB_PATH"])),
            mock.patch.object(docker_manager, "SERVERS_DIR", env["SERVERS_DIR"]),
            mock.patch.object(backup_manager, "BACKUPS_DIR", env["BACKUPS_DIR"]),
            mock.patch.object(docker_manager, "runtime_status", lambda sid: "stopped"),
            mock.patch.object(docker_manager, "stop_server", lambda sid: None),
            mock.patch.object(docker_manager, "start_server", lambda sid: None),
            mock.patch.object(docker_manager, "stream_logs", lambda sid: iter([f"log of server {sid}"])),
        ]
        for p in cls.patches:
            p.start()

        import app as app_module

        cls.app_module = app_module
        cls.client = app_module.app.test_client()
        cls.auth_manager = auth_manager
        cls.backup_manager = backup_manager
        cls.db = db

        now = datetime.now(UTC).isoformat()
        cls.tokens = {}
        with auth_manager._connect() as conn:
            for name, admin in (("admin", 1), ("one", 0), ("twelve", 0)):
                cur = conn.execute(
                    "INSERT INTO users (username, password_hash, totp_secret, is_admin, created_at) VALUES (?, 'x', 'x', ?, ?)",
                    (name, admin, now),
                )
                cls.tokens[name] = auth_manager.issue_jwt(cur.lastrowid, name)[0]
                if name == "one":
                    cls.one_id = cur.lastrowid
                elif name == "twelve":
                    cls.twelve_id = cur.lastrowid
            conn.commit()
        with db.get_db() as conn:
            for sid, owner in ((1, cls.one_id), (12, cls.twelve_id)):
                conn.execute(
                    "INSERT INTO servers (id, name, slug, type, version, serverport, rcon_password, owner_id)"
                    " VALUES (?, ?, ?, 'paper', '1.21.4', ?, 'x', ?)",
                    (sid, f"s{sid}", f"s{sid}", 25560 + sid, owner),
                )

    @classmethod
    def tearDownClass(cls):
        if cls.backup_manager._scheduler is not None:
            cls.backup_manager._scheduler.shutdown(wait=False)
            cls.backup_manager._scheduler = None
        for p in reversed(cls.patches):
            p.stop()
        cls.tmp.cleanup()

    def setUp(self):
        for sid in (1, 12):
            d = self.servers_dir / str(sid)
            if d.exists() or d.is_symlink():
                import shutil
                shutil.rmtree(d)
            d.mkdir(parents=True)
            (d / "server.properties").write_text(f"motd=server {sid}\n")
            (d / "plugins").mkdir()

    def call(self, method, url, user="one", **kwargs):
        headers = {"Authorization": f"Bearer {self.tokens[user]}"} if user else {}
        return self.client.open(url, method=method, headers=headers, **kwargs)

    # ── S1: a prefix match let server 1 reach server 12 ──

    def test_sibling_server_folder_is_out_of_reach(self):
        for method, url, kwargs in [
            ("GET", "/api/servers/1/files/content?path=../12/server.properties", {}),
            ("GET", "/api/servers/1/files/download?path=../12/server.properties", {}),
            ("GET", "/api/servers/1/files/raw?path=../12/server.properties", {}),
            ("GET", "/api/servers/1/files?path=../12", {}),
            ("GET", "/api/servers/1/files?path=/../12", {}),
            ("PUT", "/api/servers/1/files/content?path=../12/server.properties", {"json": {"content": "pwned"}}),
            ("DELETE", "/api/servers/1/files/delete?path=../12/server.properties", {}),
            ("POST", "/api/servers/1/files/upload?path=../12", {
                "data": {"file": (io.BytesIO(b"pwned"), "server.properties")},
                "content_type": "multipart/form-data"}),
        ]:
            res = self.call(method, url, **kwargs)
            self.assertIn(res.status_code, (400, 404), f"{method} {url}: {res.status_code}")
            self.assertNotIn(b"server 12", res.data)
        self.assertEqual((self.servers_dir / "12" / "server.properties").read_text(), "motd=server 12\n")

    def test_owner_still_reaches_own_files(self):
        res = self.call("GET", "/api/servers/1/files/content?path=server.properties")
        self.assertEqual(res.get_json()["content"], "motd=server 1\n")
        res = self.call("PUT", "/api/servers/1/files/content?path=plugins/a/b.yml", json={"content": "x: 1"})
        self.assertEqual(res.status_code, 200)
        self.assertEqual((self.servers_dir / "1" / "plugins/a/b.yml").read_text(), "x: 1")
        res = self.call("POST", "/api/servers/1/files/upload?path=plugins", data={
            "file": (io.BytesIO(b"jar"), "p.jar")}, content_type="multipart/form-data")
        self.assertEqual(res.status_code, 201)
        res = self.call("GET", "/api/servers/1/files/download?path=plugins/p.jar")
        self.assertEqual(res.data, b"jar")
        res.close()
        res = self.call("GET", "/api/servers/1/files?path=plugins")
        self.assertEqual({e["name"] for e in res.get_json()["entries"]}, {"a", "p.jar"})
        self.assertEqual(self.call("DELETE", "/api/servers/1/files/delete?path=plugins/a").status_code, 200)
        self.assertFalse((self.servers_dir / "1" / "plugins/a").exists())
        # the ownership check: another user's server answers 403
        self.assertEqual(self.call("GET", "/api/servers/12/files", user="one").status_code, 403)

    # ── S2: symlinks planted from inside the container ──

    def plant(self, name, target):
        link = self.servers_dir / "1" / name
        link.parent.mkdir(parents=True, exist_ok=True)
        os.symlink(target, link)
        return link

    def test_symlinks_are_never_read_or_written_through(self):
        self.plant("db", self.secret)
        self.plant("appdir", self.secret.parent)
        self.plant("plugins/escape", self.secret.parent)
        for url in [
            "/api/servers/1/files/content?path=db",
            "/api/servers/1/files/download?path=db",
            "/api/servers/1/files/raw?path=db",
            "/api/servers/1/files/content?path=appdir/cscm.db",
            "/api/servers/1/files/download?path=plugins/escape/cscm.db",
            "/api/servers/1/files?path=appdir",
        ]:
            res = self.call("GET", url)
            self.assertIn(res.status_code, (400, 404), url)
            self.assertNotIn(b"JWT-SECRET", res.data, url)
            res.close()

        for url, kwargs in [
            ("/api/servers/1/files/content?path=db", {"json": {"content": "pwned"}}),
            ("/api/servers/1/files/content?path=appdir/cscm.db", {"json": {"content": "pwned"}}),
            ("/api/servers/1/files/content?path=appdir/new.py", {"json": {"content": "pwned"}}),
        ]:
            self.assertEqual(self.call("PUT", url, **kwargs).status_code, 400, url)
        for path, name in [("", "db"), ("db", None), ("appdir", "cscm.db"), ("plugins/escape", "x.py")]:
            url = f"/api/servers/1/files/upload?path={path}" + (f"&filename={name}" if name else "")
            res = self.call("POST", url, data={"file": (io.BytesIO(b"pwned"), name or "db")},
                            content_type="multipart/form-data")
            self.assertEqual(res.status_code, 400, url)
        self.assertEqual(self.secret.read_text(), "JWT-SECRET-STAND-IN")
        self.assertEqual(sorted(os.listdir(self.secret.parent)), ["cscm.db"])

        # listed as links, and deleting one removes only the link
        entries = {e["name"]: e["type"] for e in self.call("GET", "/api/servers/1/files").get_json()["entries"]}
        self.assertEqual(entries["db"], "link")
        self.assertEqual(self.call("DELETE", "/api/servers/1/files/delete?path=appdir").status_code, 200)
        self.assertTrue(self.secret.exists())
        self.assertFalse((self.servers_dir / "1" / "appdir").is_symlink())

    def test_server_properties_and_icon_are_not_written_through_links(self):
        import appearance_manager
        import properties_manager

        props = self.servers_dir / "1" / "server.properties"
        props.unlink()
        os.symlink(self.secret, props)
        self.assertEqual(properties_manager.read_properties(1), {})
        self.assertIn("error", properties_manager.patch_properties(1, {"motd": "x"}))
        self.assertEqual(self.secret.read_text(), "JWT-SECRET-STAND-IN")

        os.symlink(self.secret, self.servers_dir / "1" / appearance_manager.ICON_NAME)
        self.assertIsNone(appearance_manager.open_icon(1))
        png = b"\x89PNG\r\n\x1a\n" + b"\0\0\0\rIHDR" + (64).to_bytes(4, "big") * 2 + b"\0" * 8
        self.assertTrue(appearance_manager.set_icon(1, png)[0])
        self.assertEqual(self.secret.read_text(), "JWT-SECRET-STAND-IN")
        self.assertFalse((self.servers_dir / "1" / appearance_manager.ICON_NAME).is_symlink())

    def test_backups_leave_links_out(self):
        self.plant("db", self.secret)
        self.plant("world/escape", self.secret.parent)
        (self.servers_dir / "1" / "world" / "level.dat").write_bytes(b"level")
        for kind in ("zip", "copy"):
            result = self.backup_manager.create_backup(1, backup_type=kind)
            self.assertTrue(result["success"], result)
            path, cleanup, err = self.backup_manager.get_backup_download_archive(1, result["backup_id"])
            self.assertIsNone(err)
            with zipfile.ZipFile(path) as zf:
                names = set(zf.namelist())
                self.assertIn("world/level.dat", names)
                self.assertFalse(any("db" == n or "escape" in n or "cscm" in n for n in names), names)
                self.assertFalse(any(b"JWT-SECRET" in zf.read(n) for n in names))
            if cleanup:
                path.unlink()

            # restoring brings the real files back and no links
            (self.servers_dir / "1" / "world" / "level.dat").write_bytes(b"changed")
            self.assertTrue(self.backup_manager.restore_backup(1, result["backup_id"])["success"])
            self.assertEqual((self.servers_dir / "1" / "world" / "level.dat").read_bytes(), b"level")
            self.assertFalse((self.servers_dir / "1" / "db").exists())

    def test_restore_refuses_zip_slip_and_symlink_entries(self):
        evil = self.backups_dir / "1" / "evil.zip"
        evil.parent.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(evil, "w") as zf:
            zf.writestr("server.properties", "motd=restored\n")
            zf.writestr("../12/server.properties", "pwned")
        with self.db.get_db() as conn:
            bid = conn.execute(
                "INSERT INTO backups (server_id, filename, size_bytes, kind, backup_type) VALUES (1, 'evil.zip', 1, 'manual', 'zip')"
            ).lastrowid
        result = self.backup_manager.restore_backup(1, bid)
        self.assertFalse(result["success"])
        # refused before anything was touched
        self.assertEqual((self.servers_dir / "1" / "server.properties").read_text(), "motd=server 1\n")
        self.assertEqual((self.servers_dir / "12" / "server.properties").read_text(), "motd=server 12\n")

        linky = self.backups_dir / "1" / "link.zip"
        with zipfile.ZipFile(linky, "w") as zf:
            info = zipfile.ZipInfo("db")
            info.external_attr = (0o120777 << 16)
            zf.writestr(info, str(self.secret))
            zf.writestr("server.properties", "motd=restored\n")
        with self.db.get_db() as conn:
            bid = conn.execute(
                "INSERT INTO backups (server_id, filename, size_bytes, kind, backup_type) VALUES (1, 'link.zip', 1, 'manual', 'zip')"
            ).lastrowid
        self.assertTrue(self.backup_manager.restore_backup(1, bid)["success"])
        self.assertFalse((self.servers_dir / "1" / "db").is_symlink())
        self.assertFalse((self.servers_dir / "1" / "db").exists())

    def test_player_files_ignore_bad_uuids(self):
        import player_manager

        (self.servers_dir / "1" / "usercache.json").write_text(json.dumps([
            {"name": "evil", "uuid": "../../../app-data/cscm"},
        ]))
        self.assertIsNone(player_manager._lookup_uuid(1, "evil"))

    # ── S4: ?token= was not what the ownership check looked at ──

    def test_console_query_token_is_checked_for_ownership(self):
        res = self.client.get(f"/api/servers/12/console/stream?token={self.tokens['one']}")
        self.assertEqual(res.status_code, 403)
        res = self.client.get(f"/api/servers/12/console/stream?token={self.tokens['twelve']}")
        self.assertEqual(res.status_code, 200)
        self.assertIn(b"log of server 12", res.data)
        # with a header, the header is the identity, for both checks
        res = self.client.get(f"/api/servers/12/console/stream?token={self.tokens['twelve']}",
                              headers={"Authorization": f"Bearer {self.tokens['one']}"})
        self.assertEqual(res.status_code, 403)
        self.assertEqual(self.client.get("/api/servers/12/console/stream").status_code, 401)
        # ?token= is only taken on the console stream
        res = self.client.get(f"/api/servers/12/files?token={self.tokens['twelve']}")
        self.assertEqual(res.status_code, 401)


if __name__ == "__main__":
    unittest.main()
