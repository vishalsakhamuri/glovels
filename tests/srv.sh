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
holders() {
  local out=""
  local pid
  for pid in $(pgrep -f "node serve.js"); do
    if tr '\0' '\n' < "/proc/$pid/environ" 2>/dev/null | grep -qx "PORT=$PORT"; then
      out="$out $pid"
    fi
  done
  echo $out
}

for pid in $(holders); do kill "$pid" 2>/dev/null; done

# WAIT for it to actually go, rather than sleeping a second and hoping.
#
# `rm -rf` on a database an old server still has open does not give you an
# empty database: the process is still writing, and the file comes back with
# yesterday's rows in it. That is what was behind three different suites going
# red under the full run and green on their own — leadtest, servicetest and
# seotest all inherited data from the run before and failed on a duplicate that
# should not have existed.
for i in $(seq 1 40); do
  [ -z "$(holders)" ] && break
  sleep 0.25
done
# Still there after ten seconds: it is not going to stop politely.
for pid in $(holders); do kill -9 "$pid" 2>/dev/null; done
sleep 0.5

rm -rf "$DIR"; mkdir -p "$DIR"
cd /home/claude/glovels/build || exit 1
setsid env PORT="$PORT" DATA_DIR="$DIR" "$@" node serve.js > "/tmp/serve-$PORT.log" 2>&1 < /dev/null &
# Sixty seconds, not twenty. Boot seeds 171 programmes, six blog posts and three
# accounts, and under the load of a full run — with the previous suite's browser
# still shutting down — it does not always finish inside twenty. The runner then
# printed "SERVER FAILED", and the suites after it died on connection errors,
# which reads exactly like a code regression and is not one.
for i in $(seq 1 120); do
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
