// src/pages/cluster_nodes.ts
import {
  listClusterNodes,
  setNodeProfiles,
  getNodeReport,
  getNodeHealthDetail,
  clusterdoctorpb,
  type ClusterNode,
  type NodeReport,
  type Finding,
  type NodeCapabilities,
  type NodeHealthDetail,
  type NodeHealthCheck,
} from '@globular/sdk'

function fmtBytes(bytes: number): string {
  if (!bytes) return '—'
  if (bytes >= 1e12) return `${(bytes / 1e12).toFixed(1)} TB`
  if (bytes >= 1e9)  return `${(bytes / 1e9).toFixed(1)} GB`
  if (bytes >= 1e6)  return `${(bytes / 1e6).toFixed(0)} MB`
  return `${bytes} B`
}

function profileTags(profiles: string[]): string {
  if (!profiles.length) return '<span style="color:var(--secondary-text-color)">—</span>'
  return profiles.map(p => `<span class="md-chip md-chip-tonal" style="margin-right:3px">${p}</span>`).join('')
}

function capsLine(caps: NodeCapabilities | null): string {
  if (!caps || caps.cpuCount === 0) return '<span style="color:var(--secondary-text-color)">—</span>'
  const diskPct = caps.diskBytes > 0 ? Math.round((1 - caps.diskFreeBytes / caps.diskBytes) * 100) : 0
  return `
    <div style="display:flex;flex-wrap:wrap;gap:14px;font-size:.82rem;color:var(--on-surface-color)">
      <span><strong>${caps.cpuCount}</strong> CPU${caps.cpuCount !== 1 ? 's' : ''}</span>
      <span><strong>${fmtBytes(caps.ramBytes)}</strong> RAM</span>
      <span>
        <strong>${fmtBytes(caps.diskBytes)}</strong> disk
        <span style="display:inline-block;width:48px;height:5px;background:var(--border-subtle-color);
          border-radius:3px;overflow:hidden;vertical-align:middle;margin:0 4px;">
          <span style="display:block;height:100%;width:${diskPct}%;border-radius:3px;
            background:color-mix(in srgb,var(--accent-color) 60%,transparent);"></span>
        </span>
        ${fmtBytes(caps.diskFreeBytes)} free
      </span>
    </div>`
}

const SEV_INFO     = 1
const SEV_WARN     = 2
const SEV_ERROR    = 3
const SEV_CRITICAL = 4

function sevColor(s: number): string {
  if (s >= SEV_CRITICAL) return 'var(--error-color)'
  if (s >= SEV_ERROR)    return '#f59e0b'
  if (s >= SEV_WARN)     return '#f59e0b'
  return 'var(--secondary-text-color)'
}

function sevLabel(s: number): string {
  if (s >= SEV_CRITICAL) return 'CRITICAL'
  if (s >= SEV_ERROR)    return 'ERROR'
  if (s >= SEV_WARN)     return 'WARN'
  if (s >= SEV_INFO)     return 'INFO'
  return 'UNKNOWN'
}

function badge(label: string, color: string): string {
  return `<span class="md-badge" style="--badge-color:${color}">${label}</span>`
}

function ageLabel(seconds: number): string {
  if (!seconds) return '—'
  if (seconds < 60)   return `${seconds}s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`
  return `${Math.floor(seconds / 3600)}h`
}

function worstSeverity(findings: Finding[]): number {
  return findings.reduce((max, f) => Math.max(max, f.severity), 0)
}

function isActiveInvariant(status: number): boolean {
  const enumObj = (clusterdoctorpb as any)?.InvariantStatus ?? {}
  const name = String(enumObj?.[status] ?? '').toUpperCase()
  if (name.includes('PASS') || name.includes('OK') || name.includes('SATISF')) return false
  return true
}

function activeFindings(findings: Finding[]): Finding[] {
  return findings.filter(f => isActiveInvariant(Number(f.invariantStatus ?? 0)))
}

function statusBadge(status: string): string {
  const color =
    status === 'ready'      ? 'var(--success-color)' :
    status === 'converging' ? '#f59e0b' :
    status === 'degraded'   ? '#f97316' :
    status === 'unhealthy'  ? 'var(--error-color)' :
                              'var(--secondary-text-color)'
  return badge(status.toUpperCase(), color)
}

// ─── Component ────────────────────────────────────────────────────────────────

interface NodeRow {
  node:   ClusterNode
  report: NodeReport | null
  error:  string
}

class PageClusterNodes extends HTMLElement {
  private _rows: NodeRow[] = []
  private _selectedNodeId = ''
  private _refreshTimer: number | null = null
  private _editingProfiles = false
  private _savingProfiles  = false
  private _saveError       = ''
  private _healthDetail: NodeHealthDetail | null = null
  private _healthLoading   = false
  private _healthError     = ''

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  connectedCallback() {
    this.style.display = 'block'
    this._buildShell()
    this._fetchData()
    this._refreshTimer = window.setInterval(() => this._fetchData(), 30_000)
  }

  disconnectedCallback() {
    if (this._refreshTimer) clearInterval(this._refreshTimer)
  }

  // ── Shell — built ONCE, never rebuilt ─────────────────────────────────────

  private _buildShell() {
    this.innerHTML = `
      <style>
        .cn-wrap { padding: 16px; }
        .cn-header { display: flex; align-items: center; gap: 12px; margin-bottom: 4px; }
        .cn-header h2 { margin: 0; font: var(--md-typescale-headline-small); }
        .cn-subtitle { margin: 0.25rem 0 1rem; opacity: .85; font: var(--md-typescale-body-medium); }
        .cn-node-id  { font-family: monospace; font-size: .78rem; color: var(--secondary-text-color); }
        .cn-hostname { font-weight: 600; }
        .cn-empty    { padding: 14px; font: var(--md-typescale-body-medium); font-style: italic; color: var(--secondary-text-color); }
        .cn-btn-refresh {
          border: 1px solid var(--border-subtle-color); background: transparent;
          color: var(--on-surface-color); border-radius: var(--md-shape-sm);
          padding: 3px 10px; cursor: pointer; font: var(--md-typescale-label-medium);
        }
        .cn-btn-refresh:hover { background: var(--md-state-hover); }
        .cn-detail-panel {
          background: var(--md-surface-container-low); border: 1px solid var(--border-subtle-color);
          border-radius: var(--md-shape-md); box-shadow: var(--md-elevation-1);
          overflow: hidden; margin-bottom: 16px;
        }
        .cn-kv-list { font-size: .75rem; font-family: monospace; color: var(--secondary-text-color); }
        .cn-section-label {
          font-size: .72rem; font-weight: 700; text-transform: uppercase;
          letter-spacing: .06em; color: var(--secondary-text-color);
          padding: 8px 14px; background: var(--md-surface-container);
          border-bottom: 1px solid var(--border-subtle-color);
        }
        .cn-check-icon { display: inline-block; width: 14px; text-align: center; font-weight: 700; }
        .cn-check-ok   { color: var(--success-color); }
        .cn-check-fail { color: var(--error-color); }
      </style>

      <div class="cn-wrap">
        <div class="cn-header">
          <h2>Cluster Nodes</h2>
          <div style="flex:1"></div>
          <button class="cn-btn-refresh" id="cn-refresh">↻ Refresh</button>
        </div>
        <p class="cn-subtitle">Node inventory, health status, and diagnostic findings from ClusterDoctor.</p>

        <div id="cn-error" class="md-banner-warn" style="display:none"></div>

        <div class="md-panel">
          <div class="md-panel-header">
            <span id="cn-count">Nodes</span>
          </div>
          <table class="md-table">
            <thead>
              <tr>
                <th>Hostname</th>
                <th>Profiles</th>
                <th>Node ID</th>
                <th>Reachable</th>
                <th>Heartbeat Age</th>
                <th>Findings</th>
                <th>Worst Severity</th>
              </tr>
            </thead>
            <tbody id="cn-tbody" class="md-interactive">
              <tr id="cn-loading"><td colspan="7" class="cn-empty">Loading nodes…</td></tr>
            </tbody>
          </table>
        </div>

        <div id="cn-detail"></div>
      </div>`

    this.querySelector('#cn-refresh')!.addEventListener('click', () => this._fetchData())
  }

  // ── Data fetch — runs on every refresh tick ────────────────────────────────

  private async _fetchData() {
    let nodes: ClusterNode[]
    try {
      nodes = await listClusterNodes()
      this._hideError()
    } catch (e: any) {
      this._showError(e?.message || 'ClusterController unavailable')
      return
    }

    // Sync row structure: add new nodes, remove gone nodes.
    // Existing rows keep their current data until fresh reports arrive.
    this._syncRows(nodes)

    // Fetch each node's report independently; push data into slots on arrival.
    nodes.forEach((node, i) => {
      getNodeReport(node.nodeId)
        .then(report => {
          this._rows[i].report = report
          this._rows[i].error  = ''
          this._pushReportToRow(node.nodeId)
        })
        .catch(e => {
          this._rows[i].error = (e as any)?.message || 'Doctor unavailable'
          this._pushReportToRow(node.nodeId)
        })
    })
  }

  // ── Row structure sync — only structural changes, never touches data cells ─

  private _syncRows(newNodes: ClusterNode[]) {
    const tbody   = this.querySelector('#cn-tbody')!
    const loading = this.querySelector('#cn-loading')
    if (loading) loading.remove()

    const newIds = new Set(newNodes.map(n => n.nodeId))

    // Remove rows for nodes that left the cluster.
    this._rows
      .filter(r => !newIds.has(r.node.nodeId))
      .forEach(r => tbody.querySelector(`tr[data-node-id="${CSS.escape(r.node.nodeId)}"]`)?.remove())

    // Rebuild model (keeps existing report data for nodes still present).
    const prevReports = new Map(this._rows.map(r => [r.node.nodeId, r]))
    this._rows = newNodes.map(node => {
      const prev = prevReports.get(node.nodeId)
      return { node, report: prev?.report ?? null, error: prev?.error ?? '' }
    })

    // Update node count.
    const countEl = this.querySelector('#cn-count')
    if (countEl) countEl.textContent = `Nodes (${newNodes.length})`

    // Add rows for nodes not yet in the table.
    newNodes.forEach(node => {
      if (!tbody.querySelector(`tr[data-node-id="${CSS.escape(node.nodeId)}"]`)) {
        tbody.appendChild(this._createRow(node))
      } else {
        // Update only the profiles cell — everything else is data-driven.
        const profileSlot = tbody.querySelector(
          `tr[data-node-id="${CSS.escape(node.nodeId)}"] [data-bind="profiles"]`
        ) as HTMLElement | null
        if (profileSlot) profileSlot.innerHTML = profileTags(node.profiles)
      }
    })
  }

  // Creates a new <tr> with named data-bind slots. Called once per new node.
  private _createRow(node: ClusterNode): HTMLTableRowElement {
    const pending = `<span style="color:var(--secondary-text-color)">…</span>`
    const tr      = document.createElement('tr')
    tr.dataset.nodeId = node.nodeId
    if (node.nodeId === this._selectedNodeId) tr.classList.add('selected')
    tr.innerHTML = `
      <td class="cn-hostname">${node.hostname || node.nodeId}</td>
      <td data-bind="profiles">${profileTags(node.profiles)}</td>
      <td class="cn-node-id">${node.nodeId}</td>
      <td data-bind="reachable">${pending}</td>
      <td data-bind="age" style="color:var(--secondary-text-color)">…</td>
      <td data-bind="findings">${pending}</td>
      <td data-bind="severity">${pending}</td>`
    tr.addEventListener('click', () => this._onRowClick(node.nodeId))
    return tr
  }

  // ── Data push — writes report data into existing slots ────────────────────

  private _pushReportToRow(nodeId: string) {
    const row = this._rows.find(r => r.node.nodeId === nodeId)
    if (!row) return

    const tr = this.querySelector(`tr[data-node-id="${CSS.escape(nodeId)}"]`) as HTMLElement | null
    if (!tr) return

    const set = (bind: string, html: string) => {
      const el = tr.querySelector(`[data-bind="${bind}"]`) as HTMLElement | null
      if (el) el.innerHTML = html
    }

    const r      = row.report
    const wSev   = r ? worstSeverity(r.findings) : 0
    const fCount = r ? r.findings.length : 0

    set('reachable', r
      ? badge(r.reachable ? 'REACHABLE' : 'UNREACHABLE', r.reachable ? 'var(--success-color)' : 'var(--error-color)')
      : row.error ? badge('UNAVAIL', 'var(--secondary-text-color)') : `<span style="color:var(--secondary-text-color)">…</span>`)

    set('age', r
      ? ageLabel(r.heartbeatAgeSeconds)
      : row.error ? '—' : '…')

    set('findings', r
      ? (fCount > 0 ? `<span style="font-weight:600">${fCount}</span>` : `<span style="color:var(--secondary-text-color)">0</span>`)
      : row.error ? '—' : `<span style="color:var(--secondary-text-color)">…</span>`)

    set('severity', r
      ? (wSev > 0 ? badge(sevLabel(wSev), sevColor(wSev)) : `<span style="color:var(--success-color)">✓ OK</span>`)
      : row.error ? `<span style="color:var(--secondary-text-color)">${row.error}</span>` : `<span style="color:var(--secondary-text-color)">…</span>`)

    // If this node's detail panel is open, refresh it with the new report.
    if (nodeId === this._selectedNodeId && (r || row.error)) {
      this._renderDetail()
    }
  }

  // ── Row selection ──────────────────────────────────────────────────────────

  private _onRowClick(nodeId: string) {
    if (this._selectedNodeId === nodeId) {
      this._selectedNodeId = ''
      this._healthDetail   = null
    } else {
      this._selectedNodeId = nodeId
      this._loadHealthDetail(nodeId)
    }
    this._editingProfiles = false
    this._saveError       = ''
    this._renderDetail()
    this.querySelectorAll('#cn-tbody tr[data-node-id]').forEach(r =>
      r.classList.toggle('selected', (r as HTMLElement).dataset.nodeId === this._selectedNodeId)
    )
  }

  // ── Health detail ──────────────────────────────────────────────────────────

  private async _loadHealthDetail(nodeId: string) {
    this._healthLoading = true
    this._healthError   = ''
    this._healthDetail  = null
    this._renderDetail()
    try {
      this._healthDetail = await getNodeHealthDetail(nodeId)
    } catch (e: any) {
      this._healthError = e?.message || 'Health detail unavailable'
    }
    this._healthLoading = false
    this._renderDetail()
  }

  // ── Detail panel — rebuilt only on explicit row click or health arrival ────

  private _renderDetail() {
    const el = this.querySelector('#cn-detail') as HTMLElement
    if (!el) return

    if (!this._selectedNodeId) { el.innerHTML = ''; return }

    const row = this._rows.find(r => r.node.nodeId === this._selectedNodeId)
    if (!row) { el.innerHTML = ''; return }

    const r       = row.report
    const rActive = r ? activeFindings(r.findings) : []

    if (!r) {
      el.innerHTML = `
        <div class="md-panel">
          <div class="md-panel-header"><span>Findings — ${row.node.hostname || this._selectedNodeId}</span></div>
          <p class="cn-empty">${row.error ? `ClusterDoctor unavailable: ${row.error}` : 'Loading…'}</p>
        </div>`
      return
    }

    const profilesSection = this._editingProfiles
      ? `<form id="profileEditForm" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
           <input id="profileInput" type="text"
             value="${row.node.profiles.join(', ')}"
             placeholder="core, control-plane, storage, gateway"
             style="flex:1;min-width:200px;padding:4px 8px;border:1px solid var(--border-subtle-color);border-radius:6px;background:var(--surface-color);color:var(--on-surface-color);font-size:.84rem;">
           <button type="submit" style="padding:3px 10px;border-radius:6px;border:none;background:var(--accent-color);color:#fff;font-size:.78rem;cursor:pointer;${this._savingProfiles ? 'opacity:.6;' : ''}">
             ${this._savingProfiles ? 'Saving…' : 'Save'}
           </button>
           <button type="button" id="btnCancelProfiles" style="padding:3px 10px;border-radius:6px;border:1px solid var(--border-subtle-color);background:transparent;color:var(--on-surface-color);font-size:.78rem;cursor:pointer;">
             Cancel
           </button>
           ${this._saveError ? `<span style="font-size:.78rem;color:var(--error-color)">${this._saveError}</span>` : ''}
         </form>`
      : `${profileTags(row.node.profiles)}
         <button id="btnEditProfiles" style="margin-left:8px;padding:2px 8px;border-radius:6px;border:1px solid var(--border-subtle-color);background:transparent;color:var(--secondary-text-color);font-size:.72rem;cursor:pointer;">Edit</button>`

    const hd = this._healthDetail
    const healthSection = this._healthLoading
      ? `<div class="cn-section-label">Health Checks</div><p class="cn-empty">Loading health detail…</p>`
      : this._healthError
        ? `<div class="cn-section-label">Health Checks</div><p class="cn-empty">Could not load health detail: ${this._healthError}</p>`
        : hd ? `
           <div class="cn-section-label">
             Health Checks — ${statusBadge(hd.overallStatus)}
             ${hd.inventoryComplete ? '' : '<span style="color:#f59e0b;font-size:.72rem;font-weight:400"> (inventory incomplete)</span>'}
           </div>
           <table class="md-table"><thead><tr><th></th><th>Subsystem</th><th>Status</th><th>Reason</th></tr></thead>
           <tbody>
             ${hd.checks.map((c: NodeHealthCheck) => {
               const stale = !c.ok && c.reason.toLowerCase().includes('hash_drift') &&
                 !rActive.some(f => f.summary.toLowerCase().includes('hash_drift'))
               return `<tr>
                 <td><span class="cn-check-icon ${c.ok || stale ? 'cn-check-ok' : 'cn-check-fail'}">${c.ok || stale ? '✓' : '✕'}</span></td>
                 <td style="font-family:monospace;font-size:.78rem">${c.subsystem}</td>
                 <td>${c.ok || stale ? badge('OK', 'var(--success-color)') : badge('FAIL', 'var(--error-color)')}</td>
                 <td style="font-size:.82rem;color:var(--secondary-text-color)">${stale ? 'stale hash_drift (current findings are clean)' : c.reason || '—'}</td>
               </tr>`
             }).join('')}
           </tbody></table>` : ''

    el.innerHTML = `
      <div class="cn-detail-panel">
        <div class="md-panel-header">
          <span>Findings — ${row.node.hostname || this._selectedNodeId}</span>
          <span style="font-size:.78rem;font-weight:400">${rActive.length} finding${rActive.length !== 1 ? 's' : ''} · heartbeat ${ageLabel(r.heartbeatAgeSeconds)} ago</span>
        </div>
        <div style="padding:12px 14px;display:flex;flex-direction:column;gap:10px;border-bottom:1px solid var(--border-subtle-color);">
          <div style="display:flex;align-items:baseline;gap:12px;font-size:.83rem;">
            <span style="min-width:80px;font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--secondary-text-color);">Profiles</span>
            ${profilesSection}
          </div>
          <div style="display:flex;align-items:baseline;gap:12px;font-size:.83rem;">
            <span style="min-width:80px;font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--secondary-text-color);">Hardware</span>
            ${capsLine(row.node.capabilities)}
          </div>
        </div>
        ${healthSection}
        ${rActive.length > 0 ? `
        <div class="cn-section-label">Diagnostic Findings</div>
        <table class="md-table">
          <thead><tr><th>Severity</th><th>Invariant</th><th>Summary</th><th>Evidence</th></tr></thead>
          <tbody>
            ${rActive.map((f: Finding) => {
              const kv = f.evidence.length > 0 ? f.evidence[0].keyValues : {}
              const kvPairs = Object.entries(kv).slice(0, 4).map(([k, v]) => `${k}=${v}`).join(' ')
              return `<tr>
                <td>${badge(sevLabel(f.severity), sevColor(f.severity))}</td>
                <td style="font-family:monospace;font-size:.78rem">${f.invariantId}</td>
                <td>${f.summary}</td>
                <td class="cn-kv-list">${kvPairs || '—'}</td>
              </tr>`
            }).join('')}
          </tbody>
        </table>` : `<p class="cn-empty">✓ No findings for this node.</p>`}
      </div>`

    el.querySelector('#btnEditProfiles')?.addEventListener('click', () => {
      this._editingProfiles = true; this._saveError = ''; this._renderDetail()
    })
    el.querySelector('#btnCancelProfiles')?.addEventListener('click', () => {
      this._editingProfiles = false; this._saveError = ''; this._renderDetail()
    })
    el.querySelector('#profileEditForm')?.addEventListener('submit', async e => {
      e.preventDefault()
      const input    = (el.querySelector('#profileInput') as HTMLInputElement)?.value ?? ''
      const profiles = input.split(',').map(s => s.trim()).filter(Boolean)
      this._savingProfiles = true; this._saveError = ''; this._renderDetail()
      try {
        await setNodeProfiles(this._selectedNodeId, profiles)
        this._savingProfiles  = false
        this._editingProfiles = false
        const rowIdx = this._rows.findIndex(r => r.node.nodeId === this._selectedNodeId)
        if (rowIdx >= 0) {
          this._rows[rowIdx].node.profiles = profiles
          // Update the profiles slot in the table row directly — no full rebuild.
          const profileSlot = this.querySelector(
            `tr[data-node-id="${CSS.escape(this._selectedNodeId)}"] [data-bind="profiles"]`
          ) as HTMLElement | null
          if (profileSlot) profileSlot.innerHTML = profileTags(profiles)
        }
        this._renderDetail()
      } catch (err: any) {
        this._savingProfiles = false
        this._saveError      = err?.message || 'Failed to save profiles'
        this._renderDetail()
      }
    })
  }

  // ── Error banner helpers ───────────────────────────────────────────────────

  private _showError(msg: string) {
    const el = this.querySelector('#cn-error') as HTMLElement | null
    if (!el) return
    el.style.display = ''
    el.innerHTML = `${msg}<br><span style="font-size:.8em;opacity:.8">Ensure <code>cluster_controller.ClusterControllerService</code> is reachable.</span>`
  }

  private _hideError() {
    const el = this.querySelector('#cn-error') as HTMLElement | null
    if (el) el.style.display = 'none'
  }
}

customElements.define('page-cluster-nodes', PageClusterNodes)
