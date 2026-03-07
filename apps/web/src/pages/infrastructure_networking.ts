// src/pages/infrastructure_networking.ts
import {
  fetchAdminEnvoy,
  type EnvoyResponse, type EnvoyCluster, type EnvoyListener,
} from '@globular/backend'

import {
  INFRA_STYLES, badge, stateBadge, stateColor, esc,
  fmtBytes, fmtDuration, fmtRate, fmtPct, fmtTime, freshnessBadge,
  externalHost, type HealthState,
} from '../utils/infra_health'

const POLL = 15_000

class PageInfrastructureNetworking extends HTMLElement {
  private _timer: number | null = null
  private _lastUpdated: Date | null = null
  private _envoy: EnvoyResponse | null = null

  connectedCallback() {
    this.style.display = 'block'
    this.innerHTML = `
      <style>${INFRA_STYLES}</style>
      <section class="wrap">
        <header class="infra-header">
          <h2>Networking</h2>
          <div class="spacer"></div>
          <span id="netTimestamp" class="infra-timestamp"></span>
          <span id="netFreshness"></span>
          <button id="netRefresh" class="infra-btn">&#8635; Refresh</button>
        </header>
        <p style="font:var(--md-typescale-body-medium);color:var(--secondary-text-color);margin:0 0 16px">
          Envoy proxy health, downstream traffic, upstream clusters, and xDS sync.
        </p>
        <div id="netServer"></div>
        <div id="netDownstream" class="infra-grid"></div>
        <div id="netClusters"></div>
        <div id="netXds"></div>
        <div id="netListeners"></div>
        <div id="netLinks"></div>
      </section>
    `
    this.querySelector('#netRefresh')?.addEventListener('click', () => this.load())
    this.load()
    this._timer = window.setInterval(() => this.load(), POLL)
  }

  disconnectedCallback() {
    if (this._timer) clearInterval(this._timer)
  }

  private async load() {
    try {
      this._envoy = await fetchAdminEnvoy()
    } catch {
      this._envoy = null
    }
    this._lastUpdated = new Date()
    this.render()
  }

  private render() {
    const tsEl = this.querySelector('#netTimestamp') as HTMLElement
    if (tsEl && this._lastUpdated) tsEl.textContent = `Last updated: ${fmtTime(this._lastUpdated)}`
    const freshEl = this.querySelector('#netFreshness') as HTMLElement
    if (freshEl) freshEl.innerHTML = freshnessBadge(this._lastUpdated?.getTime() ?? null, POLL)

    this.renderServer()
    this.renderDownstream()
    this.renderClusters()
    this.renderXds()
    this.renderListeners()
    this.renderLinks()
  }

  private renderServer() {
    const el = this.querySelector('#netServer') as HTMLElement
    if (!el) return
    const e = this._envoy
    if (!e) { el.innerHTML = `<div class="infra-empty">Envoy data unavailable.</div>`; return }

    const s = e.server
    const state: HealthState = e.healthy ? 'healthy' : 'degraded'
    const serverState = s.state === 'LIVE' ? 'healthy' : s.state === 'DRAINING' ? 'degraded' : 'critical'

    el.innerHTML = `
      <div class="infra-card" style="border-left:4px solid ${stateColor(state)};margin-bottom:12px">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px">
          <span style="font-weight:700;font-size:.92rem">Envoy Server</span>
          <div style="flex:1"></div>
          ${badge(s.state, stateColor(serverState))}
          ${stateBadge(state)}
        </div>
        <div class="infra-card-metric">
          Version: ${esc(s.version)}
          &middot; Uptime: ${fmtDuration(s.uptime_sec)}
          &middot; Memory: ${fmtBytes(s.mem_allocated_bytes)}
          &middot; Lifetime conns: ${s.total_connections_lifetime.toLocaleString()}
        </div>
      </div>
    `
  }

  private renderDownstream() {
    const el = this.querySelector('#netDownstream') as HTMLElement
    if (!el) return
    const e = this._envoy
    if (!e) { el.innerHTML = ''; return }

    const d = e.downstream
    const certDays = d.days_until_cert_expiry
    const certState: HealthState = certDays <= 0 ? 'unknown' : certDays < 7 ? 'critical' : certDays < 30 ? 'degraded' : 'healthy'

    el.innerHTML = `
      <div class="infra-card">
        <div class="infra-card-label">Active Connections</div>
        <div class="infra-card-value">${d.active_conns.toLocaleString()}</div>
        <div class="infra-card-sub">SSL: ${d.ssl_conns.toLocaleString()}</div>
      </div>
      <div class="infra-card">
        <div class="infra-card-label">Request Rates</div>
        <div class="infra-card-value">${fmtRate(d.rps)}</div>
        <div class="infra-card-sub">
          2xx: ${fmtRate(d.http_2xx_rate)}
          &middot; 4xx: ${fmtRate(d.http_4xx_rate)}
          &middot; 5xx: <span style="color:${d.http_5xx_rate > 0 ? 'var(--error-color)' : 'inherit'}">${fmtRate(d.http_5xx_rate)}</span>
        </div>
      </div>
      <div class="infra-card">
        <div class="infra-card-label">Latency</div>
        <div class="infra-card-metric" style="margin-top:6px">
          p50: <strong>${d.p50_ms.toFixed(1)}ms</strong><br>
          p95: <strong>${d.p95_ms.toFixed(1)}ms</strong><br>
          p99: <strong>${d.p99_ms.toFixed(1)}ms</strong>
        </div>
      </div>
      <div class="infra-card" style="border-left:4px solid ${stateColor(certState)}">
        <div class="infra-card-label">TLS &amp; Certificates</div>
        <div class="infra-card-metric" style="margin-top:6px">
          SSL handshake rate: ${fmtRate(d.ssl_handshake_rate)}/s<br>
          SSL errors: <span style="color:${d.ssl_error_rate > 0 ? 'var(--error-color)' : 'inherit'}">${fmtRate(d.ssl_error_rate)}/s</span><br>
          Cert expiry: ${certDays > 0 ? `<strong>${Math.floor(certDays)} days</strong>` : 'N/A'}
        </div>
      </div>
    `
  }

  private renderClusters() {
    const el = this.querySelector('#netClusters') as HTMLElement
    if (!el) return
    const e = this._envoy
    if (!e || e.clusters.length === 0) { el.innerHTML = ''; return }

    el.innerHTML = `
      <div class="infra-section-title">Upstream Clusters</div>
      <div style="overflow-x:auto">
        <table class="infra-table">
          <thead>
            <tr>
              <th>Cluster</th>
              <th>Healthy</th>
              <th>Degraded</th>
              <th>Unhealthy</th>
              <th>RPS</th>
              <th>Err%</th>
              <th>p50</th>
              <th>p99</th>
              <th>CB</th>
            </tr>
          </thead>
          <tbody>
            ${e.clusters.map(c => {
              const rowColor = c.unhealthy > 0 ? 'var(--error-color)' : c.degraded > 0 ? '#f59e0b' : ''
              return `
              <tr>
                <td style="font-family:monospace;font-size:.78rem;${rowColor ? `color:${rowColor}` : ''}">${esc(c.name)}</td>
                <td style="color:#22c55e">${c.healthy}</td>
                <td style="color:${c.degraded > 0 ? '#f59e0b' : 'inherit'}">${c.degraded}</td>
                <td style="color:${c.unhealthy > 0 ? 'var(--error-color)' : 'inherit'}">${c.unhealthy}</td>
                <td>${fmtRate(c.rps)}</td>
                <td style="color:${c.err_rate > 0 ? 'var(--error-color)' : 'inherit'}">${fmtPct(c.err_rate)}</td>
                <td>${c.p50_ms.toFixed(1)}ms</td>
                <td>${c.p99_ms.toFixed(1)}ms</td>
                <td>${c.circuit_breaker_open > 0 ? badge('OPEN', 'var(--error-color)') : badge('OK', '#22c55e')}</td>
              </tr>`
            }).join('')}
          </tbody>
        </table>
      </div>
    `
  }

  private renderXds() {
    const el = this.querySelector('#netXds') as HTMLElement
    if (!el) return
    const e = this._envoy
    if (!e) { el.innerHTML = ''; return }

    const x = e.xds
    el.innerHTML = `
      <div class="infra-section-title">xDS Sync</div>
      <div class="infra-grid">
        <div class="infra-card">
          <div class="infra-card-label">Active Resources</div>
          <div class="infra-card-metric" style="margin-top:4px">
            Clusters: <strong>${x.active_clusters}</strong><br>
            Listeners: <strong>${x.active_listeners}</strong>
          </div>
        </div>
        <div class="infra-card">
          <div class="infra-card-label">CDS Updates</div>
          <div class="infra-card-metric" style="margin-top:4px">
            Success: <span style="color:#22c55e">${x.cds_update_success.toLocaleString()}</span><br>
            Failure: <span style="color:${x.cds_update_failure > 0 ? 'var(--error-color)' : 'inherit'}">${x.cds_update_failure.toLocaleString()}</span>
          </div>
        </div>
        <div class="infra-card">
          <div class="infra-card-label">LDS Updates</div>
          <div class="infra-card-metric" style="margin-top:4px">
            Success: <span style="color:#22c55e">${x.lds_update_success.toLocaleString()}</span><br>
            Failure: <span style="color:${x.lds_update_failure > 0 ? 'var(--error-color)' : 'inherit'}">${x.lds_update_failure.toLocaleString()}</span>
          </div>
        </div>
      </div>
    `
  }

  private renderListeners() {
    const el = this.querySelector('#netListeners') as HTMLElement
    if (!el) return
    const e = this._envoy
    if (!e || e.listeners.length === 0) { el.innerHTML = ''; return }

    el.innerHTML = `
      <div class="infra-section-title">Listeners</div>
      <div style="overflow-x:auto">
        <table class="infra-table">
          <thead>
            <tr>
              <th>Address</th>
              <th>Conns</th>
              <th>RPS</th>
              <th>4xx%</th>
              <th>5xx%</th>
            </tr>
          </thead>
          <tbody>
            ${e.listeners.map(l => `
              <tr>
                <td style="font-family:monospace;font-size:.78rem">${esc(l.address)}</td>
                <td>${l.active_conns.toLocaleString()}</td>
                <td>${fmtRate(l.rps)}</td>
                <td>${fmtRate(l.http_4xx_rate)}</td>
                <td style="color:${l.http_5xx_rate > 0 ? 'var(--error-color)' : 'inherit'}">${fmtRate(l.http_5xx_rate)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `
  }

  private renderLinks() {
    const el = this.querySelector('#netLinks') as HTMLElement
    if (!el) return
    const host = externalHost()
    el.innerHTML = `
      <div class="infra-quick-links">
        <a class="infra-link" href="http://${host}:9901" target="_blank" rel="noopener">Envoy Admin &rarr;</a>
        <a class="infra-link" href="http://${host}:9901/stats" target="_blank" rel="noopener">Stats &rarr;</a>
        <a class="infra-link" href="http://${host}:9901/config_dump" target="_blank" rel="noopener">Config Dump &rarr;</a>
      </div>
    `
  }
}

customElements.define('page-infrastructure-networking', PageInfrastructureNetworking)
