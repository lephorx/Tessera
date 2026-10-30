"""Docker Desktop on Windows: the updater must hand the daemon Linux-VM paths."""

import unittest

from update_manager import host_path


class HostPathTests(unittest.TestCase):
    def test_windows_paths_become_vm_paths(self):
        self.assertEqual(host_path(r"C:\Users\Ramon\tessera-server"), "/run/desktop/mnt/host/c/Users/Ramon/tessera-server")
        self.assertEqual(host_path("D:/Games/tessera/"), "/run/desktop/mnt/host/d/Games/tessera")

    def test_other_paths_stay(self):
        self.assertEqual(host_path("/home/ramon/cscm"), "/home/ramon/cscm")
        self.assertEqual(host_path("/run/desktop/mnt/host/c/x"), "/run/desktop/mnt/host/c/x")


if __name__ == "__main__":
    unittest.main()
