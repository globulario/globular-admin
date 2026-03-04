// src/pages/admin_diagnostics.ts
import "@globular/components/markdown.js"
import '@polymer/iron-icons/iron-icons.js'
import '@polymer/paper-icon-button/paper-icon-button.js'
import '@polymer/iron-collapse/iron-collapse.js'
import {
  getClusterReport, type ClusterReport,
  getNodeReport, type NodeReport,
  getDriftReport, type DriftReport,
  explainFinding, type FindingExplanation, type Finding, type DriftItem,
  clusterdoctorpb,
} from '@globular/backend'

// ─── Constants ────────────────────────────────────────────────────────────────

const SEV_INFO     = 1
const SEV_WARN     = 2
const SEV_ERROR    = 3
const SEV_CRITICAL = 4

const ST_HEALTHY  = 1
const ST_DEGRADED = 2
const ST_CRITICAL = 3

const PLAN_SAFE      = 1
const PLAN_MODERATE  = 2
const PLAN_DANGEROUS = 3

const DRIFT_LABELS: Record<number, string> = {
  0: 'Unknown',
  1: 'Missing Unit',
  2: 'Unit Stopped',
  3: 'Unit Disabled',
  4: 'Version Mismatch',
  5: 'State Hash Mismatch',
  6: 'Endpoint Missing',
  7: 'Inv. Incomplete',
}

const POLL_INTERVAL = 15_000

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sevColor(s: number): string {
  if (s >= SEV_CRITICAL) return 'var(--error-color)'
  if (s >= SEV_ERROR)    return 'var(--error-color)'
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

function statusColor(s: number): string {
  if (s === ST_CRITICAL) return 'var(--error-color)'
  if (s === ST_DEGRADED) return '#f59e0b'
  if (s === ST_HEALTHY)  return 'var(--success-color)'
  return 'var(--secondary-text-color)'
}

function statusLabel(s: number): string {
  if (s === ST_CRITICAL) return 'CRITICAL'
  if (s === ST_DEGRADED) return 'DEGRADED'
  if (s === ST_HEALTHY)  return 'HEALTHY'
  return 'UNKNOWN'
}

function planRiskColor(r: number): string {
  if (r === PLAN_DANGEROUS) return 'var(--error-color)'
  if (r === PLAN_MODERATE)  return '#f59e0b'
  if (r === PLAN_SAFE)      return 'var(--success-color)'
  return 'var(--secondary-text-color)'
}

function planRiskLabel(r: number): string {
  if (r === PLAN_DANGEROUS) return 'DANGEROUS'
  if (r === PLAN_MODERATE)  return 'MODERATE'
  if (r === PLAN_SAFE)      return 'SAFE'
  return 'UNKNOWN'
}

function badge(label: string, color: string): string {
  return `<span class="md-badge" style="--badge-color:${color}">${label}</span>`
}

function esc(s: string): string {
  const d = document.createElement('div')
  d.textContent = s
  return d.innerHTML
}

function fmtTime(d: Date): string {
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function fmtDuration(sec: number): string {
  if (sec < 60) return `${sec}s`
  if (sec < 3600) return `${Math.floor(sec / 60)}m ${sec % 60}s`
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  return `${h}h ${m}m`
}

/** Extract a probable node ID from an entityRef like "node/abc123" */
function extractNodeId(entityRef: string): string | null {
  if (!entityRef) return null
  const m = entityRef.match(/^node\/(.+)$/)
  return m ? m[1] : null
}

// ─── Component ────────────────────────────────────────────────────────────────

class PageAdminDiagnostics extends HTMLElement {
  private _report: ClusterReport | null = null
  private _nodeReport: NodeReport | null = null
  private _drift: DriftReport | null = null
  private _explanation: FindingExplanation | null = null
  private _selectedFindingId = ''
  private _selectedNodeId = ''
  private _loading = true
  private _error = ''
  private _explainLoading = false
  private _explainError = ''
  private _nodeLoading = false
  private _nodeError = ''
  private _lastUpdated: Date | null = null
  private _refreshTimer: number | null = null

  connectedCallback() {
    this.style.display = 'block'
    this.innerHTML = `
      <style>
        .dx-header {
          display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
        }
        .dx-header h2 { margin: 0; }
        .dx-header .spacer { flex: 1; }
        .dx-subtitle {
          font: var(--md-typescale-body-medium);
          color: var(--secondary-text-color);
          margin: 0 0 16px;
        }
        .dx-timestamp {
          font: var(--md-typescale-label-small);
          color: var(--secondary-text-color);
        }
        .dx-summary {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 10px;
          margin-bottom: 12px;
        }
        @media(max-width:700px) {
          .dx-summary { grid-template-columns: 1fr 1fr; }
        }
        .dx-card {
          background: var(--md-surface-container-low);
          border: 1px solid var(--border-subtle-color);
          border-radius: var(--md-shape-md);
          box-shadow: var(--md-elevation-1);
          padding: 14px 18px;
        }
        .dx-card-label {
          font-size: .72rem; font-weight: 700;
          text-transform: uppercase; letter-spacing: .06em;
          color: var(--secondary-text-color); margin-bottom: 4px;
        }
        .dx-card-value { font-size: 1.8rem; font-weight: 800; line-height: 1; margin-bottom: 2px; }
        .dx-card-sub { font-size: .75rem; color: var(--secondary-text-color); margin-top: 2px; }
        .dx-btn {
          border: 1px solid var(--border-subtle-color);
          background: transparent; color: var(--on-surface-color);
          border-radius: var(--md-shape-sm);
          padding: 3px 10px; cursor: pointer; font-size: .78rem;
        }
        .dx-btn:hover { background: var(--md-state-hover); }
        .dx-btn-primary {
          border: 1px solid var(--accent-color);
          background: color-mix(in srgb, var(--accent-color) 10%, transparent);
          color: var(--accent-color);
          border-radius: var(--md-shape-sm);
          padding: 3px 10px; cursor: pointer; font-size: .78rem;
        }
        .dx-btn-primary:hover { background: color-mix(in srgb, var(--accent-color) 20%, transparent); }
        .dx-sev-group { margin-bottom: 16px; }
        .dx-sev-group-title {
          font-size: .72rem; font-weight: 700;
          text-transform: uppercase; letter-spacing: .08em;
          margin: 0 0 6px; padding: 0;
        }
        .dx-finding-row {
          display: grid;
          grid-template-columns: 80px 160px 1fr auto;
          gap: 8px; align-items: center;
          padding: 8px 12px;
          border-bottom: 1px solid var(--border-subtle-color);
          font-size: .85rem; cursor: pointer;
          transition: background .15s;
        }
        .dx-finding-row:hover { background: var(--md-state-hover); }
        .dx-finding-row.selected { background: color-mix(in srgb, var(--accent-color) 8%, transparent); }
        .dx-finding-inv { font-family: monospace; font-size: .78rem; }
        .dx-finding-summary { line-height: 1.4; }
        .dx-finding-entity {
          font-size: .75rem; color: var(--secondary-text-color);
          margin-top: 1px;
        }
        .dx-finding-entity-link {
          color: var(--accent-color); cursor: pointer; text-decoration: underline;
        }
        .dx-node-section {
          background: var(--md-surface-container-low);
          border: 1px solid var(--border-subtle-color);
          border-radius: var(--md-shape-md);
          box-shadow: var(--md-elevation-1);
          padding: 14px 18px; margin-bottom: 16px;
        }
        .dx-node-header {
          display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
          margin-bottom: 12px;
        }
        .dx-node-header h3 { margin: 0; font-size: 1rem; }
        .dx-cli {
          font-size: .8rem;
          background: color-mix(in srgb, var(--accent-color) 10%, transparent);
          padding: 2px 6px;
          border-radius: var(--md-shape-xs);
          display: inline-block; margin-top: 2px;
          word-break: break-all;
        }
        .dx-copy-btn {
          background: none; border: 1px solid var(--border-subtle-color);
          border-radius: var(--md-shape-xs);
          padding: 1px 6px; cursor: pointer; font-size: .78rem;
          margin-left: 4px; vertical-align: middle;
        }
        .dx-copy-btn:hover { background: var(--md-state-hover); }
        .dx-drift-table { width: 100%; border-collapse: collapse; font-size: .85rem; }
        .dx-drift-table th, .dx-drift-table td { padding: 6px 10px; text-align: left; }
        .dx-drift-table th {
          font-size: .72rem; font-weight: 700; text-transform: uppercase;
          letter-spacing: .06em; color: var(--secondary-text-color);
          border-bottom: 1px solid var(--border-subtle-color);
        }
        .dx-drift-table td { border-bottom: 1px solid color-mix(in srgb, var(--border-subtle-color) 50%, transparent); }
        .dx-empty {
          padding: 14px; font-size: .85rem; font-style: italic;
          color: var(--secondary-text-color);
        }
      </style>
      <section class="wrap">
        <header class="dx-header">
          <h2>Diagnostics</h2>
          <div class="spacer"></div>
          <span id="dxTimestamp" class="dx-timestamp"></span>
          <button id="dxRefresh" class="dx-btn">&#8635; Refresh</button>
          <paper-icon-button id="dxInfoBtn" icon="icons:info-outline" title="Page info"></paper-icon-button>
        </header>
        <p class="dx-subtitle">Cluster health diagnostics, severity-grouped findings, and operator triage tools.</p>

        <iron-collapse id="dxInfoPanel">
          <globular-markdown style="
            display: block; padding: 0 4px 12px;
            --divider-color: color-mix(in srgb, var(--on-surface-color) 12%, transparent);
          " id="dxDocs"></globular-markdown>
        </iron-collapse>

        <div id="dxBanners"></div>
        <div id="dxSummary"></div>
        <div id="dxNodeDrill"></div>
        <div id="dxFindings"></div>
        <div id="dxExplain"></div>
        <div id="dxDrift"></div>
      </section>
    `

    this.querySelector('#dxRefresh')?.addEventListener('click', () => this.load())
    this.querySelector('#dxInfoBtn')?.addEventListener('click', () => {
      (this.querySelector('#dxInfoPanel') as any)?.toggle()
    })
    this.renderDocs()
    this.load()
    this._refreshTimer = window.setInterval(() => this.load(), POLL_INTERVAL)
  }

  disconnectedCallback() {
    if (this._refreshTimer) clearInterval(this._refreshTimer)
  }

  // ─── Data loading ───────────────────────────────────────────────────────────

  private async load() {
    this._selectedFindingId = ''
    this._explanation = null
    this.renderExplain()

    const el = this.querySelector('#dxSummary') as HTMLElement
    if (this._loading && el) {
      el.innerHTML = `<p style="color:var(--secondary-text-color);font-size:.85rem">Loading diagnostics…</p>`
    }

    const [reportRes, driftRes] = await Promise.allSettled([
      getClusterReport(),
      getDriftReport(),
    ])

    this._report = reportRes.status === 'fulfilled' ? reportRes.value : null
    this._error = reportRes.status === 'rejected'
      ? ((reportRes.reason as any)?.message || 'ClusterDoctor unavailable') : ''

    this._drift = driftRes.status === 'fulfilled' ? driftRes.value : null

    this._loading = false
    this._lastUpdated = new Date()

    this.renderTimestamp()
    this.renderBanners()
    this.renderSummary()
    this.renderFindings()
    this.renderDrift()

    // If a node was selected, refresh it too
    if (this._selectedNodeId) {
      this.fetchNodeReport(this._selectedNodeId)
    }
  }

  // ─── Timestamp ──────────────────────────────────────────────────────────────

  private renderTimestamp() {
    const el = this.querySelector('#dxTimestamp') as HTMLElement
    if (!el) return
    el.textContent = this._lastUpdated ? `Last updated: ${fmtTime(this._lastUpdated)}` : ''
  }

  // ─── Banners ────────────────────────────────────────────────────────────────

  private renderBanners() {
    const el = this.querySelector('#dxBanners') as HTMLElement
    if (!el) return
    let html = ''
    if (this._error) html += `<div class="md-banner-warn" style="margin-bottom:8px">&#9888; ClusterDoctor — ${esc(this._error)}</div>`
    if (this._report?.dataIncomplete) html += `<div class="md-banner-warn" style="margin-bottom:8px">&#9888; Some upstream data sources failed; report may be partial.</div>`
    el.innerHTML = html
  }

  // ─── Summary cards ──────────────────────────────────────────────────────────

  private renderSummary() {
    const el = this.querySelector('#dxSummary') as HTMLElement
    if (!el) return

    const r = this._report
    if (!r) {
      el.innerHTML = this._error ? '' : `<p class="dx-empty">No cluster report available.</p>`
      return
    }

    const critCount = r.findings.filter(f => f.severity >= SEV_CRITICAL).length
    const warnCount = r.findings.filter(f => f.severity === SEV_WARN).length
    const errCount  = r.findings.filter(f => f.severity === SEV_ERROR).length
    const infoCount = r.findings.filter(f => f.severity === SEV_INFO).length

    // Derive node counts from findings
    const nodeIds = new Set<string>()
    const unreachableNodes = new Set<string>()
    for (const f of r.findings) {
      const nid = extractNodeId(f.entityRef)
      if (nid) {
        nodeIds.add(nid)
        if (f.summary.toLowerCase().includes('unreachable')) unreachableNodes.add(nid)
      }
    }
    const totalNodes = nodeIds.size
    const reachableNodes = totalNodes - unreachableNodes.size

    el.innerHTML = `
      <div class="dx-summary">
        <div class="dx-card">
          <div class="dx-card-label">Cluster Health</div>
          <div style="margin:6px 0">${badge(statusLabel(r.overallStatus), statusColor(r.overallStatus))}</div>
          <div class="dx-card-sub">${r.findings.length} finding${r.findings.length !== 1 ? 's' : ''}</div>
        </div>
        <div class="dx-card">
          <div class="dx-card-label">Nodes</div>
          <div class="dx-card-value" style="color:${unreachableNodes.size > 0 ? '#f59e0b' : 'var(--success-color)'}">${totalNodes > 0 ? `${reachableNodes}/${totalNodes}` : '—'}</div>
          <div class="dx-card-sub">${totalNodes > 0 ? 'reachable' : 'no node findings'}</div>
        </div>
        <div class="dx-card">
          <div class="dx-card-label">Data Completeness</div>
          <div class="dx-card-value" style="color:${r.dataIncomplete ? '#f59e0b' : 'var(--success-color)'}">${r.dataIncomplete ? '&#9888;' : '&#10003;'}</div>
          <div class="dx-card-sub">${r.dataIncomplete ? 'partial data' : 'all sources OK'}</div>
        </div>
        <div class="dx-card">
          <div class="dx-card-label">Findings</div>
          <div style="font-size:.85rem;line-height:1.7;margin-top:4px">
            ${critCount > 0 ? `<span style="color:var(--error-color);font-weight:700">${critCount} Critical</span><br>` : ''}
            ${errCount > 0 ? `<span style="color:var(--error-color)">${errCount} Error</span><br>` : ''}
            ${warnCount > 0 ? `<span style="color:#f59e0b">${warnCount} Warning</span><br>` : ''}
            ${infoCount > 0 ? `<span style="color:var(--secondary-text-color)">${infoCount} Info</span>` : ''}
            ${r.findings.length === 0 ? '<span style="color:var(--success-color)">None</span>' : ''}
          </div>
        </div>
      </div>
    `
  }

  // ─── Findings (grouped by severity) ─────────────────────────────────────────

  private renderFindings() {
    const el = this.querySelector('#dxFindings') as HTMLElement
    if (!el) return

    const r = this._report
    if (!r || r.findings.length === 0) {
      el.innerHTML = r
        ? `<div class="md-panel"><div class="md-panel-header"><span>Findings</span></div><p class="dx-empty">&#10003; No active findings — cluster is healthy.</p></div>`
        : ''
      return
    }

    // Group by severity (descending)
    const groups: { sev: number; label: string; color: string; findings: Finding[] }[] = [
      { sev: SEV_CRITICAL, label: 'Critical', color: 'var(--error-color)', findings: [] },
      { sev: SEV_ERROR,    label: 'Error',    color: 'var(--error-color)', findings: [] },
      { sev: SEV_WARN,     label: 'Warning',  color: '#f59e0b',           findings: [] },
      { sev: SEV_INFO,     label: 'Info',      color: 'var(--secondary-text-color)', findings: [] },
    ]

    for (const f of r.findings) {
      const g = groups.find(g => g.sev === f.severity) ?? groups[groups.length - 1]
      g.findings.push(f)
    }

    let html = `
      <div class="md-panel">
        <div class="md-panel-header">
          <span>Findings (${r.findings.length})</span>
        </div>
    `

    for (const g of groups) {
      if (g.findings.length === 0) continue
      html += `
        <div class="dx-sev-group">
          <p class="dx-sev-group-title" style="color:${g.color};padding:8px 12px 0">${g.label} (${g.findings.length})</p>
          ${g.findings.map(f => {
            const nodeId = extractNodeId(f.entityRef)
            const entityHtml = nodeId
              ? `<span class="dx-finding-entity-link" data-node="${esc(nodeId)}">${esc(f.entityRef)}</span>`
              : `<span>${esc(f.entityRef || '—')}</span>`
            return `
            <div class="dx-finding-row${f.findingId === this._selectedFindingId ? ' selected' : ''}" data-fid="${esc(f.findingId)}">
              <div>${badge(sevLabel(f.severity), sevColor(f.severity))}</div>
              <div>
                <div class="dx-finding-inv">${esc(f.invariantId)}</div>
                <div class="dx-finding-entity">${entityHtml}</div>
              </div>
              <div class="dx-finding-summary">${esc(f.summary)}</div>
              <div><button class="dx-btn dx-explain-btn" data-fid="${esc(f.findingId)}">Explain</button></div>
            </div>`
          }).join('')}
        </div>
      `
    }

    html += `</div>`
    el.innerHTML = html

    // Explain button clicks
    el.querySelectorAll<HTMLButtonElement>('.dx-explain-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation()
        const fid = btn.dataset.fid ?? ''
        if (this._selectedFindingId === fid) {
          this._selectedFindingId = ''
          this._explanation = null
          this.renderExplain()
          this.renderFindings()
        } else {
          this._selectedFindingId = fid
          this.renderFindings()
          this.fetchExplain(fid)
        }
      })
    })

    // Finding row clicks (also trigger explain)
    el.querySelectorAll<HTMLElement>('.dx-finding-row').forEach(row => {
      row.addEventListener('click', () => {
        const fid = row.dataset.fid ?? ''
        if (this._selectedFindingId === fid) {
          this._selectedFindingId = ''
          this._explanation = null
          this.renderExplain()
          this.renderFindings()
        } else {
          this._selectedFindingId = fid
          this.renderFindings()
          this.fetchExplain(fid)
        }
      })
    })

    // Node drill-down links
    el.querySelectorAll<HTMLElement>('.dx-finding-entity-link').forEach(link => {
      link.addEventListener('click', (e) => {
        e.stopPropagation()
        const nodeId = (link as HTMLElement).dataset.node ?? ''
        if (nodeId) {
          this._selectedNodeId = nodeId
          this.fetchNodeReport(nodeId)
        }
      })
    })
  }

  // ─── Explain panel ──────────────────────────────────────────────────────────

  private async fetchExplain(findingId: string) {
    this._explainLoading = true
    this._explainError = ''
    this._explanation = null
    this.renderExplain()

    try {
      this._explanation = await explainFinding(findingId)
    } catch (e: any) {
      this._explainError = e?.message || 'Explanation unavailable'
    }
    this._explainLoading = false
    this.renderExplain()
  }

  private renderExplain() {
    const el = this.querySelector('#dxExplain') as HTMLElement
    if (!el) return

    if (!this._selectedFindingId) { el.innerHTML = ''; return }

    if (this._explainLoading) {
      el.innerHTML = `
        <div style="background:var(--md-surface-container-low);border:1px solid var(--border-subtle-color);border-radius:var(--md-shape-md);box-shadow:var(--md-elevation-1);padding:14px 18px;margin-bottom:16px;font-size:.85rem;color:var(--secondary-text-color)">
          Fetching explanation…
        </div>`
      return
    }

    if (this._explainError) {
      el.innerHTML = `<div class="md-banner-warn" style="margin-bottom:16px">&#9888; Could not explain finding — ${esc(this._explainError)}</div>`
      return
    }

    const x = this._explanation!
    const steps = x.remediation

    el.innerHTML = `
      <div style="background:var(--md-surface-container-low);border:1px solid var(--border-subtle-color);border-radius:var(--md-shape-md);box-shadow:var(--md-elevation-1);overflow:hidden;margin-bottom:16px">
        <div style="padding:10px 14px;font:var(--md-typescale-label-medium);text-transform:uppercase;letter-spacing:.06em;color:var(--secondary-text-color);background:var(--md-surface-container);border-bottom:1px solid var(--border-subtle-color);display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:6px">
          <span>Finding Explanation — <code style="font-size:.82rem;text-transform:none">${esc(x.invariantId)}</code></span>
          <span>Plan risk: ${badge(planRiskLabel(x.planRisk), planRiskColor(x.planRisk))}</span>
        </div>
        <div style="padding:14px 18px">
          ${x.whyFailed ? `<p style="margin:0 0 14px;font-size:.88rem;line-height:1.65">${esc(x.whyFailed)}</p>` : ''}

          ${x.evidence.length > 0 ? `
          <p style="font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--secondary-text-color);margin:0 0 6px">Evidence</p>
          <ul style="margin:0 0 14px;padding-left:1.4em;font-size:.85rem;line-height:1.7">
            ${x.evidence.map(ev => `
            <li>
              <strong>${esc(ev.sourceService)}</strong> / ${esc(ev.sourceRpc)}
              ${Object.keys(ev.keyValues).length > 0 ? `<br><span style="font-size:.78rem;color:var(--secondary-text-color)">${Object.entries(ev.keyValues).map(([k, v]) => `${esc(k)}=${esc(v)}`).join(', ')}</span>` : ''}
            </li>`).join('')}
          </ul>` : ''}

          ${steps.length > 0 ? `
          <p style="font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--secondary-text-color);margin:0 0 6px">Remediation Steps</p>
          <ol style="margin:0 0 14px;padding-left:1.4em;font-size:.85rem;line-height:1.7">
            ${steps.map(s => `
            <li>
              ${esc(s.description)}
              ${s.cliCommand ? `<br><code class="dx-cli">${esc(s.cliCommand)}</code><button class="dx-copy-btn" data-cmd="${esc(s.cliCommand)}" title="Copy to clipboard">&#128203;</button>` : ''}
            </li>`).join('')}
          </ol>` : ''}

          ${x.planDiff.length > 0 ? `
          <p style="font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--secondary-text-color);margin:0 0 6px">Plan Diff</p>
          <pre style="font-size:.78rem;background:color-mix(in srgb,var(--accent-color) 6%,transparent);border:1px solid var(--border-subtle-color);border-radius:var(--md-shape-sm);padding:10px 12px;overflow-x:auto;margin:0;white-space:pre-wrap">${x.planDiff.map(l => esc(l)).join('\n')}</pre>` : ''}
        </div>
      </div>
    `

    // Copy button handlers
    el.querySelectorAll<HTMLButtonElement>('.dx-copy-btn').forEach(btn =>
      btn.addEventListener('click', () => {
        navigator.clipboard.writeText(btn.dataset.cmd ?? '')
        btn.textContent = '\u2713'
        setTimeout(() => btn.textContent = '\u{1F4CB}', 1500)
      })
    )
  }

  // ─── Node drill-down ────────────────────────────────────────────────────────

  private async fetchNodeReport(nodeId: string) {
    this._nodeLoading = true
    this._nodeError = ''
    this._nodeReport = null
    this.renderNodeDrill()

    try {
      this._nodeReport = await getNodeReport(nodeId)
    } catch (e: any) {
      this._nodeError = e?.message || 'Node report unavailable'
    }
    this._nodeLoading = false
    this.renderNodeDrill()
  }

  private renderNodeDrill() {
    const el = this.querySelector('#dxNodeDrill') as HTMLElement
    if (!el) return

    if (!this._selectedNodeId) { el.innerHTML = ''; return }

    if (this._nodeLoading) {
      el.innerHTML = `
        <div class="dx-node-section">
          <p style="color:var(--secondary-text-color);font-size:.85rem;margin:0">Loading node report for <code>${esc(this._selectedNodeId)}</code>…</p>
        </div>`
      return
    }

    if (this._nodeError) {
      el.innerHTML = `
        <div class="dx-node-section">
          <div class="dx-node-header">
            <h3>Node: ${esc(this._selectedNodeId)}</h3>
            <div style="flex:1"></div>
            <button class="dx-btn" id="dxBackToCluster">&#8592; Back to Cluster</button>
          </div>
          <div class="md-banner-warn">&#9888; ${esc(this._nodeError)}</div>
        </div>`
      el.querySelector('#dxBackToCluster')?.addEventListener('click', () => this.clearNodeSelection())
      return
    }

    const nr = this._nodeReport!
    const hbAge = nr.heartbeatAgeSeconds

    let findingsHtml = ''
    if (nr.findings.length > 0) {
      findingsHtml = nr.findings.map(f => `
        <div class="dx-finding-row" style="cursor:default">
          <div>${badge(sevLabel(f.severity), sevColor(f.severity))}</div>
          <div>
            <div class="dx-finding-inv">${esc(f.invariantId)}</div>
          </div>
          <div class="dx-finding-summary">${esc(f.summary)}</div>
          <div></div>
        </div>
      `).join('')
    } else {
      findingsHtml = `<p class="dx-empty">&#10003; No findings for this node.</p>`
    }

    el.innerHTML = `
      <div class="dx-node-section">
        <div class="dx-node-header">
          <h3>Node: <code>${esc(nr.nodeId)}</code></h3>
          ${badge(nr.reachable ? 'REACHABLE' : 'UNREACHABLE', nr.reachable ? 'var(--success-color)' : 'var(--error-color)')}
          <span style="font-size:.78rem;color:var(--secondary-text-color)">Heartbeat: ${hbAge > 0 ? fmtDuration(hbAge) + ' ago' : 'recent'}</span>
          <div style="flex:1"></div>
          <button class="dx-btn" id="dxBackToCluster">&#8592; Back to Cluster</button>
        </div>
        ${nr.dataIncomplete ? `<div class="md-banner-warn" style="margin-bottom:8px">&#9888; Node data may be incomplete.</div>` : ''}
        <p style="font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--secondary-text-color);margin:0 0 6px">Node Findings (${nr.findings.length})</p>
        ${findingsHtml}
      </div>
    `

    el.querySelector('#dxBackToCluster')?.addEventListener('click', () => this.clearNodeSelection())
  }

  private clearNodeSelection() {
    this._selectedNodeId = ''
    this._nodeReport = null
    this._nodeError = ''
    this.renderNodeDrill()
  }

  // ─── Drift section ──────────────────────────────────────────────────────────

  private renderDrift() {
    const el = this.querySelector('#dxDrift') as HTMLElement
    if (!el) return

    const d = this._drift
    if (!d || d.items.length === 0) {
      el.innerHTML = d
        ? `<div class="md-panel"><div class="md-panel-header"><span>Drift Analysis</span></div><p class="dx-empty">&#10003; No drift detected.</p></div>`
        : ''
      return
    }

    el.innerHTML = `
      <div class="md-panel" style="margin-top:8px">
        <div class="md-panel-header">
          <span>Drift Analysis (${d.totalDriftCount} item${d.totalDriftCount !== 1 ? 's' : ''})</span>
        </div>
        ${d.dataIncomplete ? `<div class="md-banner-warn" style="margin:8px 12px 0">&#9888; Drift data may be incomplete.</div>` : ''}
        <div style="overflow-x:auto">
          <table class="dx-drift-table">
            <thead>
              <tr>
                <th>Node</th>
                <th>Entity</th>
                <th>Category</th>
                <th>Desired</th>
                <th>Actual</th>
              </tr>
            </thead>
            <tbody>
              ${d.items.map((item: DriftItem) => `
              <tr>
                <td style="font-family:monospace;font-size:.78rem">${esc(item.nodeId)}</td>
                <td>${esc(item.entityRef)}</td>
                <td>${esc(DRIFT_LABELS[item.category] ?? String(item.category))}</td>
                <td style="font-size:.8rem;color:var(--success-color)">${esc(item.desired || '—')}</td>
                <td style="font-size:.8rem;color:var(--error-color)">${esc(item.actual || '—')}</td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `
  }

  // ─── Docs ───────────────────────────────────────────────────────────────────

  private renderDocs() {
    const md = this.querySelector('#dxDocs') as HTMLElement
    if (!md) return
    md.textContent = `
# Diagnostics

The Diagnostics page runs the **Cluster Doctor** service to detect, explain, and remediate cluster issues.

## Severity Levels

| Level | Meaning |
|---|---|
| **Critical** | The cluster cannot serve traffic or is losing data. Immediate action required. |
| **Error** | A component has failed but the cluster is partially functional. |
| **Warning** | A potential problem detected. May degrade to Error if not addressed. |
| **Info** | Informational finding. No action required. |

## Findings

Each finding represents a violated **invariant** — a condition the cluster should satisfy. Click **Explain** to see:
- **Why Failed** — root-cause analysis
- **Evidence** — the data sources and values that triggered the finding
- **Remediation** — ordered steps with CLI commands you can copy to clipboard
- **Plan Risk** — whether the fix is safe, moderate, or dangerous
- **Plan Diff** — what configuration changes would be applied

## Node Drill-Down

Click a node reference (e.g. \`node/abc123\`) in any finding to see that node's health, heartbeat age, and node-scoped findings.

## Drift Analysis

Drift items show where a node's actual state differs from the desired state (missing services, stopped units, version mismatches, etc.).

## Auto-Refresh

The page polls every 15 seconds. Click **Refresh** for an immediate update.
`.trim()
  }
}

customElements.define('page-admin-diagnostics', PageAdminDiagnostics)
