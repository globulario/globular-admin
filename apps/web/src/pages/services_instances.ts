// src/pages/services_instances.ts
import {
  getServicesConfiguration,
  startService,
  stopService,
  restartAllServices,
  type ServiceInstanceVM,
} from '@globular/backend'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function stateColor(state: string): string {
  const s = state.toLowerCase()
  if (s === 'running')  return 'var(--success-color)'
  if (s === 'closing')  return '#f59e0b'
  return 'var(--secondary-text-color)'
}

function badge(label: string, color: string): string {
  return `<span class="md-badge" style="--badge-color:${color}">${label.toUpperCase()}</span>`
}

function stateBadge(state: string): string {
  return badge(state || 'stopped', stateColor(state))
}

function pidLabel(pid: number): string {
  return pid > 0 ? `<span style="font-family:monospace;font-size:.78rem">${pid}</span>` : '—'
}

function truncate(s: string, max = 60): string {
  if (!s) return '—'
  return s.length > max ? s.slice(0, max) + '…' : s
}

// ─── Component ────────────────────────────────────────────────────────────────

class PageServicesInstances extends HTMLElement {
  private _services: ServiceInstanceVM[] = []
  private _loadError = ''
  private _loading = true
  private _selectedId = ''
  private _actionPending = ''   // id of service under action
  private _actionError = ''
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
    try {
      this._services = await getServicesConfiguration()
      this._loadError = ''
    } catch (e: any) {
      this._loadError = e?.message || 'ServicesManager unavailable'
    }
    this._loading = false
    this.render()
  }

  private render() {
    this.innerHTML = `
      <style>
        .si-wrap { padding: 16px; }
        .si-header { display: flex; align-items: center; gap: 12px; margin-bottom: 4px; }
        .si-header h2 { margin: 0; font: var(--md-typescale-headline-small); }
        .si-subtitle { margin: .25rem 0 1rem; opacity: .85; font: var(--md-typescale-body-medium); }
        .si-panel {
          background:    var(--md-surface-container-low);
          border:        1px solid var(--border-subtle-color);
          border-radius: var(--md-shape-md);
          box-shadow:    var(--md-elevation-1);
          overflow:      hidden;
          margin-bottom: 16px;
        }
        .si-panel-header {
          padding:         10px 14px;
          font:            var(--md-typescale-label-medium);
          font-size:       .72rem;
          text-transform:  uppercase;
          letter-spacing:  .06em;
          color:           var(--secondary-text-color);
          background:      var(--md-surface-container);
          border-bottom:   1px solid var(--border-subtle-color);
          display:         flex;
          align-items:     center;
          justify-content: space-between;
        }
        .si-table { width: 100%; border-collapse: collapse; font: var(--md-typescale-body-small); font-size: .72rem; }
        .si-table th {
          text-align:     left;
          padding:        8px 12px;
          font:           var(--md-typescale-label-medium);
          font-size:      .72rem;
          text-transform: uppercase;
          letter-spacing: .06em;
          color:          var(--secondary-text-color);
          border-bottom:  1px solid var(--border-subtle-color);
        }
        .si-table td { padding: 9px 12px; border-bottom: 1px solid var(--border-subtle-color); vertical-align: middle; }
        .si-table tr:last-child td { border-bottom: none; }
        .si-table tbody tr { cursor: pointer; }
        .si-table tbody tr:hover   td { background: var(--md-state-hover); }
        .si-table tbody tr.selected td { background: var(--md-state-selected); }
        .si-id     { font-family: monospace; font-size: .72rem; color: var(--secondary-text-color); max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .si-name   { font-weight: 600; }
        .si-err    { color: var(--error-color); font-size: .72rem; max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .si-empty  { padding: 14px; font: var(--md-typescale-body-medium); font-style: italic; color: var(--secondary-text-color); }
        .si-btn {
          border:        1px solid var(--border-subtle-color);
          background:    transparent;
          color:         var(--on-surface-color);
          border-radius: var(--md-shape-sm);
          padding:       3px 10px;
          cursor:        pointer;
          font:          var(--md-typescale-label-medium);
          font-size:     .72rem;
        }
        .si-btn:hover    { background: var(--md-state-hover); }
        .si-btn:disabled { opacity: .5; cursor: not-allowed; }
        .si-btn-accent {
          background:    var(--accent-color);
          color:         #fff;
          border-color:  var(--accent-color);
        }
        .si-btn-accent:hover { opacity: .88; }
        .si-btn-danger {
          color:       var(--error-color);
          border-color: color-mix(in srgb, var(--error-color) 40%, transparent);
        }
        .si-btn-danger:hover { background: color-mix(in srgb, var(--error-color) 10%, transparent); }
        .si-kv { display: flex; flex-direction: column; gap: 6px; }
        .si-kv-row { display: flex; gap: 12px; font-size: .78rem; }
        .si-kv-key { min-width: 110px; font-size: .72rem; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; color: var(--secondary-text-color); }
      </style>

      <div class="si-wrap">
        <div class="si-header">
          <h2>Service Instances</h2>
          <div style="flex:1"></div>
          <button class="si-btn" id="btnRestartAll" title="Restart all services on this node">↺ Restart All</button>
          <button class="si-btn" id="btnRefresh">↻ Refresh</button>
        </div>
        <p class="si-subtitle">Runtime status of every service instance managed by this node's ServicesManager.</p>

        ${this._loading ? `<p class="si-empty">Loading services…</p>` : ''}

        ${this._loadError ? `
        <div class="md-banner-warn">
          ⚠ Could not load service instances — ${this._loadError}
          <br><span style="font-size:.8em;opacity:.8">Ensure <code>services_manager.ServicesManagerService</code> is reachable.</span>
        </div>
        ` : ''}

        ${!this._loading && !this._loadError ? `
        <div class="si-panel">
          <div class="si-panel-header">
            <span>Instances (${this._services.length})</span>
            <span>
              <span class="md-badge" style="--badge-color:var(--success-color)">${this._services.filter(s => s.state === 'running').length} running</span>
              &nbsp;
              <span class="md-badge" style="--badge-color:var(--secondary-text-color)">${this._services.filter(s => s.state !== 'running').length} stopped</span>
            </span>
          </div>
          ${this._services.length > 0 ? `
          <table class="si-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Domain</th>
                <th>Version</th>
                <th>State</th>
                <th>Port</th>
                <th>PID</th>
                <th>Last Error</th>
              </tr>
            </thead>
            <tbody>
              ${this._services.map(svc => `
              <tr data-id="${svc.id}" class="${svc.id === this._selectedId ? 'selected' : ''}">
                <td class="si-name">${svc.name || svc.id}</td>
                <td style="color:var(--secondary-text-color)">${svc.domain || '—'}</td>
                <td style="font-family:monospace;font-size:.72rem">${svc.version || '—'}</td>
                <td>${stateBadge(svc.state)}</td>
                <td style="font-family:monospace;font-size:.72rem">${svc.port > 0 ? svc.port : '—'}</td>
                <td>${pidLabel(svc.process)}</td>
                <td class="${svc.lastError ? 'si-err' : ''}" title="${svc.lastError || ''}">${svc.lastError ? truncate(svc.lastError) : '—'}</td>
              </tr>`).join('')}
            </tbody>
          </table>
          ` : `<p class="si-empty">No service instances found.</p>`}
        </div>
        ` : ''}

        <div id="detail"></div>
      </div>
    `

    this.querySelector('#btnRefresh')?.addEventListener('click', () => this.load())
    this.querySelector('#btnRestartAll')?.addEventListener('click', () => this.doRestartAll())

    this.querySelectorAll<HTMLElement>('.si-table tbody tr[data-id]').forEach(tr => {
      tr.addEventListener('click', () => {
        const id = tr.dataset.id ?? ''
        this._selectedId = this._selectedId === id ? '' : id
        this._actionError = ''
        this.renderDetail()
        this.querySelectorAll<HTMLElement>('.si-table tbody tr[data-id]').forEach(r => {
          r.classList.toggle('selected', r.dataset.id === this._selectedId)
        })
      })
    })

    this.renderDetail()
  }

  private renderDetail() {
    const el = this.querySelector('#detail') as HTMLElement
    if (!el) return

    if (!this._selectedId) { el.innerHTML = ''; return }

    const svc = this._services.find(s => s.id === this._selectedId)
    if (!svc) { el.innerHTML = ''; return }

    const isPending = this._actionPending === svc.id
    const isRunning = svc.state === 'running'

    el.innerHTML = `
      <div class="si-panel">
        <div class="si-panel-header">
          <span>${svc.name || svc.id}</span>
          <span style="font-size:.78rem;font-weight:400;color:var(--secondary-text-color)">${svc.id}</span>
        </div>
        <div style="padding:14px 16px;display:flex;flex-direction:column;gap:12px;">

          <!-- Actions -->
          <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
            ${isRunning ? `
            <button class="si-btn si-btn-danger" id="btnStop" ${isPending ? 'disabled' : ''}>■ Stop</button>
            ` : `
            <button class="si-btn si-btn-accent" id="btnStart" ${isPending ? 'disabled' : ''}>▶ Start</button>
            `}
            ${this._actionError ? `<span style="font-size:.78rem;color:var(--error-color)">${this._actionError}</span>` : ''}
            ${isPending ? `<span style="font-size:.78rem;color:var(--secondary-text-color)">Working…</span>` : ''}
          </div>

          <!-- Key-value details -->
          <div class="si-kv">
            <div class="si-kv-row">
              <span class="si-kv-key">State</span>
              <span>${stateBadge(svc.state)}</span>
            </div>
            <div class="si-kv-row">
              <span class="si-kv-key">Domain</span>
              <span>${svc.domain || '—'}</span>
            </div>
            <div class="si-kv-row">
              <span class="si-kv-key">Version</span>
              <span style="font-family:monospace">${svc.version || '—'}</span>
            </div>
            <div class="si-kv-row">
              <span class="si-kv-key">Port</span>
              <span style="font-family:monospace">${svc.port > 0 ? svc.port : '—'}${svc.proxyPort > 0 ? ` / proxy ${svc.proxyPort}` : ''}</span>
            </div>
            <div class="si-kv-row">
              <span class="si-kv-key">PID</span>
              <span style="font-family:monospace">${svc.process > 0 ? svc.process : '—'}${svc.proxyProcess > 0 ? ` / proxy ${svc.proxyProcess}` : ''}</span>
            </div>
            <div class="si-kv-row">
              <span class="si-kv-key">Publisher</span>
              <span>${svc.publisherId || '—'}</span>
            </div>
            <div class="si-kv-row">
              <span class="si-kv-key">Keep Alive</span>
              <span>${svc.keepAlive ? badge('yes', 'var(--success-color)') : badge('no', 'var(--secondary-text-color)')}</span>
            </div>
            <div class="si-kv-row">
              <span class="si-kv-key">Auto Update</span>
              <span>${svc.keepUpToDate ? badge('yes', 'var(--success-color)') : badge('no', 'var(--secondary-text-color)')}</span>
            </div>
            ${svc.description ? `
            <div class="si-kv-row">
              <span class="si-kv-key">Description</span>
              <span style="opacity:.85">${svc.description}</span>
            </div>` : ''}
            ${svc.lastError ? `
            <div class="si-kv-row">
              <span class="si-kv-key">Last Error</span>
              <span style="color:var(--error-color);font-size:.78rem;word-break:break-all">${svc.lastError}</span>
            </div>` : ''}
          </div>
        </div>
      </div>
    `

    el.querySelector('#btnStart')?.addEventListener('click', () => this.doStart(svc.id))
    el.querySelector('#btnStop')?.addEventListener('click',  () => this.doStop(svc.id))
  }

  private async doStart(id: string) {
    this._actionPending = id
    this._actionError = ''
    this.renderDetail()
    try {
      await startService(id)
      await this.load()
    } catch (e: any) {
      this._actionError = e?.message || 'Start failed'
      this._actionPending = ''
      this.renderDetail()
    }
  }

  private async doStop(id: string) {
    this._actionPending = id
    this._actionError = ''
    this.renderDetail()
    try {
      await stopService(id)
      await this.load()
    } catch (e: any) {
      this._actionError = e?.message || 'Stop failed'
      this._actionPending = ''
      this.renderDetail()
    }
  }

  private async doRestartAll() {
    const btn = this.querySelector('#btnRestartAll') as HTMLButtonElement
    if (btn) { btn.disabled = true; btn.textContent = 'Restarting…' }
    try {
      await restartAllServices()
      // Give services a moment to settle before refreshing
      await new Promise(r => setTimeout(r, 2000))
      await this.load()
    } catch (e: any) {
      if (btn) { btn.disabled = false; btn.textContent = '↺ Restart All' }
      // surface error in a simple way — could use displayError from @globular/backend
      console.error('restartAllServices failed:', e?.message)
    }
  }
}

customElements.define('page-services-instances', PageServicesInstances)
