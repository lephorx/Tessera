#!/bin/sh
# Stops the dashboard and the Minecraft servers when the package is removed
# (not on upgrades). Worlds, backups and settings stay.
case "${1:-}" in upgrade|failed-upgrade|1) exit 0 ;; esac
/usr/bin/tessera stop-all || true
exit 0
