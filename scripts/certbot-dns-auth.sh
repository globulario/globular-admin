#!/bin/bash
# Certbot DNS-01 auth hook: sets the ACME challenge TXT record
# via the Globular DNS service.
set -euo pipefail

DOMAIN="_acme-challenge.${CERTBOT_DOMAIN}."
VALUE="${CERTBOT_VALIDATION}"

# Use globular CLI to call DNS service
globular grpc call dns.DnsService SetTXT \
  --domain "${DOMAIN}" --txt "${VALUE}" --ttl 60 2>/dev/null \
|| grpcurl -insecure \
  -d "{\"domain\": \"${DOMAIN}\", \"txt\": \"${VALUE}\", \"ttl\": 60}" \
  127.0.0.1:10006 dns.DnsService/SetTXT 2>/dev/null \
|| curl -sk -X POST 'https://127.0.0.1:443/dns.DnsService/SetTXT' \
  -H 'Content-Type: application/grpc-web+proto' \
  -H 'x-grpc-web: 1' 2>/dev/null

echo "[certbot] Set TXT: ${DOMAIN} = ${VALUE}"
sleep 10
