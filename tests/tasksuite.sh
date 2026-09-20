#!/bin/bash
# Every suite for the task board, each on a server of its own.
#
# The restart between suites is not tidiness. Placing an order is rate
# limited to ten an hour from one address, and the counter lives in memory,
# so running these back to back against one server silently refuses the
# later orders and the suites then fail in ways that look like real bugs and
# are not. Each suite gets a fresh process and a fresh database.
cd "$(dirname "$0")/.."
PORT=${PORT:-8099}
FAILED=0
for t in tasktest phasetest servicetasktest asktest slatest taskhardtest taskuitest phaseuitest; do
  rm -rf "/tmp/db-$PORT"
  bash tests/srv.sh "$PORT" > /dev/null 2>&1
  sleep 2
  printf '%-18s ' "$t"
  OUT=$(BASE="http://localhost:$PORT" node "tests/$t.js" 2>&1)
  echo "$OUT" | tail -2 | tr '\n' ' '
  echo
  if echo "$OUT" | grep -q '✗\|STOPPED\|failed' && ! echo "$OUT" | grep -q '0 failed'; then
    FAILED=1
    echo "$OUT" | grep '✗\|STOPPED' | sed 's/^/    /'
  fi
done
exit $FAILED
