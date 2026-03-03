import {
  getClusterHealth,
  listClusterNodes,
  queryEvents,
  Backend,
  type ClusterHealth,
  type ClusterNode,
} from '@globular/backend'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function statusColor(s: string): string {
  const u = s.toUpperCase()
  if (u.includes('HEALTHY'))     return 'var(--success-color)'
  if (u.includes('DEGRADED'))    return '#f59e0b'
  if (u.includes('UNREACHABLE') || u.includes('UNKNOWN') || u.includes('ERROR')) return 'var(--error-color)'
  return 'var(--secondary-text-color)'
}

function statusBadge(s: string): string {
  const color = statusColor(s)
  const label = s || 'UNKNOWN'
  return `<span style="
    display:inline-block; padding:2px 8px; border-radius: var(--md-shape-full); font-size:.72rem;
    font-weight:700; letter-spacing:.04em; text-transform:uppercase;
    background:color-mix(in srgb,${color} 15%,transparent);
    color:${color}; border:1px solid color-mix(in srgb,${color} 35%,transparent);
  ">${label}</span>`
}

function relativeTime(epochSeconds: number): string {
  if (!epochSeconds) return '—'
  const diff = Math.floor(Date.now() / 1000) - epochSeconds
  if (diff < 60)   return `${diff}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

// ─── Component ───────────────────────────────────────────────────────────────

class PageDashboard extends HTMLElement {
  private _refreshTimer: number | null = null
  private _eventSubs: Array<[string, string]> = []
  private _events: Array<{
    time: string; name: string; data: string;
    severity?: string; type?: string; message?: string;
    nodeId?: string; service?: string; correlationId?: string;
  }> = []
  private _latestSequence = 0
  private _health: ClusterHealth | null = null
  private _nodes: ClusterNode[] = []
  private _loading = true
  private _healthError = ''
  private _nodesError = ''

  connectedCallback() {
    this.style.display = 'block'
    this.render()
    this.load()
    this._refreshTimer = window.setInterval(() => this.load(), 30_000)
    this.subscribeEvents()
  }

  disconnectedCallback() {
    if (this._refreshTimer) clearInterval(this._refreshTimer)
    this._eventSubs.forEach(([ch, uuid]) => Backend.unsubscribe(ch, uuid))
    this._eventSubs = []
  }

  private async load() {
    const [healthResult, nodesResult] = await Promise.allSettled([
      getClusterHealth(),
      listClusterNodes(),
    ])

    if (healthResult.status === 'fulfilled') {
      this._health = healthResult.value
      this._healthError = ''
    } else {
      this._healthError = (healthResult.reason as any)?.message || 'ClusterController unavailable'
    }

    if (nodesResult.status === 'fulfilled') {
      this._nodes = nodesResult.value
      this._nodesError = ''
    } else {
      this._nodesError = (nodesResult.reason as any)?.message || 'Could not list nodes'
    }

    // Load recent control-plane events from history (survives page refresh).
    try {
      const [planResult, serviceResult] = await Promise.allSettled([
        queryEvents({ nameFilter: 'plan_', limit: 50 }),
        queryEvents({ nameFilter: 'service_apply_', limit: 50 }),
      ])
      type DashEvent = { time: string; name: string; data: string; severity?: string; type?: string; message?: string; nodeId?: string; service?: string; correlationId?: string }
      const allHistorical: Array<{ ev: DashEvent; seq: number }> = []
      for (const r of [planResult, serviceResult]) {
        if (r.status !== 'fulfilled') continue
        for (const ev of r.value.events) {
          allHistorical.push({
            ev: {
              time: ev.tsEpoch ? new Date(ev.tsEpoch * 1000).toLocaleTimeString() : '??:??',
              name: ev.name,
              data: ev.dataJson?.message || (typeof ev.dataJson === 'object' ? JSON.stringify(ev.dataJson) : `${ev.data.length} bytes`),
              severity: ev.dataJson?.severity as string | undefined,
              type: ev.name,
              message: ev.dataJson?.message as string | undefined,
              nodeId: ev.dataJson?.node_id as string | undefined,
              service: ev.dataJson?.service as string | undefined,
              correlationId: ev.dataJson?.correlation_id as string | undefined,
            },
            seq: ev.sequence,
          })
        }
        if (r.value.latestSequence > this._latestSequence) {
          this._latestSequence = r.value.latestSequence
        }
      }
      // Sort by sequence descending (newest first), take top 50.
      allHistorical.sort((a, b) => b.seq - a.seq)
      const historical = allHistorical.slice(0, 50).map(h => h.ev)
      if (historical.length > 0) {
        const existing = new Set(this._events.map(e => `${e.time}:${e.name}`))
        for (const h of historical) {
          if (!existing.has(`${h.time}:${h.name}`)) {
            this._events.push(h)
          }
        }
        this._events = this._events.slice(0, 50)
      }
    } catch { /* event service may be unavailable */ }

    this._loading = false
    this.render()
  }

  private subscribeEvents() {
    if (!Backend.eventHub) return
    const controlPlaneEvents = [
      'plan_generated', 'plan_apply_started', 'plan_blocked_privileged',
      'plan_apply_succeeded', 'plan_apply_failed', 'plan_blocked',
      'service_apply_started', 'service_apply_succeeded', 'service_apply_failed',
    ]
    const channels = [...controlPlaneEvents]
    channels.forEach(ch => {
      Backend.subscribe(ch, (uuid) => {
        this._eventSubs.push([ch, uuid])
      }, (data) => {
        let parsed: any = null
        if (typeof data === 'string') {
          try { parsed = JSON.parse(data) } catch { /* not JSON */ }
        } else if (typeof data === 'object') {
          parsed = data
        }
        this._events.unshift({
          time: new Date().toLocaleTimeString(),
          name: ch,
          data: parsed?.message || (typeof data === 'string' ? data : JSON.stringify(data)),
          severity: parsed?.severity,
          type: ch,
          message: parsed?.message,
          nodeId: parsed?.node_id,
          service: parsed?.service,
          correlationId: parsed?.correlation_id,
        })
        if (this._events.length > 50) this._events.pop()
        this.renderEventsFeed()
      }, false)
    })
  }

  private severityColor(sev?: string): string {
    const s = (sev || '').toUpperCase()
    if (s === 'ERROR') return 'var(--error-color)'
    if (s === 'WARN')  return '#f59e0b'
    return 'var(--secondary-text-color)'
  }

  private renderEventsFeed() {
    const feed = this.querySelector('#events-feed')
    if (!feed) return
    if (this._events.length === 0) {
      feed.innerHTML = '<p class="empty-msg">No events yet — waiting for cluster activity…</p>'
      return
    }
    feed.innerHTML = this._events.slice(0, 20).map(e => {
      const color = this.severityColor(e.severity)
      const badge = e.name || 'event'
      const typeBadge = `<span style="
            display:inline-block; padding:1px 6px; border-radius:var(--md-shape-full); font-size:.68rem;
            font-weight:700; letter-spacing:.03em;
            background:color-mix(in srgb,${color} 15%,transparent);
            color:${color}; border:1px solid color-mix(in srgb,${color} 30%,transparent);
          ">${badge}</span>`
      const msg = e.message || e.data
      const meta = [e.nodeId, e.service, e.correlationId].filter(Boolean)
      const metaHtml = meta.length > 0
        ? `<div style="font-size:.65rem;color:var(--secondary-text-color);opacity:.7;grid-column:2/4;font-family:monospace">${meta.join(' · ')}</div>`
        : ''
      return `
        <div class="event-row">
          <span class="ev-time">${e.time}</span>
          ${typeBadge}
          <span class="ev-data" style="color:${e.severity === 'ERROR' ? 'var(--error-color)' : 'var(--on-surface-color)'}">${msg}</span>
          ${metaHtml}
        </div>
      `
    }).join('')
  }

  private render() {
    const h = this._health
    const now = new Date().toLocaleTimeString()
    const serviceUnavailable = !!this._healthError

    // Nodes with non-healthy status or failed checks
    const degraded = h?.nodes.filter(n =>
      !n.status.toUpperCase().includes('HEALTHY') || (n.failedChecks ?? 0) > 0
    ) ?? []

    // Nodes with incomplete inventory
    const inventoryIssues = this._nodes.filter(n => !n.inventoryComplete)

    this.innerHTML = `
      <style>
        .dash { padding: 16px; display: flex; flex-direction: column; gap: 20px; }

        /* ── header ── */
        .dash-header { display:flex; align-items:center; gap:12px; }
        .dash-header h2 { margin:0; font: var(--md-typescale-headline-small); }
        .dash-ts { font-size:.8rem; color:var(--secondary-text-color); margin-left:auto; }
        .btn-refresh {
          border:1px solid var(--border-subtle-color); background:transparent;
          color:var(--on-surface-color); border-radius: var(--md-shape-sm); padding:5px 12px;
          cursor:pointer; font-size:.85rem; font-weight:600;
        }
        .btn-refresh:hover { background:var(--surface-elevated-color); }

        /* ── stat cards ── */
        .stat-grid { display:grid; grid-template-columns:repeat(4,1fr); gap:12px; }
        @media(max-width:700px) { .stat-grid { grid-template-columns:repeat(2,1fr); } }
        .stat-card {
          background: var(--md-surface-container-low); border:1px solid var(--border-subtle-color);
          border-radius: var(--md-shape-md); padding:16px 20px;
          box-shadow: var(--md-elevation-1);
        }
        .stat-card .label { font-size:.75rem; font-weight:600; text-transform:uppercase;
          letter-spacing:.06em; color:var(--secondary-text-color); margin-bottom:6px; }
        .stat-card .value { font-size:2rem; font-weight:800; line-height:1; }
        .stat-card .sub { font-size:.78rem; color:var(--secondary-text-color); margin-top:4px; }

        /* ── two-column layout ── */
        .dash-body { display:grid; grid-template-columns:1fr 280px; gap:16px; }
        @media(max-width:900px) { .dash-body { grid-template-columns:1fr; } }

        /* ── panels ── */
        .panel {
          background: var(--md-surface-container-low); border:1px solid var(--border-subtle-color);
          border-radius: var(--md-shape-md); overflow:hidden;
          box-shadow: var(--md-elevation-1);
        }
        .panel-header {
          padding:12px 16px; font: var(--md-typescale-label-medium); text-transform:uppercase;
          letter-spacing:.06em; color:var(--secondary-text-color);
          background: var(--md-surface-container);
          border-bottom:1px solid var(--border-subtle-color);
          display:flex; align-items:center; gap:8px;
        }
        .panel-body { padding:16px; }
        .panel-body.no-pad { padding:0; }

        /* ── node health table ── */
        .hostname { font-weight:600; }
        .failed-checks { font-size:.75rem; color:var(--error-color); }

        /* ── quick actions ── */
        .action-list { display:flex; flex-direction:column; gap:8px; }
        .btn-action {
          width:100%; text-align:left; padding:10px 14px;
          border:1px solid var(--border-subtle-color); border-radius: var(--md-shape-sm);
          background:transparent; color:var(--on-surface-color); cursor:pointer;
          font-size:.88rem; font-weight:600; display:flex; align-items:center; gap:8px;
          transition: background .15s;
        }
        .btn-action:hover { background:var(--surface-elevated-color); }
        .btn-action .icon { font-size:1rem; width:20px; text-align:center; }
        .btn-action.primary { background:var(--accent-color); color:#fff;
          border-color:var(--accent-color); }
        .btn-action.primary:hover { opacity:.9; }

        /* ── events feed ── */
        .event-row { display:grid; grid-template-columns:60px 1fr 2fr;
          gap:8px; padding:7px 16px; font-size:.78rem;
          border-bottom:1px solid var(--border-subtle-color); }
        .event-row:last-child { border-bottom:none; }
        .ev-time { color:var(--secondary-text-color); white-space:nowrap; }
        .ev-name { font-weight:600; color:var(--accent-color); font-size:.72rem;
          word-break:break-all; }
        .ev-data { color:var(--on-surface-color); overflow:hidden;
          text-overflow:ellipsis; white-space:nowrap; }

        /* ── misc ── */
        .empty-msg { color:var(--secondary-text-color); font-size:.85rem;
          font-style:italic; margin:0; padding:16px; }
        /* use global .md-banner-warn */
        .cluster-id { font-size:.75rem; color:var(--secondary-text-color); font-family:monospace; }
        .dot { width:8px; height:8px; border-radius: 50%; display:inline-block; flex-shrink:0; }
      </style>

      <div class="dash">

        <!-- Header -->
        <div class="dash-header">
          <h2>Overview</h2>
          ${h ? `<span class="cluster-id">${h.clusterDomain || h.clusterId}</span>` : ''}
          <span class="dash-ts">Updated ${now}</span>
          <button class="btn-refresh" id="btnRefresh">↻ Refresh</button>
        </div>

        ${this._loading ? `<div class="empty-msg">Loading cluster data…</div>` : ''}

        <!-- Stat cards -->
        ${serviceUnavailable ? `
        <div class="md-banner-warn">
          ⚠ ClusterController service not reachable —
          <span style="font-family:monospace;font-size:.8em">${this._healthError}</span>
          <br><span style="font-size:.8em;opacity:.8">
            Ensure the <code>cluster_controller.ClusterControllerService</code> subdomain is
            registered in the Envoy/xDS routing on your cluster.
          </span>
        </div>
        ` : ''}
        ${h ? `
        <div class="stat-grid">
          <div class="stat-card">
            <div class="label">Total Nodes</div>
            <div class="value">${h.totalNodes}</div>
            <div class="sub">${h.clusterDomain || 'cluster'}</div>
          </div>
          <div class="stat-card">
            <div class="label">Healthy</div>
            <div class="value" style="color:var(--success-color)">${h.healthyNodes}</div>
            <div class="sub">nodes nominal</div>
          </div>
          <div class="stat-card">
            <div class="label">Degraded</div>
            <div class="value" style="color:#f59e0b">${h.unhealthyNodes}</div>
            <div class="sub">need attention</div>
          </div>
          <div class="stat-card">
            <div class="label">Unknown</div>
            <div class="value" style="color:var(--error-color)">${h.unknownNodes}</div>
            <div class="sub">unreachable</div>
          </div>
        </div>
        ` : ''}

        <!-- Main body -->
        <div class="dash-body">

          <!-- Left column: node health + drift -->
          <div style="display:flex;flex-direction:column;gap:16px;">

            <!-- Node Health table -->
            <div class="panel">
              <div class="panel-header">
                <span class="dot" style="background:var(--success-color)"></span>
                Node Health
              </div>
              <div class="panel-body no-pad">
                ${h && h.nodes.length > 0 && !serviceUnavailable ? `
                <table class="md-table">
                  <thead>
                    <tr>
                      <th>Hostname</th>
                      <th>Status</th>
                      <th>Issues</th>
                      <th>Last Seen</th>
                    </tr>
                  </thead>
                  <tbody class="md-interactive">
                    ${h.nodes.map(n => `
                    <tr>
                      <td class="hostname">${n.hostname || n.nodeId}</td>
                      <td>${statusBadge(n.status)}</td>
                      <td>
                        ${n.failedChecks > 0
                          ? `<span class="failed-checks">${n.failedChecks} failed</span>`
                          : '<span style="color:var(--secondary-text-color)">—</span>'}
                      </td>
                      <td style="color:var(--secondary-text-color)">${relativeTime(n.lastSeen)}</td>
                    </tr>
                    `).join('')}
                  </tbody>
                </table>
                ` : serviceUnavailable
                  ? `<p class="empty-msg">ClusterController service not available.</p>`
                  : `<p class="empty-msg">No node health data available.</p>`}
              </div>
            </div>

            <!-- Drift / Inventory issues -->
            ${degraded.length > 0 || inventoryIssues.length > 0 ? `
            <div class="panel">
              <div class="panel-header" style="color:#f59e0b;">
                <span class="dot" style="background:#f59e0b"></span>
                Drift & Inventory Issues
              </div>
              <div class="panel-body no-pad">
                <table class="md-table">
                  <thead><tr><th>Hostname</th><th>Problem</th><th>Detail</th></tr></thead>
                  <tbody class="md-interactive">
                    ${degraded.map(n => `
                    <tr>
                      <td class="hostname">${n.hostname || n.nodeId}</td>
                      <td>${statusBadge(n.status)}</td>
                      <td class="failed-checks">${n.failedChecks ? `${n.failedChecks} failed checks` : n.lastError || '—'}</td>
                    </tr>
                    `).join('')}
                    ${inventoryIssues.map(n => `
                    <tr>
                      <td class="hostname">${n.hostname || n.nodeId}</td>
                      <td>${statusBadge('INVENTORY_INCOMPLETE')}</td>
                      <td style="color:var(--secondary-text-color)">Inventory not yet complete</td>
                    </tr>
                    `).join('')}
                  </tbody>
                </table>
              </div>
            </div>
            ` : ''}

            <!-- Events feed -->
            <div class="panel">
              <div class="panel-header">
                <span class="dot" style="background:var(--accent-color)"></span>
                Live Events
              </div>
              <div id="events-feed">
                <p class="empty-msg">Waiting for cluster events…</p>
              </div>
            </div>

          </div>

          <!-- Right column: quick actions -->
          <div style="display:flex;flex-direction:column;gap:16px;">
            <div class="panel">
              <div class="panel-header">Quick Actions</div>
              <div class="panel-body">
                <div class="action-list">
                  <button class="btn-action primary" id="btnReconcile">
                    <span class="icon">⟳</span> Reconcile Cluster
                  </button>
                  <button class="btn-action" id="btnPause">
                    <span class="icon">⏸</span> Pause Reconciliation
                  </button>
                  <button class="btn-action" id="btnDiagnostics">
                    <span class="icon">🔍</span> Collect Diagnostics
                  </button>
                  <button class="btn-action" id="btnMaintenance">
                    <span class="icon">🔧</span> Maintenance Mode
                  </button>
                </div>
              </div>
            </div>

            ${h ? `
            <div class="panel">
              <div class="panel-header">Cluster Info</div>
              <div class="panel-body" style="font-size:.82rem;display:flex;flex-direction:column;gap:8px;">
                <div><span style="color:var(--secondary-text-color)">Status</span>
                  <span style="float:right">${statusBadge(h.status || 'UNKNOWN')}</span></div>
                ${h.clusterId ? `<div><span style="color:var(--secondary-text-color)">Cluster ID</span>
                  <span style="float:right;font-family:monospace;font-size:.75rem">${h.clusterId.slice(0,12)}…</span></div>` : ''}
                ${h.clusterDomain ? `<div><span style="color:var(--secondary-text-color)">Domain</span>
                  <span style="float:right">${h.clusterDomain}</span></div>` : ''}
              </div>
            </div>
            ` : ''}
          </div>

        </div>
      </div>
    `

    // Wire up buttons
    this.querySelector('#btnRefresh')?.addEventListener('click', () => this.load())
    this.querySelector('#btnReconcile')?.addEventListener('click', () => this.handleReconcile())
    this.querySelector('#btnPause')?.addEventListener('click', () => this.handlePause())
    this.querySelector('#btnDiagnostics')?.addEventListener('click', () => {
      window.location.hash = '#/admin/diagnostics'
    })
    this.querySelector('#btnMaintenance')?.addEventListener('click', () => this.handleMaintenance())

    // Re-render events feed without full re-render
    this.renderEventsFeed()
  }

  private async handleReconcile() {
    const btn = this.querySelector('#btnReconcile') as HTMLButtonElement
    if (!btn) return
    btn.disabled = true
    btn.textContent = '⟳ Reconciling…'
    try {
      // reconcileNodeV1 requires a node ID; a full-cluster trigger is not yet exposed
      // as a single RPC. Reload health after a short delay to reflect any changes.
      await new Promise(r => setTimeout(r, 1500))
      await this.load()
    } finally {
      btn.disabled = false
      btn.innerHTML = '<span class="icon">⟳</span> Reconcile Cluster'
    }
  }

  private handlePause() {
    // Stub — requires a dedicated PauseReconciliation RPC (Phase 2)
    alert('Pause reconciliation requires a PauseReconciliation RPC (not yet implemented).')
  }

  private handleMaintenance() {
    // Stub — requires MaintenanceMode RPC (Phase 2)
    alert('Maintenance mode requires a SetMaintenanceMode RPC (not yet implemented).')
  }
}

customElements.define('page-dashboard', PageDashboard)
