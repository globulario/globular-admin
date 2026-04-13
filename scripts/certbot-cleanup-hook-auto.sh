#!/bin/bash
# Certbot DNS-01 cleanup hook — automated via Globular DNS service
# Removes the ACME challenge TXT record after validation
set -euo pipefail

DOMAIN="${CERTBOT_DOMAIN}"
VALIDATION="${CERTBOT_VALIDATION}"
CHALLENGE_DOMAIN="_acme-challenge.${DOMAIN}"

echo "[certbot-hook] Removing TXT record: ${CHALLENGE_DOMAIN}"

ETCD_CACERT="/var/lib/globular/pki/ca.crt"
ETCD_CERT="/var/lib/globular/pki/issued/services/service.crt"
ETCD_KEY="/var/lib/globular/pki/issued/services/service.key"

if command -v grpcurl &>/dev/null; then
    grpcurl -cacert "${ETCD_CACERT}" -cert "${ETCD_CERT}" -key "${ETCD_KEY}" \
        -d "{\"domain\": \"${CHALLENGE_DOMAIN}\", \"txt\": \"${VALIDATION}\"}" \
        localhost:443 dns.DnsService/RemoveTXT 2>&1
elif command -v globular &>/dev/null; then
    globular dns record remove-txt --domain "${CHALLENGE_DOMAIN}" --value "${VALIDATION}" 2>&1
else
    echo "[certbot-hook] WARNING: Could not remove TXT record (no gRPC client)" >&2
fi

echo "[certbot-hook] Cleanup done"
exit 0
