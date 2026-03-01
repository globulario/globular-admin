// src/pages/services_catalog.ts
//
// Service Rollout page — Desired state (controller) vs. Installed state (runtime).
// When a repository layer becomes available it will be merged as a third source.
//
// Availability semantics:
//   _ccAvailable      — GetClusterHealthV1 RPC succeeded (null return = unreachable)
//   _ccHasPlan        — controller returned ≥1 desired entry
//   _runtimeAvailable — /config returned ≥1 service
//
// Status derivation (from {desired, installed}):
//   Managed & current    — desired==installed, rollout 100%
//   Managed & progressing— rollout < 100% or upgrading > 0
//   Managed & drift      — rollout 100% but installed version ≠ desired
//   Desired — not installed — desired exists, not installed on this node
//   Unmanaged            — installed, controller reachable, not in plan
//   Installed            — installed, controller unreachable (state unknown)

import {
  getClusterServiceSummary,
  listClusterNodes,
  getConfig,
  normalizeError,
  displayError,
  displaySuccess,
  upsertDesiredService,
  seedDesiredState,
  triggerReconcileAll,
  listBundles,
  validateArtifact,
  previewDesiredServices,
  type BundleSummary,
  type ServiceCatalogEntry,
  type ClusterNode,
  type ServiceDesc,
  type ValidationIssue,
  type PlanPreview,
} from '@globular/backend'

// ─── Neutral catalog model ────────────────────────────────────────────────────
// CatalogItem is a kind-agnostic row that can represent a bundle (V1) or an
// artifact (V2 — when artifact records are added to the repo pipeline). The UI
// renders CatalogItem[] so adding artifacts later only requires extending the
// load() function, not the rendering code.

type CatalogItemKind = 'bundle' // | 'artifact'  // uncomment when artifacts land

interface CatalogItem {
  kind:          CatalogItemKind
  id:            string         // canonical id: service_id or artifact ref key
  name:          string
  version:       string
  platform:      string
  publisherId:   string
  publishedAt:   number         // unix seconds
  sizeBytes:     number
  checksum:      string
  // raw handles
  bundleData?:   BundleSummary
}

// ─── Unified row ──────────────────────────────────────────────────────────────

interface CatalogRow {
  name: string
  // From /config (runtime)
  installedVersion: string | null
  installedState:   string | null
  // From controller (undefined = controller unreachable or service not in plan)
  desiredVersion:   string | undefined
  nodesAtDesired:   number | undefined
  nodesTotal:       number | undefined
  upgrading:        number | undefined
}

// ─── Status derivation ────────────────────────────────────────────────────────

type StatusKey =
  | 'managed-current'
  | 'managed-progressing'
  | 'managed-drift'
  | 'desired-missing'
  | 'unmanaged'
  | 'installed'   // controller unreachable, just know it's installed
  | 'none'        // not installed, not in plan, controller has no plan — just exists in registry

function deriveStatus(row: CatalogRow, ccAvailable: boolean, ccHasPlan: boolean): StatusKey {
  const { installedVersion, desiredVersion, nodesTotal = 0, nodesAtDesired = 0, upgrading = 0 } = row
  const installed = !!installedVersion
  const desired   = desiredVersion !== undefined

  if (!ccAvailable) {
    return installed ? 'installed' : 'none'
  }

  if (!desired) {
    // Controller reachable but not planning this service
    if (!ccHasPlan) return installed ? 'installed' : 'none'
    return installed ? 'unmanaged' : 'none'
  }

  // Desired exists
  if (!installed) return 'desired-missing'
  if (upgrading > 0 || (nodesTotal > 0 && nodesAtDesired < nodesTotal)) return 'managed-progressing'
  if (nodesTotal > 0 && nodesAtDesired === nodesTotal) {
    if (installedVersion !== desiredVersion) return 'managed-drift'
    return 'managed-current'
  }
  // nodesTotal === 0 — desired exists, no nodes tracked yet
  return 'managed-progressing'
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Reduce a service identifier to a canonical alphanum string for fuzzy name matching.
 *
 * Bundle names (spec metadata.name) use kebab-case short names:
 *   "media", "node-agent", "cluster-controller"
 *
 * Runtime service names (/config) use proto fully-qualified names:
 *   "media.MediaService", "node_agent.NodeAgentService",
 *   "cluster_controller.ClusterControllerService"
 *
 * Both normalize to the same string so the matching works across naming conventions.
 */
function normalizeForMatch(name: string): string {
  const base = name.includes('.') ? name.split('.')[0] : name
  return base.toLowerCase().replace(/[^a-z0-9]/g, '')
}

function badge(label: string, color: string): string {
  return `<span class="sc-badge" style="--badge-color:${color}">${label}</span>`
}

const STATUS_META: Record<StatusKey, { label: string; color: string }> = {
  'managed-current':     { label: 'Managed & current',    color: 'var(--success-color)' },
  'managed-progressing': { label: 'Progressing',           color: '#f59e0b' },
  'managed-drift':       { label: 'Drift',                 color: 'var(--error-color)' },
  'desired-missing':     { label: 'Desired — not installed', color: '#f59e0b' },
  'unmanaged':           { label: 'Unmanaged',             color: 'var(--secondary-text-color)' },
  'installed':           { label: 'Installed',             color: 'var(--secondary-text-color)' },
  'none':                { label: '—',                     color: 'var(--secondary-text-color)' },
}

function statusBadge(row: CatalogRow, ccAvailable: boolean, ccHasPlan: boolean): string {
  const key = deriveStatus(row, ccAvailable, ccHasPlan)
  const { label, color } = STATUS_META[key]
  if (key === 'none') return `<span class="sc-muted">—</span>`
  return badge(label, color)
}

function desiredCell(row: CatalogRow, ccAvailable: boolean, ccHasPlan: boolean): string {
  if (!ccAvailable) return `<span class="sc-muted">—</span>`
  if (!ccHasPlan)   return `<span class="sc-muted">—</span>` // no plan at all, don't spam "Not managed"
  if (row.desiredVersion === undefined) return `<span class="sc-muted">—</span>`
  return `<span class="sc-mono" style="font-size:.75rem">${row.desiredVersion}</span>`
}

function installedCell(row: CatalogRow): string {
  if (!row.installedVersion) return `<span class="sc-muted">—</span>`
  const state = (row.installedState ?? '').toLowerCase()
  const color = state === 'running' || state === 'active'
    ? 'var(--success-color)' : 'var(--secondary-text-color)'
  return badge(row.installedVersion, color)
}

function rolloutCell(row: CatalogRow, ccAvailable: boolean): string {
  if (!ccAvailable || row.nodesTotal === undefined || row.nodesTotal === 0)
    return `<span class="sc-muted">—</span>`
  const { nodesAtDesired = 0, nodesTotal = 0, upgrading = 0 } = row
  const pct   = Math.round((nodesAtDesired / nodesTotal) * 100)
  const color = upgrading > 0 ? '#f59e0b'
    : nodesAtDesired === nodesTotal ? 'var(--success-color)'
    : 'var(--error-color)'
  return `
    <div style="display:flex;align-items:center;gap:6px">
      <div class="sc-progress-track">
        <div class="sc-progress-fill" style="width:${pct}%;background:${color}"></div>
      </div>
      <span class="sc-mono" style="font-size:.68rem;color:var(--secondary-text-color)">${nodesAtDesired}/${nodesTotal}</span>
    </div>`
}

// ─── Component ────────────────────────────────────────────────────────────────

class PageServicesCatalog extends HTMLElement {
  private _rows:             CatalogRow[]       = []
  private _nodes:            ClusterNode[]      = []
  private _ccAvailable       = false
  private _ccHasPlan         = false
  private _runtimeAvailable  = false
  private _loadError         = ''
  private _loading           = true
  private _busy              = false
  private _search            = ''
  private _filterStatus      = 'all'
  private _expandedName      = ''
  private _refreshTimer:     number | null = null

  // Repository tab state
  private _activeTab         = 'rollout'   // 'rollout' | 'repository'
  private _catalog:          CatalogItem[] = []
  private _repoAvailable     = false
  private _repoError         = ''
  private _repoSearch        = ''
  private _repoExpandedKey   = ''

  // Validate→Preview→Apply modal state
  private _modalOpen         = false
  private _modalTitle        = ''
  private _modalHtml         = ''
  private _modalConfirmEnabled = false
  private _modalConfirmFn:   (() => Promise<void>) | null = null

  connectedCallback() {
    this.style.display = 'block'
    this.render()
    this.load()
    this._refreshTimer = window.setInterval(() => this.load(), 30_000)
  }

  disconnectedCallback() {
    if (this._refreshTimer) clearInterval(this._refreshTimer)
  }

  // ─── Data ────────────────────────────────────────────────────────────────

  private async load() {
    try {
      let bundleError = ''
      const [catalogResult, nodes, cfg, bundleResult] = await Promise.all([
        getClusterServiceSummary().catch(() => null),
        listClusterNodes().catch(() => [] as ClusterNode[]),
        getConfig().catch(() => null),
        listBundles().catch((e: unknown): BundleSummary[] | null => {
          bundleError = normalizeError(e).message
          return null
        }),
      ])

      this._nodes         = nodes
      this._ccAvailable   = catalogResult !== null
      this._ccHasPlan     = (catalogResult?.length ?? 0) > 0
      const catalogEntries: ServiceCatalogEntry[] = catalogResult ?? []
      this._repoAvailable = bundleResult !== null
      this._repoError     = bundleError

      // Convert BundleSummary[] → CatalogItem[]
      this._catalog = (bundleResult ?? []).map((b): CatalogItem => ({
        kind:        'bundle',
        id:          b.serviceId || `${b.name}%${b.version}%${b.platform}`,
        name:        b.name,
        version:     b.version,
        platform:    b.platform,
        publisherId: b.publisherId,
        publishedAt: b.publishedUnix,
        sizeBytes:   b.sizeBytes,
        checksum:    b.sha256,
        bundleData:  b,
      }))

      const runtimeSvcs = Object.values(cfg?.Services ?? {}) as ServiceDesc[]
      this._runtimeAvailable = runtimeSvcs.length > 0

      const ccMap = new Map<string, ServiceCatalogEntry>(
        catalogEntries.map(e => [e.serviceName.toLowerCase(), e])
      )

      const rowMap = new Map<string, CatalogRow>()

      // Seed from runtime
      for (const svc of runtimeSvcs) {
        const name = svc.Name ?? svc.Id ?? ''
        if (!name) continue
        const key = name.toLowerCase()
        const cc  = ccMap.get(key)
        rowMap.set(key, {
          name,
          installedVersion: (svc.Version as string) || null,
          installedState:   (svc.State  as string) || null,
          desiredVersion:   cc?.desiredVersion,
          nodesAtDesired:   cc?.nodesAtDesired,
          nodesTotal:       cc?.nodesTotal,
          upgrading:        cc?.upgrading,
        })
        ccMap.delete(key)
      }

      // Add controller entries not in runtime
      for (const [key, e] of ccMap) {
        rowMap.set(key, {
          name:             e.serviceName,
          installedVersion: null,
          installedState:   null,
          desiredVersion:   e.desiredVersion,
          nodesAtDesired:   e.nodesAtDesired,
          nodesTotal:       e.nodesTotal,
          upgrading:        e.upgrading,
        })
      }

      this._rows = Array.from(rowMap.values())
        .sort((a, b) => a.name.localeCompare(b.name))

      this._loadError = ''
    } catch (e: unknown) {
      this._loadError = normalizeError(e).message
    }
    this._loading = false
    this.render()
  }

  // ─── Filtering ───────────────────────────────────────────────────────────

  private get filteredRows(): CatalogRow[] {
    const q = this._search.toLowerCase()
    return this._rows.filter(row => {
      const matchesSearch = !q
        || row.name.toLowerCase().includes(q)
        || (row.desiredVersion  ?? '').toLowerCase().includes(q)
        || (row.installedVersion ?? '').toLowerCase().includes(q)

      const status = deriveStatus(row, this._ccAvailable, this._ccHasPlan)
      let matchesStatus = true
      switch (this._filterStatus) {
        case 'managed':    matchesStatus = status.startsWith('managed'); break
        case 'unmanaged':  matchesStatus = status === 'unmanaged'; break
        case 'drift':      matchesStatus = status === 'managed-drift' || status === 'managed-progressing'; break
        case 'missing':    matchesStatus = status === 'desired-missing'; break
        case 'installed':  matchesStatus = !!row.installedVersion; break
      }

      return matchesSearch && matchesStatus
    })
  }

  // ─── Row expand panel ────────────────────────────────────────────────────

  private renderDetailPanel(row: CatalogRow): string {
    const status   = deriveStatus(row, this._ccAvailable, this._ccHasPlan)
    const managed  = status.startsWith('managed')
    const unmanaged = status === 'unmanaged'
    const desired  = status === 'desired-missing'

    const addBtn = (unmanaged || (!this._ccHasPlan && !!row.installedVersion)) && this._ccAvailable
      ? `<button class="sc-action-btn sc-action-live" data-action="add" data-name="${row.name}" data-version="${row.installedVersion ?? ''}">
           + Add to desired state (${row.installedVersion})
         </button>` : ''

    const reconcileBtn = desired && this._ccAvailable && this._nodes.length > 0
      ? `<button class="sc-action-btn sc-action-live" data-action="reconcile" data-name="${row.name}">
           ↻ Trigger reconcile
         </button>` : ''

    const upgradeBtn = status === 'managed-drift' && this._ccAvailable && !!row.desiredVersion
      ? `<button class="sc-action-btn sc-action-live" data-action="add" data-name="${row.name}" data-version="${row.desiredVersion}">
           ↑ Re-apply desired ${row.desiredVersion}
         </button>` : ''

    const actionHtml = addBtn || reconcileBtn || upgradeBtn

    return `
      <tr class="sc-detail">
        <td colspan="7">
          <div class="sc-detail-inner">

            <section class="sc-detail-section">
              <div class="sc-detail-title">Installed (this node)</div>
              <div class="sc-kv"><span class="sc-kv-key">Version</span>
                <span class="sc-kv-val sc-mono">${row.installedVersion ?? '—'}</span></div>
              <div class="sc-kv"><span class="sc-kv-key">State</span>
                <span class="sc-kv-val">${row.installedState ?? '—'}</span></div>
            </section>

            <section class="sc-detail-section">
              <div class="sc-detail-title">Desired state (controller)</div>
              ${!this._ccAvailable
                ? `<span class="sc-muted">Controller unreachable</span>`
                : !this._ccHasPlan
                  ? `<span class="sc-muted">No plan configured yet</span>`
                  : row.desiredVersion === undefined
                    ? `<span class="sc-muted">Not in controller plan</span>`
                    : `
                    <div class="sc-kv"><span class="sc-kv-key">Version</span>
                      <span class="sc-kv-val sc-mono">${row.desiredVersion}</span></div>
                    <div class="sc-kv"><span class="sc-kv-key">Nodes at desired</span>
                      <span class="sc-kv-val">${row.nodesAtDesired ?? 0} / ${row.nodesTotal ?? 0}</span></div>
                    ${(row.upgrading ?? 0) > 0
                      ? `<div class="sc-kv"><span class="sc-kv-key">Upgrading</span>
                         <span class="sc-kv-val">${row.upgrading}</span></div>` : ''}
                    `
              }
            </section>

            ${this._nodes.length > 0 && managed ? `
            <section class="sc-detail-section">
              <div class="sc-detail-title">Cluster nodes (${this._nodes.length})</div>
              ${this._nodes.map(n => `
                <div class="sc-kv">
                  <span class="sc-kv-key sc-mono">${n.hostname || n.nodeId}</span>
                  <span class="sc-kv-val sc-muted">${n.status}</span>
                </div>`).join('')}
            </section>` : ''}

            ${actionHtml ? `
            <section class="sc-detail-section">
              <div class="sc-detail-title">Actions</div>
              ${addBtn}${reconcileBtn}${upgradeBtn}
            </section>` : ''}

          </div>
        </td>
      </tr>`
  }

  // ─── Row ─────────────────────────────────────────────────────────────────

  private renderRow(row: CatalogRow): string {
    const expanded = this._expandedName === row.name
    return `
      <tr class="md-row${expanded ? ' expanded' : ''}" data-name="${row.name}">
        <td><span class="sc-chevron${expanded ? ' open' : ''}">›</span></td>
        <td class="sc-name">${row.name}</td>
        <td>${desiredCell(row, this._ccAvailable, this._ccHasPlan)}</td>
        <td>${installedCell(row)}</td>
        <td>${this.repoLatestCell(row)}</td>
        <td>${rolloutCell(row, this._ccAvailable)}</td>
        <td>${statusBadge(row, this._ccAvailable, this._ccHasPlan)}</td>
      </tr>
      ${expanded ? this.renderDetailPanel(row) : ''}`
  }

  // ─── Repo latest helper ──────────────────────────────────────────────────

  /** Returns the latest published bundle version for a service name, or null if none. */
  private repoLatestVersion(serviceName: string): string | null {
    if (!this._repoAvailable || this._catalog.length === 0) return null
    const sn      = normalizeForMatch(serviceName)
    const matches = this._catalog.filter(item => normalizeForMatch(item.name) === sn)
    if (matches.length === 0) return null
    matches.sort((a, b) => b.version.localeCompare(a.version, undefined, { numeric: true }))
    return matches[0].version || null
  }

  private repoLatestCell(row: CatalogRow): string {
    const latest = this.repoLatestVersion(row.name)
    if (!latest) return `<span class="sc-muted">—</span>`
    const desired = row.desiredVersion
    if (!desired || desired === latest) {
      return `<span class="sc-mono" style="font-size:.72rem">${latest}</span>`
    }
    // Desired exists but is different from latest — update available
    return badge(`↑ ${latest}`, '#f59e0b')
  }

  // ─── Repository tab ──────────────────────────────────────────────────────

  private catalogItemStatusBadge(item: CatalogItem): string {
    const { version } = item
    const sn        = normalizeForMatch(item.name)
    const installed = this._rows.find(r => normalizeForMatch(r.name) === sn)
    if (!installed || !installed.installedVersion) {
      return badge('Not installed', 'var(--secondary-text-color)')
    }
    if (installed.installedVersion === version) {
      return badge('Installed ✓', 'var(--success-color)')
    }
    return badge(`Update available (${installed.installedVersion} → ${version})`, '#f59e0b')
  }

  private renderCatalogItemDetail(item: CatalogItem): string {
    const size     = item.sizeBytes ? `${(item.sizeBytes / 1024).toFixed(1)} KB` : '—'
    const modified = item.publishedAt ? new Date(item.publishedAt * 1000).toLocaleString() : '—'
    const checksum = item.checksum || '—'

    const addBtn = this._ccAvailable && item.version
      ? `<button class="sc-action-btn sc-action-live"
           data-action="repo-add"
           data-name="${item.name}" data-version="${item.version}">
           + Set desired to ${item.name}@${item.version}
         </button>` : ''

    return `
      <tr class="sc-detail" data-repo-key="${item.id}">
        <td colspan="6">
          <div class="sc-detail-inner">
            <section class="sc-detail-section">
              <div class="sc-detail-title">Identity</div>
              <div class="sc-kv"><span class="sc-kv-key">Publisher</span>
                <span class="sc-kv-val sc-mono">${item.publisherId || '—'}</span></div>
              <div class="sc-kv"><span class="sc-kv-key">Platform</span>
                <span class="sc-kv-val sc-mono">${item.platform || '—'}</span></div>
              <div class="sc-kv"><span class="sc-kv-key">Checksum</span>
                <span class="sc-kv-val sc-mono" style="font-size:.65rem;word-break:break-all">${checksum}</span></div>
              <div class="sc-kv"><span class="sc-kv-key">Size</span>
                <span class="sc-kv-val">${size}</span></div>
              <div class="sc-kv"><span class="sc-kv-key">Published</span>
                <span class="sc-kv-val">${modified}</span></div>
            </section>
            ${addBtn ? `
            <section class="sc-detail-section">
              <div class="sc-detail-title">Actions</div>
              ${addBtn}
            </section>` : ''}
          </div>
        </td>
      </tr>`
  }

  private renderRepositoryTab(): string {
    if (!this._repoAvailable) {
      const detail = this._repoError ? `: ${this._repoError}` : ''
      return `<div class="sc-banner sc-banner-warn">
        ⚠ Repository catalog unavailable${detail}
      </div>`
    }

    const q    = this._repoSearch.toLowerCase()
    const rows = this._catalog.filter(item => {
      if (!q) return true
      return item.name.toLowerCase().includes(q)
        || item.version.toLowerCase().includes(q)
        || item.publisherId.toLowerCase().includes(q)
        || item.platform.toLowerCase().includes(q)
    })

    if (rows.length === 0) {
      return `<div class="md-panel"><p class="sc-empty">
        ${this._catalog.length === 0
          ? 'No packages published to the repository yet.'
          : 'No packages match the search query.'}
      </p></div>`
    }

    return `
      <div class="sc-toolbar">
        <input class="sc-search" id="repoSearch" type="search"
          placeholder="Search by name, version or publisher…"
          value="${this._repoSearch.replace(/"/g, '&quot;')}">
        <span class="sc-count">${rows.length} package${rows.length !== 1 ? 's' : ''}</span>
      </div>
      <div class="md-panel">
        <table class="md-table">
          <thead>
            <tr>
              <th style="width:24px"></th>
              <th>Name</th>
              <th>Version</th>
              <th>Platform</th>
              <th>Publisher</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map(item => {
              const exp = this._repoExpandedKey === item.id
              return `
                <tr class="md-row${exp ? ' expanded' : ''}" data-repo-row="${item.id}">
                  <td><span class="sc-chevron${exp ? ' open' : ''}">›</span></td>
                  <td class="sc-name">${item.name}</td>
                  <td><span class="sc-mono" style="font-size:.72rem">${item.version || '—'}</span></td>
                  <td><span class="sc-mono sc-muted">${item.platform || '—'}</span></td>
                  <td><span class="sc-muted">${item.publisherId || '—'}</span></td>
                  <td>${this.catalogItemStatusBadge(item)}</td>
                </tr>
                ${exp ? this.renderCatalogItemDetail(item) : ''}`
            }).join('')}
          </tbody>
        </table>
      </div>`
  }

  // ─── Full render ─────────────────────────────────────────────────────────

  private render() {
    const rows  = this.filteredRows
    const total = this._rows.length

    // Controller state banner — one clear statement
    let ccBanner = ''
    if (!this._loading) {
      if (!this._ccAvailable) {
        ccBanner = `<div class="sc-banner sc-banner-warn">
          ⚠ Controller unreachable — desired state and rollout progress unavailable.
        </div>`
      } else if (!this._ccHasPlan) {
        const canSeed = this._runtimeAvailable
        ccBanner = `<div class="sc-banner sc-banner-info" style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
          <span>ℹ Controller is reachable but has no desired-state entries configured yet.</span>
          ${canSeed ? `<button class="sc-btn" id="btnSeed" style="white-space:nowrap">
            ↑ Import from installed
          </button>` : ''}
        </div>`
      } else {
        const n = this._rows.filter(r => r.desiredVersion !== undefined).length
        ccBanner = `<div class="sc-banner sc-banner-ok">
          ✓ Controller managing ${n} service${n !== 1 ? 's' : ''}.
        </div>`
      }
    }

    const loadErrorBanner = this._loadError
      ? `<div class="sc-banner sc-banner-error">⚠ ${this._loadError}</div>` : ''

    // Dynamic title
    const title    = 'Service Rollout'
    const subtitle = 'Desired state (controller) vs. installed state (this node)'

    // Empty-state message
    let emptyMsg = ''
    if (!this._loading && total === 0) {
      if (!this._runtimeAvailable && !this._ccAvailable)
        emptyMsg = 'No data — runtime registry and controller are both unreachable.'
      else if (!this._ccAvailable)
        emptyMsg = 'No services found in runtime registry.'
      else
        emptyMsg = 'No services found.'
    } else if (!this._loading && rows.length === 0) {
      emptyMsg = 'No services match the current filters.'
    }

    this.innerHTML = `
      <style>
        .sc-wrap { padding: 16px; }
        .sc-header { display: flex; align-items: center; gap: 12px; margin-bottom: 4px; }
        .sc-header h2 { margin: 0; font: var(--md-typescale-headline-small); }
        .sc-subtitle { margin: .25rem 0 .75rem; opacity: .85; font: var(--md-typescale-body-medium); }

        .sc-tabs {
          display: flex; gap: 4px; margin-bottom: 12px;
          border-bottom: 1px solid var(--border-subtle-color);
        }
        .sc-tab {
          padding: 6px 14px; cursor: pointer; font-size: .8rem;
          border: none; background: transparent; color: var(--secondary-text-color);
          border-bottom: 2px solid transparent; margin-bottom: -1px;
        }
        .sc-tab:hover { color: var(--on-surface-color); }
        .sc-tab.active {
          color: var(--accent-color); border-bottom-color: var(--accent-color);
          font-weight: 600;
        }

        .sc-toolbar {
          display: flex; gap: 8px; flex-wrap: wrap;
          margin-bottom: 12px; align-items: center;
        }
        .sc-search {
          flex: 1; min-width: 180px; padding: 5px 10px;
          border: 1px solid var(--border-subtle-color);
          border-radius: var(--md-shape-sm);
          background: var(--md-surface-container-low);
          color: var(--on-surface-color); font-size: .82rem;
        }
        .sc-search:focus { outline: none; border-color: var(--accent-color); }
        .sc-select {
          padding: 5px 8px;
          border: 1px solid var(--border-subtle-color);
          border-radius: var(--md-shape-sm);
          background: var(--md-surface-container-low);
          color: var(--on-surface-color); font-size: .82rem; cursor: pointer;
        }
        .sc-count {
          font-size: .75rem; color: var(--secondary-text-color);
          margin-left: auto; white-space: nowrap;
        }

        .sc-banner {
          padding: 8px 14px; margin-bottom: 8px;
          border-radius: var(--md-shape-sm); font-size: .82rem; line-height: 1.5;
        }
        .sc-banner-warn  { border: 1px solid #f59e0b;
          background: color-mix(in srgb, #f59e0b 10%, transparent); color: #b45309; }
        .sc-banner-error { border: 1px solid var(--error-color);
          background: color-mix(in srgb, var(--error-color) 10%, transparent); color: var(--error-color); }
        .sc-banner-info  { border: 1px solid var(--border-subtle-color);
          background: var(--md-surface-container-low); color: var(--secondary-text-color); }
        .sc-banner-ok    { border: 1px solid var(--success-color);
          background: color-mix(in srgb, var(--success-color) 10%, transparent); color: var(--success-color); }

        .sc-name { font-weight: 600; }
        .sc-mono { font-family: monospace; }
        .sc-muted { color: var(--secondary-text-color); font-size: .75rem; }
        .sc-chevron {
          display: inline-block; font-size: 1rem;
          color: var(--secondary-text-color);
          transition: transform .15s; line-height: 1;
        }
        .sc-chevron.open { transform: rotate(90deg); }

        .sc-detail td {
          padding: 0; border-bottom: 1px solid var(--border-subtle-color);
          background: var(--md-surface-container-lowest) !important;
        }
        .sc-detail-inner {
          padding: 12px 16px 12px 28px;
          display: flex; flex-wrap: wrap; gap: 16px 32px;
        }
        .sc-detail-section { min-width: 180px; }
        .sc-detail-title {
          font-size: .68rem; font-weight: 700; text-transform: uppercase;
          letter-spacing: .05em; color: var(--secondary-text-color); margin-bottom: 6px;
        }
        .sc-kv { display: flex; gap: 6px; margin-bottom: 3px; font-size: .75rem; }
        .sc-kv-key { color: var(--secondary-text-color); white-space: nowrap; min-width: 80px; }
        .sc-kv-val { word-break: break-all; }

        .sc-badge {
          display: inline-block; padding: 1px 7px; border-radius: 99px;
          font-size: .65rem; font-weight: 700; letter-spacing: .04em;
          background: color-mix(in srgb, var(--badge-color) 15%, transparent);
          color: var(--badge-color);
          border: 1px solid color-mix(in srgb, var(--badge-color) 30%, transparent);
        }
        .sc-progress-track {
          display: inline-block; width: 60px; height: 5px; border-radius: 99px;
          background: color-mix(in srgb, var(--on-surface-color) 15%, transparent);
          vertical-align: middle; overflow: hidden;
        }
        .sc-progress-fill { height: 100%; border-radius: 99px; }
        .sc-empty {
          padding: 24px 16px; text-align: center;
          font-style: italic; color: var(--secondary-text-color); font-size: .82rem;
        }
        .sc-btn {
          border: 1px solid var(--border-subtle-color); background: transparent;
          color: var(--on-surface-color); border-radius: var(--md-shape-sm);
          padding: 3px 10px; cursor: pointer; font-size: .72rem;
        }
        .sc-btn:hover { background: var(--md-state-hover); }

        .sc-action-btn {
          padding: 4px 12px; border-radius: var(--md-shape-sm);
          border: 1px solid var(--border-subtle-color);
          background: transparent; color: var(--secondary-text-color);
          font-size: .75rem; cursor: pointer; display: block; margin-bottom: 4px;
        }
        .sc-action-btn:hover { background: var(--md-state-hover); }
        .sc-action-btn:disabled { opacity: .5; cursor: not-allowed; }
        .sc-action-live { color: var(--accent-color); border-color: var(--accent-color); }

        .sc-modal-overlay {
          position: fixed; inset: 0;
          background: rgba(0,0,0,.45); z-index: 9999;
          display: flex; align-items: center; justify-content: center;
        }
        .sc-modal {
          background: var(--md-surface-container);
          border: 1px solid var(--border-subtle-color);
          border-radius: var(--md-shape-lg);
          box-shadow: 0 8px 32px rgba(0,0,0,.3);
          min-width: 360px; max-width: 580px; width: 90%;
          display: flex; flex-direction: column; max-height: 80vh;
        }
        .sc-modal-header {
          padding: 14px 16px 10px;
          font-weight: 700; font-size: .88rem;
          border-bottom: 1px solid var(--border-subtle-color);
        }
        .sc-modal-body {
          padding: 14px 16px; overflow-y: auto; flex: 1; font-size: .8rem;
        }
        .sc-modal-footer {
          padding: 10px 16px;
          border-top: 1px solid var(--border-subtle-color);
          display: flex; gap: 8px; justify-content: flex-end;
        }
        .sc-issue-error {
          padding: 4px 8px; margin-bottom: 4px; border-radius: var(--md-shape-sm);
          color: var(--error-color);
          background: color-mix(in srgb, var(--error-color) 10%, transparent);
          font-size: .78rem;
        }
        .sc-issue-warn {
          padding: 4px 8px; margin-bottom: 4px; border-radius: var(--md-shape-sm);
          color: #b45309;
          background: color-mix(in srgb, #f59e0b 10%, transparent);
          font-size: .78rem;
        }
        .sc-issue-ok {
          padding: 4px 8px; margin-bottom: 4px; border-radius: var(--md-shape-sm);
          color: var(--success-color);
          background: color-mix(in srgb, var(--success-color) 10%, transparent);
          font-size: .78rem;
        }
        .sc-preview-node {
          margin-bottom: 6px; font-size: .75rem;
        }
        .sc-preview-node-id {
          font-family: monospace; color: var(--secondary-text-color); font-size: .7rem;
        }
      </style>

      <div class="sc-wrap">
        <div class="sc-header">
          <h2>${title}</h2>
          <div style="flex:1"></div>
          <button class="sc-btn" id="btnRefresh" ${this._busy ? 'disabled' : ''}>
            ${this._busy ? '…' : '↻ Refresh'}
          </button>
        </div>
        <p class="sc-subtitle">${subtitle}</p>

        <div class="sc-tabs">
          <button class="sc-tab${this._activeTab === 'rollout' ? ' active' : ''}" data-tab="rollout">
            Service Rollout
          </button>
          <button class="sc-tab${this._activeTab === 'repository' ? ' active' : ''}" data-tab="repository">
            Repository Catalog
            ${this._catalog.length > 0 ? `<span class="sc-badge" style="--badge-color:var(--accent-color);margin-left:4px">${this._catalog.length}</span>` : ''}
          </button>
        </div>

        ${this._activeTab === 'repository'
          ? this.renderRepositoryTab()
          : `
            ${loadErrorBanner}
            ${ccBanner}

            <div class="sc-toolbar">
              <input class="sc-search" id="searchInput" type="search"
                placeholder="Search by name or version…"
                value="${this._search.replace(/"/g, '&quot;')}">
              <select class="sc-select" id="statusFilter">
                <option value="all"${this._filterStatus === 'all'       ? ' selected' : ''}>All</option>
                <option value="managed"${this._filterStatus === 'managed'   ? ' selected' : ''}>Managed</option>
                <option value="unmanaged"${this._filterStatus === 'unmanaged' ? ' selected' : ''}>Unmanaged</option>
                <option value="drift"${this._filterStatus === 'drift'     ? ' selected' : ''}>Drift / Progressing</option>
                <option value="missing"${this._filterStatus === 'missing'   ? ' selected' : ''}>Desired — not installed</option>
                <option value="installed"${this._filterStatus === 'installed' ? ' selected' : ''}>Installed</option>
              </select>
              <span class="sc-count">
                ${this._loading ? 'Loading…' : `${rows.length} of ${total} services`}
              </span>
            </div>

            ${this._loading
              ? `<p style="padding:14px;font-style:italic;color:var(--secondary-text-color)">Loading…</p>`
              : emptyMsg
              ? `<div class="md-panel"><p class="sc-empty">${emptyMsg}</p></div>`
              : `<div class="md-panel">
                  <table class="md-table">
                    <thead>
                      <tr>
                        <th style="width:24px"></th>
                        <th>Service</th>
                        <th>Desired</th>
                        <th>Installed</th>
                        <th>Repo Latest</th>
                        <th>Rollout</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${rows.map(r => this.renderRow(r)).join('')}
                    </tbody>
                  </table>
                </div>`}
          `}
      </div>

      ${this._modalOpen ? `
        <div class="sc-modal-overlay" id="scModalOverlay">
          <div class="sc-modal">
            <div class="sc-modal-header">${this._modalTitle}</div>
            <div class="sc-modal-body" id="scModalBody">${this._modalHtml}</div>
            <div class="sc-modal-footer">
              <button class="sc-btn" id="btnModalCancel">Cancel</button>
              <button class="sc-action-btn sc-action-live" id="btnModalConfirm"
                style="display:inline-block;margin:0"
                ${this._modalConfirmEnabled ? '' : 'disabled'}>
                Apply
              </button>
            </div>
          </div>
        </div>` : ''}
    `

    this.bindEvents()
  }

  private bindEvents() {
    this.querySelector('#btnRefresh')?.addEventListener('click', () => this.load())

    this.querySelector('#btnSeed')?.addEventListener('click', () => this.doSeedFromInstalled())

    const search = this.querySelector('#searchInput') as HTMLInputElement | null
    search?.addEventListener('input', () => { this._search = search.value; this.render() })

    const sel = this.querySelector('#statusFilter') as HTMLSelectElement | null
    sel?.addEventListener('change', () => { this._filterStatus = sel.value; this.render() })

    // Tab switching
    this.querySelectorAll<HTMLElement>('[data-tab]').forEach(btn => {
      btn.addEventListener('click', () => {
        this._activeTab = btn.dataset.tab ?? 'rollout'
        this.render()
      })
    })

    // Repository search
    const repoSearch = this.querySelector('#repoSearch') as HTMLInputElement | null
    repoSearch?.addEventListener('input', () => { this._repoSearch = repoSearch.value; this.render() })

    // Modal buttons
    this.querySelector('#btnModalCancel')?.addEventListener('click', () => this.closeModal())
    this.querySelector('#btnModalConfirm')?.addEventListener('click', () => {
      if (this._modalConfirmFn) this._modalConfirmFn()
    })

    // Repository table: expand row + action buttons
    this.querySelector('.md-table')?.addEventListener('click', (e: Event) => {
      const actionBtn = (e.target as HTMLElement).closest<HTMLElement>('[data-action]')
      if (actionBtn) {
        e.stopPropagation()
        const action  = actionBtn.dataset.action ?? ''
        const name    = actionBtn.dataset.name ?? ''
        const version = actionBtn.dataset.version ?? ''
        if (action === 'add') this.doAddToDesired(name, version)
        if (action === 'repo-add') this.doSetDesired(name, version)
        if (action === 'reconcile') this.doReconcile()
        return
      }
      // Rollout tab row expand
      const rolloutRow = (e.target as HTMLElement).closest<HTMLTableRowElement>('[data-name]')
      if (rolloutRow?.dataset.name) {
        const name = rolloutRow.dataset.name
        this._expandedName = this._expandedName === name ? '' : name
        this.render()
        return
      }
      // Repository tab row expand
      const repoRow = (e.target as HTMLElement).closest<HTMLTableRowElement>('[data-repo-row]')
      if (repoRow?.dataset.repoRow) {
        const key = repoRow.dataset.repoRow
        this._repoExpandedKey = this._repoExpandedKey === key ? '' : key
        this.render()
      }
    })
  }

  // ─── Modal helpers ────────────────────────────────────────────────────────

  private openModal(title: string, bodyHtml: string) {
    this._modalOpen = true
    this._modalTitle = title
    this._modalHtml = bodyHtml
    this._modalConfirmEnabled = false
    this._modalConfirmFn = null
    this.render()
  }

  private updateModalBody(bodyHtml: string, confirmEnabled: boolean, confirmFn: (() => Promise<void>) | null) {
    this._modalHtml = bodyHtml
    this._modalConfirmEnabled = confirmEnabled
    this._modalConfirmFn = confirmFn
    const body = this.querySelector<HTMLElement>('#scModalBody')
    if (body) body.innerHTML = bodyHtml
    const btn = this.querySelector<HTMLButtonElement>('#btnModalConfirm')
    if (btn) btn.disabled = !confirmEnabled
  }

  private closeModal() {
    this._modalOpen = false
    this._modalTitle = ''
    this._modalHtml = ''
    this._modalConfirmEnabled = false
    this._modalConfirmFn = null
    this.render()
  }

  private issueHtml(issues: ValidationIssue[]): string {
    return issues.map(i => {
      const cls = i.severity === 'ERROR' ? 'sc-issue-error' : 'sc-issue-warn'
      const icon = i.severity === 'ERROR' ? '✕' : '⚠'
      return `<div class="${cls}">${icon} ${i.message}</div>`
    }).join('')
  }

  // ─── Actions ─────────────────────────────────────────────────────────────

  /** Validate → Preview → Apply flow for setting a repo artifact as desired. */
  private async doSetDesired(name: string, version: string) {
    if (!name || !version) return

    const nodeIds = this._nodes.map(n => n.nodeId)
    const title = `Set desired: ${name}@${version}`

    this.openModal(title, `<p class="sc-muted" style="font-style:italic">Validating artifact…</p>`)

    // ── Step 1: Validate ──────────────────────────────────────────────────
    let report
    try {
      report = await validateArtifact(name, version, nodeIds)
    } catch (e: unknown) {
      this.updateModalBody(
        `<div class="sc-banner sc-banner-error">Validation failed: ${normalizeError(e).message}</div>`,
        false, null,
      )
      return
    }

    const errors   = report.issues.filter(i => i.severity === 'ERROR')
    const warnings = report.issues.filter(i => i.severity === 'WARNING')

    if (errors.length > 0) {
      this.updateModalBody(
        `<div class="sc-banner sc-banner-error" style="margin-bottom:8px">Validation failed — cannot proceed</div>` +
        this.issueHtml(report.issues),
        false, null,
      )
      return
    }

    const warnHtml = warnings.length > 0
      ? this.issueHtml(warnings)
      : `<div class="sc-issue-ok">✓ Validation passed</div>`

    this.updateModalBody(
      warnHtml + `<p class="sc-muted" style="font-style:italic;margin-top:8px">Previewing changes…</p>`,
      false, null,
    )

    // ── Step 2: Preview ───────────────────────────────────────────────────
    let preview: PlanPreview
    try {
      preview = await previewDesiredServices([{ serviceId: name, version }], [])
    } catch (e: unknown) {
      this.updateModalBody(
        warnHtml + `<div class="sc-banner sc-banner-error" style="margin-top:8px">Preview failed: ${normalizeError(e).message}</div>`,
        false, null,
      )
      return
    }

    if (preview.blockingIssues.length > 0) {
      this.updateModalBody(
        warnHtml +
        `<div style="margin-top:8px;font-weight:600;font-size:.78rem">Preview blocked:</div>` +
        this.issueHtml(preview.blockingIssues),
        false, null,
      )
      return
    }

    // Build per-node will_install summary.
    const installHtml = preview.nodeChanges.length === 0
      ? `<div class="sc-muted">No nodes require changes (already at ${version}).</div>`
      : preview.nodeChanges.map(nc => {
          const node = this._nodes.find(n => n.nodeId === nc.nodeId)
          const label = node?.hostname || nc.nodeId.slice(0, 12) + '…'
          return `<div class="sc-preview-node">
            <span class="sc-preview-node-id">${label}</span>
            → ${nc.willInstall.join(', ')}
          </div>`
        }).join('')

    const confirmFn = async () => {
      const body = this.querySelector<HTMLElement>('#scModalBody')
      if (body) body.innerHTML = `<p class="sc-muted" style="font-style:italic">Applying…</p>`
      const btn = this.querySelector<HTMLButtonElement>('#btnModalConfirm')
      if (btn) btn.disabled = true
      try {
        await upsertDesiredService(name, version)
        await triggerReconcileAll(nodeIds)
        displaySuccess(`${name} set to desired version ${version}`)
        this.closeModal()
        this._activeTab = 'rollout'
        await this.load()
      } catch (e: unknown) {
        displayError(normalizeError(e).message)
        this.closeModal()
      }
    }

    this.updateModalBody(
      warnHtml +
      `<div style="margin-top:10px">
        <div class="sc-detail-title">Will install</div>
        ${installHtml}
      </div>`,
      true, confirmFn,
    )
  }

  private async doSeedFromInstalled() {
    if (this._busy) return
    this._busy = true
    this.render()
    try {
      const result = await seedDesiredState('IMPORT_FROM_INSTALLED')
      const count = result.length
      displaySuccess(`Seeded ${count} service${count !== 1 ? 's' : ''} into desired state`)
      await triggerReconcileAll(this._nodes.map(n => n.nodeId))
      await this.load()
    } catch (e: unknown) {
      displayError(normalizeError(e).message)
    } finally {
      this._busy = false
      this.render()
    }
  }

  private async doAddToDesired(name: string, version: string) {
    if (this._busy || !name || !version) return
    this._busy = true
    this.render()
    try {
      await upsertDesiredService(name, version)
      displaySuccess(`${name} added to desired state at ${version}`)
      await triggerReconcileAll(this._nodes.map(n => n.nodeId))
      await this.load()
    } catch (e: unknown) {
      displayError(normalizeError(e).message)
    } finally {
      this._busy = false
      this.render()
    }
  }

  private async doReconcile() {
    if (this._busy) return
    this._busy = true
    this.render()
    try {
      await triggerReconcileAll(this._nodes.map(n => n.nodeId))
      displaySuccess('Reconciliation triggered')
      window.setTimeout(() => this.load(), 1500)
    } catch (e: unknown) {
      displayError(normalizeError(e).message)
    } finally {
      this._busy = false
      this.render()
    }
  }
}

customElements.define('page-services-catalog', PageServicesCatalog)
