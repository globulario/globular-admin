import {
  listArtifacts,
  ArtifactKind,
  type ArtifactManifest,
  type ArtifactRef,
  upsertDesiredService,
  triggerReconcileAll,
  listClusterNodes,
  normalizeError,
  displaySuccess,
  displayError,
} from '@globular/sdk'

// These exports may not be available in all builds (proto stubs pending).
// Import them dynamically to degrade gracefully.
/* eslint-disable @typescript-eslint/no-explicit-any */
let getArtifactVersions: ((publisher: string, name: string, platform?: string) => Promise<ArtifactManifest[]>) | null = null
let getArtifactManifest: ((ref: ArtifactRef) => Promise<ArtifactManifest | null>) | null = null
let fetchInstalledPackages: ((nodeId?: string, kind?: string, base?: string) => Promise<any[]>) | null = null
let deleteArtifact: ((ref: ArtifactRef, force?: boolean) => Promise<{ deleted: boolean; message: string }>) | null = null

interface InstalledPackage {
  name: string
  publisher: string
  version: string
  buildNumber?: number
  platform: string
  kind: string
  installedAt: string
  nodeId: string
}

const _backendReady = (async () => {
  try {
    const mod = await import('@globular/sdk') as any
    if (mod.getArtifactVersions)    getArtifactVersions    = mod.getArtifactVersions
    if (mod.getArtifactManifest)    getArtifactManifest    = mod.getArtifactManifest
    if (mod.fetchInstalledPackages) fetchInstalledPackages  = mod.fetchInstalledPackages
    if (mod.deleteArtifact)         deleteArtifact         = mod.deleteArtifact
  } catch { /* graceful degradation — functions remain null */ }
})()

// ── Constants ───────────────────────────────────────────────────────────────

const KIND_SERVICE        = ArtifactKind.SERVICE        // 1
const KIND_APPLICATION    = ArtifactKind.APPLICATION     // 2
const KIND_INFRASTRUCTURE = 5

// ── Extended manifest fields ────────────────────────────────────────────────
// The deployed proto may include fields (alias, description, keywordsList,
// publishedUnix, etc.) that are absent from older .d.ts stubs.
/* eslint-disable @typescript-eslint/no-explicit-any */
function ext(a: ArtifactManifest): any { return a as any }

// ── Helpers ─────────────────────────────────────────────────────────────────

// semverCompareDesc returns a negative number when `a` is a newer version
// than `b`, positive when older, zero when equal — i.e. the sign convention
// for an Array.sort that puts the newest first. Mirrors
// `sortManifestsByVersionDesc` on the repository server so the "Latest" badge
// stays consistent between the catalog UI and the install path. Defensive:
// missing / non-numeric components are treated as 0 so a malformed version
// string just sorts to the bottom instead of throwing.
function semverCompareDesc(a: string, b: string): number {
  const pa = (a || '0.0.0').split('.').map(Number)
  const pb = (b || '0.0.0').split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    const diff = (pb[i] || 0) - (pa[i] || 0)
    if (diff !== 0) return diff
  }
  return 0
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

function formatDate(epochSeconds: number): string {
  if (!epochSeconds) return '--'
  return new Date(epochSeconds * 1000).toLocaleString()
}

function kindLabel(kind: number): string {
  switch (kind) {
    case KIND_SERVICE:        return 'Service'
    case KIND_APPLICATION:    return 'Application'
    case KIND_INFRASTRUCTURE: return 'Component'
    default:                  return 'Package'
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

function integrityChip(checksum: string): string {
  if (checksum) {
    return `<span class="md-chip md-chip-success">Verified</span>`
  }
  return `<span class="md-chip md-chip-warn">No checksum</span>`
}

function statusChip(status: string): string {
  const s = (status || '').toUpperCase()
  if (s.includes('RUNNING') || s.includes('ACTIVE') || s.includes('OK'))
    return `<span class="md-chip md-chip-success">${status}</span>`
  if (s.includes('STOPPED') || s.includes('ERROR') || s.includes('FAIL'))
    return `<span class="md-chip md-chip-error">${status}</span>`
  return `<span class="md-chip md-chip-neutral">${status || 'Unknown'}</span>`
}

function truncateChecksum(checksum: string, len = 16): string {
  if (!checksum) return '--'
  return checksum.length > len ? checksum.slice(0, len) + '...' : checksum
}

function formatSize(bytes: number): string {
  if (!bytes) return '--'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function escAttr(s: string): string {
  return s.replace(/"/g, '&quot;').replace(/&/g, '&amp;')
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function publishStateLabel(state: number): string {
  switch (state) {
    case 1:  return 'Staging'
    case 2:  return 'Verified'
    case 3:  return 'Published'
    case 4:  return 'Failed'
    case 5:  return 'Superseded'
    case 6:  return 'Deprecated'
    case 7:  return 'Yanked'
    case 8:  return 'Quarantined'
    case 9:  return 'Revoked'
    default: return 'Unknown'
  }
}

function publishStateColor(state: number): string {
  switch (state) {
    case 3:  return '#16a34a'
    case 6:  return '#ca8a04'
    case 7:  return '#ea580c'
    case 8:  return '#dc2626'
    case 9:  return '#7f1d1d'
    default: return '#6b7280'
  }
}

function stateChip(state: number): string {
  return `<span class="md-badge" style="--badge-color:${publishStateColor(state)}">${publishStateLabel(state)}</span>`
}

function trustBadgeHtml(labels: string[]): string {
  const badges: string[] = []
  if (labels.includes('owned') || labels.includes('official') || labels.includes('verified_namespace')) {
    badges.push('<span style="display:inline-block;font-size:.65rem;font-weight:700;padding:2px 6px;border-radius:4px;background:#dcfce7;color:#166534">Verified</span>')
  }
  if (labels.includes('trusted_ci')) {
    badges.push('<span style="display:inline-block;font-size:.65rem;font-weight:700;padding:2px 6px;border-radius:4px;background:#dbeafe;color:#1e40af">Trusted CI</span>')
  }
  if (labels.includes('machine_published') && !labels.includes('trusted_ci')) {
    badges.push('<span style="display:inline-block;font-size:.65rem;font-weight:700;padding:2px 6px;border-radius:4px;background:#f3f4f6;color:#6b7280">Bot</span>')
  }
  if (labels.includes('unclaimed_namespace')) {
    badges.push('<span style="display:inline-block;font-size:.65rem;font-weight:700;padding:2px 6px;border-radius:4px;background:#fef3c7;color:#92400e">Unclaimed</span>')
  }
  return badges.join(' ') || '<span style="color:var(--secondary-text-color)">--</span>'
}

// ── Component ───────────────────────────────────────────────────────────────

type TabName = 'overview' | 'versions' | 'installed' | 'manifest' | 'provenance' | 'ownership' | 'audit'

class PageRepoPackageDetail extends HTMLElement {
  private _publisher = ''
  private _pkgName = ''
  private _manifest: ArtifactManifest | null = null
  private _versions: ArtifactManifest[] = []
  private _installed: InstalledPackage[] = []
  private _loading = true
  private _error = ''
  private _modalOpen = false
  private _modalTitle = ''
  private _modalBody = ''
  private _modalConfirmLabel = 'Confirm'
  private _modalConfirmDanger = false
  private _modalBusy = false
  private _modalConfirmFn: (() => Promise<void>) | null = null
  private _activeTab: TabName = 'overview'
  private _versionsLoaded = false
  private _installedLoaded = false
  private _built = false
  private _nodeNames: Record<string, string> = {}  // nodeId → hostname

  connectedCallback() {
    this.style.display = 'block'
    this._publisher = this.getAttribute('publisher') || ''
    this._pkgName = this.getAttribute('pkg-name') || ''
    this._buildShell()
    this._pushData()
    this._load()
  }

  private _buildShell() {
    if (this._built) return
    this._built = true
    this.innerHTML = `
      <style>
        .pkg-detail { padding: 16px; display: flex; flex-direction: column; gap: 20px; }

        /* back link */
        .back-link {
          display: inline-flex; align-items: center; gap: 6px;
          font: var(--md-typescale-label-large); color: var(--accent-color);
          text-decoration: none; cursor: pointer; padding: 4px 0;
        }
        .back-link:hover { text-decoration: underline; }

        /* header block */
        .pkg-header { display: flex; align-items: flex-start; gap: 16px; flex-wrap: wrap; }
        .pkg-header-info { flex: 1; min-width: 200px; }
        .pkg-header-info h2 { margin: 0 0 4px; font: var(--md-typescale-headline-small); }
        .pkg-alias-line { font: var(--md-typescale-body-medium); color: var(--secondary-text-color); margin-bottom: 8px; }
        .pkg-badges { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin-bottom: 8px; }
        .pkg-meta { font: var(--md-typescale-body-small); color: var(--secondary-text-color); display: flex; gap: 16px; flex-wrap: wrap; }
        .pkg-meta span { white-space: nowrap; }
        .pkg-actions { display: flex; gap: 8px; flex-wrap: wrap; align-items: flex-start; flex-shrink: 0; }

        /* tab bar */
        .tab-bar {
          display: flex; gap: 0; border-bottom: 2px solid var(--border-subtle-color);
        }
        .tab-btn {
          padding: 10px 20px; background: none; border: none; border-bottom: 2px solid transparent;
          margin-bottom: -2px; cursor: pointer; font: var(--md-typescale-label-large);
          color: var(--secondary-text-color); transition: color .12s, border-color .12s;
        }
        .tab-btn:hover { color: var(--on-surface-color); }
        .tab-btn.active {
          color: var(--accent-color); border-bottom-color: var(--accent-color); font-weight: 700;
        }

        /* detail grid (key/value rows) */
        .detail-grid { display: flex; flex-direction: column; gap: 10px; }
        .detail-row { display: flex; gap: 12px; align-items: baseline; }
        .detail-label {
          min-width: 140px; flex-shrink: 0;
          font: var(--md-typescale-label-medium); text-transform: uppercase;
          letter-spacing: .05em; color: var(--secondary-text-color);
          font-size: .72rem;
        }
        .detail-value { font: var(--md-typescale-body-medium); color: var(--on-surface-color); }
        .detail-value.mono { font-family: monospace; font-size: .8rem; }

        /* manifest pre */
        .manifest-pre {
          margin: 0; padding: 16px; overflow: auto; max-height: 600px;
          font-family: monospace; font-size: .78rem; line-height: 1.5;
          color: var(--on-surface-color); background: var(--md-surface-container-lowest);
          white-space: pre-wrap; word-break: break-all;
        }

        /* loading / error / empty */
        .loading-msg { color: var(--secondary-text-color); font-size: .85rem; font-style: italic; padding: 16px; }

        /* confirmation modal */
        .pkg-modal-overlay {
          position: fixed; inset: 0; background: rgba(0,0,0,.45);
          display: flex; align-items: center; justify-content: center; z-index: 1000;
        }
        .pkg-modal {
          background: var(--md-surface-container-low, var(--surface-color, #fff));
          border-radius: 16px; padding: 24px; min-width: 360px; max-width: 480px;
          box-shadow: 0 8px 32px rgba(0,0,0,.25);
        }
        .pkg-modal-title {
          font: var(--md-typescale-title-large, 600 1.1rem/1.3 sans-serif);
          margin: 0 0 16px;
        }
        .pkg-modal-body { margin-bottom: 20px; font: var(--md-typescale-body-medium); }
        .pkg-modal-body p { margin: 0 0 8px; }
        .pkg-modal-actions { display: flex; justify-content: flex-end; gap: 8px; }
      </style>
      <div class="pkg-detail">
        <a class="back-link" id="btnBack">&larr; Back to Catalog</a>
        <div data-bind="main-content"></div>
      </div>
      <div data-bind="modal-slot"></div>
    `
    this.querySelector('#btnBack')?.addEventListener('click', (ev) => {
      ev.preventDefault()
      window.location.hash = '#/repository/catalog'
    })
  }

  private _set(bind: string, html: string) {
    const el = this.querySelector(`[data-bind="${bind}"]`) as HTMLElement | null
    if (el) el.innerHTML = html
  }

  private async _load() {
    this._loading = true
    this._error = ''
    this._pushData()

    await _backendReady

    try {
      // Try getArtifactManifest first with a partial ref
      let manifest: ArtifactManifest | null = null
      try {
        // We don't know version/platform/kind yet, so list all and find the match
        const all = await listArtifacts()
        const matches = all.filter(a =>
          a.ref?.publisherId === this._publisher && a.ref?.name === this._pkgName
        )
        if (matches.length > 0) {
          // Sort by publishedUnix descending to get the latest
          matches.sort((a, b) => (ext(b).publishedUnix || b.modifiedUnix || 0) - (ext(a).publishedUnix || a.modifiedUnix || 0))
          manifest = matches[0]
        }
      } catch (e: any) {
        // Fallback: try without version filter
        this._error = e?.message || 'Failed to load package'
      }

      if (manifest) {
        this._manifest = manifest
        this._error = ''
      } else if (!this._error) {
        this._error = `Package "${this._publisher}/${this._pkgName}" not found in the repository.`
      }
    } catch (e: any) {
      this._error = e?.message || 'Failed to load package details'
    }

    this._loading = false
    this._pushData()
  }

  private async loadVersions() {
    if (this._versionsLoaded) return
    try {
      if (getArtifactVersions) {
        this._versions = await getArtifactVersions(this._publisher, this._pkgName)
        this._versionsLoaded = true
      } else {
        throw new Error('getArtifactVersions not available')
      }
    } catch {
      // Fallback: extract versions from listArtifacts
      try {
        const all = await listArtifacts()
        this._versions = all.filter((a: ArtifactManifest) =>
          a.ref?.publisherId === this._publisher && a.ref?.name === this._pkgName
        )
        this._versionsLoaded = true
      } catch {
        this._versions = []
      }
    }
  }

  private async loadInstalled() {
    if (this._installedLoaded) return
    try {
      if (!fetchInstalledPackages) throw new Error('fetchInstalledPackages not available')
      const [all, nodes] = await Promise.all([
        fetchInstalledPackages(),
        listClusterNodes().catch(() => []),
      ])
      this._nodeNames = Object.fromEntries(nodes.map((n: any) => [n.nodeId, n.hostname || n.nodeId]))
      console.log('[installed] total packages:', all.length, 'filtering by name:', this._pkgName)
      this._installed = (all as InstalledPackage[]).filter((p: InstalledPackage) => p.name === this._pkgName)
      console.log('[installed] matched:', this._installed.length, this._installed)
      this._installedLoaded = true
    } catch (e) {
      console.error('[installed] loadInstalled failed:', e)
      this._installed = []
      this._installedLoaded = true
    }
  }

  private get kind(): number {
    return this._manifest?.ref?.kind ?? 0
  }

  private get kindStr(): string {
    return kindLabel(this.kind)
  }

  private get e(): any {
    return this._manifest ? ext(this._manifest) : {}
  }

  private async switchTab(tab: TabName) {
    this._activeTab = tab
    if (tab === 'versions' && !this._versionsLoaded) {
      await this.loadVersions()
    }
    if (tab === 'installed' && !this._installedLoaded) {
      await this.loadInstalled()
    }
    this._pushData()
  }

  private async handleDelete() {
    if (!this._manifest?.ref) return
    const ref = this._manifest.ref as ArtifactRef
    const label = this.kindStr

    if (!deleteArtifact) {
      this._error = 'Delete is not available in this build (proto stubs pending).'
      this._pushData()
      return
    }

    this.showModal({
      title: `Delete ${label}`,
      body: `<p>Are you sure you want to delete <strong>${escHtml(this._pkgName)}</strong> from the repository?</p>
             <p style="color:var(--secondary-text-color);font-size:.85rem">This cannot be undone.</p>`,
      confirmLabel: 'Delete',
      danger: true,
      onConfirm: async () => {
        this._modalBusy = true
        this._modalBody = `<p style="font-style:italic;color:var(--secondary-text-color)">Deleting…</p>`
        this._pushData()
        try {
          await deleteArtifact!(ref, false)
          this.closeModal()
          window.location.hash = '#/repository/catalog'
        } catch (e: any) {
          const msg = e?.message || ''
          if (msg.toLowerCase().includes('installed') || msg.toLowerCase().includes('in use') || msg.toLowerCase().includes('node')) {
            this._modalBusy = false
            this._modalBody = `<p>This artifact is still installed on one or more nodes.</p>
              <p style="color:var(--secondary-text-color);font-size:.85rem">
                Deleting will remove it from the repository catalog but will <strong>not</strong> uninstall it from nodes.
              </p>`
            this._modalConfirmLabel = 'Force Delete'
            this._modalConfirmFn = async () => {
              this._modalBusy = true
              this._modalBody = `<p style="font-style:italic;color:var(--secondary-text-color)">Force deleting…</p>`
              this._pushData()
              try {
                await deleteArtifact!(ref, true)
                this.closeModal()
                window.location.hash = '#/repository/catalog'
              } catch (e2: any) {
                this._modalBusy = false
                this._modalBody = `<div class="md-banner-error">${escHtml(e2?.message || 'Force delete failed')}</div>`
                this._pushData()
              }
            }
            this._pushData()
          } else {
            this._modalBusy = false
            this._modalBody = `<div class="md-banner-error">${escHtml(msg || 'Delete failed')}</div>`
            this._pushData()
          }
        }
      },
    })
  }

  private showModal(opts: {
    title: string
    body: string
    confirmLabel?: string
    danger?: boolean
    onConfirm: () => Promise<void>
  }) {
    this._modalOpen = true
    this._modalTitle = opts.title
    this._modalBody = opts.body
    this._modalConfirmLabel = opts.confirmLabel || 'Confirm'
    this._modalConfirmDanger = opts.danger || false
    this._modalBusy = false
    this._modalConfirmFn = opts.onConfirm
    this._pushData()
  }

  private closeModal() {
    this._modalOpen = false
    this._modalTitle = ''
    this._modalBody = ''
    this._modalBusy = false
    this._modalConfirmFn = null
    this._pushData()
  }

  private async handleInstall(name: string, version: string) {
    if (!name || !version) return
    this.showModal({
      title: `Install ${this.kindStr}`,
      body: `<p>Install <strong>${escHtml(name)}</strong> v<strong>${escHtml(version)}</strong> on all cluster nodes?</p>
             <p style="color:var(--secondary-text-color);font-size:.85rem">
               This will set the desired state and trigger reconciliation across the cluster.
             </p>`,
      confirmLabel: 'Install',
      onConfirm: async () => {
        this._modalBusy = true
        this._modalBody = `<p style="font-style:italic;color:var(--secondary-text-color)">Installing…</p>`
        this._pushData()
        try {
          await upsertDesiredService(name, version)
          const nodes = await listClusterNodes()
          const nodeIds = nodes.map((n: any) => n.nodeId || n.node_id || n.id)
          if (nodeIds.length > 0) {
            await triggerReconcileAll(nodeIds)
          }
          displaySuccess(`${name} v${version} set as desired — reconciliation triggered`)
          this.closeModal()
        } catch (e: unknown) {
          this._modalBusy = false
          this._modalBody = `<div class="md-banner-error">${escHtml(normalizeError(e).message)}</div>`
          this._pushData()
        }
      },
    })
  }

  private renderOverviewTab(): string {
    const m = this._manifest!
    const e = this.e
    const ref = m.ref
    const kind = this.kind

    // Keywords
    const keywords: string[] = e.keywordsList || []
    const keywordsHtml = keywords.length > 0
      ? keywords.map((k: string) => `<span class="md-chip md-chip-tonal">${escHtml(k)}</span>`).join(' ')
      : '<span style="color:var(--secondary-text-color)">--</span>'

    // Summary card
    let html = `
      <div class="md-panel">
        <div class="md-panel-header">Package Summary</div>
        <div class="detail-grid" style="padding:16px;">
          <div class="detail-row"><span class="detail-label">Name</span><span class="detail-value">${escHtml(ref?.name || '--')}</span></div>
          ${e.alias ? `<div class="detail-row"><span class="detail-label">Alias</span><span class="detail-value">${escHtml(e.alias)}</span></div>` : ''}
          <div class="detail-row"><span class="detail-label">Kind</span><span class="detail-value">${kindBadge(kind)}</span></div>
          <div class="detail-row"><span class="detail-label">Publisher</span><span class="detail-value">${escHtml(ref?.publisherId || '--')}</span></div>
          <div class="detail-row"><span class="detail-label">Platform</span><span class="detail-value">${escHtml(ref?.platform || '--')}</span></div>
          <div class="detail-row"><span class="detail-label">Version</span><span class="detail-value">${escHtml(ref?.version || '--')}${e.buildNumber > 0 ? ' <span class="md-chip md-chip-neutral" style="font-size:.7rem">build ' + e.buildNumber + '</span>' : ''}</span></div>
          ${e.description ? `<div class="detail-row"><span class="detail-label">Description</span><span class="detail-value">${escHtml(e.description)}</span></div>` : ''}
          <div class="detail-row"><span class="detail-label">Keywords</span><span class="detail-value">${keywordsHtml}</span></div>
          ${e.license ? `<div class="detail-row"><span class="detail-label">License</span><span class="detail-value">${escHtml(e.license)}</span></div>` : ''}
          <div class="detail-row"><span class="detail-label">Published</span><span class="detail-value">${formatDate(e.publishedUnix || m.modifiedUnix || 0)}</span></div>
          <div class="detail-row"><span class="detail-label">Checksum</span><span class="detail-value mono">${escHtml(m.checksum || '--')}</span></div>
          ${e.sizeBytes ? `<div class="detail-row"><span class="detail-label">Size</span><span class="detail-value">${formatSize(e.sizeBytes)}</span></div>` : ''}
        </div>
      </div>
    `

    // Type-specific card
    const svc = e.serviceDetail
    const app = e.applicationDetail
    const infra = e.infrastructureDetail

    if (kind === KIND_SERVICE && svc) {
      html += `
        <div class="md-panel">
          <div class="md-panel-header">Service Details</div>
          <div class="detail-grid" style="padding:16px;">
            ${svc.grpcServiceName ? `<div class="detail-row"><span class="detail-label">gRPC Service</span><span class="detail-value mono">${escHtml(svc.grpcServiceName)}</span></div>` : ''}
            ${svc.protoFile ? `<div class="detail-row"><span class="detail-label">Proto File</span><span class="detail-value mono">${escHtml(svc.protoFile)}</span></div>` : ''}
            ${svc.defaultPort ? `<div class="detail-row"><span class="detail-label">Default Port</span><span class="detail-value">${svc.defaultPort}</span></div>` : ''}
            ${svc.systemdUnit ? `<div class="detail-row"><span class="detail-label">Systemd Unit</span><span class="detail-value mono">${escHtml(svc.systemdUnit)}</span></div>` : ''}
            ${svc.serviceDependenciesList?.length ? `<div class="detail-row"><span class="detail-label">Dependencies</span><span class="detail-value">${(svc.serviceDependenciesList as string[]).map((d: string) => `<span class="md-chip md-chip-neutral">${escHtml(d)}</span>`).join(' ')}</span></div>` : ''}
          </div>
        </div>
      `
    } else if (kind === KIND_APPLICATION && app) {
      html += `
        <div class="md-panel">
          <div class="md-panel-header">Application Details</div>
          <div class="detail-grid" style="padding:16px;">
            ${app.route ? `<div class="detail-row"><span class="detail-label">Route</span><span class="detail-value mono">${escHtml(app.route)}</span></div>` : ''}
            ${app.indexFile ? `<div class="detail-row"><span class="detail-label">Index File</span><span class="detail-value mono">${escHtml(app.indexFile)}</span></div>` : ''}
            ${app.setAsDefault !== undefined ? `<div class="detail-row"><span class="detail-label">Default App</span><span class="detail-value">${app.setAsDefault ? 'Yes' : 'No'}</span></div>` : ''}
            ${app.requiredServicesList?.length ? `<div class="detail-row"><span class="detail-label">Required Services</span><span class="detail-value">${(app.requiredServicesList as string[]).map((s: string) => `<span class="md-chip md-chip-neutral">${escHtml(s)}</span>`).join(' ')}</span></div>` : ''}
            ${app.actionsList?.length ? `<div class="detail-row"><span class="detail-label">Actions</span><span class="detail-value">${(app.actionsList as string[]).join(', ')}</span></div>` : ''}
            ${app.rolesList?.length ? `<div class="detail-row"><span class="detail-label">Roles</span><span class="detail-value">${(app.rolesList as string[]).join(', ')}</span></div>` : ''}
            ${app.groupsList?.length ? `<div class="detail-row"><span class="detail-label">Groups</span><span class="detail-value">${(app.groupsList as string[]).join(', ')}</span></div>` : ''}
          </div>
        </div>
      `
    } else if (kind === KIND_INFRASTRUCTURE && infra) {
      html += `
        <div class="md-panel">
          <div class="md-panel-header">Infrastructure Details</div>
          <div class="detail-grid" style="padding:16px;">
            ${infra.component ? `<div class="detail-row"><span class="detail-label">Component</span><span class="detail-value">${escHtml(infra.component)}</span></div>` : ''}
            ${infra.healthEndpoint ? `<div class="detail-row"><span class="detail-label">Health Endpoint</span><span class="detail-value mono">${escHtml(infra.healthEndpoint)}</span></div>` : ''}
            ${infra.upgradeStrategy ? `<div class="detail-row"><span class="detail-label">Upgrade Strategy</span><span class="detail-value">${escHtml(infra.upgradeStrategy)}</span></div>` : ''}
            ${infra.dataDirsList?.length ? `<div class="detail-row"><span class="detail-label">Data Dirs</span><span class="detail-value">${(infra.dataDirsList as string[]).map((d: string) => `<span class="md-chip md-chip-neutral">${escHtml(d)}</span>`).join(' ')}</span></div>` : ''}
            ${infra.requiredPrivilegesList?.length ? `<div class="detail-row"><span class="detail-label">Required Privileges</span><span class="detail-value">${(infra.requiredPrivilegesList as string[]).map((p: string) => `<span class="md-chip md-chip-warn">${escHtml(p)}</span>`).join(' ')}</span></div>` : ''}
          </div>
        </div>
      `
    }

    // Trust status card
    const trustLabels: string[] = e.trustLabelsList || []
    const pubState: number = e.publishState ?? 0
    html += `
      <div class="md-panel">
        <div class="md-panel-header">Trust Status</div>
        <div class="detail-grid" style="padding:16px;">
          <div class="detail-row"><span class="detail-label">Trust</span><span class="detail-value">${trustBadgeHtml(trustLabels)}</span></div>
          <div class="detail-row"><span class="detail-label">Lifecycle State</span><span class="detail-value">${stateChip(pubState)}</span></div>
          <div class="detail-row"><span class="detail-label">Trust Labels</span><span class="detail-value">${trustLabels.length > 0 ? trustLabels.map((l: string) => `<span class="md-chip md-chip-tonal">${escHtml(l)}</span>`).join(' ') : '--'}</span></div>
        </div>
      </div>
    `

    // Integrity card
    html += `
      <div class="md-panel">
        <div class="md-panel-header">Integrity</div>
        <div class="detail-grid" style="padding:16px;">
          <div class="detail-row"><span class="detail-label">Checksum</span><span class="detail-value mono" style="word-break:break-all">${escHtml(m.checksum || '--')}</span></div>
          <div class="detail-row"><span class="detail-label">Verification</span><span class="detail-value">${integrityChip(m.checksum)}</span></div>
        </div>
      </div>
    `

    // Dependencies card
    const provides: string[] = e.providesList || []
    const requires: string[] = e.requiresList || []
    const defaults: Record<string, string> = e.defaultsMap ? Object.fromEntries((e.defaultsMap as Array<[string, string]>) || []) : {}
    const entrypoints: string[] = e.entrypointsList || []
    const hasDepInfo = provides.length > 0 || requires.length > 0 || Object.keys(defaults).length > 0 || entrypoints.length > 0

    if (hasDepInfo) {
      html += `
        <div class="md-panel">
          <div class="md-panel-header">Dependencies & Entrypoints</div>
          <div class="detail-grid" style="padding:16px;">
            ${provides.length > 0 ? `<div class="detail-row"><span class="detail-label">Provides</span><span class="detail-value">${provides.map((p: string) => `<span class="md-chip md-chip-success">${escHtml(p)}</span>`).join(' ')}</span></div>` : ''}
            ${requires.length > 0 ? `<div class="detail-row"><span class="detail-label">Requires</span><span class="detail-value">${requires.map((r: string) => `<span class="md-chip md-chip-neutral">${escHtml(r)}</span>`).join(' ')}</span></div>` : ''}
            ${Object.keys(defaults).length > 0 ? `<div class="detail-row"><span class="detail-label">Defaults</span><span class="detail-value mono">${Object.entries(defaults).map(([k, v]) => `${escHtml(k)}: ${escHtml(v)}`).join('<br>')}</span></div>` : ''}
            ${entrypoints.length > 0 ? `<div class="detail-row"><span class="detail-label">Entrypoints</span><span class="detail-value">${entrypoints.map((ep: string) => `<span class="md-chip md-chip-tonal">${escHtml(ep)}</span>`).join(' ')}</span></div>` : ''}
          </div>
        </div>
      `
    }

    return html
  }

  private renderVersionsTab(): string {
    if (this._versions.length === 0) {
      return `
        <div class="md-panel">
          <div class="md-panel-header">Versions</div>
          <div style="padding:16px;">
            <p class="md-empty">No version history available.</p>
          </div>
        </div>
      `
    }

    // Sort: semver DESC, then build_number DESC, then publishedUnix DESC.
    //
    // Sorting by publishedUnix alone is wrong: an imported BOM version whose
    // manifest stays at publishedUnix=0 (idempotent skip path on the repository
    // — same build_id already present, ledger not re-stamped) regresses behind
    // an older version that *does* carry a real published timestamp. That put
    // the "Latest" badge on a stale row even though a higher semver was
    // present in the catalog. Match the backend's `sortManifestsByVersionDesc`
    // semantics so the badge tracks actual semantic version.
    const sorted = [...this._versions].sort((a, b) => {
      const vc = semverCompareDesc(a.ref?.version || '', b.ref?.version || '')
      if (vc !== 0) return vc
      const ba = (ext(a).buildNumber || 0) as number
      const bb = (ext(b).buildNumber || 0) as number
      if (bb !== ba) return bb - ba
      const ta = (ext(a).publishedUnix || a.modifiedUnix || 0) as number
      const tb = (ext(b).publishedUnix || b.modifiedUnix || 0) as number
      return tb - ta
    })
    const latestVersion = sorted[0]?.ref?.version || ''

    return `
      <div class="md-panel" style="margin-bottom:0">
        <table class="md-table">
          <thead>
            <tr>
              <th>Version</th>
              <th>Build</th>
              <th>State</th>
              <th>Published</th>
              <th>Checksum</th>
              <th>Platform</th>
              <th>Size</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${sorted.map(v => {
              const e = ext(v)
              const ver = v.ref?.version || '--'
              const isLatest = ver === latestVersion
              const ts = e.publishedUnix || v.modifiedUnix || 0
              return `
            <tr${isLatest ? ' style="background:color-mix(in srgb, var(--success-color) 6%, transparent)"' : ''}>
              <td>
                <span style="font-weight:600">${escHtml(ver)}</span>
                ${isLatest ? ' <span class="md-chip md-chip-success" style="margin-left:6px">Latest</span>' : ''}
              </td>
              <td>${e.buildNumber > 0 ? 'build ' + e.buildNumber : 'build 0'}</td>
              <td>${stateChip(e.publishState ?? 0)}</td>
              <td style="color:var(--secondary-text-color); white-space:nowrap">${formatDate(ts)}</td>
              <td><span class="mono" title="${escAttr(v.checksum || '')}">${truncateChecksum(v.checksum)}</span></td>
              <td>${escHtml(v.ref?.platform || '--')}</td>
              <td>${formatSize(e.sizeBytes || 0)}</td>
              <td>
                <button class="md-btn md-btn-text md-btn-sm btn-install-version"
                  data-publisher="${escAttr(v.ref?.publisherId || '')}"
                  data-name="${escAttr(v.ref?.name || '')}"
                  data-version="${escAttr(ver)}"
                  data-platform="${escAttr(v.ref?.platform || '')}"
                  data-kind="${v.ref?.kind ?? 0}">Install ${this.kindStr}</button>
              </td>
            </tr>`
            }).join('')}
          </tbody>
        </table>
      </div>
    `
  }

  private renderInstalledTab(): string {
    if (this._installed.length === 0) {
      return `
        <div class="md-panel">
          <div class="md-panel-header">Installed On</div>
          <div style="padding:16px;">
            <p class="md-empty">This package is not installed on any node.</p>
          </div>
        </div>
      `
    }

    return `
      <div class="md-panel" style="margin-bottom:0">
        <table class="md-table">
          <thead>
            <tr>
              <th>Node</th>
              <th>Installed Version</th>
              <th>Status</th>
              <th>Integrity</th>
              <th>Last Updated</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${this._installed.map(p => `
            <tr>
              <td style="font-weight:600">${escHtml(this._nodeNames[p.nodeId] || p.nodeId || '--')}</td>
              <td>${escHtml(p.version || '--')}</td>
              <td>${statusChip(p.kind || 'installed')}</td>
              <td>${integrityChip(p.version ? 'ok' : '')}</td>
              <td style="color:var(--secondary-text-color); white-space:nowrap">${p.installedAt ? new Date(p.installedAt).toLocaleString() : '--'}</td>
              <td>
                <button class="md-btn md-btn-text md-btn-sm btn-view-node"
                  data-node="${escAttr(p.nodeId || '')}">View Node</button>
              </td>
            </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `
  }

  private renderManifestTab(): string {
    const json = this._manifest ? JSON.stringify(this._manifest, null, 2) : '{}'
    return `
      <div style="position:relative;">
        <button class="md-btn md-btn-outlined md-btn-sm" id="btnCopyManifest" style="position:absolute; top:12px; right:12px; z-index:1;">Copy</button>
        <div class="md-panel">
          <div class="md-panel-header">Raw Manifest</div>
          <pre class="manifest-pre">${escHtml(json)}</pre>
        </div>
      </div>
    `
  }

  private renderProvenanceTab(): string {
    const e = this.e
    const prov = e.provenance
    if (!prov) {
      return `
        <div class="md-panel">
          <div class="md-panel-header">Provenance</div>
          <div style="padding:16px;">
            <p class="md-empty">No provenance record available for this artifact. Legacy artifacts published before the trust model was enabled will not have provenance.</p>
          </div>
        </div>
      `
    }

    return `
      <div class="md-panel">
        <div class="md-panel-header">Artifact Supply-Chain Provenance</div>
        <div class="detail-grid" style="padding:16px;">
          <div class="detail-row"><span class="detail-label">Subject</span><span class="detail-value"><code>${escHtml(prov.subject || '--')}</code></span></div>
          <div class="detail-row"><span class="detail-label">Principal Type</span><span class="detail-value">${escHtml(prov.principalType || prov.principal_type || '--')}</span></div>
          <div class="detail-row"><span class="detail-label">Auth Method</span><span class="detail-value">${escHtml(prov.authMethod || prov.auth_method || '--')}</span></div>
          <div class="detail-row"><span class="detail-label">Build Commit</span><span class="detail-value mono">${escHtml(prov.buildCommit || prov.build_commit || '--')}</span></div>
          <div class="detail-row"><span class="detail-label">Build Source</span><span class="detail-value">${escHtml(prov.buildSource || prov.build_source || '--')}</span></div>
          <div class="detail-row"><span class="detail-label">Cluster ID</span><span class="detail-value">${escHtml(prov.clusterId || prov.cluster_id || '--')}</span></div>
          <div class="detail-row"><span class="detail-label">Published At</span><span class="detail-value">${prov.timestampUnix || prov.timestamp_unix ? formatDate(prov.timestampUnix || prov.timestamp_unix) : '--'}</span></div>
          <div class="detail-row"><span class="detail-label">Source IP</span><span class="detail-value mono">${escHtml(prov.sourceIp || prov.source_ip || '--')}</span></div>
        </div>
      </div>
    `
  }

  private renderOwnershipTab(): string {
    const e = this.e
    const trustLabels: string[] = e.trustLabelsList || []
    const publisher = this._manifest?.ref?.publisherId || '--'
    const isOwned = trustLabels.includes('owned') || trustLabels.includes('official')

    return `
      <div class="md-panel">
        <div class="md-panel-header">Namespace Ownership</div>
        <div class="detail-grid" style="padding:16px;">
          <div class="detail-row"><span class="detail-label">Namespace</span><span class="detail-value"><strong>${escHtml(publisher)}</strong></span></div>
          <div class="detail-row"><span class="detail-label">Status</span><span class="detail-value">${isOwned
            ? '<span style="display:inline-block;font-size:.65rem;font-weight:700;padding:2px 6px;border-radius:4px;background:#dcfce7;color:#166534">Owned / Verified</span>'
            : '<span style="display:inline-block;font-size:.65rem;font-weight:700;padding:2px 6px;border-radius:4px;background:#fef3c7;color:#92400e">Unclaimed</span>'
          }</span></div>
        </div>
      </div>
      <div class="md-panel">
        <div class="md-panel-header">Permissions</div>
        <div class="detail-grid" style="padding:16px;">
          <div class="detail-row"><span class="detail-label">Namespace Path</span><span class="detail-value mono">/namespaces/${escHtml(publisher)}</span></div>
          <div class="detail-row"><span class="detail-label">Package Path</span><span class="detail-value mono">/packages/${escHtml(publisher)}/${escHtml(this._pkgName)}</span></div>
          <div class="detail-row" style="margin-top:8px;">
            <span class="detail-label" style="min-width:auto"></span>
            <span class="detail-value" style="font-size:.78rem;color:var(--secondary-text-color);">
              Use <code>globular namespace info ${escHtml(publisher)}</code> to see full ownership details.
            </span>
          </div>
        </div>
      </div>
    `
  }

  private renderAuditTab(): string {
    return `
      <div class="md-panel">
        <div class="md-panel-header">Audit Events</div>
        <div style="padding:16px;">
          <p style="color:var(--secondary-text-color);margin:0 0 12px;">
            Audit events for this package are published to the Event service on channels prefixed with <code>pkg.</code>
          </p>
          <p style="color:var(--secondary-text-color);margin:0 0 16px;">
            View the full audit log for all packages on the
            <a href="#/repository/audit" style="color:var(--accent-color);text-decoration:none;">Audit Events</a> page.
          </p>
          <p style="font-size:.78rem;color:var(--secondary-text-color);margin:0;">
            Events tracked: <code>artifact.uploaded</code>, <code>artifact.promoted</code>,
            <code>artifact.state_changed</code>, <code>artifact.downloaded</code>,
            <code>artifact.deleted</code>
          </p>
        </div>
      </div>
    `
  }

  private _pushData() {
    const m = this._manifest
    const e = m ? ext(m) : {}
    const ref = m?.ref
    const kind = this.kind
    const label = this.kindStr

    this._set('main-content', `
        ${this._loading ? '<div class="loading-msg">Loading package details...</div>' : ''}

        ${this._error ? `
        <div class="md-banner-error">
          ${escHtml(this._error)}
          <button class="md-btn md-btn-outlined md-btn-sm" id="btnRetry" style="margin-left:12px">Retry</button>
        </div>
        ` : ''}

        ${!this._loading && m ? `
        <!-- Header -->
        <div class="pkg-header">
          <div class="pkg-header-info">
            <h2>${escHtml(ref?.name || this._pkgName)}</h2>
            ${e.alias ? `<div class="pkg-alias-line">${escHtml(e.alias)}</div>` : ''}
            <div class="pkg-badges">
              ${kindBadge(kind)}
              <span class="md-chip md-chip-neutral">${escHtml(ref?.platform || '--')}</span>
              ${stateChip(e.publishState ?? 0)}
              ${integrityChip(m.checksum)}
              ${trustBadgeHtml(e.trustLabelsList || [])}
            </div>
            <div class="pkg-meta">
              <span>Publisher: <strong>${escHtml(ref?.publisherId || '--')}</strong></span>
              <span>Version: <strong>${escHtml(ref?.version || '--')}${e.buildNumber > 0 ? '+b' + e.buildNumber : ''}</strong></span>
              <span>Published: <strong>${relativeTime(e.publishedUnix || m.modifiedUnix || 0)}</strong></span>
            </div>
          </div>
          <div class="pkg-actions">
            <button class="md-btn md-btn-filled" id="btnInstall">Install ${label}</button>
            <button class="md-btn md-btn-danger" id="btnDelete">Delete ${label}</button>
          </div>
        </div>

        <!-- Tab bar -->
        <div class="tab-bar">
          <button class="tab-btn${this._activeTab === 'overview'    ? ' active' : ''}" data-tab="overview">Overview</button>
          <button class="tab-btn${this._activeTab === 'versions'    ? ' active' : ''}" data-tab="versions">Versions</button>
          <button class="tab-btn${this._activeTab === 'installed'   ? ' active' : ''}" data-tab="installed">Installed On</button>
          <button class="tab-btn${this._activeTab === 'manifest'    ? ' active' : ''}" data-tab="manifest">Manifest</button>
          <button class="tab-btn${this._activeTab === 'provenance'  ? ' active' : ''}" data-tab="provenance">Provenance</button>
          <button class="tab-btn${this._activeTab === 'ownership'   ? ' active' : ''}" data-tab="ownership">Ownership</button>
          <button class="tab-btn${this._activeTab === 'audit'       ? ' active' : ''}" data-tab="audit">Audit</button>
        </div>

        <!-- Tab content -->
        <div class="tab-content">
          ${this._activeTab === 'overview'    ? this.renderOverviewTab()    : ''}
          ${this._activeTab === 'versions'    ? this.renderVersionsTab()    : ''}
          ${this._activeTab === 'installed'   ? this.renderInstalledTab()   : ''}
          ${this._activeTab === 'manifest'    ? this.renderManifestTab()    : ''}
          ${this._activeTab === 'provenance'  ? this.renderProvenanceTab()  : ''}
          ${this._activeTab === 'ownership'   ? this.renderOwnershipTab()   : ''}
          ${this._activeTab === 'audit'       ? this.renderAuditTab()       : ''}
        </div>
        ` : ''}
    `)

    this._set('modal-slot', this._modalOpen ? `
      <div class="pkg-modal-overlay" id="pkgModalOverlay">
        <div class="pkg-modal">
          <div class="pkg-modal-title">${this._modalTitle}</div>
          <div class="pkg-modal-body">${this._modalBody}</div>
          <div class="pkg-modal-actions">
            <button class="md-btn md-btn-text" id="btnModalCancel" ${this._modalBusy ? 'disabled' : ''}>Cancel</button>
            <button class="md-btn ${this._modalConfirmDanger ? 'md-btn-danger' : 'md-btn-filled'}"
              id="btnModalConfirm" ${this._modalBusy ? 'disabled' : ''}>
              ${this._modalConfirmLabel}
            </button>
          </div>
        </div>
      </div>` : '')

    this._bindContentEvents()
  }

  private _bindContentEvents() {
    this.querySelector('#btnRetry')?.addEventListener('click', () => {
      this._error = ''
      this._loading = true
      this._pushData()
      this._load()
    })

    this.querySelector('#btnInstall')?.addEventListener('click', () => {
      const version = this._manifest?.ref?.version || this._versions[0]?.ref?.version || ''
      if (!version) {
        displayError('No version available to install')
        return
      }
      this.handleInstall(this._pkgName, version)
    })

    this.querySelector('#btnDelete')?.addEventListener('click', () => {
      this.handleDelete()
    })

    // Modal buttons
    this.querySelector('#btnModalCancel')?.addEventListener('click', () => this.closeModal())
    this.querySelector('#btnModalConfirm')?.addEventListener('click', () => {
      if (this._modalConfirmFn && !this._modalBusy) this._modalConfirmFn()
    })
    this.querySelector('#pkgModalOverlay')?.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).id === 'pkgModalOverlay') this.closeModal()
    })

    // Tab clicks
    this.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const tab = (btn as HTMLElement).dataset.tab as TabName
        if (tab && tab !== this._activeTab) {
          this.switchTab(tab)
        }
      })
    })

    // Copy manifest
    this.querySelector('#btnCopyManifest')?.addEventListener('click', () => {
      const json = this._manifest ? JSON.stringify(this._manifest, null, 2) : '{}'
      navigator.clipboard.writeText(json).then(() => {
        const btn = this.querySelector('#btnCopyManifest') as HTMLButtonElement
        if (btn) {
          btn.textContent = 'Copied!'
          setTimeout(() => { btn.textContent = 'Copy' }, 1500)
        }
      }).catch(() => {
        // Fallback: select the pre text
        const pre = this.querySelector('.manifest-pre')
        if (pre) {
          const range = document.createRange()
          range.selectNodeContents(pre)
          const sel = window.getSelection()
          sel?.removeAllRanges()
          sel?.addRange(range)
        }
      })
    })

    // Install specific version buttons
    this.querySelectorAll('.btn-install-version').forEach(btn => {
      btn.addEventListener('click', () => {
        const el = btn as HTMLElement
        const version = el.dataset.version || ''
        if (version) this.handleInstall(this._pkgName, version)
      })
    })

    // View node buttons
    this.querySelectorAll('.btn-view-node').forEach(btn => {
      btn.addEventListener('click', () => {
        const nodeId = (btn as HTMLElement).dataset.node || ''
        if (nodeId) {
          window.location.hash = `#/cluster/nodes`
        }
      })
    })
  }

  /** @deprecated Use _pushData() */
  private render() { this._pushData() }
}

customElements.define('page-repo-package-detail', PageRepoPackageDetail)
