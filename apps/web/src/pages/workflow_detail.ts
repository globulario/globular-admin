// src/pages/workflow_detail.ts
// Workflow Detail Panel — SVG flowchart with actor swim lanes.
// SVG handles layout, boxes, arrows. HTML (foreignObject) handles content inside boxes.

import {
  getWorkflowRun,
  listWorkflowRuns,
  diagnoseWorkflowRun,
  retryWorkflowRun,
  acknowledgeWorkflowRun,
  runStatusLabel,
  runStatusColor,
  phaseLabel,
  actorLabel,
  stepStatusColor,
  failureClassLabel,
  triggerReasonLabel,
  triggerReasonColor,
  type WorkflowRun,
  type WorkflowStep,
  type WorkflowArtifact,
  type DiagnoseResult,
} from '@globular/sdk'

// ─── Lane / layout ──────────────────────────────────────────────────────────

interface Lane { id: number; label: string; color: string }

const ACTOR_CATALOG: Lane[] = [
  { id: 1, label: 'controller',       color: '#6366f1' },
  { id: 2, label: 'repository',       color: '#8b5cf6' },
  { id: 3, label: 'node-agent',       color: 'var(--accent-color)' },
  { id: 4, label: 'installer',        color: 'var(--success-color)' },
  { id: 5, label: 'runtime',          color: 'var(--warning-color)' },
  { id: 6, label: 'operator',         color: '#ec4899' },
  { id: 7, label: 'ai-diagnoser',     color: '#14b8a6' },
  { id: 8, label: 'ai-executor',      color: 'var(--warning-color)' },
  { id: 9, label: 'workflow-service', color: '#a855f7' },
]

function lanesFromSteps(steps: WorkflowStep[]): Lane[] {
  const seen = new Set<number>()
  for (const s of steps) if (s.actor > 0) seen.add(s.actor)
  if (seen.size === 0) return [ACTOR_CATALOG[0]]
  return ACTOR_CATALOG.filter(l => seen.has(l.id))
}

const BOX_H     = 56
const BOX_R     = 8
const ROW_GAP   = 24
const PHASE_H   = 28
const HEADER_H  = 40
const MARGIN_L  = 12
const LANE_PAD  = 16

interface Layout {
  lanes: Lane[]
  laneW: number; boxW: number; totalW: number
  laneX(actor: number): number
  laneCx(actor: number): number
  boxX(actor: number): number
}

function makeLayout(containerW: number, lanes: Lane[]): Layout {
  const count = Math.max(1, lanes.length)
  const laneW = Math.max(160, Math.floor((containerW - MARGIN_L * 2) / count))
  const boxW = laneW - LANE_PAD * 2
  const totalW = count * laneW

  function idx(actor: number): number {
    const i = lanes.findIndex(l => l.id === actor)
    return i >= 0 ? i : 0
  }

  return {
    lanes, laneW, boxW, totalW,
    laneX:  (a: number) => MARGIN_L + idx(a) * laneW,
    laneCx: (a: number) => MARGIN_L + idx(a) * laneW + laneW / 2,
    boxX:   (a: number) => MARGIN_L + idx(a) * laneW + LANE_PAD,
  }
}

// ─── Status colors ──────────────────────────────────────────────────────────

function sFill(s: number): string {
  switch (s) { case 2: return '#10b98126'; case 3: return '#ef444426'; case 1: return '#3b82f626'; default: return '#6b728014' }
}
function sStroke(s: number): string {
  switch (s) { case 2: return 'var(--success-color)'; case 3: return 'var(--error-color)'; case 1: return 'var(--accent-color)'; default: return '#4b5563' }
}
function arrowColor(s: number): string {
  switch (s) { case 2: return 'var(--success-color)'; case 3: return 'var(--error-color)'; default: return '#4b5563' }
}
function fmtDur(ms: number): string {
  if (ms <= 0) return ''
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`
}

// ─── SVG flowchart builder ──────────────────────────────────────────────────

interface PlacedStep { step: WorkflowStep; x: number; y: number; cx: number; cy: number }

function buildFlowchart(steps: WorkflowStep[], selectedSeq: number, L: Layout): { svg: string; height: number } {
  if (steps.length === 0) return { svg: '', height: 100 }

  const sorted = [...steps].sort((a, b) => a.seq - b.seq)
  const placed: PlacedStep[] = []
  let curY = HEADER_H + 12
  let lastPhase = -1
  const parts: string[] = []
  const lanes = L.lanes

  // Arrowhead markers
  parts.push(`
    <defs>
      <marker id="ah" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
        <path d="M0,0 L8,3 L0,6 Z" fill="#4b5563"/>
      </marker>
      <marker id="ah-ok" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
        <path d="M0,0 L8,3 L0,6 Z" fill="#10b981"/>
      </marker>
      <marker id="ah-err" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
        <path d="M0,0 L8,3 L0,6 Z" fill="#ef4444"/>
      </marker>
    </defs>
  `)

  // Lane backgrounds
  for (let i = 0; i < lanes.length; i++) {
    const x = MARGIN_L + i * L.laneW
    parts.push(`<rect x="${x}" y="0" width="${L.laneW}" height="100%" fill="${i % 2 === 0 ? '#ffffff03' : '#ffffff06'}" />`)
  }

  // Lane headers
  for (let i = 0; i < lanes.length; i++) {
    const cx = MARGIN_L + i * L.laneW + L.laneW / 2
    parts.push(`
      <line x1="${MARGIN_L + i * L.laneW}" y1="${HEADER_H}" x2="${MARGIN_L + (i + 1) * L.laneW}" y2="${HEADER_H}" stroke="${lanes[i].color}" stroke-width="2" opacity=".6"/>
      <text x="${cx}" y="${HEADER_H - 10}" text-anchor="middle" fill="${lanes[i].color}" font-size="11" font-weight="700" font-family="system-ui">${lanes[i].label}</text>
    `)
  }

  // Place steps
  for (let i = 0; i < sorted.length; i++) {
    const step = sorted[i]

    // Phase divider
    if (step.phase !== lastPhase && step.phase > 0) {
      curY += (i === 0 ? 0 : 8)
      const divY = curY + PHASE_H / 2
      parts.push(`
        <line x1="${MARGIN_L}" y1="${divY}" x2="${MARGIN_L + L.totalW}" y2="${divY}" stroke="#ffffff15" stroke-width="1"/>
        <rect x="${MARGIN_L + L.totalW / 2 - 40}" y="${divY - 9}" width="80" height="18" rx="9" fill="#ffffff0d"/>
        <text x="${MARGIN_L + L.totalW / 2}" y="${divY + 4}" text-anchor="middle" fill="#888" font-size="9" font-weight="600" font-family="system-ui">${phaseLabel(step.phase).toUpperCase()}</text>
      `)
      curY += PHASE_H
      lastPhase = step.phase
    }

    // Arrow from previous step
    if (i > 0) {
      const prev = placed[i - 1]
      const fromCx = prev.cx
      const fromY = prev.y + BOX_H
      const toCx = L.laneCx(step.actor)
      const toY = curY
      const markerId = prev.step.status === 2 ? 'ah-ok' : prev.step.status === 3 ? 'ah-err' : 'ah'
      const color = arrowColor(prev.step.status)

      if (Math.abs(fromCx - toCx) < 5) {
        // Straight vertical arrow
        parts.push(`<line x1="${fromCx}" y1="${fromY}" x2="${toCx}" y2="${toY}" stroke="${color}" stroke-width="1.5" marker-end="url(#${markerId})"/>`)
      } else {
        // L-shaped path: go down, then across, then down
        const midY = fromY + (toY - fromY) / 2
        parts.push(`<path d="M${fromCx},${fromY} L${fromCx},${midY} L${toCx},${midY} L${toCx},${toY}" fill="none" stroke="${color}" stroke-width="1.5" stroke-dasharray="${prev.step.status === 3 ? '4,3' : 'none'}" marker-end="url(#${markerId})"/>`)
      }
    }

    // Step box
    const bx = L.boxX(step.actor)
    const isSelected = step.seq === selectedSeq
    const isRunning = step.status === 1
    const isFailed = step.status === 3

    placed.push({ step, x: bx, y: curY, cx: L.laneCx(step.actor), cy: curY + BOX_H / 2 })

    parts.push(`
      <g class="wf-step-g" data-step-seq="${step.seq}" style="cursor:pointer">
        <rect x="${bx}" y="${curY}" width="${L.boxW}" height="${BOX_H}" rx="${BOX_R}"
              fill="${sFill(step.status)}" stroke="${sStroke(step.status)}" stroke-width="${isSelected ? 2.5 : 1.5}"
              ${isRunning ? 'opacity=".85"' : ''}/>
        ${isSelected ? `<rect x="${bx - 3}" y="${curY - 3}" width="${L.boxW + 6}" height="${BOX_H + 6}" rx="${BOX_R + 2}" fill="none" stroke="#6366f1" stroke-width="1.5" stroke-dasharray="4,2"/>` : ''}
        <foreignObject x="${bx}" y="${curY}" width="${L.boxW}" height="${BOX_H}">
          <div xmlns="http://www.w3.org/1999/xhtml" style="padding:6px 10px;height:100%;display:flex;flex-direction:column;justify-content:center;font-family:system-ui;overflow:hidden">
            <div style="font-size:11px;font-weight:600;color:#e0e0e0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${step.title || step.stepKey}</div>
            <div style="font-size:9px;color:#888;margin-top:2px;display:flex;gap:6px;align-items:center">
              <span style="width:6px;height:6px;border-radius:50%;background:${lanes.find(l => l.id === step.actor)?.color ?? '#888'};flex-shrink:0"></span>
              <span>${actorLabel(step.actor)}</span>
              ${fmtDur(step.durationMs) ? `<span>· ${fmtDur(step.durationMs)}</span>` : ''}
              ${isFailed ? `<span style="color:var(--error-color);font-weight:600">✕ ${step.errorCode || 'failed'}</span>` : ''}
              ${step.status === 2 ? '<span style="color:var(--success-color)">✓</span>' : ''}
            </div>
          </div>
        </foreignObject>
      </g>
    `)

    // Decision diamond after retryable failure
    if (isFailed && step.retryable) {
      curY += BOX_H + 8
      const dx = L.laneCx(step.actor)
      const dy = curY + 14
      parts.push(`
        <g transform="translate(${dx},${dy}) rotate(45)">
          <rect x="-10" y="-10" width="20" height="20" rx="2" fill="#ef444426" stroke="#ef4444" stroke-width="1.5"/>
          <text transform="rotate(-45)" x="0" y="4" text-anchor="middle" fill="#ef4444" font-size="10" font-weight="700" font-family="system-ui">?</text>
        </g>
        <text x="${dx + 20}" y="${dy + 4}" fill="#ef4444" font-size="9" font-style="italic" font-family="system-ui">retry / rollback</text>
      `)
      curY += 20
    }

    curY += BOX_H + ROW_GAP
  }

  const totalH = curY + 20
  return { svg: parts.join('\n'), height: totalH }
}

// ─── Component ──────────────────────────────────────────────────────────────

export class WorkflowDetailPanel extends HTMLElement {
  private _clusterId = ''
  private _nodeId = ''
  private _nodeHostname = ''
  private _componentName = ''
  private _run: WorkflowRun | null = null
  private _steps: WorkflowStep[] = []
  private _artifacts: WorkflowArtifact[] = []
  private _diagnosis: DiagnoseResult | null = null
  private _loading = true
  private _error = ''
  private _selectedStep: WorkflowStep | null = null
  private _fullscreen = false
  private _pollTimer: number | null = null
  private _built = false

  static get observedAttributes() { return ['cluster-id', 'node-id', 'node-hostname', 'component-name', 'run-id'] }

  attributeChangedCallback(name: string, _old: string, val: string) {
    switch (name) {
      case 'cluster-id': this._clusterId = val; break
      case 'node-id': this._nodeId = val; break
      case 'node-hostname': this._nodeHostname = val; break
      case 'component-name': this._componentName = val; break
      case 'run-id': this.loadRun(val); return
    }
  }

  connectedCallback() {
    // Defer load to next microtask so all setAttribute() calls complete first.
    queueMicrotask(() => {
      this._buildShell()
      this._pushData()
      if (this._clusterId && this._componentName) this.loadLatest()
    })
  }

  private async loadLatest() {
    this._loading = true; this._error = ''; this.render()
    try {
      const runs = await listWorkflowRuns(this._clusterId, { componentName: this._componentName, nodeId: this._nodeId || undefined, limit: 1 })
      if (runs.length === 0) { this._error = 'No workflow runs found'; this._loading = false; this.render(); return }
      await this.loadRun(runs[0].id)
    } catch (e: any) {
      console.error('workflow: loadLatest failed', e)
      this._error = e?.message || 'Workflow service unreachable'
      this._loading = false; this.render()
    }
  }

  private async loadRun(runId: string) {
    this._loading = true; this._error = ''; this._diagnosis = null; this._selectedStep = null; this.render()
    try {
      const d = await getWorkflowRun(this._clusterId, runId)
      this._run = d.run; this._steps = d.steps; this._artifacts = d.artifacts
      if (this._run.status === 9 || this._run.status === 11) {
        try { this._diagnosis = await diagnoseWorkflowRun(this._clusterId, runId) } catch { /* diagnosis is optional enrichment */ }
      }
      // Auto-poll active runs every 3s for live updates.
      this.stopPoll()
      if (this._run && this.isActive(this._run.status)) {
        this._pollTimer = window.setInterval(() => this.refreshRun(runId), 3000)
      }
    } catch (e: any) { this._error = e?.message || 'Failed to load run' }
    this._loading = false; this.render()
  }

  /** Refresh without resetting selection or showing loading spinner. */
  private async refreshRun(runId: string) {
    try {
      const d = await getWorkflowRun(this._clusterId, runId)
      this._run = d.run; this._steps = d.steps; this._artifacts = d.artifacts
      // Stop polling once terminal.
      if (this._run && !this.isActive(this._run.status)) {
        this.stopPoll()
        if (this._run.status === 9 || this._run.status === 11) {
          try { this._diagnosis = await diagnoseWorkflowRun(this._clusterId, runId) } catch { /* diagnosis is optional enrichment */ }
        }
      }
      // Targeted patch: update only the status badge, SVG flowchart, and sidebar.
      // The modal overlay structure (.wf-overlay > .wf-panel) is not rebuilt.
      this._patchRunSlots()
    } catch { /* silent — will retry on next tick */ }
  }

  /** Push updated run data into data-bind slots without rebuilding the modal shell. */
  private _patchRunSlots() {
    const run = this._run
    if (!run) return

    // Patch status badge
    const badge = this.querySelector<HTMLElement>('.wf-badge')
    if (badge) {
      badge.textContent = runStatusLabel(run.status)
      badge.style.background = runStatusColor(run.status)
    }

    // Patch SVG flowchart inside .wf-flow
    const flowEl = this.querySelector<HTMLElement>('.wf-flow')
    if (flowEl) {
      const estW = this._fullscreen ? (window.innerWidth - 300 - 32) : Math.min(1200 - 300 - 32, window.innerWidth - 64)
      const lanes = lanesFromSteps(this._steps)
      const L = makeLayout(Math.max(600, estW), lanes)
      const { svg, height } = buildFlowchart(this._steps, this._selectedStep?.seq ?? -1, L)
      const svgW = MARGIN_L + L.totalW + MARGIN_L
      flowEl.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="${svgW}" height="${height}" viewBox="0 0 ${svgW} ${height}">${svg}</svg>`
      // Re-bind step click handlers on new SVG elements
      flowEl.querySelectorAll<HTMLElement>('[data-step-seq]').forEach(el => {
        el.addEventListener('click', (e) => {
          e.stopPropagation()
          this._selectedStep = this._steps.find(s => s.seq === parseInt(el.dataset.stepSeq ?? '0')) ?? null
          this._patchRunSlots()
        })
      })
    }

    // Patch sidebar: step detail + diagnosis + actions
    const sb = this.querySelector<HTMLElement>('.wf-sb')
    if (sb) {
      const isFailed = run.status === 9 || run.status === 11
      sb.innerHTML = `
        ${this._selectedStep ? this.renderDetail(this._selectedStep) : '<div class="wf-hint">Click a step to inspect</div>'}
        ${this._diagnosis ? this.renderDiag(this._diagnosis) : ''}
        ${this.renderActions(run, isFailed)}
      `
      // Re-bind action buttons in the refreshed sidebar
      sb.querySelector('#btnRetry')?.addEventListener('click', async () => {
        if (!this._run) return
        try { const r = await retryWorkflowRun(this._clusterId, this._run.id); await this.loadRun(r.id) }
        catch (e: any) { this._error = `Retry: ${e?.message}`; this.render() }
      })
      sb.querySelector('#btnAck')?.addEventListener('click', async () => {
        if (!this._run) return
        try { await acknowledgeWorkflowRun(this._clusterId, this._run.id, 'admin-ui'); this._run.acknowledged = true; this._patchRunSlots() }
        catch (e: any) { this._error = `Ack: ${e?.message}`; this.render() }
      })
      sb.querySelector('#btnDiagnose')?.addEventListener('click', async () => {
        if (!this._run) return
        try { this._diagnosis = await diagnoseWorkflowRun(this._clusterId, this._run.id); this._patchRunSlots() }
        catch (e: any) { this._error = `Diagnose: ${e?.message}`; this.render() }
      })
    }
  }

  private isActive(status: number): boolean {
    return status >= 1 && status <= 7 // PENDING through RETRYING
  }

  private stopPoll() {
    if (this._pollTimer) { clearInterval(this._pollTimer); this._pollTimer = null }
  }

  private _buildShell() {
    if (this._built) return
    this._built = true
    this.innerHTML = `
      <style>
        .wf-overlay { position:fixed;inset:0;z-index:1000;background:rgba(0,0,0,.65);display:flex;justify-content:center;align-items:flex-start;padding:24px 12px;overflow-y:auto }
        .wf-panel { background:var(--md-surface-container-low,#1a1a2e);border:1px solid var(--border-subtle-color,#333);border-radius:12px;width:100%;max-width:1200px;box-shadow:0 24px 48px rgba(0,0,0,.4);transition:all .2s ease }
        .wf-fs .wf-overlay { padding:0 }
        .wf-fs .wf-panel { max-width:100%;border-radius:0;border:0;height:100vh;display:flex;flex-direction:column }
        .wf-fs .wf-body { flex:1;min-height:0 }
        .wf-fs .wf-flow { max-height:100% }
        .wf-fs .wf-sb { max-height:100% }
        .wf-hdr { border-bottom:1px solid var(--border-subtle-color,#333);padding:14px 20px 10px }
        .wf-hdr-top { display:flex;align-items:center;gap:10px }
        .wf-hdr h3 { margin:0;font-size:1rem;font-weight:400 } .wf-hdr strong { font-weight:700 }
        .wf-badge { padding:3px 10px;border-radius:4px;font-size:.68rem;font-weight:700;text-transform:uppercase;color:#fff }
        .wf-x { background:0;border:0;color:var(--on-surface-color,#ccc);cursor:pointer;font-size:1.1rem;padding:4px 8px;border-radius:4px;margin-left:auto } .wf-x:hover { background:rgba(255,255,255,.1) }
        .wf-meta { display:flex;gap:14px;flex-wrap:wrap;margin-top:6px;font-size:.72rem;color:var(--secondary-text-color,#888) } .wf-meta code { font-family:monospace;font-size:.7rem }
        .wf-body { display:flex;min-height:400px }
        .wf-flow { flex:1;overflow:auto;max-height:72vh;padding:0 }
        .wf-flow svg { display:block }
        .wf-flow svg .wf-step-g:hover rect:first-child { filter:brightness(1.3) }
        .wf-sb { width:300px;min-width:260px;border-left:1px solid var(--border-subtle-color,#333);padding:14px;overflow-y:auto;max-height:72vh;font-size:.82rem }
        @media(max-width:900px) { .wf-body{flex-direction:column} .wf-sb{width:100%;border-left:0;border-top:1px solid var(--border-subtle-color,#333);max-height:none} .wf-flow{max-height:50vh} }
        .wf-hint { color:var(--secondary-text-color,#888);font-style:italic;font-size:.78rem }
        .wf-det h4 { margin:0 0 8px;font-size:.84rem } .wf-det-r { display:flex;gap:6px;margin-bottom:3px;line-height:1.4 }
        .wf-det-k { font-weight:600;min-width:78px;color:var(--secondary-text-color,#888);font-size:.74rem } .wf-det-v { font-size:.78rem;word-break:break-word }
        .wf-raw { margin-top:8px } .wf-raw summary { cursor:pointer;font-size:.7rem;color:#888 } .wf-raw pre { font-size:.65rem;overflow-x:auto;margin-top:4px;max-height:100px }
        .wf-dg { margin-top:16px;padding-top:14px;border-top:1px solid var(--border-subtle-color,#333) }
        .wf-dg h4 { margin:0 0 6px;font-size:.84rem } .wf-dg-c { font-size:.7rem;font-weight:600 }
        .wf-dg-t { font-size:.75rem;line-height:1.5;white-space:pre-wrap;margin:6px 0;color:var(--on-surface-color,#ddd) }
        .wf-dg-a { margin-top:10px } .wf-dg-a strong { font-size:.68rem;text-transform:uppercase;color:#888 } .wf-dg-a p { margin:3px 0 0;font-size:.78rem }
        .wf-acts { display:flex;gap:8px;flex-wrap:wrap;margin-top:16px;padding-top:14px;border-top:1px solid var(--border-subtle-color,#333) }
        .wf-btn { padding:7px 14px;border-radius:6px;font-size:.78rem;font-weight:600;cursor:pointer;border:0;transition:filter .15s } .wf-btn:hover{filter:brightness(1.15)}
        .wf-btn-r { background:var(--success-color);color:#fff } .wf-btn-a { background:var(--accent-color);color:#fff } .wf-btn-d { background:#8b5cf6;color:#fff }
        .wf-ack { font-size:.75rem;color:var(--success-color) }
        .wf-empty { padding:32px;text-align:center;color:var(--secondary-text-color,#888) }
        .wf-err { padding:20px;color:var(--error-color,#ef4444);font-size:.85rem }
      </style>
      <div class="wf-fs-wrap">
        <div class="wf-overlay" id="wfOverlay">
          <div class="wf-panel">
            <div data-bind="panel-content"></div>
          </div>
        </div>
      </div>
    `
    this.querySelector('#wfOverlay')?.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).id === 'wfOverlay') this.close()
    })
  }

  private _set(bind: string, html: string) {
    const el = this.querySelector(`[data-bind="${bind}"]`) as HTMLElement | null
    if (el) el.innerHTML = html
  }

  private _pushData() {
    const run = this._run
    // Update fullscreen class on wrapper
    const wrap = this.querySelector('.wf-fs-wrap') as HTMLElement | null
    if (wrap) wrap.className = this._fullscreen ? 'wf-fs' : 'wf-fs-wrap'

    let content = ''
    if (this._loading) {
      content = '<div class="wf-empty">Loading workflow…</div>'
    } else if (this._error) {
      content = `<div class="wf-err">${this._error}<br><button class="wf-btn" id="wfClose" style="margin-top:12px">Close</button></div>`
    } else if (run) {
      content = this.renderRun(run)
    } else {
      content = '<div class="wf-empty">No workflow data</div>'
    }
    this._set('panel-content', content)
    this._bindPanelEvents()
  }

  private _bindPanelEvents() {
    this.querySelector('#wfClose')?.addEventListener('click', () => this.close())
    this.querySelector('#wfToggleFs')?.addEventListener('click', () => { this._fullscreen = !this._fullscreen; this._pushData() })
    this.querySelectorAll<HTMLElement>('[data-step-seq]').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation()
        this._selectedStep = this._steps.find(s => s.seq === parseInt(el.dataset.stepSeq ?? '0')) ?? null
        this._pushData()
      })
    })
    this.querySelector('#btnRetry')?.addEventListener('click', async () => {
      if (!this._run) return
      try { const r = await retryWorkflowRun(this._clusterId, this._run.id); await this.loadRun(r.id) }
      catch (e: any) { this._error = `Retry: ${e?.message}`; this._pushData() }
    })
    this.querySelector('#btnAck')?.addEventListener('click', async () => {
      if (!this._run) return
      try { await acknowledgeWorkflowRun(this._clusterId, this._run.id, 'admin-ui'); this._run.acknowledged = true; this._pushData() }
      catch (e: any) { this._error = `Ack: ${e?.message}`; this._pushData() }
    })
    this.querySelector('#btnDiagnose')?.addEventListener('click', async () => {
      if (!this._run) return
      try { this._diagnosis = await diagnoseWorkflowRun(this._clusterId, this._run.id); this._pushData() }
      catch (e: any) { this._error = `Diagnose: ${e?.message}`; this._pushData() }
    })
  }

  /** @deprecated Use _pushData() */
  private render() { this._pushData() }

  private renderRun(run: WorkflowRun): string {
    const ctx = run.context
    const isFailed = run.status === 9 || run.status === 11
    const estW = this._fullscreen ? (window.innerWidth - 300 - 32) : Math.min(1200 - 300 - 32, window.innerWidth - 64)
    const lanes = lanesFromSteps(this._steps)
    const L = makeLayout(Math.max(600, estW), lanes)
    const { svg, height } = buildFlowchart(this._steps, this._selectedStep?.seq ?? -1, L)
    const svgW = MARGIN_L + L.totalW + MARGIN_L

    return `
      <div class="wf-hdr">
        <div class="wf-hdr-top">
          <h3>Service: <strong>${ctx?.componentName ?? this._componentName}</strong></h3>
          <span class="wf-badge" style="background:${runStatusColor(run.status)}">${runStatusLabel(run.status)}</span>
          <button class="wf-x" id="wfToggleFs" title="${this._fullscreen ? 'Exit fullscreen' : 'Fullscreen'}">${this._fullscreen ? '⊟' : '⊞'}</button>
          <button class="wf-x" id="wfClose">✕</button>
        </div>
        <div class="wf-meta">
          <span>Node: <strong>${ctx?.nodeHostname || ctx?.nodeId || this._nodeHostname || '—'}</strong></span>
          ${run.triggerReason ? `<span>Trigger: <strong style="color:${triggerReasonColor(run.triggerReason)}">${triggerReasonLabel(run.triggerReason)}</strong></span>` : ''}
          ${isFailed ? `<span>Failure: <strong style="color:var(--error-color)">${failureClassLabel(run.failureClass)}</strong></span>` : ''}
          <span>Retries: <strong>${run.retryCount}</strong></span>
          <span>Plan: <code>${ctx?.planId?.slice(0, 8) || '—'}</code> gen=${ctx?.planGeneration ?? '?'}</span>
          <span>Run: <code>${run.id?.slice(0, 8) || '—'}</code></span>
        </div>
      </div>
      <div class="wf-body">
        <div class="wf-flow">
          <svg xmlns="http://www.w3.org/2000/svg" width="${svgW}" height="${height}" viewBox="0 0 ${svgW} ${height}">
            ${svg}
          </svg>
        </div>
        <div class="wf-sb">
          ${this._selectedStep ? this.renderDetail(this._selectedStep) : '<div class="wf-hint">Click a step to inspect</div>'}
          ${this._diagnosis ? this.renderDiag(this._diagnosis) : ''}
          ${this.renderActions(run, isFailed)}
        </div>
      </div>
    `
  }

  private renderDetail(s: WorkflowStep): string {
    const rows: [string, string][] = [
      ['Step', s.stepKey], ['Actor', actorLabel(s.actor)], ['Phase', phaseLabel(s.phase)],
      ['Status', runStatusLabel(s.status)], ['Duration', s.durationMs > 0 ? fmtDur(s.durationMs) : '—'], ['Attempt', `${s.attempt}`],
    ]
    if (s.sourceActor) rows.push(['Handoff from', actorLabel(s.sourceActor)])
    if (s.targetActor) rows.push(['Handoff to', actorLabel(s.targetActor)])
    if (s.errorCode) rows.push(['Error code', s.errorCode])
    if (s.errorMessage) rows.push(['Error', s.errorMessage])
    if (s.actionHint) rows.push(['Fix hint', s.actionHint])
    if (s.message && s.message !== s.errorMessage) rows.push(['Message', s.message])

    return `<div class="wf-det"><h4>${s.title || s.stepKey}</h4><div>${rows.map(([k, v]) => `<div class="wf-det-r"><span class="wf-det-k">${k}</span><span class="wf-det-v">${v}</span></div>`).join('')}</div>${s.detailsJson ? `<details class="wf-raw"><summary>Raw JSON</summary><pre>${s.detailsJson}</pre></details>` : ''}</div>`
  }

  private renderDiag(d: DiagnoseResult): string {
    const cc = d.confidence === 'high' ? 'var(--success-color)' : d.confidence === 'medium' ? 'var(--warning-color)' : 'var(--secondary-text-color)'
    return `<div class="wf-dg"><h4>Failure Diagnosis</h4><span class="wf-dg-c" style="color:${cc}">● ${d.confidence} confidence</span><p class="wf-dg-t">${d.diagnosis}</p>${d.suggestedAction ? `<div class="wf-dg-a"><strong>Suggested Action</strong><p>${d.suggestedAction}</p></div>` : ''}${d.relatedRunIds.length > 0 ? `<div style="margin-top:6px;font-size:.7rem;color:#888">${d.relatedRunIds.length} similar failure${d.relatedRunIds.length !== 1 ? 's' : ''}</div>` : ''}</div>`
  }

  private renderActions(run: WorkflowRun, isFailed: boolean): string {
    return `<div class="wf-acts">${isFailed ? '<button class="wf-btn wf-btn-r" id="btnRetry">↻ Retry</button>' : ''}${!run.acknowledged ? '<button class="wf-btn wf-btn-a" id="btnAck">✓ Acknowledge</button>' : '<span class="wf-ack">✓ Acknowledged</span>'}<button class="wf-btn wf-btn-d" id="btnDiagnose">🔍 Diagnose</button></div>`
  }

  private bindEvents() {
    this.querySelector('#wfClose')?.addEventListener('click', () => this.close())
    this.querySelector('#wfToggleFs')?.addEventListener('click', () => { this._fullscreen = !this._fullscreen; this.render() })
    this.querySelector('#wfOverlay')?.addEventListener('click', (e) => { if ((e.target as HTMLElement).id === 'wfOverlay') this.close() })
    this.querySelectorAll<HTMLElement>('[data-step-seq]').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation()
        this._selectedStep = this._steps.find(s => s.seq === parseInt(el.dataset.stepSeq ?? '0')) ?? null
        this.render()
      })
    })
    this.querySelector('#btnRetry')?.addEventListener('click', async () => {
      if (!this._run) return
      try { const r = await retryWorkflowRun(this._clusterId, this._run.id); await this.loadRun(r.id) }
      catch (e: any) { this._error = `Retry: ${e?.message}`; this.render() }
    })
    this.querySelector('#btnAck')?.addEventListener('click', async () => {
      if (!this._run) return
      try { await acknowledgeWorkflowRun(this._clusterId, this._run.id, 'admin-ui'); this._run.acknowledged = true; this.render() }
      catch (e: any) { this._error = `Ack: ${e?.message}`; this.render() }
    })
    this.querySelector('#btnDiagnose')?.addEventListener('click', async () => {
      if (!this._run) return
      try { this._diagnosis = await diagnoseWorkflowRun(this._clusterId, this._run.id); this.render() }
      catch (e: any) { this._error = `Diagnose: ${e?.message}`; this.render() }
    })
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { this.close(); document.removeEventListener('keydown', esc) } }
    document.addEventListener('keydown', esc)
  }

  close() { this.stopPoll(); this.remove() }
}

customElements.define('workflow-detail-panel', WorkflowDetailPanel)

export function openWorkflowDetail(clusterId: string, nodeId: string, nodeHostname: string, componentName: string) {
  document.querySelector('workflow-detail-panel')?.remove()
  const p = document.createElement('workflow-detail-panel') as WorkflowDetailPanel
  p.setAttribute('cluster-id', clusterId)
  p.setAttribute('node-id', nodeId)
  p.setAttribute('node-hostname', nodeHostname)
  p.setAttribute('component-name', componentName)
  document.body.appendChild(p)
}
