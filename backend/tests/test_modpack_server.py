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


if __name__ == "__main__":
    unittest.main()
