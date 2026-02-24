// src/pages/cluster_overview.ts
import '../widgets/network_config'
import "@globular/components/markdown.js"
import '@polymer/iron-icons/iron-icons.js'
import '@polymer/paper-icon-button/paper-icon-button.js'
import { getClusterReport, type ClusterReport, type Finding } from '@globular/backend'

// ─── Severity / status constants (numeric, from the generated proto enums) ───

const SEV_INFO     = 1
const SEV_WARN     = 2
const SEV_ERROR    = 3
const SEV_CRITICAL = 4

const ST_HEALTHY  = 1
const ST_DEGRADED = 2
const ST_CRITICAL = 3

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

function badge(label: string, color: string): string {
  return `<span style="display:inline-block;padding:2px 8px;border-radius:999px;font-size:.72rem;font-weight:700;letter-spacing:.04em;text-transform:uppercase;background:color-mix(in srgb,${color} 15%,transparent);color:${color};border:1px solid color-mix(in srgb,${color} 35%,transparent)">${label}</span>`
}

// ─── Component ────────────────────────────────────────────────────────────────

class PageClusterOverview extends HTMLElement {
  private _report: ClusterReport | null = null
  private _error = ''
  private _loading = true
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

        <p class="subtitle">Cluster health diagnostics, network configuration, and operational intelligence.</p>

        <!-- Doctor health summary (updated dynamically) -->
        <div id="doctor"></div>

        <network-config></network-config>

        <div id="docs" class="docs" hidden></div>
      </section>
    `

    this.querySelector('#infoBtn')?.addEventListener('click', () => {
      const d = this.querySelector('#docs') as HTMLElement
      if (!d) return
      if (d.hasAttribute('hidden')) d.removeAttribute('hidden')
      else d.setAttribute('hidden', '')
    })
    this.renderDocs()
    this.load()
    this._refreshTimer = window.setInterval(() => this.load(), 60_000)
  }

  disconnectedCallback() {
    if (this._refreshTimer) clearInterval(this._refreshTimer)
  }

  private async load() {
    try {
      this._report = await getClusterReport()
      this._error = ''
    } catch (e: any) {
      this._error = e?.message || 'ClusterDoctor service unavailable'
    }
    this._loading = false
    this.renderDoctor()
  }

  private renderDoctor() {
    const el = this.querySelector('#doctor') as HTMLElement
    if (!el) return

    if (this._loading) {
      el.innerHTML = `<p style="color:var(--secondary-text-color);font-size:.85rem;margin-bottom:16px">Loading health diagnostics…</p>`
      return
    }

    if (this._error) {
      el.innerHTML = `
        <div style="background:color-mix(in srgb,#f59e0b 10%,transparent);border:1px solid color-mix(in srgb,#f59e0b 35%,transparent);border-radius:8px;padding:12px 16px;font-size:.85rem;color:#b45309;margin-bottom:16px;line-height:1.6">
          ⚠ ClusterDoctor service not reachable — ${this._error}
          <br><span style="font-size:.8em;opacity:.8">Ensure <code>clusterdoctor.ClusterDoctorService</code> is registered in the Envoy routing.</span>
        </div>`
      return
    }

    const r = this._report!
    const criticalCount = r.findings.filter((f: Finding) => f.severity === SEV_CRITICAL).length
    const errorCount    = r.findings.filter((f: Finding) => f.severity === SEV_ERROR).length
    const warnCount     = r.findings.filter((f: Finding) => f.severity === SEV_WARN).length
    const sc = statusColor(r.overallStatus)
    const sl = statusLabel(r.overallStatus)
    const topFindings = r.findings.slice(0, 5)

    el.innerHTML = `
      <style>
        .ov-stat-grid {
          display: grid;
          grid-template-columns: auto 1fr 1fr 1fr;
          gap: 12px;
          margin-bottom: 14px;
        }
        @media(max-width: 600px) { .ov-stat-grid { grid-template-columns: 1fr 1fr; } }
        .ov-status-card {
          background: var(--surface-color);
          border: 1px solid var(--border-subtle-color);
          border-radius: 12px;
          padding: 16px 20px;
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .ov-stat-card {
          background: var(--surface-color);
          border: 1px solid var(--border-subtle-color);
          border-radius: 12px;
          padding: 14px 18px;
        }
        .ov-stat-label {
          font-size: .72rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: .06em;
          color: var(--secondary-text-color);
          margin-bottom: 4px;
        }
        .ov-stat-value { font-size: 1.8rem; font-weight: 800; line-height: 1; }
        .ov-findings-panel {
          background: var(--surface-color);
          border: 1px solid var(--border-subtle-color);
          border-radius: 12px;
          overflow: hidden;
          margin-bottom: 16px;
        }
        .ov-panel-header {
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
        .ov-table tr:hover td { background: color-mix(in srgb, var(--primary-color) 5%, transparent); }
        .ov-empty { padding: 14px; font-size: .85rem; font-style: italic; color: var(--secondary-text-color); }
        .ov-btn-refresh {
          border: 1px solid var(--border-subtle-color);
          background: transparent;
          color: var(--on-surface-color);
          border-radius: 6px;
          padding: 3px 10px;
          cursor: pointer;
          font-size: .78rem;
        }
      </style>

      <div class="ov-stat-grid">
        <div class="ov-status-card">
          <span class="ov-stat-label">Overall Status</span>
          ${badge(sl, sc)}
          <span style="font-size:.78rem;color:var(--secondary-text-color)">${r.findings.length} finding${r.findings.length !== 1 ? 's' : ''}</span>
        </div>
        <div class="ov-stat-card">
          <div class="ov-stat-label">Critical</div>
          <div class="ov-stat-value" style="color:${criticalCount > 0 ? 'var(--error-color)' : 'var(--secondary-text-color)'}">${criticalCount}</div>
        </div>
        <div class="ov-stat-card">
          <div class="ov-stat-label">Errors</div>
          <div class="ov-stat-value" style="color:${errorCount > 0 ? '#f59e0b' : 'var(--secondary-text-color)'}">${errorCount}</div>
        </div>
        <div class="ov-stat-card">
          <div class="ov-stat-label">Warnings</div>
          <div class="ov-stat-value" style="color:${warnCount > 0 ? '#f59e0b' : 'var(--secondary-text-color)'}">${warnCount}</div>
        </div>
      </div>

      <div class="ov-findings-panel">
        <div class="ov-panel-header">
          <span>Top Findings</span>
          <button class="ov-btn-refresh" id="btnDoctorRefresh">↻ Refresh</button>
        </div>
        ${topFindings.length > 0 ? `
        <table class="ov-table">
          <thead>
            <tr>
              <th>Severity</th>
              <th>Invariant</th>
              <th>Entity</th>
              <th>Summary</th>
            </tr>
          </thead>
          <tbody>
            ${topFindings.map((f: Finding) => `
            <tr>
              <td>${badge(sevLabel(f.severity), sevColor(f.severity))}</td>
              <td style="font-family:monospace;font-size:.78rem">${f.invariantId}</td>
              <td style="color:var(--secondary-text-color)">${f.entityRef || '—'}</td>
              <td>${f.summary}</td>
            </tr>`).join('')}
          </tbody>
        </table>
        ` : `<p class="ov-empty">✓ No active findings — cluster is healthy.</p>`}
      </div>
    `
    el.querySelector('#btnDoctorRefresh')?.addEventListener('click', () => this.load())
  }

  private renderDocs() {
    const docsBox = this.querySelector('#docs') as HTMLElement
    if (!docsBox) return
    docsBox.innerHTML = ''
    const md = document.createElement('globular-markdown') as HTMLElement
    md.textContent = `
# Cluster Overview

This page shows **live health diagnostics** from the ClusterDoctor service and lets you edit the **network configuration** of the current node.

## Health Summary

The top panel shows:
- **Overall Status** — HEALTHY / DEGRADED / CRITICAL
- **Finding counts** by severity (Critical, Error, Warning)
- **Top Findings** — the highest-priority invariant violations with affected entity and summary

Findings are refreshed automatically every 60 seconds and on demand via the ↻ Refresh button.

## Network configuration

- **Hostname** — human-friendly name for this node.
- **DNS servers** — comma-separated list (e.g. \`1.1.1.1, 8.8.8.8\`).
- **Interfaces** — list of NICs with MAC, MTU, and assigned IPv4/IPv6 addresses.

> Saving changes may require elevated privileges and can briefly disrupt connectivity.

\`\`\`bash
# Example (placeholder): show network on the node
globular admin network info
\`\`\`
`.trim()
    docsBox.appendChild(md)
  }
}

customElements.define('page-cluster-overview', PageClusterOverview)
