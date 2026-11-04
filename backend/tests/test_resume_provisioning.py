"""An update replacing the API halfway through a server's setup: the next start carries on
from the step it reached, making the container, tunnel and DNS records only once."""

import tempfile
import time
import unittest
from pathlib import Path
from unittest import mock

import db
import server_manager


class ResumeTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.containers, self.tunnels = [], []
        self.exists = False

        def create_container(row):
            self.containers.append(row["id"])
            self.exists = True
            return "c-1"

        async def create_tunnel(**kw):
            self.tunnels.append(kw["tunnel_name"])
            return "abc.joinmc.link"

        self.patches = [
            mock.patch.object(db, "DB_PATH", Path(self.tmp.name) / "cscm.db"),
            mock.patch.object(server_manager.docker_manager, "create_server_container", create_container),
            mock.patch.object(server_manager.docker_manager, "get_container", lambda sid: object() if self.exists else None),
            mock.patch.object(server_manager, "create_tunnel", create_tunnel),
            mock.patch.object(server_manager, "wait_for_srv_port", lambda *a, **kw: 41234),
            mock.patch.object(server_manager, "_create_optional_dns", lambda *a: ("abc.joinmc.link", None)),
            mock.patch.object(server_manager.player_lists, "seed_new_server", lambda *a: None),
        ]
        for p in self.patches:
            p.start()
        db.init_schema()

    def tearDown(self):
        for p in self.patches:
            p.stop()
        self.tmp.cleanup()

    def pending(self, sid):
        with db.get_db() as conn:
            return conn.execute("SELECT provision_pending FROM servers WHERE id = ?", (sid,)).fetchone()[0]

    def wait_done(self, sid):
        for _ in range(100):
            if self.pending(sid) is None:
                return
            time.sleep(0.05)
        self.fail("the setup didn't finish")

    def new_server(self):
        rec = server_manager._create_server_record("Survival", "paper", "1.21.4", None, 25570, 1, 2, eula_accepted=True)
        server_manager.mark_provisioning(rec["server_id"], {"subscription": None})
        return rec["server_id"]

    def test_cut_off_before_anything_resumes_from_the_start(self):
        sid = self.new_server()  # the API died right after the record
        self.assertEqual(server_manager.resume_provisioning(), 1)
        self.wait_done(sid)
        self.assertEqual((self.containers, self.tunnels), ([sid], ["survival"]))
        self.assertEqual(server_manager.resume_provisioning(), 0)

    def test_cut_off_after_the_container_keeps_it(self):
        sid = self.new_server()
        with db.get_db() as conn:
            conn.execute("UPDATE servers SET container_id = 'c-1', status = 'created' WHERE id = ?", (sid,))
        self.exists = True
        server_manager.resume_provisioning()
        self.wait_done(sid)
        self.assertEqual(self.containers, [])
        self.assertEqual(self.tunnels, ["survival"])

    def test_cut_off_after_the_tunnel_makes_nothing_twice(self):
        sid = self.new_server()
        with db.get_db() as conn:
            conn.execute("UPDATE servers SET container_id = 'c-1', status = 'created' WHERE id = ?", (sid,))
            conn.execute("INSERT INTO playit_tunnels (server_id, tunnel_name, tunnel_address, local_port, external_port) VALUES (?, 'survival', 'abc.joinmc.link', 25570, 41234)", (sid,))
        self.exists = True
        server_manager.resume_provisioning()
        self.wait_done(sid)
        self.assertEqual((self.containers, self.tunnels), ([], []))
        self.assertEqual(server_manager.progress_store.get(sid)["status"], "completed")

    def test_a_finished_setup_isnt_pending(self):
        sid = self.new_server()
        result = server_manager.run_provisioning(sid, "survival", 25570, {})
        self.assertTrue(result["success"])
        self.assertIsNone(self.pending(sid))


if __name__ == "__main__":
    unittest.main()
