// src/pages/services_instances.ts
import { getConfig, type ServiceDesc } from '@globular/backend'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function badge(label: string, color: string): string {
  return `<span class="md-badge" style="--badge-color:${color}">${label.toUpperCase()}</span>`
}

function stateBadge(state: string): string {
  const s = (state || '').toLowerCase()
  if (s === 'running' || s === 'active')
    return badge(state, 'var(--success-color)')
  if (s === 'failed' || s === 'error')
    return badge(state, 'var(--error-color)')
  if (s === 'starting' || s === 'stopping')
    return badge(state, '#f59e0b')
  if (state)
    return badge(state, 'var(--secondary-text-color)')
  return `<span style="color:var(--secondary-text-color)">—</span>`
}

function boolIcon(v: any): string {
  return v ? '✓' : '—'
}

// ─── Component ────────────────────────────────────────────────────────────────

class PageServicesInstances extends HTMLElement {
  private _services:      ServiceDesc[] = []
  private _loadError    = ''
  private _loading      = true
  private _expandedId   = ''
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
      const cfg = await getConfig()
      const svcs = cfg?.Services ?? {}
      this._services = Object.values(svcs).sort((a, b) =>
        (a.Name ?? '').localeCompare(b.Name ?? ''),
      )
      this._loadError = ''
    } catch (e: any) {
      this._loadError = e?.message || 'Could not reach gateway /config'
    }
    this._loading = false
    this.render()
  }

  private render() {
    const running = this._services.filter(
      s => (s.State ?? '').toLowerCase() === 'running',
    ).length

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
          margin-bottom: 12px;
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
        .si-table {
          width:           100%;
          border-collapse: collapse;
          font-size:       .72rem;
        }
        .si-table th {
          text-align:     left;
          padding:        7px 12px;
          font-size:      .72rem;
          font-weight:    700;
          text-transform: uppercase;
          letter-spacing: .05em;
          color:          var(--secondary-text-color);
          border-bottom:  1px solid var(--border-subtle-color);
          background:     var(--md-surface-container);
          white-space:    nowrap;
        }
        .si-table td {
          padding:        6px 12px;
          border-bottom:  1px solid var(--border-subtle-color);
          vertical-align: middle;
        }
        .si-table tr:last-child td { border-bottom: none; }
        .si-table tr.si-row { cursor: pointer; }
        .si-table tr.si-row:hover td { background: var(--md-state-hover); }
        .si-table tr.si-row.expanded td { background: var(--md-state-selected); }
        .si-name { font-weight: 600; }
        .si-mono { font-family: monospace; color: var(--secondary-text-color); }
        .si-detail td {
          padding:       0 12px 0 28px;
          border-bottom: 1px solid var(--border-subtle-color);
          background:    var(--md-surface-container-lowest);
        }
        .si-detail-inner {
          padding: 10px 0;
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
          gap: 6px 24px;
          font-size: .72rem;
        }
        .si-kv { display: flex; gap: 6px; }
        .si-kv-key { color: var(--secondary-text-color); white-space: nowrap; }
        .si-kv-val { font-family: monospace; word-break: break-all; }
        .si-empty { padding: 14px 16px; font-style: italic; color: var(--secondary-text-color); font-size: .82rem; }
        .si-btn {
          border:        1px solid var(--border-subtle-color);
          background:    transparent;
          color:         var(--on-surface-color);
          border-radius: var(--md-shape-sm);
          padding:       3px 10px;
          cursor:        pointer;
          font-size:     .72rem;
        }
        .si-btn:hover { background: var(--md-state-hover); }
        .si-chevron { font-size: .9rem; color: var(--secondary-text-color); transition: transform .15s; }
        .si-chevron.open { transform: rotate(90deg); }
      </style>

      <div class="si-wrap">
        <div class="si-header">
          <h2>Service Instances</h2>
          <div style="flex:1"></div>
          <button class="si-btn" id="btnRefresh">↻ Refresh</button>
        </div>
        <p class="si-subtitle">Live service configurations from the gateway node.</p>

        ${this._loading ? `<p style="padding:14px;font-style:italic;color:var(--secondary-text-color)">Loading…</p>` : ''}

        ${this._loadError ? `
        <div class="md-banner-warn">
          ⚠ Could not load services — ${this._loadError}
          <br><span style="font-size:.8em;opacity:.8">Ensure the gateway is reachable and <code>/config</code> is accessible.</span>
        </div>` : ''}

        ${!this._loading && !this._loadError ? `
        <div class="si-panel">
          <div class="si-panel-header">
            <span>Services (${this._services.length})</span>
            <span>${running} running</span>
          </div>
          ${this._services.length === 0
            ? `<p class="si-empty">No services registered.</p>`
            : `<table class="si-table">
                <thead>
                  <tr>
                    <th></th>
                    <th>Name</th>
                    <th>Domain</th>
                    <th>Port</th>
                    <th>Proxy</th>
                    <th>State</th>
                    <th>PID</th>
                    <th>Version</th>
                    <th>Keep alive</th>
                  </tr>
                </thead>
                <tbody>
                  ${this._services.map(s => this.renderServiceRows(s)).join('')}
                </tbody>
              </table>`
          }
        </div>` : ''}
      </div>
    `

    this.querySelector('#btnRefresh')?.addEventListener('click', () => this.load())

    this.querySelectorAll<HTMLElement>('tr.si-row[data-svc-id]').forEach(el => {
      el.addEventListener('click', () => {
        const id = el.dataset.svcId ?? ''
        this._expandedId = this._expandedId === id ? '' : id
        this.render()
      })
    })
  }

  private renderServiceRows(s: ServiceDesc): string {
    const id       = s.Id   ?? s.Name ?? ''
    const expanded = id === this._expandedId
    const pid      = s.Pid  ?? s.Process?.Pid ?? 0

    const row = `
      <tr class="si-row${expanded ? ' expanded' : ''}" data-svc-id="${id}">
        <td><span class="si-chevron${expanded ? ' open' : ''}">›</span></td>
        <td class="si-name">${s.Name || '—'}</td>
        <td class="si-mono">${s.Domain || '—'}</td>
        <td class="si-mono">${s.Port   || '—'}</td>
        <td class="si-mono">${s.Proxy  || '—'}</td>
        <td>${stateBadge(s.State ?? '')}</td>
        <td class="si-mono">${pid || '—'}</td>
        <td class="si-mono">${s.Version || '—'}</td>
        <td style="text-align:center">${boolIcon(s.KeepAlive)}</td>
      </tr>`

    if (!expanded) return row

    const kv = (k: string, v: any) =>
      v != null && v !== ''
        ? `<div class="si-kv"><span class="si-kv-key">${k}:</span><span class="si-kv-val">${v}</span></div>`
        : ''

    const detail = `
      <tr class="si-detail">
        <td colspan="9">
          <div class="si-detail-inner">
            ${kv('ID',              s.Id)}
            ${kv('Description',     s.Description)}
            ${kv('Address',         s.Address)}
            ${kv('TLS',             s.TLS != null ? String(s.TLS) : null)}
            ${kv('Keep up to date', s.KeepUpToDate != null ? String(s.KeepUpToDate) : null)}
            ${kv('Publisher',       s.PublisherID)}
            ${kv('Config path',     s.ConfigPath)}
          </div>
        </td>
      </tr>`

    return row + detail
  }
}

customElements.define('page-services-instances', PageServicesInstances)
