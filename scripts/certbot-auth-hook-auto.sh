#!/bin/bash
# Certbot DNS-01 auth hook — automated via Globular DNS service
# Sets the ACME challenge TXT record directly, no manual intervention needed
set -euo pipefail

DOMAIN="${CERTBOT_DOMAIN}"
VALIDATION="${CERTBOT_VALIDATION}"
CHALLENGE_DOMAIN="_acme-challenge.${DOMAIN}"

echo "[certbot-hook] Setting TXT record: ${CHALLENGE_DOMAIN} = ${VALIDATION}"

# Use the MCP grpc_call to set the TXT record on Globular's DNS service
# The DNS service is authoritative for globular.io
ETCD_CACERT="/var/lib/globular/pki/ca.crt"
ETCD_CERT="/var/lib/globular/pki/issued/services/service.crt"
ETCD_KEY="/var/lib/globular/pki/issued/services/service.key"

# Get the DNS service endpoint from the local gateway
# Use grpcurl if available, otherwise fall back to globular CLI
if command -v grpcurl &>/dev/null; then
    grpcurl -cacert "${ETCD_CACERT}" -cert "${ETCD_CERT}" -key "${ETCD_KEY}" \
        -d "{\"domain\": \"${CHALLENGE_DOMAIN}\", \"txt\": \"${VALIDATION}\", \"ttl\": 60}" \
        localhost:443 dns.DnsService/SetTXT 2>&1
elif command -v globular &>/dev/null; then
    globular dns record set-txt --domain "${CHALLENGE_DOMAIN}" --value "${VALIDATION}" --ttl 60 2>&1
else
    echo "[certbot-hook] ERROR: No gRPC client available (grpcurl or globular CLI)" >&2
    exit 1
fi

echo "[certbot-hook] TXT record set, waiting 10s for DNS propagation..."
sleep 10

# Verify the record is resolvable
for i in $(seq 1 12); do
    RESULT=$(dig TXT "${CHALLENGE_DOMAIN}" @dns.globular.io +short 2>/dev/null || true)
    if echo "${RESULT}" | grep -q "${VALIDATION}"; then
        echo "[certbot-hook] TXT record verified: ${RESULT}"
        exit 0
    fi
    echo "[certbot-hook] Waiting for propagation... (attempt ${i}/12)"
    sleep 5
done

echo "[certbot-hook] WARNING: Could not verify TXT record, proceeding anyway"
exit 0
