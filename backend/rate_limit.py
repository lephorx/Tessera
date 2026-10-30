"""Fixed-window rate limits per client address, in memory (one gunicorn worker).

The dashboard reaches the API through the Next.js proxy, which passes the visitor's
address in X-Tessera-Client-IP; the API port itself isn't published (docker-compose)."""

import threading
import time

from flask import request


class RateLimiter:
    def __init__(self, limit: int, window_s: float):
        self.limit = limit
        self.window_s = window_s
        self._hits: dict[str, list[float]] = {}  # key -> [count, window_end]
        self._lock = threading.Lock()

    def take(self, key: str, now: float | None = None) -> bool:
        """False when `key` is over the limit for the current window."""
        now = time.monotonic() if now is None else now
        with self._lock:
            entry = self._hits.get(key)
            if entry is None or entry[1] <= now:
                if len(self._hits) > 10_000:
                    self._hits = {k: v for k, v in self._hits.items() if v[1] > now}
                self._hits[key] = [1, now + self.window_s]
                return True
            entry[0] += 1
            return entry[0] <= self.limit


def client_ip() -> str:
    forwarded = request.headers.get("X-Tessera-Client-IP", "").strip()
    return forwarded or request.remote_addr or "unknown"


# sign-in, first-run setup and enrolment codes: brute-force targets
AUTH_PATHS = {"/api/auth/login", "/api/auth/setup", "/api/auth/setup/verify", "/api/users/verify"}
auth_limiter = RateLimiter(10, 60)
# everything else: generous, the dashboard polls stats and logs every few seconds
api_limiter = RateLimiter(1200, 60)
