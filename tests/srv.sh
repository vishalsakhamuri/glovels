#!/bin/bash
# Start a Glovels server on a port with a fresh database, and wait until it
# answers. Doing this inline in a compound command kept killing the shell that
# launched it; a script that setsids and polls is the reliable form.
#   ./srv.sh 8099 [extra env assignments...]
PORT=${1:-8099}; shift
DIR=/tmp/db-$PORT
# Kill whatever holds the port. Matching on the command line failed silently —
# `setsid env PORT=... node serve.js` does not contain the string "PORT=8099 node
# serve.js" — so the old process kept answering the health check and every test
# ran against stale code.
# `ss` is not installed here, so ask the kernel: /proc/net/tcp holds the
# listening socket's inode, and one of the process fds points at it.
for pid in $(pgrep -f "node serve.js"); do
  if tr '\0' '\n' < "/proc/$pid/environ" 2>/dev/null | grep -qx "PORT=$PORT"; then
    kill "$pid" 2>/dev/null
  fi
done
sleep 1
rm -rf "$DIR"; mkdir -p "$DIR"
cd "$(dirname "$0")/.." || exit 1
setsid env PORT="$PORT" DATA_DIR="$DIR" "$@" node serve.js > "/tmp/serve-$PORT.log" 2>&1 < /dev/null &
for i in $(seq 1 40); do
  sleep 0.5
  # A health check alone is not proof THIS server started. When an older
  # process still holds the port, the new one dies with EADDRINUSE and the old
  # one answers happily — every test then runs against stale code and a stale
  # database, which is how a suite goes green on yesterday's build.
  if grep -q EADDRINUSE "/tmp/serve-$PORT.log" 2>/dev/null; then
    echo "FAILED: port $PORT is still held by an older server"
    pgrep -af "node serve.js"
    exit 1
  fi
  if curl -sf "http://localhost:$PORT/api/health" > /dev/null; then
    echo "up on $PORT"; exit 0
  fi
done
echo "FAILED to start on $PORT"; tail -20 "/tmp/serve-$PORT.log"; exit 1
