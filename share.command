#!/bin/bash
# ---------------------------------------------------------------------------
# Put this laptop's copy on a public HTTPS address, so counsellors can test it
# from their own machines — without hosting anything.
#
# It uses a Cloudflare quick tunnel: no account, no card, no DNS. Cloudflare
# gives out a random https://something.trycloudflare.com address that points at
# this Mac for as long as this window stays open. Close it and the link dies.
#
# It runs in PRODUCTION mode with a FRESHLY GENERATED password, because the
# moment a link is public the demo password printed in the README is an open
# door to every student file. The password is printed below and nowhere else.
# ---------------------------------------------------------------------------

cd "$(dirname "$0")" || exit 1
PORT="${1:-8080}"

if ! command -v node >/dev/null 2>&1; then
  echo "  Node is not installed. Get it from https://nodejs.org and try again."
  read -r -p "  Press Return to close. " ; exit 1
fi

if ! command -v cloudflared >/dev/null 2>&1; then
  echo
  echo "  This needs cloudflared, which makes the public address."
  echo
  echo "    brew install cloudflared"
  echo
  echo "  (If you do not have Homebrew: https://brew.sh — one line to install.)"
  echo
  read -r -p "  Press Return to close. " ; exit 1
fi

# A password nobody has seen before, including whoever wrote this script.
PW="$(LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c 18)"
ADMIN_PW="$(LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c 24)"

echo
echo "  Opening a public address for this Mac…"
echo

# Start the tunnel first, so the real URL is known before the server boots —
# the server bakes it into password-reset links and order emails.
LOG="$(mktemp)"
cloudflared tunnel --url "http://localhost:$PORT" --no-autoupdate > "$LOG" 2>&1 &
TUNNEL_PID=$!
cleanup() { kill "$TUNNEL_PID" 2>/dev/null; kill "$SERVER_PID" 2>/dev/null; }
trap cleanup EXIT INT TERM

URL=""
for _ in $(seq 1 40); do
  URL="$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$LOG" | head -1)"
  [ -n "$URL" ] && break
  sleep 0.5
done

if [ -z "$URL" ]; then
  echo "  Cloudflare did not give out an address. What it said:"
  sed 's/^/    /' "$LOG" | tail -12
  read -r -p "  Press Return to close. " ; exit 1
fi

# A fresh database per share, so a test link never exposes real student data
# that has built up on this laptop.
export DATA_DIR="./data-shared"

GLOVELS_ENV=production \
GLOVELS_URL="$URL" \
SEED_DEMO=true \
DEMO_PASSWORD="$PW" \
ADMIN_EMAIL="admin@glovels.com" \
ADMIN_PASSWORD="$ADMIN_PW" \
PORT="$PORT" \
node serve.js > /dev/null 2>&1 &
SERVER_PID=$!
sleep 3

cat <<BANNER

  ────────────────────────────────────────────────────────────────
   Glovels is live for testing at

     $URL

   Send that link to your counsellors. Sign-in details:

     Student      student@glovels.com
     Counsellor   kavya@glovels.com
     Admin        admin@glovels.com
     Password     $PW   (for all three)

   Notes worth passing on:
     · The link works only while this window is open.
     · Test data goes in data-shared/, not your normal data/ folder.
     · No payment is taken. Orders are recorded, nothing is charged.
     · Two people signing in as the same account will collide —
       give each tester their own by creating accounts on the site.
  ────────────────────────────────────────────────────────────────

  Press Control-C to take it offline.

BANNER

wait $SERVER_PID
