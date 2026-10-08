#!/bin/sh
set -eu

# A connection reset while streaming a package can escape npm's fetch retries.
# Keep downloaded packages in the Docker cache and retry only network failures.
install_log=$(mktemp)
trap 'rm -f "$install_log"' 0
attempt=1

while :; do
  echo "npm ci: attempt $attempt/3"
  if npm ci --prefer-offline --no-audit --no-fund \
    --fetch-retries=5 --fetch-retry-factor=2 \
    --fetch-retry-mintimeout=10000 --fetch-retry-maxtimeout=60000 \
    >"$install_log" 2>&1; then
    cat "$install_log"
    exit 0
  else
    install_status=$?
    cat "$install_log" >&2
  fi

  if [ "$attempt" -ge 3 ] || ! grep -Eq \
    '^npm (ERR!|error) code (ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|ENETUNREACH|EHOSTUNREACH|EPIPE|ERR_SOCKET_TIMEOUT|ECONNECTIONTIMEOUT|EIDLETIMEOUT|ERESPONSETIMEOUT|ETRANSFERTIMEOUT|E408|E429|E500|E502|E503|E504)([[:space:]]|$)' \
    "$install_log"; then
    exit "$install_status"
  fi

  retry_delay=$((attempt * 10))
  echo "npm ci: network failure; retrying in ${retry_delay}s" >&2
  sleep "$retry_delay"
  attempt=$((attempt + 1))
done
