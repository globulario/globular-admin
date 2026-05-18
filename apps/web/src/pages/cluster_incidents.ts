// src/pages/cluster_incidents.ts
//
// Incident view — operator surface for the self-correcting control plane.
// See services/docs/incidents-design.md for the data model & semantics.
//
// Layered disclosure per incident:
//   1. Headline (severity + entity + summary)
//   2. Evidence (Observed / Correlated)
//   3. Diagnosis (Diagnosed)
//   4. Proposed fix (AI Proposed)
//   5. Actions (Ack / Retry / Apply / Dismiss)

import {
  listIncidents, applyIncidentAction,
  type Incident, type IncidentSeverity, type IncidentStatus,
  type Provenance, type IncidentEvidenceItem, type IncidentDiagnosisItem, type IncidentProposedFix,
} from '@globular/sdk'

// ─── Constants ──────────────────────────────────────────────────────────────

const SEV_COLOR: Record<IncidentSeverity, string> = {
  CRITICAL: '#dc2626',
  ERROR:    '#ea580c',
  WARN:     '#ca8a04',
  INFO:     '#2563eb',
  UNKNOWN:  '#6b7280',
}

const PROV_META: Record<Provenance, { color: string; icon: string }> = {
  OBSERVED:    { color: '#6b7280', icon: '👁' },
  CORRELATED:  { color: '#2563eb', icon: '🔗' },
  DIAGNOSED:   { color: '#ca8a04', icon: '🔍' },
  AI_PROPOSED: { color: '#9333ea', icon: '🤖' },
  UNKNOWN:     { color: '#6b7280', icon: '·' },
}

const STATUS_LABEL: Record<IncidentStatus, string> = {
  OPEN: 'OPEN', RESOLVING: 'RESOLVING', RESOLVED: 'RESOLVED', ACKED: 'ACKED', UNKNOWN: '—',
}

// ─── Small render helpers ──────────────────────────────────────────────────

function esc(s: string): string {
  return (s ?? '').replace(/[&<>"']/g, c =>
    ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!))
}

function formatAge(iso: string): string {
  if (!iso) return '—'
  const ms = Date.now() - new Date(iso).getTime()
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

function severityBadge(sev: IncidentSeverity): string {
  const color = SEV_COLOR[sev]
  return `<span style="display:inline-block;padding:2px 8px;border-radius:4px;background:${color};color:white;font-size:.7rem;font-weight:700;letter-spacing:.05em">${sev}</span>`
}

function provenanceBadge(prov: Provenance): string {
  const m = PROV_META[prov]
  return `<span title="${prov}" style="display:inline-block;padding:1px 6px;border-radius:3px;border:1px solid ${m.color};color:${m.color};font-size:.65rem;font-weight:600">${m.icon} ${prov}</span>`
}

function confidenceBadge(conf: string): string {
  if (!conf) return ''
  const colors: Record<string, string> = { high: '#16a34a', medium: '#ca8a04', low: '#6b7280' }
  const color = colors[conf] || '#6b7280'
  return `<span style="display:inline-block;padding:1px 6px;border-radius:3px;background:${color};color:white;font-size:.65rem;font-weight:600">${conf.toUpperCase()}</span>`
}

// ─── Evidence / Diagnosis / Fix rendering ──────────────────────────────────

function renderEvidence(e: IncidentEvidenceItem): string {
  const facts = Object.entries(e.facts || {})
    .map(([k, v]) => `<div style="font-size:.72rem;color:var(--secondary-text-color);margin-left:18px"><span style="opacity:.7">${esc(k)}:</span> <code>${esc(String(v))}</code></div>`)
    .join('')
  return `
    <div style="padding:8px 12px;border-left:2px solid ${PROV_META[e.provenance].color};background:rgba(128,128,128,.05);margin-bottom:6px">
      <div style="display:flex;align-items:center;gap:8px;font-size:.78rem">
        ${provenanceBadge(e.provenance)}
        <span style="font-weight:500">${esc(e.summary)}</span>
        <span style="margin-left:auto;color:var(--secondary-text-color);font-size:.7rem">${esc(e.source)}</span>
      </div>
      ${facts}
    </div>`
}

function renderDiagnosis(d: IncidentDiagnosisItem): string {
  return `
    <div style="padding:8px 12px;border-left:2px solid ${PROV_META.DIAGNOSED.color};background:rgba(202,138,4,.05);margin-bottom:6px">
      <div style="display:flex;align-items:center;gap:8px;font-size:.78rem">
        ${provenanceBadge('DIAGNOSED')}
        ${severityBadge(d.severity)}
        <span style="font-weight:500">${esc(d.summary)}</span>
        <span style="margin-left:auto;color:var(--secondary-text-color);font-size:.7rem">${esc(d.invariantId || d.source)}</span>
      </div>
    </div>`
}

function renderFix(f: IncidentProposedFix, incidentId: string): string {
  const patchLine = f.codePatch
    ? `<pre style="margin:8px 0;padding:8px;background:#1e1e1e;color:#d4d4d4;font-size:.72rem;overflow-x:auto;border-radius:4px">${esc(f.codePatch.filePath)}:${f.codePatch.line}
<span style="color:#f87171">- ${esc(f.codePatch.oldText)}</span>
<span style="color:#4ade80">+ ${esc(f.codePatch.newText)}</span></pre>`
    : ''
  return `
    <div style="padding:10px 12px;border-left:2px solid ${PROV_META.AI_PROPOSED.color};background:rgba(147,51,234,.06);margin-bottom:6px;border-radius:0 4px 4px 0">
      <div style="display:flex;align-items:center;gap:8px;font-size:.78rem;margin-bottom:4px">
        ${provenanceBadge('AI_PROPOSED')}
        ${confidenceBadge(f.confidence)}
        <span style="font-weight:500">${esc(f.summary)}</span>
        <span style="margin-left:auto;color:var(--secondary-text-color);font-size:.7rem">${esc(f.proposer)}</span>
      </div>
      ${f.reasoning ? `<div style="font-size:.72rem;color:var(--secondary-text-color);margin-left:4px">${esc(f.reasoning)}</div>` : ''}
      ${patchLine}
      <div style="display:flex;gap:6px;margin-top:8px">
        <button data-action="apply_fix" data-incident="${esc(incidentId)}" data-fix="${esc(f.id)}"
          style="padding:4px 10px;background:${PROV_META.AI_PROPOSED.color};color:white;border:0;border-radius:3px;font-size:.72rem;cursor:pointer">Apply Patch</button>
        <button data-action="reject_fix" data-incident="${esc(incidentId)}" data-fix="${esc(f.id)}"
          style="padding:4px 10px;background:transparent;color:var(--secondary-text-color);border:1px solid var(--border-subtle-color);border-radius:3px;font-size:.72rem;cursor:pointer">Reject</button>
      </div>
    </div>`
}

// ─── Incident card ──────────────────────────────────────────────────────────

function renderIncidentCard(inc: Incident): string {
  const sevColor = SEV_COLOR[inc.severity]
  const opacity = inc.status === 'RESOLVED' ? '.55' : '1'
  return `
    <div style="border:1px solid var(--border-subtle-color);border-left:4px solid ${sevColor};border-radius:6px;padding:14px;margin-bottom:12px;background:var(--surface-container-color);opacity:${opacity}" data-incident-id="${esc(inc.id)}">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:4px">
        ${severityBadge(inc.severity)}
        <span style="font-size:.95rem;font-weight:600">${esc(inc.headline)}</span>
        <span style="margin-left:auto;font-size:.72rem;color:var(--secondary-text-color)">
          ${STATUS_LABEL[inc.status]} · ${inc.occurrenceCount}× · ${formatAge(inc.lastSeenAt)}
        </span>
      </div>
      <div style="font-size:.7rem;color:var(--secondary-text-color);margin-bottom:10px">
        ${esc(inc.category)} · ${esc(inc.entityRef || '—')}${inc.entityType ? ` (${esc(inc.entityType)})` : ''} · <code style="font-size:.68rem;opacity:.7">${esc(inc.id)}</code>
      </div>

      ${inc.evidence.length > 0 ? `
        <div style="font-size:.7rem;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--secondary-text-color);margin:8px 0 4px">What happened</div>
        ${inc.evidence.slice(0, 5).map(renderEvidence).join('')}
      ` : ''}

      ${inc.diagnoses.length > 0 ? `
        <div style="font-size:.7rem;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--secondary-text-color);margin:8px 0 4px">Diagnosis</div>
        ${inc.diagnoses.map(renderDiagnosis).join('')}
      ` : ''}

      ${inc.proposedFixes.length > 0 ? `
        <div style="font-size:.7rem;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--secondary-text-color);margin:8px 0 4px">Proposed Fix</div>
        ${inc.proposedFixes.map(f => renderFix(f, inc.id)).join('')}
      ` : ''}

      <div style="display:flex;gap:6px;margin-top:12px;padding-top:10px;border-top:1px solid var(--border-subtle-color)">
        ${inc.acknowledged ? '' : `<button data-action="ack" data-incident="${esc(inc.id)}"
          style="padding:4px 10px;background:transparent;color:var(--primary-text-color);border:1px solid var(--border-subtle-color);border-radius:3px;font-size:.72rem;cursor:pointer">Acknowledge</button>`}
        ${inc.category === 'workflow_failure' ? `<button data-action="retry" data-incident="${esc(inc.id)}"
          style="padding:4px 10px;background:transparent;color:var(--primary-text-color);border:1px solid var(--border-subtle-color);border-radius:3px;font-size:.72rem;cursor:pointer">Retry</button>` : ''}
        <button data-action="dismiss" data-incident="${esc(inc.id)}"
          style="padding:4px 10px;background:transparent;color:var(--secondary-text-color);border:1px solid var(--border-subtle-color);border-radius:3px;font-size:.72rem;cursor:pointer">Dismiss</button>
      </div>
    </div>`
}

// ─── Page component ─────────────────────────────────────────────────────────

class PageClusterIncidents extends HTMLElement {
  private _built = false
  private _incidents: Incident[] = []
  private _loading = true
  private _error = ''
  private _clusterId = 'globular.internal'
  private _pollT: any = 0
  private _filterStatus: number = 0 // 0=all, 1=OPEN, 3=RESOLVED

  connectedCallback() {
    this._buildShell()
    this._load()
    this._pollT = setInterval(() => this._load(), 30_000)
    this.addEventListener('click', this._onClick)
  }

  disconnectedCallback() {
    if (this._pollT) clearInterval(this._pollT)
    this.removeEventListener('click', this._onClick)
  }

  private _buildShell() {
    if (this._built) return
    this._built = true
    this.innerHTML = `
      <div style="padding:20px;max-width:1100px;margin:0 auto">
        <div style="display:flex;align-items:baseline;gap:14px;margin-bottom:16px">
          <h2 style="margin:0">Incidents</h2>
          <span style="font-size:.78rem;color:var(--secondary-text-color)">Operator surface · aggregated from workflow telemetry + doctor findings + AI proposals</span>
        </div>

        <div data-bind="pills" style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap"></div>

        <div data-bind="error" style="display:none;padding:10px;background:rgba(220,38,38,.1);border:1px solid ${SEV_COLOR.ERROR};border-radius:4px;color:${SEV_COLOR.ERROR};margin-bottom:12px;font-size:.8rem"></div>

        <div data-bind="body"></div>
      </div>`
  }

  private _set(bind: string, html: string) {
    const el = this.querySelector(`[data-bind="${bind}"]`) as HTMLElement | null
    if (el) el.innerHTML = html
  }

  private _showError(msg: string) {
    const el = this.querySelector('[data-bind="error"]') as HTMLElement | null
    if (el) { el.textContent = msg; el.style.display = msg ? '' : 'none' }
  }

  private _onClick = async (evt: Event) => {
    const t = evt.target as HTMLElement
    const btn = t.closest('button[data-action]') as HTMLButtonElement | null
    if (!btn) {
      // filter pill click
      const pill = t.closest('[data-filter]') as HTMLElement | null
      if (pill) {
        this._filterStatus = Number(pill.dataset.filter)
        this._load()
      }
      return
    }
    const action = btn.dataset.action || ''
    const incidentId = btn.dataset.incident || ''
    const fixId = btn.dataset.fix || ''
    if (!incidentId || !action) return
    btn.disabled = true
    try {
      await applyIncidentAction(incidentId, action, 'operator', fixId, '')
      await this._load()
    } catch (e) {
      this._showError(`Action ${action} failed: ${String((e as any)?.message || e)}`)
    } finally {
      btn.disabled = false
    }
  }

  private async _load() {
    this._error = ''
    try {
      this._incidents = await listIncidents(this._clusterId, this._filterStatus, 100)
      this._showError('')
    } catch (e: any) {
      this._showError(`Failed to load incidents: ${e?.message || e}`)
    }
    this._loading = false
    this._pushData()
  }

  private _pushData() {
    const open = this._incidents.filter(i => i.status === 'OPEN').length
    const resolving = this._incidents.filter(i => i.status === 'RESOLVING').length
    const acked = this._incidents.filter(i => i.status === 'ACKED').length
    const resolved = this._incidents.filter(i => i.status === 'RESOLVED').length

    const pill = (label: string, count: number, filter: number, color: string) => `
      <span data-filter="${filter}" style="display:inline-flex;align-items:center;gap:4px;padding:4px 10px;border-radius:14px;border:1px solid ${this._filterStatus === filter ? color : 'var(--border-subtle-color)'};color:${this._filterStatus === filter ? 'white' : color};background:${this._filterStatus === filter ? color : 'transparent'};font-size:.72rem;font-weight:600;cursor:pointer">
        ${label} <span style="opacity:.7">${count}</span>
      </span>`

    this._set('pills', `
      ${pill('All', open + resolving + acked + resolved, 0, '#6b7280')}
      ${pill('OPEN', open, 1, SEV_COLOR.ERROR)}
      ${pill('RESOLVING', resolving, 2, SEV_COLOR.WARN)}
      ${pill('RESOLVED', resolved, 3, '#16a34a')}
      ${pill('ACKED', acked, 4, '#2563eb')}
    `)

    if (this._loading) {
      this._set('body', '<div style="padding:24px;color:var(--secondary-text-color)">Loading incidents…</div>')
      return
    }

    const emptyMsg = this._filterStatus === 0
      ? 'No incidents. System is converging. 🟢'
      : `No ${STATUS_LABEL[['UNKNOWN','OPEN','RESOLVING','RESOLVED','ACKED'][this._filterStatus] as IncidentStatus]} incidents.`

    this._set('body',
      this._incidents.length === 0
        ? `<div style="padding:36px;text-align:center;color:var(--secondary-text-color);border:1px dashed var(--border-subtle-color);border-radius:6px">${emptyMsg}</div>`
        : this._incidents.map(renderIncidentCard).join('')
    )
  }
}

if (!customElements.get('page-cluster-incidents')) {
  customElements.define('page-cluster-incidents', PageClusterIncidents)
}

export default PageClusterIncidents
