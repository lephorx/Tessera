#!/bin/sh
# Sets Tessera up right after the package is installed or upgraded: starts
# Docker, downloads Tessera into /opt/tessera, starts it and shows the setup
# code. A failure here doesn't fail the package; "sudo tessera setup" retries.
case "${1:-}" in abort-*) exit 0 ;; esac
/usr/bin/tessera setup || {
  echo ""
  echo "Tessera isn't running yet. Fix the problem above, then run: sudo tessera setup"
}
exit 0
