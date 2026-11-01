# Tessera

> Tessera is not an official Minecraft product. Not approved by or associated
> with Mojang or Microsoft.

Tessera is a self-hosted dashboard for creating and running Minecraft servers
on your own machine. It runs in Docker, starts every Minecraft server in its own
container, and works together with [Tessera Launcher](https://tesseralauncher.com):
a modpack from the launcher becomes a server in a few clicks.

- **Servers:** Java (Vanilla, Paper, Purpur, Fabric, Forge) and Bedrock.
  Start, stop, live console, files, `server.properties`, MOTD and icon.
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

You need Docker (with Compose) and Git. On macOS or Linux, run:

```sh
curl -fsSL https://raw.githubusercontent.com/lephorx/Tessera/main/scripts/install.sh | sh
```

To read the script before running it:

```sh
curl -fsSLO https://raw.githubusercontent.com/lephorx/Tessera/main/scripts/install.sh
less install.sh
sh install.sh
```

The installer:

1. checks that Git and Docker are installed and Docker is running;
2. asks one question: install with the defaults (Tessera in `~/cscm`, data in
   `~/cscm-data`, dashboard on port 3000), or pick the folders and port;
3. downloads Tessera from `https://github.com/lephorx/Tessera`, writes `.env`
   and starts the stack;
4. shows the **setup code** you need to create your account.

Open `http://localhost:3000`, enter the setup code, create your account and
scan the QR code with your authenticator app. The dashboard then walks you
through the rest: local-only or public servers, your Playit account, a Playit
agent that Tessera runs for you (paste its `SECRET_KEY`) or one you already
run, and optional Cloudflare custom DNS. Progress is saved as you go. Change
it later from the settings button in the top bar.

On Windows, run the installer from WSL 2 with Docker Desktop's WSL integration
turned on. On macOS and Windows, turn on host networking in Docker Desktop
before letting Tessera run the Playit agent.

Lost the setup code? It stays in the log until the account exists:

```sh
cd ~/cscm && docker compose logs api | grep "Setup code"
```

### Uninstall

```sh
curl -fsSL https://raw.githubusercontent.com/lephorx/Tessera/main/scripts/uninstall.sh | sh
```

It removes the Minecraft and Playit containers Tessera created, the dashboard
containers and images, and the installation folder. It asks separately before
deleting worlds, backups and the database. Delete your servers in the dashboard
first so Tessera removes their Playit tunnels and Cloudflare DNS records.

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

## Updates

The dashboard checks `backend/VERSION` on the `main` branch about once an hour.
When a newer version is out, a banner offers a one-click update: a short-lived
helper container runs `git pull --ff-only` and `docker compose up --build -d`.
`.env`, servers, backups and the database stay untouched.

To update by hand:

```sh
cd ~/cscm && git pull --ff-only && docker compose up --build -d
```

To turn the automatic check off, use the switch under **Settings > About &
privacy**, or set `CSCM_UPDATE_CHECK=0` in `.env` and run
`docker compose restart api`. "Check for updates" in the top bar still works.

Maintainers publish an update by bumping `backend/VERSION` on `main`.

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
