// src/pages/services_instances.ts
import {
  listClusterNodes,
  getNodePlan,
  getNodeReport,
  type ClusterNode,
  type NodeServicePlan,
  type NodeReport,
} from '@globular/backend'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function badge(label: string, color: string): string {
  return `<span class="md-badge" style="--badge-color:${color}">${label.toUpperCase()}</span>`
}

function unitStateBadge(state: string): string {
  const s = (state || '').toLowerCase()
  if (s.includes('active') || s.includes('running'))
    return badge(state, 'var(--success-color)')
  if (s.includes('failed') || s.includes('error'))
    return badge(state, 'var(--error-color)')
  if (s.includes('activating') || s.includes('deactivating'))
    return badge(state, '#f59e0b')
  if (state)
    return badge(state, 'var(--secondary-text-color)')
  return `<span style="color:var(--secondary-text-color)">—</span>`
}

// ─── Component ────────────────────────────────────────────────────────────────

interface NodeRow {
  node:   ClusterNode
  plan:   NodeServicePlan | null
  report: NodeReport | null
}

class PageServicesInstances extends HTMLElement {
  private _rows:        NodeRow[] = []
  private _loadError  = ''
  private _loading    = true
  private _expandedId = ''      // expanded node id
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

    const [planResults, reportResults] = await Promise.all([
      Promise.allSettled(nodes.map(n => getNodePlan(n.nodeId))),
      Promise.allSettled(nodes.map(n => getNodeReport(n.nodeId))),
    ])

    this._rows = nodes.map((node, i) => ({
      node,
      plan:   planResults[i].status   === 'fulfilled' ? planResults[i].value   : null,
      report: reportResults[i].status === 'fulfilled' ? reportResults[i].value : null,
    }))

    this._loading = false
    this.render()
  }

  private totalServices(): number {
    return this._rows.reduce((acc, r) => acc + (r.plan?.services.length ?? 0), 0)
  }

  private render() {
    this.innerHTML = `
      <style>
        .si-wrap { padding: 16px; }
        .si-header { display: flex; align-items: center; gap: 12px; margin-bottom: 4px; }
        .si-header h2 { margin: 0; font: var(--md-typescale-headline-small); }
        .si-subtitle { margin: .25rem 0 1rem; opacity: .85; font: var(--md-typescale-body-medium); }
        .si-panel {
          background:    var(--md-surface-container-low);
          border:        1px solid var(--border-subtle-color);
          border-radius: var(--md-shape-md);
          box-shadow:    var(--md-elevation-1);
          overflow:      hidden;
          margin-bottom: 12px;
        }
        .si-panel-header {
          padding:         10px 14px;
          font:            var(--md-typescale-label-medium);
          font-size:       .72rem;
          text-transform:  uppercase;
          letter-spacing:  .06em;
          color:           var(--secondary-text-color);
          background:      var(--md-surface-container);
          border-bottom:   1px solid var(--border-subtle-color);
          display:         flex;
          align-items:     center;
          justify-content: space-between;
        }
        .si-node-row {
          padding:       10px 14px;
          display:       flex;
          align-items:   center;
          gap:           12px;
          cursor:        pointer;
          border-bottom: 1px solid var(--border-subtle-color);
          font-size:     .82rem;
        }
        .si-node-row:last-child { border-bottom: none; }
        .si-node-row:hover { background: var(--md-state-hover); }
        .si-node-row.expanded { background: var(--md-state-selected); }
        .si-node-name { font-weight: 600; min-width: 140px; }
        .si-chevron { font-size: .9rem; margin-left: auto; color: var(--secondary-text-color); transition: transform .15s; }
        .si-chevron.open { transform: rotate(90deg); }
        .si-svc-table {
          width: 100%;
          border-collapse: collapse;
          font-size: .72rem;
          background: var(--md-surface-container-lowest);
        }
        .si-svc-table th {
          text-align:     left;
          padding:        7px 14px 7px 28px;
          font-size:      .72rem;
          font-weight:    700;
          text-transform: uppercase;
          letter-spacing: .05em;
          color:          var(--secondary-text-color);
          border-bottom:  1px solid var(--border-subtle-color);
          background:     var(--md-surface-container-low);
        }
        .si-svc-table td {
          padding:       7px 14px 7px 28px;
          border-bottom: 1px solid var(--border-subtle-color);
          vertical-align: middle;
        }
        .si-svc-table tr:last-child td { border-bottom: none; }
        .si-unit { font-family: monospace; color: var(--secondary-text-color); }
        .si-ver  { font-family: monospace; }
        .si-empty { padding: 12px 28px; font-style: italic; color: var(--secondary-text-color); font-size: .82rem; }
        .si-btn {
          border:        1px solid var(--border-subtle-color);
          background:    transparent;
          color:         var(--on-surface-color);
          border-radius: var(--md-shape-sm);
          padding:       3px 10px;
          cursor:        pointer;
          font-size:     .72rem;
        }
        .si-btn:hover { background: var(--md-state-hover); }
      </style>

      <div class="si-wrap">
        <div class="si-header">
          <h2>Service Instances</h2>
          <div style="flex:1"></div>
          <button class="si-btn" id="btnRefresh">↻ Refresh</button>
        </div>
        <p class="si-subtitle">Desired service instances from each node's active plan (ClusterController).</p>

        ${this._loading ? `<p style="padding:14px;font-style:italic;color:var(--secondary-text-color)">Loading…</p>` : ''}

        ${this._loadError ? `
        <div class="md-banner-warn">
          ⚠ Could not load nodes — ${this._loadError}
          <br><span style="font-size:.8em;opacity:.8">Ensure <code>clustercontroller.ClusterControllerService</code> is reachable.</span>
        </div>` : ''}

        ${!this._loading && !this._loadError ? `
        <div class="si-panel">
          <div class="si-panel-header">
            <span>Nodes (${this._rows.length})</span>
            <span>${this.totalServices()} desired service${this.totalServices() !== 1 ? 's' : ''} total</span>
          </div>
          ${this._rows.length === 0
            ? `<p class="si-empty">No nodes registered.</p>`
            : this._rows.map(row => this.renderNodeRow(row)).join('')}
        </div>` : ''}
      </div>
    `

    this.querySelector('#btnRefresh')?.addEventListener('click', () => this.load())

    this.querySelectorAll<HTMLElement>('.si-node-row[data-node-id]').forEach(el => {
      el.addEventListener('click', () => {
        const id = el.dataset.nodeId ?? ''
        this._expandedId = this._expandedId === id ? '' : id
        this.render()
      })
    })
  }

  private renderNodeRow(row: NodeRow): string {
    const { node, plan, report } = row
    const expanded = node.nodeId === this._expandedId
    const svcCount = plan?.services.length ?? 0

    // Worst finding severity badge from ClusterDoctor report
    const worstSev = report?.findings.reduce((m, f) => Math.max(m, f.severity), 0) ?? 0
    const healthBadge = worstSev >= 4
      ? badge('critical', 'var(--error-color)')
      : worstSev >= 3
        ? badge('error', 'var(--error-color)')
        : worstSev >= 2
          ? badge('warn', '#f59e0b')
          : report && report.reachable
            ? badge('ok', 'var(--success-color)')
            : badge('unknown', 'var(--secondary-text-color)')

    const serviceTags = !plan
      ? `<span style="font-size:.72rem;color:var(--secondary-text-color)">no plan</span>`
      : svcCount === 0
        ? `<span style="font-size:.72rem;color:var(--secondary-text-color)">0 services</span>`
        : `<span class="md-chip md-chip-tonal">${svcCount} service${svcCount !== 1 ? 's' : ''}</span>`

    const serviceDetail = expanded ? `
      ${svcCount > 0 ? `
      <table class="si-svc-table">
        <thead>
          <tr>
            <th>Service</th>
            <th>Version</th>
            <th>Systemd Unit</th>
          </tr>
        </thead>
        <tbody>
          ${plan!.services.map(s => `
          <tr>
            <td style="font-weight:500">${s.name || '—'}</td>
            <td class="si-ver">${s.version || '—'}</td>
            <td class="si-unit">${s.unit || '—'}</td>
          </tr>`).join('')}
        </tbody>
      </table>` : `<p class="si-empty">No services in this node's plan.</p>`}
    ` : ''

    return `
      <div class="si-node-row${expanded ? ' expanded' : ''}" data-node-id="${node.nodeId}">
        <span class="si-node-name">${node.hostname || node.nodeId}</span>
        ${node.profiles.map(p => `<span class="md-chip md-chip-tonal" style="margin-right:2px">${p}</span>`).join('')}
        ${serviceTags}
        ${healthBadge}
        <span class="si-chevron${expanded ? ' open' : ''}">›</span>
      </div>
      ${serviceDetail}
    `
  }
}

customElements.define('page-services-instances', PageServicesInstances)
