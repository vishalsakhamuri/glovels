#!/bin/bash
# Double-click this file in Finder to run the Glovels site on your Mac.
#
# It starts the local server (which also runs the database behind the student
# portal) and opens the site in your browser.

cd "$(dirname "$0")" || exit 1
PORT="${1:-8080}"

if ! command -v node >/dev/null 2>&1; then
  echo
  echo "  Node is not installed on this Mac, and the server needs it."
  echo
  echo "  Install it once from https://nodejs.org — download the LTS button,"
  echo "  run the installer, then double-click this file again."
  echo
  read -r -p "  Press Return to close. "
  exit 1
fi

# Node 18 is the floor: the server uses the built-in test of node:sqlite and
# modern fetch behaviour. Older Node still runs, on the file-backed store.
MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$MAJOR" -lt 18 ]; then
  echo "  Node $MAJOR is quite old. Please update from https://nodejs.org."
  read -r -p "  Press Return to close. "
  exit 1
fi

( sleep 1.5; open "http://localhost:$PORT/" >/dev/null 2>&1 ) &
exec node serve.js "$PORT"
