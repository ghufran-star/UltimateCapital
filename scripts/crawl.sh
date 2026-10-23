#!/usr/bin/env bash
# Requests every page as a signed-in owner; fails on any non-200 or server error page.
set -u
BASE=${BASE:-http://localhost:3000}
fails=0
check() { # cookie url
  local code
  code=$(curl -s -o /tmp/page.html -w "%{http_code}" -H "cookie: uc_session=$1" "$BASE$2")
  if [ "$code" != "200" ] || grep -q "Application error\|Internal Server Error" /tmp/page.html; then
    echo "FAIL $code $2"; msg=$(grep -o '"message":"[^"]*"' /tmp/page.html | head -1); echo "::error title=page $code::$2 $msg"; fails=$((fails+1))
  fi
}
while read -r u; do [ -n "$u" ] && check "$(cat smoke-demo-cookie.txt)" "$u"; done < smoke-urls.txt
for u in / /deals /settings /settings/compliance /settings/rules; do check "$(cat smoke-real-cookie.txt)" "$u"; done
while read -r u; do [ -n "$u" ] && check "" "$u"; done < smoke-public-urls.txt
echo "crawl done: $(wc -l < smoke-urls.txt) pages, $fails failures"
[ "$fails" -eq 0 ]
