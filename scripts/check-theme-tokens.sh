#!/usr/bin/env bash
# check-theme-tokens.sh — mechanical gate for the AWG perception principle
# meta.ui.theme_tokens_must_encode_roles_not_preferences.
#
# Raw color literals in component/page source defeat the semantic-token
# contract: a hardcoded #22c55e can't carry the meaning "confirmed healthy",
# and two hand-picked greens drift into two different "healthy" colors (the
# exact bug the admin's meta_principle_findings.yaml records). Colors must be
# semantic CSS custom properties (var(--health-ok), var(--warning-color), ...)
# defined in the token files; everything else consumes them.
#
# This is a RATCHET, not a wall: there are hundreds of legacy literals and
# they can't all be fixed at once. The committed ceiling freezes the count —
# it can only go DOWN. Every migration to a token lowers it; nothing may
# raise it. When the count drops, lower CEILING to lock in the gain.
#
# Token-definition CSS (where hex legitimately lives) is excluded.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

# The only files allowed to contain raw hex: the semantic-token definitions.
TOKEN_FILES_RE='packages/ui/src/styles/(theme|components)\.css'

count() {
  git ls-files '*.ts' '*.tsx' '*.css' \
    | /usr/bin/grep -vE "${TOKEN_FILES_RE}" \
    | while IFS= read -r f; do
        /usr/bin/grep -oE "#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b" "$f" 2>/dev/null || true
      done | wc -l | tr -d ' '
}

# ── Ratchet ceiling ──────────────────────────────────────────────────────────
# Raw color literals outside the token files. Lower this as you migrate to
# var(--*) tokens; never raise it. (Audit: meta_principle_findings.yaml.)
CEILING=520

actual="$(count)"

if [ "${actual}" -gt "${CEILING}" ]; then
  echo "theme-token gate: FAIL — raw color literals rose to ${actual} (ceiling ${CEILING})." >&2
  echo "  A new hardcoded color was added. Use a semantic CSS custom property" >&2
  echo "  (var(--health-ok), var(--warning-color), ...) defined in the token files." >&2
  echo "  See meta.ui.theme_tokens_must_encode_roles_not_preferences." >&2
  exit 1
fi

if [ "${actual}" -lt "${CEILING}" ]; then
  echo "theme-token gate: OK — ${actual} raw literals, below ceiling ${CEILING}."
  echo "  Progress! Lower CEILING to ${actual} in scripts/check-theme-tokens.sh to lock it in."
  exit 0
fi

echo "theme-token gate: OK — ${actual} raw literals, at ceiling. Held (migrate some to lower it)."
