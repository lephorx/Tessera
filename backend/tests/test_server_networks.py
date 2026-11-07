"""Each server gets its own Docker network, created on demand and removed with the server."""

import unittest

from docker.errors import APIError, NotFound

import docker_manager


class FakeNetwork:
    def __init__(self, store, name, labels):
        self.store, self.name, self.attrs = store, name, {"Labels": labels}

    def remove(self):
        del self.store[self.name]


class FakeNetworks:
    def __init__(self):
        self.store, self.created = {}, []

    def get(self, name):
        if name not in self.store:
            raise NotFound(name)
        return self.store[name]

    def create(self, name, **kw):
        self.created.append((name, kw))
        self.store[name] = FakeNetwork(self.store, name, kw.get("labels", {}))


class FakeContainers:
    def __init__(self):
        self.runs = []

    def run(self, image, **kw):
        self.runs.append(kw)
        return type("C", (), {"id": "x"})()

    def get(self, name):
        raise NotFound(name)


ROW = {"id": 7, "type": "paper", "version": "1.21.1", "mem_min_gb": 1, "mem_max_gb": 2,
       "rcon_password": "r", "serverport": 25570}


class ServerNetworkTests(unittest.TestCase):
    def setUp(self):
        self.client = type("Client", (), {})()
        self.client.networks, self.client.containers = FakeNetworks(), FakeContainers()
        docker_manager._client = self.client
        docker_manager.MC_NETWORK_ISOLATION = True

    def tearDown(self):
        docker_manager._client = None
        docker_manager.MC_NETWORK_ISOLATION = True

    def test_container_joins_its_own_network(self):
        docker_manager._create_java_container(ROW)
        self.assertEqual(self.client.containers.runs[0]["network"], "cscm-mc-net-7")
        name, kw = self.client.networks.created[0]
        self.assertEqual(name, "cscm-mc-net-7")
        self.assertEqual(kw["options"]["com.docker.network.bridge.name"], "tmc7")
        self.assertEqual(kw["labels"][docker_manager.MANAGED_LABEL], "true")

    def test_existing_network_is_reused(self):
        docker_manager._create_java_container(ROW)
        docker_manager._create_java_container(ROW)
        self.assertEqual(len(self.client.networks.created), 1)

    def test_foreign_network_is_not_used(self):
        self.client.networks.store["cscm-mc-net-7"] = FakeNetwork(self.client.networks.store, "cscm-mc-net-7", {})
        with self.assertRaisesRegex(RuntimeError, "not Tessera's"):
            docker_manager._create_java_container(ROW)
        self.assertEqual(self.client.containers.runs, [])

    def test_isolation_off_uses_default_bridge(self):
        docker_manager.MC_NETWORK_ISOLATION = False
        docker_manager._create_java_container(ROW)
        self.assertIsNone(self.client.containers.runs[0]["network"])
        self.assertEqual(self.client.networks.created, [])

    def test_remove_server_removes_network_without_container(self):
        docker_manager._server_network(7)
        docker_manager.remove_server(7)
        self.assertNotIn("cscm-mc-net-7", self.client.networks.store)

    def test_pool_exhaustion_explains_the_fix(self):
        def full(name, **kw):
            raise APIError("could not find an available, non-overlapping IPv4 address pool")
        self.client.networks.create = full
        with self.assertRaisesRegex(RuntimeError, "default-address-pools"):
            docker_manager._server_network(7)


if __name__ == "__main__":
    unittest.main()
