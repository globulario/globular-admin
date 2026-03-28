#!/bin/bash
# Certbot DNS-01 auth hook
# Writes challenge info so we can set it via MCP, then waits
set -euo pipefail
echo "${CERTBOT_DOMAIN}|${CERTBOT_VALIDATION}" > /tmp/certbot-pending-challenge
echo "[certbot-hook] Need TXT record: _acme-challenge.${CERTBOT_DOMAIN} = ${CERTBOT_VALIDATION}"
echo "[certbot-hook] Waiting for record to be set..."
# Wait until the marker file is removed (signal that record was set)
for i in $(seq 1 120); do
  [ ! -f /tmp/certbot-pending-challenge ] && exit 0
  sleep 2
done
echo "[certbot-hook] Timeout waiting for TXT record"
exit 1
