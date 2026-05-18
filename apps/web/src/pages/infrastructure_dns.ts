// src/pages/infrastructure_dns.ts
import "@globular/components/markdown.js"

import {
  fetchAdminServices, getClusterHealth,
  getDnsDomains, fetchZoneRecords,
  fetchProviders, saveProvider, deleteProvider,
  fetchDomainSpecs, saveDomainSpec, deleteDomainSpec,
  type ServicesResponse, type ClusterHealth, type DnsRecord,
  type DNSProviderConfig, type DomainSpecWithStatus,
} from '@globular/sdk'

import {
  INFRA_STYLES, badge, stateBadge, stateColor, esc,
  fmtBytes, fmtDuration, fmtTime, freshnessBadge,
  type HealthState,
} from '../utils/infra_health'

const POLL = 30_000

type DnsTab = 'overview' | 'records' | 'external'
type DnsState = 'no-zones' | 'error' | 'ready'
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

  // External domains state
  private _providers: DNSProviderConfig[] = []
  private _extDomains: DomainSpecWithStatus[] = []
  private _extError: string | null = null
  private _showProviderForm = false
  private _showDomainForm = false
  private _editingProvider: DNSProviderConfig | null = null
  private _editingDomain: DomainSpecWithStatus | null = null
  private _providerHelpOpen = false
  private _domainHelpOpen = false

  private _built = false

  connectedCallback() {
    this.style.display = 'block'
    this._buildShell()
    this._load()
    this._timer = window.setInterval(() => this._load(), POLL)
  }

  disconnectedCallback() {
    if (this._timer) clearInterval(this._timer)
  }

  private _buildShell() {
    if (this._built) return
    this._built = true
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
    this.querySelector('#dnsRefresh')?.addEventListener('click', () => this._load())
  }

  // ─── Data ───────────────────────────────────────────────────────────────────

  private async _load() {
    this._loading = true
    this._pushData()

    const [svcR, clR, domR] = await Promise.allSettled([
      fetchAdminServices(),
      getClusterHealth(),
      getDnsDomains(),
    ])
    this._services = svcR.status === 'fulfilled' ? svcR.value : null
    this._cluster  = clR.status  === 'fulfilled' ? clR.value  : null
    if (domR.status === 'fulfilled') {
      this._domains = domR.value
    }
    this._error    = domR.status === 'rejected'
      ? (domR.reason?.message ?? String(domR.reason ?? 'DNS domains RPC failed'))
      : null

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

    // Fetch external domains and providers (best-effort)
    const [provR, extR] = await Promise.allSettled([
      fetchProviders(),
      fetchDomainSpecs(),
    ])
    this._providers  = provR.status === 'fulfilled' ? provR.value : []
    this._extDomains = extR.status  === 'fulfilled' ? extR.value  : []
    this._extError   = null

    this._lastUpdated = new Date()
    this._loading = false
    this._pushData()
  }

  private buildNames(domain: string): string[] {
    const names = [
      domain,
      `dns.${domain}`,
      `api.${domain}`,
      `gateway.${domain}`,
      `controller.${domain}`,
      `controller-nodes.${domain}`,
      `*.${domain}`,
    ]
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
    if (this._error && this._domains.length === 0) return 'error'
    if (this._domains.length === 0) return 'no-zones'
    return 'ready'
  }

  // ─── Render ─────────────────────────────────────────────────────────────────

  private _pushData() {
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

    if (state === 'error') {
      body.innerHTML = `
        <div class="dns-banner dns-banner--error">
          <strong>DNS Status Unavailable.</strong>
          <span>${esc(this._error || 'DNS domains query failed')}</span>
        </div>
        ${this.renderDnsServiceCard()}
      `
      return
    }

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
    // If tabs already exist, update the active class and only rebuild the content
    // for non-external tabs. External tab does incremental updates to preserve forms.
    let content = body.querySelector('#dnsTabContent') as HTMLElement
    const tabsExist = content !== null

    if (!tabsExist) {
      body.innerHTML = `
        <div class="infra-tabs">
          <button class="infra-tab ${this._tab === 'overview' ? 'active' : ''}" data-tab="overview">Overview</button>
          <button class="infra-tab ${this._tab === 'records' ? 'active' : ''}" data-tab="records">Records</button>
          <button class="infra-tab ${this._tab === 'external' ? 'active' : ''}" data-tab="external">External Domains</button>
        </div>
        <div id="dnsTabContent"></div>
      `
      body.querySelectorAll('.infra-tab').forEach(btn => {
        btn.addEventListener('click', () => {
          this._tab = (btn as HTMLElement).dataset.tab as DnsTab
          this._pushData()
        })
      })
      content = body.querySelector('#dnsTabContent') as HTMLElement
    } else {
      // Update active tab styling
      body.querySelectorAll('.infra-tab').forEach(btn => {
        const tab = (btn as HTMLElement).dataset.tab
        btn.classList.toggle('active', tab === this._tab)
      })
    }

    if (this._tab === 'overview') {
      this.renderOverview(content)
    } else if (this._tab === 'records') {
      this.renderRecords(content)
    } else {
      this.renderExternal(content)
    }
  }

  // ─── Overview Tab ─────────────────────────────────────────────────────────

  private renderOverview(el: HTMLElement) {
    const drift = this._error ? '' : this._domains.map(zone => this.renderDriftCard(zone)).join('')
    el.innerHTML = `
      <div class="infra-grid">
        ${this.renderDnsServiceCard()}
        ${this._domains.map(zone => this.renderZoneStatusCard(zone)).join('')}
      </div>
      ${drift}
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

    // Check if a wildcard record exists for this domain
    const wildcardName = `*.${domain}`
    const wildcardRecords = this._records.filter(r => r.name === wildcardName && (r.type === 'A' || r.type === 'AAAA'))
    const hasWildcard = wildcardRecords.length > 0

    const rows = expected.map(e => {
      const matching = this._records.filter(r => r.name === e.name && (r.type === 'A' || r.type === 'AAAA'))
      const actualIps = matching.map(r => r.value)
      let status: string
      let statusBadge: string
      if (actualIps.length > 0) {
        status = actualIps.join(', ')
        statusBadge = badge('OK', '#22c55e')
      } else if (hasWildcard && e.source.startsWith('node:')) {
        // Per-node record is covered by the wildcard — not a real drift
        status = wildcardRecords.map(r => r.value).join(', ') + ' (via wildcard)'
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
      if (matching.length > 0) return false
      // Per-node records covered by wildcard are not missing
      if (hasWildcard && e.source.startsWith('node:')) return false
      return true
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
      this._pushData()
    })
    el.querySelector('#dnsSearch')?.addEventListener('input', (e) => {
      this._filterText = (e.target as HTMLInputElement).value
      this._pushData()
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
        this._pushData()
      })
    })
  }

  // ─── External Domains Tab ──────────────────────────────────────────────────

  private renderExternal(el: HTMLElement) {
    // Incremental update: if the external tab DOM already exists, only refresh
    // the data-driven lists and error banner — preserve forms, help panels, listeners.
    const alreadyMounted = el.querySelector('#extProviderList') !== null

    if (alreadyMounted) {
      // Update error banner
      const errSlot = el.querySelector('#extErrorBanner') as HTMLElement
      if (errSlot) errSlot.innerHTML = this._extError
        ? `<div class="dns-banner dns-banner--error">${esc(this._extError)}</div>` : ''

      // Update lists (only if no form is open — avoid losing context)
      if (!this._showProviderForm) {
        const pl = el.querySelector('#extProviderList') as HTMLElement
        if (pl) {
          pl.innerHTML = this.renderProviderList()
          this.wireProviderListButtons(el)
        }
      }
      if (!this._showDomainForm) {
        const dl = el.querySelector('#extDomainList') as HTMLElement
        if (dl) {
          dl.innerHTML = this.renderDomainList()
          this.wireDomainListButtons(el)
        }
      }
      return
    }

    // First mount — full DOM build
    el.innerHTML = `
      <div id="extErrorBanner">
        ${this._extError ? `<div class="dns-banner dns-banner--error">${esc(this._extError)}</div>` : ''}
      </div>

      <div class="ext-section">
        <div class="ext-section-header">
          <h3>DNS Providers</h3>
          <div style="flex:1"></div>
          <paper-icon-button id="extProviderHelpBtn" icon="icons:info-outline" title="Provider documentation"></paper-icon-button>
          <button class="infra-btn" id="extAddProvider">+ Add Provider</button>
        </div>
        <iron-collapse id="extProviderHelpPanel">
          <globular-markdown style="
            display: block; padding: 0 4px 12px;
            --md-font-size: .82rem;
            --divider-color: color-mix(in srgb, var(--on-surface-color) 12%, transparent);
          " id="extProviderDocs"></globular-markdown>
        </iron-collapse>
        <div id="extProviderForm"></div>
        <div id="extProviderList">${this.renderProviderList()}</div>
      </div>

      <div class="ext-section" style="margin-top:24px">
        <div class="ext-section-header">
          <h3>External Domains</h3>
          <div style="flex:1"></div>
          <paper-icon-button id="extDomainHelpBtn" icon="icons:info-outline" title="Domain documentation"></paper-icon-button>
          <button class="infra-btn" id="extAddDomain">+ Add Domain</button>
        </div>
        <iron-collapse id="extDomainHelpPanel">
          <globular-markdown style="
            display: block; padding: 0 4px 12px;
            --md-font-size: .82rem;
            --divider-color: color-mix(in srgb, var(--on-surface-color) 12%, transparent);
          " id="extDomainDocs"></globular-markdown>
        </iron-collapse>
        <div id="extDomainForm"></div>
        <div id="extDomainList">${this.renderDomainList()}</div>
      </div>
    `

    el.querySelector('#extAddProvider')?.addEventListener('click', () => {
      this._showProviderForm = true
      this._editingProvider = null
      this.renderProviderForm(el.querySelector('#extProviderForm') as HTMLElement)
    })
    el.querySelector('#extAddDomain')?.addEventListener('click', () => {
      this._showDomainForm = true
      this._editingDomain = null
      this.renderDomainForm(el.querySelector('#extDomainForm') as HTMLElement)
    })

    // Wire help panels
    const provHelpMd = el.querySelector('#extProviderDocs') as HTMLElement
    if (provHelpMd) provHelpMd.textContent = EXT_PROVIDER_DOCS
    const provHelpPanel = el.querySelector('#extProviderHelpPanel') as any
    if (provHelpPanel && this._providerHelpOpen) provHelpPanel.opened = true
    el.querySelector('#extProviderHelpBtn')?.addEventListener('click', () => {
      this._providerHelpOpen = !this._providerHelpOpen
      provHelpPanel?.toggle()
    })

    const domHelpMd = el.querySelector('#extDomainDocs') as HTMLElement
    if (domHelpMd) domHelpMd.textContent = EXT_DOMAIN_DOCS
    const domHelpPanel = el.querySelector('#extDomainHelpPanel') as any
    if (domHelpPanel && this._domainHelpOpen) domHelpPanel.opened = true
    el.querySelector('#extDomainHelpBtn')?.addEventListener('click', () => {
      this._domainHelpOpen = !this._domainHelpOpen
      domHelpPanel?.toggle()
    })

    if (this._showProviderForm) {
      this.renderProviderForm(el.querySelector('#extProviderForm') as HTMLElement)
    }
    if (this._showDomainForm) {
      this.renderDomainForm(el.querySelector('#extDomainForm') as HTMLElement)
    }

    this.wireProviderListButtons(el)
    this.wireDomainListButtons(el)
  }

  private wireProviderListButtons(el: HTMLElement) {
    el.querySelectorAll('.ext-del-provider').forEach(btn => {
      btn.addEventListener('click', async () => {
        const name = (btn as HTMLElement).dataset.name!
        if (!confirm(`Delete provider "${name}"?`)) return
        try {
          await deleteProvider(name)
          this.load()
        } catch (e: any) {
          this._extError = e?.message ?? 'Failed to delete provider'
          this._pushData()
        }
      })
    })
    el.querySelectorAll('.ext-edit-provider').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt((btn as HTMLElement).dataset.idx!, 10)
        this._editingProvider = this._providers[idx] ?? null
        this._showProviderForm = true
        this.renderProviderForm(el.querySelector('#extProviderForm') as HTMLElement)
      })
    })
  }

  private wireDomainListButtons(el: HTMLElement) {
    el.querySelectorAll('.ext-del-domain').forEach(btn => {
      btn.addEventListener('click', async () => {
        const fqdn = (btn as HTMLElement).dataset.fqdn!
        if (!confirm(`Delete domain "${fqdn}"? This will stop reconciliation.`)) return
        try {
          await deleteDomainSpec(fqdn)
          this.load()
        } catch (e: any) {
          this._extError = e?.message ?? 'Failed to delete domain'
          this._pushData()
        }
      })
    })
    el.querySelectorAll('.ext-edit-domain').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt((btn as HTMLElement).dataset.idx!, 10)
        this._editingDomain = this._extDomains[idx] ?? null
        this._showDomainForm = true
        this.renderDomainForm(el.querySelector('#extDomainForm') as HTMLElement)
      })
    })
  }

  private renderProviderList(): string {
    if (this._providers.length === 0) {
      return '<div class="infra-empty">No DNS providers configured. Add one to manage external domains.</div>'
    }
    const rows = this._providers.map((p, i) => {
      const creds = Object.entries(p.credentials || {}).map(([k, v]) => `${esc(k)}: ${esc(v)}`).join(', ')
      return `
        <tr>
          <td style="font-family:monospace;font-size:.82rem;font-weight:600">${esc(p.name ?? '')}</td>
          <td>${badge(p.type.toUpperCase(), providerColor(p.type))}</td>
          <td style="font-family:monospace;font-size:.82rem">${esc(p.zone)}</td>
          <td style="font-size:.82rem;color:var(--secondary-text-color)">${creds || '—'}</td>
          <td style="font-size:.82rem">${p.default_ttl || 600}s</td>
          <td>
            <button class="ext-edit-provider ext-icon-btn" data-idx="${i}" title="Edit">&#9998;</button>
            <button class="ext-del-provider ext-icon-btn ext-icon-btn--danger" data-name="${esc(p.name ?? '')}" title="Delete">&#128465;</button>
          </td>
        </tr>
      `
    }).join('')

    return `
      <table class="infra-table">
        <thead><tr><th>Name</th><th>Type</th><th>Zone</th><th>Credentials</th><th>TTL</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    `
  }

  private renderDomainList(): string {
    if (this._extDomains.length === 0) {
      return '<div class="infra-empty">No external domains configured.</div>'
    }
    const rows = this._extDomains.map((d, i) => {
      const phase = d.status?.phase || 'Pending'
      const phaseColor = phase === 'Ready' ? '#22c55e' : phase === 'Error' ? 'var(--error-color)' : '#f59e0b'
      const certExp = d.status?.cert_expiry ? new Date(d.status.cert_expiry).toLocaleDateString() : '—'
      const ip = d.status?.current_ip || d.target_ip || '—'
      const errMsg = d.status?.message || ''
      const lastReconcile = d.status?.last_reconcile
        ? new Date(d.status.last_reconcile).toLocaleString()
        : ''
      return `
        <tr>
          <td style="font-family:monospace;font-size:.85rem;font-weight:600">${esc(d.fqdn)}</td>
          <td style="font-size:.82rem">${esc(d.zone)}</td>
          <td style="font-size:.82rem">${esc(d.provider_ref)}</td>
          <td style="font-family:monospace;font-size:.82rem">${esc(ip)}</td>
          <td title="${esc(errMsg)}">${badge(phase, phaseColor)}</td>
          <td style="font-size:.82rem">${certExp}</td>
          <td>
            <button class="ext-edit-domain ext-icon-btn" data-idx="${i}" title="Edit">&#9998;</button>
            <button class="ext-del-domain ext-icon-btn ext-icon-btn--danger" data-fqdn="${esc(d.fqdn)}" title="Delete">&#128465;</button>
          </td>
        </tr>
        ${phase === 'Error' && errMsg ? `
        <tr class="ext-error-row">
          <td colspan="7">
            <div class="ext-error-detail">
              <strong>Error:</strong> ${esc(errMsg)}
              ${lastReconcile ? `<span class="ext-error-time">Last attempt: ${esc(lastReconcile)}</span>` : ''}
            </div>
          </td>
        </tr>
        ` : ''}
      `
    }).join('')

    return `
      <table class="infra-table">
        <thead><tr><th>FQDN</th><th>Zone</th><th>Provider</th><th>IP</th><th>Status</th><th>Cert Exp.</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    `
  }

  private renderProviderForm(container: HTMLElement) {
    if (!container || !this._showProviderForm) return
    const p = this._editingProvider
    container.innerHTML = `
      <div class="ext-form">
        <h4>${p ? 'Edit Provider' : 'Add DNS Provider'}</h4>
        <div class="ext-form-grid">
          <label>Type
            <select id="extPType" class="dns-select">
              <option value="local" ${!p || p?.type === 'local' ? 'selected' : ''}>Local (built-in DNS)</option>
              <option value="cloudflare" ${p?.type === 'cloudflare' ? 'selected' : ''}>Cloudflare</option>
              <option value="godaddy" ${p?.type === 'godaddy' ? 'selected' : ''}>GoDaddy</option>
              <option value="route53" ${p?.type === 'route53' ? 'selected' : ''}>Route53</option>
              <option value="manual" ${p?.type === 'manual' ? 'selected' : ''}>Manual (print instructions)</option>
            </select>
          </label>
          <label>Zone <input id="extPZone" class="dns-input" value="${esc(p?.zone ?? '')}" placeholder="example.com"></label>
          <label>Default TTL <input id="extPTTL" type="number" class="dns-input" value="${p?.default_ttl ?? 600}" placeholder="600"></label>
        </div>
        <div id="extPCredsArea"></div>
        <div class="ext-form-actions">
          <button class="infra-btn" id="extPSave">Save</button>
          <button class="infra-btn ext-btn-cancel" id="extPCancel">Cancel</button>
        </div>
      </div>
    `

    const updateCreds = () => {
      const type = (container.querySelector('#extPType') as HTMLSelectElement).value
      const area = container.querySelector('#extPCredsArea') as HTMLElement
      const fields = providerCredFields(type)
      area.innerHTML = fields.map(f => `
        <label>${esc(f.label)}
          <input id="extPCred_${f.key}" class="dns-input" style="width:100%"
            value="${esc(p?.credentials?.[f.key] ?? '')}"
            placeholder="${esc(f.placeholder)}" type="${f.secret ? 'password' : 'text'}">
        </label>
      `).join('')
    }
    updateCreds()
    container.querySelector('#extPType')?.addEventListener('change', updateCreds)

    container.querySelector('#extPCancel')?.addEventListener('click', () => {
      this._showProviderForm = false
      this._editingProvider = null
      container.innerHTML = ''
    })

    container.querySelector('#extPSave')?.addEventListener('click', async () => {
      const type = (container.querySelector('#extPType') as HTMLSelectElement).value
      const zone = (container.querySelector('#extPZone') as HTMLInputElement).value.trim()
      const ttl = parseInt((container.querySelector('#extPTTL') as HTMLInputElement).value, 10) || 600
      const fields = providerCredFields(type)
      const credentials: Record<string, string> = {}
      for (const f of fields) {
        const el = container.querySelector(`#extPCred_${f.key}`) as HTMLInputElement
        if (el?.value) credentials[f.key] = el.value
      }
      try {
        await saveProvider({ type, zone, credentials, default_ttl: ttl })
        this._showProviderForm = false
        this._editingProvider = null
        this.load()
      } catch (e: any) {
        this._extError = e?.message ?? 'Failed to save provider'
        this._pushData()
      }
    })
  }

  private renderDomainForm(container: HTMLElement) {
    if (!container || !this._showDomainForm) return
    const d = this._editingDomain
    const hasProviders = this._providers.length > 0
    const providerOptions = this._providers.map(p => {
      return `<option value="${esc(p.name ?? '')}" ${d?.provider_ref === p.name ? 'selected' : ''}>${esc(p.name ?? '')} (${esc(p.zone)})</option>`
    }).join('')

    // When no providers exist, default to local (built-in DNS)
    const providerField = hasProviders
      ? `<label>Provider
          <select id="extDProv" class="dns-select">${providerOptions}</select>
        </label>`
      : `<label>Provider
          <span class="dns-input" style="display:inline-block;background:var(--surface-container);color:var(--secondary-text-color);cursor:default">local (built-in DNS)</span>
          <input type="hidden" id="extDProv" value="local">
        </label>`

    container.innerHTML = `
      <div class="ext-form">
        <h4>${d ? 'Edit Domain' : 'Add External Domain'}</h4>
        <div class="ext-form-grid">
          <label>FQDN <input id="extDFqdn" class="dns-input" value="${esc(d?.fqdn ?? '')}" placeholder="app.example.com"></label>
          <label>Zone <input id="extDZone" class="dns-input" value="${esc(d?.zone ?? '')}" placeholder="example.com"></label>
          <label>Node ID <input id="extDNode" class="dns-input" value="${esc(d?.node_id ?? '')}" placeholder="node-0"></label>
          <label>Target IP <input id="extDIP" class="dns-input" value="${esc(d?.target_ip ?? 'auto')}" placeholder="auto or IP"></label>
          ${providerField}
          <label>TTL <input id="extDTTL" type="number" class="dns-input" value="${d?.ttl ?? 600}" placeholder="600"></label>
        </div>
        <div class="ext-form-row">
          <label><input id="extDPub" type="checkbox" ${d?.publish_external ? 'checked' : ''}> Publish to external DNS</label>
          <label><input id="extDWild" type="checkbox" ${d?.use_wildcard_cert ? 'checked' : ''}> Use wildcard certificate</label>
        </div>
        <details class="ext-acme-details">
          <summary>ACME Settings</summary>
          <div class="ext-form-grid" style="margin-top:8px">
            <label><input id="extDAcme" type="checkbox" ${d?.acme?.enabled ? 'checked' : ''}> Enable ACME</label>
            <label>Email <input id="extDAcmeEmail" class="dns-input" value="${esc(d?.acme?.email ?? '')}" placeholder="admin@example.com"></label>
            <label>Challenge
              <select id="extDAcmeChal" class="dns-select">
                <option value="dns-01" ${d?.acme?.challenge_type === 'dns-01' ? 'selected' : ''}>dns-01</option>
                <option value="http-01" ${d?.acme?.challenge_type === 'http-01' ? 'selected' : ''}>http-01</option>
              </select>
            </label>
          </div>
        </details>
        <div class="ext-form-actions">
          <button class="infra-btn" id="extDSave">Save</button>
          <button class="infra-btn ext-btn-cancel" id="extDCancel">Cancel</button>
        </div>
      </div>
    `

    container.querySelector('#extDCancel')?.addEventListener('click', () => {
      this._showDomainForm = false
      this._editingDomain = null
      container.innerHTML = ''
    })

    container.querySelector('#extDSave')?.addEventListener('click', async () => {
      const spec: any = {
        fqdn: (container.querySelector('#extDFqdn') as HTMLInputElement).value.trim(),
        zone: (container.querySelector('#extDZone') as HTMLInputElement).value.trim(),
        node_id: (container.querySelector('#extDNode') as HTMLInputElement).value.trim(),
        target_ip: (container.querySelector('#extDIP') as HTMLInputElement).value.trim() || 'auto',
        provider_ref: (container.querySelector('#extDProv') as HTMLSelectElement | HTMLInputElement).value,
        publish_external: (container.querySelector('#extDPub') as HTMLInputElement).checked,
        use_wildcard_cert: (container.querySelector('#extDWild') as HTMLInputElement).checked,
        ttl: parseInt((container.querySelector('#extDTTL') as HTMLInputElement).value, 10) || 600,
        acme: {
          enabled: (container.querySelector('#extDAcme') as HTMLInputElement).checked,
          email: (container.querySelector('#extDAcmeEmail') as HTMLInputElement).value.trim(),
          ca_url: '',
          challenge_type: (container.querySelector('#extDAcmeChal') as HTMLSelectElement).value,
        },
        ingress: d?.ingress ?? { enabled: true, service: 'gateway', port: 443, gateway_port_http: 80, gateway_port_https: 443 },
      }
      try {
        // Ensure a local provider exists and provider_ref uses the server-derived name.
        // Server names providers as "{type}-{zone with dots as hyphens}".
        const derivedLocalName = 'local-' + spec.zone.replace(/\./g, '-')
        if (spec.provider_ref === 'local' || spec.provider_ref === derivedLocalName) {
          if (!this._providers.some(p => p.name === derivedLocalName)) {
            await saveProvider({
              type: 'local',
              zone: spec.zone,
              credentials: {},
              default_ttl: spec.ttl || 600,
            })
          }
          spec.provider_ref = derivedLocalName
        }
        // Also handle legacy "manual" provider_ref from earlier saves
        const derivedManualName = 'manual-' + spec.zone.replace(/\./g, '-')
        if (spec.provider_ref === 'manual' || spec.provider_ref === derivedManualName) {
          if (!this._providers.some(p => p.name === derivedLocalName)) {
            await saveProvider({
              type: 'local',
              zone: spec.zone,
              credentials: {},
              default_ttl: spec.ttl || 600,
            })
          }
          spec.provider_ref = derivedLocalName
        }
        await saveDomainSpec(spec)
        this._showDomainForm = false
        this._editingDomain = null
        this.load()
      } catch (e: any) {
        this._extError = e?.message ?? 'Failed to save domain'
        this._pushData()
      }
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

function providerColor(type: string): string {
  switch (type) {
    case 'cloudflare': return '#f38020'
    case 'godaddy':    return '#1bdbdb'
    case 'route53':    return '#ff9900'
    case 'local':      return '#3b82f6'
    case 'manual':     return '#64748b'
    default:           return 'var(--secondary-text-color)'
  }
}

function providerCredFields(type: string): Array<{ key: string; label: string; placeholder: string; secret: boolean }> {
  switch (type) {
    case 'cloudflare': return [
      { key: 'api_token', label: 'API Token', placeholder: 'Cloudflare API token', secret: true },
    ]
    case 'godaddy': return [
      { key: 'api_key', label: 'API Key', placeholder: 'GoDaddy API key', secret: true },
      { key: 'api_secret', label: 'API Secret', placeholder: 'GoDaddy API secret', secret: true },
    ]
    case 'route53': return [
      { key: 'aws_access_key_id', label: 'AWS Access Key ID', placeholder: 'AKIA...', secret: false },
      { key: 'aws_secret_access_key', label: 'AWS Secret Access Key', placeholder: 'Secret', secret: true },
      { key: 'aws_region', label: 'AWS Region', placeholder: 'us-east-1', secret: false },
    ]
    case 'local': return [
      { key: 'address', label: 'DNS Service Address', placeholder: 'localhost:10006 (default)', secret: false },
    ]
    case 'manual': return []
    default: return []
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

  /* External domains */
  .ext-section-header {
    display: flex; align-items: center; justify-content: space-between;
    margin-bottom: 12px;
  }
  .ext-section-header h3 {
    margin: 0; font-size: .95rem; font-weight: 700;
  }
  .ext-form {
    background: var(--md-surface-container-low);
    border: 1px solid var(--border-subtle-color);
    border-radius: var(--md-shape-md);
    padding: 16px; margin-bottom: 16px;
  }
  .ext-form h4 { margin: 0 0 12px; font-size: .9rem; }
  .ext-form-grid {
    display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: 10px; margin-bottom: 12px;
  }
  .ext-form-grid label {
    display: flex; flex-direction: column; gap: 4px;
    font-size: .82rem; color: var(--secondary-text-color);
  }
  .ext-form-grid .dns-input, .ext-form-grid .dns-select { width: 100%; box-sizing: border-box; }
  .ext-form-row {
    display: flex; gap: 16px; align-items: center; margin-bottom: 12px;
    font-size: .82rem;
  }
  .ext-form-row label { display: flex; align-items: center; gap: 4px; cursor: pointer; }
  .ext-form-actions { display: flex; gap: 8px; margin-top: 8px; }
  .ext-btn-cancel {
    background: transparent; border-color: var(--border-subtle-color);
    color: var(--secondary-text-color);
  }
  .ext-acme-details {
    margin-bottom: 12px; font-size: .85rem;
  }
  .ext-acme-details summary {
    cursor: pointer; color: var(--accent-color); font-weight: 600;
  }
  .ext-icon-btn {
    background: none; border: none; cursor: pointer;
    font-size: .9rem; padding: 2px 6px; border-radius: 4px;
    color: var(--secondary-text-color);
  }
  .ext-icon-btn:hover { background: color-mix(in srgb, var(--on-surface-color) 8%, transparent); }
  .ext-icon-btn--danger:hover { color: var(--error-color); }
  .ext-error-row td { padding: 0 !important; border-top: none !important; }
  .ext-error-detail {
    background: color-mix(in srgb, var(--error-color) 8%, transparent);
    border-left: 3px solid var(--error-color);
    padding: 6px 12px; margin: 0 0 4px;
    font-size: .78rem; color: var(--error-color);
    word-break: break-word;
  }
  .ext-error-time {
    display: inline-block; margin-left: 12px;
    color: var(--secondary-text-color); font-weight: normal;
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

// ─── External Domains Documentation ──────────────────────────────────────────

const EXT_PROVIDER_DOCS = `
# DNS Providers

A DNS provider connects Globular to your external DNS service so it can automatically create and update DNS records and obtain TLS certificates via ACME DNS-01 challenges.

**Each provider is bound to a single DNS zone.** If you manage multiple zones (e.g. \`example.com\` and \`example.io\`), create one provider per zone. The same API token/credentials can be reused across providers.

---

## Supported Providers

| Provider | Credentials Required | Notes |
|---|---|---|
| **Cloudflare** | API Token | Recommended. Use a scoped token with \`Zone:DNS:Edit\` permission. |
| **GoDaddy** | API Key + Secret | Production key required (not test/OTE). |
| **Route53** | AWS Access Key + Secret | Uses standard AWS SDK credential chain. IAM policy needs \`route53:ChangeResourceRecordSets\`. |
| **Manual** | None | No automatic DNS — you must create records yourself. ACME DNS-01 will not work. |

---

## Generating a Cloudflare API Token

1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com/profile/api-tokens)
2. Click **Create Token**
3. Use the **Edit zone DNS** template, or create a custom token with:
   - **Permissions:** Zone → DNS → Edit
   - **Zone Resources:** Include → Specific zone → *your zone*
   - For multiple zones, select "All zones" or add each zone
4. Click **Continue to summary** → **Create Token**
5. Copy the token — it is shown only once

> **Tip:** A single token with "All zones" permission works for all your Cloudflare-managed domains. You still need one *provider entry* per zone, but they can share the same token.

---

## CLI Reference

\`\`\`bash
# List all providers
globular domain provider list

# Add a Cloudflare provider
export CLOUDFLARE_API_TOKEN="your-token-here"
globular domain provider add \\
  --name my-cloudflare \\
  --type cloudflare \\
  --zone example.com \\
  --ttl 600

# Add a GoDaddy provider
export GODADDY_API_KEY="your-key"
export GODADDY_API_SECRET="your-secret"
globular domain provider add \\
  --name my-godaddy \\
  --type godaddy \\
  --zone example.com \\
  --ttl 600

# Remove a provider
globular domain provider remove --name my-cloudflare

# Show provider details (credentials masked)
globular domain provider list --output json
\`\`\`

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| \`Invalid format for Authorization header\` | Invalid or placeholder API token | Edit the provider and paste a real Cloudflare API token |
| \`zone mismatch: expected "X", got "Y"\` | Domain's zone doesn't match the provider's zone | Create a separate provider for zone Y, or update the domain to use the correct provider |
| \`CLOUDFLARE_API_TOKEN required\` | CLI can't find the env var | \`export CLOUDFLARE_API_TOKEN=...\` before running the command |
| \`HTTP 403\` from Cloudflare | Token lacks \`Zone:DNS:Edit\` permission | Regenerate token with correct permissions |
| Provider not found after adding via UI | Name mismatch | Check \`globular domain provider list\` — the name is auto-generated as \`type-zone\` |

\`\`\`bash
# Verify your Cloudflare token works
curl -s -H "Authorization: Bearer YOUR_TOKEN" \\
  "https://api.cloudflare.com/client/v4/zones" | jq '.result[].name'

# Check what's stored in etcd
globular domain provider list --output json | jq .
\`\`\`
`.trim()

const EXT_DOMAIN_DOCS = `
# External Domains

An external domain tells the reconciler to manage a public DNS record and (optionally) obtain a TLS certificate from Let's Encrypt via ACME.

The reconciler runs every 60 seconds. When you add or modify a domain, it will be picked up automatically.

---

## Key Concepts

| Field | Description |
|---|---|
| **FQDN** | The fully-qualified domain name (e.g. \`app.example.com\` or \`example.com\`) |
| **Zone** | The root DNS zone (e.g. \`example.com\`). FQDN must be a subdomain of this zone (or equal to it). |
| **Provider** | Which DNS provider to use. Must match the zone. |
| **Target IP** | Public IP for the A record. Use \`auto\` to detect automatically. |
| **Publish External** | If checked, the reconciler creates/updates the DNS A record at the provider. |
| **Wildcard Cert** | Request \`*.zone\` certificate instead of FQDN-specific. Useful for multiple subdomains. |
| **ACME** | Enable automatic TLS certificate acquisition via Let's Encrypt. |

---

## How It Works

1. **DNS Record** — If "Publish External" is enabled, the reconciler calls the provider API to create/update an A record pointing to your IP.
2. **TLS Certificate** — If ACME is enabled, the reconciler uses DNS-01 challenge to prove domain ownership and obtains a certificate from Let's Encrypt.
3. **Certificate Renewal** — Certificates are automatically renewed 30 days before expiry. Old certs stay active during renewal (no downtime).
4. **Ingress** — The certificate is stored at \`/var/lib/globular/domains/<fqdn>/\` and picked up by Envoy for TLS termination.

---

## CLI Reference

\`\`\`bash
# List all external domains with status
globular domain list

# Add an external domain with ACME
globular domain add \\
  --fqdn app.example.com \\
  --zone example.com \\
  --provider my-cloudflare \\
  --target-ip auto \\
  --publish-external \\
  --enable-acme \\
  --acme-email admin@example.com \\
  --ttl 600

# Add with wildcard certificate
globular domain add \\
  --fqdn example.com \\
  --zone example.com \\
  --provider my-cloudflare \\
  --target-ip auto \\
  --publish-external \\
  --use-wildcard-cert \\
  --enable-acme \\
  --acme-email admin@example.com

# Check domain status
globular domain status --fqdn app.example.com

# Check status as JSON (shows error details)
globular domain status --fqdn app.example.com --output json

# Remove a domain
globular domain remove --fqdn app.example.com
\`\`\`

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Status: **Error** + "provider not found" | Domain references a provider that doesn't exist | Create the provider first, or edit the domain to use an existing one |
| Status: **Error** + "zone mismatch" | Provider is for a different zone than the domain | Create a provider for the correct zone |
| Status: **Pending** (stuck) | Reconciler hasn't run yet, or cluster controller not running | Check: \`systemctl status globular-cluster-controller\` |
| Certificate not appearing | ACME is disabled, or DNS-01 challenge failed | Enable ACME, check provider credentials, verify DNS propagation |
| Certificate expired | Auto-renewal failed | Check controller logs: \`journalctl -u globular-cluster-controller -n 100\` |
| IP shows "auto" | Public IP detection failed | Set an explicit IP address instead |

\`\`\`bash
# Check reconciler logs
journalctl -u globular-cluster-controller.service -n 100 --no-pager \\
  | grep -i "reconcil\\|domain\\|cert\\|acme"

# Verify DNS record was created
dig app.example.com A +short

# Check certificate on disk
openssl x509 -in /var/lib/globular/domains/app.example.com/fullchain.pem \\
  -noout -subject -dates

# Force certificate renewal
# (via admin UI: Certificates → Renew Public)
# or manually:
touch /var/lib/globular/domains/app.example.com/.renew-requested

# View etcd data directly
globular domain status --fqdn app.example.com --output json | jq .
\`\`\`
`.trim()

customElements.define('page-infrastructure-dns', PageInfrastructureDns)
