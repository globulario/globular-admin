// src/pages/security_certificates.ts

import {
  INFRA_STYLES, badge, stateColor, esc,
  fmtTime, freshnessBadge,
  type HealthState,
} from '../utils/infra_health'

const POLL = 60_000

type CertTab = 'internal' | 'public' | 'envoy'

interface CertRecord {
  name: string
  scope: string
  kind: string
  subject: string
  issuer: string
  sans: string[]
  notBefore: string
  notAfter: string
  daysUntilExpiry: number
  fingerprintSha256: string
  path: string
  exists: boolean
  status: string
  source: string
}

interface CertWarning {
  severity: string
  scope: string
  message: string
}

interface DebugNode {
  type: string
  name: string
  path: string
  exists: boolean
  status: string
  details: string
  chain: string[]
}

interface CertData {
  internalPKI: {
    ca: CertRecord | null
    serviceCert: CertRecord | null
    bundle: CertRecord | null
    sanConfig: string
    consumers: string[]
  }
  publicTLS: {
    leafCert: CertRecord | null
    issuerBundle: CertRecord | null
    protocol: string
    domain: string
    alternateDomains: string[]
    externalDomains: ExternalDomainTLS[]
  }
  envoy: {
    sdsEnabled: boolean
    usage: EnvoyTLSUsage[]
  }
  warnings: CertWarning[]
  debugGraph: DebugNode[]
}

interface ExternalDomainTLS {
  fqdn: string
  leafCert: CertRecord | null
  keyPath: string
  chainPath: string
}

interface EnvoyTLSUsage {
  name: string
  type: string
  certPath: string
  keyPath: string
  caPath: string
  exists: boolean
  status: string
}

// ─── Backend client ──────────────────────────────────────────────────────────

async function fetchCertificates(): Promise<CertData> {
  const resp = await fetch('/admin/certificates')
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
  return resp.json()
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function statusColor(status: string): string {
  switch (status) {
    case 'valid':   return '#22c55e'
    case 'warning': return '#f59e0b'
    case 'expired': return 'var(--error-color)'
    case 'missing': return 'var(--error-color)'
    case 'error':   return 'var(--error-color)'
    default:        return 'var(--secondary-text-color)'
  }
}

function statusIcon(ok: boolean): string {
  return ok
    ? '<span style="color:#22c55e;font-weight:700">&#10003;</span>'
    : '<span style="color:var(--error-color);font-weight:700">&#10005;</span>'
}

function fmtDate(iso: string): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' })
}

function expiryText(cert: CertRecord): string {
  const days = cert.daysUntilExpiry
  const date = fmtDate(cert.notAfter)
  if (days < 0) return `${date} (expired ${Math.abs(days)}d ago)`
  return `${date} (${days}d)`
}

function severityColor(severity: string): string {
  switch (severity) {
    case 'critical': return 'var(--error-color)'
    case 'warning':  return '#f59e0b'
    case 'info':     return '#3b82f6'
    default:         return 'var(--secondary-text-color)'
  }
}

function severityIcon(severity: string): string {
  switch (severity) {
    case 'critical': return '&#9888;'
    case 'warning':  return '&#9888;'
    case 'info':     return '&#8505;'
    default:         return '&#8226;'
  }
}

// ─── Chain-of-trust badge strip ──────────────────────────────────────────────

function renderChainBadges(cert: CertRecord | null, envoyUsage?: EnvoyTLSUsage[]): string {
  if (!cert) {
    return `
      <div class="chain-strip">
        ${chainSegment('CONFIGURED', false)}
        ${chainSegment('FILE FOUND', false)}
        ${chainSegment('PARSED', false)}
        ${chainSegment('VALID', false)}
        ${chainSegment('CONSUMED', false, true)}
      </div>
    `
  }

  const configured = true
  const fileFound = cert.exists
  const parsed = cert.exists && !!cert.subject
  const valid = cert.status === 'valid'
  const consumed = envoyUsage
    ? envoyUsage.some(u => u.certPath === cert.path || u.caPath === cert.path)
    : true // assume consumed if no envoy info

  return `
    <div class="chain-strip">
      ${chainSegment('CONFIGURED', configured)}
      ${chainSegment('FILE FOUND', fileFound)}
      ${chainSegment('PARSED', parsed)}
      ${chainSegment('VALID', valid)}
      ${chainSegment('CONSUMED', consumed, !envoyUsage)}
    </div>
  `
}

function chainSegment(label: string, ok: boolean, gray = false): string {
  const color = gray
    ? 'var(--secondary-text-color)'
    : ok ? '#22c55e' : 'var(--error-color)'
  const icon = gray ? '—' : (ok ? '&#10003;' : '&#10005;')
  return `
    <span class="chain-segment" style="--seg-color:${color}">
      ${label} <span class="chain-icon">${icon}</span>
    </span>
  `
}

// ─── Certificate card renderer ───────────────────────────────────────────────

function renderCertCard(
  cert: CertRecord | null,
  consumers?: string[],
  envoyUsage?: EnvoyTLSUsage[],
  actions?: string,
): string {
  if (!cert) {
    return `
      <div class="cert-card infra-card" style="border-left:4px solid var(--error-color)">
        ${renderChainBadges(null)}
        <div class="cert-header">
          <h3>Certificate</h3>
          ${badge('MISSING', 'var(--error-color)')}
        </div>
        <div class="cert-details">
          <div class="detail-row">
            <span class="label">Status</span>
            <span style="color:var(--error-color)">Not found or not configured</span>
          </div>
        </div>
      </div>
    `
  }

  const color = statusColor(cert.status)

  return `
    <div class="cert-card infra-card" style="border-left:4px solid ${color}">
      ${renderChainBadges(cert, envoyUsage)}
      <div class="cert-header">
        <h3>${esc(cert.name)}</h3>
        ${badge(cert.status.toUpperCase(), color)}
      </div>
      <div class="cert-details">
        <div class="detail-row"><span class="label">Subject</span><span>${esc(cert.subject)}</span></div>
        <div class="detail-row"><span class="label">Issuer</span><span>${esc(cert.issuer)}</span></div>
        ${cert.sans && cert.sans.length > 0 ? `
          <div class="detail-row"><span class="label">SANs</span><span>${cert.sans.map(s => esc(s)).join(', ')}</span></div>
        ` : ''}
        <div class="detail-row"><span class="label">Not Before</span><span>${fmtDate(cert.notBefore)}</span></div>
        <div class="detail-row"><span class="label">Expires</span><span style="color:${cert.daysUntilExpiry < 30 ? '#f59e0b' : 'inherit'}">${expiryText(cert)}</span></div>
        <div class="detail-row"><span class="label">Fingerprint</span><span class="mono">${esc(cert.fingerprintSha256)}</span></div>
        <div class="detail-row"><span class="label">Path</span><span class="mono">${esc(cert.path)}</span></div>
        <div class="detail-row"><span class="label">Kind</span><span>${esc(cert.kind)}</span></div>
      </div>
      ${consumers && consumers.length > 0 ? `
        <div class="cert-pills">Used by: ${consumers.map(c => `<span class="pill">${esc(c)}</span>`).join(' ')}</div>
      ` : ''}
      ${actions ? `<div class="cert-actions">${actions}</div>` : ''}
    </div>
  `
}

// ─── Component ───────────────────────────────────────────────────────────────

class PageSecurityCertificates extends HTMLElement {
  private _timer: number | null = null
  private _lastUpdated: Date | null = null
  private _data: CertData | null = null
  private _tab: CertTab = 'internal'
  private _loading = false
  private _error: string | null = null
  private _sanConfigOpen = false

  connectedCallback() {
    this.style.display = 'block'
    this.innerHTML = `
      <style>${INFRA_STYLES}${PAGE_STYLES}</style>
      <section class="wrap">
        <header class="infra-header">
          <h2>Certificates</h2>
          <div class="spacer"></div>
          <span id="certTimestamp" class="infra-timestamp"></span>
          <span id="certFreshness"></span>
          <button id="certRefresh" class="infra-btn">&#8635; Refresh</button>
        </header>
        <p style="font:var(--md-typescale-body-medium);color:var(--secondary-text-color);margin:0 0 16px">
          CA status, TLS cert expiry, chain-of-trust validation, and Envoy SDS configuration.
        </p>
        <div id="certBody"></div>
      </section>
    `
    this.querySelector('#certRefresh')?.addEventListener('click', () => this.load())
    this.load()
    this._timer = window.setInterval(() => this.load(), POLL)
  }

  disconnectedCallback() {
    if (this._timer) clearInterval(this._timer)
  }

  // ─── Data ───────────────────────────────────────────────────────────────────

  private async load() {
    this._loading = true
    this.render()

    try {
      this._data = await fetchCertificates()
      this._error = null
    } catch (e: any) {
      this._error = e?.message ?? 'Failed to fetch certificate data'
    }

    this._lastUpdated = new Date()
    this._loading = false
    this.render()
  }

  // ─── Render ─────────────────────────────────────────────────────────────────

  private render() {
    const tsEl = this.querySelector('#certTimestamp') as HTMLElement
    if (tsEl && this._lastUpdated) tsEl.textContent = `Last updated: ${fmtTime(this._lastUpdated)}`
    const freshEl = this.querySelector('#certFreshness') as HTMLElement
    if (freshEl) freshEl.innerHTML = freshnessBadge(this._lastUpdated?.getTime() ?? null, POLL)

    const body = this.querySelector('#certBody') as HTMLElement
    if (!body) return

    if (this._loading && !this._lastUpdated) {
      body.innerHTML = '<div class="infra-empty">Loading certificate data...</div>'
      return
    }

    if (this._error && !this._data) {
      body.innerHTML = `
        <div class="cert-error-card infra-card" style="border-left:4px solid var(--error-color)">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
            <span style="font-weight:700;font-size:.92rem">Error</span>
            ${badge('FAILED', 'var(--error-color)')}
          </div>
          <div class="infra-card-metric">${esc(this._error!)}</div>
          <div class="infra-card-sub">The /admin/certificates endpoint may not be available yet.</div>
        </div>
      `
      return
    }

    const data = this._data!

    body.innerHTML = `
      ${this.renderOverview(data)}
      ${this.renderTabs()}
      <div id="certTabContent"></div>
      ${this.renderWarnings(data.warnings)}
    `

    // Wire tabs
    body.querySelectorAll('.infra-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        this._tab = (btn as HTMLElement).dataset.tab as CertTab
        this.render()
      })
    })

    // Render active tab content
    const content = body.querySelector('#certTabContent') as HTMLElement
    switch (this._tab) {
      case 'internal': this.renderInternalPKI(content, data); break
      case 'public':   this.renderPublicTLS(content, data); break
      case 'envoy':    this.renderEnvoy(content, data); break
    }
  }

  // ─── Overview cards ───────────────────────────────────────────────────────

  private renderOverview(data: CertData): string {
    const ca = data.internalPKI?.ca
    const caState: HealthState = !ca ? 'unknown'
      : ca.status === 'valid' ? 'healthy'
      : ca.status === 'warning' ? 'degraded'
      : 'critical'
    const caDays = ca ? `${ca.daysUntilExpiry}d` : '—'

    // Use primary leaf cert, or fall back to first external domain cert
    const pub = data.publicTLS?.leafCert
      ?? (data.publicTLS?.externalDomains ?? []).find(d => d.leafCert)?.leafCert
      ?? null
    const pubState: HealthState = !pub ? 'unknown'
      : pub.status === 'valid' ? 'healthy'
      : pub.status === 'warning' ? 'degraded'
      : 'critical'
    const pubLabel = pub ? pub.status.toUpperCase() : 'N/A'
    const extCount = (data.publicTLS?.externalDomains ?? []).length

    const envoyOk = data.envoy?.usage?.every(u => u.status === 'valid' || u.status === 'ok') ?? false
    const envoyState: HealthState = !data.envoy ? 'unknown'
      : envoyOk ? 'healthy'
      : 'degraded'

    const warnCount = data.warnings?.length ?? 0
    const dnsState: HealthState = warnCount === 0 ? 'healthy' : 'degraded'

    return `
      <div class="infra-grid" style="margin-bottom:16px">
        <div class="infra-card" style="border-left:4px solid ${stateColor(caState)}">
          <div class="infra-card-label">Internal CA</div>
          <div style="display:flex;align-items:center;gap:8px">
            <span class="infra-card-value" style="font-size:1.4rem">${caDays}</span>
            ${badge(ca ? ca.status.toUpperCase() : 'UNKNOWN', stateColor(caState))}
          </div>
          <div class="infra-card-sub">${ca ? esc(ca.subject) : 'No CA configured'}</div>
        </div>

        <div class="infra-card" style="border-left:4px solid ${stateColor(pubState)}">
          <div class="infra-card-label">Public HTTPS</div>
          <div style="display:flex;align-items:center;gap:8px">
            <span class="infra-card-value" style="font-size:1.4rem">${pub ? `${pub.daysUntilExpiry}d` : '—'}</span>
            ${badge(pubLabel, stateColor(pubState))}
          </div>
          <div class="infra-card-sub">${extCount > 0 ? `${extCount} external domain${extCount > 1 ? 's' : ''}` : (data.publicTLS?.domain ? esc(data.publicTLS.domain) : 'No public TLS')}</div>
        </div>

        <div class="infra-card" style="border-left:4px solid ${stateColor(envoyState)}">
          <div class="infra-card-label">Envoy TLS</div>
          <div style="display:flex;align-items:center;gap:8px">
            <span class="infra-card-value" style="font-size:1.4rem">${data.envoy?.usage?.length ?? 0}</span>
            ${badge(envoyOk ? 'HEALTHY' : 'ISSUES', stateColor(envoyState))}
          </div>
          <div class="infra-card-sub">SDS ${data.envoy?.sdsEnabled ? 'enabled' : 'disabled'} &middot; ${data.envoy?.usage?.length ?? 0} secret(s)</div>
        </div>

        <div class="infra-card" style="border-left:4px solid ${stateColor(dnsState)}">
          <div class="infra-card-label">Warnings</div>
          <div style="display:flex;align-items:center;gap:8px">
            <span class="infra-card-value" style="font-size:1.4rem">${warnCount}</span>
            ${badge(warnCount === 0 ? 'OK' : `${warnCount} ISSUE${warnCount > 1 ? 'S' : ''}`, stateColor(dnsState))}
          </div>
          <div class="infra-card-sub">${warnCount === 0 ? 'No warnings' : 'Review warnings below'}</div>
        </div>
      </div>
    `
  }

  // ─── Tabs ─────────────────────────────────────────────────────────────────

  private renderTabs(): string {
    return `
      <div class="infra-tabs">
        <button class="infra-tab ${this._tab === 'internal' ? 'active' : ''}" data-tab="internal">Internal PKI</button>
        <button class="infra-tab ${this._tab === 'public' ? 'active' : ''}" data-tab="public">Public TLS</button>
        <button class="infra-tab ${this._tab === 'envoy' ? 'active' : ''}" data-tab="envoy">Envoy / SDS</button>
      </div>
    `
  }

  // ─── Internal PKI tab ─────────────────────────────────────────────────────

  private renderInternalPKI(el: HTMLElement, data: CertData) {
    const pki = data.internalPKI
    if (!pki) {
      el.innerHTML = '<div class="infra-empty">No internal PKI data available.</div>'
      return
    }

    const caActions = `<button class="md-btn-text" data-action="download-ca">Download CA</button>`
    const sanToggle = `<button class="md-btn-text" data-action="toggle-san">View SAN Config</button>`

    el.innerHTML = `
      <div class="infra-section-title">Certificate Authority</div>
      ${renderCertCard(pki.ca, pki.consumers, data.envoy?.usage, caActions)}

      <div class="infra-section-title">Service Certificate</div>
      ${renderCertCard(pki.serviceCert, pki.consumers, data.envoy?.usage)}

      <div class="infra-section-title" style="display:flex;align-items:center;gap:8px">
        SAN Configuration ${sanToggle}
      </div>
      <div id="sanConfigBlock" style="display:${this._sanConfigOpen ? 'block' : 'none'}">
        <pre class="san-config">${pki.sanConfig ? esc(pki.sanConfig) : '(no SAN config available)'}</pre>
      </div>
    `

    // Wire actions
    el.querySelector('[data-action="download-ca"]')?.addEventListener('click', () => {
      window.open('/get_ca_certificate', '_blank')
    })
    el.querySelector('[data-action="toggle-san"]')?.addEventListener('click', () => {
      this._sanConfigOpen = !this._sanConfigOpen
      const block = el.querySelector('#sanConfigBlock') as HTMLElement
      if (block) block.style.display = this._sanConfigOpen ? 'block' : 'none'
    })
  }

  // ─── Public TLS tab ───────────────────────────────────────────────────────

  private renderPublicTLS(el: HTMLElement, data: CertData) {
    const pub = data.publicTLS
    if (!pub) {
      el.innerHTML = '<div class="infra-empty">No public TLS data available.</div>'
      return
    }

    const domains = [pub.domain, ...(pub.alternateDomains ?? [])].filter(Boolean)
    const extDomains = pub.externalDomains ?? []

    // Build external domain cards
    const extCards = extDomains.map(ext => `
      <div class="infra-section-title">${esc(ext.fqdn)}</div>
      ${renderCertCard(ext.leafCert, ['Envoy SNI listener', 'Browser clients'], data.envoy?.usage)}
    `).join('')

    el.innerHTML = `
      <div class="cert-domain-info infra-card" style="margin-bottom:12px">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
          <span style="font-weight:700;font-size:.92rem">Domain Configuration</span>
          ${badge(pub.protocol.toUpperCase(), '#3b82f6')}
        </div>
        <div class="infra-card-metric">
          Primary: <strong>${esc(pub.domain || '(none)')}</strong>
          ${domains.length > 1 ? `<br>Alternate: ${domains.slice(1).map(d => `<strong>${esc(d)}</strong>`).join(', ')}` : ''}
          ${extDomains.length > 0 ? `<br>External: ${extDomains.map(d => `<strong>${esc(d.fqdn)}</strong>`).join(', ')}` : ''}
        </div>
      </div>

      ${extDomains.length > 0 ? `
        <div class="infra-section-title">External Domain Certificates</div>
        ${extCards}
      ` : ''}

      ${pub.leafCert ? `
        <div class="infra-section-title">Primary Domain Leaf Certificate</div>
        ${renderCertCard(pub.leafCert, ['HTTPS listeners', 'Browser clients'], data.envoy?.usage)}
      ` : (!extDomains.length ? `
        <div class="infra-section-title">Leaf Certificate</div>
        ${renderCertCard(null)}
      ` : '')}

      <div class="infra-section-title">Issuer / Chain Bundle</div>
      ${renderCertCard(pub.issuerBundle, ['Certificate chain validation'], data.envoy?.usage)}
    `
  }

  // ─── Envoy / SDS tab ─────────────────────────────────────────────────────

  private renderEnvoy(el: HTMLElement, data: CertData) {
    const envoy = data.envoy
    if (!envoy) {
      el.innerHTML = '<div class="infra-empty">No Envoy data available.</div>'
      return
    }

    const sdsLabel = envoy.sdsEnabled
      ? badge('SDS ENABLED', '#22c55e')
      : badge('SDS DISABLED', '#f59e0b')

    const rows = (envoy.usage ?? []).map(u => {
      const ok = u.status === 'valid' || u.status === 'ok'
      const color = ok ? '#22c55e' : 'var(--error-color)'
      return `
        <tr>
          <td style="font-weight:600">${esc(u.name)}</td>
          <td>${badge(u.type.toUpperCase(), '#6366f1')}</td>
          <td style="font-family:monospace;font-size:.78rem">${esc(u.certPath)}</td>
          <td style="font-family:monospace;font-size:.78rem">${esc(u.keyPath)}</td>
          <td style="font-family:monospace;font-size:.78rem">${esc(u.caPath)}</td>
          <td>${statusIcon(u.exists)}</td>
          <td>${badge(u.status.toUpperCase(), color)}</td>
        </tr>
      `
    }).join('')

    el.innerHTML = `
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px">
        <span style="font-weight:700;font-size:.92rem">Envoy TLS Secrets</span>
        ${sdsLabel}
      </div>

      ${envoy.usage && envoy.usage.length > 0 ? `
        <div style="overflow-x:auto">
          <table class="infra-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Type</th>
                <th>Cert Path</th>
                <th>Key Path</th>
                <th>CA Path</th>
                <th>Exists</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      ` : '<div class="infra-empty">No SDS secrets configured.</div>'}
    `
  }

  // ─── Warnings ─────────────────────────────────────────────────────────────

  private renderWarnings(warnings: CertWarning[]): string {
    if (!warnings || warnings.length === 0) return ''

    const items = warnings.map(w => `
      <div class="cert-warning-row" style="border-left:3px solid ${severityColor(w.severity)}">
        <span style="color:${severityColor(w.severity)};font-size:1.1rem">${severityIcon(w.severity)}</span>
        <div>
          <span class="cert-warning-scope">${esc(w.scope)}</span>
          <span>${esc(w.message)}</span>
        </div>
      </div>
    `).join('')

    return `
      <div class="infra-section-title" style="margin-top:20px">Warnings</div>
      <div class="cert-warnings-list infra-card">
        ${items}
      </div>
    `
  }
}

// ─── Page-specific styles ────────────────────────────────────────────────────

const PAGE_STYLES = `
  .cert-card {
    margin-bottom: 12px;
  }
  .chain-strip {
    display: flex; gap: 0; margin: -14px -18px 12px;
    border-radius: var(--md-shape-md) var(--md-shape-md) 0 0;
    overflow: hidden;
  }
  .chain-segment {
    flex: 1; text-align: center;
    padding: 6px 4px;
    font-size: .68rem; font-weight: 700;
    text-transform: uppercase; letter-spacing: .04em;
    background: color-mix(in srgb, var(--seg-color) 12%, transparent);
    color: var(--seg-color);
    border-right: 1px solid color-mix(in srgb, var(--seg-color) 25%, transparent);
  }
  .chain-segment:last-child { border-right: none; }
  .chain-icon { margin-left: 2px; }
  .cert-header {
    display: flex; align-items: center; gap: 8px; margin-bottom: 10px;
  }
  .cert-header h3 {
    margin: 0; font-size: .95rem; font-weight: 700;
  }
  .cert-details {
    display: grid; gap: 4px;
  }
  .detail-row {
    display: flex; gap: 8px; font-size: .85rem; line-height: 1.5;
  }
  .detail-row .label {
    min-width: 90px; color: var(--secondary-text-color);
    font-size: .78rem; font-weight: 600; flex-shrink: 0;
  }
  .detail-row .mono, .detail-row span.mono {
    font-family: monospace; font-size: .78rem; word-break: break-all;
  }
  .cert-pills {
    margin-top: 10px; padding-top: 10px;
    border-top: 1px solid var(--border-subtle-color);
    font-size: .82rem; color: var(--secondary-text-color);
    display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
  }
  .pill {
    display: inline-block;
    padding: 2px 10px;
    border-radius: 12px;
    font-size: .72rem; font-weight: 600;
    background: color-mix(in srgb, var(--accent-color) 15%, transparent);
    color: var(--accent-color);
  }
  .cert-actions {
    margin-top: 10px; padding-top: 8px;
    border-top: 1px solid var(--border-subtle-color);
    display: flex; gap: 8px;
  }
  .md-btn-text {
    border: none; background: transparent;
    color: var(--accent-color); cursor: pointer;
    font: var(--md-typescale-label-large);
    padding: 4px 8px; border-radius: var(--md-shape-sm);
  }
  .md-btn-text:hover {
    background: color-mix(in srgb, var(--accent-color) 10%, transparent);
  }
  .san-config {
    background: var(--md-surface-container-low);
    border: 1px solid var(--border-subtle-color);
    border-radius: var(--md-shape-md);
    padding: 12px 16px; margin: 0 0 16px;
    font-family: monospace; font-size: .78rem;
    white-space: pre-wrap; word-break: break-all;
    overflow-x: auto; max-height: 300px;
    color: var(--on-surface-color);
  }
  .cert-warnings-list {
    padding: 0;
  }
  .cert-warning-row {
    display: flex; align-items: flex-start; gap: 10px;
    padding: 10px 14px; font-size: .85rem;
    border-bottom: 1px solid color-mix(in srgb, var(--border-subtle-color) 50%, transparent);
  }
  .cert-warning-row:last-child { border-bottom: none; }
  .cert-warning-scope {
    font-weight: 700; font-size: .75rem;
    text-transform: uppercase; letter-spacing: .04em;
    margin-right: 6px;
    color: var(--secondary-text-color);
  }
`

customElements.define('page-security-certificates', PageSecurityCertificates)
