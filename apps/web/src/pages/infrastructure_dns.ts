// src/pages/infrastructure_dns.ts
import "@globular/components/markdown.js"
import '@polymer/iron-icons/iron-icons.js'
import '@polymer/paper-icon-button/paper-icon-button.js'
import '@polymer/iron-collapse/iron-collapse.js'

import {
  fetchAdminServices, getClusterHealth,
  getDnsDomains, fetchZoneRecords,
  type ServicesResponse, type ClusterHealth, type DnsRecord,
} from '@globular/backend'

import {
  INFRA_STYLES, badge, stateBadge, stateColor, esc,
  fmtBytes, fmtDuration, fmtTime, freshnessBadge,
  type HealthState,
} from '../utils/infra_health'

const POLL = 30_000

type DnsTab = 'overview' | 'records'
type DnsState = 'no-zones' | 'ready'
type SortCol = 'name' | 'type' | 'value'

class PageInfrastructureDns extends HTMLElement {
  private _timer: number | null = null
  private _lastUpdated: Date | null = null
  private _services: ServicesResponse | null = null
  private _cluster: ClusterHealth | null = null
  private _domains: string[] = []
  private _records: DnsRecord[] = []
  private _tab: DnsTab = 'overview'
  private _filterType = 'All'
  private _filterText = ''
  private _sortCol: SortCol = 'name'
  private _sortAsc = true
  private _helpOpen = false
  private _loading = false
  private _error: string | null = null

  connectedCallback() {
    this.style.display = 'block'
    this.innerHTML = `
      <style>${INFRA_STYLES}${PAGE_STYLES}</style>
      <section class="wrap">
        <header class="infra-header">
          <h2>DNS</h2>
          <div class="spacer"></div>
          <span id="dnsTimestamp" class="infra-timestamp"></span>
          <span id="dnsFreshness"></span>
          <button id="dnsRefresh" class="infra-btn">&#8635; Refresh</button>
        </header>
        <p style="font:var(--md-typescale-body-medium);color:var(--secondary-text-color);margin:0 0 16px">
          DNS service health, zone records, and drift detection.
        </p>
        <div id="dnsBody"></div>
      </section>
    `
    this.querySelector('#dnsRefresh')?.addEventListener('click', () => this.load())
    this.load()
    this._timer = window.setInterval(() => this.load(), POLL)
  }

  disconnectedCallback() {
    if (this._timer) clearInterval(this._timer)
  }

  // ─── Data ───────────────────────────────────────────────────────────────────

  private async load() {
    this._loading = true
    this.render()

    const [svcR, clR, domR] = await Promise.allSettled([
      fetchAdminServices(),
      getClusterHealth(),
      getDnsDomains(),
    ])
    this._services = svcR.status === 'fulfilled' ? svcR.value : null
    this._cluster  = clR.status  === 'fulfilled' ? clR.value  : null
    this._domains  = domR.status === 'fulfilled' ? domR.value : []
    this._error    = null

    console.log('[DNS] load results — clusterDomain: %s, dns zones: %o, domRPC: %s',
      this._cluster?.clusterDomain ?? '(empty)',
      this._domains,
      domR.status === 'rejected' ? `FAILED: ${(domR as PromiseRejectedResult).reason}` : 'ok',
    )

    // Fetch records for each zone the DNS service manages
    if (this._domains.length > 0) {
      try {
        const allRecords: DnsRecord[] = []
        for (const zone of this._domains) {
          const names = this.buildNames(zone)
          const recs = await fetchZoneRecords(zone, names)
          allRecords.push(...recs)
        }
        this._records = allRecords
      } catch (e: any) {
        this._error = e?.message ?? 'Failed to fetch zone records'
        this._records = []
      }
    } else {
      this._records = []
    }

    this._lastUpdated = new Date()
    this._loading = false
    this.render()
  }

  private buildNames(domain: string): string[] {
    const names = [domain, `dns.${domain}`, `api.${domain}`, `*.${domain}`]
    const nodes = this._cluster?.nodes ?? []
    for (const n of nodes) {
      if (n.hostname) {
        const fqdn = `${n.hostname}.${domain}`
        if (!names.includes(fqdn)) names.push(fqdn)
      }
    }
    return names
  }

  private getDnsState(): DnsState {
    if (this._domains.length === 0) return 'no-zones'
    return 'ready'
  }

  // ─── Render ─────────────────────────────────────────────────────────────────

  private render() {
    const tsEl = this.querySelector('#dnsTimestamp') as HTMLElement
    if (tsEl && this._lastUpdated) tsEl.textContent = `Last updated: ${fmtTime(this._lastUpdated)}`
    const freshEl = this.querySelector('#dnsFreshness') as HTMLElement
    if (freshEl) freshEl.innerHTML = freshnessBadge(this._lastUpdated?.getTime() ?? null, POLL)

    const body = this.querySelector('#dnsBody') as HTMLElement
    if (!body) return

    if (this._loading && !this._lastUpdated) {
      body.innerHTML = '<div class="infra-empty">Loading DNS data...</div>'
      return
    }

    const state = this.getDnsState()

    if (state === 'no-zones') {
      body.innerHTML = `
        <div class="dns-banner dns-banner--warn">
          <strong>No DNS zones found.</strong>
          <span>The DNS service is not managing any zones. Check the DNS service configuration.</span>
        </div>
        ${this.renderDnsServiceCard()}
      `
      return
    }

    // Zone present — full tabbed UI
    body.innerHTML = `
      <div class="infra-tabs">
        <button class="infra-tab ${this._tab === 'overview' ? 'active' : ''}" data-tab="overview">Overview</button>
        <button class="infra-tab ${this._tab === 'records' ? 'active' : ''}" data-tab="records">Records</button>
      </div>
      <div id="dnsTabContent"></div>
    `
    body.querySelectorAll('.infra-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        this._tab = (btn as HTMLElement).dataset.tab as DnsTab
        this.render()
      })
    })

    const content = body.querySelector('#dnsTabContent') as HTMLElement
    if (this._tab === 'overview') {
      this.renderOverview(content)
    } else {
      this.renderRecords(content)
    }
  }

  // ─── Overview Tab ─────────────────────────────────────────────────────────

  private renderOverview(el: HTMLElement) {
    el.innerHTML = `
      <div class="infra-grid">
        ${this.renderDnsServiceCard()}
        ${this._domains.map(zone => this.renderZoneStatusCard(zone)).join('')}
      </div>
      ${this._domains.map(zone => this.renderDriftCard(zone)).join('')}
      ${this._error ? `<div class="dns-banner dns-banner--error">${esc(this._error)}</div>` : ''}
    `
  }

  private renderDnsServiceCard(): string {
    const allSvcs = this._services?.groups?.flatMap(g => g.services) ?? []
    const dnsSvc = allSvcs.find(s => s.name.toLowerCase().includes('dns'))
    const dnsState: HealthState = !dnsSvc ? 'unknown' : (dnsSvc.derived_status as HealthState)

    return `
      <div class="infra-card" style="border-left:4px solid ${stateColor(dnsState)}">
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px">
          <span style="font-weight:700;font-size:.92rem">DNS Service</span>
          <div style="flex:1"></div>
          ${dnsSvc ? stateBadge(dnsState) : badge('NOT FOUND', 'var(--secondary-text-color)')}
        </div>
        ${dnsSvc ? `
          <div class="infra-card-metric">
            State: <strong>${esc(dnsSvc.state)}</strong>
            &middot; DNS: <strong>53</strong>
            &middot; gRPC: <strong>${dnsSvc.port}</strong>
            ${dnsSvc.runtime ? `
              <br>CPU: <strong>${dnsSvc.runtime.cpu_pct.toFixed(1)}%</strong>
              &middot; Mem: <strong>${fmtBytes(dnsSvc.runtime.memory_bytes)}</strong>
              &middot; Uptime: <strong>${fmtDuration(dnsSvc.runtime.uptime_sec)}</strong>
            ` : ''}
          </div>
          <div class="infra-card-sub">v${esc(dnsSvc.version)}</div>
        ` : '<div class="infra-card-metric">DNS service not detected in service inventory.</div>'}
      </div>
    `
  }

  private renderZoneStatusCard(zone: string): string {
    const zoneRecords = this._records.filter(r => r.name === zone || r.name.endsWith(`.${zone}`))
    const soaRecords = this._records.filter(r => r.type === 'SOA' && r.name === zone)
    const nsRecords = this._records.filter(r => r.type === 'NS' && r.name === zone)
    const hasSoa = soaRecords.length > 0
    const hasNs = nsRecords.length > 0
    const hasRecords = zoneRecords.length > 0

    // Extract primary NS from SOA record value (format: "dns.zone. admin.zone. (serial NNN)")
    const primaryNs = hasSoa ? soaRecords[0].value.split(' ')[0] : null

    // Count by type for this zone
    const counts: Record<string, number> = {}
    for (const r of zoneRecords) {
      counts[r.type] = (counts[r.type] ?? 0) + 1
    }
    const typeParts = (['A', 'AAAA', 'CNAME', 'TXT', 'NS', 'MX', 'SRV', 'SOA'] as const)
      .filter(t => (counts[t] ?? 0) > 0)
      .map(t => `${t}: <strong>${counts[t]}</strong>`)

    // Zone status
    const zoneOk = hasSoa && hasNs && hasRecords
    const incomplete = hasRecords && !hasSoa
    const statusColor = zoneOk ? '#22c55e' : incomplete ? '#f59e0b' : 'var(--secondary-text-color)'
    const statusLabel = zoneOk ? 'OK' : incomplete ? 'INCOMPLETE' : 'EMPTY'
    const statusDetail = zoneOk
      ? 'Zone is properly authoritative'
      : incomplete
        ? 'Zone initialized but metadata incomplete — SOA/NS records missing'
        : 'No records in zone'

    return `
      <div class="infra-card" style="border-left:4px solid ${statusColor}">
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px">
          <span style="font-weight:700;font-size:.92rem">Zone Status</span>
          <div style="flex:1"></div>
          ${badge(statusLabel, statusColor)}
        </div>
        <div style="font-family:monospace;font-size:1.05rem;font-weight:700;margin-bottom:8px">${esc(zone)}</div>
        <div style="font-size:.82rem;color:var(--secondary-text-color);margin-bottom:8px">${statusDetail}</div>
        <table class="dns-status-table">
          <tr><td>Initialized</td><td><strong>${hasRecords ? 'Yes' : 'No'}</strong></td></tr>
          <tr><td>Records</td><td><strong>${zoneRecords.length}</strong></td></tr>
          <tr><td>SOA</td><td>${hasSoa ? '<strong style="color:#22c55e">Yes</strong>' : `<span style="color:#f59e0b">Missing</span>`}</td></tr>
          <tr><td>Primary NS</td><td>${primaryNs ? `<strong>${esc(primaryNs)}</strong>` : '<span style="color:var(--secondary-text-color)">—</span>'}</td></tr>
          <tr><td>Nameservers</td><td>${hasNs ? nsRecords.map(r => `<strong>${esc(r.value)}</strong>`).join(', ') : '<span style="color:var(--secondary-text-color)">None</span>'}</td></tr>
        </table>
        ${typeParts.length > 0 ? `
          <div class="infra-card-metric" style="display:flex;gap:12px;flex-wrap:wrap;margin-top:8px;padding-top:8px;border-top:1px solid var(--border-subtle-color)">
            ${typeParts.join('<span style="color:var(--border-subtle-color)">&middot;</span>')}
          </div>
        ` : ''}
      </div>
    `
  }

  private renderDriftCard(domain: string): string {
    const nodes = this._cluster?.nodes ?? []
    // Build expected records: api.<domain>, *.<domain>, plus <hostname>.<domain> per node
    const expected: Array<{ name: string; expectedIp: string; source: string }> = []

    // For each node, expect <hostname>.<domain> → node IPs
    for (const n of nodes) {
      if (!n.hostname) continue
      const fqdn = `${n.hostname}.${domain}`
      // We don't know the "expected" IP exactly — we use the first IP from cluster health
      // and check if at least one record exists
      expected.push({ name: fqdn, expectedIp: '(any node IP)', source: `node: ${n.hostname}` })
    }
    // Always expect dns.<domain>, api.<domain>, and *.<domain>
    expected.push({ name: `dns.${domain}`, expectedIp: '(any)', source: 'nameserver' })
    expected.push({ name: `api.${domain}`, expectedIp: '(any)', source: 'api endpoint' })
    expected.push({ name: `*.${domain}`, expectedIp: '(any)', source: 'wildcard' })

    if (expected.length === 0) return ''

    const rows = expected.map(e => {
      const matching = this._records.filter(r => r.name === e.name && (r.type === 'A' || r.type === 'AAAA'))
      const actualIps = matching.map(r => r.value)
      let status: string
      let statusBadge: string
      if (actualIps.length > 0) {
        status = actualIps.join(', ')
        statusBadge = badge('OK', '#22c55e')
      } else {
        status = '—'
        statusBadge = badge('MISSING', 'var(--error-color)')
      }
      return `
        <tr>
          <td style="font-family:monospace;font-size:.82rem">${esc(e.name)}</td>
          <td style="font-size:.82rem;color:var(--secondary-text-color)">${esc(e.source)}</td>
          <td style="font-family:monospace;font-size:.82rem">${esc(status)}</td>
          <td>${statusBadge}</td>
        </tr>
      `
    }).join('')

    const hasMissing = expected.some(e => {
      const matching = this._records.filter(r => r.name === e.name && (r.type === 'A' || r.type === 'AAAA'))
      return matching.length === 0
    })

    return `
      <div class="infra-card" style="margin-top:8px;${hasMissing ? 'border-left:4px solid var(--error-color)' : ''}">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
          <span style="font-weight:700;font-size:.92rem">Core Records Drift</span>
          <div style="flex:1"></div>
          ${hasMissing ? badge('DRIFT DETECTED', 'var(--error-color)') : badge('ALL OK', '#22c55e')}
        </div>
        <table class="infra-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Source</th>
              <th>Actual IP(s)</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `
  }

  // ─── Records Tab ──────────────────────────────────────────────────────────

  private renderRecords(el: HTMLElement) {
    const types = ['All', 'A', 'AAAA', 'CNAME', 'TXT', 'NS', 'MX', 'SRV', 'SOA']

    let filtered = this._records
    if (this._filterType !== 'All') {
      filtered = filtered.filter(r => r.type === this._filterType)
    }
    if (this._filterText) {
      const q = this._filterText.toLowerCase()
      filtered = filtered.filter(r =>
        r.name.toLowerCase().includes(q) || r.value.toLowerCase().includes(q)
      )
    }

    // Sort
    filtered = [...filtered].sort((a, b) => {
      const av = a[this._sortCol]
      const bv = b[this._sortCol]
      const cmp = av < bv ? -1 : av > bv ? 1 : 0
      return this._sortAsc ? cmp : -cmp
    })

    const typeOptions = types.map(t =>
      `<option value="${t}" ${t === this._filterType ? 'selected' : ''}>${t}</option>`
    ).join('')

    const sortArrow = (col: SortCol) =>
      this._sortCol === col ? (this._sortAsc ? ' &#9650;' : ' &#9660;') : ''

    const rows = filtered.map(r => `
      <tr>
        <td style="font-family:monospace;font-size:.82rem">${esc(r.name)}</td>
        <td>${badge(r.type, typeColor(r.type))}</td>
        <td style="font-family:monospace;font-size:.82rem;word-break:break-all">${esc(r.value)}</td>
      </tr>
    `).join('')

    el.innerHTML = `
      <div class="dns-filter-bar">
        <select id="dnsTypeFilter" class="dns-select">${typeOptions}</select>
        <input id="dnsSearch" type="text" class="dns-input" placeholder="Search name or value..." value="${esc(this._filterText)}">
        <span style="font-size:.78rem;color:var(--secondary-text-color)">${filtered.length} record(s)</span>
        <div style="flex:1"></div>
        <paper-icon-button id="dnsHelpBtn" icon="icons:info-outline" title="CLI reference"></paper-icon-button>
      </div>

      <iron-collapse id="dnsHelpPanel">
        <globular-markdown style="
          display: block; padding: 0 4px 12px;
          --md-font-size: .82rem;
          --divider-color: color-mix(in srgb, var(--on-surface-color) 12%, transparent);
        " id="dnsCliDocs"></globular-markdown>
      </iron-collapse>

      ${filtered.length > 0 ? `
        <table class="infra-table">
          <thead>
            <tr>
              <th class="dns-sortable" data-col="name">Name${sortArrow('name')}</th>
              <th class="dns-sortable" data-col="type">Type${sortArrow('type')}</th>
              <th class="dns-sortable" data-col="value">Value${sortArrow('value')}</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      ` : '<div class="infra-empty">No records match the current filter.</div>'}
    `

    // Help docs
    this.renderCliDocs(el)
    const helpPanel = el.querySelector('#dnsHelpPanel') as any
    if (helpPanel && this._helpOpen) {
      // Restore open state after re-render
      helpPanel.opened = true
    }
    el.querySelector('#dnsHelpBtn')?.addEventListener('click', () => {
      this._helpOpen = !this._helpOpen
      helpPanel?.toggle()
    })

    // Event handlers
    el.querySelector('#dnsTypeFilter')?.addEventListener('change', (e) => {
      this._filterType = (e.target as HTMLSelectElement).value
      this.render()
    })
    el.querySelector('#dnsSearch')?.addEventListener('input', (e) => {
      this._filterText = (e.target as HTMLInputElement).value
      this.render()
    })
    el.querySelectorAll('.dns-sortable').forEach(th => {
      th.addEventListener('click', () => {
        const col = (th as HTMLElement).dataset.col as SortCol
        if (this._sortCol === col) {
          this._sortAsc = !this._sortAsc
        } else {
          this._sortCol = col
          this._sortAsc = true
        }
        this.render()
      })
    })
  }

  private renderCliDocs(el: HTMLElement) {
    const md = el.querySelector('#dnsCliDocs') as HTMLElement
    if (!md) return
    md.textContent = DNS_CLI_DOCS
  }

}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function typeColor(type: string): string {
  switch (type) {
    case 'A':     return '#3b82f6'
    case 'AAAA':  return '#6366f1'
    case 'CNAME': return '#8b5cf6'
    case 'TXT':   return '#f59e0b'
    case 'NS':    return '#22c55e'
    case 'MX':    return '#ec4899'
    case 'SRV':   return '#14b8a6'
    case 'SOA':   return '#64748b'
    default:      return 'var(--secondary-text-color)'
  }
}

// ─── Page-specific styles ─────────────────────────────────────────────────────

const PAGE_STYLES = `
  .dns-banner {
    display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
    padding: 12px 16px; border-radius: var(--md-shape-md);
    margin-bottom: 16px; font-size: .85rem;
  }
  .dns-banner--warn {
    background: color-mix(in srgb, #f59e0b 12%, transparent);
    border: 1px solid color-mix(in srgb, #f59e0b 30%, transparent);
  }
  .dns-banner--error {
    background: color-mix(in srgb, var(--error-color) 12%, transparent);
    border: 1px solid color-mix(in srgb, var(--error-color) 30%, transparent);
    color: var(--error-color);
  }
  .dns-banner code {
    font-family: monospace; background: color-mix(in srgb, var(--on-surface-color) 8%, transparent);
    padding: 1px 5px; border-radius: 3px;
  }
  .dns-filter-bar {
    display: flex; align-items: center; gap: 8px; margin-bottom: 12px; flex-wrap: wrap;
  }
  .dns-select, .dns-input {
    font: var(--md-typescale-body-small);
    background: var(--md-surface-container-low);
    color: var(--on-surface-color);
    border: 1px solid var(--border-subtle-color);
    border-radius: var(--md-shape-sm);
    padding: 5px 8px;
  }
  .dns-input { min-width: 200px; }
  .dns-sortable { cursor: pointer; user-select: none; }
  .dns-sortable:hover { color: var(--accent-color); }
  .dns-status-table { font-size: .85rem; }
  .dns-status-table td { padding: 2px 0; }
  .dns-status-table td:first-child {
    color: var(--secondary-text-color); padding-right: 12px; white-space: nowrap;
  }
`

// ─── CLI Documentation ────────────────────────────────────────────────────────

const DNS_CLI_DOCS = `
# DNS CLI Reference

Manage DNS records from the command line with \`globular dns\`. All commands connect to the DNS gRPC service (default \`localhost:10006\`).

## Global Flags

| Flag | Description |
|---|---|
| \`--dns <host:port>\` | DNS service gRPC endpoint (default: \`localhost:10006\`) |
| \`--timeout <duration>\` | Request timeout (default: \`5s\`) |
| \`--output <format>\` | Output format: \`table\`, \`json\`, or \`yaml\` |
| \`--insecure\` | Skip TLS verification |
| \`--ca <path>\` | Path to CA certificate bundle |

---

## Managed Domains

\`\`\`bash
# List all managed zones
globular dns domains get

# Set managed zones (replaces existing list)
globular dns domains set globular.internal

# Add a zone
globular dns domains add example.internal

# Remove a zone
globular dns domains remove example.internal
\`\`\`

---

## A Records (IPv4)

\`\`\`bash
# Add an A record
globular dns a set api.globular.internal 10.0.0.63 --ttl 300

# Query A records
globular dns a get api.globular.internal

# Remove a specific A record
globular dns a remove api.globular.internal 10.0.0.63

# Remove all A records for a name
globular dns a remove api.globular.internal
\`\`\`

---

## AAAA Records (IPv6)

\`\`\`bash
# Add an AAAA record
globular dns aaaa set api.globular.internal fd12::1 --ttl 300

# Query AAAA records
globular dns aaaa get api.globular.internal

# Remove an AAAA record
globular dns aaaa remove api.globular.internal fd12::1
\`\`\`

---

## TXT Records

\`\`\`bash
# Set a TXT record
globular dns txt set globular.internal "v=spf1 include:example.com" --ttl 300

# Query TXT records
globular dns txt get globular.internal

# Remove a TXT record
globular dns txt remove globular.internal "v=spf1 include:example.com"
\`\`\`

---

## SRV Records

\`\`\`bash
# Set an SRV record
globular dns srv set _grpc._tcp.globular.internal api.globular.internal 8443 \\
  --priority 10 --weight 10 --ttl 300

# Query SRV records
globular dns srv get _grpc._tcp.globular.internal

# Remove SRV records
globular dns srv remove _grpc._tcp.globular.internal
\`\`\`

---

## Diagnostics

\`\`\`bash
# Check DNS service status and connectivity
globular dns status

# Inspect what the DNS service stores for a name (gRPC query)
globular dns inspect api.globular.internal --types A,AAAA,TXT

# Resolve a name via DNS protocol (what clients see)
globular dns lookup api.globular.internal --type A

# Lookup all record types
globular dns lookup globular.internal --type ALL
\`\`\`

---

## Cluster Bootstrap

\`\`\`bash
# Bootstrap DNS for a cluster domain with wildcard
globular cluster dns bootstrap \\
  --domain globular.internal \\
  --ipv4 10.0.0.63 \\
  --wildcard
\`\`\`

This creates the managed zone, apex A record, and wildcard \`*.globular.internal\` in one step.
`.trim()

customElements.define('page-infrastructure-dns', PageInfrastructureDns)
