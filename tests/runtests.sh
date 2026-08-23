#!/bin/bash
# Every suite, each against a database that has just been created.
#
# Order matters less than isolation: several of these delete universities or
# rewrite the home page, and a suite that inherits another's leftovers passes or
# fails for reasons that have nothing to do with the code.
cd /home/claude/glovels || exit 1
PASS=0; FAIL=0; REPORT=/tmp/testreport.txt
: > "$REPORT"

run() {                       # run <suite> <port> [env...]
  local suite=$1 port=$2; shift 2
  ./srv.sh "$port" "$@" > /dev/null || { echo "SERVER FAILED for $suite" | tee -a "$REPORT"; FAIL=$((FAIL+1)); return; }
  # A moment for the previous suite's browser to actually exit. Without it the
  # next one starts while a dozen chromium processes are still shutting down,
  # and a click times out for reasons that have nothing to do with the code.
  sleep 4
  local out
  out=$(node "$suite" 2>&1 | tail -3)
  local line
  line=$(echo "$out" | grep -oE '[0-9]+ passed, [0-9]+ failed' | tail -1)
  [ -z "$line" ] && line="did not report a count"
  if echo "$line" | grep -q '^[0-9]* passed, 0 failed$'; then
    printf '  ok    %-18s %s\n' "$suite" "$line" | tee -a "$REPORT"
    PASS=$((PASS+1))
  else
    printf '  FAIL  %-18s %s\n' "$suite" "$line" | tee -a "$REPORT"
    echo "$out" | sed 's/^/          /' >> "$REPORT"
    FAIL=$((FAIL+1))
  fi
}

echo "=== the suites ===" | tee -a "$REPORT"
run contenttest.js  8099
run hometest.js     8099
run appendtest.js   8099
run bulktest.js     8099
run aitest.js       8099
run writingtest.js  8099
run chatboxtest.js  8099
run reqtest.js      8099
run findertest.js   8099
run ordertest.js    8099
run admintest.js    8099
run gatetest.js     8099
run shortlisttest.js 8099
run applytest.js    8099
run blogtest.js     8099
run leadtest.js     8099
run sheettest.js    8099
run servicetest.js  8086
run showcasetest.js 8089
# Last, and on its own port: one person's walk through the whole business,
# rather than one screen at a time.
run mobiletest.js   8099
run seotest.js      8099
run legaltest.js    8099
run paytest.js      8099
run e2e.js          8097
run teamtest.js     8095 SEED_DEMO=false ADMIN_EMAIL=boss@glovels.com ADMIN_PASSWORD=a-long-admin-password-9f2c

echo "" | tee -a "$REPORT"
echo "$PASS suite(s) green, $FAIL red" | tee -a "$REPORT"
exit $FAIL
