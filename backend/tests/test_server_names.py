"""Two servers may have the same name: the second gets its own address name (slug)."""

import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import db
import server_manager


class ServerNameTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.patch = mock.patch.object(db, "DB_PATH", Path(self.tmp.name) / "cscm.db")
        self.patch.start()
        db.init_schema()

    def tearDown(self):
        self.patch.stop()
        self.tmp.cleanup()

    def make(self, name, port):
        return server_manager._create_server_record(name, "horizon", "26.3", "latest", port, 1, 2, eula_accepted=True)

    def test_same_name_gets_its_own_address(self):
        a, b, c = self.make("Horizontester", 25567), self.make("Horizontester", 25568), self.make("horizontester", 25569)
        self.assertEqual([a["subdomain"], b["subdomain"], c["subdomain"]], ["horizontester", "horizontester-2", "horizontester-3"])
        self.assertTrue(b["success"] and c["success"])

    def test_port_clash_says_port(self):
        self.make("One", 25570)
        res = self.make("Two", 25570)
        self.assertFalse(res["success"])
        self.assertIn("Port 25570", res["message"])


if __name__ == "__main__":
    unittest.main()
