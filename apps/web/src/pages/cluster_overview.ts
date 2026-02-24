// src/pages/cluster_overview.ts
import '../widgets/network_config'
import "@globular/components/markdown.js"
import '@polymer/iron-icons/iron-icons.js'
import '@polymer/paper-icon-button/paper-icon-button.js'
import {
  getClusterReport, type ClusterReport, type Finding,
  getClusterHealth, type ClusterHealth,
  listClusterNodes,
  getDriftReport, type DriftReport,
  explainFinding, type FindingExplanation,
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

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
  return `<span style="display:inline-block;padding:2px 8px;border-radius:999px;font-size:.72rem;font-weight:700;letter-spacing:.04em;text-transform:uppercase;background:color-mix(in srgb,${color} 15%,transparent);color:${color};border:1px solid color-mix(in srgb,${color} 35%,transparent)">${label}</span>`
}

// ─── Component ────────────────────────────────────────────────────────────────

class PageClusterOverview extends HTMLElement {
  private _report: ClusterReport | null = null
  private _health: ClusterHealth | null = null
  private _drift: DriftReport | null = null
  private _incompleteNodes = 0

  private _reportError = ''
  private _healthError = ''
  private _driftError  = ''
  private _loading = true

  private _selectedFindingId = ''
  private _explanation: FindingExplanation | null = null
  private _explainLoading = false
  private _explainError = ''

  private _refreshTimer: number | null = null

  connectedCallback() {
    this.style.display = 'block'
    this.innerHTML = `
      <section class="wrap">
        <header class="header">
          <h2>Cluster Overview</h2>
          <div class="spacer"></div>
          <paper-icon-button id="infoBtn" icon="icons:info-outline" title="Page info"></paper-icon-button>
        </header>
        <p class="subtitle">Cluster health diagnostics, drift analysis, and operational intelligence.</p>

        <div id="doctor"></div>
        <div id="explain"></div>

        <network-config></network-config>
        <div id="docs" class="docs" hidden></div>
      </section>
    `

    this.querySelector('#infoBtn')?.addEventListener('click', () => {
      const d = this.querySelector('#docs') as HTMLElement
      if (!d) return
      d.hasAttribute('hidden') ? d.removeAttribute('hidden') : d.setAttribute('hidden', '')
    })

    this.renderDocs()
    this.load()
    this._refreshTimer = window.setInterval(() => this.load(), 60_000)
  }

  disconnectedCallback() {
    if (this._refreshTimer) clearInterval(this._refreshTimer)
  }

  // ─── Data loading ───────────────────────────────────────────────────────────

  private async load() {
    this._selectedFindingId = ''
    this._explanation = null
    this.renderExplain()

    const [reportRes, healthRes, driftRes, nodesRes] = await Promise.allSettled([
      getClusterReport(),
      getClusterHealth(),
      getDriftReport(),
      listClusterNodes(),
    ])

    this._report = reportRes.status === 'fulfilled' ? reportRes.value : null
    this._reportError = reportRes.status === 'rejected'
      ? ((reportRes.reason as any)?.message || 'ClusterDoctor unavailable') : ''

    this._health = healthRes.status === 'fulfilled' ? healthRes.value : null
    this._healthError = healthRes.status === 'rejected'
      ? ((healthRes.reason as any)?.message || 'ClusterController unavailable') : ''

    this._drift = driftRes.status === 'fulfilled' ? driftRes.value : null
    this._driftError = driftRes.status === 'rejected'
      ? ((driftRes.reason as any)?.message || 'Drift data unavailable') : ''

    this._incompleteNodes = nodesRes.status === 'fulfilled'
      ? nodesRes.value.filter(n => !n.inventoryComplete).length : 0

    this._loading = false
    this.renderDoctor()
  }

  // ─── Doctor panel ───────────────────────────────────────────────────────────

  private renderDoctor() {
    const el = this.querySelector('#doctor') as HTMLElement
    if (!el) return

    if (this._loading) {
      el.innerHTML = `<p style="color:var(--secondary-text-color);font-size:.85rem;margin-bottom:16px">Loading health diagnostics…</p>`
      return
    }

    const r = this._report
    const h = this._health
    const d = this._drift

    const criticalCount = r ? r.findings.filter((f: Finding) => f.severity === SEV_CRITICAL).length : 0
    const errorCount    = r ? r.findings.filter((f: Finding) => f.severity === SEV_ERROR).length : 0
    const warnCount     = r ? r.findings.filter((f: Finding) => f.severity === SEV_WARN).length : 0
    const sc = statusColor(r?.overallStatus ?? 0)
    const sl = statusLabel(r?.overallStatus ?? 0)

    // Drift breakdown: top 3 categories by count
    const driftByCategory: Record<number, number> = {}
    if (d) {
      for (const item of d.items) {
        driftByCategory[item.category] = (driftByCategory[item.category] ?? 0) + 1
      }
    }
    const topCategories = Object.entries(driftByCategory)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 3)

    const affectedNodes = d ? new Set(d.items.map(i => i.nodeId)).size : 0
    const topFindings   = r ? r.findings.slice(0, 8) : []

    el.innerHTML = `
      <style>
        .ov-section-label {
          font-size: .72rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: .08em;
          color: var(--secondary-text-color);
          margin: 0 0 6px;
        }
        .ov-row-status {
          display: grid;
          grid-template-columns: auto 1fr 1fr 1fr;
          gap: 10px;
          margin-bottom: 10px;
        }
        .ov-row-nodes {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 10px;
          margin-bottom: 10px;
        }
        .ov-row-drift {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 10px;
          margin-bottom: 16px;
        }
        @media(max-width:700px) {
          .ov-row-status, .ov-row-nodes { grid-template-columns: 1fr 1fr; }
          .ov-row-drift { grid-template-columns: 1fr; }
        }
        .ov-card {
          background: var(--surface-color);
          border: 1px solid var(--border-subtle-color);
          border-radius: 12px;
          padding: 14px 18px;
        }
        .ov-card-label {
          font-size: .72rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: .06em;
          color: var(--secondary-text-color);
          margin-bottom: 4px;
        }
        .ov-card-value { font-size: 1.8rem; font-weight: 800; line-height: 1; margin-bottom: 2px; }
        .ov-card-sub   { font-size: .75rem; color: var(--secondary-text-color); margin-top: 2px; }
        .ov-status-card {
          background: var(--surface-color);
          border: 1px solid var(--border-subtle-color);
          border-radius: 12px;
          padding: 14px 18px;
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .ov-panel {
          background: var(--surface-color);
          border: 1px solid var(--border-subtle-color);
          border-radius: 12px;
          overflow: hidden;
          margin-bottom: 16px;
        }
        .ov-panel-hdr {
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
        .ov-table { width: 100%; border-collapse: collapse; font-size: .84rem; }
        .ov-table th {
          text-align: left;
          padding: 8px 12px;
          font-size: .71rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: .06em;
          color: var(--secondary-text-color);
          border-bottom: 1px solid var(--border-subtle-color);
        }
        .ov-table td { padding: 8px 12px; border-bottom: 1px solid var(--border-subtle-color); vertical-align: middle; }
        .ov-table tr:last-child td { border-bottom: none; }
        .ov-table tbody tr[data-fid] { cursor: pointer; }
        .ov-table tbody tr[data-fid]:hover td { background: color-mix(in srgb,var(--primary-color) 5%,transparent); }
        .ov-table tbody tr[data-fid].selected td { background: color-mix(in srgb,var(--primary-color) 10%,transparent); }
        .ov-empty { padding: 14px; font-size: .85rem; font-style: italic; color: var(--secondary-text-color); }
        .ov-btn {
          border: 1px solid var(--border-subtle-color);
          background: transparent;
          color: var(--on-surface-color);
          border-radius: 6px;
          padding: 3px 10px;
          cursor: pointer;
          font-size: .78rem;
        }
        .ov-warn {
          background: color-mix(in srgb,#f59e0b 10%,transparent);
          border: 1px solid color-mix(in srgb,#f59e0b 35%,transparent);
          border-radius: 8px;
          padding: 10px 14px;
          font-size: .83rem;
          color: #b45309;
          margin-bottom: 10px;
          line-height: 1.5;
        }
        [data-theme="dark"] .ov-warn { color: #fbbf24; }
        .ov-drift-cats { font-size: .76rem; color: var(--secondary-text-color); margin-top: 8px; display: flex; flex-wrap: wrap; gap: 6px; }
        .ov-drift-cats span { white-space: nowrap; }
        .ov-incomplete-note { font-size: .72rem; color: #b45309; margin-top: 4px; }
        [data-theme="dark"] .ov-incomplete-note { color: #fbbf24; }
      </style>

      ${this._reportError ? `<div class="ov-warn">⚠ ClusterDoctor — ${this._reportError}</div>` : ''}
      ${this._healthError ? `<div class="ov-warn">⚠ ClusterController — ${this._healthError}</div>` : ''}
      ${this._driftError  ? `<div class="ov-warn">⚠ Drift report — ${this._driftError}</div>` : ''}
      ${r?.dataIncomplete ? `<div class="ov-warn">⚠ Some data sources were unavailable — report may be incomplete.</div>` : ''}

      <!-- Cluster status -->
      <p class="ov-section-label">Cluster Status</p>
      <div class="ov-row-status">
        <div class="ov-status-card">
          <span class="ov-card-label">Overall</span>
          ${badge(sl, sc)}
          <span class="ov-card-sub">${r ? `${r.findings.length} finding${r.findings.length !== 1 ? 's' : ''}` : 'No data'}</span>
        </div>
        <div class="ov-card">
          <div class="ov-card-label">Critical</div>
          <div class="ov-card-value" style="color:${criticalCount > 0 ? 'var(--error-color)' : 'var(--secondary-text-color)'}">${criticalCount}</div>
        </div>
        <div class="ov-card">
          <div class="ov-card-label">Errors</div>
          <div class="ov-card-value" style="color:${errorCount > 0 ? '#f59e0b' : 'var(--secondary-text-color)'}">${errorCount}</div>
        </div>
        <div class="ov-card">
          <div class="ov-card-label">Warnings</div>
          <div class="ov-card-value" style="color:${warnCount > 0 ? '#f59e0b' : 'var(--secondary-text-color)'}">${warnCount}</div>
        </div>
      </div>

      <!-- Node health -->
      <p class="ov-section-label">Nodes</p>
      <div class="ov-row-nodes">
        <div class="ov-card">
          <div class="ov-card-label">Healthy</div>
          <div class="ov-card-value" style="color:${h && h.healthyNodes > 0 ? 'var(--success-color)' : 'var(--secondary-text-color)'}">${h ? h.healthyNodes : '—'}</div>
          <div class="ov-card-sub">of ${h ? h.totalNodes : '?'} total</div>
        </div>
        <div class="ov-card">
          <div class="ov-card-label">Degraded</div>
          <div class="ov-card-value" style="color:${h && h.unhealthyNodes > 0 ? '#f59e0b' : 'var(--secondary-text-color)'}">${h ? h.unhealthyNodes : '—'}</div>
        </div>
        <div class="ov-card">
          <div class="ov-card-label">Unknown</div>
          <div class="ov-card-value" style="color:${h && h.unknownNodes > 0 ? 'var(--error-color)' : 'var(--secondary-text-color)'}">${h ? h.unknownNodes : '—'}</div>
        </div>
        <div class="ov-card">
          <div class="ov-card-label">Inv. Incomplete</div>
          <div class="ov-card-value" style="color:${this._incompleteNodes > 0 ? '#f59e0b' : 'var(--secondary-text-color)'}">${this._incompleteNodes}</div>
          ${this._incompleteNodes > 0 ? `<div class="ov-incomplete-note">inventory pending</div>` : '<div class="ov-card-sub">all complete</div>'}
        </div>
      </div>

      <!-- Drift -->
      <p class="ov-section-label">Drift</p>
      <div class="ov-row-drift">
        <div class="ov-card">
          <div class="ov-card-label">Total Drift Items</div>
          <div class="ov-card-value" style="color:${d && d.totalDriftCount > 0 ? '#f59e0b' : 'var(--secondary-text-color)'}">${d ? d.totalDriftCount : '—'}</div>
          ${topCategories.length > 0 ? `
          <div class="ov-drift-cats">
            ${topCategories.map(([cat, cnt]) => `<span>${DRIFT_LABELS[Number(cat)] ?? cat} <strong>${cnt}</strong></span>`).join('')}
          </div>` : d ? '<div class="ov-card-sub">no drift detected</div>' : ''}
        </div>
        <div class="ov-card">
          <div class="ov-card-label">Affected Nodes</div>
          <div class="ov-card-value" style="color:${affectedNodes > 0 ? '#f59e0b' : 'var(--secondary-text-color)'}">${d ? affectedNodes : '—'}</div>
          <div class="ov-card-sub">${d ? 'with drifted services' : 'unavailable'}</div>
        </div>
      </div>

      <!-- Findings table -->
      <div class="ov-panel">
        <div class="ov-panel-hdr">
          <span>Top Findings${r ? ` (${r.findings.length})` : ''}</span>
          <button class="ov-btn" id="btnRefresh">↻ Refresh</button>
        </div>
        ${topFindings.length > 0 ? `
        <table class="ov-table">
          <thead>
            <tr>
              <th>Severity</th>
              <th>Invariant</th>
              <th>Category</th>
              <th>Entity</th>
              <th>Summary</th>
            </tr>
          </thead>
          <tbody>
            ${topFindings.map((f: Finding) => `
            <tr data-fid="${f.findingId}" class="${f.findingId === this._selectedFindingId ? 'selected' : ''}" title="Click to explain">
              <td>${badge(sevLabel(f.severity), sevColor(f.severity))}</td>
              <td style="font-family:monospace;font-size:.78rem">${f.invariantId}</td>
              <td style="color:var(--secondary-text-color);font-size:.8rem">${f.category || '—'}</td>
              <td style="color:var(--secondary-text-color)">${f.entityRef || '—'}</td>
              <td>${f.summary}</td>
            </tr>`).join('')}
          </tbody>
        </table>
        ` : r
          ? `<p class="ov-empty">✓ No active findings — cluster is healthy.</p>`
          : `<p class="ov-empty">ClusterDoctor data unavailable.</p>`
        }
      </div>
    `

    el.querySelector('#btnRefresh')?.addEventListener('click', () => this.load())

    el.querySelectorAll<HTMLElement>('.ov-table tbody tr[data-fid]').forEach(tr => {
      tr.addEventListener('click', () => {
        const fid = tr.dataset.fid ?? ''
        if (this._selectedFindingId === fid) {
          // toggle off
          this._selectedFindingId = ''
          this._explanation = null
          tr.classList.remove('selected')
          this.renderExplain()
        } else {
          el.querySelectorAll('.ov-table tbody tr.selected').forEach(r => r.classList.remove('selected'))
          tr.classList.add('selected')
          this._selectedFindingId = fid
          this.fetchExplain(fid)
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
    const el = this.querySelector('#explain') as HTMLElement
    if (!el) return

    if (!this._selectedFindingId) { el.innerHTML = ''; return }

    if (this._explainLoading) {
      el.innerHTML = `
        <div style="background:var(--surface-color);border:1px solid var(--border-subtle-color);border-radius:12px;padding:14px 18px;margin-bottom:16px;font-size:.85rem;color:var(--secondary-text-color)">
          Fetching explanation…
        </div>`
      return
    }

    if (this._explainError) {
      el.innerHTML = `<div class="ov-warn" style="margin-bottom:16px">⚠ Could not explain finding — ${this._explainError}</div>`
      return
    }

    const x = this._explanation!
    const steps = x.remediation

    el.innerHTML = `
      <div style="background:var(--surface-color);border:1px solid var(--border-subtle-color);border-radius:12px;overflow:hidden;margin-bottom:16px">
        <div style="padding:10px 14px;font-size:.75rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--secondary-text-color);border-bottom:1px solid var(--border-subtle-color);display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:6px">
          <span>Finding Explanation — <code style="font-size:.82rem;text-transform:none">${x.invariantId}</code></span>
          <span>Plan risk: ${badge(planRiskLabel(x.planRisk), planRiskColor(x.planRisk))}</span>
        </div>
        <div style="padding:14px 18px">
          ${x.whyFailed ? `<p style="margin:0 0 14px;font-size:.88rem;line-height:1.65">${x.whyFailed}</p>` : ''}

          ${steps.length > 0 ? `
          <p style="font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--secondary-text-color);margin:0 0 6px">Remediation Steps</p>
          <ol style="margin:0 0 14px;padding-left:1.4em;font-size:.85rem;line-height:1.7">
            ${steps.map(s => `
            <li>
              ${s.description}
              ${s.cliCommand ? `<br><code style="font-size:.8rem;background:color-mix(in srgb,var(--primary-color) 8%,transparent);padding:2px 6px;border-radius:4px;display:inline-block;margin-top:2px">${s.cliCommand}</code>` : ''}
            </li>`).join('')}
          </ol>` : ''}

          ${x.planDiff.length > 0 ? `
          <p style="font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--secondary-text-color);margin:0 0 6px">Plan Diff</p>
          <pre style="font-size:.78rem;background:color-mix(in srgb,var(--primary-color) 5%,transparent);border:1px solid var(--border-subtle-color);border-radius:6px;padding:10px 12px;overflow-x:auto;margin:0;white-space:pre-wrap">${x.planDiff.join('\n')}</pre>` : ''}
        </div>
      </div>
    `
  }

  // ─── Docs ───────────────────────────────────────────────────────────────────

  private renderDocs() {
    const docsBox = this.querySelector('#docs') as HTMLElement
    if (!docsBox) return
    docsBox.innerHTML = ''
    const md = document.createElement('globular-markdown') as HTMLElement
    md.textContent = `
# Cluster Overview

Live health diagnostics across ClusterDoctor, ClusterController, and drift analysis.

## What's shown

- **Overall Status** — HEALTHY / DEGRADED / CRITICAL from ClusterDoctor
- **Finding counts** — Critical, Error, Warning breakdown
- **Node health** — healthy / degraded / unknown counts from ClusterController
- **Inventory incomplete** — nodes whose inventory collection is pending
- **Drift** — total drifted items and affected node count, with top category breakdown
- **Top Findings** — click any row to see a full explanation: root cause, plan risk, and remediation steps

Data refreshes automatically every 60 seconds and on demand via ↻ Refresh.

## What requires new backend RPCs

- **Pending operations / reconciliation state** — needs a new RPC on ClusterController
- **Failing deployments** — needs \`GetApplicationDeploymentStatus\`
- **Certificates expiring < 30d** — needs a cert monitoring RPC
- **Live event stream** — needs \`QueryEvents\` implementation
- **Quick controls** (reconcile, pause, maintenance) — needs dedicated RPCs

## Network configuration

Edit the network settings for this node: hostname, DNS servers, and network interfaces.
`.trim()
    docsBox.appendChild(md)
  }
}

customElements.define('page-cluster-overview', PageClusterOverview)
