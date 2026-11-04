"""Runs a Horizon server (Minecraft: Java Edition 26.3 rewritten in Rust,
https://github.com/horizon-rust/horizon) inside the itzg/minecraft-server:java25 image.

Tessera copies this file into the server's folder and starts the container with it
instead of the image's own entrypoint. On every start it:

1. picks Horizon's newest Nightly (or HORIZON_BUILD) server build for linux-x86_64 and installs it
   once, checked against Horizon's Ed25519-signed SHA256SUMS;
2. prepares Horizon's game files once per build with horizon-prepare, from Minecraft
   26.3's own files downloaded from Mojang (the version its research-lock.json pins);
3. sets the server up (horizon-server init) the first time, then copies the settings
   Tessera keeps in server.properties into Horizon's server.toml;
4. installs the content mods Tessera Launcher sent (.tessera/horizon-mods.zip) into
   horizon-mods/ and turns them on in horizon-mods.txt, where Horizon reads them;
5. runs `horizon-server run` as the container's main process.

Builds and prepared files are shared by all Horizon servers in /horizon.
Only the standard library and the image's openssl are used.
"""

import base64
import fcntl
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.request
import zipfile
from concurrent.futures import ThreadPoolExecutor

REPO = "horizon-rust/horizon"
MINECRAFT = "26.3"
# the server build: no ALSA or udev libraries needed (the full game needs them)
ASSET = "horizon-server-linux-x86_64.tar.gz"
# Horizon's release signing keys (crates/horizon-release-sign/release-keys.txt there)
RELEASE_KEYS = ["MU4oiIQcCxkZvbwSjjXs7SySCuM6ywRQ3nGaJYZG0gw="]
# DER prefix of an Ed25519 public key (SubjectPublicKeyInfo), for openssl
ED25519_SPKI = bytes.fromhex("302a300506032b6570032100")
JAVA_HOME = os.environ.get("JAVA_HOME", "/opt/java/openjdk")

SHARED = os.environ.get("HORIZON_HOME", "/horizon")
DATA = "/data"

# server.properties keys -> Horizon's server.toml (horizon-server config set)
KEYS = {
    "motd": "server.motd",
    "server-port": "server.port",
    "server-ip": "server.bind",
    "max-players": "server.max_players",
    "online-mode": "server.online_mode",
    "white-list": "server.whitelist",
    "enforce-whitelist": "server.enforce_whitelist",
    "view-distance": "server.view_distance",
    "simulation-distance": "server.simulation_distance",
    "level-name": "world.name",
    "level-seed": "world.seed",
    "gamemode": "world.game_mode",
    "difficulty": "world.difficulty",
    "hardcore": "world.hardcore",
}


def say(msg: str) -> None:
    print(f"[Tessera] {msg}", flush=True)


def get(url: str, accept: str | None = None) -> bytes:
    for attempt in range(4):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Tessera", **({"Accept": accept} if accept else {})})
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.read()
        except Exception as exc:  # noqa: BLE001 - retried, then reported
            if attempt == 3:
                raise RuntimeError(f"Couldn't download {url}: {exc}") from exc
            time.sleep(2 + attempt * 3)
    raise AssertionError


def fetch(url: str, path: str, sha1: str | None = None, sha256: str | None = None) -> None:
    """Downloads url to path unless it's there with the right hash."""
    algo, want = ("sha1", sha1) if sha1 else ("sha256", sha256) if sha256 else (None, None)

    def ok(p: str) -> bool:
        if not os.path.isfile(p):
            return False
        if not algo:
            return True
        h = hashlib.new(algo)
        with open(p, "rb") as f:
            for chunk in iter(lambda: f.read(1 << 20), b""):
                h.update(chunk)
        return h.hexdigest() == want.lower()

    if ok(path):
        return
    os.makedirs(os.path.dirname(path), exist_ok=True)
    part = f"{path}.part{os.getpid()}"
    with open(part, "wb") as f:
        f.write(get(url))
    if not ok(part):
        os.remove(part)
        raise RuntimeError(f"{url} doesn't have the expected {algo}")
    os.replace(part, path)


# ── builds ──


def newest_nightly() -> tuple[str, str]:
    """(build id, release tag) of Horizon's newest Nightly with a linux-x86_64 build."""
    releases = json.loads(get(f"https://api.github.com/repos/{REPO}/releases?per_page=40", "application/vnd.github+json"))
    best = None
    for r in releases:
        name = r.get("name") or ""
        if r.get("draft") or not r["tag_name"].startswith("nightly") or not name.startswith("Nightly "):
            continue
        date, _, commit = name[len("Nightly "):].partition("·")
        date, commit = date.strip(), commit.strip().lower()
        names = {a["name"] for a in r.get("assets", [])}
        if len(date) != 10 or not commit or ASSET not in names or "SHA256SUMS.sig" not in names:
            continue
        build = f"nightly-{date}-{commit}"
        if best is None or build > best[0]:
            best = (build, r["tag_name"])
    if not best:
        raise RuntimeError("Horizon has no Nightly for linux-x86_64 right now")
    return best


def verify(sums: bytes, sig: bytes, tag: str) -> None:
    signed = b"horizon release " + (b"nightly" if tag.startswith("nightly") else tag.encode()) + b"\n" + sums
    with tempfile.TemporaryDirectory() as tmp:
        msg, sigf = os.path.join(tmp, "msg"), os.path.join(tmp, "sig")
        open(msg, "wb").write(signed)
        open(sigf, "wb").write(base64.b64decode(sig.strip()))
        for key in RELEASE_KEYS:
            pem = os.path.join(tmp, "key.pem")
            der = ED25519_SPKI + base64.b64decode(key)
            open(pem, "w").write("-----BEGIN PUBLIC KEY-----\n" + base64.b64encode(der).decode() + "\n-----END PUBLIC KEY-----\n")
            r = subprocess.run(["openssl", "pkeyutl", "-verify", "-pubin", "-inkey", pem, "-rawin", "-in", msg, "-sigfile", sigf], capture_output=True)
            if r.returncode == 0:
                return
    raise RuntimeError("Horizon's checksums aren't signed by Horizon: not installed")


def install(build: str, tag: str) -> str:
    target = os.path.join(SHARED, "builds", build)
    if os.path.isfile(os.path.join(target, ".installed")):
        return target
    say(f"Installing Horizon {build}")
    base = f"https://github.com/{REPO}/releases/download/{tag}"
    sums = get(f"{base}/SHA256SUMS")
    verify(sums, get(f"{base}/SHA256SUMS.sig"), tag)
    sha = next((l.split()[0] for l in sums.decode().splitlines() if l.split()[-1].lstrip("*") == ASSET), None)
    if not sha:
        raise RuntimeError(f"{ASSET} isn't in Horizon's signed checksums")
    archive = os.path.join(SHARED, "builds", f".{build}.tar.gz")
    fetch(f"{base}/{ASSET}", archive, sha256=sha)
    partial = os.path.join(SHARED, "builds", f".{build}.partial")
    shutil.rmtree(partial, ignore_errors=True)
    os.makedirs(partial)
    with tarfile.open(archive) as t:
        t.extractall(partial, filter="data")
    top = next((os.path.join(partial, d) for d in os.listdir(partial) if os.path.isfile(os.path.join(partial, d, "research-lock.json"))), partial)
    for name in ("horizon-engine", "horizon-prepare", "horizon-server"):
        if not os.path.isfile(os.path.join(top, name)):
            raise RuntimeError(f"This Horizon build has no {name}")
    shutil.rmtree(target, ignore_errors=True)
    os.rename(top, target)
    open(os.path.join(target, ".installed"), "w").close()
    shutil.rmtree(partial, ignore_errors=True)
    os.remove(archive)
    return target


def prune(keep: str) -> None:
    """Keeps the 3 newest builds (and their prepared files) plus the one in use."""
    builds = sorted((d for d in os.listdir(os.path.join(SHARED, "builds")) if d.startswith("nightly-")), reverse=True)
    for old in builds[3:]:
        if old != keep:
            shutil.rmtree(os.path.join(SHARED, "builds", old), ignore_errors=True)
            shutil.rmtree(os.path.join(SHARED, "prepared", old), ignore_errors=True)


# ── game files ──


def allowed(rules: list | None) -> bool:
    if not rules:
        return True
    ok = False
    for rule in rules:
        os_rule = rule.get("os")
        if os_rule and os_rule.get("name") not in (None, "linux"):
            continue
        if rule.get("features"):
            continue
        ok = rule.get("action") == "allow"
    return ok


def minecraft_files(build_dir: str) -> dict:
    """Minecraft 26.3's files as the build pins them, downloaded where missing."""
    lock = json.load(open(os.path.join(build_dir, "research-lock.json")))
    pin = lock["minecraft"]["manifest_sha1"]
    mc = os.path.join(SHARED, "minecraft")
    version_json = os.path.join(mc, f"{MINECRAFT}-{pin}.json")
    fetch(f"https://piston-meta.mojang.com/v1/packages/{pin}/{MINECRAFT}.json", version_json, sha1=pin)
    version = json.load(open(version_json))
    client = os.path.join(mc, f"client-{MINECRAFT}.jar")
    server = os.path.join(mc, f"server-{MINECRAFT}.jar")
    jobs = [
        (version["downloads"]["client"]["url"], client, version["downloads"]["client"]["sha1"]),
        (version["downloads"]["server"]["url"], server, version["downloads"]["server"]["sha1"]),
    ]
    libraries = os.path.join(mc, "libraries")
    for lib in version.get("libraries", []):
        art = (lib.get("downloads") or {}).get("artifact")
        if art and allowed(lib.get("rules")):
            jobs.append((art["url"], os.path.join(libraries, art["path"]), art["sha1"]))
    assets = os.path.join(mc, "assets")
    index = version["assetIndex"]
    index_file = os.path.join(assets, "indexes", f"{index['id']}.json")
    fetch(index["url"], index_file, sha1=index["sha1"])
    for name, obj in json.load(open(index_file))["objects"].items():
        # the server plays no sounds
        if name.startswith("minecraft/sounds/"):
            continue
        h = obj["hash"]
        jobs.append((f"https://resources.download.minecraft.net/{h[:2]}/{h}", os.path.join(assets, "objects", h[:2], h), h))
    say(f"Downloading Minecraft {MINECRAFT}'s files ({len(jobs)} files, once)")
    with ThreadPoolExecutor(16) as pool:
        list(pool.map(lambda j: fetch(j[0], j[1], sha1=j[2]), jobs))
    return {"version_json": version_json, "client": client, "server": server, "libraries": libraries, "assets": assets}


def prepare(build: str, build_dir: str) -> str:
    output = os.path.join(SHARED, "prepared", build)
    preparer = os.path.join(build_dir, "horizon-prepare")
    if subprocess.run([preparer, "--check", "--output", output], capture_output=True).returncode == 0:
        return output
    files = minecraft_files(build_dir)
    say(f"Preparing Horizon's game files from Minecraft {MINECRAFT} (once per Horizon version)")
    r = subprocess.run(
        [
            preparer, "--prepare",
            "--server-jar", files["server"],
            "--version-json", files["version_json"],
            "--client-jar", files["client"],
            "--libraries-dir", files["libraries"],
            "--assets-dir", files["assets"],
            "--java-home", JAVA_HOME,
            "--output", output,
        ],
        cwd=build_dir,
    )
    if r.returncode != 0:
        raise RuntimeError(f"Preparing Horizon's game files failed (exit {r.returncode})")
    return output


# ── the server ──


def properties() -> list[tuple[str, str]]:
    path = os.path.join(DATA, "server.properties")
    out = []
    if os.path.isfile(path):
        for line in open(path, encoding="utf-8", errors="replace"):
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                out.append((k.strip(), v.strip()))
    return out


def configure(server: str, build_dir: str, resources: str) -> None:
    if not os.path.isfile(os.path.join(DATA, "server.toml")):
        say("Setting up the Horizon server")
        subprocess.run([server, "--dir", DATA, "init", "--eula", "--world", "world", "--port", "25565", "--no-whitelist", "--yes"], check=True)
    settings = [f"engine.path={build_dir}/horizon-engine", f"engine.resources={resources}", "panel.bind="]
    for k, v in properties():
        # empty values Horizon refuses for typed keys (a seed or motd may be empty)
        if not v and k not in ("level-seed", "motd"):
            continue
        if k in ("server-port", "rcon.port", "enable-rcon", "rcon.password"):
            continue  # set from the container below
        if k in KEYS:
            settings.append(f"{KEYS[k]}={v}")
        elif all(c.isalnum() or c in "-._" for c in k):
            settings.append(f"properties.{k}={v}")
    # inside the container: the game on 25565, RCON for Tessera's console on 25575
    settings += ["server.port=25565", "properties.enable-rcon=true", "properties.rcon.port=25575"]
    if os.environ.get("RCON_PASSWORD"):
        settings.append(f"properties.rcon.password={os.environ['RCON_PASSWORD']}")
    if subprocess.run([server, "--dir", DATA, "config", "set", *settings], capture_output=True).returncode != 0:
        # one key Horizon doesn't take: set the rest one by one, so the server still starts
        for kv in settings:
            r = subprocess.run([server, "--dir", DATA, "config", "set", kv], capture_output=True, text=True)
            if r.returncode != 0:
                say(f"Horizon doesn't take {kv.split('=')[0]}: {r.stderr.strip()}")


# ── content mods ──

MODS_ZIP = os.path.join(DATA, ".tessera", "horizon-mods.zip")
# the files Tessera put in horizon-mods/ last time, so mods added by hand stay
MODS_RECORD = os.path.join(DATA, ".tessera", "horizon-mods.json")
MOD_FILE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}\.hmod$")
MOD_ID = re.compile(r'^\s*id\s*=\s*"([a-z0-9_]{1,64})"\s*$', re.M)


def mod_id(data: bytes) -> str | None:
    """A .hmod's id, from the horizon-mod.toml inside it."""
    import io

    try:
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            m = MOD_ID.search(z.read("horizon-mod.toml").decode("utf-8", "replace"))
    except (zipfile.BadZipFile, KeyError):
        return None
    return m.group(1) if m else None


def install_mods() -> None:
    """Puts the mods Tessera Launcher sent into horizon-mods/ (Horizon reads them from the
    server folder when it starts), removes the ones it sent before and no longer does, and
    turns them on in horizon-mods.txt (mod.<id>:true), keeping the file's other lines."""
    if not os.path.isfile(MODS_ZIP):
        return
    try:
        before = json.load(open(MODS_RECORD))
    except (OSError, ValueError):
        before = {}
    mods: dict[str, str] = {}  # file -> id
    folder = os.path.join(DATA, "horizon-mods")
    os.makedirs(folder, exist_ok=True)
    with zipfile.ZipFile(MODS_ZIP) as z:
        for info in z.infolist():
            name = info.filename
            if not MOD_FILE.match(name) or info.file_size > 64 << 20:
                say(f"Left out {name!r} from the mods: not a .hmod file")
                continue
            data = z.read(info)
            mid = mod_id(data)
            if not mid:
                say(f"Left out {name}: it has no horizon-mod.toml with an id")
                continue
            path = os.path.join(folder, name)
            if os.path.islink(path):
                os.unlink(path)
            tmp = path + ".part"
            with open(tmp, "wb") as f:
                f.write(data)
            os.replace(tmp, path)
            mods[name] = mid
    for name in before:
        if name not in mods and MOD_FILE.match(name):
            path = os.path.join(folder, name)
            if os.path.isfile(path) and not os.path.islink(path):
                os.remove(path)
    gone = set(before.values()) - set(mods.values())
    switches = os.path.join(DATA, "horizon-mods.txt")
    lines = []
    if os.path.isfile(switches) and not os.path.islink(switches):
        lines = open(switches, encoding="utf-8", errors="replace").read().splitlines()
    on = set(mods.values())
    lines = [l for l in lines if not any(l.startswith(f"mod.{i}:") for i in on | gone)]
    lines += [f"mod.{i}:true" for i in sorted(on)]
    with open(switches + ".part", "w", encoding="utf-8") as f:
        f.write("".join(l + "\n" for l in lines))
    os.replace(switches + ".part", switches)
    with open(MODS_RECORD, "w") as f:
        json.dump(mods, f)
    os.remove(MODS_ZIP)
    say(f"Installed {len(mods)} Horizon mod(s): {', '.join(sorted(on)) or 'none'}")


def main() -> None:
    os.makedirs(os.path.join(SHARED, "builds"), exist_ok=True)
    # one server at a time installs and prepares; the others wait and reuse it
    with open(os.path.join(SHARED, ".lock"), "w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        wanted = os.environ.get("HORIZON_BUILD", "latest")
        try:
            # a build id (nightly-<date>-<commit>) is released as the tag nightly-<date>
            build, tag = newest_nightly() if wanted == "latest" else (wanted, wanted.rsplit("-", 1)[0])
            build_dir = install(build, tag)
        except Exception as exc:  # noqa: BLE001 - offline: the newest build installed before
            have = sorted((d for d in os.listdir(os.path.join(SHARED, "builds")) if d.startswith("nightly-") and os.path.isfile(os.path.join(SHARED, "builds", d, ".installed"))), reverse=True)
            if wanted != "latest" and wanted in have:
                have = [wanted]
            if not have:
                raise
            say(f"{exc}; starting Horizon {have[0]}, installed before")
            build, build_dir = have[0], os.path.join(SHARED, "builds", have[0])
        resources = prepare(build, build_dir)
        prune(build)
        fcntl.flock(lock, fcntl.LOCK_UN)
    server = os.path.join(build_dir, "horizon-server")
    configure(server, build_dir, resources)
    os.makedirs(os.path.join(DATA, ".tessera"), exist_ok=True)
    try:
        install_mods()
    except Exception as exc:  # noqa: BLE001 - the server still starts, with the mods it had
        say(f"The mods couldn't be installed: {exc}")
    open(os.path.join(DATA, ".tessera", "horizon-build"), "w").write(build)
    say(f"Starting Horizon {build} (Minecraft {MINECRAFT})")
    sys.stdout.flush()
    os.chdir(DATA)
    os.execv(server, [server, "--dir", DATA, "run"])


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:  # noqa: BLE001 - shown in the console, then the container restarts
        say(f"Horizon couldn't start: {exc}")
        time.sleep(30)
        sys.exit(1)
