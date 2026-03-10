import {
  fetchStructuredGatewayCorsPolicy,
  saveStructuredGatewayCorsPolicy,
  fetchStructuredServicesCorsPolicy,
  saveStructuredServiceCorsPolicy,
  fetchCorsDiagnostics,
} from '@globular/backend'
import type { CorsPolicy, ServiceCorsPolicySummary, CorsDiagResult } from '@globular/backend'

const GATEWAY_ID = '__gateway__'

const DEFAULT_METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
const DEFAULT_HEADERS = [
  'Accept', 'Content-Type', 'Content-Length', 'Accept-Encoding',
  'X-CSRF-Token', 'Authorization', 'application', 'token',
  'video-path', 'index-path', 'routing', 'x-grpc-web', 'grpc-timeout', 'x-user-agent',
]
const DEFAULT_EXPOSED = ['grpc-status', 'grpc-message', 'grpc-status-details-bin']

class PageSecurityCors extends HTMLElement {
  private gwPolicy: CorsPolicy | null = null
  private services: ServiceCorsPolicySummary[] = []
  private dirty = new Set<string>()
  private statusEl!: HTMLElement
  private saveAllBtn!: HTMLButtonElement
  private gwSection!: HTMLElement
  private svcSection!: HTMLElement
  private expandedSvc: string | null = null

  connectedCallback() {
    this.style.display = 'block'
    this.render()
    this.load()
  }

  /* ── Render shell ─────────────────────────────────────────────────── */

  private render() {
    this.innerHTML = `
      <style>
        .cors-page { max-width: 1200px; margin: 0 auto; }
        .cors-page h2 { margin: 0; }
        .cors-page .header { display: flex; align-items: center; gap: 12px; margin-bottom: 4px; }
        .cors-page .spacer { flex: 1; }
        .cors-page .subtitle { margin: 0 0 16px; opacity: .65; font-size: .88rem; line-height: 1.5; }
        .cors-page .panel {
          border-radius: 10px; padding: 20px 24px; margin-bottom: 16px;
          background: var(--surface-color); border: 1px solid var(--border-subtle-color, rgba(0,0,0,.12));
        }
        .cors-page .panel-title {
          font-size: 1rem; font-weight: 600; margin: 0 0 14px; display: flex; align-items: center; gap: 8px;
        }
        .cors-page .field { margin-bottom: 12px; }
        .cors-page .field-label {
          font-size: .82rem; font-weight: 500; margin-bottom: 4px; opacity: .7;
        }
        .cors-page .field-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
        .cors-page input[type="text"], .cors-page input[type="number"] {
          padding: 6px 10px; border-radius: 6px; font-size: .88rem;
          border: 1px solid var(--border-subtle-color, rgba(0,0,0,.18));
          background: var(--surface-color); color: var(--on-surface-color);
          outline: none; box-sizing: border-box;
        }
        .cors-page input[type="text"] { width: 100%; min-width: 200px; }
        .cors-page input[type="number"] { width: 90px; }
        .cors-page select {
          padding: 6px 10px; border-radius: 6px; font-size: .88rem;
          border: 1px solid var(--border-subtle-color, rgba(0,0,0,.18));
          background: var(--surface-color); color: var(--on-surface-color); outline: none;
        }
        .cors-page .cb-label {
          display: inline-flex; align-items: center; gap: 6px; cursor: pointer; font-size: .88rem;
        }
        .cors-page .chip-row { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 4px; }
        .cors-page .chip {
          display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: .78rem;
          background: color-mix(in srgb, var(--primary-color, #1976d2) 10%, transparent);
          color: var(--primary-color, #1976d2);
        }
        .cors-page .warn {
          padding: 8px 12px; border-radius: 6px; font-size: .82rem; margin-top: 8px;
          background: color-mix(in srgb, var(--warning-color, #f57c00) 10%, transparent);
          color: var(--warning-color, #f57c00); line-height: 1.5;
        }
        .cors-page .eff-label {
          font-size: .75rem; font-weight: 600; text-transform: uppercase; letter-spacing: .05em;
          opacity: .5; margin-top: 16px; margin-bottom: 6px;
        }
        .cors-page .eff-grid {
          display: grid; grid-template-columns: 160px 1fr; gap: 2px 12px; font-size: .82rem;
          padding: 10px 14px; border-radius: 6px;
          background: color-mix(in srgb, var(--primary-color, #1976d2) 4%, transparent);
        }
        .cors-page .eff-key { opacity: .6; }
        .cors-page .svc-row {
          border-radius: 8px; margin-bottom: 8px; overflow: hidden;
          border: 1px solid var(--border-subtle-color, rgba(0,0,0,.10)); transition: background .15s;
        }
        .cors-page .svc-header {
          display: flex; align-items: center; gap: 12px; padding: 10px 16px; cursor: pointer;
          user-select: none;
        }
        .cors-page .svc-header:hover { background: color-mix(in srgb, var(--primary-color, #1976d2) 4%, transparent); }
        .cors-page .svc-name { font-weight: 500; flex: 1; }
        .cors-page .svc-id { font-size: .75rem; opacity: .45; }
        .cors-page .svc-mode-badge {
          font-size: .72rem; padding: 2px 8px; border-radius: 10px; font-weight: 600;
          text-transform: uppercase; letter-spacing: .04em;
        }
        .cors-page .mode-inherit { background: color-mix(in srgb, #42a5f5 18%, var(--surface-color, #fff)); color: #42a5f5; }
        .cors-page .mode-override { background: color-mix(in srgb, var(--warning-color, #f57c00) 12%, transparent); color: var(--warning-color, #f57c00); }
        .cors-page .mode-disabled { background: color-mix(in srgb, var(--error-color, #c62828) 12%, transparent); color: var(--error-color, #c62828); }
        .cors-page .svc-detail { padding: 0 16px 16px; display: none; }
        .cors-page .svc-detail.open { display: block; }
        .cors-page .svc-actions { display: flex; gap: 8px; margin-top: 12px; flex-wrap: wrap; }
        .cors-page .btn-sm {
          font-size: .8rem; padding: 5px 14px; border-radius: 6px; cursor: pointer;
          border: 1px solid var(--border-subtle-color, rgba(0,0,0,.18));
          background: var(--surface-color); color: var(--on-surface-color);
        }
        .cors-page .btn-sm:hover { background: color-mix(in srgb, var(--primary-color, #1976d2) 8%, transparent); }
        .cors-page .btn-sm:disabled { opacity: .4; cursor: default; }
        .cors-page .btn-primary { background: var(--primary-color, #1976d2); color: #fff; border-color: transparent; }
        .cors-page .btn-primary:hover { opacity: .9; }
        .cors-page .btn-primary:disabled { opacity: .4; }
        .cors-page .notes-box {
          margin-top: 16px; padding: 12px 16px; border-radius: 8px;
          background: var(--surface-color); border: 1px solid var(--border-subtle-color, rgba(0,0,0,.12));
          font-size: .85rem; line-height: 1.6; opacity: .85;
        }
        .cors-page .diag-panel { margin-top: 16px; }
        .cors-page .diag-form { display: flex; gap: 10px; align-items: flex-end; flex-wrap: wrap; margin-bottom: 14px; }
        .cors-page .diag-form .field { margin: 0; flex: 1; min-width: 180px; }
        .cors-page .diag-result-box { display: none; }
        .cors-page .diag-result-box.visible { display: block; }
        .cors-page .diag-badge {
          display: inline-block; padding: 3px 10px; border-radius: 10px; font-size: .78rem;
          font-weight: 600; text-transform: uppercase; letter-spacing: .04em;
        }
        .cors-page .diag-allowed { background: color-mix(in srgb, var(--success-color, #2e7d32) 12%, transparent); color: var(--success-color, #2e7d32); }
        .cors-page .diag-blocked { background: color-mix(in srgb, var(--error-color, #c62828) 12%, transparent); color: var(--error-color, #c62828); }
        .cors-page .diag-layer {
          display: inline-block; padding: 3px 10px; border-radius: 10px; font-size: .78rem;
          font-weight: 600; text-transform: uppercase; letter-spacing: .04em;
          background: color-mix(in srgb, var(--primary-color, #1976d2) 12%, transparent);
          color: var(--primary-color, #1976d2);
        }
        .cors-page .diag-curl {
          background: var(--surface-variant-color, #f5f5f5); padding: 10px 14px; border-radius: 6px;
          font-family: monospace; font-size: .82rem; white-space: pre-wrap; word-break: break-all;
          margin-top: 8px; border: 1px solid var(--border-subtle-color, rgba(0,0,0,.10));
        }
      </style>
      <section class="cors-page page">
        <div class="header">
          <h2>CORS Policy Management</h2>
          <div class="spacer"></div>
          <button id="saveAllBtn" class="submit" disabled style="min-width:120px">Apply All</button>
        </div>
        <p class="subtitle">
          Structured CORS policy for the gateway and each service. The gateway policy is authoritative for browser traffic.
          Services inherit the gateway policy by default; use <strong>override</strong> to customize.
        </p>

        <div id="gwSection"></div>
        <div id="svcSection"></div>

        <div id="diagSection" class="panel diag-panel">
          <div class="panel-title">Preflight Diagnostics</div>
          <div class="diag-form">
            <div class="field">
              <div class="field-label">Origin</div>
              <input type="text" id="diagOrigin" placeholder="https://app.example.com">
            </div>
            <div class="field" style="max-width:220px">
              <div class="field-label">Service (optional)</div>
              <select id="diagService"><option value="">(gateway only)</option></select>
            </div>
            <div class="field" style="max-width:120px">
              <div class="field-label">Method</div>
              <select id="diagMethod">
                <option value="POST" selected>POST</option>
                <option value="GET">GET</option>
                <option value="PUT">PUT</option>
                <option value="DELETE">DELETE</option>
                <option value="OPTIONS">OPTIONS</option>
                <option value="PATCH">PATCH</option>
              </select>
            </div>
            <button class="btn-sm btn-primary" id="diagRunBtn" style="height:34px">Check</button>
          </div>
          <div id="diagResult" class="diag-result-box"></div>
        </div>

        <div class="notes-box">
          <strong>Notes:</strong><br>
          &bull; <strong>Envoy</strong>: Route-level CORS is derived from the xDS config — changes here update the gateway and xDS picks them up on next reconcile.<br>
          &bull; <strong>gRPC-web</strong>: Ensure <code>x-grpc-web</code>, <code>grpc-timeout</code> are in allowed headers and <code>grpc-status</code>, <code>grpc-message</code> in exposed headers.<br>
          &bull; <strong>MinIO</strong>: Object store CORS is managed separately via the MinIO Admin API.
        </div>

        <div id="corsStatus" style="margin-top:10px;min-height:24px;font-size:.85rem;"></div>
      </section>
    `
    this.gwSection = this.querySelector('#gwSection') as HTMLElement
    this.svcSection = this.querySelector('#svcSection') as HTMLElement
    this.statusEl = this.querySelector('#corsStatus') as HTMLElement
    this.saveAllBtn = this.querySelector('#saveAllBtn') as HTMLButtonElement
    this.saveAllBtn.addEventListener('click', () => this.saveAll())

    // Diagnostics wiring
    this.querySelector('#diagRunBtn')!.addEventListener('click', () => this.runDiagnostics())
  }

  /* ── Data loading ─────────────────────────────────────────────────── */

  private async load() {
    this.dirty.clear()
    this.syncSaveAllBtn()
    try {
      const [gw, svcs] = await Promise.allSettled([
        fetchStructuredGatewayCorsPolicy(),
        fetchStructuredServicesCorsPolicy(),
      ])
      this.gwPolicy = gw.status === 'fulfilled' ? gw.value : null
      this.services = svcs.status === 'fulfilled' ? svcs.value : []

      this.renderGateway()
      this.renderServices()
      this.populateDiagServiceDropdown()

      const errs = [
        gw.status === 'rejected' ? `Gateway: ${(gw as any).reason?.message}` : null,
        svcs.status === 'rejected' ? `Services: ${(svcs as any).reason?.message}` : null,
      ].filter(Boolean)
      if (errs.length) this.setStatus(errs.join('; '), true)
    } catch (err: any) {
      this.gwSection.innerHTML = `<div class="panel" style="color:var(--error-color)">Failed to load: ${esc(err?.message ?? err)}</div>`
    }
  }

  /* ── Gateway panel ────────────────────────────────────────────────── */

  private renderGateway() {
    const p = this.gwPolicy
    if (!p) {
      this.gwSection.innerHTML = '<div class="panel" style="opacity:.5">Gateway config unavailable</div>'
      return
    }
    const el = document.createElement('div')
    el.className = 'panel'
    el.innerHTML = `
      <div class="panel-title">
        <span style="font-size:1.1em;">&#x1f310;</span> Gateway CORS Policy
        <div style="flex:1"></div>
        <button class="btn-sm btn-primary gw-save" disabled>Save Gateway</button>
      </div>
      ${this.renderPolicyFields('gw', p, false)}
      <div class="eff-label">Effective Policy (gateway is authoritative)</div>
      ${this.renderEffectiveGrid(p)}
      <div class="gw-warnings"></div>
    `
    this.gwSection.innerHTML = ''
    this.gwSection.appendChild(el)
    this.wireFields(el, GATEWAY_ID, 'gw')
    this.updateWarnings(el.querySelector('.gw-warnings')!, p)
  }

  /* ── Services list ────────────────────────────────────────────────── */

  private renderServices() {
    this.svcSection.innerHTML = ''
    if (this.services.length === 0) {
      this.svcSection.innerHTML = '<div class="panel" style="opacity:.5;text-align:center">No services found.</div>'
      return
    }
    const title = document.createElement('div')
    title.style.cssText = 'font-size:.78rem;font-weight:600;text-transform:uppercase;letter-spacing:.06em;opacity:.45;margin:18px 0 8px 4px;'
    title.textContent = `Services (${this.services.length})`
    this.svcSection.appendChild(title)

    for (const svc of this.services) {
      this.svcSection.appendChild(this.buildServiceRow(svc))
    }
  }

  private buildServiceRow(svc: ServiceCorsPolicySummary): HTMLElement {
    const row = document.createElement('div')
    row.className = 'svc-row'
    row.dataset.id = svc.id
    const modeClass = svc.service.mode === 'override' ? 'mode-override' : svc.service.mode === 'disabled' ? 'mode-disabled' : 'mode-inherit'

    row.innerHTML = `
      <div class="svc-header">
        <span class="svc-name">${esc(svc.name || svc.id)}</span>
        <span class="svc-id">${esc(svc.id)}</span>
        <span class="svc-mode-badge ${modeClass}">${esc(svc.service.mode || 'inherit')}</span>
        <span style="font-size:.9em;opacity:.4;">&#9660;</span>
      </div>
      <div class="svc-detail" data-detail="${esc(svc.id)}">
        <div class="field">
          <div class="field-label">Policy Mode</div>
          <select class="svc-mode-select" data-field="mode">
            <option value="inherit" ${svc.service.mode === 'inherit' || !svc.service.mode ? 'selected' : ''}>Inherit from Gateway</option>
            <option value="override" ${svc.service.mode === 'override' ? 'selected' : ''}>Override</option>
            <option value="disabled" ${svc.service.mode === 'disabled' ? 'selected' : ''}>Disabled</option>
          </select>
        </div>
        <div class="svc-override-fields" style="${svc.service.mode === 'override' ? '' : 'display:none'}">
          ${this.renderPolicyFields('svc-' + svc.id, svc.service, true)}
        </div>
        <div class="eff-label">Effective Policy</div>
        ${this.renderEffectiveGrid(svc.effective)}
        <div class="svc-warnings"></div>
        <div class="svc-actions">
          <button class="btn-sm btn-primary svc-save" disabled>Save</button>
          <button class="btn-sm svc-copy-gw" title="Copy gateway policy into this service as override">Copy Gateway Policy</button>
          <button class="btn-sm svc-reset" title="Reset to inherit from gateway">Reset to Inherit</button>
        </div>
      </div>
    `

    // Toggle expand
    const header = row.querySelector('.svc-header')!
    const detail = row.querySelector('.svc-detail')!
    header.addEventListener('click', () => {
      const isOpen = detail.classList.contains('open')
      // Close all others
      this.svcSection.querySelectorAll('.svc-detail.open').forEach(d => d.classList.remove('open'))
      if (!isOpen) detail.classList.add('open')
    })

    // Mode select
    const modeSelect = row.querySelector('.svc-mode-select') as HTMLSelectElement
    const overrideFields = row.querySelector('.svc-override-fields') as HTMLElement
    modeSelect.addEventListener('change', () => {
      overrideFields.style.display = modeSelect.value === 'override' ? '' : 'none'
      const badge = row.querySelector('.svc-mode-badge')!
      badge.textContent = modeSelect.value
      badge.className = 'svc-mode-badge ' + (modeSelect.value === 'override' ? 'mode-override' : modeSelect.value === 'disabled' ? 'mode-disabled' : 'mode-inherit')
      this.markDirty(svc.id, row)
    })

    this.wireFields(row, svc.id, 'svc-' + svc.id)

    // Copy gateway
    row.querySelector('.svc-copy-gw')!.addEventListener('click', () => {
      if (!this.gwPolicy) return
      modeSelect.value = 'override'
      modeSelect.dispatchEvent(new Event('change'))
      this.fillFields(row, 'svc-' + svc.id, this.gwPolicy)
      this.markDirty(svc.id, row)
    })

    // Reset to inherit
    row.querySelector('.svc-reset')!.addEventListener('click', () => {
      modeSelect.value = 'inherit'
      modeSelect.dispatchEvent(new Event('change'))
      this.markDirty(svc.id, row)
    })

    // Save
    row.querySelector('.svc-save')!.addEventListener('click', () => this.saveService(svc.id, row))

    return row
  }

  /* ── Shared policy fields renderer ────────────────────────────────── */

  private renderPolicyFields(prefix: string, p: CorsPolicy, isService: boolean): string {
    return `
      <div class="field">
        <div class="field-row">
          <label class="cb-label"><input type="checkbox" data-field="enabled" ${p.enabled ? 'checked' : ''}> Enabled</label>
          <label class="cb-label"><input type="checkbox" data-field="allow_all_origins" ${p.allow_all_origins ? 'checked' : ''}> Allow All Origins</label>
          <label class="cb-label"><input type="checkbox" data-field="allow_credentials" ${p.allow_credentials ? 'checked' : ''}> Allow Credentials</label>
          <label class="cb-label"><input type="checkbox" data-field="allow_private_network" ${p.allow_private_network ? 'checked' : ''}> Allow Private Network</label>
          <label class="cb-label"><input type="checkbox" data-field="grpc_web_enabled" ${p.grpc_web_enabled ? 'checked' : ''}> gRPC-Web</label>
        </div>
      </div>
      <div class="field">
        <div class="field-label">Allowed Origins <span style="opacity:.5;font-weight:400">(one per line or comma-separated)</span></div>
        <input type="text" data-field="allowed_origins" value="${esc((p.allowed_origins || []).join(', '))}"
          placeholder="https://app.example.com, https://admin.example.com"
          ${p.allow_all_origins ? 'disabled' : ''}>
      </div>
      <div class="field">
        <div class="field-label">Allowed Methods</div>
        <div class="field-row">
          ${['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH', 'HEAD'].map(m =>
            `<label class="cb-label"><input type="checkbox" data-method="${m}" ${(p.allowed_methods || []).includes(m) ? 'checked' : ''}> ${m}</label>`
          ).join('')}
        </div>
      </div>
      <div class="field">
        <div class="field-label">Allowed Headers <span style="opacity:.5;font-weight:400">(comma-separated)</span></div>
        <input type="text" data-field="allowed_headers" value="${esc((p.allowed_headers || []).join(', '))}">
      </div>
      <div class="field">
        <div class="field-label">Exposed Headers <span style="opacity:.5;font-weight:400">(comma-separated)</span></div>
        <input type="text" data-field="exposed_headers" value="${esc((p.exposed_headers || []).join(', '))}">
      </div>
      <div class="field">
        <div class="field-label">Max Age (seconds)</div>
        <input type="number" data-field="max_age_seconds" value="${p.max_age_seconds || 3600}" min="0">
      </div>
    `
  }

  /* ── Effective policy grid ────────────────────────────────────────── */

  private renderEffectiveGrid(p: CorsPolicy): string {
    return `<div class="eff-grid">
      <span class="eff-key">enabled</span><span>${p.enabled ? 'yes' : 'no'}</span>
      <span class="eff-key">mode</span><span>${esc(p.mode)}</span>
      <span class="eff-key">allow all origins</span><span>${p.allow_all_origins ? 'yes' : 'no'}</span>
      <span class="eff-key">origins</span><span>${(p.allowed_origins || []).join(', ') || '(none)'}</span>
      <span class="eff-key">credentials</span><span>${p.allow_credentials ? 'yes' : 'no'}</span>
      <span class="eff-key">methods</span><span>${(p.allowed_methods || []).join(', ') || '(none)'}</span>
      <span class="eff-key">allowed headers</span><span style="word-break:break-all;">${(p.allowed_headers || []).join(', ') || '(none)'}</span>
      <span class="eff-key">exposed headers</span><span>${(p.exposed_headers || []).join(', ') || '(none)'}</span>
      <span class="eff-key">max age</span><span>${p.max_age_seconds}s</span>
      <span class="eff-key">private network</span><span>${p.allow_private_network ? 'yes' : 'no'}</span>
      <span class="eff-key">gRPC-web</span><span>${p.grpc_web_enabled ? 'yes' : 'no'}</span>
    </div>`
  }

  /* ── Wire change listeners ────────────────────────────────────────── */

  private wireFields(container: HTMLElement, id: string, prefix: string) {
    // Checkboxes
    container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]').forEach(cb => {
      cb.addEventListener('change', () => {
        this.markDirty(id, container)
        // Toggle origins input when allow_all_origins changes
        if (cb.dataset.field === 'allow_all_origins') {
          const originsInput = container.querySelector('input[data-field="allowed_origins"]') as HTMLInputElement | null
          if (originsInput) originsInput.disabled = cb.checked
        }
      })
    })
    // Text/number inputs
    container.querySelectorAll<HTMLInputElement>('input[type="text"], input[type="number"]').forEach(inp => {
      inp.addEventListener('input', () => this.markDirty(id, container))
    })
    // Select
    container.querySelectorAll<HTMLSelectElement>('select').forEach(sel => {
      sel.addEventListener('change', () => this.markDirty(id, container))
    })
  }

  /* ── Read form values → CorsPolicy ────────────────────────────────── */

  private readPolicy(container: HTMLElement, isService: boolean): CorsPolicy {
    const cb = (field: string) => {
      const el = container.querySelector(`input[data-field="${field}"]`) as HTMLInputElement | null
      return el ? el.checked : false
    }
    const txt = (field: string) => {
      const el = container.querySelector(`input[data-field="${field}"]`) as HTMLInputElement | null
      return el ? el.value.trim() : ''
    }
    const num = (field: string) => {
      const el = container.querySelector(`input[data-field="${field}"]`) as HTMLInputElement | null
      return el ? parseInt(el.value, 10) || 0 : 0
    }

    // Methods from checkboxes
    const methods: string[] = []
    container.querySelectorAll<HTMLInputElement>('input[data-method]').forEach(m => {
      if (m.checked) methods.push(m.dataset.method!)
    })

    // Mode
    let mode = 'gateway'
    if (isService) {
      const sel = container.querySelector('.svc-mode-select') as HTMLSelectElement | null
      mode = sel ? sel.value : 'inherit'
    }

    const splitList = (s: string) => s.split(/[,\n]/).map(x => x.trim()).filter(Boolean)

    return {
      enabled: cb('enabled'),
      mode,
      allow_all_origins: cb('allow_all_origins'),
      allowed_origins: splitList(txt('allowed_origins')),
      allow_credentials: cb('allow_credentials'),
      allowed_methods: methods,
      allowed_headers: splitList(txt('allowed_headers')),
      exposed_headers: splitList(txt('exposed_headers')),
      max_age_seconds: num('max_age_seconds'),
      allow_private_network: cb('allow_private_network'),
      grpc_web_enabled: cb('grpc_web_enabled'),
    }
  }

  /* ── Fill form from a CorsPolicy ──────────────────────────────────── */

  private fillFields(container: HTMLElement, prefix: string, p: CorsPolicy) {
    const setCb = (field: string, val: boolean) => {
      const el = container.querySelector(`input[data-field="${field}"]`) as HTMLInputElement | null
      if (el) el.checked = val
    }
    const setTxt = (field: string, val: string) => {
      const el = container.querySelector(`input[data-field="${field}"]`) as HTMLInputElement | null
      if (el) { el.value = val; el.disabled = false }
    }
    const setNum = (field: string, val: number) => {
      const el = container.querySelector(`input[data-field="${field}"]`) as HTMLInputElement | null
      if (el) el.value = String(val)
    }

    setCb('enabled', p.enabled)
    setCb('allow_all_origins', p.allow_all_origins)
    setCb('allow_credentials', p.allow_credentials)
    setCb('allow_private_network', p.allow_private_network)
    setCb('grpc_web_enabled', p.grpc_web_enabled)
    setTxt('allowed_origins', (p.allowed_origins || []).join(', '))
    setTxt('allowed_headers', (p.allowed_headers || []).join(', '))
    setTxt('exposed_headers', (p.exposed_headers || []).join(', '))
    setNum('max_age_seconds', p.max_age_seconds)

    // Origins input disable
    const originsInput = container.querySelector('input[data-field="allowed_origins"]') as HTMLInputElement | null
    if (originsInput) originsInput.disabled = p.allow_all_origins

    // Methods
    container.querySelectorAll<HTMLInputElement>('input[data-method]').forEach(m => {
      m.checked = (p.allowed_methods || []).includes(m.dataset.method!)
    })
  }

  /* ── Validation warnings ──────────────────────────────────────────── */

  private updateWarnings(el: HTMLElement, p: CorsPolicy) {
    const warnings: string[] = []
    if (p.allow_all_origins && p.allow_credentials) {
      warnings.push('Allow All Origins + Allow Credentials is invalid per CORS spec — browsers will reject. Use specific origins instead.')
    }
    if (p.grpc_web_enabled) {
      for (const h of ['x-grpc-web', 'grpc-timeout']) {
        if (!(p.allowed_headers || []).includes(h)) warnings.push(`gRPC-Web enabled but "${h}" missing from allowed headers.`)
      }
      for (const h of ['grpc-status', 'grpc-message']) {
        if (!(p.exposed_headers || []).includes(h)) warnings.push(`gRPC-Web enabled but "${h}" missing from exposed headers.`)
      }
    }
    el.innerHTML = warnings.length ? `<div class="warn">${warnings.map(w => '&#9888; ' + esc(w)).join('<br>')}</div>` : ''
  }

  /* ── Dirty tracking ───────────────────────────────────────────────── */

  private markDirty(id: string, container: HTMLElement) {
    this.dirty.add(id)
    if (id === GATEWAY_ID) {
      container.style.borderColor = 'var(--primary-color, #1976d2)'
      const btn = container.querySelector('.gw-save') as HTMLButtonElement | null
      if (btn) btn.disabled = false
      // Live warnings
      const p = this.readPolicy(container, false)
      this.updateWarnings(container.querySelector('.gw-warnings')!, p)
    } else {
      container.style.borderColor = 'var(--primary-color, #1976d2)'
      const btn = container.querySelector('.svc-save') as HTMLButtonElement | null
      if (btn) btn.disabled = false
      // Live warnings
      const p = this.readPolicy(container, true)
      this.updateWarnings(container.querySelector('.svc-warnings')!, p)
    }
    this.syncSaveAllBtn()
  }

  private clearDirty(id: string, container: HTMLElement) {
    this.dirty.delete(id)
    container.style.borderColor = ''
    if (id === GATEWAY_ID) {
      const btn = container.querySelector('.gw-save') as HTMLButtonElement | null
      if (btn) btn.disabled = true
    } else {
      const btn = container.querySelector('.svc-save') as HTMLButtonElement | null
      if (btn) btn.disabled = true
    }
    this.syncSaveAllBtn()
  }

  private syncSaveAllBtn() {
    this.saveAllBtn.disabled = this.dirty.size === 0
  }

  /* ── Save logic ───────────────────────────────────────────────────── */

  private async saveGateway() {
    const panel = this.gwSection.querySelector('.panel') as HTMLElement
    if (!panel) return
    const btn = panel.querySelector('.gw-save') as HTMLButtonElement
    const policy = this.readPolicy(panel, false)
    btn.disabled = true
    btn.textContent = '...'
    try {
      const result = await saveStructuredGatewayCorsPolicy(policy)
      this.gwPolicy = policy
      this.clearDirty(GATEWAY_ID, panel)
      if (result.warnings?.length) {
        this.setStatus(`Gateway saved with warnings: ${result.warnings.join('; ')}`, true)
      } else {
        this.setStatus('Gateway CORS policy saved.', false)
      }
    } catch (err: any) {
      btn.disabled = false
      this.setStatus(`Error saving gateway: ${err?.message ?? err}`, true)
    } finally {
      btn.textContent = 'Save Gateway'
    }
  }

  private async saveService(id: string, row: HTMLElement) {
    const btn = row.querySelector('.svc-save') as HTMLButtonElement
    const policy = this.readPolicy(row, true)
    btn.disabled = true
    btn.textContent = '...'
    try {
      await saveStructuredServiceCorsPolicy(id, policy)
      this.clearDirty(id, row)
      this.setStatus(`Saved CORS policy for ${id}.`, false)
    } catch (err: any) {
      btn.disabled = false
      this.setStatus(`Error saving ${id}: ${err?.message ?? err}`, true)
    } finally {
      btn.textContent = 'Save'
    }
  }

  private async saveAll() {
    const ids = [...this.dirty]
    if (ids.length === 0) return
    this.saveAllBtn.disabled = true
    let errors = 0
    for (const id of ids) {
      try {
        if (id === GATEWAY_ID) {
          await this.saveGateway()
        } else {
          const row = this.svcSection.querySelector(`.svc-row[data-id="${CSS.escape(id)}"]`) as HTMLElement | null
          if (row) await this.saveService(id, row)
        }
      } catch { errors++ }
    }
    this.syncSaveAllBtn()
    if (errors === 0) {
      this.setStatus('All changes saved.', false)
    } else {
      this.setStatus(`${errors} item(s) failed.`, true)
    }
  }

  /* ── Diagnostics ──────────────────────────────────────────────────── */

  private populateDiagServiceDropdown() {
    const sel = this.querySelector('#diagService') as HTMLSelectElement
    if (!sel) return
    // Keep the first "(gateway only)" option
    while (sel.options.length > 1) sel.remove(1)
    for (const svc of this.services) {
      const opt = document.createElement('option')
      opt.value = svc.id
      opt.textContent = svc.name || svc.id
      sel.appendChild(opt)
    }
  }

  private async runDiagnostics() {
    const origin = (this.querySelector('#diagOrigin') as HTMLInputElement).value.trim()
    const serviceId = (this.querySelector('#diagService') as HTMLSelectElement).value
    const method = (this.querySelector('#diagMethod') as HTMLSelectElement).value
    const resultBox = this.querySelector('#diagResult') as HTMLElement
    const btn = this.querySelector('#diagRunBtn') as HTMLButtonElement

    btn.disabled = true
    btn.textContent = '...'
    try {
      const diag = await fetchCorsDiagnostics(origin, serviceId || undefined, method)
      resultBox.classList.add('visible')
      resultBox.innerHTML = this.renderDiagResult(diag)
    } catch (err: any) {
      resultBox.classList.add('visible')
      resultBox.innerHTML = `<div class="warn">${esc(err?.message ?? String(err))}</div>`
    } finally {
      btn.disabled = false
      btn.textContent = 'Check'
    }
  }

  private renderDiagResult(d: CorsDiagResult): string {
    const statusBadge = d.allowed
      ? '<span class="diag-badge diag-allowed">ALLOWED</span>'
      : '<span class="diag-badge diag-blocked">BLOCKED</span>'
    const layerBadge = `<span class="diag-layer">${esc(d.enforcement_layer)}</span>`

    const warnings = d.warnings.length
      ? `<div class="warn" style="margin-top:10px">${d.warnings.map(w => '&#9888; ' + esc(w)).join('<br>')}</div>`
      : ''

    return `
      <div style="display:flex;gap:12px;align-items:center;margin-bottom:10px;">
        <span style="font-size:.85rem;opacity:.6;">Origin:</span>
        <strong style="font-size:.88rem;">${esc(d.origin)}</strong>
        ${statusBadge}
        <span style="font-size:.82rem;opacity:.5;">Enforcement:</span>
        ${layerBadge}
        ${d.service_id ? `<span style="font-size:.82rem;opacity:.5;">Service: ${esc(d.service_id)}</span>` : ''}
      </div>
      <div class="eff-label">Effective Policy</div>
      ${this.renderEffectiveGrid(d.effective_policy)}
      ${warnings}
      <div class="eff-label" style="margin-top:14px;">Sample Preflight curl</div>
      <div class="diag-curl">${esc(d.curl_example)}</div>
    `
  }

  /* ── Status ───────────────────────────────────────────────────────── */

  private setStatus(msg: string, isError: boolean) {
    this.statusEl.textContent = msg
    this.statusEl.style.color = isError ? 'var(--error-color, #c62828)' : 'var(--primary-color, #1976d2)'
    if (!isError) {
      setTimeout(() => {
        if (this.statusEl.textContent === msg) this.statusEl.textContent = ''
      }, 4000)
    }
  }
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

customElements.define('page-security-cors', PageSecurityCors)
