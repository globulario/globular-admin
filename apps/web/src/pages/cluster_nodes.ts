// src/pages/cluster_nodes.ts
import { listClusterNodes, getNodeReport, type ClusterNode, type NodeReport, type Finding } from '@globular/backend'

// ─── Severity constants (numeric, from generated proto enums) ────────────────

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
  return `<span style="display:inline-block;padding:2px 8px;border-radius:999px;font-size:.72rem;font-weight:700;letter-spacing:.04em;text-transform:uppercase;background:color-mix(in srgb,${color} 15%,transparent);color:${color};border:1px solid color-mix(in srgb,${color} 35%,transparent)">${label}</span>`
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

// ─── Component ────────────────────────────────────────────────────────────────

interface NodeRow {
  node: ClusterNode
  report: NodeReport | null
  error: string
}

class PageClusterNodes extends HTMLElement {
  private _rows: NodeRow[] = []
  private _loadError = ''
  private _loading = true
  private _selectedNodeId = ''
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

    // Fetch doctor reports concurrently for all nodes
    const results = await Promise.allSettled(
      nodes.map(n => getNodeReport(n.nodeId))
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
    this.innerHTML = `
      <style>
        .cn-wrap { padding: 16px; }
        .cn-header { display: flex; align-items: center; gap: 12px; margin-bottom: 4px; }
        .cn-header h2 { margin: 0; font-size: 1.25rem; font-weight: 800; }
        .cn-subtitle { margin: 0.25rem 0 1rem; opacity: .85; font-size: .88rem; }
        .cn-panel {
          background: var(--surface-color);
          border: 1px solid var(--border-subtle-color);
          border-radius: 12px;
          overflow: hidden;
          margin-bottom: 16px;
        }
        .cn-panel-header {
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
        .cn-table { width: 100%; border-collapse: collapse; font-size: .84rem; }
        .cn-table th {
          text-align: left;
          padding: 8px 12px;
          font-size: .71rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: .06em;
          color: var(--secondary-text-color);
          border-bottom: 1px solid var(--border-subtle-color);
        }
        .cn-table td { padding: 9px 12px; border-bottom: 1px solid var(--border-subtle-color); vertical-align: middle; }
        .cn-table tr:last-child td { border-bottom: none; }
        .cn-table tbody tr { cursor: pointer; }
        .cn-table tbody tr:hover td { background: color-mix(in srgb, var(--primary-color) 5%, transparent); }
        .cn-table tbody tr.selected td { background: color-mix(in srgb, var(--primary-color) 10%, transparent); }
        .cn-node-id { font-family: monospace; font-size: .78rem; color: var(--secondary-text-color); }
        .cn-hostname { font-weight: 600; }
        .cn-empty { padding: 14px; font-size: .85rem; font-style: italic; color: var(--secondary-text-color); }
        .cn-btn-refresh {
          border: 1px solid var(--border-subtle-color);
          background: transparent;
          color: var(--on-surface-color);
          border-radius: 6px;
          padding: 3px 10px;
          cursor: pointer;
          font-size: .78rem;
        }
        .cn-detail-panel {
          background: var(--surface-color);
          border: 1px solid var(--border-subtle-color);
          border-radius: 12px;
          overflow: hidden;
          margin-bottom: 16px;
        }
        .cn-findings-table { width: 100%; border-collapse: collapse; font-size: .83rem; }
        .cn-findings-table th {
          text-align: left;
          padding: 7px 12px;
          font-size: .71rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: .06em;
          color: var(--secondary-text-color);
          border-bottom: 1px solid var(--border-subtle-color);
        }
        .cn-findings-table td { padding: 8px 12px; border-bottom: 1px solid var(--border-subtle-color); vertical-align: middle; }
        .cn-findings-table tr:last-child td { border-bottom: none; }
        .cn-kv-list { font-size: .75rem; font-family: monospace; color: var(--secondary-text-color); }
        .cn-warn-banner {
          background: color-mix(in srgb, #f59e0b 10%, transparent);
          border: 1px solid color-mix(in srgb, #f59e0b 35%, transparent);
          border-radius: 8px;
          padding: 12px 16px;
          font-size: .85rem;
          color: #b45309;
          margin-bottom: 16px;
          line-height: 1.6;
        }
        [data-theme="dark"] .cn-warn-banner { color: #fbbf24; }
      </style>

      <div class="cn-wrap">
        <div class="cn-header">
          <h2>Cluster Nodes</h2>
          <div style="flex:1"></div>
          <button class="cn-btn-refresh" id="btnRefresh">↻ Refresh</button>
        </div>
        <p class="cn-subtitle">Node inventory, health status, and diagnostic findings from ClusterDoctor.</p>

        ${this._loading ? `<p class="cn-empty">Loading nodes…</p>` : ''}

        ${this._loadError ? `
        <div class="cn-warn-banner">
          ⚠ Could not load nodes — ${this._loadError}
          <br><span style="font-size:.8em;opacity:.8">Ensure <code>clustercontroller.ClusterControllerService</code> is reachable.</span>
        </div>
        ` : ''}

        ${!this._loading && !this._loadError ? `
        <div class="cn-panel">
          <div class="cn-panel-header">
            <span>Nodes (${this._rows.length})</span>
          </div>
          ${this._rows.length > 0 ? `
          <table class="cn-table">
            <thead>
              <tr>
                <th>Hostname</th>
                <th>Node ID</th>
                <th>Reachable</th>
                <th>Heartbeat Age</th>
                <th>Findings</th>
                <th>Worst Severity</th>
              </tr>
            </thead>
            <tbody>
              ${this._rows.map(row => {
                const r = row.report
                const wSev = r ? worstSeverity(r.findings) : 0
                const findingCount = r ? r.findings.length : 0
                const selected = row.node.nodeId === this._selectedNodeId
                return `
                <tr data-node-id="${row.node.nodeId}" class="${selected ? 'selected' : ''}">
                  <td class="cn-hostname">${row.node.hostname || row.node.nodeId}</td>
                  <td class="cn-node-id">${row.node.nodeId}</td>
                  <td>${r
                    ? badge(r.reachable ? 'REACHABLE' : 'UNREACHABLE', r.reachable ? 'var(--success-color)' : 'var(--error-color)')
                    : badge('UNKNOWN', 'var(--secondary-text-color)')
                  }</td>
                  <td style="color:var(--secondary-text-color)">${r ? ageLabel(r.heartbeatAgeSeconds) : '—'}</td>
                  <td>${findingCount > 0
                    ? `<span style="font-weight:600">${findingCount}</span>`
                    : `<span style="color:var(--secondary-text-color)">0</span>`
                  }</td>
                  <td>${wSev > 0
                    ? badge(sevLabel(wSev), sevColor(wSev))
                    : `<span style="color:var(--success-color)">✓ OK</span>`
                  }</td>
                </tr>`
              }).join('')}
            </tbody>
          </table>
          ` : `<p class="cn-empty">No nodes registered.</p>`}
        </div>
        ` : ''}

        <div id="detail"></div>
      </div>
    `

    this.querySelector('#btnRefresh')?.addEventListener('click', () => this.load())

    // Row click → show findings detail
    this.querySelectorAll('.cn-table tbody tr[data-node-id]').forEach(tr => {
      tr.addEventListener('click', () => {
        const nodeId = (tr as HTMLElement).dataset.nodeId ?? ''
        this._selectedNodeId = this._selectedNodeId === nodeId ? '' : nodeId
        this.renderDetail()
        // Update selected highlight without full re-render
        this.querySelectorAll('.cn-table tbody tr[data-node-id]').forEach(r => {
          r.classList.toggle('selected', (r as HTMLElement).dataset.nodeId === this._selectedNodeId)
        })
      })
    })

    this.renderDetail()
  }

  private renderDetail() {
    const el = this.querySelector('#detail') as HTMLElement
    if (!el) return

    if (!this._selectedNodeId) {
      el.innerHTML = ''
      return
    }

    const row = this._rows.find(r => r.node.nodeId === this._selectedNodeId)
    if (!row) { el.innerHTML = ''; return }

    const r = row.report
    if (!r) {
      el.innerHTML = `
        <div class="cn-panel">
          <div class="cn-panel-header"><span>Findings — ${row.node.hostname || this._selectedNodeId}</span></div>
          <p class="cn-empty">ClusterDoctor unavailable for this node: ${row.error}</p>
        </div>`
      return
    }

    el.innerHTML = `
      <div class="cn-detail-panel">
        <div class="cn-panel-header">
          <span>Findings — ${row.node.hostname || this._selectedNodeId}</span>
          <span style="font-size:.78rem;font-weight:400">${r.findings.length} finding${r.findings.length !== 1 ? 's' : ''} · heartbeat ${ageLabel(r.heartbeatAgeSeconds)} ago</span>
        </div>
        ${r.findings.length > 0 ? `
        <table class="cn-findings-table">
          <thead>
            <tr>
              <th>Severity</th>
              <th>Invariant</th>
              <th>Summary</th>
              <th>Evidence</th>
            </tr>
          </thead>
          <tbody>
            ${r.findings.map((f: Finding) => {
              const kv = f.evidence.length > 0 ? f.evidence[0].keyValues : {}
              const kvPairs = Object.entries(kv).slice(0, 4).map(([k, v]) => `${k}=${v}`).join(' ')
              return `
              <tr>
                <td>${badge(sevLabel(f.severity), sevColor(f.severity))}</td>
                <td style="font-family:monospace;font-size:.78rem">${f.invariantId}</td>
                <td>${f.summary}</td>
                <td class="cn-kv-list">${kvPairs || '—'}</td>
              </tr>`
            }).join('')}
          </tbody>
        </table>
        ` : `<p class="cn-empty">✓ No findings for this node.</p>`}
      </div>
    `
  }
}

customElements.define('page-cluster-nodes', PageClusterNodes)
