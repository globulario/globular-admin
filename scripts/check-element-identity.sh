#!/usr/bin/env bash
# check-element-identity.sh — mechanical gate for the AWG perception principle
# meta.ui.interactive_element_must_have_stable_identity.
#
# Data-carrying UI elements (counts, badges, status pills, metrics, chips, tags)
# rendered with no id / data-bind / data-* attribute cannot be individually
# addressed — not by tests, not by automation, not by an operator reading the DOM.
# The admin incidents-page audit (docs/awareness/meta_principle_findings.yaml, the
# mpf for this principle) found filter pills carrying data-filter but the count
# spans inside them anonymous. Every element that carries operational meaning must
# be individually addressable: it must carry id, data-bind, or a data-* attribute.
#
# This is a RATCHET, not a wall: there are legacy anonymous data-elements and they
# can't all be fixed at once. The committed ceiling freezes the count — it can only
# go DOWN. A new data-carrying element without identity fails the build; adding an
# id to one lowers the count (then lower CEILING to lock the gain in).
#
# Sibling to check-theme-tokens.sh (same ratchet shape, same awareness-gates wiring).
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

# Element-open fragments whose class marks them as carrying a count/badge/status/
# pill/metric/chip/tag — i.e. data-carrying elements that must be addressable.
DATA_CLASS='count|counter|badge|status|pill|metric|chip|tag'
ELEMENT_OPEN="<(span|div|td|li)[^>]*class=\"[^\"]*(${DATA_CLASS})[^\"]*\"[^>]*>"

# Count those that carry NO stable identity (no id, no data-bind, no data-* attr).
# grep -r with --exclude-dir is used deliberately (a git-ls-files pipe silently
# missed nested files during authoring); dist build artifacts are excluded.
count() {
  grep -rhoE "${ELEMENT_OPEN}" --include='*.js' --include='*.ts' \
    --exclude-dir=dist --exclude-dir=node_modules packages apps 2>/dev/null \
    | grep -vE 'id=|data-bind|data-[a-z]' \
    | wc -l | tr -d ' '
}

# ── Ratchet ceiling ──────────────────────────────────────────────────────────
# Data-carrying elements with no stable identity. Lower this as you add id/
# data-bind/data-*; never raise it. (Audit: meta_principle_findings.yaml,
# meta.ui.interactive_element_must_have_stable_identity.)
CEILING=129

actual="$(count)"

if [ "${actual}" -gt "${CEILING}" ]; then
  echo "element-identity gate: FAIL — anonymous data-carrying elements rose to ${actual} (ceiling ${CEILING})." >&2
  echo "  A data-carrying element (count/badge/status/pill/metric/chip/tag) was added" >&2
  echo "  without id, data-bind, or a data-* attribute. Give it a stable identity so" >&2
  echo "  tests, automation, and operators can address it." >&2
  echo "  See meta.ui.interactive_element_must_have_stable_identity." >&2
  exit 1
fi

if [ "${actual}" -lt "${CEILING}" ]; then
  echo "element-identity gate: OK — ${actual} anonymous data-elements, below ceiling ${CEILING}."
  echo "  Progress! Lower CEILING to ${actual} in scripts/check-element-identity.sh to lock it in."
  exit 0
fi

echo "element-identity gate: OK — ${actual} anonymous data-elements, at ceiling. Held (add identity to lower it)."
