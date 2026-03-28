#!/bin/bash
# Certbot DNS-01 cleanup hook
echo "${CERTBOT_DOMAIN}|${CERTBOT_VALIDATION}" > /tmp/certbot-pending-cleanup
echo "[certbot-hook] Need to remove TXT: _acme-challenge.${CERTBOT_DOMAIN}"
for i in $(seq 1 60); do
  [ ! -f /tmp/certbot-pending-cleanup ] && exit 0
  sleep 2
done
