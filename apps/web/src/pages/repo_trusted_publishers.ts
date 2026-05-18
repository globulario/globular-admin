import { listArtifacts, type ArtifactManifest } from '@globular/sdk'

/* eslint-disable @typescript-eslint/no-explicit-any */
function ext(a: ArtifactManifest): any { return a as any }

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function relativeTime(epochSeconds: number): string {
  if (!epochSeconds) return '--'
  const diff = Math.floor(Date.now() / 1000) - epochSeconds
  if (diff < 0)    return 'just now'
  if (diff < 60)   return `${diff}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

interface TrustedPublisherEntry {
  namespace: string
  packageName: string
  principal: string
  source: string
  lastUsed: number
}

// ─── Module-level cache ───────────────────────────────────────────────────────

interface _TrustedPublishersCache { data: TrustedPublisherEntry[] | null; fetchedAt: number }
const _cache: _TrustedPublishersCache = { data: null, fetchedAt: 0 }

class PageRepoTrustedPublishers extends HTMLElement {
  private _built = false
  private _refreshTimer: number | null = null
  private _entries: TrustedPublisherEntry[] = []
  private _loading = true
  private _error = ''

  connectedCallback() {
    this.style.display = 'block'
    this._buildShell()
    // Show cached data immediately — zero flicker on back-navigation
    if (_cache.data !== null) {
      this._entries = _cache.data
      this._loading = false
      this._pushData()
    }
    // Always kick off a background refresh
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
        .tp-page { padding: 16px; display: flex; flex-direction: column; gap: 20px; }
        .tp-header h2 { margin:0; font: var(--md-typescale-headline-small); }
        .tp-subtitle { margin:2px 0 0; font: var(--md-typescale-body-medium);
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

        .ci-badge {
          display:inline-block; font-size:.65rem; font-weight:700;
          padding:2px 6px; border-radius:4px; background:#dbeafe; color:#1e40af;
        }

        .empty-state { text-align:center; padding:48px 16px; }
        .empty-state h3 { margin:0 0 8px; font: var(--md-typescale-title-medium);
          color:var(--secondary-text-color); }
        .empty-state p { margin:0; font: var(--md-typescale-body-medium);
          color:var(--secondary-text-color); opacity:.7; }
        .loading-msg { color:var(--secondary-text-color); font-size:.85rem;
          font-style:italic; padding:16px; }
      </style>

      <div class="tp-page">
        <div>
          <div class="tp-header"><h2>Trusted Publishers</h2></div>
          <p class="tp-subtitle">CI identities authorized to publish packages automatically.</p>
        </div>

        <div data-bind="loading"></div>
        <div data-bind="error"></div>
        <div data-bind="stats"></div>
        <div data-bind="toolbar"></div>
        <div data-bind="table"></div>
      </div>
    `
  }

  private _set(bind: string, html: string) {
    const el = this.querySelector(`[data-bind="${bind}"]`) as HTMLElement | null
    if (el) el.innerHTML = html
  }

  private async _load() {
    try {
      // Derive trusted CI publishers from artifact trust labels and provenance
      const artifacts = await listArtifacts()
      const entryMap = new Map<string, TrustedPublisherEntry>()

      for (const a of artifacts) {
        const e = ext(a)
        const trustLabels: string[] = e.trustLabelsList || []
        if (!trustLabels.includes('trusted_ci')) continue

        const pub = a.ref?.publisherId || ''
        const pkg = a.ref?.name || ''
        const prov = e.provenance || {}
        const principal = prov.subject || 'unknown'
        const source = prov.buildSource || prov.build_source || 'unknown'
        const ts: number = e.publishedUnix || a.modifiedUnix || 0
        const key = `${pub}/${pkg}/${principal}`

        if (!entryMap.has(key) || ts > (entryMap.get(key)!.lastUsed || 0)) {
          entryMap.set(key, {
            namespace: pub,
            packageName: pkg,
            principal,
            source,
            lastUsed: ts,
          })
        }
      }

      this._entries = Array.from(entryMap.values()).sort((a, b) =>
        b.lastUsed - a.lastUsed
      )
      _cache.data = this._entries
      _cache.fetchedAt = Date.now()
      this._error = ''
    } catch (e: any) {
      // On error: keep showing cached data, only update error banner
      this._error = e?.message || 'Failed to load trusted publisher data'
    }
    this._loading = false
    this._pushData()
  }

  private _pushData() {
    this._set('loading', this._loading ? '<div class="loading-msg">Loading trusted publishers...</div>' : '')

    if (this._error) {
      this._set('error', `
        <div class="md-banner-warn">
          ${escHtml(this._error)}
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

    // When loading with no cache, hide content slots; when an error occurs but
    // we have cached entries, fall through to render stale data below the banner.
    if (this._loading || (this._error && this._entries.length === 0)) {
      this._set('stats', '')
      this._set('toolbar', '')
      this._set('table', '')
      return
    }

    const list = this._entries

    this._set('stats', `
      <div class="stat-row">
        <div class="stat-pill">
          <div class="label">Trusted CI Publishers</div>
          <div class="value" style="color:#2563eb">${list.length}</div>
        </div>
        <div class="stat-pill">
          <div class="label">Namespaces with CI</div>
          <div class="value">${new Set(list.map(e => e.namespace)).size}</div>
        </div>
      </div>
    `)

    this._set('toolbar', `
      <div style="display:flex;align-items:center;gap:10px;">
        <span class="spacer" style="flex:1"></span>
        <button class="md-btn md-btn-outlined" id="btnRefresh">Refresh</button>
      </div>
    `)

    this.querySelector('#btnRefresh')?.addEventListener('click', () => {
      this._loading = true
      this._pushData()
      this._load()
    })

    if (list.length > 0) {
      this._set('table', `
        <div class="md-panel" style="margin-bottom:0">
          <table class="md-table">
            <thead>
              <tr>
                <th>Namespace</th>
                <th>Package</th>
                <th>Principal</th>
                <th>Source</th>
                <th>Status</th>
                <th>Last Used</th>
              </tr>
            </thead>
            <tbody>
              ${list.map(entry => `
              <tr>
                <td style="font-weight:600">${escHtml(entry.namespace)}</td>
                <td>${escHtml(entry.packageName)}</td>
                <td><code>${escHtml(entry.principal)}</code></td>
                <td>${escHtml(entry.source)}</td>
                <td><span class="ci-badge">Active</span></td>
                <td style="color:var(--secondary-text-color); white-space:nowrap">${relativeTime(entry.lastUsed)}</td>
              </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `)
    } else {
      this._set('table', `
        <div class="empty-state">
          <h3>No trusted CI publishers found.</h3>
          <p>Grant CI identities namespace access to enable automated publishing.</p>
        </div>
      `)
    }
  }
}

customElements.define('page-repo-trusted-publishers', PageRepoTrustedPublishers)
