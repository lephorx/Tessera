"""Updates use the images GitHub builds for each version: docker-compose.yml names this
version's, and the banner waits until a new version's images are published."""

import re
import unittest
from pathlib import Path
from unittest import mock

import update_manager

ROOT = Path(__file__).resolve().parents[2]


class Response:
    def __init__(self, status=200, text="", body=None):
        self.status_code, self.text, self.body = status, text, body or {}

    def raise_for_status(self):
        pass

    def json(self):
        return self.body


class ImagesTests(unittest.TestCase):
    def setUp(self):
        update_manager._cache.update(checked_at=0.0, latest=None, error=None)

    def test_compose_names_this_versions_images(self):
        version = (ROOT / "backend" / "VERSION").read_text().strip()
        compose = (ROOT / "docker-compose.yml").read_text()
        self.assertEqual(re.findall(r"image: ghcr\.io/lephorx/tessera-(\w+):(\S+)", compose), [("api", version), ("web", version)])

    def run_check(self, manifest_status):
        heads = []

        def head(url, **kw):
            heads.append(url)
            return Response(manifest_status)

        with mock.patch.object(update_manager, "current_version", lambda: "1.0.0"), \
             mock.patch.object(update_manager.requests, "get", lambda url, **kw: Response(text="1.1.0\n", body={"token": "t"})), \
             mock.patch.object(update_manager.requests, "head", head):
            return update_manager.latest_version(force=True), heads

    def test_new_version_waits_for_its_images(self):
        (latest, error), heads = self.run_check(404)
        self.assertIsNone(latest)
        self.assertIsNone(error)
        self.assertIn("/v2/lephorx/tessera-api/manifests/1.1.0", heads[0])
        # checked again in a few minutes, not in an hour
        self.assertLess(update_manager._cache["checked_at"], update_manager.time.time() - update_manager.CHECK_INTERVAL + update_manager.IMAGES_RETRY + 5)

    def test_announced_once_published(self):
        (latest, _), heads = self.run_check(200)
        self.assertEqual(latest, "1.1.0")
        self.assertEqual(len(heads), 2)

    def test_registry_trouble_doesnt_hide_updates(self):
        (latest, _), _ = self.run_check(500)
        self.assertEqual(latest, "1.1.0")


if __name__ == "__main__":
    unittest.main()
