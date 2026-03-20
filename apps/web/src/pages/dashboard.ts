import {
  getClusterHealth,
  listClusterNodes,
  queryEvents,
  Backend,
  type ClusterHealth,
  type ClusterNode,
} from '@globular/backend'
import { alertDialog } from '../utils/confirm_dialog'

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
    _parsed?: any;
  }> = []
  private _eventFilter = 'all'
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
      const [planResult, serviceResult, incidentResult, remediationResult] = await Promise.allSettled([
        queryEvents({ nameFilter: 'plan_', limit: 50 }),
        queryEvents({ nameFilter: 'service_apply_', limit: 50 }),
        queryEvents({ nameFilter: 'alert.incident.', limit: 50 }),
        queryEvents({ nameFilter: 'operation.remediation.', limit: 50 }),
      ])
      type DashEvent = { time: string; name: string; data: string; severity?: string; type?: string; message?: string; nodeId?: string; service?: string; correlationId?: string }
      const allHistorical: Array<{ ev: DashEvent; seq: number }> = []
      for (const r of [planResult, serviceResult, incidentResult, remediationResult]) {
        if (r.status !== 'fulfilled') continue
        for (const ev of r.value.events) {
          allHistorical.push({
            ev: {
              time: ev.tsEpoch ? new Date(ev.tsEpoch * 1000).toLocaleTimeString() : '??:??',
              name: ev.name,
              data: ev.dataJson?.message || ev.dataJson?.summary || (typeof ev.dataJson === 'object' ? JSON.stringify(ev.dataJson) : `${ev.data.length} bytes`),
              severity: ev.dataJson?.severity as string | undefined,
              type: ev.name,
              message: (ev.dataJson?.message || ev.dataJson?.summary) as string | undefined,
              nodeId: ev.dataJson?.node_id as string | undefined,
              service: ev.dataJson?.service as string | undefined,
              correlationId: (ev.dataJson?.correlation_id || ev.dataJson?.incident_id) as string | undefined,
              _parsed: ev.dataJson,
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
      // AI incident lifecycle events
      'alert.incident.resolved', 'alert.incident.failed',
      'alert.incident.approval_required', 'alert.incident.expired',
      'alert.incident.denied',
      'operation.remediation.completed',
      // Service crash / security events
      'alert.auth.denied', 'alert.auth.failed',
      'alert.dos.detected', 'alert.error.spike',
      'alert.admin.notification',
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
        const incidentId = parsed?.incident_id
        // When an incident resolves, remove ALL earlier events for the same
        // incident (admin alerts, remediations, etc.) — no false urgency.
        if (incidentId && ch === 'alert.incident.resolved') {
          this._events = this._events.filter(e => e.correlationId !== incidentId)
        }

        this._events.unshift({
          time: new Date().toLocaleTimeString(),
          name: ch,
          data: parsed?.message || parsed?.summary || (typeof data === 'string' ? data : JSON.stringify(data)),
          severity: parsed?.severity,
          type: ch,
          message: parsed?.message || parsed?.summary,
          nodeId: parsed?.node_id,
          service: parsed?.service,
          correlationId: incidentId || parsed?.correlation_id,
          _parsed: parsed,
        })
        if (this._events.length > 50) this._events.pop()
        this.renderEventsFeed()
      }, false)
    })
  }

  private severityColor(sev?: string): string {
    const s = (sev || '').toUpperCase()
    if (s === 'ERROR') return '#ef4444'
    if (s === 'WARN' || s === 'WARNING') return '#f59e0b'
    if (s === 'INFO') return '#3b82f6'
    return 'var(--secondary-text-color)'
  }

  /** Map raw event names to human-readable labels with icons. */
  private formatEvent(e: any): { icon: string; label: string; detail: string; color: string } {
    const p = e._parsed || {}
    const sev = e.severity || 'INFO'
    const color = this.severityColor(sev)

    switch (e.name) {
      // ── AI Incident Lifecycle ──
      case 'alert.incident.resolved':
        return {
          icon: '\u2705', label: 'Resolved',
          detail: p.message || this.formatAIDiagnosis(p),
          color: '#22c55e', // green — no longer urgent
        }
      case 'alert.incident.failed':
        return {
          icon: '\u274C', label: 'Incident Failed',
          detail: p.summary || p.message || 'Remediation failed',
          color,
        }
      case 'alert.incident.approval_required':
        return {
          icon: '\u270B', label: 'Approval Required',
          detail: this.formatApprovalRequest(p),
          color: '#ef4444',
        }
      case 'alert.incident.expired':
        return {
          icon: '\u23F0', label: 'Approval Expired',
          detail: p.summary || 'Action expired before approval',
          color: '#f59e0b',
        }
      case 'alert.incident.denied':
        return {
          icon: '\u{1F6AB}', label: 'Action Denied',
          detail: p.summary || 'Operator denied the proposed action',
          color,
        }
      case 'operation.remediation.completed':
        return {
          icon: '\u{1F527}', label: 'Remediation',
          detail: this.formatRemediation(p),
          color,
        }

      // ── Security Events ──
      case 'alert.auth.denied':
        return {
          icon: '\u{1F6E1}', label: 'Auth Denied',
          detail: `${p.subject || 'unknown'} blocked from ${p.method || 'unknown method'} \u2014 ${p.reason || ''}`,
          color: '#f59e0b',
        }
      case 'alert.auth.failed':
        return {
          icon: '\u{1F512}', label: 'Login Failed',
          detail: `Account "${p.account || 'unknown'}" \u2014 ${p.reason || 'invalid credentials'}`,
          color: '#f59e0b',
        }
      case 'alert.dos.detected':
        return {
          icon: '\u26A0', label: 'DoS Detected',
          detail: p.message || 'Request flood from single source',
          color: '#ef4444',
        }
      case 'alert.error.spike':
        return {
          icon: '\u{1F4C8}', label: 'Error Spike',
          detail: p.message || 'High error rate across service',
          color: '#ef4444',
        }
      case 'alert.admin.notification':
        return {
          icon: '\u{1F4E3}', label: 'Admin Alert',
          detail: this.formatAdminNotification(p),
          color: '#ef4444',
        }

      // ── Plan Events ──
      case 'plan_generated':
        return { icon: '\u{1F4CB}', label: 'Plan Created', detail: p.message || 'New plan generated', color }
      case 'plan_apply_started':
        return { icon: '\u25B6', label: 'Plan Applying', detail: p.message || 'Plan execution started', color }
      case 'plan_apply_succeeded':
        return { icon: '\u2705', label: 'Plan Succeeded', detail: p.message || 'Plan applied successfully', color }
      case 'plan_apply_failed':
        return { icon: '\u274C', label: 'Plan Failed', detail: p.message || 'Plan execution failed', color: '#ef4444' }
      case 'plan_blocked':
      case 'plan_blocked_privileged':
        return { icon: '\u23F8', label: 'Plan Blocked', detail: p.message || 'Plan requires manual action', color: '#f59e0b' }
      case 'service_apply_started':
        return { icon: '\u{1F504}', label: 'Service Update', detail: p.message || 'Service installation started', color }
      case 'service_apply_succeeded':
        return { icon: '\u2705', label: 'Service Installed', detail: p.message || 'Service installed successfully', color }
      case 'service_apply_failed':
        return { icon: '\u274C', label: 'Service Failed', detail: p.message || 'Service installation failed', color: '#ef4444' }

      default:
        return { icon: '\u2022', label: e.name, detail: e.message || e.data || '', color }
    }
  }

  private formatAIDiagnosis(p: any): string {
    const parts: string[] = []
    if (p.root_cause) parts.push(`Root cause: ${p.root_cause}`)
    if (p.confidence) parts.push(`(${Math.round(p.confidence * 100)}% confidence)`)
    if (p.proposed_action) parts.push(`\u2192 ${this.humanAction(p.proposed_action)}`)
    if (p.summary && !parts.length) parts.push(p.summary)
    return parts.join(' ') || p.message || 'Incident diagnosed and resolved'
  }

  private formatApprovalRequest(p: any): string {
    const parts = [p.summary || 'Action requires approval']
    if (p.proposed_action) parts.push(`Proposed: ${this.humanAction(p.proposed_action)}`)
    if (p.rationale) parts.push(`\u2014 ${p.rationale}`)
    return parts.join('. ')
  }

  private formatRemediation(p: any): string {
    const action = this.humanAction(p.action_type || '')
    const status = (p.status || '').replace('ACTION_', '')
    const target = (p.target || '').replace(/^restart_service:/, '')
    if (target) return `${action} "${target}" \u2192 ${status}`
    return `${action} \u2192 ${status}`
  }

  private formatAdminNotification(p: any): string {
    const parts: string[] = []
    if (p.summary) parts.push(p.summary)
    if (p.root_cause) parts.push(`Root cause: ${p.root_cause}`)
    if (p.rationale) parts.push(p.rationale)
    return parts.join(' \u2014 ') || p.message || 'Admin notification'
  }

  private humanAction(action: string): string {
    const map: Record<string, string> = {
      'restart_service': 'Restart service',
      'notify_admin': 'Notify admin',
      'observe_and_record': 'Observe & record',
      'drain_endpoint': 'Drain endpoint',
      'block_ip': 'Block IP',
      'tighten_circuit_breakers': 'Tighten circuit breakers',
      'clear_corrupted_storage': 'Clear corrupted storage',
      'cert_renew': 'Renew certificate',
      'ACTION_RESTART_SERVICE': 'Restart service',
      'ACTION_NOTIFY_ADMIN': 'Notify admin',
      'ACTION_DRAIN_ENDPOINT': 'Drain endpoint',
      'ACTION_BLOCK_IP': 'Block IP',
      'ACTION_NONE': 'Observe',
    }
    // Handle "restart_service:unit_name" format
    const base = action.split(':')[0]
    return map[base] || map[action] || action
  }

  private eventMatchesFilter(e: any): boolean {
    if (this._eventFilter === 'all') return true
    const sev = (e.severity || '').toUpperCase()
    switch (this._eventFilter) {
      case 'error': return sev === 'ERROR'
      case 'warn': return sev === 'WARN' || sev === 'WARNING'
      case 'info': return sev === 'INFO' || sev === ''
      default: return true
    }
  }

  private renderEventsFeed() {
    const feed = this.querySelector('#events-feed')
    if (!feed) return
    const filtered = this._events.filter(e => this.eventMatchesFilter(e))
    if (filtered.length === 0) {
      feed.innerHTML = `<p class="empty-msg">${this._events.length === 0 ? 'No events yet \u2014 waiting for cluster activity\u2026' : 'No events match this filter'}</p>`
      return
    }
    feed.innerHTML = filtered.slice(0, 30).map(e => {
      const fmt = this.formatEvent(e)
      const meta = [e.nodeId, e.service, e.correlationId].filter(Boolean)
      const metaHtml = meta.length > 0
        ? `<div class="ev-meta">${meta.join(' \u00b7 ')}</div>`
        : ''
      return `
        <div class="event-row">
          <span class="ev-time">${e.time}</span>
          <div class="ev-badge" style="
            background:color-mix(in srgb,${fmt.color} 12%,transparent);
            color:${fmt.color};
            border-color:color-mix(in srgb,${fmt.color} 25%,transparent);
          ">${fmt.icon} ${fmt.label}</div>
          <div class="ev-detail">
            <span style="color:${e.severity === 'ERROR' ? '#ef4444' : 'var(--on-surface-color)'}">${fmt.detail}</span>
            ${metaHtml}
          </div>
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

        /* ── events filter bar ── */
        .ev-filters { display:flex; gap:6px; padding:8px 16px; flex-wrap:wrap;
          border-bottom:1px solid var(--border-subtle-color); }
        .ev-filter-btn { padding:4px 12px; border-radius:12px; font-size:.7rem; font-weight:600;
          border:1px solid var(--border-subtle-color); background:transparent;
          color:var(--secondary-text-color); cursor:pointer; transition:all .15s;
          display:inline-flex; align-items:center; gap:5px; }
        .ev-filter-btn:hover { border-color:var(--f-color, var(--accent-color));
          color:var(--f-color, var(--accent-color)); }
        .ev-filter-btn.active { background:var(--f-color, var(--accent-color)); color:#fff;
          border-color:var(--f-color, var(--accent-color)); }
        .ev-filter-btn.active .dot { background:#fff !important; }

        /* ── events feed ── */
        .ev-list { max-height:500px; overflow-y:auto; }
        .event-row { display:grid; grid-template-columns:55px 140px 1fr;
          gap:12px; padding:10px 16px; font-size:.8rem; align-items:start;
          border-bottom:1px solid color-mix(in srgb, var(--border-subtle-color) 40%, transparent); }
        .event-row:hover { background:color-mix(in srgb, var(--accent-color) 5%, transparent); }
        .event-row:last-child { border-bottom:none; }
        .ev-time { color:var(--secondary-text-color); white-space:nowrap; font-size:.7rem;
          font-family:monospace; padding-top:3px; }
        .ev-badge { display:inline-flex; align-items:center; gap:5px; padding:3px 10px;
          border-radius:6px; font-size:.72rem; font-weight:600; white-space:nowrap;
          border:1px solid; min-width:110px; }
        .ev-detail { color:var(--on-surface-color); line-height:1.5; font-size:.8rem; }
        .ev-meta { font-size:.65rem; color:var(--secondary-text-color); opacity:.6;
          font-family:monospace; margin-top:3px; }

        /* ── animations ── */
        @keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:.3; } }

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
                <span class="dot" style="background:var(--accent-color);animation:pulse 2s infinite"></span>
                Live Events
                <span style="margin-left:auto;font-size:.65rem;font-weight:400;text-transform:none;letter-spacing:0">${this._events.length} events</span>
              </div>
              <div class="ev-filters" id="ev-filters">
                <button class="ev-filter-btn active" data-filter="all">All</button>
                <button class="ev-filter-btn" data-filter="error" style="--f-color:#ef4444"><span class="dot" style="background:#ef4444"></span> Critical</button>
                <button class="ev-filter-btn" data-filter="warn" style="--f-color:#f59e0b"><span class="dot" style="background:#f59e0b"></span> Warning</button>
                <button class="ev-filter-btn" data-filter="info" style="--f-color:#3b82f6"><span class="dot" style="background:#3b82f6"></span> Info</button>
              </div>
              <div class="ev-list" id="events-feed">
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

    // Event filter buttons
    this.querySelectorAll('.ev-filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.querySelectorAll('.ev-filter-btn').forEach(b => b.classList.remove('active'))
        btn.classList.add('active')
        this._eventFilter = (btn as HTMLElement).dataset.filter || 'all'
        this.renderEventsFeed()
      })
    })

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
    alertDialog({
      title: 'Not Yet Available',
      message: 'Pause reconciliation requires a PauseReconciliation RPC (not yet implemented).',
      icon: 'fa fa-pause-circle',
    })
  }

  private handleMaintenance() {
    // Stub — requires MaintenanceMode RPC (Phase 2)
    alertDialog({
      title: 'Not Yet Available',
      message: 'Maintenance mode requires a SetMaintenanceMode RPC (not yet implemented).',
      icon: 'fa fa-wrench',
    })
  }
}

customElements.define('page-dashboard', PageDashboard)
