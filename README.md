# Tessera

> Tessera is not an official Minecraft product. Not approved by or associated
> with Mojang or Microsoft.

Tessera is a self-hosted dashboard for creating and running Minecraft servers
on your own machine. It runs in Docker, starts every Minecraft server in its own
container, and works together with [Tessera Launcher](https://tesseralauncher.com):
a modpack from the launcher becomes a server in a few clicks.

- **Servers:** Java (Vanilla, Paper, Purpur, Fabric, Forge), Bedrock and
  [Horizon](#horizon). Start, stop, live console, files, `server.properties`,
  MOTD and icon.
- **Players:** whitelist, operators and bans.
- **Backups:** zip or copy backups (ZFS snapshots where available), restore
  with one click.
- **Public access:** Playit.gg addresses, optionally under your own domain
  through Cloudflare DNS. Local-only servers need neither.
- **Tessera Launcher:** create a server from a launcher modpack, and send an
  instance's server-side mods to a linked server.
- **Account security:** one local admin account with an authenticator app (2FA).
- **Updates:** a banner offers one-click updates when a new version is out.

Formerly called CSCM. The dashboard (Next.js) serves the UI and passes
`/api/*` requests to the Flask API. Docker Compose runs both as one stack and
only publishes the dashboard port.

## Guided installation

On Linux or macOS, run:

```sh
curl -fsSL https://raw.githubusercontent.com/lephorx/Tessera/main/scripts/install.sh | sh
```

To read the script before running it:

```sh
curl -fsSLO https://raw.githubusercontent.com/lephorx/Tessera/main/scripts/install.sh
less install.sh
sh install.sh
```

**On Linux** the installer asks which distribution you use (it suggests the one
it detects) and installs the matching [package](#linux-packages). The package
installs Docker and Git if they're missing, builds and starts Tessera, and
shows the **setup code** you need to create your account. Pick "Something
else" for a distribution without a package; that works like macOS below.

**On macOS** (and "Something else") you need Docker with Compose and Git. The
installer asks one question: install with the defaults (Tessera in `~/cscm`,
data in `~/cscm-data`, dashboard on port 3000), or pick the folders and port.
Then it downloads Tessera from `https://github.com/lephorx/Tessera`, writes
`.env`, starts it and shows the setup code.

Open `http://localhost:3000`, enter the setup code, create your account and
scan the QR code with your authenticator app. The dashboard then walks you
through the rest: local-only or public servers, your Playit account, a Playit
agent that Tessera runs for you (paste its `SECRET_KEY`) or one you already
run, and optional Cloudflare custom DNS. Progress is saved as you go. Change
it later from the settings button in the top bar.

On Windows, run the installer in WSL 2 with Docker Desktop's WSL integration
turned on, and pick "Something else" (it's suggested there): the packages would
install a second Docker next to Docker Desktop. On macOS and Windows, turn on host networking in Docker Desktop
before letting Tessera run the Playit agent.

Lost the setup code? It stays in the log until the account exists:
`sudo tessera setup-code` (Linux packages), or

```sh
cd ~/cscm && docker compose logs api | grep "Setup code"
```

### Uninstall

Installed from a Linux package: `sudo tessera uninstall`, then remove the
package. Otherwise:

```sh
curl -fsSL https://raw.githubusercontent.com/lephorx/Tessera/main/scripts/uninstall.sh | sh
```

It removes the Minecraft and Playit containers Tessera created, the dashboard
containers and images, and the installation folder. It asks separately before
deleting worlds, backups and the database. Delete your servers in the dashboard
first so Tessera removes their Playit tunnels and Cloudflare DNS records.

## Linux packages

Each package installs everything Tessera needs: Docker, Docker Compose and Git
from your distribution, then Tessera itself in `/opt/tessera` (settings in
`/opt/tessera/.env`), with worlds, backups and the database in
`/var/lib/tessera`. It starts Docker, builds and starts Tessera (a few minutes
the first time), and prints the dashboard address and the setup code. Pick
yours:

<details>
<summary><b>Debian, Ubuntu, Linux Mint, Pop!_OS</b> (.deb)</summary>

```sh
curl -fsSLO https://github.com/lephorx/Tessera/releases/latest/download/tessera.deb
sudo apt update && sudo apt install ./tessera.deb
```

Debian 12 has no Docker Compose v2 package; Tessera downloads Docker's own
build (checked against its published checksum).
</details>

<details>
<summary><b>Fedora</b> (.rpm)</summary>

```sh
sudo dnf install https://github.com/lephorx/Tessera/releases/latest/download/tessera.rpm
```
</details>

<details>
<summary><b>RHEL, Rocky Linux, AlmaLinux, CentOS Stream</b> (.rpm)</summary>

These ship no Docker, so add Docker's repository first (use `rhel` instead of
`centos` in the URL on RHEL):

```sh
sudo dnf install -y dnf-plugins-core
sudo dnf config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo
sudo dnf install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo dnf install https://github.com/lephorx/Tessera/releases/latest/download/tessera.rpm
```
</details>

<details>
<summary><b>openSUSE</b> (.rpm)</summary>

```sh
curl -fsSLO https://github.com/lephorx/Tessera/releases/latest/download/tessera.rpm
sudo zypper install --allow-unsigned-rpm ./tessera.rpm
```
</details>

<details>
<summary><b>Arch, Manjaro, EndeavourOS</b> (.pkg.tar.zst)</summary>

```sh
curl -fsSLO https://github.com/lephorx/Tessera/releases/latest/download/tessera.pkg.tar.zst
sudo pacman -U tessera.pkg.tar.zst
```
</details>

Other distributions: install Docker (with Compose) and Git, then use the
[guided installation](#guided-installation) and pick "Something else".

The packages add the `tessera` command:

| Command | What it does |
| --- | --- |
| `sudo tessera status` | Is it running, and on which port |
| `sudo tessera setup-code` | The code for creating your account |
| `sudo tessera logs` | Follow the logs |
| `sudo tessera start`, `stop`, `restart` | Start or stop the dashboard |
| `sudo tessera update` | Download the newest version (the dashboard's update button works too) |
| `sudo tessera port 8080` | Move the dashboard to another port |
| `sudo tessera setup` | Set up again or repair, e.g. after a failed first start |
| `sudo tessera uninstall` | Remove Tessera, asking before it deletes worlds and backups |

Removing the package (`apt remove`, `dnf remove`, `zypper remove`,
`pacman -R`) stops Tessera and its servers and keeps everything else.
`apt purge` also deletes `/opt/tessera` and Tessera's containers. Worlds and
backups in `/var/lib/tessera` are only deleted by `tessera uninstall` when you
confirm it.

The packages are built by `.github/workflows/packages.yml` from
`packaging/linux/` whenever `backend/VERSION` changes, and published as a
GitHub release.

## Manual installation

1. Clone the repository and copy `.env.example` to `.env`:

   ```sh
   git clone https://github.com/lephorx/Tessera.git cscm
   cd cscm
   cp .env.example .env
   ```

2. Set `SERVERS_DIR_HOST` and `BACKUPS_DIR_HOST` to absolute paths on the
   Docker host. Playit and Cloudflare can be set up in the dashboard later,
   or here (`PLAYIT_*`, `CLOUDFLARE_*`).
3. Start it:

   ```sh
   docker compose up --build -d
   ```

4. Open `http://localhost:3000` (or the port in `WEB_PORT`) and create your
   account with the setup code from `docker compose logs api | grep "Setup code"`.

The dashboard listens on every network interface, so the setup code makes sure
only someone who can read this machine's logs becomes the admin, not whoever on
the network opens the page first. It stays the same across restarts and is
deleted once the account exists.

The SQLite database is stored at `${DATA_DIR_HOST:-./data}/cscm.db`. Tessera
needs the host's Docker socket to manage the Minecraft containers. After
editing `.env`, run `docker compose restart api`. `GET /health` on the
dashboard checks the API.

## Changing the domain

Change the Cloudflare domain or zone ID in **Settings**, or edit `CLOUDFLARE_BASE_DOMAIN`
and `CLOUDFLARE_ZONE_ID` in `.env` and run `docker compose up -d` (Tessera notices the
change when it starts). Either way, Tessera creates new records for every server with a
public address (`survival.<new domain>` and its SRV record) and the dashboard shows the
new addresses. The old records are **not deleted**: they stay in Cloudflare, so the old
addresses keep working until you remove them there. Turning Cloudflare off works the same
way: the dashboard shows the Playit addresses again and the records stay. A server whose
new record fails keeps its old address and is tried again at the next start.

## Horizon

[Horizon](https://github.com/horizon-rust/horizon) is Minecraft: Java Edition
26.3 rewritten in Rust (MIT, unofficial): fast and light on memory. Players join
with Minecraft 26.3 or Horizon. Pick **Horizon (Rust)** as the server type.

The server runs in the same `itzg/minecraft-server:java25` image as the Java
servers, with [`backend/horizon/horizon_server.py`](backend/horizon/horizon_server.py)
as its entrypoint. On every start it installs Horizon's newest Nightly server
build (checked against Horizon's Ed25519-signed `SHA256SUMS`), and once per build
downloads Minecraft 26.3's files from Mojang and prepares Horizon's game files
from them (a few minutes the first time). Builds and prepared files live in
`<servers folder>/_horizon`, shared by all Horizon servers. Settings, the console
(RCON), players, backups and restarts work as for Java servers; the memory field
is the container's limit (Horizon has no JVM).

Horizon only builds its server for 64-bit Intel/AMD Linux; on other machines
(Apple silicon, ARM boards) Docker has to emulate it, which is much slower.
### Horizon mods

Horizon's content mods (`.hmod`) come from Tessera Launcher: a Horizon instance's
turned-on mods that run on servers (`side = "both"` or `"server"` in their
manifest) are sent with `PUT /api/servers/<id>/horizon-mods` (a zip of the
`.hmod` files) when you change them, or with **Sync mods** on the instance's
server. At the next start the server puts them in `horizon-mods/` and turns them
on in `horizon-mods.txt`, where Horizon reads them; mods it sent before and no
longer does are removed, mods you put there yourself stay. Players join with the
same mods, which Horizon checks. Client-only mods (a HUD, a minimap) stay on the
player's computer. Native mods (`.hnmod`) aren't installed on servers: they need
a Horizon engine compiled with them.

## Server networks

Every server runs on a Docker network of its own (`cscm-mc-net-<id>`, host
interface `tmc<id>`). One server's mods can't reach another server's container,
which matters once people you don't know run modpacks on your machine. Players
connect through the published port as before.

Docker hands out about 30 networks from its default address ranges. For more
servers, give it a bigger pool in `/etc/docker/daemon.json` and restart Docker:

```json
{ "default-address-pools": [{ "base": "10.208.0.0/16", "size": 28 }] }
```

Pick a range your network doesn't use. Servers created before this version stay
on the default bridge until they're recreated. To keep every server on the
default bridge, set `MC_NETWORK_ISOLATION=false` in `.env`.

## Updates

The dashboard checks `backend/VERSION` on the `main` branch about once an hour.
When a newer version is out, a banner offers a one-click update: a short-lived
helper container runs `git pull --ff-only`, downloads the new version's images
and restarts Tessera with them. `.env`, servers, backups and the database stay
untouched.

GitHub builds the images for each version (`ghcr.io/lephorx/tessera-api` and
`tessera-web`, for 64-bit Intel/AMD and ARM; `.github/workflows/images.yml`), so
an update only downloads the layers that changed instead of building everything
on your machine. The banner waits until a new version's images are published (a
few minutes after the release). Without them (offline, a fork) Tessera builds
the images itself, as before.

To update by hand:

```sh
cd ~/cscm && git pull --ff-only && sh scripts/up.sh
```

To turn the automatic check off, use the switch under **Settings > About &
privacy**, or set `CSCM_UPDATE_CHECK=0` in `.env` and run
`docker compose restart api`. "Check for updates" in the top bar still works.

Maintainers publish an update by bumping `backend/VERSION` on `main`, together
with the two image tags in `docker-compose.yml` (the Images workflow fails when
they differ).

## Minecraft EULA

Every new server needs the Minecraft EULA (https://aka.ms/MinecraftEULA)
accepted by the person creating it: the dashboard shows an unchecked checkbox,
and the API (`POST /api/servers`, `POST /api/servers/from-pack`) rejects
requests without `"eula": true` with a 400. Tessera only passes `EULA=TRUE` to
the server container after that, and stores when and by whom it was accepted.
Bedrock Dedicated Server also falls under the Microsoft Privacy Policy
(https://go.microsoft.com/fwlink/?LinkId=521839). Servers created before this
check count as accepted. The CLI (`backend/main.py`) needs `--accept-eula`.

## Privacy

Tessera is self-hosted: your data stays on the machine it runs on, and whoever
runs the installation is responsible for it. Nothing is sent to the Tessera
developers. Stored locally: user accounts (username, hashed password, 2FA
secret), server settings, worlds and backups, player names and UUIDs on player
lists, and logs (dashboard request logs and Minecraft server logs contain IP
addresses).

Outbound connections:

- `raw.githubusercontent.com`: update check about once an hour (can be turned
  off, see above); updating runs `git pull` and rebuilds the Docker images.
- Mojang API (`api.mojang.com`): player UUID lookups for player lists.
- From the browser: player heads from `mc-heads.net`, item icons from
  `minecraft.wiki`, and the version list from `launchermeta.mojang.com`.
- Fabric/Forge loader version lists (`meta.fabricmc.net`,
  `maven.minecraftforge.net`, `files.minecraftforge.net`), fetched by the
  dashboard server for the version picker.
- Docker Hub: the `itzg` server images, which download the server software
  when a server starts.
- Playit.gg, only if set up; Cloudflare, only if set up.
- Tessera Cloud, only if this machine is linked
  ([privacy](https://tesseralauncher.com/privacy),
  [terms](https://tesseralauncher.com/terms)).

The dashboard shows the same under **Settings > About & privacy** and at
`/about`.

## Move from CSCM-Tool

Copy the old `.env` to this repository's root and keep `SERVERS_DIR_HOST` and
`BACKUPS_DIR_HOST` pointing at the original server and backup folders, so the
existing Minecraft containers keep their data. Copy the active `cscm.db` to
`data/cscm.db` before starting the stack. The database and `.env` are ignored
by Git. This repository combines the histories of `CSCM-Tool` and
`CSCM-Webpage`; old runtime configuration, database and certificate files were
removed from the public history.

## Development

For an API running on the host, copy `backend/.env.example` to `backend/.env`.
Set `SERVERS_DIR`, `BACKUPS_DIR`, `SERVERS_DIR_HOST` and `BACKUPS_DIR_HOST` to
writable absolute host paths; each inside/host pair points to the same folder.
Set `DB_PATH` and `AUTH_DB_PATH` to the same SQLite file, such as the absolute
path of `data/cscm.db`. Then run the API from `backend/` and the dashboard from
`frontend/`:

```sh
cd backend
python -m pip install -r requirements.txt
playwright install chromium
python app.py
```

```sh
cd frontend
pnpm install
CSCM_API_URL=http://localhost:5000 pnpm dev
```

The dashboard listens on port 3000 and forwards requests to the API on port
5000. The API is documented in `backend/README.md` and `backend/openapi.yaml`.

## License

MIT, see [LICENSE](LICENSE). Third-party software, fonts and images are listed
in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Team

Tessera is made by [lephor](https://github.com/lephorx) and [Nanoriddler](https://github.com/Nanoriddler).
