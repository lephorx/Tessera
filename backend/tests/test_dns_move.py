"""A new Cloudflare zone or domain (in Settings or edited in .env): every public server
gets new records and the dashboard lists those; the old records stay in Cloudflare."""

import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import db
import server_manager

NEW = {"CLOUDFLARE_ENABLED": "true", "CLOUDFLARE_API_TOKEN": "token", "CLOUDFLARE_ZONE_ID": "zone-new", "CLOUDFLARE_BASE_DOMAIN": "new.example"}


class DnsMoveTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        tmp = Path(self.tmp.name)
        self.created, self.deleted, self.resyncs = [], [], []

        def fake_cname(subdomain, target, proxied=False):
            name = f"{subdomain}.{os.environ['CLOUDFLARE_BASE_DOMAIN']}"
            self.created.append(name)
            return name, f"cf-{len(self.created)}"

        def fake_srv(subdomain, target, port):
            self.created.append(f"_minecraft._tcp.{subdomain}")
            return f"cf-{len(self.created)}"

        self.patches = [
            mock.patch.object(db, "DB_PATH", tmp / "cscm.db"),
            mock.patch.object(server_manager, "_APPLIED_FILE", tmp / "cloudflare-applied.json"),
            mock.patch.dict(os.environ, NEW),
            mock.patch.object(server_manager, "create_dns_record", fake_cname),
            mock.patch.object(server_manager, "create_srv_record", fake_srv),
            mock.patch.object(server_manager, "delete_dns_record_by_id", lambda *a, **kw: self.deleted.append(a) or True),
            mock.patch.object(server_manager, "start_dns_resync", lambda old: self.resyncs.append(old)),
        ]
        for p in self.patches:
            p.start()
        db.init_schema()
        with db.get_db() as conn:
            conn.execute(
                "INSERT INTO servers (id, name, slug, type, version, serverport, mem_min_gb, mem_max_gb, rcon_password, status)"
                " VALUES (1, 'Survival', 'survival', 'paper', '1.21.4', 25565, 1, 2, 'pw', 'created')"
            )
            conn.execute("INSERT INTO playit_tunnels (server_id, tunnel_address, external_port) VALUES (1, 'abc.joinmc.link', 41234)")
            conn.execute("INSERT INTO dns_records (server_id, record_type, name, target, cloudflare_record_id) VALUES (1, 'CNAME', 'survival.old.example', 'abc.joinmc.link', 'old-cname')")
            conn.execute("INSERT INTO dns_records (server_id, record_type, name, target, port, cloudflare_record_id) VALUES (1, 'SRV', '_minecraft._tcp.survival.old.example', 'abc.joinmc.link', 41234, 'old-srv')")

    def tearDown(self):
        for p in self.patches:
            p.stop()
        self.tmp.cleanup()

    def names(self):
        with db.get_db() as conn:
            return sorted(r["name"] for r in conn.execute("SELECT name FROM dns_records WHERE server_id = 1"))

    def test_new_domain_makes_new_records_and_keeps_the_old_ones(self):
        server_manager.resync_dns({"CLOUDFLARE_ZONE_ID": "zone-old", "CLOUDFLARE_BASE_DOMAIN": "old.example", "CLOUDFLARE_API_TOKEN": "token"})
        self.assertEqual(self.names(), ["_minecraft._tcp.survival.new.example", "survival.new.example"])
        self.assertEqual(self.deleted, [])  # the old records stay in Cloudflare
        self.assertEqual(json.loads(server_manager._APPLIED_FILE.read_text())["CLOUDFLARE_BASE_DOMAIN"], "new.example")
        self.assertEqual(server_manager.dns_sync_status()["failed"], [])

    def test_records_already_on_the_domain_stay(self):
        with db.get_db() as conn:
            conn.execute("UPDATE dns_records SET name = REPLACE(name, 'old.example', 'new.example')")
        server_manager.resync_dns({"CLOUDFLARE_ZONE_ID": "zone-new", "CLOUDFLARE_BASE_DOMAIN": "new.example"})
        self.assertEqual(self.created, [])

    def test_a_change_in_env_is_noticed_at_start(self):
        server_manager._APPLIED_FILE.write_text(json.dumps({"CLOUDFLARE_ZONE_ID": "zone-old", "CLOUDFLARE_BASE_DOMAIN": "old.example"}))
        self.assertTrue(server_manager.resync_dns_if_changed())
        self.assertEqual(self.resyncs[0]["CLOUDFLARE_BASE_DOMAIN"], "old.example")

    def test_first_start_moves_records_left_on_another_domain(self):
        self.assertTrue(server_manager.resync_dns_if_changed())

    def test_nothing_to_do_when_unchanged(self):
        with db.get_db() as conn:
            conn.execute("UPDATE dns_records SET name = REPLACE(name, 'old.example', 'new.example')")
        server_manager._APPLIED_FILE.write_text(json.dumps({"CLOUDFLARE_ZONE_ID": "zone-new", "CLOUDFLARE_BASE_DOMAIN": "new.example"}))
        self.assertFalse(server_manager.resync_dns_if_changed())
        self.assertEqual(self.resyncs, [])

    def test_turning_cloudflare_off_keeps_the_records_in_cloudflare(self):
        with mock.patch.dict(os.environ, {"CLOUDFLARE_ENABLED": "false"}):
            server_manager.resync_dns({"CLOUDFLARE_ZONE_ID": "zone-new", "CLOUDFLARE_BASE_DOMAIN": "new.example"})
        self.assertEqual(self.names(), [])
        self.assertEqual(self.deleted, [])


if __name__ == "__main__":
    unittest.main()
