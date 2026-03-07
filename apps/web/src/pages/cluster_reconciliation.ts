// src/pages/cluster_reconciliation.ts
import {
  listClusterNodes,
  getDriftReport,
  getClusterHealthV1Full,
  computeReconciliationDiff,
  type ClusterNode,
  type DriftReport,
  type DriftItem,
  type NodeHealthV1,
  type NodeReconciliationDiff,
  type ServiceDiffEntry,
} from '@globular/backend'

// ─── DriftCategory constants (numeric, from generated proto enums) ───────────

const DRIFT_UNKNOWN        = 0
const MISSING_UNIT_FILE    = 1
const UNIT_STOPPED         = 2
const UNIT_DISABLED        = 3
const VERSION_MISMATCH     = 4
const STATE_HASH_MISMATCH  = 5
const ENDPOINT_MISSING     = 6
const INVENTORY_INCOMPLETE = 7

function driftCategoryLabel(c: number): string {
  switch (c) {
    case MISSING_UNIT_FILE:    return 'MISSING_UNIT_FILE'
    case UNIT_STOPPED:         return 'UNIT_STOPPED'
    case UNIT_DISABLED:        return 'UNIT_DISABLED'
    case VERSION_MISMATCH:     return 'VERSION_MISMATCH'
    case STATE_HASH_MISMATCH:  return 'STATE_HASH_MISMATCH'
    case ENDPOINT_MISSING:     return 'ENDPOINT_MISSING'
    case INVENTORY_INCOMPLETE: return 'INVENTORY_INCOMPLETE'
    default:                   return 'UNKNOWN'
  }
}

function driftCategoryColor(c: number): string {
  switch (c) {
    case MISSING_UNIT_FILE:
    case UNIT_STOPPED:         return 'var(--error-color)'
    case STATE_HASH_MISMATCH:
    case VERSION_MISMATCH:
    case INVENTORY_INCOMPLETE:
    case ENDPOINT_MISSING:     return '#f59e0b'
    case UNIT_DISABLED:        return 'var(--secondary-text-color)'
    default:                   return 'var(--secondary-text-color)'
  }
}

function badge(label: string, color: string): string {
  return `<span class="md-badge" style="--badge-color:${color}">${label}</span>`
}

function actionColor(action: ServiceDiffEntry['action']): string {
  switch (action) {
    case 'install':   return 'var(--error-color)'
    case 'upgrade':
    case 'downgrade': return '#f59e0b'
    case 'remove':    return '#f97316'
    case 'ok':        return 'color-mix(in srgb, var(--success-color) 70%, transparent)'
    default:          return 'var(--secondary-text-color)'
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

interface NodeDrift {
  node: ClusterNode
  report: DriftReport | null
  error: string
}

class PageClusterReconciliation extends HTMLElement {
  private _rows: NodeDrift[] = []
  private _nodeHealths: NodeHealthV1[] = []
  private _diffs: NodeReconciliationDiff[] = []
  private _loadError = ''
  private _loading = true
  private _refreshTimer: number | null = null

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
    let nodes: ClusterNode[]
    try {
      const [nodeList, healthResult, diffs] = await Promise.all([
        listClusterNodes(),
        getClusterHealthV1Full().catch(() => null),
        computeReconciliationDiff().catch(() => [] as NodeReconciliationDiff[]),
      ])
      nodes = nodeList
      this._nodeHealths = healthResult?.nodeHealths ?? []
      this._diffs = diffs
      this._loadError = ''
    } catch (e: any) {
      this._loadError = e?.message || 'ClusterController unavailable'
      this._loading = false
      this.render()
      return
    }

    // Fetch drift reports concurrently for all nodes
    const results = await Promise.allSettled(
      nodes.map(n => getDriftReport(n.nodeId))
    )

    this._rows = nodes.map((node, i) => {
      const res = results[i]
      return {
        node,
        report: res.status === 'fulfilled' ? res.value : null,
        error:  res.status === 'rejected'  ? ((res.reason as any)?.message || 'Doctor unavailable') : '',
      }
    })

    this._loading = false
    this.render()
  }

  private render() {
    const allItems: Array<DriftItem & { hostname: string }> = []
    for (const row of this._rows) {
      if (row.report) {
        for (const item of row.report.items) {
          allItems.push({ ...item, hostname: row.node.hostname || row.node.nodeId })
        }
      }
    }

    const totalDrift = allItems.length
    const criticalCats = new Set([MISSING_UNIT_FILE, UNIT_STOPPED])
    const criticalCount = allItems.filter(i => criticalCats.has(i.category)).length
    const needsPrivApplyCount = this._nodeHealths.filter(nh =>
      !nh.canApplyPrivileged && nh.desiredServicesHash && nh.desiredServicesHash !== nh.appliedServicesHash
    ).length

    this.innerHTML = `
      <style>
        .cr-wrap { padding: 16px; }
        .cr-header { display: flex; align-items: center; gap: 12px; margin-bottom: 4px; }
        .cr-header h2 { margin: 0; font: var(--md-typescale-headline-small); }
        .cr-subtitle { margin: .25rem 0 1rem; opacity: .85; font-size: .88rem; }
        .cr-stat-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 14px; }
        @media(max-width: 540px) { .cr-stat-grid { grid-template-columns: 1fr 1fr; } }
        .cr-stat-card {
          background: var(--md-surface-container-low);
          border: 1px solid var(--border-subtle-color);
          border-radius: var(--md-shape-md);
          box-shadow: var(--md-elevation-1);
          padding: 14px 18px;
        }
        .cr-stat-label {
          font-size: .72rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: .06em;
          color: var(--secondary-text-color);
          margin-bottom: 4px;
        }
        .cr-stat-value { font-size: 1.8rem; font-weight: 800; line-height: 1; }
        .cr-mono { font-family: monospace; font-size: .78rem; }
        .cr-empty { padding: 14px; font-size: .85rem; font-style: italic; color: var(--secondary-text-color); }
        .cr-btn-refresh {
          border: 1px solid var(--border-subtle-color);
          background: transparent;
          color: var(--on-surface-color);
          border-radius: var(--md-shape-sm);
          padding: 3px 10px;
          cursor: pointer;
          font-size: .78rem;
        }
        .cr-btn-refresh:hover { background: var(--md-state-hover); }
        .cr-node-panel-header {
          padding: 8px 14px;
          font: var(--md-typescale-label-medium);
          text-transform: uppercase;
          letter-spacing: .06em;
          color: var(--secondary-text-color);
          background: var(--md-surface-container);
          border-bottom: 1px solid var(--border-subtle-color);
        }
        .cr-cmd-wrap {
          display: inline-flex; align-items: center; gap: 6px;
          margin-top: 4px; padding: 4px 8px;
          background: var(--md-surface-container);
          border-radius: 4px;
        }
        .cr-copy-btn {
          background: transparent; border: none; cursor: pointer;
          color: var(--secondary-text-color);
          padding: 2px; display: inline-flex; align-items: center;
          border-radius: 3px; transition: color .15s;
        }
        .cr-copy-btn:hover { color: var(--accent-color); }
        .cr-copy-btn.cr-copy-ok { color: var(--success-color); }
        .cr-section-label {
          font-size: .72rem; font-weight: 700; text-transform: uppercase;
          letter-spacing: .06em; color: var(--secondary-text-color);
          padding: 8px 14px; background: var(--md-surface-container);
          border-bottom: 1px solid var(--border-subtle-color);
        }
      </style>

      <div class="cr-wrap">
        <div class="cr-header">
          <h2>Reconciliation &amp; Plans</h2>
          <div style="flex:1"></div>
          <button class="cr-btn-refresh" id="btnRefresh">↻ Refresh</button>
        </div>
        <p class="cr-subtitle">Service version diff, drift between desired and applied state, and missing units per node.</p>

        ${this._loading ? `<p class="cr-empty">Loading drift data…</p>` : ''}

        ${this._loadError ? `
        <div class="md-banner-warn">
          Could not load nodes — ${this._loadError}
          <br><span style="font-size:.8em;opacity:.8">Ensure <code>cluster_controller.ClusterControllerService</code> is reachable.</span>
        </div>
        ` : ''}

        ${!this._loading && !this._loadError ? `
        <div class="cr-stat-grid">
          <div class="cr-stat-card">
            <div class="cr-stat-label">Nodes Checked</div>
            <div class="cr-stat-value">${this._rows.length}</div>
          </div>
          <div class="cr-stat-card">
            <div class="cr-stat-label">Total Drift Items</div>
            <div class="cr-stat-value" style="color:${totalDrift > 0 ? '#f59e0b' : 'var(--secondary-text-color)'}">${totalDrift}</div>
          </div>
          <div class="cr-stat-card">
            <div class="cr-stat-label">Critical Items</div>
            <div class="cr-stat-value" style="color:${criticalCount > 0 ? 'var(--error-color)' : 'var(--secondary-text-color)'}">${criticalCount}</div>
          </div>
          <div class="cr-stat-card">
            <div class="cr-stat-label">Needs Privileged Apply</div>
            <div class="cr-stat-value" style="color:${needsPrivApplyCount > 0 ? '#f97316' : 'var(--secondary-text-color)'}">${needsPrivApplyCount}</div>
          </div>
        </div>

        ${this._rows.map(row => {
          const items = row.report?.items ?? []
          const diff = this._diffs.find(d => d.nodeId === row.node.nodeId)
          const diffServices = diff?.services ?? []
          const hasDriftItems = items.length > 0
          const hasServiceDiff = diffServices.some(s => s.action !== 'ok')
          if (!hasDriftItems && !hasServiceDiff) return ''

          const nh = this._nodeHealths.find(h => h.nodeId === row.node.nodeId)
          const hasHashMismatch = items.some(i => i.category === STATE_HASH_MISMATCH)
          const nodeCanPriv = nh?.canApplyPrivileged ?? true
          return `
          <div class="md-panel">
            <div class="md-panel-header">
              <span>${row.node.hostname || row.node.nodeId}</span>
              <span style="font-weight:400">${items.length} drift item${items.length !== 1 ? 's' : ''}${diffServices.filter(s => s.action !== 'ok').length > 0 ? ` · ${diffServices.filter(s => s.action !== 'ok').length} service action${diffServices.filter(s => s.action !== 'ok').length !== 1 ? 's' : ''}` : ''}${!nodeCanPriv ? ' · <span style="color:#f97316">unprivileged</span>' : ''}</span>
            </div>
            ${nh ? `
            <div style="padding:6px 14px;font-size:.75rem;display:flex;gap:14px;flex-wrap:wrap;color:var(--secondary-text-color);border-bottom:1px solid var(--border-subtle-color)">
              <span>Desired hash: <code class="cr-mono">${nh.desiredServicesHash?.slice(0, 12) || '—'}…</code></span>
              <span>Applied hash: <code class="cr-mono">${nh.appliedServicesHash?.slice(0, 12) || '—'}…</code></span>
              <span>Plan phase: <code class="cr-mono">${nh.currentPlanPhase || '—'}</code></span>
              <span>Privileged: ${nodeCanPriv ? '✓' : '<span style="color:#f97316">✕</span>'}</span>
            </div>` : ''}

            ${diffServices.length > 0 ? `
            <div class="cr-section-label">Service Versions</div>
            <table class="md-table">
              <thead>
                <tr>
                  <th>Service</th>
                  <th>Desired</th>
                  <th>Installed</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                ${diffServices.map(s => `
                <tr>
                  <td class="cr-mono">${s.serviceId}</td>
                  <td class="cr-mono" style="color:var(--success-color)">${s.desired || '—'}</td>
                  <td class="cr-mono" style="color:${s.action === 'ok' ? 'var(--on-surface-color)' : actionColor(s.action)}">${s.installed || '—'}</td>
                  <td>${badge(s.action.toUpperCase(), actionColor(s.action))}</td>
                </tr>`).join('')}
              </tbody>
            </table>` : ''}

            ${items.length > 0 ? `
            <div class="cr-section-label">Drift Items</div>
            <table class="md-table">
              <thead>
                <tr>
                  <th>Category</th>
                  <th>Entity</th>
                  <th>Desired</th>
                  <th>Actual</th>
                </tr>
              </thead>
              <tbody class="md-interactive">
                ${items.map((item: DriftItem) => {
                  const color = driftCategoryColor(item.category)
                  const label = driftCategoryLabel(item.category)
                  return `
                  <tr>
                    <td>${badge(label, color)}</td>
                    <td class="cr-mono">${item.entityRef || '—'}</td>
                    <td class="cr-mono" style="color:var(--success-color)">${item.desired || '—'}</td>
                    <td class="cr-mono" style="color:${color}">${item.actual || '—'}</td>
                  </tr>`
                }).join('')}
              </tbody>
            </table>` : ''}

            ${hasHashMismatch ? `
            <div class="md-banner-warn" style="margin:8px 14px 14px;font-size:.82rem">
              ${!nodeCanPriv
                ? `<strong>Awaiting privileged apply</strong> — this node cannot apply privileged operations (systemd unit installation).`
                : `<strong>Apply required</strong> — the node-agent cannot install systemd units.`}
              Run on the target node:<br>
              <span class="cr-cmd-wrap">
                <code>globular services apply-desired</code>
                <button class="cr-copy-btn" data-copy="globular services apply-desired" title="Copy to clipboard">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                  </svg>
                </button>
              </span>
            </div>` : ''}
          </div>`
        }).join('')}

        ${!this._loading && this._rows.every(r => !r.report || r.report.items.length === 0) && !this._diffs.some(d => d.hasDrift) ? `
        <div class="md-panel">
          <p class="cr-empty">✓ No drift detected — all nodes are in the desired state.</p>
        </div>
        ` : ''}
        ` : ''}
      </div>
    `

    this.querySelector('#btnRefresh')?.addEventListener('click', () => this.load())
    this.querySelectorAll<HTMLElement>('[data-copy]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation()
        const text = btn.dataset.copy ?? ''
        navigator.clipboard.writeText(text).then(() => {
          btn.classList.add('cr-copy-ok')
          setTimeout(() => btn.classList.remove('cr-copy-ok'), 1200)
        })
      })
    })
  }
}

customElements.define('page-cluster-reconciliation', PageClusterReconciliation)
