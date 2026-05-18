import {
  listArtifacts,
  fetchInstalledPackages,
  ArtifactKind,
  type ArtifactManifest,
  type InstalledPackage,
} from '@globular/sdk'

// ── Constants ───────────────────────────────────────────────────────────────

const KIND_SERVICE        = ArtifactKind.SERVICE        // 1
const KIND_APPLICATION    = ArtifactKind.APPLICATION     // 2
const KIND_INFRASTRUCTURE = 5

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Loose accessor for extended fields not yet in .d.ts stubs. */
/* eslint-disable @typescript-eslint/no-explicit-any */
function ext(a: ArtifactManifest): any { return a as any }

function kindFromString(k: string): number {
  switch (k.toLowerCase()) {
    case 'service':        return KIND_SERVICE
    case 'application':    return KIND_APPLICATION
    case 'infrastructure': return KIND_INFRASTRUCTURE
    default:               return 0
  }
}

function kindLabel(kind: number): string {
  switch (kind) {
    case KIND_SERVICE:        return 'Service'
    case KIND_APPLICATION:    return 'Application'
    case KIND_INFRASTRUCTURE: return 'Infrastructure'
    default:                  return 'Unknown'
  }
}

function kindBadgeColor(kind: number): string {
  switch (kind) {
    case KIND_SERVICE:        return '#2563eb'
    case KIND_APPLICATION:    return '#7c3aed'
    case KIND_INFRASTRUCTURE: return '#d97706'
    default:                  return 'var(--secondary-text-color)'
  }
}

function kindBadge(kind: number): string {
  const color = kindBadgeColor(kind)
  const label = kindLabel(kind)
  return `<span class="md-badge" style="--badge-color:${color}">${label}</span>`
}

// Status labels aligned with the 4-layer model (docs/repository_state_alignment.md).
// 'installed' = version matches repo latest; 'drifted' = version differs from repo.
type DriftStatus = 'installed' | 'drifted' | 'missing-in-repo' | 'failed' | 'updating' | 'removing' | 'unknown'

function computeStatus(pkg: InstalledPackage, latestVersion: string | null): DriftStatus {
  const st = (pkg as any).status as string | undefined
  if (st === 'failed')   return 'failed'
  if (st === 'updating') return 'updating'
  if (st === 'removing') return 'removing'
  if (!latestVersion)    return 'missing-in-repo'
  if (pkg.version === latestVersion) return 'installed'
  return 'drifted'
}

function statusBadge(status: DriftStatus): string {
  switch (status) {
    case 'installed':
      return '<span class="md-chip md-chip-success">Installed</span>'
    case 'drifted':
      return '<span class="md-chip md-chip-warn">Drifted</span>'
    case 'missing-in-repo':
      return '<span class="md-chip md-chip-neutral">Missing in repo</span>'
    case 'failed':
      return '<span class="md-chip md-chip-error">Failed</span>'
    case 'updating':
      return `<span class="md-badge" style="--badge-color:#2563eb">Updating...</span>`
    case 'removing':
      return '<span class="md-chip md-chip-neutral">Removing...</span>'
    case 'unknown':
    default:
      return '<span class="md-chip md-chip-neutral">Unknown</span>'
  }
}

function integrityChip(pkg: InstalledPackage): string {
  const checksum = (pkg as any).checksum as string | undefined
  if (checksum) {
    return '<span class="md-chip md-chip-success">Verified</span>'
  }
  return '<span class="md-chip md-chip-neutral">--</span>'
}

function esc(s: string): string {
  return s.replace(/"/g, '&quot;')
}

// ── Module-level stale-while-revalidate cache ────────────────────────────────

interface RepoInstalledCacheData {
  installed: InstalledPackage[]
  artifacts: ArtifactManifest[]
}
const _cache: { data: RepoInstalledCacheData | null; fetchedAt: number } = { data: null, fetchedAt: 0 }

// ── Component ───────────────────────────────────────────────────────────────

class PageRepoInstalled extends HTMLElement {
  private _built = false
  private _refreshTimer: number | null = null
  private _installed: InstalledPackage[] = []
  private _artifacts: ArtifactManifest[] = []
  private _loading = true
  private _error = ''

  // Filters
  private _searchQuery = ''
  private _nodeFilter = ''    // '' = all
  private _kindFilter = ''    // '' = all
  private _statusFilter = ''  // '' = all

  // Derived: latest version map  name -> version
  private _latestMap: Map<string, string> = new Map()

  connectedCallback() {
    this.style.display = 'block'
    this._buildShell()
    // Show stale data immediately on remount
    if (_cache.data !== null) {
      this._installed = _cache.data.installed
      this._artifacts = _cache.data.artifacts
      this._loading = false
      // Rebuild latest version map from cached artifacts
      this._latestMap = new Map()
      for (const a of this._artifacts) {
        const name = a.ref?.name || ''
        if (!name) continue
        const existing = this._latestMap.get(name)
        const ver = a.ref?.version || ''
        if (!existing || ver > existing) this._latestMap.set(name, ver)
      }
      this._pushData()
    }
    this._load()
    this._refreshTimer = window.setInterval(() => this._load(), 30_000)
  }

  disconnectedCallback() {
    if (this._refreshTimer) clearInterval(this._refreshTimer)
  }

  private _buildShell() {
    if (this._built) return
    this._built = true
    this.innerHTML = `
      <style>
        .installed { padding: 16px; display: flex; flex-direction: column; gap: 20px; }

        /* header */
        .installed-header { display:flex; align-items:center; gap:12px; flex-wrap:wrap; }
        .installed-header h2 { margin:0; font: var(--md-typescale-headline-small); }
        .installed-subtitle { margin:2px 0 0; font: var(--md-typescale-body-medium);
          color:var(--secondary-text-color); opacity:.9; }
        .installed-header .spacer { flex:1; }

        /* stat strip */
        .stat-strip { display:grid; grid-template-columns:repeat(5,1fr); gap:10px; }
        @media(max-width:800px) { .stat-strip { grid-template-columns:repeat(3,1fr); } }
        @media(max-width:500px) { .stat-strip { grid-template-columns:repeat(2,1fr); } }
        .stat-mini {
          background: var(--md-surface-container-low); border:1px solid var(--border-subtle-color);
          border-radius: var(--md-shape-md); padding:12px 16px;
          box-shadow: var(--md-elevation-1); cursor:pointer; transition: border-color .15s;
        }
        .stat-mini:hover { border-color: var(--accent-color); }
        .stat-mini.active { border-color: var(--accent-color);
          box-shadow: 0 0 0 1px var(--accent-color), var(--md-elevation-1); }
        .stat-mini .label { font-size:.7rem; font-weight:600; text-transform:uppercase;
          letter-spacing:.06em; color:var(--secondary-text-color); margin-bottom:4px; }
        .stat-mini .value { font-size:1.6rem; font-weight:800; line-height:1; }

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
        .node-group-header td {
          font-weight:700; font-size:.8rem; text-transform:uppercase; letter-spacing:.04em;
          background: var(--md-surface-container); color:var(--secondary-text-color);
          padding:10px 12px !important; border-bottom:1px solid var(--border-subtle-color);
        }
        .ver-match { color:var(--success-color); }
        .ver-mismatch { color:#f59e0b; font-weight:600; }

        /* empty / loading / error */
        .empty-state { text-align:center; padding:48px 16px; }
        .empty-state h3 { margin:0 0 8px; font: var(--md-typescale-title-medium);
          color:var(--secondary-text-color); }
        .empty-state p { margin:0; font: var(--md-typescale-body-medium);
          color:var(--secondary-text-color); opacity:.7; }
        .loading-msg { color:var(--secondary-text-color); font-size:.85rem;
          font-style:italic; padding:16px; }
      </style>

      <div class="installed">

        <!-- Header (static) -->
        <div>
          <div class="installed-header">
            <h2>Installed Packages</h2>
            <span class="spacer"></span>
            <button class="md-btn md-btn-outlined" id="btnRefresh">Refresh</button>
          </div>
          <p class="installed-subtitle">Track package presence, versions, and drift across nodes.</p>
        </div>

        <div data-bind="loading"></div>
        <div data-bind="error"></div>
        <div data-bind="stats"></div>
        <div data-bind="toolbar"></div>
        <div data-bind="table"></div>

      </div>
    `

    this.querySelector('#btnRefresh')?.addEventListener('click', () => {
      this._loading = true
      this._pushData()
      this._load()
    })
  }

  private _set(bind: string, html: string) {
    const el = this.querySelector(`[data-bind="${bind}"]`) as HTMLElement | null
    if (el) el.innerHTML = html
  }

  private async _load() {
    try {
      // Wrap each call with a timeout to prevent the page from hanging
      // indefinitely if a backend (gRPC/REST) connection stalls.
      const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T> =>
        Promise.race([p, new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('timeout')), ms))])
      const [installedResult, artifactsResult] = await Promise.allSettled([
        withTimeout(fetchInstalledPackages(), 15_000),
        withTimeout(listArtifacts(), 15_000),
      ])

      if (installedResult.status === 'fulfilled') {
        this._installed = installedResult.value
      } else {
        // fetchInstalledPackages may not exist yet; degrade gracefully
        this._installed = []
        console.warn('fetchInstalledPackages failed:', (installedResult.reason as any)?.message)
      }

      if (artifactsResult.status === 'fulfilled') {
        this._artifacts = artifactsResult.value
      } else {
        this._artifacts = []
      }

      // Build latest version map (name -> highest version)
      this._latestMap = new Map()
      for (const a of this._artifacts) {
        const name = a.ref?.name || ''
        if (!name) continue
        const existing = this._latestMap.get(name)
        const ver = a.ref?.version || ''
        // Artifacts are typically sorted desc by backend, but compare anyway
        if (!existing || ver > existing) {
          this._latestMap.set(name, ver)
        }
      }

      this._error = ''
      _cache.data = { installed: this._installed, artifacts: this._artifacts }
      _cache.fetchedAt = Date.now()
    } catch (e: any) {
      this._error = e?.message || 'Failed to load installed packages'
    }
    this._loading = false
    this._pushData()
  }

  // ── Computed properties ─────────────────────────────────────────────────

  private statusOf(pkg: InstalledPackage): DriftStatus {
    return computeStatus(pkg, this._latestMap.get(pkg.name) ?? null)
  }

  private get distinctNodes(): string[] {
    const set = new Set<string>()
    for (const p of this._installed) {
      if (p.nodeId) set.add(p.nodeId)
    }
    return Array.from(set).sort()
  }

  private get filteredInstalled(): InstalledPackage[] {
    let list = this._installed

    // Node filter
    if (this._nodeFilter) {
      list = list.filter(p => p.nodeId === this._nodeFilter)
    }

    // Kind filter
    if (this._kindFilter) {
      list = list.filter(p => p.kind?.toLowerCase() === this._kindFilter.toLowerCase())
    }

    // Status filter
    if (this._statusFilter) {
      list = list.filter(p => {
        const s = this.statusOf(p)
        return s === this._statusFilter
      })
    }

    // Search filter
    if (this._searchQuery) {
      const q = this._searchQuery.toLowerCase()
      list = list.filter(p => {
        return (p.name || '').toLowerCase().includes(q)
            || (p.publisher || '').toLowerCase().includes(q)
            || (p.nodeId || '').toLowerCase().includes(q)
            || (p.version || '').toLowerCase().includes(q)
      })
    }

    return list
  }

  /** Group filtered packages by nodeId, sorted by node name. */
  private get groupedByNode(): Map<string, InstalledPackage[]> {
    const map = new Map<string, InstalledPackage[]>()
    for (const p of this.filteredInstalled) {
      const node = p.nodeId || 'unknown'
      if (!map.has(node)) map.set(node, [])
      map.get(node)!.push(p)
    }
    // Sort entries by node name
    return new Map([...map.entries()].sort((a, b) => a[0].localeCompare(b[0])))
  }

  // ── Stats ──────────────────────────────────────────────────────────────

  private get totalInstalled(): number { return this._installed.length }

  private get distinctPackages(): number {
    const set = new Set<string>()
    for (const p of this._installed) set.add(p.name)
    return set.size
  }

  private get nodeCount(): number { return this.distinctNodes.length }

  private get updateAvailableCount(): number {
    return this._installed.filter(p => this.statusOf(p) === 'drifted').length
  }

  private get failedCount(): number {
    return this._installed.filter(p => this.statusOf(p) === 'failed').length
  }

  // ── Push data into slots ───────────────────────────────────────────────

  private _pushData() {
    this._set('loading', (this._loading && _cache.data === null) ? '<div class="loading-msg">Loading installed packages...</div>' : '')

    if (this._error) {
      this._set('error', `
        <div class="md-banner-warn">
          ${this._error}
          <button class="md-btn md-btn-outlined md-btn-sm" id="btnRetry" style="margin-left:12px">Retry</button>
        </div>
      `)
      this.querySelector('#btnRetry')?.addEventListener('click', () => {
        this._error = ''
        this._loading = true
        this._pushData()
        this._load()
      })
    } else {
      this._set('error', '')
    }

    // If loading (no cache) or error with no cache, skip rendering data slots
    if ((this._loading && _cache.data === null) || (this._error && _cache.data === null)) {
      this._set('stats', '')
      this._set('toolbar', '')
      this._set('table', '')
      return
    }

    const nodes = this.distinctNodes

    // Stats strip
    this._set('stats', `
      <div class="stat-strip">
        <div class="stat-mini${this._statusFilter === '' ? ' active' : ''}" data-status="">
          <div class="label">Total Installed</div>
          <div class="value">${this.totalInstalled}</div>
        </div>
        <div class="stat-mini" style="cursor:default">
          <div class="label">Distinct Packages</div>
          <div class="value">${this.distinctPackages}</div>
        </div>
        <div class="stat-mini" style="cursor:default">
          <div class="label">Nodes</div>
          <div class="value">${this.nodeCount}</div>
        </div>
        <div class="stat-mini${this._statusFilter === 'drifted' ? ' active' : ''}" data-status="drifted">
          <div class="label">Drifted</div>
          <div class="value" style="color:#f59e0b">${this.updateAvailableCount}</div>
        </div>
        <div class="stat-mini${this._statusFilter === 'failed' ? ' active' : ''}" data-status="failed">
          <div class="label">Failed</div>
          <div class="value" style="color:var(--error-color)">${this.failedCount}</div>
        </div>
      </div>
    `)

    // Stat card clicks (filter by status)
    this.querySelectorAll('.stat-mini[data-status]').forEach(card => {
      card.addEventListener('click', () => {
        const status = (card as HTMLElement).dataset.status || ''
        this._statusFilter = this._statusFilter === status ? '' : status
        this._pushData()
      })
    })

    // Toolbar
    this._set('toolbar', `
      <div class="toolbar">
        <input type="text" class="search-input" id="searchInput"
          placeholder="Search packages..." value="${esc(this._searchQuery)}" />
        <select id="nodeSelect">
          <option value=""${this._nodeFilter === '' ? ' selected' : ''}>All Nodes</option>
          ${nodes.map(n => `<option value="${esc(n)}"${this._nodeFilter === n ? ' selected' : ''}>${n}</option>`).join('')}
        </select>
        <select id="kindSelect">
          <option value=""${this._kindFilter === '' ? ' selected' : ''}>All Types</option>
          <option value="service"${this._kindFilter === 'service' ? ' selected' : ''}>Services</option>
          <option value="application"${this._kindFilter === 'application' ? ' selected' : ''}>Applications</option>
          <option value="infrastructure"${this._kindFilter === 'infrastructure' ? ' selected' : ''}>Infrastructure</option>
        </select>
        <select id="statusSelect">
          <option value=""${this._statusFilter === '' ? ' selected' : ''}>All Statuses</option>
          <option value="installed"${this._statusFilter === 'installed' ? ' selected' : ''}>Installed</option>
          <option value="drifted"${this._statusFilter === 'drifted' ? ' selected' : ''}>Drifted</option>
          <option value="missing-in-repo"${this._statusFilter === 'missing-in-repo' ? ' selected' : ''}>Missing in repo</option>
          <option value="failed"${this._statusFilter === 'failed' ? ' selected' : ''}>Failed</option>
        </select>
      </div>
    `)

    // Search
    const searchInput = this.querySelector('#searchInput') as HTMLInputElement | null
    if (searchInput) {
      searchInput.addEventListener('input', () => {
        this._searchQuery = searchInput.value
        this._pushTable()
        const newInput = this.querySelector('#searchInput') as HTMLInputElement | null
        if (newInput) {
          newInput.focus()
          newInput.setSelectionRange(newInput.value.length, newInput.value.length)
        }
      })
    }

    // Node dropdown
    this.querySelector('#nodeSelect')?.addEventListener('change', (e) => {
      this._nodeFilter = (e.target as HTMLSelectElement).value
      this._pushData()
    })

    // Kind dropdown
    this.querySelector('#kindSelect')?.addEventListener('change', (e) => {
      this._kindFilter = (e.target as HTMLSelectElement).value
      this._pushData()
    })

    // Status dropdown
    this.querySelector('#statusSelect')?.addEventListener('change', (e) => {
      this._statusFilter = (e.target as HTMLSelectElement).value
      this._pushData()
    })

    this._pushTable()
  }

  private _pushTable() {
    const grouped = this.groupedByNode
    const filteredCount = this.filteredInstalled.length

    if (filteredCount === 0) {
      this._set('table', `
        <div class="empty-state">
          <h3>No installed packages found.</h3>
          <p>Install packages from the repository catalog to see them here.</p>
        </div>
      `)
      return
    }

    const tableHtml = `
      <div class="md-panel" style="margin-bottom:0">
        <table class="md-table">
          <thead>
            <tr>
              <th>Package</th>
              <th>Type</th>
              <th>Installed Version</th>
              <th>Latest Version</th>
              <th>Status</th>
              <th>Integrity</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody class="md-interactive">
            ${Array.from(grouped.entries()).map(([node, pkgs]) => {
              const nodeHeader = `
            <tr class="node-group-header">
              <td colspan="7">${node}</td>
            </tr>`
              const rows = pkgs.map(p => {
                const kind = kindFromString(p.kind || '')
                const latest = this._latestMap.get(p.name) ?? '--'
                const status = this.statusOf(p)
                const verClass = status === 'installed' ? 'ver-match'
                  : status === 'drifted' ? 'ver-mismatch' : ''
                return `
            <tr class="pkg-row" data-publisher="${esc(p.publisher)}" data-name="${esc(p.name)}">
              <td class="pkg-name">${p.name}</td>
              <td>${kindBadge(kind)}</td>
              <td>${(p.version || '--') + ((p as any).buildNumber > 0 ? '+b' + (p as any).buildNumber : '')}</td>
              <td class="${verClass}">${latest}</td>
              <td>${statusBadge(status)}</td>
              <td>${integrityChip(p)}</td>
              <td>
                <button class="md-btn md-btn-text md-btn-sm btn-view"
                  data-publisher="${esc(p.publisher)}"
                  data-name="${esc(p.name)}">View</button>
              </td>
            </tr>`
              }).join('')
              return nodeHeader + rows
            }).join('')}
          </tbody>
        </table>
      </div>
    `
    this._set('table', tableHtml)

    // Row clicks
    this.querySelectorAll('.pkg-row').forEach(row => {
      row.addEventListener('click', (e) => {
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

customElements.define('page-repo-installed', PageRepoInstalled)
