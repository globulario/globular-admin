import { queryEvents, type HistoricalEvent, type QueryEventsResult } from '@globular/backend'

function fmtTime(epoch: number): string {
  if (!epoch) return '—'
  return new Date(epoch * 1000).toLocaleString()
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + '…' : s
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function isControlPlaneEvent(name: string): boolean {
  return name.startsWith('plan_') || name.startsWith('service_apply_')
}

function severityColor(sev?: string): string {
  const s = (sev || '').toUpperCase()
  if (s === 'ERROR') return 'var(--error-color)'
  if (s === 'WARN') return '#f59e0b'
  return 'var(--secondary-text-color)'
}

class PageObservabilityEvents extends HTMLElement {
  private _events: HistoricalEvent[] = []
  private _latestSequence = 0
  private _loading = true
  private _error = ''
  private _filter = ''
  private _preset: 'all' | 'control_plane' = 'all'
  private _refreshTimer: number | null = null

  connectedCallback() {
    this.style.display = 'block'
    this.render()
    this.load()
    this._refreshTimer = window.setInterval(() => this.poll(), 10_000)
  }

  disconnectedCallback() {
    if (this._refreshTimer) clearInterval(this._refreshTimer)
  }

  private async load() {
    this._loading = true
    this._error = ''
    this.render()
    try {
      if (this._preset === 'control_plane') {
        const [planResult, serviceResult] = await Promise.allSettled([
          queryEvents({ nameFilter: 'plan_', limit: 200 }),
          queryEvents({ nameFilter: 'service_apply_', limit: 200 }),
        ])
        const merged: HistoricalEvent[] = []
        for (const r of [planResult, serviceResult]) {
          if (r.status === 'fulfilled') {
            merged.push(...r.value.events)
            if (r.value.latestSequence > this._latestSequence) {
              this._latestSequence = r.value.latestSequence
            }
          }
        }
        merged.sort((a, b) => b.sequence - a.sequence)
        this._events = merged.slice(0, 200)
      } else {
        const result = await queryEvents({
          nameFilter: this._filter,
          limit: 200,
        })
        this._events = result.events
        this._latestSequence = result.latestSequence
      }
      this._error = ''
    } catch (e: any) {
      this._error = e?.message || 'EventService unavailable'
    }
    this._loading = false
    this.render()
  }

  /** Incremental poll — only fetch events newer than the last sequence */
  private async poll() {
    if (this._loading) return
    try {
      if (this._preset === 'control_plane') {
        const [planResult, serviceResult] = await Promise.allSettled([
          queryEvents({ nameFilter: 'plan_', limit: 200, afterSequence: this._latestSequence }),
          queryEvents({ nameFilter: 'service_apply_', limit: 200, afterSequence: this._latestSequence }),
        ])
        const newEvents: HistoricalEvent[] = []
        for (const r of [planResult, serviceResult]) {
          if (r.status === 'fulfilled') {
            newEvents.push(...r.value.events)
            if (r.value.latestSequence > this._latestSequence) {
              this._latestSequence = r.value.latestSequence
            }
          }
        }
        if (newEvents.length > 0) {
          this._events = [...this._events, ...newEvents].slice(-500)
          this.render()
        }
      } else {
        const result = await queryEvents({
          nameFilter: this._filter,
          limit: 200,
          afterSequence: this._latestSequence,
        })
        if (result.events.length > 0) {
          this._events = [...this._events, ...result.events].slice(-500)
          this._latestSequence = result.latestSequence
          this.render()
        }
      }
    } catch { /* silently skip poll failures */ }
  }

  private renderEventRow(ev: HistoricalEvent): string {
    if (isControlPlaneEvent(ev.name)) {
      const sev = ev.dataJson?.severity as string | undefined
      const color = severityColor(sev)
      const msg = ev.dataJson?.message
        ? escHtml(ev.dataJson.message as string)
        : (ev.dataJson !== null ? escHtml(truncate(JSON.stringify(ev.dataJson), 120)) : `${ev.data.length} bytes`)
      const nodeId = ev.dataJson?.node_id ? `<span class="oe-meta">node:${escHtml(ev.dataJson.node_id as string)}</span>` : ''
      const svcField = ev.dataJson?.service ? `<span class="oe-meta">svc:${escHtml(ev.dataJson.service as string)}</span>` : ''
      const corrId = ev.dataJson?.correlation_id ? `<span class="oe-meta">${escHtml(ev.dataJson.correlation_id as string)}</span>` : ''
      return `
        <tr>
          <td class="oe-seq">${ev.sequence}</td>
          <td class="oe-mono">${fmtTime(ev.tsEpoch)}</td>
          <td><span class="oe-sev-badge" style="
            background:color-mix(in srgb,${color} 15%,transparent);
            color:${color}; border-color:color-mix(in srgb,${color} 30%,transparent);
          ">${escHtml(ev.name)}</span></td>
          <td class="oe-data-cell">
            <span style="color:${sev === 'ERROR' ? 'var(--error-color)' : 'var(--on-surface-color)'}">${msg}</span>
            <div class="oe-meta-row">${nodeId}${svcField}${corrId}</div>
          </td>
        </tr>`
    }
    const dataStr = ev.dataJson !== null
      ? truncate(JSON.stringify(ev.dataJson), 120)
      : `${ev.data.length} bytes`
    return `
      <tr>
        <td class="oe-seq">${ev.sequence}</td>
        <td class="oe-mono">${fmtTime(ev.tsEpoch)}</td>
        <td class="oe-name">${escHtml(ev.name)}</td>
        <td class="oe-data-cell oe-mono">${escHtml(dataStr)}</td>
      </tr>`
  }

  private render() {
    this.innerHTML = `
      <style>
        .oe-wrap { padding: 16px; }
        .oe-header { display: flex; align-items: center; gap: 12px; margin-bottom: 4px; }
        .oe-header h2 { margin: 0; font: var(--md-typescale-headline-small); }
        .oe-subtitle { margin: .25rem 0 1rem; opacity: .85; font: var(--md-typescale-body-medium); }
        .oe-presets { display: flex; gap: 6px; margin-bottom: 10px; }
        .oe-preset {
          padding: 4px 12px; border-radius: var(--md-shape-full);
          border: 1px solid var(--border-subtle-color);
          background: transparent; color: var(--on-surface-color);
          cursor: pointer; font: var(--md-typescale-label-medium);
          transition: background .15s, border-color .15s;
        }
        .oe-preset:hover { background: var(--md-state-hover); }
        .oe-preset.active {
          background: var(--accent-color); color: #fff;
          border-color: var(--accent-color);
        }
        .oe-toolbar { display: flex; gap: 8px; margin-bottom: 12px; align-items: center; }
        .oe-filter {
          flex: 1; max-width: 360px;
          padding: 5px 10px;
          border: 1px solid var(--border-subtle-color);
          border-radius: var(--md-shape-sm);
          background: var(--surface-color);
          color: var(--on-surface-color);
          font: var(--md-typescale-body-medium);
        }
        .oe-btn {
          border: 1px solid var(--border-subtle-color);
          background: transparent;
          color: var(--on-surface-color);
          border-radius: var(--md-shape-sm);
          padding: 3px 10px;
          cursor: pointer;
          font: var(--md-typescale-label-medium);
        }
        .oe-btn:hover { background: var(--md-state-hover); }
        .oe-empty { padding: 14px; font: var(--md-typescale-body-medium); font-style: italic; color: var(--secondary-text-color); }
        .oe-mono { font-family: monospace; font-size: .78rem; }
        .oe-seq { color: var(--secondary-text-color); font-size: .72rem; font-family: monospace; }
        .oe-name { font-weight: 600; }
        .oe-data-cell { max-width: 420px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .oe-poll-info { font-size: .72rem; color: var(--secondary-text-color); }
        .oe-sev-badge {
          display: inline-block; padding: 1px 6px; border-radius: var(--md-shape-full);
          font-size: .68rem; font-weight: 700; letter-spacing: .03em;
          border: 1px solid;
        }
        .oe-meta-row { display: flex; gap: 8px; margin-top: 2px; }
        .oe-meta {
          font-size: .68rem; color: var(--secondary-text-color);
          font-family: monospace; opacity: .8;
        }
      </style>

      <div class="oe-wrap">
        <div class="oe-header">
          <h2>Events</h2>
          <div style="flex:1"></div>
          <span class="oe-poll-info">${this._latestSequence > 0 ? `seq ${this._latestSequence} · auto-poll 10s` : ''}</span>
        </div>
        <p class="oe-subtitle">Recent cluster events from the in-memory ring buffer. Auto-polls every 10 seconds.</p>

        <div class="oe-presets">
          <button class="oe-preset${this._preset === 'all' ? ' active' : ''}" id="presetAll">All events</button>
          <button class="oe-preset${this._preset === 'control_plane' ? ' active' : ''}" id="presetCtrl">Control plane</button>
        </div>

        <div class="oe-toolbar">
          <input class="oe-filter" id="filterInput" type="text" placeholder="Filter by name prefix…" value="${escHtml(this._filter)}"${this._preset === 'control_plane' ? ' disabled' : ''}>
          <button class="oe-btn" id="btnApply"${this._preset === 'control_plane' ? ' disabled' : ''}>Apply</button>
          <button class="oe-btn" id="btnRefresh">↻ Refresh</button>
        </div>

        ${this._loading ? `<p class="oe-empty">Loading events…</p>` : ''}

        ${this._error ? `
        <div class="md-banner-warn">
          Could not load events — ${escHtml(this._error)}
          <br><span style="font-size:.8em;opacity:.8">Ensure <code>event.EventService</code> is reachable.</span>
        </div>
        ` : ''}

        ${!this._loading && !this._error ? `
        <div class="md-panel">
          <div class="md-panel-header">
            <span>Events (${this._events.length})</span>
          </div>
          ${this._events.length > 0 ? `
          <table class="md-table">
            <thead>
              <tr>
                <th>Seq</th>
                <th>Time</th>
                <th>Name</th>
                <th>Data</th>
              </tr>
            </thead>
            <tbody>
              ${[...this._events].reverse().map(ev => this.renderEventRow(ev)).join('')}
            </tbody>
          </table>
          ` : `<p class="oe-empty">No events recorded yet.</p>`}
        </div>
        ` : ''}
      </div>
    `

    // Wire event handlers
    const filterInput = this.querySelector('#filterInput') as HTMLInputElement | null
    this.querySelector('#btnApply')?.addEventListener('click', () => {
      this._filter = filterInput?.value ?? ''
      this._latestSequence = 0
      this.load()
    })
    filterInput?.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        this._filter = filterInput.value
        this._latestSequence = 0
        this.load()
      }
    })
    this.querySelector('#btnRefresh')?.addEventListener('click', () => {
      this._latestSequence = 0
      this.load()
    })
    this.querySelector('#presetCtrl')?.addEventListener('click', () => {
      this._preset = 'control_plane'
      this._filter = ''
      this._latestSequence = 0
      this.load()
    })
    this.querySelector('#presetAll')?.addEventListener('click', () => {
      this._preset = 'all'
      this._filter = ''
      this._latestSequence = 0
      this.load()
    })
  }
}
customElements.define('page-observability-events', PageObservabilityEvents)
