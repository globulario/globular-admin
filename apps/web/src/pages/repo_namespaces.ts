import { listArtifacts, type ArtifactManifest } from '@globular/sdk'

/* eslint-disable @typescript-eslint/no-explicit-any */
function ext(a: ArtifactManifest): any { return a as any }

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

interface NamespaceInfo {
  id: string
  packageCount: number
  verified: boolean
  latestPublish: number
}

class PageRepoNamespaces extends HTMLElement {
  private _refreshTimer: number | null = null
  private _namespaces: NamespaceInfo[] = []
  private _loading = true
  private _error = ''
  private _searchQuery = ''

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
      const artifacts = await listArtifacts()
      const nsMap = new Map<string, NamespaceInfo>()

      for (const a of artifacts) {
        const pub = a.ref?.publisherId || ''
        if (!pub) continue
        const e = ext(a)
        const ts: number = e.publishedUnix || a.modifiedUnix || 0
        const trustLabels: string[] = e.trustLabelsList || []
        const isVerified = trustLabels.includes('owned') || trustLabels.includes('official') || trustLabels.includes('verified_namespace')

        if (!nsMap.has(pub)) {
          nsMap.set(pub, { id: pub, packageCount: 0, verified: false, latestPublish: 0 })
        }
        const info = nsMap.get(pub)!
        info.packageCount++
        if (isVerified) info.verified = true
        if (ts > info.latestPublish) info.latestPublish = ts
      }

      this._namespaces = Array.from(nsMap.values()).sort((a, b) => a.id.localeCompare(b.id))
      this._error = ''
    } catch (e: any) {
      this._error = e?.message || 'Failed to load namespace data'
    }
    this._loading = false
    this.render()
  }

  private get filtered(): NamespaceInfo[] {
    if (!this._searchQuery) return this._namespaces
    const q = this._searchQuery.toLowerCase()
    return this._namespaces.filter(n => n.id.toLowerCase().includes(q))
  }

  private relativeTime(epochSeconds: number): string {
    if (!epochSeconds) return '--'
    const diff = Math.floor(Date.now() / 1000) - epochSeconds
    if (diff < 0)    return 'just now'
    if (diff < 60)   return `${diff}s ago`
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
    return `${Math.floor(diff / 86400)}d ago`
  }

  private render() {
    const list = this.filtered
    const totalNs = this._namespaces.length
    const verifiedNs = this._namespaces.filter(n => n.verified).length

    this.innerHTML = `
      <style>
        .ns-page { padding: 16px; display: flex; flex-direction: column; gap: 20px; }
        .ns-header h2 { margin:0; font: var(--md-typescale-headline-small); }
        .ns-subtitle { margin:2px 0 0; font: var(--md-typescale-body-medium);
          color:var(--secondary-text-color); opacity:.9; }

        .stat-row { display:flex; gap:12px; flex-wrap:wrap; }
        .stat-pill {
          background: var(--md-surface-container-low); border:1px solid var(--border-subtle-color);
          border-radius: var(--md-shape-md); padding:12px 20px;
          box-shadow: var(--md-elevation-1);
        }
        .stat-pill .label { font-size:.7rem; font-weight:600; text-transform:uppercase;
          letter-spacing:.06em; color:var(--secondary-text-color); margin-bottom:4px; }
        .stat-pill .value { font-size:1.6rem; font-weight:800; line-height:1; }

        .toolbar { display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
        .toolbar .search-input {
          padding:8px 12px; border:1px solid var(--border-strong-color);
          border-radius: var(--md-shape-sm); background:var(--md-surface-container-lowest);
          color:var(--on-surface-color); font: var(--md-typescale-body-medium);
          outline:none; min-width:200px; flex:1; max-width:360px;
        }
        .toolbar .search-input:focus { border-color:var(--accent-color); box-shadow: var(--md-focus-ring); }

        .empty-state { text-align:center; padding:48px 16px; }
        .empty-state h3 { margin:0 0 8px; font: var(--md-typescale-title-medium);
          color:var(--secondary-text-color); }
        .empty-state p { margin:0; font: var(--md-typescale-body-medium);
          color:var(--secondary-text-color); opacity:.7; }
        .loading-msg { color:var(--secondary-text-color); font-size:.85rem;
          font-style:italic; padding:16px; }

        .verified-badge { display:inline-block; font-size:.65rem; font-weight:700;
          padding:2px 6px; border-radius:4px; background:#dcfce7; color:#166534; }
        .unverified-badge { display:inline-block; font-size:.65rem; font-weight:700;
          padding:2px 6px; border-radius:4px; background:#fef3c7; color:#92400e; }
      </style>

      <div class="ns-page">
        <div>
          <h2>Namespaces</h2>
          <p class="ns-subtitle">Manage publisher namespaces and ownership.</p>
        </div>

        ${this._loading ? '<div class="loading-msg">Loading namespaces...</div>' : ''}

        ${this._error ? `
        <div class="md-banner-warn">
          ${escHtml(this._error)}
          <button class="md-btn md-btn-outlined md-btn-sm" id="btnRetry" style="margin-left:12px">Retry</button>
        </div>
        ` : ''}

        ${!this._loading && !this._error ? `
        <div class="stat-row">
          <div class="stat-pill">
            <div class="label">Total Namespaces</div>
            <div class="value">${totalNs}</div>
          </div>
          <div class="stat-pill">
            <div class="label">Verified</div>
            <div class="value" style="color:#16a34a">${verifiedNs}</div>
          </div>
          <div class="stat-pill">
            <div class="label">Unclaimed</div>
            <div class="value" style="color:#ca8a04">${totalNs - verifiedNs}</div>
          </div>
        </div>

        <div class="toolbar">
          <input type="text" class="search-input" id="searchInput"
            placeholder="Search namespaces..." value="${this._searchQuery.replace(/"/g, '&quot;')}" />
          <button class="md-btn md-btn-outlined" id="btnRefresh">Refresh</button>
        </div>

        ${list.length > 0 ? `
        <div class="md-panel" style="margin-bottom:0">
          <table class="md-table">
            <thead>
              <tr>
                <th>Namespace</th>
                <th>Status</th>
                <th>Packages</th>
                <th>Last Published</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody class="md-interactive">
              ${list.map(ns => `
              <tr class="ns-row" data-ns="${ns.id.replace(/"/g, '&quot;')}">
                <td style="font-weight:600">${escHtml(ns.id)}</td>
                <td>${ns.verified
                  ? '<span class="verified-badge">Verified</span>'
                  : '<span class="unverified-badge">Unclaimed</span>'}</td>
                <td>${ns.packageCount}</td>
                <td style="color:var(--secondary-text-color); white-space:nowrap">${this.relativeTime(ns.latestPublish)}</td>
                <td>
                  <button class="md-btn md-btn-text md-btn-sm btn-view-ns"
                    data-ns="${ns.id.replace(/"/g, '&quot;')}">View Packages</button>
                </td>
              </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
        ` : `
        <div class="empty-state">
          <h3>No namespaces found.</h3>
          <p>Publish a package to create a namespace automatically.</p>
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

    const searchInput = this.querySelector('#searchInput') as HTMLInputElement | null
    if (searchInput) {
      searchInput.addEventListener('input', () => {
        this._searchQuery = searchInput.value
        this.render()
        const newInput = this.querySelector('#searchInput') as HTMLInputElement | null
        if (newInput) {
          newInput.focus()
          newInput.setSelectionRange(newInput.value.length, newInput.value.length)
        }
      })
    }

    // View packages in namespace → navigate to catalog filtered by publisher
    this.querySelectorAll('.btn-view-ns').forEach(btn => {
      btn.addEventListener('click', () => {
        const ns = (btn as HTMLElement).dataset.ns || ''
        window.location.hash = `#/repository/catalog`
        // Use a short delay to let the page mount, then apply the filter
        setTimeout(() => {
          const page = document.querySelector('page-repository') as any
          if (page && typeof page._publisherFilter !== 'undefined') {
            page._publisherFilter = ns
            page.render?.()
          }
        }, 100)
      })
    })

    // Row clicks
    this.querySelectorAll('.ns-row').forEach(row => {
      row.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).closest('.btn-view-ns')) return
        const ns = (row as HTMLElement).dataset.ns || ''
        window.location.hash = `#/repository/catalog`
        setTimeout(() => {
          const page = document.querySelector('page-repository') as any
          if (page && typeof page._publisherFilter !== 'undefined') {
            page._publisherFilter = ns
            page.render?.()
          }
        }, 100)
      })
    })
  }
}

customElements.define('page-repo-namespaces', PageRepoNamespaces)
