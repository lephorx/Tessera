import tempfile
import unittest
from pathlib import Path
from unittest import mock

import player_manager


class PlayerFilePathTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.world = Path(self.tmp.name) / "world"
        self.world.mkdir()
        patcher = mock.patch.object(player_manager, "server_data_dir", return_value=self.tmp.name)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.addCleanup(self.tmp.cleanup)

    def test_pre_26_1_world_uses_root_folders(self):
        (self.world / "playerdata").mkdir()
        self.assertEqual(player_manager._player_dat(1, "u"), self.world / "playerdata" / "u.dat")
        self.assertEqual(player_manager._player_file(1, "stats", "u.json"), self.world / "stats" / "u.json")
        self.assertEqual(
            player_manager._player_file(1, "advancements", "u.json"), self.world / "advancements" / "u.json"
        )

    def test_26_1_world_uses_players_folder(self):
        # an upgraded world can still have a stale playerdata/ next to players/
        (self.world / "playerdata").mkdir()
        (self.world / "players" / "data").mkdir(parents=True)
        self.assertEqual(player_manager._player_dat(1, "u"), self.world / "players" / "data" / "u.dat")
        self.assertEqual(player_manager._player_dat_old(1, "u"), self.world / "players" / "data" / "u.dat_old")
        self.assertEqual(
            player_manager._player_file(1, "stats", "u.json"), self.world / "players" / "stats" / "u.json"
        )
        self.assertEqual(
            player_manager._player_file(1, "advancements", "u.json"),
            self.world / "players" / "advancements" / "u.json",
        )


if __name__ == "__main__":
    unittest.main()
