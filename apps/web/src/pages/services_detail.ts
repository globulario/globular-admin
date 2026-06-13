import { getConfig, queryLogs, type ServiceDesc, type LogEntry } from '@globular/sdk'

// ─── Helpers ────────────────────────────────────────────────────────────────

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + '...' : s
}

function fmtTime(ms: number): string {
  if (!ms) return '—'
  return new Date(ms).toLocaleString()
}

function badge(label: string, color: string): string {
  return `<span class="md-badge" style="--badge-color:${color}">${label.toUpperCase()}</span>`
}

function stateBadge(state: string): string {
  const s = (state || '').toLowerCase()
  if (s === 'running' || s === 'active') return badge(state, 'var(--success-color)')
  if (s === 'failed' || s === 'error')   return badge(state, 'var(--error-color)')
  if (s === 'starting' || s === 'stopping') return badge(state, 'var(--warning-color)')
  if (s === 'stopped') return badge(state, 'var(--secondary-text-color)')
  if (state) return badge(state, 'var(--secondary-text-color)')
  return `<span style="color:var(--secondary-text-color)">—</span>`
}

function levelBadge(label: string): string {
  const colors: Record<string, string> = {
    FATAL: 'var(--error-color)', ERROR: 'var(--error-color, #ef4444)', WARN: 'var(--warning-color)',
    INFO: 'var(--on-surface-color, #e0e0e0)', DEBUG: 'var(--secondary-text-color, #888)',
    TRACE: 'var(--secondary-text-color, #666)',
  }
  const c = colors[label] || 'var(--on-surface-color)'
  return `<span class="sd-level-badge" style="background:color-mix(in srgb,${c} 15%,transparent);color:${c};border-color:color-mix(in srgb,${c} 30%,transparent);">${label}</span>`
}

function kv(key: string, val: any): string {
  if (val == null || val === '') return ''
  return `<div class="sd-kv"><span class="sd-kv-key">${escHtml(key)}:</span><span class="sd-kv-val">${escHtml(String(val))}</span></div>`
}

// ─── CSS ────────────────────────────────────────────────────────────────────

const STYLES = `
  .sd-wrap { padding: 16px; }
  .sd-header { display: flex; align-items: center; gap: 12px; margin-bottom: 4px; }
  .sd-header h2 { margin: 0; font: var(--md-typescale-headline-small); }
  .sd-back {
    color: var(--accent-color); text-decoration: none;
    font: var(--md-typescale-label-large);
  }
  .sd-back:hover { text-decoration: underline; }
  .sd-subtitle { margin: .25rem 0 1rem; opacity: .85; font: var(--md-typescale-body-medium); }
  .sd-kv { display: flex; gap: 6px; padding: 4px 0; }
  .sd-kv-key { color: var(--secondary-text-color); white-space: nowrap; min-width: 100px; font-size: .82rem; }
  .sd-kv-val { font-family: monospace; word-break: break-all; font-size: .82rem; }
  .sd-config-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
    gap: 2px 24px;
    padding: 8px 12px;
  }
  .sd-btn {
    border: 1px solid var(--border-subtle-color);
    background: transparent; color: var(--on-surface-color);
    border-radius: var(--md-shape-sm);
    padding: 5px 12px; cursor: pointer;
    font: var(--md-typescale-label-medium);
    transition: background .15s;
  }
  .sd-btn:hover { background: var(--md-state-hover); }
  .sd-empty { padding: 14px; font: var(--md-typescale-body-medium); font-style: italic; color: var(--secondary-text-color); }
  .sd-mono { font-family: monospace; font-size: .78rem; }
  .sd-level-badge {
    display: inline-block; padding: 1px 6px; border-radius: var(--md-shape-full);
    font-size: .68rem; font-weight: 700; letter-spacing: .03em;
    border: 1px solid; white-space: nowrap;
  }
  .sd-log-link {
    color: var(--accent-color); text-decoration: none;
    font: var(--md-typescale-label-medium);
  }
  .sd-log-link:hover { text-decoration: underline; }
  .sd-status { font-size: .72rem; color: var(--secondary-text-color); margin-top: 8px; }
`

// ─── Module-level cache ──────────────────────────────────────────────────────
// Keyed by service name so multiple instances don't share state.

const _detailCache: Map<string, { service: import('@globular/sdk').ServiceDesc | null; fetchedAt: number }> = new Map()

// ─── Component ──────────────────────────────────────────────────────────────

class PageServicesDetail extends HTMLElement {
  private _built = false
  private _name = ''
  private _service: ServiceDesc | null = null
  private _loading = true
  private _loadError = ''
  private _errors: LogEntry[] = []
  private _errorsLoading = false
  private _errorsError = ''
  private _refreshTimer: number | null = null

  connectedCallback() {
    this.style.display = 'block'
    this._name = this.getAttribute('service-name') || ''
    this._buildShell()
    // Show cached data immediately on remount
    const cached = _detailCache.get(this._name)
    if (cached) {
      this._service = cached.service
      this._loading = false
      this._pushConfig()
    }
    this._load()
    this._refreshTimer = window.setInterval(() => this._load(), 30_000)
  }

  disconnectedCallback() {
    if (this._refreshTimer) { clearInterval(this._refreshTimer); this._refreshTimer = null }
  }

  private _buildShell() {
    if (this._built) return
    this._built = true

    this.innerHTML = `
      <style>${STYLES}</style>
      <div class="sd-wrap">
        <a class="sd-back" href="#/services/instances">&larr; Services</a>

        <div class="sd-header" style="margin-top: 8px;">
          <h2>${escHtml(this._name || 'Unknown Service')}</h2>
          <span data-bind="state-badge"></span>
          <div style="flex:1"></div>
          <button class="sd-btn" id="sdRefresh">&circlearrowright; Refresh</button>
        </div>
        <p class="sd-subtitle" data-bind="subtitle">Service configuration and recent errors.</p>

        <p id="sd-loading" class="sd-empty" style="display:none">Loading…</p>

        <div id="sd-config-error" class="md-banner-warn" style="display:none">
          Could not load service config — <span data-bind="config-error-msg"></span>
          <br><span style="font-size:.8em;opacity:.8">Ensure the gateway is reachable.</span>
        </div>

        <div id="sd-not-found" class="md-banner-warn" style="display:none">
          Service <code>${escHtml(this._name)}</code> not found in the gateway configuration.
        </div>

        <div data-bind="config-panel"></div>

        <div data-bind="errors-panel"></div>

        <p class="sd-status">Auto-refresh 30s</p>
      </div>
    `

    this.querySelector('#sdRefresh')?.addEventListener('click', () => this._load())
  }

  private _set(bind: string, html: string) {
    const el = this.querySelector(`[data-bind="${bind}"]`) as HTMLElement | null
    if (el) el.innerHTML = html
  }

  private async _load() {
    await Promise.allSettled([this._loadConfig(), this._loadErrors()])
  }

  private async _loadConfig() {
    const loadingEl = this.querySelector('#sd-loading') as HTMLElement | null
    if (loadingEl) loadingEl.style.display = ''

    try {
      const cfg = await getConfig()
      const svcs = cfg?.Services ?? {}
      // Try exact key match first, then search by Name or Id
      this._service = svcs[this._name] ?? null
      if (!this._service) {
        for (const s of Object.values(svcs)) {
          if (s.Name === this._name || s.Id === this._name) {
            this._service = s
            break
          }
        }
      }
      _detailCache.set(this._name, { service: this._service, fetchedAt: Date.now() })
      this._loadError = ''
    } catch (e: any) {
      this._loadError = e?.message || 'Could not reach gateway /config'
      // Keep cached service visible — do not clear this._service
    }
    this._loading = false
    if (loadingEl) loadingEl.style.display = 'none'
    this._pushConfig()
  }

  private async _loadErrors() {
    this._errorsLoading = true
    this._pushErrors()
    try {
      this._errors = await queryLogs({ application: this._name, level: 'error', limit: 10, order: 'desc' })
      this._errorsError = ''
    } catch (e: any) {
      this._errorsError = e?.message || 'LogService unavailable'
      this._errors = []
    }
    this._errorsLoading = false
    this._pushErrors()
  }

  private _pushConfig() {
    const s = this._service

    // State badge and subtitle
    this._set('state-badge', s ? stateBadge(s.State ?? '') : '')
    this._set('subtitle', s?.Description ? escHtml(s.Description) : 'Service configuration and recent errors.')

    // Config error banner
    const configErrorEl = this.querySelector('#sd-config-error') as HTMLElement | null
    if (configErrorEl) {
      if (this._loadError) {
        const msgEl = configErrorEl.querySelector('[data-bind="config-error-msg"]') as HTMLElement | null
        if (msgEl) msgEl.textContent = this._loadError
        configErrorEl.style.display = ''
      } else {
        configErrorEl.style.display = 'none'
      }
    }

    // Not-found banner
    const notFoundEl = this.querySelector('#sd-not-found') as HTMLElement | null
    if (notFoundEl) {
      notFoundEl.style.display = (!this._loading && !this._loadError && !s) ? '' : 'none'
    }

    // Config panel
    this._set('config-panel', s ? this._renderConfig(s) : '')
  }

  private _pushErrors() {
    this._set('errors-panel', this._renderErrors())
  }

  private _renderConfig(s: ServiceDesc): string {
    const pid = s.Pid ?? s.Process?.Pid ?? s.Process ?? 0
    return `
      <div class="md-panel">
        <div class="md-panel-header"><span>Configuration</span></div>
        <div class="sd-config-grid">
          ${kv('ID', s.Id)}
          ${kv('Name', s.Name)}
          ${kv('Domain', s.Domain)}
          ${kv('Port', s.Port)}
          ${kv('Address', s.Address)}
          ${kv('TLS', s.TLS != null ? String(s.TLS) : null)}
          ${kv('Version', s.Version)}
          ${kv('PID', pid || null)}
          ${kv('Keep Alive', s.KeepAlive != null ? String(s.KeepAlive) : null)}
          ${kv('Publisher', s.PublisherID && s.PublisherID !== 'localhost' ? s.PublisherID : null)}
          ${kv('Description', s.Description)}
        </div>
      </div>
    `
  }

  private _renderErrors(): string {
    if (this._errorsLoading && this._errors.length === 0) {
      return `
        <div class="md-panel" style="margin-top: 12px;">
          <div class="md-panel-header"><span>Recent Errors</span></div>
          <p class="sd-empty">Loading errors…</p>
        </div>`
    }

    if (this._errorsError) {
      return `
        <div class="md-panel" style="margin-top: 12px;">
          <div class="md-panel-header"><span>Recent Errors</span></div>
          <p class="sd-empty">Log service unavailable — ${escHtml(this._errorsError)}</p>
        </div>`
    }

    const logsHref = `#/observability/logs?tab=search`

    return `
      <div class="md-panel" style="margin-top: 12px;">
        <div class="md-panel-header">
          <span>Recent Errors (${this._errors.length})</span>
          <a class="sd-log-link" href="${logsHref}">View all logs &rarr;</a>
        </div>
        ${this._errors.length > 0 ? `
          <table class="md-table" style="width:100%">
            <thead><tr><th>Time</th><th>Level</th><th>Node</th><th>Method</th><th>Message</th></tr></thead>
            <tbody>
              ${this._errors.map(e => `
                <tr>
                  <td class="sd-mono">${escHtml(fmtTime(e.timestampMs))}</td>
                  <td>${levelBadge(e.levelLabel)}</td>
                  <td class="sd-mono">${escHtml(e.nodeId || '')}</td>
                  <td class="sd-mono">${escHtml(e.method)}</td>
                  <td class="sd-mono" style="max-width:360px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(truncate(e.message, 120))}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        ` : `<p class="sd-empty">No recent errors for this service.</p>`}
      </div>
    `
  }
}

customElements.define('page-service-detail', PageServicesDetail)
