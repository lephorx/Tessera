#!/bin/sh
# Tessera interactive installer
# Usage: curl -fsSL https://raw.githubusercontent.com/lephorx/Tessera/main/scripts/install.sh | sh
set -eu
umask 077

REPO_URL=${CSCM_REPO_URL:-https://github.com/lephorx/Tessera.git}
ANSWER=

say() { printf '%s\n' "$*" >&2; }
fail() { say "Error: $*"; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || fail "$1 is required. See https://github.com/lephorx/Tessera#guided-installation"; }

ask() {
  prompt=$1
  default=$2
  [ -r /dev/tty ] || fail "An interactive terminal is required."
  if [ -n "$default" ]; then
    printf '%s [%s]: ' "$prompt" "$default" >/dev/tty
  else
    printf '%s: ' "$prompt" >/dev/tty
  fi
  IFS= read -r ANSWER </dev/tty || fail "Input ended during setup."
  [ -n "$ANSWER" ] || ANSWER=$default
}

ask_yes() {
  ask "$1 (y/n)" "$2"
  case "$ANSWER" in
    y|Y|yes|YES) ANSWER=yes ;;
    n|N|no|NO) ANSWER=no ;;
    *) fail "Please answer y or n." ;;
  esac
}

# Single-quoted dotenv values preserve spaces, # and $ without interpolation.
env_line() {
  key=$1
  value=$2
  case "$value" in *'
'*) fail "$key must be a single line." ;; esac
  escaped=$(printf '%s' "$value" | sed "s/'/\\\\'/g")
  printf "%s='%s'\n" "$key" "$escaped"
}

need git
need docker
need sed
docker compose version >/dev/null 2>&1 || fail "Docker Compose is required. Install Docker Desktop or the Compose plugin."
docker info >/dev/null 2>&1 || fail "Start Docker and grant this user access to the Docker daemon."

case "$(uname -s)" in
  Linux|Darwin) PLATFORM=$(uname -s) ;;
  *) fail "For Windows, use WSL 2 and follow https://github.com/lephorx/Tessera#guided-installation" ;;
esac

say "Tessera setup ($PLATFORM)"
INSTALL_DIR=$HOME/cscm
WEB_PORT=3000
DATA_DIR=$HOME/cscm-data
say "Defaults: install to $INSTALL_DIR, data in $DATA_DIR, dashboard on port $WEB_PORT."
ask_yes "Install with these defaults" y
if [ "$ANSWER" = no ]; then
  ask "Installation directory (must be empty)" "$INSTALL_DIR"
  INSTALL_DIR=$ANSWER
  ask "Dashboard port" "$WEB_PORT"
  WEB_PORT=$ANSWER
  ask "Persistent data directory" "$DATA_DIR"
  DATA_DIR=$ANSWER
fi
case "$INSTALL_DIR" in /*) ;; *) fail "Installation directory must be absolute." ;; esac
if [ -e "$INSTALL_DIR" ] && [ -n "$(ls -A "$INSTALL_DIR" 2>/dev/null)" ]; then
  fail "$INSTALL_DIR is not empty. Choose another directory to protect existing data."
fi
case "$WEB_PORT" in *[!0-9]*|'') fail "Dashboard port must be numeric." ;; esac
[ "$WEB_PORT" -ge 1 ] && [ "$WEB_PORT" -le 65535 ] || fail "Port must be between 1 and 65535."
case "$DATA_DIR" in /*) ;; *) fail "Data directory must be absolute." ;; esac
SERVER_DIR=$DATA_DIR/servers
BACKUP_DIR=$DATA_DIR/backups
DB_DIR=$DATA_DIR/data

say "Downloading Tessera from ${REPO_URL}…"
git clone --depth 1 "$REPO_URL" "$INSTALL_DIR" || fail "Could not clone Tessera. Check the repository is public and retry."
mkdir -p "$SERVER_DIR" "$BACKUP_DIR" "$DB_DIR"

{
  printf '%s\n' "# Tessera settings. Playit and Cloudflare are set up in the dashboard after you"
  printf '%s\n' "# create your account, or add them here and run: docker compose restart api"
  env_line WEB_PORT "$WEB_PORT"
  env_line DATA_DIR_HOST "$DB_DIR"
  env_line SERVERS_DIR_HOST "$SERVER_DIR"
  env_line BACKUPS_DIR_HOST "$BACKUP_DIR"
  env_line PLAYIT_HEADLESS true
  env_line JWT_LIFETIME_HOURS 8
  env_line TOTP_ISSUER Tessera
} > "$INSTALL_DIR/.env"
chmod 600 "$INSTALL_DIR/.env"

say "Starting Tessera…"
cd "$INSTALL_DIR"
docker compose up --build -d

# Creating the first account needs the one-time setup code the API prints to
# its log, so nobody else on the network can claim the admin account first.
SETUP_CODE=
tries=0
while [ $tries -lt 45 ]; do
  SETUP_CODE=$(docker compose logs --no-color api 2>/dev/null | sed -n 's/.*Setup code: \([A-Z0-9-]*\).*/\1/p' | tail -n 1)
  [ -n "$SETUP_CODE" ] && break
  tries=$((tries + 1))
  sleep 2
done

say "Tessera is ready at http://localhost:$WEB_PORT"
if [ -n "$SETUP_CODE" ]; then
  say ""
  say "  Setup code: $SETUP_CODE"
  say ""
  say "Enter it on the setup page to create your account (shown again by:"
  say "  cd $INSTALL_DIR && docker compose logs api | grep \"Setup code\")."
else
  say "To create your account you need the setup code from the log:"
  say "  cd $INSTALL_DIR && docker compose logs api | grep \"Setup code\""
fi
say "Open it, create your account, then set up public access (Playit) right in the dashboard."
say "Installation: $INSTALL_DIR"
say "Docs: https://github.com/lephorx/Tessera"
