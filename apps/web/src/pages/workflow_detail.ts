// src/pages/workflow_detail.ts
// Workflow Detail Panel — swimlane visualization of a reconciliation workflow run.
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

// ─── Phase columns (ordered) ────────────────────────────────────────────────

const PHASE_ORDER = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
const PHASE_LABELS = PHASE_ORDER.map(p => phaseLabel(p))

// ─── Actor rows (ordered by pipeline flow) ──────────────────────────────────

const ACTOR_ORDER = [1, 3, 4, 5] // controller, node-agent, installer, runtime
const ACTOR_LABELS = ACTOR_ORDER.map(a => actorLabel(a))

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
    if (this._clusterId && this._componentName) {
      this.loadLatest()
    }
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

      // Auto-diagnose if failed
      if (this._run.status === 9 || this._run.status === 11) {
        try {
          this._diagnosis = await diagnoseWorkflowRun(this._clusterId, runId)
        } catch { /* diagnosis is optional */ }
      }
    } catch (e: any) {
      this._error = e?.message || 'Failed to load workflow run'
    }
    this._loading = false
    this.render()
  }

  private render() {
    const run = this._run
    const steps = this._steps

    this.innerHTML = `
      <style>
        .wf-overlay {
          position: fixed; inset: 0; z-index: 1000;
          background: rgba(0,0,0,.6); display: flex; justify-content: center; align-items: flex-start;
          padding: 32px 16px; overflow-y: auto;
        }
        .wf-panel {
          background: var(--md-surface-container-low);
          border: 1px solid var(--border-subtle-color);
          border-radius: var(--md-shape-lg);
          width: 100%; max-width: 1200px;
          box-shadow: var(--md-elevation-3);
        }

        /* Header */
        .wf-header {
          display: flex; align-items: center; gap: 12px;
          padding: 16px 20px;
          border-bottom: 1px solid var(--border-subtle-color);
          flex-wrap: wrap;
        }
        .wf-header h3 { margin: 0; font: var(--md-typescale-title-medium); }
        .wf-header-meta {
          display: flex; gap: 16px; flex-wrap: wrap;
          font-size: .78rem; color: var(--secondary-text-color);
        }
        .wf-header-meta code { font-family: monospace; }
        .wf-close {
          margin-left: auto; background: transparent; border: none;
          color: var(--on-surface-color); cursor: pointer; font-size: 1.2rem; padding: 4px 8px;
        }

        /* Status badge */
        .wf-status {
          display: inline-block; padding: 2px 8px; border-radius: 4px;
          font-size: .72rem; font-weight: 700; text-transform: uppercase;
        }

        /* Content layout */
        .wf-content { display: flex; gap: 0; min-height: 400px; }
        .wf-main { flex: 1; overflow-x: auto; padding: 16px; }
        .wf-sidebar {
          width: 300px; min-width: 280px;
          border-left: 1px solid var(--border-subtle-color);
          padding: 16px; font-size: .82rem;
        }

        /* Swimlane grid */
        .wf-grid {
          display: grid;
          grid-template-columns: 120px repeat(${PHASE_ORDER.length}, 1fr);
          gap: 1px;
          background: var(--border-subtle-color);
          border-radius: var(--md-shape-sm);
          overflow: hidden;
        }
        .wf-grid-header {
          background: var(--md-surface-container);
          padding: 8px 6px;
          font-size: .68rem; font-weight: 700;
          text-transform: uppercase; letter-spacing: .05em;
          text-align: center;
          color: var(--secondary-text-color);
        }
        .wf-grid-actor {
          background: var(--md-surface-container);
          padding: 10px 8px;
          font-size: .72rem; font-weight: 600;
          display: flex; align-items: center;
          color: var(--on-surface-color);
        }
        .wf-grid-cell {
          background: var(--md-surface-container-low);
          padding: 6px;
          min-height: 50px;
          display: flex; flex-direction: column; gap: 4px;
          align-items: center; justify-content: center;
        }

        /* Step nodes */
        .wf-step {
          padding: 6px 8px; border-radius: 6px;
          font-size: .72rem; cursor: pointer;
          border: 1px solid transparent;
          text-align: center; width: 100%; max-width: 140px;
          transition: border-color .15s;
        }
        .wf-step:hover { border-color: var(--accent-color); }
        .wf-step-title { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .wf-step-dur { font-size: .65rem; opacity: .7; }
        .wf-step.wf-running { animation: wf-pulse 1.5s ease-in-out infinite; }
        @keyframes wf-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: .6; }
        }

        /* Step detail */
        .wf-step-detail {
          margin-top: 12px; padding: 12px;
          background: var(--md-surface-container);
          border-radius: var(--md-shape-sm);
          font-size: .78rem;
        }
        .wf-step-detail h4 { margin: 0 0 8px; font-size: .82rem; }
        .wf-step-detail .wf-detail-row {
          display: flex; gap: 8px; margin-bottom: 4px;
        }
        .wf-step-detail .wf-detail-label {
          font-weight: 600; min-width: 80px; color: var(--secondary-text-color);
        }

        /* Diagnosis */
        .wf-diag { margin-top: 16px; }
        .wf-diag h4 { margin: 0 0 8px; font-size: .82rem; }
        .wf-diag-text { white-space: pre-wrap; font-size: .75rem; line-height: 1.4; }
        .wf-diag-conf {
          display: inline-block; padding: 2px 6px; border-radius: 3px;
          font-size: .68rem; font-weight: 700; text-transform: uppercase;
          margin-bottom: 8px;
        }

        /* Action buttons */
        .wf-actions { display: flex; gap: 8px; margin-top: 16px; flex-wrap: wrap; }
        .wf-btn {
          padding: 6px 14px; border-radius: var(--md-shape-sm);
          font-size: .78rem; font-weight: 600; cursor: pointer; border: none;
        }
        .wf-btn-retry { background: var(--success-color); color: #fff; }
        .wf-btn-ack { background: #3b82f6; color: #fff; }
        .wf-btn-diagnose { background: #8b5cf6; color: #fff; }

        .wf-empty { padding: 32px; text-align: center; color: var(--secondary-text-color); }
        .wf-error { padding: 16px; color: var(--error-color); }

        @media(max-width: 900px) {
          .wf-content { flex-direction: column; }
          .wf-sidebar { width: 100%; border-left: none; border-top: 1px solid var(--border-subtle-color); }
        }
      </style>

      <div class="wf-overlay" id="wfOverlay">
        <div class="wf-panel">
          ${this._loading ? '<div class="wf-empty">Loading workflow…</div>' : ''}
          ${this._error ? `<div class="wf-error">${this._error}<br><button class="wf-close" id="wfClose" style="margin-top:8px">Close</button></div>` : ''}
          ${!this._loading && !this._error && run ? this.renderRun(run, steps) : ''}
          ${!this._loading && !this._error && !run ? '<div class="wf-empty">No workflow run data available</div>' : ''}
        </div>
      </div>
    `

    // Event handlers
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
    this.querySelector('#btnAck')?.addEventListener('click', () => this.handleAcknowledge())
    this.querySelector('#btnDiagnose')?.addEventListener('click', () => this.handleDiagnose())
  }

  private renderRun(run: WorkflowRun, steps: WorkflowStep[]): string {
    const ctx = run.context
    const isFailed = run.status === 9 || run.status === 11
    const statusBg = isFailed ? 'var(--error-color)' : runStatusColor(run.status)

    return `
      <!-- Header -->
      <div class="wf-header">
        <h3>Service: ${ctx?.componentName ?? this._componentName}</h3>
        <span class="wf-status" style="background:${statusBg};color:#fff">${runStatusLabel(run.status)}</span>
        <button class="wf-close" id="wfClose">✕</button>
      </div>
      <div style="padding:8px 20px;display:flex;gap:16px;flex-wrap:wrap;font-size:.75rem;color:var(--secondary-text-color);border-bottom:1px solid var(--border-subtle-color)">
        <span>Node: <strong>${ctx?.nodeHostname || ctx?.nodeId || this._nodeHostname || '—'}</strong></span>
        <span>Failure Class: <strong style="color:${isFailed ? 'var(--error-color)' : 'inherit'}">${failureClassLabel(run.failureClass)}</strong></span>
        <span>Retry Count: <strong>${run.retryCount}</strong></span>
        <span>Plan: <code style="font-family:monospace">${ctx?.planId?.slice(0, 8) || '—'}</code> (gen=${ctx?.planGeneration ?? '?'})</span>
        <span>Correlation: <code style="font-family:monospace">${run.correlationId?.slice(0, 16) || '—'}</code></span>
      </div>

      <!-- Content: swimlane + sidebar -->
      <div class="wf-content">
        <div class="wf-main">
          ${this.renderSwimlane(steps)}
        </div>
        <div class="wf-sidebar">
          ${this._selectedStep ? this.renderStepDetail(this._selectedStep) : '<div style="color:var(--secondary-text-color);font-style:italic">Click a step to see details</div>'}
          ${this._diagnosis ? this.renderDiagnosis(this._diagnosis) : ''}
          <div class="wf-actions">
            ${isFailed ? '<button class="wf-btn wf-btn-retry" id="btnRetry">Retry</button>' : ''}
            ${!run.acknowledged ? '<button class="wf-btn wf-btn-ack" id="btnAck">Acknowledge</button>' : ''}
            <button class="wf-btn wf-btn-diagnose" id="btnDiagnose">Diagnose</button>
          </div>
        </div>
      </div>
    `
  }

  private renderSwimlane(steps: WorkflowStep[]): string {
    // Build a lookup: [actor][phase] → steps
    const grid: Record<number, Record<number, WorkflowStep[]>> = {}
    for (const a of ACTOR_ORDER) {
      grid[a] = {}
      for (const p of PHASE_ORDER) grid[a][p] = []
    }
    for (const step of steps) {
      const a = ACTOR_ORDER.includes(step.actor) ? step.actor : 4 // default to installer
      const p = PHASE_ORDER.includes(step.phase) ? step.phase : 5 // default to install
      if (!grid[a]) { grid[a] = {}; for (const pp of PHASE_ORDER) grid[a][pp] = [] }
      if (!grid[a][p]) grid[a][p] = []
      grid[a][p].push(step)
    }

    // Header row
    let html = '<div class="wf-grid">'
    html += '<div class="wf-grid-header"></div>' // corner
    for (const label of PHASE_LABELS) {
      html += `<div class="wf-grid-header">${label}</div>`
    }

    // Actor rows
    for (let ai = 0; ai < ACTOR_ORDER.length; ai++) {
      const actor = ACTOR_ORDER[ai]
      html += `<div class="wf-grid-actor">${ACTOR_LABELS[ai]}</div>`
      for (const phase of PHASE_ORDER) {
        const cellSteps = grid[actor]?.[phase] ?? []
        html += '<div class="wf-grid-cell">'
        for (const step of cellSteps) {
          const bg = stepStatusColor(step.status)
          const isRunning = step.status === 1
          const isFailed = step.status === 3
          html += `
            <div class="wf-step ${isRunning ? 'wf-running' : ''}"
                 style="background:color-mix(in srgb, ${bg} 20%, transparent);border-color:${isFailed ? bg : 'transparent'}"
                 data-step-seq="${step.seq}" title="${step.title}">
              <div class="wf-step-title" style="color:${bg}">${step.title || step.stepKey}</div>
              ${step.durationMs > 0 ? `<div class="wf-step-dur">${step.durationMs}ms</div>` : ''}
            </div>`
        }
        html += '</div>'
      }
    }

    html += '</div>'
    return html
  }

  private renderStepDetail(step: WorkflowStep): string {
    const rows = [
      ['Step', step.stepKey],
      ['Title', step.title],
      ['Actor', actorLabel(step.actor)],
      ['Phase', phaseLabel(step.phase)],
      ['Status', runStatusLabel(step.status)],
      ['Duration', step.durationMs > 0 ? `${step.durationMs}ms` : '—'],
      ['Attempt', `${step.attempt}`],
    ]
    if (step.errorCode) rows.push(['Error Code', step.errorCode])
    if (step.errorMessage) rows.push(['Error', step.errorMessage])
    if (step.actionHint) rows.push(['Hint', step.actionHint])
    if (step.message) rows.push(['Message', step.message])

    return `
      <div class="wf-step-detail">
        <h4>${step.title || step.stepKey}</h4>
        ${rows.map(([label, value]) => `
          <div class="wf-detail-row">
            <span class="wf-detail-label">${label}</span>
            <span>${value}</span>
          </div>
        `).join('')}
        ${step.detailsJson ? `<details style="margin-top:8px"><summary style="cursor:pointer;font-size:.72rem">Raw details</summary><pre style="font-size:.68rem;overflow-x:auto;margin-top:4px">${step.detailsJson}</pre></details>` : ''}
      </div>
    `
  }

  private renderDiagnosis(diag: DiagnoseResult): string {
    const confColor = diag.confidence === 'high' ? 'var(--success-color)' :
                      diag.confidence === 'medium' ? '#f59e0b' : 'var(--secondary-text-color)'
    return `
      <div class="wf-diag">
        <h4>Failure Diagnosis</h4>
        <span class="wf-diag-conf" style="background:color-mix(in srgb, ${confColor} 20%, transparent);color:${confColor}">Confidence: ${diag.confidence}</span>
        <div class="wf-diag-text">${diag.diagnosis}</div>
        ${diag.suggestedAction ? `
          <div style="margin-top:12px">
            <strong style="font-size:.72rem;text-transform:uppercase;color:var(--secondary-text-color)">Suggested Action</strong>
            <div style="margin-top:4px">${diag.suggestedAction}</div>
          </div>
        ` : ''}
        ${diag.relatedRunIds.length > 0 ? `
          <div style="margin-top:8px;font-size:.72rem;color:var(--secondary-text-color)">
            Similar failures: ${diag.relatedRunIds.length} related run${diag.relatedRunIds.length !== 1 ? 's' : ''}
          </div>
        ` : ''}
      </div>
    `
  }

  private async handleRetry() {
    if (!this._run) return
    try {
      const newRun = await retryWorkflowRun(this._clusterId, this._run.id)
      await this.loadRun(newRun.id)
    } catch (e: any) {
      this._error = `Retry failed: ${e?.message}`
      this.render()
    }
  }

  private async handleAcknowledge() {
    if (!this._run) return
    try {
      await acknowledgeWorkflowRun(this._clusterId, this._run.id, 'admin-ui')
      this._run.acknowledged = true
      this.render()
    } catch (e: any) {
      this._error = `Acknowledge failed: ${e?.message}`
      this.render()
    }
  }

  private async handleDiagnose() {
    if (!this._run) return
    try {
      this._diagnosis = await diagnoseWorkflowRun(this._clusterId, this._run.id)
      this.render()
    } catch (e: any) {
      this._error = `Diagnose failed: ${e?.message}`
      this.render()
    }
  }

  close() {
    this.remove()
  }
}

customElements.define('workflow-detail-panel', WorkflowDetailPanel)

/** Helper: open the workflow detail panel for a service on a node. */
export function openWorkflowDetail(clusterId: string, nodeId: string, nodeHostname: string, componentName: string) {
  // Remove any existing panel
  document.querySelector('workflow-detail-panel')?.remove()

  const panel = document.createElement('workflow-detail-panel') as WorkflowDetailPanel
  panel.setAttribute('cluster-id', clusterId)
  panel.setAttribute('node-id', nodeId)
  panel.setAttribute('node-hostname', nodeHostname)
  panel.setAttribute('component-name', componentName)
  document.body.appendChild(panel)
}
