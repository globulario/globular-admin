import { queryLogs, parseLogEvent, type LogEntry, type QueryLogsOpts, Backend } from '@globular/backend'

// ─── Helpers ────────────────────────────────────────────────────────────────

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + '…' : s
}

function fmtTime(ms: number): string {
  if (!ms) return '—'
  return new Date(ms).toLocaleString()
}

function fmtTimeShort(ms: number): string {
  if (!ms) return '--:--:--'
  const d = new Date(ms)
  return d.toLocaleTimeString('en-GB', { hour12: false }) + '.' + String(d.getMilliseconds()).padStart(3, '0')
}

function levelColor(label: string): string {
  switch (label) {
    case 'FATAL': return '#dc2626'
    case 'ERROR': return 'var(--error-color, #ef4444)'
    case 'WARN': return '#f59e0b'
    case 'INFO': return 'var(--on-surface-color, #e0e0e0)'
    case 'DEBUG': return 'var(--secondary-text-color, #888)'
    case 'TRACE': return 'var(--secondary-text-color, #666)'
    default: return 'var(--on-surface-color)'
  }
}

function levelBadge(label: string): string {
  const c = levelColor(label)
  return `<span class="ol-level-badge" style="background:color-mix(in srgb,${c} 15%,transparent);color:${c};border-color:color-mix(in srgb,${c} 30%,transparent);">${label}</span>`
}

function appLink(app: string): string {
  if (!app) return '—'
  return `<a class="ol-app-link" href="#/services/${encodeURIComponent(app)}">${escHtml(app)}</a>`
}

// ─── Source Presets ──────────────────────────────────────────────────────────

interface SourcePreset {
  key: string
  label: string
  apps?: string[]
}

const SOURCES: SourcePreset[] = [
  { key: '', label: 'All' },
  { key: 'control_plane', label: 'Control Plane', apps: ['cluster_controller', 'node_agent'] },
  { key: 'runtime', label: 'Runtime Services', apps: ['dns', 'event', 'log', 'file', 'resource'] },
  { key: 'security', label: 'Security & Audit', apps: ['authentication', 'rbac'] },
  { key: 'media', label: 'Media', apps: ['media', 'title'] },
]

// ─── CSS ────────────────────────────────────────────────────────────────────

const STYLES = `
  .ol-wrap { padding: 16px; }
  .ol-header { display: flex; align-items: center; gap: 12px; margin-bottom: 4px; }
  .ol-header h2 { margin: 0; font: var(--md-typescale-headline-small); }
  .ol-subtitle { margin: .25rem 0 1rem; opacity: .85; font: var(--md-typescale-body-medium); }

  /* Tabs */
  .ol-tabs { display: flex; gap: 0; border-bottom: 1px solid var(--border-subtle-color); margin-bottom: 12px; }
  .ol-tab {
    padding: 8px 16px; border: none; background: transparent;
    color: var(--secondary-text-color); cursor: pointer;
    font: var(--md-typescale-label-large);
    border-bottom: 2px solid transparent; transition: all .15s;
  }
  .ol-tab:hover { color: var(--on-surface-color); background: var(--md-state-hover); }
  .ol-tab.active { color: var(--accent-color); border-bottom-color: var(--accent-color); }

  /* Presets */
  .ol-presets { display: flex; gap: 6px; margin-bottom: 10px; flex-wrap: wrap; }
  .ol-preset {
    padding: 4px 12px; border-radius: var(--md-shape-full);
    border: 1px solid var(--border-subtle-color);
    background: transparent; color: var(--on-surface-color);
    cursor: pointer; font: var(--md-typescale-label-medium);
    transition: background .15s, border-color .15s;
  }
  .ol-preset:hover { background: var(--md-state-hover); }
  .ol-preset.active { background: var(--accent-color); color: #fff; border-color: var(--accent-color); }

  /* Controls */
  .ol-toolbar { display: flex; gap: 8px; margin-bottom: 12px; align-items: center; flex-wrap: wrap; }
  .ol-input {
    padding: 5px 10px;
    border: 1px solid var(--border-subtle-color);
    border-radius: var(--md-shape-sm);
    background: var(--surface-color);
    color: var(--on-surface-color);
    font: var(--md-typescale-body-medium);
  }
  .ol-input-sm { max-width: 180px; }
  .ol-input-md { max-width: 260px; }
  .ol-input-lg { flex: 1; max-width: 360px; }
  .ol-select {
    padding: 5px 10px;
    border: 1px solid var(--border-subtle-color);
    border-radius: var(--md-shape-sm);
    background: var(--surface-color);
    color: var(--on-surface-color);
    font: var(--md-typescale-body-medium);
  }
  .ol-btn {
    border: 1px solid var(--border-subtle-color);
    background: transparent; color: var(--on-surface-color);
    border-radius: var(--md-shape-sm);
    padding: 5px 12px; cursor: pointer;
    font: var(--md-typescale-label-medium);
    transition: background .15s;
  }
  .ol-btn:hover { background: var(--md-state-hover); }
  .ol-btn-primary {
    background: var(--accent-color); color: #fff;
    border-color: var(--accent-color);
  }
  .ol-btn-primary:hover { opacity: .9; }
  .ol-btn-danger { color: #ef4444; border-color: #ef4444; }

  /* Table */
  .ol-empty { padding: 14px; font: var(--md-typescale-body-medium); font-style: italic; color: var(--secondary-text-color); }
  .ol-mono { font-family: monospace; font-size: .78rem; }
  .ol-level-badge {
    display: inline-block; padding: 1px 6px; border-radius: var(--md-shape-full);
    font-size: .68rem; font-weight: 700; letter-spacing: .03em;
    border: 1px solid; white-space: nowrap;
  }
  .ol-app-link {
    color: var(--accent-color); text-decoration: none;
    font-family: monospace; font-size: .78rem;
  }
  .ol-app-link:hover { text-decoration: underline; }
  .ol-corr-link {
    color: var(--accent-color); text-decoration: none;
    font-family: monospace; font-size: .72rem; cursor: pointer;
  }
  .ol-corr-link:hover { text-decoration: underline; }

  /* Live tail */
  .ol-tail-output {
    background: var(--surface-color);
    border: 1px solid var(--border-subtle-color);
    border-radius: var(--md-shape-sm);
    max-height: 520px; overflow-y: auto;
    font-family: monospace; font-size: .78rem;
    padding: 0;
  }
  .ol-tail-row {
    padding: 3px 8px; border-bottom: 1px solid color-mix(in srgb, var(--border-subtle-color) 30%, transparent);
    line-height: 1.4; cursor: pointer; transition: background .1s;
  }
  .ol-tail-row:hover { background: var(--md-state-hover); }
  .ol-tail-ts { color: var(--secondary-text-color); margin-right: 6px; }
  .ol-tail-app { color: var(--accent-color); margin: 0 6px; }
  .ol-tail-msg { }
  .ol-tail-detail {
    padding: 6px 8px 8px 24px; background: color-mix(in srgb, var(--surface-color) 60%, transparent);
    font-size: .72rem; line-height: 1.5;
    border-bottom: 1px solid var(--border-subtle-color);
  }
  .ol-tail-detail dt { color: var(--secondary-text-color); display: inline; }
  .ol-tail-detail dd { display: inline; margin: 0 12px 0 4px; }

  /* Severity checkboxes in tail */
  .ol-sev-filters { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
  .ol-sev-filters label { font: var(--md-typescale-label-medium); cursor: pointer; display: flex; align-items: center; gap: 3px; }

  /* Overview cards */
  .ol-cards { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 16px; }
  @media (max-width: 800px) { .ol-cards { grid-template-columns: 1fr; } }
  .ol-card {
    border: 1px solid var(--border-subtle-color);
    border-radius: var(--md-shape-sm); padding: 12px;
    background: var(--surface-color);
  }
  .ol-card h3 { margin: 0 0 8px; font: var(--md-typescale-title-small); }

  /* Info banner */
  .ol-info {
    padding: 8px 12px; margin-bottom: 12px;
    border: 1px solid color-mix(in srgb, var(--accent-color) 30%, transparent);
    border-radius: var(--md-shape-sm);
    background: color-mix(in srgb, var(--accent-color) 8%, transparent);
    font: var(--md-typescale-body-small);
    color: var(--on-surface-color); opacity: .9;
  }

  /* Correlation */
  .ol-corr-banner {
    padding: 8px 12px; margin-bottom: 12px;
    border: 1px dashed var(--accent-color);
    border-radius: var(--md-shape-sm);
    background: color-mix(in srgb, var(--accent-color) 6%, transparent);
    font: var(--md-typescale-body-small);
    display: flex; align-items: center; gap: 8px;
  }
  .ol-corr-meta { font: var(--md-typescale-body-small); color: var(--secondary-text-color); margin-bottom: 8px; }

  /* Status bar */
  .ol-status { font-size: .72rem; color: var(--secondary-text-color); }
  .ol-dropped { color: #f59e0b; font-weight: 600; }

  /* Expanded row detail in search results */
  .ol-row-detail {
    padding: 8px 12px; background: color-mix(in srgb, var(--surface-color) 60%, transparent);
    font-family: monospace; font-size: .72rem; line-height: 1.5;
  }
  .ol-row-detail .ol-field { margin-right: 16px; }
  .ol-row-detail .ol-field-key { color: var(--secondary-text-color); }
`

// ─── Component ──────────────────────────────────────────────────────────────

type Tab = 'overview' | 'tail' | 'search'

class PageObservabilityLogs extends HTMLElement {
  // --- State ---
  private _tab: Tab = 'overview'
  private _correlationId = ''
  private _correlationResults: LogEntry[] = []
  private _correlationLoading = false

  // Overview
  private _overviewFatals: LogEntry[] = []
  private _overviewErrors: LogEntry[] = []
  private _overviewLoading = true
  private _overviewError = ''
  private _overviewTimer: number | null = null

  // Live tail
  private _tailRunning = false
  private _tailPaused = false
  private _tailAutoScroll = true
  private _tailBuffer: LogEntry[] = []
  private _tailDropped = 0
  private _tailSubId = ''
  private _tailRafId = 0
  private _tailFilterLevels = new Set(['FATAL', 'ERROR', 'WARN', 'INFO', 'DEBUG', 'TRACE'])
  private _tailFilterApp = ''
  private _tailFilterContains = ''
  private _tailFilterCorrelation = ''
  private _tailPreset = ''
  private _tailExpandedIdx = -1

  // Search
  private _searchResults: LogEntry[] = []
  private _searchLoading = false
  private _searchError = ''
  private _searchLevel = 'error'
  private _searchApp = ''
  private _searchSince = ''
  private _searchUntil = ''
  private _searchContains = ''
  private _searchNode = ''
  private _searchLimit = 100
  private _searchPreset = ''
  private _searchExpandedIdx = -1

  private static TAIL_MAX = 500

  connectedCallback() {
    this.style.display = 'block'
    this._parseUrlParams()
    this.render()
    if (this._tab === 'overview') this._loadOverview()
  }

  disconnectedCallback() {
    this._stopOverviewTimer()
    this._stopTail()
  }

  private _parseUrlParams() {
    const hash = location.hash
    const qIdx = hash.indexOf('?')
    if (qIdx < 0) return
    const params = new URLSearchParams(hash.slice(qIdx + 1))
    const tab = params.get('tab')
    if (tab === 'tail') this._tab = 'tail'
    else if (tab === 'search') this._tab = 'search'
    else if (tab === 'correlation') {
      this._tab = 'search'
      this._correlationId = params.get('id') || ''
    }
  }

  // ─── Overview ───────────────────────────────────────────────────────────

  private async _loadOverview() {
    this._overviewLoading = true
    this._overviewError = ''
    this.render()
    try {
      const [fatals, errors] = await Promise.allSettled([
        queryLogs({ level: 'fatal', limit: 10, order: 'desc' }),
        queryLogs({ level: 'error', limit: 200, order: 'desc' }),
      ])
      this._overviewFatals = fatals.status === 'fulfilled' ? fatals.value : []
      this._overviewErrors = errors.status === 'fulfilled' ? errors.value : []
      this._overviewError = ''
    } catch (e: any) {
      this._overviewError = e?.message || 'LogService unavailable'
    }
    this._overviewLoading = false
    this.render()
    this._startOverviewTimer()
  }

  private _startOverviewTimer() {
    this._stopOverviewTimer()
    this._overviewTimer = window.setInterval(() => this._loadOverview(), 30_000)
  }

  private _stopOverviewTimer() {
    if (this._overviewTimer) { clearInterval(this._overviewTimer); this._overviewTimer = null }
  }

  private _renderOverview(): string {
    if (this._overviewLoading && this._overviewFatals.length === 0) {
      return `<p class="ol-empty">Loading overview…</p>`
    }
    if (this._overviewError) {
      return `
        <div class="md-banner-warn">
          Could not load logs — ${escHtml(this._overviewError)}
          <br><span style="font-size:.8em;opacity:.8">Ensure <code>log.LogService</code> is reachable.</span>
        </div>`
    }

    // Aggregate errors by application
    const errorsByApp = new Map<string, number>()
    for (const e of this._overviewErrors) {
      const app = e.application || '(unknown)'
      errorsByApp.set(app, (errorsByApp.get(app) || 0) + (e.occurences || 1))
    }
    const topErrors = [...errorsByApp.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)

    return `
      <div class="ol-info">
        Logs retention: 7 days. Persisted levels: ERROR, FATAL. Other levels available only via Live Tail.
      </div>

      <div class="ol-cards">
        <div class="ol-card">
          <h3>Recent Fatals (${this._overviewFatals.length})</h3>
          ${this._overviewFatals.length > 0 ? `
          <table class="md-table" style="width:100%">
            <thead><tr><th>Time</th><th>Node</th><th>Application</th><th>Message</th></tr></thead>
            <tbody>
              ${this._overviewFatals.map(f => `
                <tr>
                  <td class="ol-mono">${escHtml(fmtTime(f.timestampMs))}</td>
                  <td class="ol-mono">${escHtml(f.nodeId || '')}</td>
                  <td>${appLink(f.application)}</td>
                  <td class="ol-mono" style="max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(truncate(f.message, 100))}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
          ` : `<p class="ol-empty">No recent fatals.</p>`}
        </div>

        <div class="ol-card">
          <h3>Top Error Sources</h3>
          ${topErrors.length > 0 ? `
          <table class="md-table" style="width:100%">
            <thead><tr><th>Application</th><th>Count</th></tr></thead>
            <tbody>
              ${topErrors.map(([app, count]) => `
                <tr>
                  <td>${appLink(app)}</td>
                  <td style="font-weight:600">${count}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
          ` : `<p class="ol-empty">No errors recorded.</p>`}
        </div>
      </div>

      <div style="display:flex;gap:8px;margin-top:8px">
        <button class="ol-btn" id="olGoTail">Open Live Tail</button>
        <button class="ol-btn" id="olGoSearch">Search Errors</button>
      </div>
      <span class="ol-status" style="margin-left:8px">Auto-refresh 30s</span>
    `
  }

  // ─── Live Tail ──────────────────────────────────────────────────────────

  private _startTail() {
    if (this._tailRunning) return
    this._tailRunning = true
    this._tailDropped = 0
    this._tailBuffer = []
    this._tailExpandedIdx = -1

    Backend.subscribe('new_log_evt', (uuid: string) => {
      this._tailSubId = uuid
    }, (data: any) => {
      const entry = parseLogEvent(data)
      if (!entry) return
      if (this._tailPaused) {
        // still buffer while paused
      }
      if (this._tailBuffer.length >= PageObservabilityLogs.TAIL_MAX) {
        this._tailBuffer.shift()
        this._tailDropped++
      }
      this._tailBuffer.push(entry)
      this._scheduleTailRender()
    }, false)
  }

  private _stopTail() {
    if (!this._tailRunning) return
    this._tailRunning = false
    if (this._tailSubId) {
      Backend.unsubscribe('new_log_evt', this._tailSubId)
      this._tailSubId = ''
    }
    if (this._tailRafId) {
      cancelAnimationFrame(this._tailRafId)
      this._tailRafId = 0
    }
  }

  private _scheduleTailRender() {
    if (this._tailRafId) return
    this._tailRafId = requestAnimationFrame(() => {
      this._tailRafId = 0
      if (this._tailPaused) return
      this._renderTailOutput()
    })
  }

  private _tailFiltered(): LogEntry[] {
    let items = this._tailBuffer
    // Level filter
    items = items.filter(e => this._tailFilterLevels.has(e.levelLabel))
    // App filter
    if (this._tailFilterApp) {
      const f = this._tailFilterApp.toLowerCase()
      items = items.filter(e => e.application.toLowerCase().includes(f))
    }
    // Preset filter
    if (this._tailPreset) {
      const preset = SOURCES.find(s => s.key === this._tailPreset)
      if (preset?.apps) {
        const prefixes = preset.apps
        items = items.filter(e => prefixes.some(p => e.application.toLowerCase().includes(p)))
      }
    }
    // Contains filter
    if (this._tailFilterContains) {
      const f = this._tailFilterContains.toLowerCase()
      items = items.filter(e => e.message.toLowerCase().includes(f))
    }
    // Correlation filter
    if (this._tailFilterCorrelation) {
      const f = this._tailFilterCorrelation
      items = items.filter(e => e.fields.correlation_id === f)
    }
    return items
  }

  private _renderTailOutput() {
    const container = this.querySelector('#olTailOutput') as HTMLElement | null
    if (!container) return
    const items = this._tailFiltered()

    const html = items.map((e, i) => {
      const expanded = this._tailExpandedIdx === i
      return `
        <div class="ol-tail-row" data-tail-idx="${i}">
          <span class="ol-tail-ts">${fmtTimeShort(e.timestampMs)}</span>
          ${levelBadge(e.levelLabel)}
          <span class="ol-tail-app">${escHtml(e.application)}</span>
          <span class="ol-tail-msg">${escHtml(truncate(e.message, 200))}</span>
        </div>
        ${expanded ? this._renderTailDetail(e) : ''}
      `
    }).join('')

    container.innerHTML = html || '<div class="ol-empty">Waiting for log events…</div>'

    // Status
    const statusEl = this.querySelector('#olTailStatus') as HTMLElement | null
    if (statusEl) {
      const parts: string[] = [`${items.length}/${this._tailBuffer.length} entries`]
      if (this._tailDropped > 0) parts.push(`<span class="ol-dropped">${this._tailDropped} dropped</span>`)
      if (this._tailPaused) parts.push('PAUSED')
      statusEl.innerHTML = parts.join(' · ')
    }

    // Auto-scroll
    if (this._tailAutoScroll) {
      container.scrollTop = container.scrollHeight
    }
  }

  private _renderTailDetail(e: LogEntry): string {
    const fields = Object.entries(e.fields)
    const corrId = e.fields.correlation_id
    return `
      <div class="ol-tail-detail">
        <dl style="margin:0">
          ${e.nodeId ? `<dt>node</dt><dd>${escHtml(e.nodeId)}</dd>` : ''}
          ${e.method ? `<dt>method</dt><dd>${escHtml(e.method)}</dd>` : ''}
          ${e.line ? `<dt>line</dt><dd>${escHtml(e.line)}</dd>` : ''}
          ${e.component ? `<dt>component</dt><dd>${escHtml(e.component)}</dd>` : ''}
          ${e.occurences > 1 ? `<dt>occurences</dt><dd>${e.occurences}</dd>` : ''}
          ${corrId ? `<dt>correlation_id</dt><dd><span class="ol-corr-link" data-corr="${escHtml(corrId)}">${escHtml(corrId)}</span></dd>` : ''}
          ${fields.filter(([k]) => k !== 'correlation_id').map(([k, v]) => `<dt>${escHtml(k)}</dt><dd>${escHtml(v)}</dd>`).join('')}
        </dl>
        <details style="margin-top:4px"><summary style="cursor:pointer;font-size:.68rem;color:var(--secondary-text-color)">Raw JSON</summary><pre style="margin:4px 0;white-space:pre-wrap;word-break:break-all">${escHtml(JSON.stringify(e, null, 2))}</pre></details>
      </div>
    `
  }

  private _renderTail(): string {
    const sevLabels = ['FATAL', 'ERROR', 'WARN', 'INFO', 'DEBUG', 'TRACE']

    return `
      <div class="ol-toolbar">
        ${this._tailRunning
          ? `<button class="ol-btn ol-btn-danger" id="olTailStop">Stop</button>`
          : `<button class="ol-btn ol-btn-primary" id="olTailStart">Start</button>`
        }
        ${this._tailRunning ? `
          <button class="ol-btn" id="olTailPause">${this._tailPaused ? 'Resume' : 'Pause'}</button>
          <label style="font:var(--md-typescale-label-medium);display:flex;align-items:center;gap:3px">
            <input type="checkbox" id="olTailAutoScroll" ${this._tailAutoScroll ? 'checked' : ''}> Auto-scroll
          </label>
        ` : ''}
        <span class="ol-status" id="olTailStatus"></span>
      </div>

      <div class="ol-sev-filters" style="margin-bottom:8px">
        ${sevLabels.map(l => `
          <label><input type="checkbox" data-sev="${l}" ${this._tailFilterLevels.has(l) ? 'checked' : ''}> <span style="color:${levelColor(l)}">${l}</span></label>
        `).join('')}
      </div>

      <div class="ol-presets" style="margin-bottom:8px">
        ${SOURCES.map(s => `<button class="ol-preset${this._tailPreset === s.key ? ' active' : ''}" data-tail-preset="${s.key}">${escHtml(s.label)}</button>`).join('')}
      </div>

      <div class="ol-toolbar">
        <input class="ol-input ol-input-sm" id="olTailApp" type="text" placeholder="Application…" value="${escHtml(this._tailFilterApp)}">
        <input class="ol-input ol-input-md" id="olTailContains" type="text" placeholder="Contains…" value="${escHtml(this._tailFilterContains)}">
        <input class="ol-input ol-input-sm" id="olTailCorr" type="text" placeholder="Correlation ID…" value="${escHtml(this._tailFilterCorrelation)}">
      </div>

      <div class="ol-tail-output" id="olTailOutput">
        <div class="ol-empty">${this._tailRunning ? 'Waiting for log events…' : 'Press Start to begin streaming.'}</div>
      </div>
    `
  }

  // ─── Search ─────────────────────────────────────────────────────────────

  private async _doSearch() {
    this._searchLoading = true
    this._searchError = ''
    this._searchExpandedIdx = -1
    this.render()

    const opts: QueryLogsOpts = {
      level: this._searchLevel,
      limit: this._searchLimit,
      order: 'desc',
    }
    if (this._searchApp) opts.application = this._searchApp
    if (this._searchNode) opts.node = this._searchNode
    if (this._searchContains) opts.contains = this._searchContains
    if (this._searchSince) {
      const d = new Date(this._searchSince)
      if (!isNaN(d.getTime())) opts.sinceMs = d.getTime()
    }
    if (this._searchUntil) {
      const d = new Date(this._searchUntil)
      if (!isNaN(d.getTime())) opts.untilMs = d.getTime()
    }
    // Preset filter — pick first matching app prefix
    if (this._searchPreset) {
      const preset = SOURCES.find(s => s.key === this._searchPreset)
      if (preset?.apps && !this._searchApp) {
        opts.application = preset.apps[0]
      }
    }

    try {
      this._searchResults = await queryLogs(opts)
    } catch (e: any) {
      this._searchError = e?.message || 'Query failed'
    }
    this._searchLoading = false
    this.render()
  }

  private _renderSearch(): string {
    return `
      <div class="ol-info">Search queries only ERROR and FATAL logs (persisted 7 days). For other levels, use Live Tail.</div>

      <div class="ol-presets" style="margin-bottom:8px">
        ${SOURCES.map(s => `<button class="ol-preset${this._searchPreset === s.key ? ' active' : ''}" data-search-preset="${s.key}">${escHtml(s.label)}</button>`).join('')}
      </div>

      <div class="ol-toolbar">
        <select class="ol-select" id="olSearchLevel">
          <option value="error" ${this._searchLevel === 'error' ? 'selected' : ''}>ERROR</option>
          <option value="fatal" ${this._searchLevel === 'fatal' ? 'selected' : ''}>FATAL</option>
        </select>
        <input class="ol-input ol-input-sm" id="olSearchApp" type="text" placeholder="Application…" value="${escHtml(this._searchApp)}">
        <input class="ol-input ol-input-sm" id="olSearchNode" type="text" placeholder="Node…" value="${escHtml(this._searchNode)}">
        <input class="ol-input" id="olSearchSince" type="datetime-local" title="Since" value="${this._searchSince}">
        <input class="ol-input" id="olSearchUntil" type="datetime-local" title="Until" value="${this._searchUntil}">
        <input class="ol-input ol-input-md" id="olSearchContains" type="text" placeholder="Contains…" value="${escHtml(this._searchContains)}">
        <input class="ol-input" id="olSearchLimit" type="number" min="1" max="1000" value="${this._searchLimit}" style="width:70px" title="Limit">
        <button class="ol-btn ol-btn-primary" id="olSearchBtn">Search</button>
      </div>

      ${this._searchLoading ? `<p class="ol-empty">Searching…</p>` : ''}

      ${this._searchError ? `
        <div class="md-banner-warn">
          ${escHtml(this._searchError)}
          <br><span style="font-size:.8em;opacity:.8">Ensure <code>log.LogService</code> is reachable.</span>
        </div>
      ` : ''}

      ${!this._searchLoading && !this._searchError ? `
        <div class="md-panel">
          <div class="md-panel-header"><span>Results (${this._searchResults.length})</span></div>
          ${this._searchResults.length > 0 ? `
          <table class="md-table" style="width:100%">
            <thead><tr><th>Time</th><th>Level</th><th>Node</th><th>Application</th><th>Method</th><th>Component</th><th>Message</th><th>Occ.</th></tr></thead>
            <tbody>
              ${this._searchResults.map((e, i) => this._renderSearchRow(e, i)).join('')}
            </tbody>
          </table>
          ` : `<p class="ol-empty">No results. Try broadening your filters.</p>`}
        </div>
      ` : ''}
    `
  }

  private _renderSearchRow(e: LogEntry, idx: number): string {
    const expanded = this._searchExpandedIdx === idx
    const corrId = e.fields.correlation_id
    const fields = Object.entries(e.fields)
    return `
      <tr class="ol-search-row" data-search-idx="${idx}" style="cursor:pointer">
        <td class="ol-mono">${escHtml(fmtTime(e.timestampMs))}</td>
        <td>${levelBadge(e.levelLabel)}</td>
        <td class="ol-mono">${escHtml(e.nodeId || '')}</td>
        <td>${appLink(e.application)}</td>
        <td class="ol-mono">${escHtml(e.method)}</td>
        <td class="ol-mono">${escHtml(e.component)}</td>
        <td class="ol-mono" style="max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(truncate(e.message, 120))}</td>
        <td>${e.occurences > 1 ? e.occurences : ''}</td>
      </tr>
      ${expanded ? `
      <tr><td colspan="8" class="ol-row-detail">
        ${e.nodeId ? `<span class="ol-field"><span class="ol-field-key">node:</span> ${escHtml(e.nodeId)}</span>` : ''}
        ${e.method ? `<span class="ol-field"><span class="ol-field-key">method:</span> ${escHtml(e.method)}</span>` : ''}
        ${e.line ? `<span class="ol-field"><span class="ol-field-key">line:</span> ${escHtml(e.line)}</span>` : ''}
        ${e.component ? `<span class="ol-field"><span class="ol-field-key">component:</span> ${escHtml(e.component)}</span>` : ''}
        ${corrId ? `<span class="ol-field"><span class="ol-field-key">correlation_id:</span> <span class="ol-corr-link" data-corr="${escHtml(corrId)}">${escHtml(corrId)}</span></span>` : ''}
        ${fields.filter(([k]) => k !== 'correlation_id').map(([k, v]) => `<span class="ol-field"><span class="ol-field-key">${escHtml(k)}:</span> ${escHtml(v)}</span>`).join('')}
        <details style="margin-top:4px"><summary style="cursor:pointer;font-size:.68rem;color:var(--secondary-text-color)">Raw JSON</summary><pre style="margin:4px 0;white-space:pre-wrap;word-break:break-all">${escHtml(JSON.stringify(e, null, 2))}</pre></details>
      </td></tr>
      ` : ''}
    `
  }

  // ─── Correlation ────────────────────────────────────────────────────────

  private async _loadCorrelation(id: string) {
    this._correlationId = id
    this._correlationLoading = true
    this._correlationResults = []
    this.render()

    try {
      this._correlationResults = await queryLogs({ contains: id, level: '*', order: 'asc', limit: 200 })
    } catch { /* silently empty */ }
    this._correlationLoading = false
    this.render()
  }

  private _clearCorrelation() {
    this._correlationId = ''
    this._correlationResults = []
    this.render()
  }

  private _renderCorrelation(): string {
    if (!this._correlationId) return ''
    const results = this._correlationResults
    const apps = [...new Set(results.map(e => e.application).filter(Boolean))]
    const firstTs = results.length > 0 ? results[0].timestampMs : 0
    const lastTs = results.length > 0 ? results[results.length - 1].timestampMs : 0

    return `
      <div class="ol-corr-banner">
        <span>Correlation ID: <code>${escHtml(this._correlationId)}</code></span>
        <button class="ol-btn" id="olCorrClose" style="margin-left:auto;padding:2px 8px">Close</button>
      </div>
      <div class="ol-info">Filtering by correlation ID uses text search (server limitation). Results may include unrelated matches.</div>
      ${this._correlationLoading ? `<p class="ol-empty">Searching…</p>` : ''}
      ${!this._correlationLoading ? `
        <div class="ol-corr-meta">
          ${apps.length > 0 ? `Applications: ${apps.map(a => appLink(a)).join(', ')}` : ''}
          ${firstTs ? ` · First: ${fmtTime(firstTs)}` : ''}
          ${lastTs && lastTs !== firstTs ? ` · Last: ${fmtTime(lastTs)}` : ''}
        </div>
        ${results.length > 0 ? `
        <table class="md-table" style="width:100%">
          <thead><tr><th>Time</th><th>Level</th><th>Application</th><th>Method</th><th>Message</th></tr></thead>
          <tbody>
            ${results.map(e => `
              <tr>
                <td class="ol-mono">${escHtml(fmtTime(e.timestampMs))}</td>
                <td>${levelBadge(e.levelLabel)}</td>
                <td>${appLink(e.application)}</td>
                <td class="ol-mono">${escHtml(e.method)}</td>
                <td class="ol-mono" style="max-width:400px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(truncate(e.message, 160))}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
        ` : `<p class="ol-empty">No matching log entries found.</p>`}
      ` : ''}
    `
  }

  // ─── Main render ────────────────────────────────────────────────────────

  private render() {
    let tabContent = ''
    switch (this._tab) {
      case 'overview': tabContent = this._renderOverview(); break
      case 'tail': tabContent = this._renderTail(); break
      case 'search': tabContent = this._renderSearch(); break
    }

    this.innerHTML = `
      <style>${STYLES}</style>
      <div class="ol-wrap">
        <div class="ol-header">
          <h2>Logs</h2>
        </div>
        <p class="ol-subtitle">Unified log view. Filter by severity, application, and time range.</p>

        <div class="ol-tabs">
          <button class="ol-tab${this._tab === 'overview' ? ' active' : ''}" data-tab="overview">Overview</button>
          <button class="ol-tab${this._tab === 'tail' ? ' active' : ''}" data-tab="tail">Live Tail</button>
          <button class="ol-tab${this._tab === 'search' ? ' active' : ''}" data-tab="search">Search</button>
        </div>

        ${this._correlationId ? this._renderCorrelation() : tabContent}
      </div>
    `

    this._wireEvents()
  }

  private _wireEvents() {
    // Tab switching
    this.querySelectorAll<HTMLElement>('.ol-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        const tab = btn.dataset.tab as Tab
        if (tab === this._tab) return
        if (this._tab === 'tail') this._stopTail()
        if (this._tab === 'overview') this._stopOverviewTimer()
        this._tab = tab
        this._correlationId = ''
        this.render()
        if (tab === 'overview') this._loadOverview()
      })
    })

    // Overview quick links
    this.querySelector('#olGoTail')?.addEventListener('click', () => {
      this._stopOverviewTimer()
      this._tab = 'tail'
      this.render()
    })
    this.querySelector('#olGoSearch')?.addEventListener('click', () => {
      this._stopOverviewTimer()
      this._tab = 'search'
      this._searchLevel = 'error'
      this.render()
    })

    // Live tail controls
    this.querySelector('#olTailStart')?.addEventListener('click', () => {
      this._startTail()
      this.render()
    })
    this.querySelector('#olTailStop')?.addEventListener('click', () => {
      this._stopTail()
      this.render()
    })
    this.querySelector('#olTailPause')?.addEventListener('click', () => {
      this._tailPaused = !this._tailPaused
      this.render()
      if (!this._tailPaused) this._renderTailOutput()
    })
    this.querySelector('#olTailAutoScroll')?.addEventListener('change', (ev: Event) => {
      this._tailAutoScroll = (ev.target as HTMLInputElement).checked
    })

    // Severity checkboxes
    this.querySelectorAll<HTMLInputElement>('[data-sev]').forEach(cb => {
      cb.addEventListener('change', () => {
        const sev = cb.dataset.sev!
        if (cb.checked) this._tailFilterLevels.add(sev)
        else this._tailFilterLevels.delete(sev)
        this._renderTailOutput()
      })
    })

    // Tail filter inputs — live filter on input
    const tailApp = this.querySelector('#olTailApp') as HTMLInputElement | null
    tailApp?.addEventListener('input', () => { this._tailFilterApp = tailApp.value; this._renderTailOutput() })
    const tailContains = this.querySelector('#olTailContains') as HTMLInputElement | null
    tailContains?.addEventListener('input', () => { this._tailFilterContains = tailContains.value; this._renderTailOutput() })
    const tailCorr = this.querySelector('#olTailCorr') as HTMLInputElement | null
    tailCorr?.addEventListener('input', () => { this._tailFilterCorrelation = tailCorr.value; this._renderTailOutput() })

    // Tail presets
    this.querySelectorAll<HTMLElement>('[data-tail-preset]').forEach(btn => {
      btn.addEventListener('click', () => {
        this._tailPreset = btn.dataset.tailPreset!
        this._renderTailOutput()
        // Update active class
        this.querySelectorAll('[data-tail-preset]').forEach(b => b.classList.remove('active'))
        btn.classList.add('active')
      })
    })

    // Tail row expand
    this.querySelector('#olTailOutput')?.addEventListener('click', (ev: Event) => {
      const row = (ev.target as HTMLElement).closest('.ol-tail-row') as HTMLElement | null
      if (row) {
        const idx = parseInt(row.dataset.tailIdx!, 10)
        this._tailExpandedIdx = this._tailExpandedIdx === idx ? -1 : idx
        this._renderTailOutput()
      }
    })

    // Search controls
    this.querySelector('#olSearchBtn')?.addEventListener('click', () => this._readSearchInputsAndRun())
    // Enter in search inputs
    this.querySelectorAll<HTMLInputElement>('#olSearchApp,#olSearchNode,#olSearchContains,#olSearchSince,#olSearchUntil').forEach(el => {
      el.addEventListener('keydown', (ev: KeyboardEvent) => { if (ev.key === 'Enter') this._readSearchInputsAndRun() })
    })

    // Search presets
    this.querySelectorAll<HTMLElement>('[data-search-preset]').forEach(btn => {
      btn.addEventListener('click', () => {
        this._searchPreset = btn.dataset.searchPreset!
        // If a preset with apps is selected, set the app filter to the first app
        const preset = SOURCES.find(s => s.key === this._searchPreset)
        if (preset?.apps) {
          this._searchApp = preset.apps[0]
          const appInput = this.querySelector('#olSearchApp') as HTMLInputElement | null
          if (appInput) appInput.value = this._searchApp
        } else {
          this._searchApp = ''
          const appInput = this.querySelector('#olSearchApp') as HTMLInputElement | null
          if (appInput) appInput.value = ''
        }
        this.querySelectorAll('[data-search-preset]').forEach(b => b.classList.remove('active'))
        btn.classList.add('active')
      })
    })

    // Search row expand
    this.querySelectorAll<HTMLElement>('.ol-search-row').forEach(row => {
      row.addEventListener('click', (ev: Event) => {
        // Don't toggle if clicking a link
        if ((ev.target as HTMLElement).closest('a')) return
        const idx = parseInt(row.dataset.searchIdx!, 10)
        this._searchExpandedIdx = this._searchExpandedIdx === idx ? -1 : idx
        this.render()
      })
    })

    // Correlation links (anywhere in the page)
    this.querySelectorAll<HTMLElement>('.ol-corr-link').forEach(el => {
      el.addEventListener('click', (ev: Event) => {
        ev.stopPropagation()
        const id = (el as HTMLElement).dataset.corr
        if (id) this._loadCorrelation(id)
      })
    })

    // Correlation close
    this.querySelector('#olCorrClose')?.addEventListener('click', () => this._clearCorrelation())
  }

  private _readSearchInputsAndRun() {
    const level = (this.querySelector('#olSearchLevel') as HTMLSelectElement)?.value
    if (level) this._searchLevel = level
    this._searchApp = (this.querySelector('#olSearchApp') as HTMLInputElement)?.value ?? ''
    this._searchNode = (this.querySelector('#olSearchNode') as HTMLInputElement)?.value ?? ''
    this._searchSince = (this.querySelector('#olSearchSince') as HTMLInputElement)?.value ?? ''
    this._searchUntil = (this.querySelector('#olSearchUntil') as HTMLInputElement)?.value ?? ''
    this._searchContains = (this.querySelector('#olSearchContains') as HTMLInputElement)?.value ?? ''
    const limit = parseInt((this.querySelector('#olSearchLimit') as HTMLInputElement)?.value ?? '100', 10)
    this._searchLimit = isNaN(limit) || limit < 1 ? 100 : limit
    this._doSearch()
  }
}

customElements.define('page-observability-logs', PageObservabilityLogs)
