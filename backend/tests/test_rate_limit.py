"""Sign-in is limited per address; other addresses and relayed requests aren't affected."""

import unittest

from flask import Flask, jsonify

import rate_limit


class RateLimiterTests(unittest.TestCase):
    def test_window(self):
        rl = rate_limit.RateLimiter(2, 60)
        self.assertTrue(rl.take("a", now=0))
        self.assertTrue(rl.take("a", now=1))
        self.assertFalse(rl.take("a", now=2))
        self.assertTrue(rl.take("b", now=2))
        self.assertTrue(rl.take("a", now=61))  # next window

    def test_client_ip_prefers_proxy_header(self):
        app = Flask(__name__)

        @app.get("/ip")
        def ip():
            return jsonify(ip=rate_limit.client_ip())

        c = app.test_client()
        self.assertEqual(c.get("/ip", headers={"X-Tessera-Client-IP": "203.0.113.9"}).json["ip"], "203.0.113.9")
        self.assertEqual(c.get("/ip").json["ip"], "127.0.0.1")


if __name__ == "__main__":
    unittest.main()
