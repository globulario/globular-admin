// src/pages/security_secrets.ts
//
// Unified secrets management: DNS provider credentials, MinIO keys,
// backup/restic credentials, ScyllaDB config, and platform tokens.

import {
  fetchProviders, saveProvider, deleteProvider,
  requireBaseUrl, saveServiceConfig,
  type DNSProviderConfig,
} from '@globular/sdk'

import {
  INFRA_STYLES, badge, esc, fmtTime, freshnessBadge,
} from '../utils/infra_health'

import { confirmDialog } from '../utils/confirm_dialog'

const POLL = 60_000

type SecretsTab = 'providers' | 'storage' | 'backup' | 'tokens'

// ── Types ───────────────────────────────────────────────────────────────────

interface BackupConfig {
  Id: string
  MinioEndpoint: string
  MinioAccessKey: string
  MinioSecretKey: string
  MinioSecure: boolean
  ResticPassword: string
  ResticRepo: string
  ResticPaths: string
  ScyllaCluster: string
  ScyllaLocation: string
  ScyllaManagerAPI: string
  Destinations: DestinationConfig[]
}

interface DestinationConfig {
  Name: string
  Type: string
  Path: string
  Primary?: boolean
  AuthoritativeForRecovery?: boolean
  Options: Record<string, string>
}

// ── Credential field definitions per provider type ──────────────────────────

interface CredField {
  key: string
  label: string
  placeholder: string
  secret: boolean
  required?: boolean
}

function credFieldsForType(type: string): CredField[] {
  switch (type) {
    case 'cloudflare':
      return [
        { key: 'api_token', label: 'API Token', placeholder: 'Cloudflare API token', secret: true, required: true },
      ]
    case 'godaddy':
      return [
        { key: 'api_key', label: 'API Key', placeholder: 'GoDaddy API key', secret: true, required: true },
        { key: 'api_secret', label: 'API Secret', placeholder: 'GoDaddy API secret', secret: true, required: true },
      ]
    case 'route53':
      return [
        { key: 'access_key_id', label: 'Access Key ID', placeholder: 'AWS access key', secret: false, required: true },
        { key: 'secret_access_key', label: 'Secret Access Key', placeholder: 'AWS secret key', secret: true, required: true },
        { key: 'hosted_zone_id', label: 'Hosted Zone ID', placeholder: 'Z0123456789', secret: false, required: true },
        { key: 'region', label: 'Region', placeholder: 'us-east-1', secret: false },
      ]
    case 'local':
      return [
        { key: 'address', label: 'DNS gRPC Address', placeholder: 'localhost:10006', secret: false },
      ]
    case 'manual':
      return []
    default:
      return []
  }
}

function providerTypeColor(type: string): string {
  switch (type) {
    case 'cloudflare': return '#f48120'
    case 'godaddy':    return '#1bdbdb'
    case 'route53':    return '#ff9900'
    case 'local':      return 'var(--primary-color)'
    case 'manual':     return 'var(--secondary-text-color)'
    default:           return 'var(--secondary-text-color)'
  }
}

function isSecretKey(k: string): boolean {
  return /secret|password|token|key/i.test(k) && !/endpoint|cluster|repo|path|location|api$/i.test(k)
}

// ── Page styles ─────────────────────────────────────────────────────────────

const PAGE_STYLES = `
  .sec-tabs {
    display: flex; gap: 0; margin-bottom: 16px;
    border-bottom: 2px solid var(--border-subtle-color);
    flex-wrap: wrap;
  }
  .sec-tab {
    padding: 8px 18px; cursor: pointer;
    font: var(--md-typescale-label-large);
    color: var(--secondary-text-color);
    border: none; background: none;
    border-bottom: 2px solid transparent;
    margin-bottom: -2px;
    transition: color .15s, border-color .15s;
    white-space: nowrap;
  }
  .sec-tab:hover { color: var(--on-surface-color); }
  .sec-tab--active {
    color: var(--primary-color);
    border-bottom-color: var(--primary-color);
  }
  .sec-card {
    background: var(--md-surface-container);
    border: 1px solid var(--border-subtle-color);
    border-radius: var(--md-shape-md);
    padding: 16px 18px; margin-bottom: 12px;
  }
  .sec-card h3 {
    margin: 0 0 8px; font-size: .95rem; font-weight: 700;
  }
  .sec-detail {
    display: flex; gap: 8px; font-size: .85rem; line-height: 1.6;
  }
  .sec-detail .label {
    min-width: 130px; color: var(--secondary-text-color);
    font-size: .78rem; font-weight: 600; flex-shrink: 0;
  }
  .sec-detail .mono {
    font-family: monospace; font-size: .78rem; word-break: break-all;
  }
  .sec-cred-row {
    display: flex; align-items: center; gap: 8px;
    font-size: .82rem; line-height: 1.6;
  }
  .sec-cred-key {
    min-width: 130px; color: var(--secondary-text-color);
    font-size: .78rem; font-weight: 600;
  }
  .sec-cred-val {
    font-family: monospace; font-size: .78rem;
    color: var(--on-surface-color);
    letter-spacing: .03em;
  }
  .sec-reveal-btn {
    background: none; border: none; cursor: pointer;
    font-size: .75rem; padding: 2px 6px; border-radius: 4px;
    color: var(--primary-color);
  }
  .sec-reveal-btn:hover {
    background: color-mix(in srgb, var(--primary-color) 10%, transparent);
  }
  .sec-actions {
    display: flex; gap: 6px; margin-top: 10px;
  }
  .sec-btn-sm {
    border: none; border-radius: 4px; cursor: pointer;
    padding: 4px 12px; font-size: .78rem; font-weight: 500;
    font-family: Roboto, sans-serif;
    transition: background .15s;
  }
  .sec-btn-edit {
    background: color-mix(in srgb, var(--primary-color) 15%, transparent);
    color: var(--primary-color);
  }
  .sec-btn-edit:hover { background: color-mix(in srgb, var(--primary-color) 25%, transparent); }
  .sec-btn-del {
    background: color-mix(in srgb, var(--error-color) 12%, transparent);
    color: var(--error-color);
  }
  .sec-btn-del:hover { background: color-mix(in srgb, var(--error-color) 22%, transparent); }
  .sec-form {
    background: var(--md-surface-container-low);
    border: 1px solid var(--border-subtle-color);
    border-radius: var(--md-shape-md);
    padding: 16px; margin-bottom: 16px;
  }
  .sec-form h4 { margin: 0 0 12px; font-size: .9rem; }
  .sec-form-grid {
    display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 10px; margin-bottom: 12px;
  }
  .sec-form-grid label {
    display: flex; flex-direction: column; gap: 4px;
    font-size: .82rem; color: var(--secondary-text-color);
  }
  .sec-input {
    padding: 6px 10px; border-radius: 6px; font-size: .85rem;
    border: 1px solid var(--border-subtle-color);
    background: var(--surface-color); color: var(--on-surface-color);
    font-family: inherit;
  }
  .sec-input:focus {
    outline: none; border-color: var(--primary-color);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--primary-color) 25%, transparent);
  }
  .sec-select {
    padding: 6px 10px; border-radius: 6px; font-size: .85rem;
    border: 1px solid var(--border-subtle-color);
    background: var(--surface-color); color: var(--on-surface-color);
    font-family: inherit;
  }
  .sec-form-actions { display: flex; gap: 8px; margin-top: 12px; }
  .sec-token-card {
    display: flex; align-items: center; gap: 12px;
    padding: 10px 14px; margin-bottom: 8px;
    background: var(--md-surface-container);
    border: 1px solid var(--border-subtle-color);
    border-radius: var(--md-shape-md);
    font-size: .82rem;
  }
  .sec-token-name {
    font-weight: 600; min-width: 160px;
  }
  .sec-token-val {
    font-family: monospace; font-size: .75rem;
    color: var(--secondary-text-color);
    overflow: hidden; text-overflow: ellipsis;
    max-width: 400px; white-space: nowrap;
  }
  .sec-empty {
    text-align: center; padding: 32px;
    color: var(--secondary-text-color); font-size: .88rem;
  }
  .sec-toolbar {
    display: flex; align-items: center; gap: 8px; margin-bottom: 12px;
  }
  .sec-section {
    margin-bottom: 20px;
  }
  .sec-section-title {
    font-size: .82rem; font-weight: 700; text-transform: uppercase;
    letter-spacing: .06em; color: var(--secondary-text-color);
    margin: 0 0 10px; padding-bottom: 6px;
    border-bottom: 1px solid var(--border-subtle-color);
  }
  .sec-dest-card {
    background: var(--md-surface-container);
    border: 1px solid var(--border-subtle-color);
    border-radius: var(--md-shape-sm);
    padding: 12px 14px; margin-bottom: 8px;
  }
`

// ── Helper: masked credential row ───────────────────────────────────────────

function credRow(
  key: string, value: string, id: string,
  revealed: Set<string>, secret: boolean,
): string {
  const show = revealed.has(id)
  const display = !secret
    ? esc(value || '—')
    : (show ? esc(value) : (value ? value.slice(0, 2) + '••••••' : '—'))
  const toggle = secret && value
    ? `<button class="sec-reveal-btn" data-cred-id="${id}">${show ? 'Hide' : 'Show'}</button>`
    : ''
  return `<div class="sec-cred-row">
    <span class="sec-cred-key">${esc(key)}</span>
    <span class="sec-cred-val">${display}</span>
    ${toggle}
  </div>`
}

// ── Module-level cache ───────────────────────────────────────────────────────

const _secretsCache: {
  providers: DNSProviderConfig[]
  backup: BackupConfig | null
  tokens: { name: string; preview: string }[]
  fetchedAt: number
} = { providers: [], backup: null, tokens: [], fetchedAt: 0 }

// ── Component ───────────────────────────────────────────────────────────────

class PageSecuritySecrets extends HTMLElement {
  private _built = false
  private _timer: number | null = null
  private _lastUpdated: Date | null = null
  private _loading = false
  private _error: string | null = null

  private _tab: SecretsTab = 'providers'
  private _providers: DNSProviderConfig[] = []
  private _backup: BackupConfig | null = null
  private _tokens: { name: string; preview: string }[] = []

  // Form state
  private _showForm = false
  private _editingProvider: DNSProviderConfig | null = null
  private _editingSection: string | null = null
  private _revealedCreds: Set<string> = new Set()

  connectedCallback() {
    this.style.display = 'block'
    this._buildShell()
    // Show cached data immediately on remount
    if (_secretsCache.fetchedAt > 0) {
      this._providers = _secretsCache.providers
      this._backup    = _secretsCache.backup
      this._tokens    = _secretsCache.tokens
      this._loading   = false
      this._pushData()
    }
    this.load()
    this._timer = window.setInterval(() => this.load(), POLL)
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
          <h2>Secrets</h2>
          <div class="spacer"></div>
          <span data-bind="timestamp" class="infra-timestamp"></span>
          <span data-bind="freshness"></span>
          <button id="secRefresh" class="infra-btn">&#8635; Refresh</button>
        </header>
        <p style="font:var(--md-typescale-body-medium);color:var(--secondary-text-color);margin:0 0 16px">
          Manage platform credentials: DNS providers, object storage, backup keys, and tokens.
        </p>
        <div data-bind="body"></div>
      </section>
    `
    this.querySelector('#secRefresh')?.addEventListener('click', () => this.load())
  }

  private _set(bind: string, html: string) {
    const el = this.querySelector(`[data-bind="${bind}"]`) as HTMLElement | null
    if (el) el.innerHTML = html
  }

  // ─── Data ─────────────────────────────────────────────────────────────────

  private async load() {
    const [provR, bkR, tokR] = await Promise.allSettled([
      fetchProviders(),
      this.loadBackupConfig(),
      this.loadTokens(),
    ])

    if (provR.status === 'fulfilled') this._providers = provR.value
    // else keep existing this._providers (show cached data)
    if (bkR.status  === 'fulfilled') this._backup    = bkR.value
    // else keep existing this._backup
    if (tokR.status === 'fulfilled') this._tokens    = tokR.value
    // else keep existing this._tokens
    this._error = null

    _secretsCache.providers  = this._providers
    _secretsCache.backup     = this._backup
    _secretsCache.tokens     = this._tokens
    _secretsCache.fetchedAt  = Date.now()

    this._lastUpdated = new Date()
    this._loading = false
    this._pushData()
  }

  private async loadBackupConfig(reveal = false): Promise<BackupConfig | null> {
    const base = requireBaseUrl()
    const token = sessionStorage.getItem('__globular_token__') ?? ''
    // Try by friendly name first, then fall back to full gRPC name.
    // The ?id= parameter accepts both service UUID and service name.
    const revealParam = reveal ? '&reveal=true' : ''
    for (const name of ['backup_manager', 'backup_manager.BackupManagerService']) {
      const res = await fetch(`${base}/api/get-config?id=${encodeURIComponent(name)}${revealParam}`, {
        headers: { token },
      })
      if (!res.ok) continue
      const data = await res.json()
      const cfg = (data?.config || data) as BackupConfig
      // Ensure we got the actual backup config (has MinioEndpoint field)
      if (cfg && (cfg.MinioEndpoint || cfg.ResticRepo || cfg.Destinations)) return cfg
    }
    return null
  }

  private async loadTokens(): Promise<{ name: string; preview: string }[]> {
    try {
      const base = requireBaseUrl()
      const res = await fetch(`${base}/api/tokens`)
      if (!res.ok) return []
      return res.json()
    } catch {
      return []
    }
  }

  // ─── Push data into slots ─────────────────────────────────────────────────

  private _pushData() {
    if (this._lastUpdated) {
      this._set('timestamp', `Last updated: ${fmtTime(this._lastUpdated)}`)
    }
    this._set('freshness', freshnessBadge(this._lastUpdated?.getTime() ?? null, POLL))

    const destCount = this._backup?.Destinations?.length ?? 0

    const tabsHtml = `
      <div class="sec-tabs">
        <button class="sec-tab ${this._tab === 'providers' ? 'sec-tab--active' : ''}" data-tab="providers">
          DNS Providers <span style="opacity:.6;font-size:.78rem">(${this._providers.length})</span>
        </button>
        <button class="sec-tab ${this._tab === 'storage' ? 'sec-tab--active' : ''}" data-tab="storage">
          Object Storage
        </button>
        <button class="sec-tab ${this._tab === 'backup' ? 'sec-tab--active' : ''}" data-tab="backup">
          Backup &amp; DB <span style="opacity:.6;font-size:.78rem">(${destCount} dest)</span>
        </button>
        <button class="sec-tab ${this._tab === 'tokens' ? 'sec-tab--active' : ''}" data-tab="tokens">
          Tokens <span style="opacity:.6;font-size:.78rem">(${this._tokens.length})</span>
        </button>
      </div>
      <div id="tabContent"></div>
    `
    this._set('body', tabsHtml)

    const body = this.querySelector('[data-bind="body"]') as HTMLElement
    if (!body) return

    body.querySelectorAll('.sec-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        this._tab = (btn as HTMLElement).dataset.tab as SecretsTab
        this._showForm = false
        this._editingProvider = null
        this._editingSection = null
        this._pushData()
      })
    })

    const content = body.querySelector('#tabContent') as HTMLElement
    switch (this._tab) {
      case 'providers': this.renderProviders(content); break
      case 'storage':   this.renderStorage(content); break
      case 'backup':    this.renderBackup(content); break
      case 'tokens':    this.renderTokens(content); break
    }
  }

  // ─── Providers tab (DNS) ──────────────────────────────────────────────────

  private renderProviders(el: HTMLElement) {
    const toolbar = `<div class="sec-toolbar"><button class="infra-btn" id="addProvider">+ Add Provider</button></div>`
    const formContainer = '<div id="providerForm"></div>'

    if (this._providers.length === 0 && !this._showForm) {
      el.innerHTML = `${toolbar}${formContainer}
        <div class="sec-empty">
          No DNS providers configured.<br>
          <span style="font-size:.82rem;opacity:.7">Add a provider to manage external DNS records (Cloudflare, GoDaddy, Route53, or local).</span>
        </div>`
      this.wireProviderToolbar(el)
      return
    }

    const cards = this._providers.map((p, i) => this.renderProviderCard(p, i)).join('')
    el.innerHTML = `${toolbar}${formContainer}${cards}`
    this.wireProviderToolbar(el)
    this.wireProviderCards(el)
    if (this._showForm) this.renderProviderForm(el.querySelector('#providerForm') as HTMLElement)
  }

  private renderProviderCard(p: DNSProviderConfig, idx: number): string {
    const creds = Object.entries(p.credentials || {})
    const credRows = creds.length > 0
      ? creds.map(([k, v]) => credRow(k, v, `cred-${idx}-${k}`, this._revealedCreds, isSecretKey(k))).join('')
      : '<div style="font-size:.82rem;color:var(--secondary-text-color);opacity:.7">No credentials</div>'

    return `
      <div class="sec-card">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
          <h3 style="margin:0">${esc(p.name || '(unnamed)')}</h3>
          ${badge(p.type.toUpperCase(), providerTypeColor(p.type))}
        </div>
        <div class="sec-detail"><span class="label">Zone</span><span class="mono">${esc(p.zone)}</span></div>
        <div class="sec-detail"><span class="label">Default TTL</span><span>${p.default_ttl || 600}s</span></div>
        <div style="margin-top:8px">
          <div style="font-size:.78rem;font-weight:600;color:var(--secondary-text-color);margin-bottom:4px">Credentials</div>
          ${credRows}
        </div>
        <div class="sec-actions">
          <button class="sec-btn-sm sec-btn-edit" data-edit-idx="${idx}">Edit</button>
          <button class="sec-btn-sm sec-btn-del" data-del-name="${esc(p.name || '')}">Delete</button>
        </div>
      </div>`
  }

  private wireProviderToolbar(el: HTMLElement) {
    el.querySelector('#addProvider')?.addEventListener('click', () => {
      this._editingProvider = null
      this._showForm = true
      this.renderProviderForm(el.querySelector('#providerForm') as HTMLElement)
    })
  }

  private wireProviderCards(el: HTMLElement) {
    el.querySelectorAll('.sec-reveal-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = (btn as HTMLElement).dataset.credId!
        if (this._revealedCreds.has(id)) this._revealedCreds.delete(id)
        else this._revealedCreds.add(id)
        this._pushData()
      })
    })
    el.querySelectorAll('[data-edit-idx]').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt((btn as HTMLElement).dataset.editIdx!, 10)
        this._editingProvider = { ...this._providers[idx] }
        this._showForm = true
        this._pushData()
      })
    })
    el.querySelectorAll('[data-del-name]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const name = (btn as HTMLElement).dataset.delName!
        const ok = await confirmDialog({
          title: 'Delete Provider',
          message: `Delete DNS provider "${name}"?\n\nDomains using this provider will fail to reconcile.`,
          okLabel: 'Delete', variant: 'danger', icon: 'fa fa-trash',
        })
        if (!ok) return
        try { await deleteProvider(name); await this.load() }
        catch (e: any) { this._error = e?.message ?? 'Delete failed'; this._pushData() }
      })
    })
  }

  private renderProviderForm(container: HTMLElement) {
    if (!container) return
    const p = this._editingProvider
    const isEdit = !!p?.name
    const types = ['cloudflare', 'godaddy', 'route53', 'local', 'manual']
    const typeOpts = types.map(t =>
      `<option value="${t}" ${(p?.type || 'cloudflare') === t ? 'selected' : ''}>${t.charAt(0).toUpperCase() + t.slice(1)}</option>`
    ).join('')

    container.innerHTML = `
      <div class="sec-form">
        <h4>${isEdit ? 'Edit Provider' : 'Add DNS Provider'}</h4>
        <div class="sec-form-grid">
          <label>Name <input id="pName" class="sec-input" value="${esc(p?.name ?? '')}" placeholder="my-cloudflare" ${isEdit ? 'disabled' : ''}></label>
          <label>Type <select id="pType" class="sec-select">${typeOpts}</select></label>
          <label>Zone <input id="pZone" class="sec-input" value="${esc(p?.zone ?? '')}" placeholder="example.com"></label>
          <label>Default TTL <input id="pTtl" class="sec-input" type="number" value="${p?.default_ttl ?? 600}" min="60"></label>
        </div>
        <div id="pCredsArea" style="margin-bottom:8px"></div>
        <div class="sec-form-actions">
          <button class="infra-btn" id="pSave">${isEdit ? 'Update' : 'Save'}</button>
          <button class="infra-btn" id="pCancel" style="background:var(--surface-variant)">Cancel</button>
        </div>
      </div>`

    const updateCreds = () => {
      const type = (container.querySelector('#pType') as HTMLSelectElement).value
      const area = container.querySelector('#pCredsArea') as HTMLElement
      const fields = credFieldsForType(type)
      if (fields.length === 0) { area.innerHTML = '<div style="font-size:.82rem;color:var(--secondary-text-color)">No credentials required.</div>'; return }
      area.innerHTML = `<div class="sec-form-grid">${fields.map(f => `
        <label>${esc(f.label)}${f.required ? ' <span style="color:var(--error-color)">*</span>' : ''}
          <input id="pc_${f.key}" class="sec-input" type="${f.secret ? 'password' : 'text'}"
            value="${esc(p?.credentials?.[f.key] ?? '')}" placeholder="${esc(f.placeholder)}">
        </label>`).join('')}</div>`
    }
    updateCreds()
    container.querySelector('#pType')?.addEventListener('change', updateCreds)
    container.querySelector('#pCancel')?.addEventListener('click', () => { this._showForm = false; this._editingProvider = null; this._pushData() })
    container.querySelector('#pSave')?.addEventListener('click', async () => {
      const name = (container.querySelector('#pName') as HTMLInputElement).value.trim()
      const type = (container.querySelector('#pType') as HTMLSelectElement).value
      const zone = (container.querySelector('#pZone') as HTMLInputElement).value.trim()
      const ttl  = parseInt((container.querySelector('#pTtl') as HTMLInputElement).value, 10) || 600
      if (!name || !zone) { this._error = 'Name and zone are required'; this._pushData(); return }
      const fields = credFieldsForType(type)
      const credentials: Record<string, string> = {}
      for (const f of fields) {
        const el = container.querySelector(`#pc_${f.key}`) as HTMLInputElement
        if (el?.value) credentials[f.key] = el.value
        else if (f.required) { this._error = `${f.label} is required`; this._pushData(); return }
      }
      try { await saveProvider({ name, type, zone, credentials, default_ttl: ttl }); this._showForm = false; this._editingProvider = null; this._error = null; await this.load() }
      catch (e: any) { this._error = e?.message ?? 'Save failed'; this._pushData() }
    })
  }

  // ─── Object Storage tab (MinIO) ───────────────────────────────────────────

  private renderStorage(el: HTMLElement) {
    const b = this._backup
    if (!b) {
      el.innerHTML = '<div class="sec-empty">Backup manager config not available.<br><span style="font-size:.82rem;opacity:.7">The backup_manager service may not be running.</span></div>'
      return
    }

    const formContainer = '<div id="storageForm"></div>'

    el.innerHTML = `${formContainer}
      <div class="sec-card">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
          <h3 style="margin:0">MinIO Object Storage</h3>
          ${badge('MINIO', '#c72e49')}
          ${b.MinioSecure ? badge('TLS', '#4caf50') : badge('PLAIN', 'var(--warning-color)')}
        </div>
        ${credRow('Endpoint', b.MinioEndpoint, 'minio-ep', this._revealedCreds, false)}
        ${credRow('Access Key', b.MinioAccessKey, 'minio-ak', this._revealedCreds, false)}
        ${credRow('Secret Key', b.MinioSecretKey, 'minio-sk', this._revealedCreds, true)}
        <div class="sec-actions">
          <button class="sec-btn-sm sec-btn-edit" id="editMinio">Edit</button>
        </div>
      </div>`

    // Wire reveal buttons
    el.querySelectorAll('.sec-reveal-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = (btn as HTMLElement).dataset.credId!
        if (this._revealedCreds.has(id)) this._revealedCreds.delete(id)
        else this._revealedCreds.add(id)
        this._pushData()
      })
    })

    el.querySelector('#editMinio')?.addEventListener('click', async () => {
      this._backup = await this.loadBackupConfig(true) ?? this._backup
      this._editingSection = 'minio'
      this._pushData()
    })

    if (this._editingSection === 'minio') {
      this.renderMinioForm(el.querySelector('#storageForm') as HTMLElement)
    }
  }

  private renderMinioForm(container: HTMLElement) {
    if (!container) return
    const b = this._backup!
    container.innerHTML = `
      <div class="sec-form">
        <h4>Edit MinIO Credentials</h4>
        <div class="sec-form-grid">
          <label>Endpoint <input id="mEp" class="sec-input" value="${esc(b.MinioEndpoint)}"></label>
          <label>Access Key <input id="mAk" class="sec-input" value="${esc(b.MinioAccessKey)}"></label>
          <label>Secret Key <input id="mSk" class="sec-input" type="password" value="${esc(b.MinioSecretKey)}"></label>
          <label>TLS <select id="mTls" class="sec-select">
            <option value="true" ${b.MinioSecure ? 'selected' : ''}>Enabled</option>
            <option value="false" ${!b.MinioSecure ? 'selected' : ''}>Disabled</option>
          </select></label>
        </div>
        <div class="sec-form-actions">
          <button class="infra-btn" id="mSave">Save</button>
          <button class="infra-btn" id="mCancel" style="background:var(--surface-variant)">Cancel</button>
        </div>
      </div>`
    container.querySelector('#mCancel')?.addEventListener('click', () => { this._editingSection = null; this._pushData() })
    container.querySelector('#mSave')?.addEventListener('click', async () => {
      try {
        await saveServiceConfig({
          Id: b.Id,
          MinioEndpoint: (container.querySelector('#mEp') as HTMLInputElement).value.trim(),
          MinioAccessKey: (container.querySelector('#mAk') as HTMLInputElement).value.trim(),
          MinioSecretKey: (container.querySelector('#mSk') as HTMLInputElement).value.trim(),
          MinioSecure: (container.querySelector('#mTls') as HTMLSelectElement).value === 'true',
        } as any)
        this._editingSection = null
        await this.load()
      } catch (e: any) { this._error = e?.message ?? 'Save failed'; this._pushData() }
    })
  }

  // ─── Backup & DB tab ──────────────────────────────────────────────────────

  private renderBackup(el: HTMLElement) {
    const b = this._backup
    if (!b) {
      el.innerHTML = '<div class="sec-empty">Backup manager config not available.</div>'
      return
    }

    const formContainer = '<div id="backupForm"></div>'

    // Restic section
    const resticHtml = `
      <div class="sec-section">
        <div class="sec-section-title">Restic Backup</div>
        <div class="sec-card">
          ${credRow('Repository', b.ResticRepo, 'restic-repo', this._revealedCreds, false)}
          ${credRow('Password', b.ResticPassword, 'restic-pw', this._revealedCreds, true)}
          ${credRow('Paths', b.ResticPaths, 'restic-paths', this._revealedCreds, false)}
          <div class="sec-actions">
            <button class="sec-btn-sm sec-btn-edit" id="editRestic">Edit</button>
          </div>
        </div>
      </div>`

    // ScyllaDB section
    const scyllaHtml = `
      <div class="sec-section">
        <div class="sec-section-title">ScyllaDB Backup</div>
        <div class="sec-card">
          ${credRow('Cluster', b.ScyllaCluster, 'scylla-cl', this._revealedCreds, false)}
          ${credRow('S3 Location', b.ScyllaLocation, 'scylla-loc', this._revealedCreds, false)}
          ${credRow('Manager API', b.ScyllaManagerAPI, 'scylla-api', this._revealedCreds, false)}
          <div class="sec-actions">
            <button class="sec-btn-sm sec-btn-edit" id="editScylla">Edit</button>
          </div>
        </div>
      </div>`

    // Destinations section
    const destCards = (b.Destinations || []).map((d, i) => {
      const opts = Object.entries(d.Options || {})
        .map(([k, v]) => credRow(k, v, `dest-${i}-${k}`, this._revealedCreds, isSecretKey(k)))
        .join('')
      const badges = [
        badge(d.Type.toUpperCase(), d.Type === 'minio' ? '#c72e49' : d.Type === 'local' ? 'var(--primary-color)' : '#ff9900'),
        d.Primary ? badge('PRIMARY', '#4caf50') : '',
        d.AuthoritativeForRecovery ? badge('RECOVERY', '#ff9800') : '',
      ].filter(Boolean).join(' ')

      return `<div class="sec-dest-card">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
          <strong>${esc(d.Name)}</strong> ${badges}
        </div>
        ${credRow('Path', d.Path, `dest-${i}-path`, this._revealedCreds, false)}
        ${opts || '<div style="font-size:.82rem;opacity:.6">No credentials</div>'}
      </div>`
    }).join('')

    const destsHtml = `
      <div class="sec-section">
        <div class="sec-section-title">Backup Destinations</div>
        ${destCards || '<div class="sec-empty" style="padding:16px">No destinations configured.</div>'}
      </div>`

    el.innerHTML = `${formContainer}${resticHtml}${scyllaHtml}${destsHtml}`

    // Wire reveal buttons
    el.querySelectorAll('.sec-reveal-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = (btn as HTMLElement).dataset.credId!
        if (this._revealedCreds.has(id)) this._revealedCreds.delete(id)
        else this._revealedCreds.add(id)
        this._pushData()
      })
    })

    el.querySelector('#editRestic')?.addEventListener('click', async () => {
      this._backup = await this.loadBackupConfig(true) ?? this._backup
      this._editingSection = 'restic'
      this._pushData()
    })
    el.querySelector('#editScylla')?.addEventListener('click', async () => {
      this._backup = await this.loadBackupConfig(true) ?? this._backup
      this._editingSection = 'scylla'
      this._pushData()
    })

    if (this._editingSection === 'restic') this.renderResticForm(el.querySelector('#backupForm') as HTMLElement)
    if (this._editingSection === 'scylla') this.renderScyllaForm(el.querySelector('#backupForm') as HTMLElement)
  }

  private renderResticForm(container: HTMLElement) {
    if (!container) return
    const b = this._backup!
    container.innerHTML = `
      <div class="sec-form">
        <h4>Edit Restic Credentials</h4>
        <div class="sec-form-grid">
          <label>Repository <input id="rRepo" class="sec-input" value="${esc(b.ResticRepo)}"></label>
          <label>Password <input id="rPw" class="sec-input" type="password" value="${esc(b.ResticPassword)}"></label>
          <label>Paths <input id="rPaths" class="sec-input" value="${esc(b.ResticPaths)}"></label>
        </div>
        <div class="sec-form-actions">
          <button class="infra-btn" id="rSave">Save</button>
          <button class="infra-btn" id="rCancel" style="background:var(--surface-variant)">Cancel</button>
        </div>
      </div>`
    container.querySelector('#rCancel')?.addEventListener('click', () => { this._editingSection = null; this._pushData() })
    container.querySelector('#rSave')?.addEventListener('click', async () => {
      try {
        await saveServiceConfig({
          Id: b.Id,
          ResticRepo: (container.querySelector('#rRepo') as HTMLInputElement).value.trim(),
          ResticPassword: (container.querySelector('#rPw') as HTMLInputElement).value.trim(),
          ResticPaths: (container.querySelector('#rPaths') as HTMLInputElement).value.trim(),
        } as any)
        this._editingSection = null; await this.load()
      } catch (e: any) { this._error = e?.message ?? 'Save failed'; this._pushData() }
    })
  }

  private renderScyllaForm(container: HTMLElement) {
    if (!container) return
    const b = this._backup!
    container.innerHTML = `
      <div class="sec-form">
        <h4>Edit ScyllaDB Backup Config</h4>
        <div class="sec-form-grid">
          <label>Cluster <input id="sCl" class="sec-input" value="${esc(b.ScyllaCluster)}"></label>
          <label>S3 Location <input id="sLoc" class="sec-input" value="${esc(b.ScyllaLocation)}" placeholder="s3:bucket-name"></label>
          <label>Manager API <input id="sApi" class="sec-input" value="${esc(b.ScyllaManagerAPI)}"></label>
        </div>
        <div class="sec-form-actions">
          <button class="infra-btn" id="sSave">Save</button>
          <button class="infra-btn" id="sCancel" style="background:var(--surface-variant)">Cancel</button>
        </div>
      </div>`
    container.querySelector('#sCancel')?.addEventListener('click', () => { this._editingSection = null; this._pushData() })
    container.querySelector('#sSave')?.addEventListener('click', async () => {
      try {
        await saveServiceConfig({
          Id: b.Id,
          ScyllaCluster: (container.querySelector('#sCl') as HTMLInputElement).value.trim(),
          ScyllaLocation: (container.querySelector('#sLoc') as HTMLInputElement).value.trim(),
          ScyllaManagerAPI: (container.querySelector('#sApi') as HTMLInputElement).value.trim(),
        } as any)
        this._editingSection = null; await this.load()
      } catch (e: any) { this._error = e?.message ?? 'Save failed'; this._pushData() }
    })
  }

  // ─── Tokens tab ───────────────────────────────────────────────────────────

  private renderTokens(el: HTMLElement) {
    if (this._tokens.length === 0) {
      el.innerHTML = `<div class="sec-empty">
        No tokens available via API.<br>
        <span style="font-size:.82rem;opacity:.7">SA tokens are generated during cluster bootstrap and stored in <code>/var/lib/globular/tokens/</code>.</span>
      </div>`
      return
    }

    const cards = this._tokens.map(t => `
      <div class="sec-token-card">
        <span class="sec-token-name">${esc(t.name)}</span>
        <span class="sec-token-val" title="${esc(t.preview)}">${esc(t.preview)}</span>
        ${badge('SA', 'var(--primary-color)')}
      </div>
    `).join('')

    el.innerHTML = `
      <div style="font-size:.82rem;color:var(--secondary-text-color);margin-bottom:12px">
        Platform tokens (read-only). Generated during bootstrap for service authentication.
      </div>${cards}`
  }
}

customElements.define('page-security-secrets', PageSecuritySecrets)
