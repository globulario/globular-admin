// src/pages/workflow_detail.ts
// Workflow Detail Panel — vertical flowchart with actor swim lanes.
// Opened from the reconciliation table when a service row is clicked.

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
  type WorkflowRun,
  type WorkflowStep,
  type WorkflowArtifact,
  type DiagnoseResult,
} from '@globular/backend'

// ─── Actor lane configuration ───────────────────────────────────────────────

interface ActorLane { id: number; label: string; color: string }

const LANES: ActorLane[] = [
  { id: 1, label: 'controller',  color: '#6366f1' },
  { id: 3, label: 'node-agent',  color: '#3b82f6' },
  { id: 4, label: 'installer',   color: '#10b981' },
  { id: 5, label: 'runtime',     color: '#f59e0b' },
]

function laneIndex(actor: number): number {
  const idx = LANES.findIndex(l => l.id === actor)
  return idx >= 0 ? idx : 1 // default to node-agent column
}

function laneColor(actor: number): string {
  return LANES[laneIndex(actor)]?.color ?? '#6b7280'
}

// ─── Status helpers ─────────────────────────────────────────────────────────

const STATUS_RUNNING   = 1
const STATUS_SUCCEEDED = 2
const STATUS_FAILED    = 3

function stepBg(status: number): string {
  switch (status) {
    case STATUS_SUCCEEDED: return 'rgba(16,185,129,.15)'
    case STATUS_FAILED:    return 'rgba(239,68,68,.15)'
    case STATUS_RUNNING:   return 'rgba(59,130,246,.15)'
    default:               return 'rgba(107,114,128,.1)'
  }
}

function stepBorder(status: number): string {
  switch (status) {
    case STATUS_SUCCEEDED: return '#10b981'
    case STATUS_FAILED:    return '#ef4444'
    case STATUS_RUNNING:   return '#3b82f6'
    default:               return '#4b5563'
  }
}

function formatDuration(ms: number): string {
  if (ms <= 0) return ''
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
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

  static get observedAttributes() {
    return ['cluster-id', 'node-id', 'node-hostname', 'component-name', 'run-id']
  }

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
    this.render()
    if (this._clusterId && this._componentName) this.loadLatest()
  }

  private async loadLatest() {
    this._loading = true
    this._error = ''
    this.render()
    try {
      const runs = await listWorkflowRuns(this._clusterId, {
        componentName: this._componentName,
        nodeId: this._nodeId || undefined,
        limit: 1,
      })
      if (runs.length === 0) {
        this._error = 'No workflow runs found for this component'
        this._loading = false
        this.render()
        return
      }
      await this.loadRun(runs[0].id)
    } catch (e: any) {
      this._error = e?.message || 'Failed to load workflow runs'
      this._loading = false
      this.render()
    }
  }

  private async loadRun(runId: string) {
    this._loading = true
    this._error = ''
    this._diagnosis = null
    this._selectedStep = null
    this.render()
    try {
      const detail = await getWorkflowRun(this._clusterId, runId)
      this._run = detail.run
      this._steps = detail.steps
      this._artifacts = detail.artifacts
      if (this._run.status === 9 || this._run.status === 11) {
        try { this._diagnosis = await diagnoseWorkflowRun(this._clusterId, runId) } catch {}
      }
    } catch (e: any) {
      this._error = e?.message || 'Failed to load workflow run'
    }
    this._loading = false
    this.render()
  }

  // ─── Render ─────────────────────────────────────────────────────────────

  private render() {
    const run = this._run

    this.innerHTML = `
      <style>${WorkflowDetailPanel.styles()}</style>
      <div class="wf-overlay" id="wfOverlay">
        <div class="wf-panel">
          ${this._loading ? '<div class="wf-empty">Loading workflow…</div>' : ''}
          ${this._error && !this._loading ? `<div class="wf-error">${this._error}<br><button class="wf-btn" id="wfClose" style="margin-top:12px">Close</button></div>` : ''}
          ${!this._loading && !this._error && run ? this.renderFull(run) : ''}
          ${!this._loading && !this._error && !run && !this._error ? '<div class="wf-empty">No workflow data</div>' : ''}
        </div>
      </div>
    `
    this.bindEvents()
  }

  private renderFull(run: WorkflowRun): string {
    const ctx = run.context
    const isFailed = run.status === 9 || run.status === 11

    return `
      ${this.renderHeader(run, ctx, isFailed)}
      <div class="wf-body">
        <div class="wf-flow-area">
          ${this.renderLaneHeaders()}
          ${this.renderFlowchart(this._steps)}
        </div>
        <div class="wf-sidebar">
          ${this._selectedStep ? this.renderStepDetail(this._selectedStep) : `
            <div class="wf-sidebar-hint">Click a step to inspect details</div>
          `}
          ${this._diagnosis ? this.renderDiagnosis(this._diagnosis) : ''}
          ${this.renderActions(run, isFailed)}
        </div>
      </div>
    `
  }

  private renderHeader(run: WorkflowRun, ctx: WorkflowRun['context'], isFailed: boolean): string {
    const statusBg = runStatusColor(run.status)
    return `
      <div class="wf-header">
        <div class="wf-header-top">
          <h3 class="wf-title">Service: <strong>${ctx?.componentName ?? this._componentName}</strong></h3>
          <span class="wf-badge" style="background:${statusBg}">${runStatusLabel(run.status)}</span>
          <div style="flex:1"></div>
          <button class="wf-close-btn" id="wfClose">✕</button>
        </div>
        <div class="wf-header-meta">
          <span>Node: <strong>${ctx?.nodeHostname || ctx?.nodeId || this._nodeHostname || '—'}</strong></span>
          ${isFailed ? `<span>Failure: <strong style="color:var(--error-color)">${failureClassLabel(run.failureClass)}</strong></span>` : ''}
          <span>Retries: <strong>${run.retryCount}</strong></span>
          <span>Plan: <code>${ctx?.planId?.slice(0, 8) || '—'}</code> gen=${ctx?.planGeneration ?? '?'}</span>
          <span>ID: <code>${run.id?.slice(0, 8) || '—'}</code></span>
        </div>
      </div>
    `
  }

  private renderLaneHeaders(): string {
    return `
      <div class="wf-lanes-header">
        ${LANES.map(l => `
          <div class="wf-lane-label" style="border-bottom-color:${l.color}">
            ${l.label}
          </div>
        `).join('')}
      </div>
    `
  }

  private renderFlowchart(steps: WorkflowStep[]): string {
    if (steps.length === 0) return '<div class="wf-empty" style="padding:32px">No steps recorded yet</div>'

    const sorted = [...steps].sort((a, b) => a.seq - b.seq)
    let html = '<div class="wf-flow">'
    let lastPhase = -1

    for (let i = 0; i < sorted.length; i++) {
      const step = sorted[i]
      const li = laneIndex(step.actor)
      const isSelected = this._selectedStep?.seq === step.seq
      const dur = formatDuration(step.durationMs)
      const isRunning = step.status === STATUS_RUNNING
      const isFailed = step.status === STATUS_FAILED

      // Phase divider when phase changes
      if (step.phase !== lastPhase && step.phase > 0) {
        html += `<div class="wf-phase-divider"><span>${phaseLabel(step.phase)}</span></div>`
        lastPhase = step.phase
      }

      // Connector line from previous step
      if (i > 0) {
        const prevLi = laneIndex(sorted[i - 1].actor)
        html += this.renderConnector(prevLi, li, sorted[i - 1].status)
      }

      // Step node
      html += `
        <div class="wf-step-row">
          <div class="wf-step-node ${isRunning ? 'wf-pulse' : ''} ${isSelected ? 'wf-selected' : ''}"
               style="grid-column:${li + 1};background:${stepBg(step.status)};border-color:${stepBorder(step.status)}"
               data-step-seq="${step.seq}">
            <div class="wf-step-actor-dot" style="background:${laneColor(step.actor)}"></div>
            <div class="wf-step-content">
              <div class="wf-step-title">${step.title || step.stepKey}</div>
              <div class="wf-step-sub">
                ${dur ? `<span>${dur}</span>` : ''}
                ${isFailed ? `<span class="wf-step-err">✕ ${step.errorCode || 'failed'}</span>` : ''}
                ${step.status === STATUS_SUCCEEDED ? '<span class="wf-step-ok">✓</span>' : ''}
              </div>
            </div>
          </div>
        </div>
      `

      // If step failed and is retryable, show decision diamond
      if (isFailed && step.retryable) {
        html += `
          <div class="wf-decision-row">
            <div class="wf-decision" style="grid-column:${li + 1}">
              <div class="wf-diamond">?</div>
              <span class="wf-decision-label">retry / rollback</span>
            </div>
          </div>
        `
      }
    }

    html += '</div>'
    return html
  }

  private renderConnector(fromLane: number, toLane: number, fromStatus: number): string {
    const color = fromStatus === STATUS_FAILED ? '#ef4444' :
                  fromStatus === STATUS_SUCCEEDED ? '#10b981' : '#4b5563'

    if (fromLane === toLane) {
      // Straight vertical connector
      return `
        <div class="wf-connector-row">
          <div class="wf-connector-v" style="grid-column:${fromLane + 1};border-color:${color}"></div>
        </div>
      `
    }

    // Cross-lane connector (horizontal + vertical)
    const minCol = Math.min(fromLane, toLane) + 1
    const maxCol = Math.max(fromLane, toLane) + 2
    return `
      <div class="wf-connector-row wf-connector-cross">
        <div class="wf-connector-h"
             style="grid-column:${minCol}/${maxCol};border-color:${color}">
          <span class="wf-handoff-label">→ ${LANES[toLane]?.label ?? ''}</span>
        </div>
      </div>
    `
  }

  private renderStepDetail(step: WorkflowStep): string {
    const fields: [string, string][] = [
      ['Step Key', step.stepKey],
      ['Actor', actorLabel(step.actor)],
      ['Phase', phaseLabel(step.phase)],
      ['Status', runStatusLabel(step.status)],
      ['Duration', step.durationMs > 0 ? formatDuration(step.durationMs) : '—'],
      ['Attempt', `${step.attempt}`],
    ]
    if (step.sourceActor) fields.push(['From', actorLabel(step.sourceActor)])
    if (step.targetActor) fields.push(['To', actorLabel(step.targetActor)])
    if (step.errorCode) fields.push(['Error Code', step.errorCode])
    if (step.errorMessage) fields.push(['Error', step.errorMessage])
    if (step.actionHint) fields.push(['Suggested Fix', step.actionHint])
    if (step.message && step.message !== step.errorMessage) fields.push(['Message', step.message])

    return `
      <div class="wf-detail">
        <h4>${step.title || step.stepKey}</h4>
        <div class="wf-detail-fields">
          ${fields.map(([k, v]) => `
            <div class="wf-detail-row">
              <span class="wf-detail-k">${k}</span>
              <span class="wf-detail-v">${v}</span>
            </div>
          `).join('')}
        </div>
        ${step.detailsJson ? `
          <details class="wf-raw"><summary>Raw JSON</summary>
            <pre>${step.detailsJson}</pre>
          </details>
        ` : ''}
      </div>
    `
  }

  private renderDiagnosis(diag: DiagnoseResult): string {
    const confColor = diag.confidence === 'high' ? '#10b981' :
                      diag.confidence === 'medium' ? '#f59e0b' : '#6b7280'
    return `
      <div class="wf-diag">
        <h4>Failure Diagnosis</h4>
        <span class="wf-diag-conf" style="color:${confColor}">● ${diag.confidence} confidence</span>
        <p class="wf-diag-text">${diag.diagnosis}</p>
        ${diag.suggestedAction ? `
          <div class="wf-diag-action">
            <strong>Suggested Action</strong>
            <p>${diag.suggestedAction}</p>
          </div>
        ` : ''}
        ${diag.relatedRunIds.length > 0 ? `
          <div class="wf-diag-related">${diag.relatedRunIds.length} similar failure${diag.relatedRunIds.length !== 1 ? 's' : ''} found</div>
        ` : ''}
      </div>
    `
  }

  private renderActions(run: WorkflowRun, isFailed: boolean): string {
    return `
      <div class="wf-actions">
        ${isFailed ? '<button class="wf-btn wf-btn-retry" id="btnRetry">↻ Retry</button>' : ''}
        ${!run.acknowledged ? '<button class="wf-btn wf-btn-ack" id="btnAck">✓ Acknowledge</button>' : '<span class="wf-ack-done">✓ Acknowledged</span>'}
        <button class="wf-btn wf-btn-diag" id="btnDiagnose">🔍 Diagnose</button>
      </div>
    `
  }

  // ─── Events ─────────────────────────────────────────────────────────────

  private bindEvents() {
    this.querySelector('#wfClose')?.addEventListener('click', () => this.close())
    this.querySelector('#wfOverlay')?.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).id === 'wfOverlay') this.close()
    })
    this.querySelectorAll<HTMLElement>('[data-step-seq]').forEach(el => {
      el.addEventListener('click', () => {
        const seq = parseInt(el.dataset.stepSeq ?? '0')
        this._selectedStep = this._steps.find(s => s.seq === seq) ?? null
        this.render()
      })
    })
    this.querySelector('#btnRetry')?.addEventListener('click', () => this.handleRetry())
    this.querySelector('#btnAck')?.addEventListener('click', () => this.handleAck())
    this.querySelector('#btnDiagnose')?.addEventListener('click', () => this.handleDiagnose())
    // ESC to close
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { this.close(); document.removeEventListener('keydown', esc) } }
    document.addEventListener('keydown', esc)
  }

  private async handleRetry() {
    if (!this._run) return
    try {
      const newRun = await retryWorkflowRun(this._clusterId, this._run.id)
      await this.loadRun(newRun.id)
    } catch (e: any) { this._error = `Retry failed: ${e?.message}`; this.render() }
  }

  private async handleAck() {
    if (!this._run) return
    try {
      await acknowledgeWorkflowRun(this._clusterId, this._run.id, 'admin-ui')
      this._run.acknowledged = true
      this.render()
    } catch (e: any) { this._error = `Acknowledge failed: ${e?.message}`; this.render() }
  }

  private async handleDiagnose() {
    if (!this._run) return
    try {
      this._diagnosis = await diagnoseWorkflowRun(this._clusterId, this._run.id)
      this.render()
    } catch (e: any) { this._error = `Diagnose failed: ${e?.message}`; this.render() }
  }

  close() { this.remove() }

  // ─── Styles ─────────────────────────────────────────────────────────────

  static styles(): string {
    return `
      /* Overlay */
      .wf-overlay {
        position: fixed; inset: 0; z-index: 1000;
        background: rgba(0,0,0,.65);
        display: flex; justify-content: center; align-items: flex-start;
        padding: 24px 12px; overflow-y: auto;
      }
      .wf-panel {
        background: var(--md-surface-container-low, #1a1a2e);
        border: 1px solid var(--border-subtle-color, #333);
        border-radius: 12px; width: 100%; max-width: 1200px;
        box-shadow: 0 24px 48px rgba(0,0,0,.4);
      }

      /* Header */
      .wf-header {
        border-bottom: 1px solid var(--border-subtle-color, #333);
        padding: 16px 20px 12px;
      }
      .wf-header-top { display: flex; align-items: center; gap: 12px; }
      .wf-title { margin: 0; font-size: 1rem; font-weight: 400; }
      .wf-title strong { font-weight: 700; }
      .wf-badge {
        padding: 3px 10px; border-radius: 4px;
        font-size: .7rem; font-weight: 700; text-transform: uppercase; color: #fff;
      }
      .wf-close-btn {
        background: transparent; border: none; color: var(--on-surface-color, #ccc);
        cursor: pointer; font-size: 1.1rem; padding: 4px 8px; border-radius: 4px;
      }
      .wf-close-btn:hover { background: rgba(255,255,255,.1); }
      .wf-header-meta {
        display: flex; gap: 16px; flex-wrap: wrap; margin-top: 8px;
        font-size: .74rem; color: var(--secondary-text-color, #888);
      }
      .wf-header-meta code { font-family: monospace; font-size: .72rem; }

      /* Body layout */
      .wf-body { display: flex; min-height: 420px; }
      .wf-flow-area {
        flex: 1; overflow-x: auto; overflow-y: auto;
        padding: 0 16px 16px; max-height: 70vh;
      }
      .wf-sidebar {
        width: 300px; min-width: 280px;
        border-left: 1px solid var(--border-subtle-color, #333);
        padding: 16px; overflow-y: auto; max-height: 70vh;
        font-size: .82rem;
      }
      @media(max-width: 900px) {
        .wf-body { flex-direction: column; }
        .wf-sidebar { width: 100%; border-left: none; border-top: 1px solid var(--border-subtle-color, #333); max-height: none; }
        .wf-flow-area { max-height: 50vh; }
      }

      /* Lane headers */
      .wf-lanes-header {
        display: grid;
        grid-template-columns: repeat(${LANES.length}, 1fr);
        gap: 8px; padding: 12px 0 8px;
        position: sticky; top: 0; z-index: 2;
        background: var(--md-surface-container-low, #1a1a2e);
      }
      .wf-lane-label {
        text-align: center; font-size: .68rem; font-weight: 700;
        text-transform: uppercase; letter-spacing: .06em;
        color: var(--secondary-text-color, #888);
        padding-bottom: 6px;
        border-bottom: 2px solid;
      }

      /* Flow container */
      .wf-flow { display: flex; flex-direction: column; gap: 0; padding-bottom: 16px; }

      /* Phase divider */
      .wf-phase-divider {
        display: flex; align-items: center; gap: 8px;
        padding: 12px 0 6px;
      }
      .wf-phase-divider::before, .wf-phase-divider::after {
        content: ''; flex: 1; height: 1px;
        background: var(--border-subtle-color, #333);
      }
      .wf-phase-divider span {
        font-size: .65rem; font-weight: 700; text-transform: uppercase;
        letter-spacing: .08em; color: var(--secondary-text-color, #888);
        white-space: nowrap;
      }

      /* Step row — uses grid matching lane columns */
      .wf-step-row {
        display: grid;
        grid-template-columns: repeat(${LANES.length}, 1fr);
        gap: 8px; padding: 4px 0;
      }

      /* Step node */
      .wf-step-node {
        display: flex; align-items: flex-start; gap: 8px;
        padding: 8px 10px; border-radius: 8px;
        border: 1.5px solid; cursor: pointer;
        transition: transform .1s, box-shadow .15s;
      }
      .wf-step-node:hover { transform: translateY(-1px); box-shadow: 0 4px 12px rgba(0,0,0,.3); }
      .wf-step-node.wf-selected { box-shadow: 0 0 0 2px var(--accent-color, #6366f1); }
      .wf-step-actor-dot {
        width: 8px; height: 8px; border-radius: 50%;
        flex-shrink: 0; margin-top: 4px;
      }
      .wf-step-content { flex: 1; min-width: 0; }
      .wf-step-title {
        font-size: .75rem; font-weight: 600; line-height: 1.3;
        overflow: hidden; text-overflow: ellipsis;
        display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
      }
      .wf-step-sub {
        display: flex; gap: 6px; margin-top: 2px;
        font-size: .65rem; color: var(--secondary-text-color, #888);
      }
      .wf-step-err { color: #ef4444; font-weight: 600; }
      .wf-step-ok { color: #10b981; }
      .wf-pulse { animation: wfPulse 1.5s ease-in-out infinite; }
      @keyframes wfPulse { 0%,100% { opacity: 1; } 50% { opacity: .5; } }

      /* Connectors */
      .wf-connector-row {
        display: grid;
        grid-template-columns: repeat(${LANES.length}, 1fr);
        gap: 8px; height: 20px;
      }
      .wf-connector-v {
        width: 2px; height: 100%; margin: 0 auto;
        border-left: 2px dashed;
      }
      .wf-connector-cross {
        position: relative; align-items: center;
      }
      .wf-connector-h {
        height: 2px; border-top: 2px dashed;
        display: flex; align-items: center; justify-content: center;
      }
      .wf-handoff-label {
        font-size: .6rem; color: var(--secondary-text-color, #888);
        background: var(--md-surface-container-low, #1a1a2e);
        padding: 0 6px; white-space: nowrap;
      }

      /* Decision diamond */
      .wf-decision-row {
        display: grid;
        grid-template-columns: repeat(${LANES.length}, 1fr);
        gap: 8px; padding: 4px 0; justify-items: center;
      }
      .wf-decision { display: flex; align-items: center; gap: 6px; }
      .wf-diamond {
        width: 24px; height: 24px;
        background: rgba(239,68,68,.2); border: 1.5px solid #ef4444;
        transform: rotate(45deg); display: flex; align-items: center; justify-content: center;
        font-size: .6rem; font-weight: 700; color: #ef4444;
      }
      .wf-diamond > * { transform: rotate(-45deg); }
      .wf-decision-label { font-size: .62rem; color: #ef4444; font-style: italic; }

      /* Sidebar: step detail */
      .wf-sidebar-hint { color: var(--secondary-text-color, #888); font-style: italic; font-size: .78rem; }
      .wf-detail h4 { margin: 0 0 10px; font-size: .85rem; }
      .wf-detail-fields { display: flex; flex-direction: column; gap: 4px; }
      .wf-detail-row { display: flex; gap: 8px; line-height: 1.4; }
      .wf-detail-k { font-weight: 600; min-width: 80px; color: var(--secondary-text-color, #888); font-size: .75rem; }
      .wf-detail-v { font-size: .78rem; word-break: break-word; }
      .wf-raw { margin-top: 10px; }
      .wf-raw summary { cursor: pointer; font-size: .7rem; color: var(--secondary-text-color, #888); }
      .wf-raw pre { font-size: .65rem; overflow-x: auto; margin-top: 4px; max-height: 120px; }

      /* Sidebar: diagnosis */
      .wf-diag { margin-top: 20px; padding-top: 16px; border-top: 1px solid var(--border-subtle-color, #333); }
      .wf-diag h4 { margin: 0 0 8px; font-size: .85rem; }
      .wf-diag-conf { font-size: .7rem; font-weight: 600; }
      .wf-diag-text { font-size: .76rem; line-height: 1.5; white-space: pre-wrap; margin: 8px 0; color: var(--on-surface-color, #ddd); }
      .wf-diag-action { margin-top: 12px; }
      .wf-diag-action strong { font-size: .7rem; text-transform: uppercase; color: var(--secondary-text-color, #888); }
      .wf-diag-action p { margin: 4px 0 0; font-size: .78rem; }
      .wf-diag-related { margin-top: 8px; font-size: .7rem; color: var(--secondary-text-color, #888); }

      /* Action buttons */
      .wf-actions {
        display: flex; gap: 8px; flex-wrap: wrap;
        margin-top: 20px; padding-top: 16px;
        border-top: 1px solid var(--border-subtle-color, #333);
      }
      .wf-btn {
        padding: 7px 14px; border-radius: 6px;
        font-size: .78rem; font-weight: 600; cursor: pointer; border: none;
        transition: filter .15s;
      }
      .wf-btn:hover { filter: brightness(1.15); }
      .wf-btn-retry { background: #10b981; color: #fff; }
      .wf-btn-ack { background: #3b82f6; color: #fff; }
      .wf-btn-diag { background: #8b5cf6; color: #fff; }
      .wf-ack-done { font-size: .75rem; color: #10b981; display: flex; align-items: center; }

      .wf-empty { padding: 32px; text-align: center; color: var(--secondary-text-color, #888); }
      .wf-error { padding: 20px; color: var(--error-color, #ef4444); font-size: .85rem; }
    `
  }
}

customElements.define('workflow-detail-panel', WorkflowDetailPanel)

/** Open the workflow detail panel for a service on a node. */
export function openWorkflowDetail(clusterId: string, nodeId: string, nodeHostname: string, componentName: string) {
  document.querySelector('workflow-detail-panel')?.remove()
  const panel = document.createElement('workflow-detail-panel') as WorkflowDetailPanel
  panel.setAttribute('cluster-id', clusterId)
  panel.setAttribute('node-id', nodeId)
  panel.setAttribute('node-hostname', nodeHostname)
  panel.setAttribute('component-name', componentName)
  document.body.appendChild(panel)
}
