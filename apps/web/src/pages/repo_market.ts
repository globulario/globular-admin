import { listArtifacts, ArtifactKind, type ArtifactManifest } from '@globular/sdk'

// ── Constants ───────────────────────────────────────────────────────────────

// INFRASTRUCTURE (5) may not be in the installed proto stubs yet; use a
// numeric constant so the page degrades gracefully on older builds.
const KIND_SERVICE        = ArtifactKind.SERVICE        // 1
const KIND_APPLICATION    = ArtifactKind.APPLICATION     // 2
const KIND_AGENT          = ArtifactKind.AGENT           // 3
const KIND_SUBSYSTEM      = ArtifactKind.SUBSYSTEM       // 4
const KIND_INFRASTRUCTURE = 5
const KIND_COMMAND        = 6

// Publish state constants (matches repository.proto PublishState enum)
const PS_PUBLISHED   = 3
const PS_DEPRECATED  = 6
const PS_YANKED      = 7
const PS_QUARANTINED = 8
const PS_REVOKED     = 9

// ── Extended manifest fields ────────────────────────────────────────────────
// The deployed proto may include fields (alias, description, keywordsList,
// publishedUnix) that are absent from older .d.ts stubs.  Access them through
// a loose accessor so TypeScript doesn't complain.
/* eslint-disable @typescript-eslint/no-explicit-any */
function ext(a: ArtifactManifest): any { return a as any }

// ── Helpers ─────────────────────────────────────────────────────────────────

function relativeTime(epochSeconds: number): string {
  if (!epochSeconds) return '--'
  const diff = Math.floor(Date.now() / 1000) - epochSeconds
  if (diff < 0)    return 'just now'
  if (diff < 60)   return `${diff}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

function kindLabel(kind: number): string {
  switch (kind) {
    case KIND_SERVICE:        return 'Service'
    case KIND_APPLICATION:    return 'Application'
    case KIND_INFRASTRUCTURE: return 'Infrastructure'
    case KIND_AGENT:          return 'Agent'
    case KIND_SUBSYSTEM:      return 'Subsystem'
    case KIND_COMMAND:        return 'Command'
    default:                  return 'Unknown'
  }
}

function kindBadgeColor(kind: number): string {
  switch (kind) {
    case KIND_SERVICE:        return '#2563eb'  // blue
    case KIND_APPLICATION:    return '#7c3aed'  // violet
    case KIND_INFRASTRUCTURE: return '#d97706'  // amber
    case KIND_COMMAND:        return '#059669'  // emerald
    case KIND_AGENT:
    case KIND_SUBSYSTEM:      return 'var(--secondary-text-color)'
    default:                  return 'var(--secondary-text-color)'
  }
}

function kindBadge(kind: number): string {
  const color = kindBadgeColor(kind)
  const label = kindLabel(kind)
  return `<span class="md-badge" style="--badge-color:${color}">${label}</span>`
}

function integrityChip(checksum: string): string {
  if (checksum) {
    return `<span class="md-chip md-chip-success">Verified</span>`
  }
  return `<span class="md-chip md-chip-warn">No checksum</span>`
}

function stateLabel(state: number): string {
  switch (state) {
    case 1:  return 'Staging'
    case 2:  return 'Verified'
    case PS_PUBLISHED:    return 'Published'
    case 4:  return 'Failed'
    case 5:  return 'Superseded'
    case PS_DEPRECATED:   return 'Deprecated'
    case PS_YANKED:       return 'Yanked'
    case PS_QUARANTINED:  return 'Quarantined'
    case PS_REVOKED:      return 'Revoked'
    default:              return 'Unknown'
  }
}

function stateColor(state: number): string {
  switch (state) {
    case PS_PUBLISHED:   return '#16a34a'
    case PS_DEPRECATED:  return '#ca8a04'
    case PS_YANKED:      return '#ea580c'
    case PS_QUARANTINED: return '#dc2626'
    case PS_REVOKED:     return '#7f1d1d'
    default:             return '#6b7280'
  }
}

function stateChip(state: number): string {
  return `<span class="md-badge" style="--badge-color:${stateColor(state)}">${stateLabel(state)}</span>`
}

function trustBadges(a: ArtifactManifest): string {
  const e = ext(a)
  const badges: string[] = []
  const trustLabels: string[] = e.trustLabelsList || []

  if (trustLabels.includes('verified_namespace') || trustLabels.includes('owned') || trustLabels.includes('official')) {
    badges.push('<span class="trust-badge trust-verified" title="Verified Publisher">Verified</span>')
  }
  if (trustLabels.includes('trusted_ci')) {
    badges.push('<span class="trust-badge trust-ci" title="Trusted CI Publish">CI</span>')
  }
  if (trustLabels.includes('machine_published') && !trustLabels.includes('trusted_ci')) {
    badges.push('<span class="trust-badge trust-machine" title="Machine Published">Bot</span>')
  }
  if (trustLabels.includes('unclaimed_namespace')) {
    badges.push('<span class="trust-badge trust-unclaimed" title="Unclaimed Namespace">Unclaimed</span>')
  }
  if (trustLabels.includes('quarantined')) {
    badges.push('<span class="trust-badge trust-quarantined" title="Quarantined">Quarantined</span>')
  }

  // Fallback: if no trust labels available, show nothing
  return badges.join(' ')
}

// ── Component ───────────────────────────────────────────────────────────────

class PageRepository extends HTMLElement {
  private _refreshTimer: number | null = null
  private _artifacts: ArtifactManifest[] = []
  private _loading = true
  private _error = ''
  private _searchQuery = ''
  private _kindFilter: number = 0 // 0 = all
  private _publisherFilter = ''   // '' = all
  private _stateFilter: number = -1 // -1 = all
  private _trustFilter = ''         // '' = all

  connectedCallback() {
    this.style.display = 'block'
    this.render()
    this.load()
    this._refreshTimer = window.setInterval(() => this.load(), 30_000)
  }

  disconnectedCallback() {
    if (this._refreshTimer) clearInterval(this._refreshTimer)
  }

  private async load() {
    try {
      this._artifacts = await listArtifacts()
      this._error = ''
    } catch (e: any) {
      this._error = e?.message || 'Failed to load packages from repository'
    }
    this._loading = false
    this.render()
  }

  private get filteredArtifacts(): ArtifactManifest[] {
    let list = this._artifacts

    // Kind filter
    if (this._kindFilter !== 0) {
      list = list.filter(a => a.ref?.kind === this._kindFilter)
    }

    // Publisher filter
    if (this._publisherFilter) {
      list = list.filter(a => a.ref?.publisherId === this._publisherFilter)
    }

    // State filter
    if (this._stateFilter >= 0) {
      list = list.filter(a => (ext(a).publishState ?? 0) === this._stateFilter)
    }

    // Trust filter
    if (this._trustFilter) {
      list = list.filter(a => {
        const labels: string[] = ext(a).trustLabelsList || []
        return labels.includes(this._trustFilter)
      })
    }

    // Search filter
    if (this._searchQuery) {
      const q = this._searchQuery.toLowerCase()
      list = list.filter(a => {
        const e = ext(a)
        const name = (a.ref?.name || '').toLowerCase()
        const alias = ((e.alias as string) || '').toLowerCase()
        const publisher = (a.ref?.publisherId || '').toLowerCase()
        const keywords = ((e.keywordsList as string[]) || []).join(' ').toLowerCase()
        const desc = ((e.description as string) || '').toLowerCase()
        return name.includes(q) || alias.includes(q) || publisher.includes(q)
            || keywords.includes(q) || desc.includes(q)
      })
    }

    return list
  }

  private get distinctPublishers(): string[] {
    const set = new Set<string>()
    for (const a of this._artifacts) {
      if (a.ref?.publisherId) set.add(a.ref.publisherId)
    }
    return Array.from(set).sort()
  }

  private countByKind(kind: number): number {
    return this._artifacts.filter(a => a.ref?.kind === kind).length
  }

  private countByState(state: number): number {
    return this._artifacts.filter(a => (ext(a) as any).publishState === state).length
  }

  private countVerified(): number {
    return this._artifacts.filter(a => {
      const labels: string[] = (ext(a) as any).trustLabelsList || []
      return labels.includes('owned') || labels.includes('verified_namespace') || labels.includes('official')
    }).length
  }

  private countTrustedCI(): number {
    return this._artifacts.filter(a => {
      const labels: string[] = (ext(a) as any).trustLabelsList || []
      return labels.includes('trusted_ci')
    }).length
  }

  private render() {
    const filtered = this.filteredArtifacts
    const publishers = this.distinctPublishers
    const total = this._artifacts.length
    const svcCount = this.countByKind(KIND_SERVICE)
    const appCount = this.countByKind(KIND_APPLICATION)
    const infraCount = this.countByKind(KIND_INFRASTRUCTURE)
    const cmdCount = this.countByKind(KIND_COMMAND)
    const verifiedCount = this.countVerified()
    const ciCount = this.countTrustedCI()
    const deprecatedCount = this.countByState(PS_DEPRECATED)
    const quarantinedCount = this.countByState(PS_QUARANTINED)

    this.innerHTML = `
      <style>
        .repo { padding: 16px; display: flex; flex-direction: column; gap: 20px; }

        /* header */
        .repo-header { display:flex; align-items:center; gap:12px; flex-wrap:wrap; }
        .repo-header h2 { margin:0; font: var(--md-typescale-headline-small); }
        .repo-subtitle { margin:2px 0 0; font: var(--md-typescale-body-medium);
          color:var(--secondary-text-color); opacity:.9; }
        .repo-header .spacer { flex:1; }

        /* trust badges */
        .trust-badge {
          display:inline-block; font-size:.65rem; font-weight:700; padding:2px 6px;
          border-radius:4px; text-transform:uppercase; letter-spacing:.04em; line-height:1.2;
        }
        .trust-verified { background:#dcfce7; color:#166534; }
        .trust-ci { background:#dbeafe; color:#1e40af; }
        .trust-machine { background:#f3f4f6; color:#6b7280; }
        .trust-unclaimed { background:#fef3c7; color:#92400e; }
        .trust-quarantined { background:#fee2e2; color:#991b1b; }

        /* stat cards */
        .stat-grid { display:grid; grid-template-columns:repeat(4,1fr); gap:12px; }
        @media(max-width:900px) { .stat-grid { grid-template-columns:repeat(4,1fr); } }
        @media(max-width:700px) { .stat-grid { grid-template-columns:repeat(2,1fr); } }
        .stat-card {
          background: var(--md-surface-container-low); border:1px solid var(--border-subtle-color);
          border-radius: var(--md-shape-md); padding:16px 20px;
          box-shadow: var(--md-elevation-1); cursor:pointer; transition: border-color .15s;
        }
        .stat-card:hover { border-color: var(--accent-color); }
        .stat-card.active { border-color: var(--accent-color);
          box-shadow: 0 0 0 1px var(--accent-color), var(--md-elevation-1); }
        .stat-card .label { font-size:.75rem; font-weight:600; text-transform:uppercase;
          letter-spacing:.06em; color:var(--secondary-text-color); margin-bottom:6px; }
        .stat-card .value { font-size:2rem; font-weight:800; line-height:1; }
        .stat-card .sub { font-size:.78rem; color:var(--secondary-text-color); margin-top:4px; }

        /* toolbar */
        .toolbar { display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
        .toolbar .search-input {
          padding:8px 12px; border:1px solid var(--border-strong-color);
          border-radius: var(--md-shape-sm); background:var(--md-surface-container-lowest);
          color:var(--on-surface-color); font: var(--md-typescale-body-medium);
          outline:none; transition: border-color .12s, box-shadow .12s;
          min-width:200px; flex:1; max-width:360px;
        }
        .toolbar .search-input:focus { border-color:var(--accent-color);
          box-shadow: var(--md-focus-ring); }
        .toolbar select {
          padding:8px 12px; border:1px solid var(--border-strong-color);
          border-radius: var(--md-shape-sm); background:var(--md-surface-container-lowest);
          color:var(--on-surface-color); font: var(--md-typescale-body-medium);
          outline:none; cursor:pointer;
        }
        .toolbar select:focus { border-color:var(--accent-color);
          box-shadow: var(--md-focus-ring); }

        /* table enhancements */
        .pkg-name { font-weight:600; }
        .pkg-alias { font-size:.7rem; color:var(--secondary-text-color); margin-top:1px; }

        /* empty / loading / error */
        .empty-state { text-align:center; padding:48px 16px; }
        .empty-state h3 { margin:0 0 8px; font: var(--md-typescale-title-medium);
          color:var(--secondary-text-color); }
        .empty-state p { margin:0; font: var(--md-typescale-body-medium);
          color:var(--secondary-text-color); opacity:.7; }
        .loading-msg { color:var(--secondary-text-color); font-size:.85rem;
          font-style:italic; padding:16px; }
      </style>

      <div class="repo">

        <!-- Header -->
        <div>
          <div class="repo-header">
            <h2>Repository</h2>
            <span class="spacer"></span>
            <button class="md-btn md-btn-outlined" id="btnRefresh">Refresh</button>
          </div>
          <p class="repo-subtitle">Browse and manage deployable packages across the cluster.</p>
        </div>

        ${this._loading ? '<div class="loading-msg">Loading packages...</div>' : ''}

        ${this._error ? `
        <div class="md-banner-warn">
          ${this._error}
          <button class="md-btn md-btn-outlined md-btn-sm" id="btnRetry" style="margin-left:12px">Retry</button>
        </div>
        ` : ''}

        ${!this._loading && !this._error ? `
        <!-- Stat Cards -->
        <div class="stat-grid">
          <div class="stat-card${this._kindFilter === 0 ? ' active' : ''}" data-kind="0">
            <div class="label">Total Packages</div>
            <div class="value">${total}</div>
            <div class="sub">all types</div>
          </div>
          <div class="stat-card${this._kindFilter === KIND_SERVICE ? ' active' : ''}" data-kind="${KIND_SERVICE}">
            <div class="label">Services</div>
            <div class="value" style="color:#2563eb">${svcCount}</div>
            <div class="sub">gRPC services</div>
          </div>
          <div class="stat-card${this._kindFilter === KIND_APPLICATION ? ' active' : ''}" data-kind="${KIND_APPLICATION}">
            <div class="label">Applications</div>
            <div class="value" style="color:#7c3aed">${appCount}</div>
            <div class="sub">web applications</div>
          </div>
          <div class="stat-card${this._kindFilter === KIND_INFRASTRUCTURE ? ' active' : ''}" data-kind="${KIND_INFRASTRUCTURE}">
            <div class="label">Infrastructure</div>
            <div class="value" style="color:#d97706">${infraCount}</div>
            <div class="sub">system daemons</div>
          </div>
          <div class="stat-card${this._kindFilter === KIND_COMMAND ? ' active' : ''}" data-kind="${KIND_COMMAND}">
            <div class="label">Commands</div>
            <div class="value" style="color:#059669">${cmdCount}</div>
            <div class="sub">CLI tools</div>
          </div>
        </div>
        <div class="stat-grid">
          <div class="stat-card" data-trust="verified" style="cursor:pointer">
            <div class="label">Verified Publishers</div>
            <div class="value" style="color:#16a34a">${verifiedCount}</div>
            <div class="sub">owned namespaces</div>
          </div>
          <div class="stat-card" data-trust="trusted_ci" style="cursor:pointer">
            <div class="label">Trusted CI</div>
            <div class="value" style="color:#2563eb">${ciCount}</div>
            <div class="sub">automated publish</div>
          </div>
          <div class="stat-card" data-state="${PS_DEPRECATED}" style="cursor:pointer">
            <div class="label">Deprecated</div>
            <div class="value" style="color:#ca8a04">${deprecatedCount}</div>
            <div class="sub">end-of-life</div>
          </div>
          <div class="stat-card" data-state="${PS_QUARANTINED}" style="cursor:pointer">
            <div class="label">Quarantined</div>
            <div class="value" style="color:#dc2626">${quarantinedCount}</div>
            <div class="sub">security review</div>
          </div>
        </div>

        <!-- Toolbar -->
        <div class="toolbar">
          <input type="text" class="search-input" id="searchInput"
            placeholder="Search packages..." value="${this._searchQuery.replace(/"/g, '&quot;')}" />
          <select id="kindSelect">
            <option value="0"${this._kindFilter === 0 ? ' selected' : ''}>All Types</option>
            <option value="${KIND_SERVICE}"${this._kindFilter === KIND_SERVICE ? ' selected' : ''}>Services</option>
            <option value="${KIND_APPLICATION}"${this._kindFilter === KIND_APPLICATION ? ' selected' : ''}>Applications</option>
            <option value="${KIND_INFRASTRUCTURE}"${this._kindFilter === KIND_INFRASTRUCTURE ? ' selected' : ''}>Infrastructure</option>
            <option value="${KIND_COMMAND}"${this._kindFilter === KIND_COMMAND ? ' selected' : ''}>Commands</option>
          </select>
          <select id="publisherSelect">
            <option value=""${this._publisherFilter === '' ? ' selected' : ''}>All Publishers</option>
            ${publishers.map(p => `<option value="${p}"${this._publisherFilter === p ? ' selected' : ''}>${p}</option>`).join('')}
          </select>
          <select id="stateSelect">
            <option value="-1"${this._stateFilter === -1 ? ' selected' : ''}>All States</option>
            <option value="${PS_PUBLISHED}"${this._stateFilter === PS_PUBLISHED ? ' selected' : ''}>Published</option>
            <option value="${PS_DEPRECATED}"${this._stateFilter === PS_DEPRECATED ? ' selected' : ''}>Deprecated</option>
            <option value="${PS_YANKED}"${this._stateFilter === PS_YANKED ? ' selected' : ''}>Yanked</option>
            <option value="${PS_QUARANTINED}"${this._stateFilter === PS_QUARANTINED ? ' selected' : ''}>Quarantined</option>
          </select>
          <select id="trustSelect">
            <option value=""${this._trustFilter === '' ? ' selected' : ''}>All Trust</option>
            <option value="owned"${this._trustFilter === 'owned' ? ' selected' : ''}>Verified</option>
            <option value="trusted_ci"${this._trustFilter === 'trusted_ci' ? ' selected' : ''}>Trusted CI</option>
            <option value="unclaimed_namespace"${this._trustFilter === 'unclaimed_namespace' ? ' selected' : ''}>Unclaimed</option>
          </select>
        </div>

        <!-- Package Table -->
        ${filtered.length > 0 ? `
        <div class="md-panel" style="margin-bottom:0">
          <table class="md-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Type</th>
                <th>Version</th>
                <th>Build</th>
                <th>Publisher</th>
                <th>Trust</th>
                <th>Platform</th>
                <th>State</th>
                <th>Integrity</th>
                <th>Published</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody class="md-interactive">
              ${filtered.map(a => {
                const e = ext(a)
                const ref = a.ref
                const name = ref?.name || '\u2014'
                const publisher = ref?.publisherId || '\u2014'
                const version = ref?.version || '\u2014'
                const platform = ref?.platform || '\u2014'
                const kind = ref?.kind ?? 0
                const alias: string = e.alias || ''
                const ts: number = e.publishedUnix || a.modifiedUnix || 0
                const buildNum: number = e.buildNumber || 0
                const state: number = e.publishState ?? 0
                return `
              <tr class="pkg-row" data-publisher="${(publisher).replace(/"/g, '&quot;')}" data-name="${(name).replace(/"/g, '&quot;')}">
                <td>
                  <div class="pkg-name">${name}</div>
                  ${alias ? `<div class="pkg-alias">${alias}</div>` : ''}
                </td>
                <td>${kindBadge(kind)}</td>
                <td>${version}</td>
                <td>${buildNum > 0 ? 'build ' + buildNum : 'build 0'}</td>
                <td>${publisher}</td>
                <td>${trustBadges(a)}</td>
                <td>${platform}</td>
                <td>${stateChip(state)}</td>
                <td>${integrityChip(a.checksum)}</td>
                <td style="color:var(--secondary-text-color); white-space:nowrap">${relativeTime(ts)}</td>
                <td>
                  <button class="md-btn md-btn-text md-btn-sm btn-view"
                    data-publisher="${(publisher).replace(/"/g, '&quot;')}"
                    data-name="${(name).replace(/"/g, '&quot;')}">View</button>
                </td>
              </tr>`
              }).join('')}
            </tbody>
          </table>
        </div>
        ` : `
        <div class="empty-state">
          <h3>No packages found in the repository.</h3>
          <p>Publish a service, application, or infrastructure package to make it available.</p>
        </div>
        `}
        ` : ''}

      </div>
    `

    // Wire up events
    this.querySelector('#btnRefresh')?.addEventListener('click', () => {
      this._loading = true
      this.render()
      this.load()
    })

    this.querySelector('#btnRetry')?.addEventListener('click', () => {
      this._error = ''
      this._loading = true
      this.render()
      this.load()
    })

    // Stat card clicks
    this.querySelectorAll('.stat-card').forEach(card => {
      card.addEventListener('click', () => {
        const kind = parseInt((card as HTMLElement).dataset.kind || '0', 10)
        this._kindFilter = kind
        this.render()
      })
    })

    // Search
    const searchInput = this.querySelector('#searchInput') as HTMLInputElement | null
    if (searchInput) {
      searchInput.addEventListener('input', () => {
        this._searchQuery = searchInput.value
        this.render()
        // Re-focus and restore cursor position
        const newInput = this.querySelector('#searchInput') as HTMLInputElement | null
        if (newInput) {
          newInput.focus()
          newInput.setSelectionRange(newInput.value.length, newInput.value.length)
        }
      })
    }

    // Kind dropdown
    this.querySelector('#kindSelect')?.addEventListener('change', (e) => {
      this._kindFilter = parseInt((e.target as HTMLSelectElement).value, 10)
      this.render()
    })

    // Publisher dropdown
    this.querySelector('#publisherSelect')?.addEventListener('change', (e) => {
      this._publisherFilter = (e.target as HTMLSelectElement).value
      this.render()
    })

    // State dropdown
    this.querySelector('#stateSelect')?.addEventListener('change', (e) => {
      this._stateFilter = parseInt((e.target as HTMLSelectElement).value, 10)
      this.render()
    })

    // Trust dropdown
    this.querySelector('#trustSelect')?.addEventListener('change', (e) => {
      this._trustFilter = (e.target as HTMLSelectElement).value
      this.render()
    })

    // Trust stat card clicks
    this.querySelectorAll('.stat-card[data-trust]').forEach(card => {
      card.addEventListener('click', () => {
        const trust = (card as HTMLElement).dataset.trust || ''
        this._trustFilter = this._trustFilter === trust ? '' : trust
        this.render()
      })
    })

    // State stat card clicks
    this.querySelectorAll('.stat-card[data-state]').forEach(card => {
      card.addEventListener('click', () => {
        const state = parseInt((card as HTMLElement).dataset.state || '-1', 10)
        this._stateFilter = this._stateFilter === state ? -1 : state
        this.render()
      })
    })

    // Row clicks
    this.querySelectorAll('.pkg-row').forEach(row => {
      row.addEventListener('click', (e) => {
        // Don't navigate if clicking the View button (it handles its own nav)
        if ((e.target as HTMLElement).closest('.btn-view')) return
        const publisher = (row as HTMLElement).dataset.publisher || ''
        const name = (row as HTMLElement).dataset.name || ''
        window.location.hash = `#/repository/package/${encodeURIComponent(publisher)}/${encodeURIComponent(name)}`
      })
    })

    // View button clicks
    this.querySelectorAll('.btn-view').forEach(btn => {
      btn.addEventListener('click', () => {
        const publisher = (btn as HTMLElement).dataset.publisher || ''
        const name = (btn as HTMLElement).dataset.name || ''
        window.location.hash = `#/repository/package/${encodeURIComponent(publisher)}/${encodeURIComponent(name)}`
      })
    })
  }
}

customElements.define('page-repository', PageRepository)
