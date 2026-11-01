#!/bin/sh
# After removal: say what's left. "apt purge" also deletes /opt/tessera (code
# and .env with saved credentials) and Tessera's containers; worlds and backups
# in /var/lib/tessera always stay.
case "${1:-}" in
  upgrade|failed-upgrade|1|abort-*) exit 0 ;;
  purge)
    if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
      ids="$(docker ps -aq --filter label=cscm.managed=true) $(docker ps -aq --filter label=cscm.playit=true)"
      [ -z "${ids# }" ] || docker rm -f $ids >/dev/null 2>&1 || true
      [ -f /opt/tessera/docker-compose.yml ] \
        && (cd /opt/tessera && docker compose -p tessera down --rmi local --remove-orphans >/dev/null 2>&1) || true
    fi
    rm -rf /opt/tessera
    echo "Tessera was removed. Your worlds, backups and database are still in /var/lib/tessera."
    ;;
  *)
    echo "Tessera is stopped. /opt/tessera (settings) and /var/lib/tessera (worlds, backups)"
    echo "are kept. Install the package again to continue, or delete those folders."
    ;;
esac
exit 0
