#!/bin/sh
# Production smoke checks (01.5-backend-foundation task 13.5, Requirements 9.1, 9.3).
# Usage: scripts/smoke-production.sh <api-url> <app-url>
# Exits non-zero on the first failing check.
set -eu

if [ "$#" -ne 2 ]; then
  echo "usage: $0 <api-url> <app-url>" >&2
  exit 2
fi

api="${1%/}"
app="${2%/}"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

fail() {
  echo "FAIL: $1" >&2
  exit 1
}

pass() {
  echo "ok:   $1"
}

# fetch <name> <url> [curl args...]: writes $tmp/body and $tmp/headers, sets $status.
fetch() {
  name="$1"
  url="$2"
  shift 2
  status="$(curl -sS --max-time 20 -o "$tmp/body" -D "$tmp/headers" -w '%{http_code}' "$@" "$url")" ||
    fail "$name: request to $url failed"
}

fetch "API /health" "$api/health"
[ "$status" = "200" ] || fail "API /health returned $status, expected 200"
tr -d ' \r\n' <"$tmp/body" | grep -q '"status":"ok"' || fail "API /health body lacks \"status\":\"ok\""
pass "API /health is 200 with status ok"

fetch "API /v1/me" "$api/v1/me"
[ "$status" = "401" ] || fail "/v1/me without a token returned $status, expected 401"
tr -d ' \r\n' <"$tmp/body" | grep -q '"error":{' || fail "/v1/me 401 body is not the error envelope"
tr -d ' \r\n' <"$tmp/body" | grep -q '"code":"unauthorized"' || fail "/v1/me 401 envelope lacks code unauthorized"
pass "/v1/me without a token is 401 with the error envelope"

fetch "API CORS" "$api/v1/openapi.json" -H "Origin: https://smoke-check.invalid"
if grep -qi '^access-control-allow-origin:' "$tmp/headers"; then
  fail "foreign Origin received Access-Control-Allow-Origin on /v1/openapi.json"
fi
pass "foreign Origin gets no Access-Control-Allow-Origin"

for path in / /account /health; do
  fetch "app $path" "$app$path"
  [ "$status" = "200" ] || fail "app $path returned $status, expected 200"
  pass "app $path is 200"
done

echo "All production smoke checks passed."
