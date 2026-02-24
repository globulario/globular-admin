// src/pages/cluster_reconciliation.ts
import { listClusterNodes, getDriftReport, type ClusterNode, type DriftReport, type DriftItem } from '@globular/backend'

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
  return `<span style="display:inline-block;padding:2px 8px;border-radius:999px;font-size:.72rem;font-weight:700;letter-spacing:.04em;text-transform:uppercase;background:color-mix(in srgb,${color} 15%,transparent);color:${color};border:1px solid color-mix(in srgb,${color} 35%,transparent)">${label}</span>`
}

// ─── Component ────────────────────────────────────────────────────────────────

interface NodeDrift {
  node: ClusterNode
  report: DriftReport | null
  error: string
}

class PageClusterReconciliation extends HTMLElement {
  private _rows: NodeDrift[] = []
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
      nodes = await listClusterNodes()
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

    this.innerHTML = `
      <style>
        .cr-wrap { padding: 16px; }
        .cr-header { display: flex; align-items: center; gap: 12px; margin-bottom: 4px; }
        .cr-header h2 { margin: 0; font-size: 1.25rem; font-weight: 800; }
        .cr-subtitle { margin: .25rem 0 1rem; opacity: .85; font-size: .88rem; }
        .cr-stat-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 14px; }
        @media(max-width: 540px) { .cr-stat-grid { grid-template-columns: 1fr 1fr; } }
        .cr-stat-card {
          background: var(--surface-color);
          border: 1px solid var(--border-subtle-color);
          border-radius: 12px;
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
        .cr-panel {
          background: var(--surface-color);
          border: 1px solid var(--border-subtle-color);
          border-radius: 12px;
          overflow: hidden;
          margin-bottom: 16px;
        }
        .cr-panel-header {
          padding: 10px 14px;
          font-size: .75rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: .06em;
          color: var(--secondary-text-color);
          border-bottom: 1px solid var(--border-subtle-color);
          display: flex;
          align-items: center;
          justify-content: space-between;
        }
        .cr-table { width: 100%; border-collapse: collapse; font-size: .84rem; }
        .cr-table th {
          text-align: left;
          padding: 8px 12px;
          font-size: .71rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: .06em;
          color: var(--secondary-text-color);
          border-bottom: 1px solid var(--border-subtle-color);
        }
        .cr-table td { padding: 8px 12px; border-bottom: 1px solid var(--border-subtle-color); vertical-align: middle; }
        .cr-table tr:last-child td { border-bottom: none; }
        .cr-table tr:hover td { background: color-mix(in srgb, var(--accent-color) 7%, transparent); }
        .cr-mono { font-family: monospace; font-size: .78rem; }
        .cr-empty { padding: 14px; font-size: .85rem; font-style: italic; color: var(--secondary-text-color); }
        .cr-btn-refresh {
          border: 1px solid var(--border-subtle-color);
          background: transparent;
          color: var(--on-surface-color);
          border-radius: 6px;
          padding: 3px 10px;
          cursor: pointer;
          font-size: .78rem;
        }
        .cr-warn-banner {
          background: color-mix(in srgb, #f59e0b 10%, transparent);
          border: 1px solid color-mix(in srgb, #f59e0b 35%, transparent);
          border-radius: 8px;
          padding: 12px 16px;
          font-size: .85rem;
          color: #b45309;
          margin-bottom: 16px;
          line-height: 1.6;
        }
        [data-theme="dark"] .cr-warn-banner { color: #fbbf24; }
        .cr-node-panel-header {
          padding: 8px 14px;
          font-size: .72rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: .06em;
          color: var(--secondary-text-color);
          background: color-mix(in srgb, var(--on-surface-color) 4%, transparent);
          border-bottom: 1px solid var(--border-subtle-color);
        }
      </style>

      <div class="cr-wrap">
        <div class="cr-header">
          <h2>Reconciliation &amp; Plans</h2>
          <div style="flex:1"></div>
          <button class="cr-btn-refresh" id="btnRefresh">↻ Refresh</button>
        </div>
        <p class="cr-subtitle">Drift between desired and applied state, version mismatches, and missing units per node.</p>

        ${this._loading ? `<p class="cr-empty">Loading drift data…</p>` : ''}

        ${this._loadError ? `
        <div class="cr-warn-banner">
          ⚠ Could not load nodes — ${this._loadError}
          <br><span style="font-size:.8em;opacity:.8">Ensure <code>clustercontroller.ClusterControllerService</code> is reachable.</span>
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
        </div>

        ${this._rows.map(row => {
          const items = row.report?.items ?? []
          if (!row.report || items.length === 0) return ''
          return `
          <div class="cr-panel">
            <div class="cr-panel-header">
              <span>${row.node.hostname || row.node.nodeId}</span>
              <span style="font-weight:400">${items.length} drift item${items.length !== 1 ? 's' : ''}</span>
            </div>
            <table class="cr-table">
              <thead>
                <tr>
                  <th>Category</th>
                  <th>Entity</th>
                  <th>Desired</th>
                  <th>Actual</th>
                </tr>
              </thead>
              <tbody>
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
            </table>
          </div>`
        }).join('')}

        ${!this._loading && this._rows.every(r => !r.report || r.report.items.length === 0) ? `
        <div class="cr-panel">
          <p class="cr-empty">✓ No drift detected — all nodes are in the desired state.</p>
        </div>
        ` : ''}
        ` : ''}
      </div>
    `

    this.querySelector('#btnRefresh')?.addEventListener('click', () => this.load())
  }
}

customElements.define('page-cluster-reconciliation', PageClusterReconciliation)
