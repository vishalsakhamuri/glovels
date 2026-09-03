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
  sleep 6
  local out
  # Eight, not three. A suite that dies rather than reporting a count prints a
  # stack, and three lines of it is the file and the line number with the
  # MESSAGE cut off — which is the one part that says what went wrong.
  out=$(node "$suite" 2>&1 | tail -8)
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
# On its own line with the live settings: half of what it asserts — an absolute
# og:image, a canonical, an indexable article — is only wrong when there is a
# real site address to be absolute against.
run postseotest.js  8099 ALLOW_INDEXING=true GLOVELS_URL=https://glovels.example
run leadtest.js     8099
run assigntest.js   8099
run sopdetailtest.js 8099
# Indexing ON, so the robots tag and the sitemap are exercised the way the
# live deployment runs rather than the way a preview build does. On 8099
# like everything else: the suite defaults to that port, and pointing the
# server somewhere else just left it testing whichever stale server still
# held 8099.
run storytest.js    8099 ALLOW_INDEXING=true GLOVELS_URL=https://glovels.example
run partnertest.js  8099
run booktest.js     8099
run feetest.js      8099
run delivertest.js  8099
run alerttest.js    8099
run contracttest.js 8099
run partstest.js    8099
run sharedtest.js   8099
run guidetest.js    8099
run sheettest.js    8099
run cgpatest.js      8099
run reachtest.js     8099
run deliverytest.js  8099
run pagetest.js      8099
run bartest.js       8099
run cattest.js       8099
run stagetest.js     8099
run servicetest.js  8086
run showcasetest.js 8089
# Last, and on its own port: one person's walk through the whole business,
# rather than one screen at a time.
run mobiletest.js   8099
run seotest.js      8099
run copytest.js     8099
run authscreentest.js 8099
run counscardtest.js 8099
run twolisttest.js   8099
run visatest.js      8099
run sweeptest.js     8099
run scholartest.js   8099
run pushtest.js      8099
run moneytest.js     8099
run entrytest.js     8099
run profiletest.js  8099
run deletetest.js   8099
# On its own port: this one stops the server to prove the offline screen, then
# starts it again. See the note at the top of apptest.js.
run apptest.js      8093
run spushtest.js    8099
run twatest.js      8099
run round2test.js   8099
run studenttest.js  8099
run formtest.js     8099
run gradetest.js    8099
run doclisttest.js  8099
run boundstest.js   8099
run intaketest.js   8099
run importtest.js   8099
run portaltest.js   8099
run paneltest.js    8099
run edittest.js      8099
run mailtest.js      8081
run pwresettest.js   8099
run legaltest.js    8099
run paytest.js      8099
run e2e.js          8097
run teamtest.js     8095 SEED_DEMO=false ADMIN_EMAIL=boss@glovels.com ADMIN_PASSWORD=a-long-admin-password-9f2c

echo "" | tee -a "$REPORT"
echo "$PASS suite(s) green, $FAIL red" | tee -a "$REPORT"
exit $FAIL
