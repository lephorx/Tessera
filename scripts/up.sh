#!/bin/sh
# Starts Tessera with the images GitHub built for this version (ghcr.io/lephorx/tessera-api
# and tessera-web, named in docker-compose.yml): an update then downloads only the layers
# that changed. Without them (offline, a fork, a version still being built) the images are
# built here, as before. Run from the installation folder; extra arguments go to
# `docker compose` (for example -p <project>).
set -eu
if docker compose "$@" pull --quiet api web; then
  docker compose "$@" up -d --no-build --remove-orphans
else
  echo "No prebuilt images for this version: building them here (a few minutes)…"
  docker compose "$@" up -d --build --remove-orphans
fi
# the replaced images take space; they're never needed again
docker image prune -a -f --filter "label=org.opencontainers.image.source=https://github.com/lephorx/Tessera" >/dev/null 2>&1 || true
