// src/pages/security_certificates.ts

import {
  INFRA_STYLES, badge, stateColor, esc,
  fmtTime, freshnessBadge,
  type HealthState,
} from '../utils/infra_health'
import { confirmDialog } from '../utils/confirm_dialog'
import { getBaseUrl } from '@globular/sdk'

const POLL = 60_000

type CertMode = 'node' | 'cluster'
type CertTab = 'internal' | 'public' | 'envoy'
type ClusterFilter = 'all' | 'errors' | 'warnings' | 'expiring' | 'unreachable'

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
    listeners: EnvoyListenerTLS[]
    upstreams: EnvoyUpstreamTLS[]
    secrets: EnvoySecretRef[]
    xdsClient: XDSClientTLS
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

interface EnvoyListenerTLS {
  name: string
  address: string
  tlsMode: string
  secretName: string
  certPath: string
  keyPath: string
  exists: boolean
  status: string
  certificateRef: string
}

interface EnvoyUpstreamTLS {
  name: string
  tlsMode: string
  serverCertPath: string
  keyPath: string
  caPath: string
  exists: boolean
  status: string
  certificateRef: string
  caRef: string
}

interface EnvoySecretRef {
  name: string
  type: string
  certPath: string
  keyPath: string
  caPath: string
  exists: boolean
  status: string
  consumers: string[]
}

interface XDSClientTLS {
  enabled: boolean
  certPath: string
  keyPath: string
  caPath: string
  exists: boolean
  status: string
}

interface CertActionResponse {
  ok: boolean
  message: string
}

// ─── Cluster types ────────────────────────────────────────────────────────

interface ClusterCertSummary {
  totalNodes: number
  healthyNodes: number
  warningNodes: number
  errorNodes: number
  unreachableNodes: number
  expiringSoonCount: number
  expiredCount: number
}

interface ClusterTrustDrift {
  internalSANMismatch: boolean
  publicDomainMismatch: boolean
  envoyTLSDrift: boolean
  nodesOutOfPolicy: string[]
}

interface NodeCertPKISummary {
  caStatus: string
  serviceCertStatus: string
  daysUntilExpiry?: number
}

interface NodeCertPublicSummary {
  enabled: boolean
  certStatus: string
  daysUntilExpiry?: number
  domain?: string
}

interface NodeCertEnvoySummary {
  status: string
  listenerIssues: number
  upstreamIssues: number
}

interface ClusterNodeCertStatus {
  nodeId: string
  address: string
  status: string
  internalPKI?: NodeCertPKISummary
  publicTLS?: NodeCertPublicSummary
  envoy?: NodeCertEnvoySummary
  warnings: CertWarning[]
}

interface ClusterCertOverview {
  summary: ClusterCertSummary
  drift: ClusterTrustDrift
  nodes: ClusterNodeCertStatus[]
}

// ─── Backend client ──────────────────────────────────────────────────────────

async function fetchCertificates(): Promise<CertData> {
  const base = getBaseUrl() || ''
  const resp = await fetch(`${base}/admin/certificates`)
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
  return resp.json()
}

async function renewPublicCert(): Promise<CertActionResponse> {
  const base = getBaseUrl() || ''
  const resp = await fetch(`${base}/admin/certificates/renew-public`, { method: 'POST' })
  return resp.json()
}

async function regenerateInternalCerts(): Promise<CertActionResponse> {
  const base = getBaseUrl() || ''
  const resp = await fetch(`${base}/admin/certificates/regenerate-internal`, { method: 'POST' })
  return resp.json()
}

async function fetchClusterCertificates(): Promise<ClusterCertOverview> {
  const base = getBaseUrl() || ''
  const resp = await fetch(`${base}/admin/certificates/cluster`)
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
  private _mode: CertMode = 'node'
  private _loading = false
  private _error: string | null = null
  private _sanConfigOpen = false
  private _actionRunning: string | null = null  // 'renew' | 'regenerate' | null
  private _actionResult: { ok: boolean; message: string } | null = null
  private _clusterData: ClusterCertOverview | null = null
  private _clusterError: string | null = null
  private _clusterFilter: ClusterFilter = 'all'
  private _expandedNodes: Set<string> = new Set()

  private _built = false

  connectedCallback() {
    this.style.display = 'block'
    this._buildShell()
    this._load()
    this._timer = window.setInterval(() => this._load(), POLL)
  }

  disconnectedCallback() {
    if (this._timer) clearInterval(this._timer)
  }

  private _buildShell() {
    if (this._built) return
    this._built = true
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
    this.querySelector('#certRefresh')?.addEventListener('click', () => this._load())
  }

  // ─── Data ───────────────────────────────────────────────────────────────────

  private async _load() {
    this._loading = true
    this._pushData()

    try {
      if (this._mode === 'cluster') {
        this._clusterData = await fetchClusterCertificates()
        this._clusterError = null
      } else {
        this._data = await fetchCertificates()
        this._error = null
      }
    } catch (e: any) {
      if (this._mode === 'cluster') {
        this._clusterError = e?.message ?? 'Failed to fetch cluster certificate data'
      } else {
        this._error = e?.message ?? 'Failed to fetch certificate data'
      }
    }

    this._lastUpdated = new Date()
    this._loading = false
    this._pushData()
  }

  // ─── Render ─────────────────────────────────────────────────────────────────

  private _pushData() {
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

    // Mode tabs (This Node / Cluster)
    const modeError = this._mode === 'cluster' ? this._clusterError : this._error
    const hasData = this._mode === 'cluster' ? !!this._clusterData : !!this._data

    if (modeError && !hasData) {
      body.innerHTML = `
        ${this.renderModeTabs()}
        <div class="cert-error-card infra-card" style="border-left:4px solid var(--error-color)">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
            <span style="font-weight:700;font-size:.92rem">Error</span>
            ${badge('FAILED', 'var(--error-color)')}
          </div>
          <div class="infra-card-metric">${esc(modeError)}</div>
          <div class="infra-card-sub">${this._mode === 'cluster'
            ? 'The cluster controller or /admin/certificates/cluster endpoint may not be available.'
            : 'The /admin/certificates endpoint may not be available yet.'}</div>
        </div>
      `
      this.wireModeTabs(body)
      return
    }

    if (this._mode === 'cluster') {
      this.renderClusterView(body)
      return
    }

    const data = this._data!

    body.innerHTML = `
      ${this.renderModeTabs()}
      ${this.renderActionToast()}
      ${this.renderOverview(data)}
      ${this.renderTabs()}
      <div id="certTabContent"></div>
      ${this.renderWarnings(data.warnings)}
    `

    this.wireModeTabs(body)

    // Wire toast dismiss
    body.querySelector('[data-action="dismiss-toast"]')?.addEventListener('click', () => {
      this._actionResult = null
      this._pushData()
    })

    // Wire tabs
    body.querySelectorAll('.infra-tab:not(.mode-tab)').forEach(btn => {
      btn.addEventListener('click', () => {
        this._tab = (btn as HTMLElement).dataset.tab as CertTab
        this._pushData()
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

  private renderModeTabs(): string {
    return `
      <div class="mode-tabs" style="margin-bottom:16px">
        <button class="mode-tab ${this._mode === 'node' ? 'active' : ''}" data-mode="node">This Node</button>
        <button class="mode-tab ${this._mode === 'cluster' ? 'active' : ''}" data-mode="cluster">Cluster</button>
      </div>
    `
  }

  private wireModeTabs(container: HTMLElement) {
    container.querySelectorAll('.mode-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        const newMode = (btn as HTMLElement).dataset.mode as CertMode
        if (newMode !== this._mode) {
          this._mode = newMode
          this._load()
        }
      })
    })
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

    const envoySecretsOk = (data.envoy?.secrets ?? []).every(s => s.status === 'ok')
    const envoyXdsOk = data.envoy?.xdsClient?.status === 'ok'
    const envoyOk = envoySecretsOk && envoyXdsOk
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
            <span class="infra-card-value" style="font-size:1.4rem">${(data.envoy?.secrets ?? []).length}</span>
            ${badge(envoyOk ? 'HEALTHY' : 'ISSUES', stateColor(envoyState))}
          </div>
          <div class="infra-card-sub">SDS ${data.envoy?.sdsEnabled ? 'enabled' : 'disabled'} &middot; ${(data.envoy?.listeners ?? []).length} listener(s) &middot; ${(data.envoy?.upstreams ?? []).length} upstream(s)</div>
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

    const canRegenerate = pki.ca?.exists && pki.ca?.status !== 'missing'
    const regenDisabled = !canRegenerate || !!this._actionRunning
    const regenLabel = this._actionRunning === 'regenerate' ? 'Regenerating...' : 'Regenerate internal certificates'

    el.innerHTML = `
      <div class="infra-section-title">Certificate Authority</div>
      ${renderCertCard(pki.ca, pki.consumers, data.envoy?.usage, caActions)}

      <div class="infra-section-title">Service Certificate</div>
      ${renderCertCard(pki.serviceCert, pki.consumers, data.envoy?.usage)}

      <div class="cert-action-bar">
        <button class="cert-action-btn" data-action="regenerate-internal" ${regenDisabled ? 'disabled' : ''}>
          ${regenLabel}
        </button>
        <span class="cert-action-hint">Used by: gRPC services, Envoy upstream TLS</span>
      </div>

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
    el.querySelector('[data-action="regenerate-internal"]')?.addEventListener('click', () => {
      this.doRegenerateInternal()
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

      ${pub.protocol === 'https' && extDomains.length > 0 ? `
        <div class="cert-action-bar">
          <button class="cert-action-btn" data-action="renew-public" ${this._actionRunning ? 'disabled' : ''}>
            ${this._actionRunning === 'renew' ? 'Renewing...' : 'Renew public certificate'}
          </button>
          <span class="cert-action-hint">Used by: Envoy public listener, browser clients</span>
        </div>
      ` : ''}
    `

    // Wire renew action
    el.querySelector('[data-action="renew-public"]')?.addEventListener('click', () => {
      this.doRenewPublic()
    })
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

    el.innerHTML = `
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px">
        <span style="font-weight:700;font-size:.92rem">Envoy / TLS Consumers</span>
        ${sdsLabel}
      </div>

      ${this.renderEnvoyListeners(envoy.listeners ?? [])}
      ${this.renderEnvoyUpstreams(envoy.upstreams ?? [])}
      ${this.renderEnvoySecrets(envoy.secrets ?? [])}
      ${this.renderEnvoyXDSClient(envoy.xdsClient)}
    `

    // Wire detail toggles
    el.querySelectorAll('[data-toggle-detail]').forEach(btn => {
      btn.addEventListener('click', () => {
        const target = (btn as HTMLElement).dataset.toggleDetail!
        const detail = el.querySelector(`[data-detail="${target}"]`) as HTMLElement
        if (detail) {
          const open = detail.style.display !== 'none'
          detail.style.display = open ? 'none' : 'block'
          ;(btn as HTMLElement).textContent = open ? 'Show details' : 'Hide details'
        }
      })
    })
  }

  private renderEnvoyListeners(listeners: EnvoyListenerTLS[]): string {
    if (!listeners.length) return ''

    const rows = listeners.map((l, i) => {
      const ok = l.status === 'ok'
      const color = ok ? '#22c55e' : 'var(--error-color)'
      const modeColor = l.tlsMode === 'public' ? '#8b5cf6' : '#6366f1'
      return `
        <tr>
          <td style="font-weight:600">${esc(l.name)}</td>
          <td>${esc(l.address)}</td>
          <td>${badge(l.tlsMode.toUpperCase(), modeColor)}</td>
          <td><span class="pill">${esc(l.secretName)}</span></td>
          <td>${statusIcon(l.exists)}</td>
          <td>${badge(l.status.toUpperCase(), color)}</td>
          <td><button class="md-btn-text" data-toggle-detail="listener-${i}">Show details</button></td>
        </tr>
        <tr data-detail="listener-${i}" style="display:none">
          <td colspan="7" class="envoy-detail-cell">
            <div class="envoy-detail-grid">
              <span class="label">Cert Path</span><span class="mono">${esc(l.certPath)}</span>
              <span class="label">Key Path</span><span class="mono">${esc(l.keyPath)}</span>
              <span class="label">Certificate Ref</span><span>${esc(l.certificateRef)}</span>
            </div>
          </td>
        </tr>
      `
    }).join('')

    return `
      <div class="infra-section-title">Public &amp; Internal Listeners</div>
      <div style="overflow-x:auto;margin-bottom:16px">
        <table class="infra-table">
          <thead>
            <tr><th>Listener</th><th>Address</th><th>TLS Mode</th><th>Secret</th><th>Exists</th><th>Status</th><th></th></tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `
  }

  private renderEnvoyUpstreams(upstreams: EnvoyUpstreamTLS[]): string {
    if (!upstreams.length) return ''

    const rows = upstreams.map((u, i) => {
      const ok = u.status === 'ok' || u.status === 'no_tls'
      const color = ok ? '#22c55e' : 'var(--error-color)'
      const modeColor = u.tlsMode === 'none' ? 'var(--secondary-text-color)' : '#6366f1'
      return `
        <tr>
          <td style="font-weight:600">${esc(u.name)}</td>
          <td>${badge(u.tlsMode.toUpperCase(), modeColor)}</td>
          <td>${u.tlsMode !== 'none' ? statusIcon(u.exists) : '<span style="color:var(--secondary-text-color)">—</span>'}</td>
          <td>${badge(u.status.toUpperCase(), color)}</td>
          <td><button class="md-btn-text" data-toggle-detail="upstream-${i}">Show details</button></td>
        </tr>
        <tr data-detail="upstream-${i}" style="display:none">
          <td colspan="5" class="envoy-detail-cell">
            <div class="envoy-detail-grid">
              ${u.caPath ? `<span class="label">CA Bundle</span><span class="mono">${esc(u.caPath)}</span>` : ''}
              ${u.certificateRef ? `<span class="label">Cert Ref</span><span>${esc(u.certificateRef)}</span>` : ''}
              ${u.caRef ? `<span class="label">CA Ref</span><span>${esc(u.caRef)}</span>` : ''}
            </div>
          </td>
        </tr>
      `
    }).join('')

    return `
      <div class="infra-section-title">Upstream TLS</div>
      <div style="overflow-x:auto;margin-bottom:16px">
        <table class="infra-table">
          <thead>
            <tr><th>Upstream / Service</th><th>TLS Mode</th><th>Exists</th><th>Status</th><th></th></tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `
  }

  private renderEnvoySecrets(secrets: EnvoySecretRef[]): string {
    if (!secrets.length) return ''

    const cards = secrets.map((s, i) => {
      const ok = s.status === 'ok'
      const color = ok ? '#22c55e' : 'var(--error-color)'
      const typeColor = s.type === 'tls_certificate' ? '#8b5cf6' : '#0ea5e9'
      const consumers = (s.consumers ?? []).map(c => `<span class="pill">${esc(c)}</span>`).join(' ')
      return `
        <div class="infra-card envoy-secret-card" style="border-left:4px solid ${color}">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
            <span style="font-weight:700;font-size:.88rem">${esc(s.name)}</span>
            ${badge(s.type.replace('_', ' ').toUpperCase(), typeColor)}
            ${badge(s.status.toUpperCase(), color)}
            ${statusIcon(s.exists)}
          </div>
          ${consumers ? `<div class="cert-pills" style="margin-top:6px;padding-top:6px">Used by: ${consumers}</div>` : ''}
          <div style="margin-top:6px">
            <button class="md-btn-text" data-toggle-detail="secret-${i}">Show details</button>
          </div>
          <div data-detail="secret-${i}" style="display:none;margin-top:8px" class="envoy-detail-grid">
            ${s.certPath ? `<span class="label">Cert</span><span class="mono">${esc(s.certPath)}</span>` : ''}
            ${s.keyPath ? `<span class="label">Key</span><span class="mono">${esc(s.keyPath)}</span>` : ''}
            ${s.caPath ? `<span class="label">CA</span><span class="mono">${esc(s.caPath)}</span>` : ''}
          </div>
        </div>
      `
    }).join('')

    return `
      <div class="infra-section-title">SDS Secrets</div>
      ${cards}
    `
  }

  private renderEnvoyXDSClient(xds: XDSClientTLS | undefined): string {
    if (!xds) return ''

    const ok = xds.status === 'ok'
    const color = ok ? '#22c55e' : 'var(--error-color)'

    return `
      <div class="infra-section-title">xDS Client TLS</div>
      <div class="infra-card" style="border-left:4px solid ${color};margin-bottom:16px">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
          <span style="font-weight:700;font-size:.88rem">Envoy xDS Client</span>
          ${badge(xds.enabled ? 'ENABLED' : 'DISABLED', xds.enabled ? '#22c55e' : '#f59e0b')}
          ${badge(xds.status.toUpperCase(), color)}
          ${statusIcon(xds.exists)}
        </div>
        <div class="envoy-detail-grid">
          <span class="label">Cert</span><span class="mono">${esc(xds.certPath)}</span>
          <span class="label">Key</span><span class="mono">${esc(xds.keyPath)}</span>
          <span class="label">CA</span><span class="mono">${esc(xds.caPath)}</span>
        </div>
      </div>
    `
  }

  // ─── Action toast ─────────────────────────────────────────────────────────

  private renderActionToast(): string {
    if (this._actionRunning) {
      const label = this._actionRunning === 'renew' ? 'Renewing public certificate' : 'Regenerating internal certificates'
      return `
        <div class="action-toast" style="border-left:4px solid #3b82f6;background:color-mix(in srgb, #3b82f6 8%, var(--md-surface-container-low))">
          <span class="action-spinner"></span>
          <span>${label}...</span>
        </div>
      `
    }
    if (this._actionResult) {
      const color = this._actionResult.ok ? '#22c55e' : 'var(--error-color)'
      const icon = this._actionResult.ok ? '&#10003;' : '&#10005;'
      return `
        <div class="action-toast" style="border-left:4px solid ${color}">
          <span style="color:${color};font-weight:700;font-size:1.1rem">${icon}</span>
          <span>${esc(this._actionResult.message)}</span>
          <button class="action-toast-dismiss" data-action="dismiss-toast">&times;</button>
        </div>
      `
    }
    return ''
  }

  // ─── Actions ─────────────────────────────────────────────────────────────

  private async doRenewPublic() {
    if (this._actionRunning) return
    const ok = await confirmDialog({
      title: 'Renew Public Certificate',
      message: 'Renew the public certificate for all external domains?\n\nThis will trigger the configured ACME renewal flow. The domain reconciler will re-obtain certificates within ~60 seconds.',
      okLabel: 'Renew',
      icon: 'fa fa-certificate',
    })
    if (!ok) return

    this._actionRunning = 'renew'
    this._actionResult = null
    this._pushData()

    try {
      const result = await renewPublicCert()
      this._actionResult = result
    } catch (e: any) {
      this._actionResult = { ok: false, message: e?.message ?? 'Failed to renew public certificate' }
    }

    this._actionRunning = null
    this._pushData()

    // Delayed re-fetch to pick up changes
    setTimeout(() => this._load(), 3000)
  }

  private async doRegenerateInternal() {
    if (this._actionRunning) return
    const ok = await confirmDialog({
      title: 'Regenerate Internal Certificates',
      message: 'Regenerate internal certificates using the current SAN configuration?\n\nThis will update certificate files consumed by internal services and Envoy. Services may need restart to pick up new certificates.',
      okLabel: 'Regenerate',
      variant: 'danger',
      icon: 'fa fa-shield',
    })
    if (!ok) return

    this._actionRunning = 'regenerate'
    this._actionResult = null
    this._pushData()

    try {
      const result = await regenerateInternalCerts()
      this._actionResult = result
    } catch (e: any) {
      this._actionResult = { ok: false, message: e?.message ?? 'Failed to regenerate internal certificates' }
    }

    this._actionRunning = null
    this._pushData()

    // Immediate + delayed re-fetch
    this._load()
    setTimeout(() => this._load(), 3000)
  }

  // ─── Cluster view ─────────────────────────────────────────────────────────

  private renderClusterView(body: HTMLElement) {
    const data = this._clusterData
    if (!data) {
      body.innerHTML = `${this.renderModeTabs()}<div class="infra-empty">No cluster data available.</div>`
      this.wireModeTabs(body)
      return
    }

    const s = data.summary
    const drift = data.drift
    const hasDrift = drift.internalSANMismatch || drift.publicDomainMismatch || drift.envoyTLSDrift

    // Filter nodes
    const filtered = (data.nodes ?? []).filter(n => {
      switch (this._clusterFilter) {
        case 'errors':      return n.status === 'error'
        case 'warnings':    return n.status === 'warning'
        case 'expiring':    return (n.internalPKI?.daysUntilExpiry != null && n.internalPKI.daysUntilExpiry < 30) ||
                                   (n.publicTLS?.daysUntilExpiry != null && n.publicTLS.daysUntilExpiry < 30)
        case 'unreachable': return n.status === 'unreachable'
        default:            return true
      }
    })

    body.innerHTML = `
      ${this.renderModeTabs()}

      <div class="infra-grid" style="margin-bottom:16px">
        <div class="infra-card" style="border-left:4px solid ${stateColor('healthy')}">
          <div class="infra-card-label">Total Nodes</div>
          <div class="infra-card-value" style="font-size:1.4rem">${s.totalNodes}</div>
          <div class="infra-card-sub">${s.healthyNodes} healthy</div>
        </div>
        <div class="infra-card" style="border-left:4px solid ${s.warningNodes > 0 ? stateColor('degraded') : stateColor('healthy')}">
          <div class="infra-card-label">Warnings</div>
          <div class="infra-card-value" style="font-size:1.4rem">${s.warningNodes}</div>
          <div class="infra-card-sub">${s.expiringSoonCount} expiring soon</div>
        </div>
        <div class="infra-card" style="border-left:4px solid ${s.errorNodes > 0 ? stateColor('critical') : stateColor('healthy')}">
          <div class="infra-card-label">Errors</div>
          <div class="infra-card-value" style="font-size:1.4rem">${s.errorNodes}</div>
          <div class="infra-card-sub">${s.expiredCount} expired</div>
        </div>
        <div class="infra-card" style="border-left:4px solid ${s.unreachableNodes > 0 ? 'var(--secondary-text-color)' : stateColor('healthy')}">
          <div class="infra-card-label">Unreachable</div>
          <div class="infra-card-value" style="font-size:1.4rem">${s.unreachableNodes}</div>
          <div class="infra-card-sub">${s.totalNodes - s.unreachableNodes} reachable</div>
        </div>
      </div>

      ${hasDrift ? this.renderDriftBanner(drift) : ''}

      <div class="cluster-filters" style="margin-bottom:12px">
        ${(['all', 'errors', 'warnings', 'expiring', 'unreachable'] as ClusterFilter[]).map(f =>
          `<button class="cluster-filter-btn ${this._clusterFilter === f ? 'active' : ''}" data-filter="${f}">${f.charAt(0).toUpperCase() + f.slice(1)}</button>`
        ).join('')}
      </div>

      ${filtered.length > 0 ? `
        <div style="overflow-x:auto">
          <table class="infra-table">
            <thead>
              <tr><th>Node</th><th>Internal PKI</th><th>Public TLS</th><th>Envoy TLS</th><th>Status</th><th>Warnings</th><th></th></tr>
            </thead>
            <tbody>${filtered.map(n => this.renderClusterNodeRow(n)).join('')}</tbody>
          </table>
        </div>
      ` : '<div class="infra-empty">No nodes match the selected filter.</div>'}
    `

    this.wireModeTabs(body)

    // Wire filters
    body.querySelectorAll('.cluster-filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this._clusterFilter = (btn as HTMLElement).dataset.filter as ClusterFilter
        this.renderClusterView(body)
      })
    })

    // Wire node expand toggles
    body.querySelectorAll('[data-toggle-node]').forEach(btn => {
      btn.addEventListener('click', () => {
        const nodeId = (btn as HTMLElement).dataset.toggleNode!
        if (this._expandedNodes.has(nodeId)) {
          this._expandedNodes.delete(nodeId)
        } else {
          this._expandedNodes.add(nodeId)
        }
        this.renderClusterView(body)
      })
    })
  }

  private renderDriftBanner(drift: ClusterTrustDrift): string {
    const items: string[] = []
    if (drift.internalSANMismatch) items.push('Internal certificate status mismatch across nodes')
    if (drift.publicDomainMismatch) items.push('Public TLS domain mismatch across nodes')
    if (drift.envoyTLSDrift) items.push('Envoy TLS configuration drift across nodes')

    return `
      <div class="drift-banner infra-card" style="border-left:4px solid #f59e0b;margin-bottom:16px;background:color-mix(in srgb, #f59e0b 6%, var(--md-surface-container-low))">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
          <span style="color:#f59e0b;font-size:1.2rem;font-weight:700">&#9888;</span>
          <span style="font-weight:700;font-size:.92rem">Cluster Trust Drift Detected</span>
        </div>
        <ul style="margin:0;padding-left:20px;font-size:.85rem">
          ${items.map(i => `<li>${esc(i)}</li>`).join('')}
        </ul>
        ${drift.nodesOutOfPolicy.length > 0 ? `
          <div style="margin-top:6px;font-size:.82rem;color:var(--secondary-text-color)">
            Affected nodes: ${drift.nodesOutOfPolicy.map(n => `<span class="pill">${esc(n)}</span>`).join(' ')}
          </div>
        ` : ''}
      </div>
    `
  }

  private renderClusterNodeRow(n: ClusterNodeCertStatus): string {
    const statusColors: Record<string, string> = {
      healthy: '#22c55e', warning: '#f59e0b', error: 'var(--error-color)', unreachable: 'var(--secondary-text-color)'
    }
    const color = statusColors[n.status] ?? 'var(--secondary-text-color)'
    const warnCount = (n.warnings ?? []).length
    const expanded = this._expandedNodes.has(n.nodeId)

    // PKI cell
    let pkiCell = '<span style="color:var(--secondary-text-color)">—</span>'
    if (n.internalPKI) {
      const pkiColor = n.internalPKI.serviceCertStatus === 'valid' ? '#22c55e'
        : n.internalPKI.serviceCertStatus === 'expiring' ? '#f59e0b' : 'var(--error-color)'
      const days = n.internalPKI.daysUntilExpiry != null ? ` (${n.internalPKI.daysUntilExpiry}d)` : ''
      pkiCell = `${badge(n.internalPKI.serviceCertStatus.toUpperCase(), pkiColor)}${days}`
    }

    // Public TLS cell
    let pubCell = '<span style="color:var(--secondary-text-color)">—</span>'
    if (n.publicTLS) {
      if (n.publicTLS.certStatus === 'not_applicable') {
        pubCell = `${badge('N/A', 'var(--secondary-text-color)')}`
      } else {
        const pubColor = n.publicTLS.certStatus === 'valid' ? '#22c55e'
          : n.publicTLS.certStatus === 'expiring' ? '#f59e0b' : 'var(--error-color)'
        const days = n.publicTLS.daysUntilExpiry != null ? ` (${n.publicTLS.daysUntilExpiry}d)` : ''
        pubCell = `${badge(n.publicTLS.certStatus.toUpperCase(), pubColor)}${days}`
      }
    }

    // Envoy cell
    let envoyCell = '<span style="color:var(--secondary-text-color)">—</span>'
    if (n.envoy) {
      const envoyColor = n.envoy.status === 'ok' ? '#22c55e'
        : n.envoy.status === 'warning' ? '#f59e0b' : 'var(--error-color)'
      const issues = n.envoy.listenerIssues + n.envoy.upstreamIssues
      envoyCell = `${badge(n.envoy.status.toUpperCase(), envoyColor)}${issues > 0 ? ` ${issues} issue${issues > 1 ? 's' : ''}` : ''}`
    }

    const expandRow = expanded ? `
      <tr>
        <td colspan="7" class="envoy-detail-cell">
          ${this.renderNodeDrillDown(n)}
        </td>
      </tr>
    ` : ''

    return `
      <tr>
        <td>
          <div style="font-weight:600">${esc(n.nodeId)}</div>
          <div style="font-size:.75rem;color:var(--secondary-text-color)">${esc(n.address)}</div>
        </td>
        <td>${pkiCell}</td>
        <td>${pubCell}</td>
        <td>${envoyCell}</td>
        <td>${badge(n.status.toUpperCase(), color)}</td>
        <td>${warnCount > 0 ? `<span style="color:#f59e0b;font-weight:600">${warnCount}</span>` : '<span style="color:var(--secondary-text-color)">0</span>'}</td>
        <td><button class="md-btn-text" data-toggle-node="${esc(n.nodeId)}">${expanded ? 'Hide' : 'Details'}</button></td>
      </tr>
      ${expandRow}
    `
  }

  private renderNodeDrillDown(n: ClusterNodeCertStatus): string {
    const sections: string[] = []

    if (n.internalPKI) {
      sections.push(`
        <div class="envoy-detail-grid">
          <span class="label">CA Status</span><span>${esc(n.internalPKI.caStatus)}</span>
          <span class="label">Service Cert</span><span>${esc(n.internalPKI.serviceCertStatus)}</span>
          ${n.internalPKI.daysUntilExpiry != null ? `<span class="label">Expires In</span><span>${n.internalPKI.daysUntilExpiry} days</span>` : ''}
        </div>
      `)
    }

    if (n.publicTLS && n.publicTLS.enabled) {
      sections.push(`
        <div class="envoy-detail-grid" style="margin-top:8px">
          <span class="label">Public Domain</span><span>${esc(n.publicTLS.domain ?? '')}</span>
          <span class="label">Cert Status</span><span>${esc(n.publicTLS.certStatus)}</span>
          ${n.publicTLS.daysUntilExpiry != null ? `<span class="label">Expires In</span><span>${n.publicTLS.daysUntilExpiry} days</span>` : ''}
        </div>
      `)
    }

    if (n.envoy) {
      sections.push(`
        <div class="envoy-detail-grid" style="margin-top:8px">
          <span class="label">Envoy Status</span><span>${esc(n.envoy.status)}</span>
          <span class="label">Listener Issues</span><span>${n.envoy.listenerIssues}</span>
          <span class="label">Upstream Issues</span><span>${n.envoy.upstreamIssues}</span>
        </div>
      `)
    }

    if (n.warnings && n.warnings.length > 0) {
      sections.push(`
        <div style="margin-top:8px">
          <div style="font-weight:600;font-size:.82rem;margin-bottom:4px">Warnings</div>
          ${n.warnings.map(w => `
            <div style="display:flex;align-items:flex-start;gap:6px;font-size:.82rem;padding:2px 0">
              <span style="color:${severityColor(w.severity)}">${severityIcon(w.severity)}</span>
              <span>${esc(w.message)}</span>
            </div>
          `).join('')}
        </div>
      `)
    }

    return sections.length > 0 ? sections.join('') : '<span style="color:var(--secondary-text-color);font-size:.82rem">No details available</span>'
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
  .cert-action-bar {
    display: flex; align-items: center; gap: 12px;
    margin: 16px 0; padding: 12px 16px;
    background: var(--md-surface-container-low);
    border: 1px solid var(--border-subtle-color);
    border-radius: var(--md-shape-md);
  }
  .cert-action-btn {
    padding: 8px 20px;
    border: none; border-radius: var(--md-shape-sm);
    background: var(--accent-color);
    color: var(--on-accent-color, #fff);
    font: var(--md-typescale-label-large);
    cursor: pointer;
    transition: opacity .15s;
  }
  .cert-action-btn:hover:not(:disabled) {
    opacity: .85;
  }
  .cert-action-btn:disabled {
    opacity: .5; cursor: not-allowed;
  }
  .cert-action-hint {
    font-size: .78rem;
    color: var(--secondary-text-color);
  }
  .action-toast {
    display: flex; align-items: center; gap: 10px;
    padding: 10px 16px; margin-bottom: 12px;
    border-radius: var(--md-shape-md);
    background: var(--md-surface-container-low);
    font-size: .88rem;
  }
  .action-toast-dismiss {
    margin-left: auto;
    border: none; background: transparent;
    color: var(--secondary-text-color);
    font-size: 1.2rem; cursor: pointer;
    padding: 2px 6px; border-radius: 4px;
  }
  .action-toast-dismiss:hover {
    background: color-mix(in srgb, var(--on-surface-color) 10%, transparent);
  }
  @keyframes cert-spin {
    to { transform: rotate(360deg); }
  }
  .action-spinner {
    display: inline-block;
    width: 16px; height: 16px;
    border: 2px solid #3b82f6;
    border-top-color: transparent;
    border-radius: 50%;
    animation: cert-spin .6s linear infinite;
  }
  .envoy-detail-cell {
    padding: 8px 16px !important;
    background: color-mix(in srgb, var(--md-surface-container-low) 60%, transparent);
  }
  .envoy-detail-grid {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 4px 12px;
    font-size: .82rem;
  }
  .envoy-detail-grid .label {
    color: var(--secondary-text-color);
    font-weight: 600;
    font-size: .78rem;
  }
  .envoy-detail-grid .mono {
    font-family: monospace;
    font-size: .76rem;
    word-break: break-all;
  }
  .envoy-secret-card {
    margin-bottom: 10px;
  }
  .mode-tabs {
    display: flex; gap: 0;
    border-bottom: 2px solid var(--border-subtle-color);
  }
  .mode-tab {
    padding: 8px 20px;
    border: none; background: transparent;
    font: var(--md-typescale-label-large);
    color: var(--secondary-text-color);
    cursor: pointer;
    border-bottom: 2px solid transparent;
    margin-bottom: -2px;
    transition: color .15s, border-color .15s;
  }
  .mode-tab:hover {
    color: var(--on-surface-color);
  }
  .mode-tab.active {
    color: var(--accent-color);
    border-bottom-color: var(--accent-color);
    font-weight: 700;
  }
  .cluster-filters {
    display: flex; gap: 6px; flex-wrap: wrap;
  }
  .cluster-filter-btn {
    padding: 4px 14px;
    border: 1px solid var(--border-subtle-color);
    border-radius: 16px;
    background: transparent;
    font-size: .78rem; font-weight: 600;
    color: var(--secondary-text-color);
    cursor: pointer;
    transition: all .15s;
  }
  .cluster-filter-btn:hover {
    border-color: var(--accent-color);
    color: var(--accent-color);
  }
  .cluster-filter-btn.active {
    background: color-mix(in srgb, var(--accent-color) 12%, transparent);
    border-color: var(--accent-color);
    color: var(--accent-color);
  }
  .drift-banner ul {
    list-style: disc;
    color: var(--on-surface-color);
  }
`

customElements.define('page-security-certificates', PageSecurityCertificates)
