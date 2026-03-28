// src/pages/repo_applications.ts
//
// Application deployment management — list, deploy, undeploy ApplicationReleases.

import {
  listApplicationReleases, deployApplication, undeployApplication,
  listArtifacts, searchArtifacts,
  type ApplicationRelease, type ApplicationReleaseSpec,
} from '@globular/sdk'
import { confirmDialog } from '../utils/confirm_dialog'

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function phaseBadge(phase: string): string {
  const colors: Record<string, string> = {
    'AVAILABLE': '#16a34a', 'PENDING': '#6b7280', 'RESOLVED': '#2563eb',
    'PLANNED': '#8b5cf6', 'APPLYING': '#f59e0b', 'DEGRADED': '#ea580c',
    'FAILED': '#dc2626', 'ROLLED_BACK': '#7f1d1d', 'REMOVING': '#6b7280',
  }
  const c = colors[phase] || '#6b7280'
  return `<span style="display:inline-block;font-size:.65rem;font-weight:700;padding:2px 8px;border-radius:4px;background:color-mix(in srgb, ${c} 15%, transparent);color:${c}">${esc(phase || 'PENDING')}</span>`
}

const KIND_APPLICATION = 2

class PageRepoApplications extends HTMLElement {
  private _timer: number | null = null
  private _releases: ApplicationRelease[] = []
  private _loading = true
  private _error = ''
  private _showDeploy = false
  private _appArtifacts: { publisher: string; name: string; versions: string[] }[] = []

  connectedCallback() {
    this.style.display = 'block'
    this.render()
    this.load()
    this._timer = window.setInterval(() => this.load(), 15_000)
  }

  disconnectedCallback() {
    if (this._timer) clearInterval(this._timer)
  }

  private async load() {
    try {
      this._releases = await listApplicationReleases()
      this._error = ''
    } catch (e: any) {
      this._error = e?.message || 'Failed to load applications'
    }
    this._loading = false
    this.render()
  }

  private async loadAppArtifacts() {
    try {
      const result = await searchArtifacts({ kind: KIND_APPLICATION, pageSize: 100 })
      const map = new Map<string, { publisher: string; name: string; versions: Set<string> }>()
      for (const a of result.artifacts) {
        const pub = a.ref?.publisherId || ''
        const name = a.ref?.name || ''
        const key = `${pub}/${name}`
        if (!map.has(key)) map.set(key, { publisher: pub, name, versions: new Set() })
        if (a.ref?.version) map.get(key)!.versions.add(a.ref.version)
      }
      // Fallback: also scan all artifacts for APPLICATION kind
      if (map.size === 0) {
        const all = await listArtifacts()
        for (const a of all) {
          if (a.ref?.kind !== KIND_APPLICATION) continue
          const pub = a.ref?.publisherId || ''
          const name = a.ref?.name || ''
          const key = `${pub}/${name}`
          if (!map.has(key)) map.set(key, { publisher: pub, name, versions: new Set() })
          if (a.ref?.version) map.get(key)!.versions.add(a.ref.version)
        }
      }
      this._appArtifacts = Array.from(map.values()).map(v => ({
        publisher: v.publisher, name: v.name,
        versions: Array.from(v.versions).sort().reverse(),
      }))
    } catch {
      this._appArtifacts = []
    }
  }

  private render() {
    const rels = this._releases

    this.innerHTML = `
      <style>
        .app-page { padding:16px; display:flex; flex-direction:column; gap:20px; }
        .app-page h2 { margin:0; font:var(--md-typescale-headline-small); }
        .app-sub { margin:2px 0 0; font:var(--md-typescale-body-medium); color:var(--secondary-text-color); }
        .app-toolbar { display:flex; align-items:center; gap:10px; }
        .deploy-btn { padding:6px 16px; border:none; border-radius:var(--md-shape-sm); background:var(--primary-color); color:var(--on-primary-color); font-size:.82rem; font-weight:600; cursor:pointer; }
        .deploy-btn:hover { opacity:.85; }
        .app-card { background:var(--md-surface-container); border:1px solid var(--border-subtle-color); border-radius:var(--md-shape-md); padding:14px 16px; margin-bottom:10px; }
        .app-card-header { display:flex; align-items:center; gap:10px; margin-bottom:8px; }
        .app-card-header h3 { margin:0; font-size:.92rem; font-weight:700; }
        .app-row { display:flex; gap:8px; font-size:.82rem; line-height:1.6; }
        .app-row .lbl { min-width:110px; color:var(--secondary-text-color); font-size:.78rem; font-weight:600; }
        .app-node { display:inline-flex; align-items:center; gap:4px; font-size:.78rem; padding:2px 8px; border-radius:4px; background:var(--md-surface-container-low); margin:2px; }
        .app-actions { display:flex; gap:6px; margin-top:8px; }
        .app-action-btn { background:none; border:none; cursor:pointer; font-size:.78rem; padding:3px 10px; border-radius:4px; }
        .app-action-btn--danger { color:var(--error-color); }
        .app-action-btn--danger:hover { background:color-mix(in srgb, var(--error-color) 10%, transparent); }
        .app-form { background:var(--md-surface-container-low); border:1px solid var(--border-subtle-color); border-radius:var(--md-shape-md); padding:16px; margin-bottom:16px; }
        .app-form h4 { margin:0 0 12px; font-size:.88rem; }
        .app-form-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(200px,1fr)); gap:10px; margin-bottom:12px; }
        .app-form-grid label { display:flex; flex-direction:column; gap:3px; font-size:.78rem; color:var(--secondary-text-color); }
        .app-form-grid input, .app-form-grid select { padding:5px 8px; border:1px solid var(--border-subtle-color); border-radius:4px; background:var(--surface-color); color:var(--on-surface-color); font-size:.82rem; }
        .empty-state { text-align:center; padding:48px 16px; color:var(--secondary-text-color); }
      </style>

      <div class="app-page">
        <div>
          <h2>Applications</h2>
          <p class="app-sub">Deploy and manage web applications across the cluster.</p>
        </div>

        ${this._loading ? '<div style="color:var(--secondary-text-color);font-size:.85rem;padding:16px">Loading applications...</div>' : ''}
        ${this._error ? `<div style="color:var(--error-color);padding:8px">${esc(this._error)}</div>` : ''}

        ${!this._loading ? `
        <div class="app-toolbar">
          <button class="deploy-btn" id="btnDeploy">+ Deploy Application</button>
          <button class="md-btn md-btn-outlined" id="btnRefresh">Refresh</button>
          <span style="font-size:.82rem;color:var(--secondary-text-color)">${rels.length} application${rels.length !== 1 ? 's' : ''}</span>
        </div>

        <div id="deployForm"></div>

        ${rels.length > 0 ? rels.map(r => this.renderCard(r)).join('') : `
        <div class="empty-state">
          No applications deployed.<br>
          <span style="font-size:.82rem;opacity:.7">Publish an APPLICATION artifact, then deploy it here.</span>
        </div>
        `}
        ` : ''}
      </div>
    `
    this.wireEvents()
  }

  private renderCard(r: ApplicationRelease): string {
    const spec = r.spec
    const status = r.status
    const name = `${spec.publisher_id}/${spec.app_name}`
    const phase = status?.phase || 'PENDING'
    const nodes = status?.nodes || []
    const nodeCount = nodes.length
    const readyCount = nodes.filter(n => n.phase === 'AVAILABLE' || n.phase === 'CONVERGED').length

    return `
      <div class="app-card">
        <div class="app-card-header">
          <h3>${esc(name)}</h3>
          ${phaseBadge(phase)}
          ${nodeCount > 0 ? `<span style="font-size:.75rem;color:var(--secondary-text-color)">${readyCount}/${nodeCount} nodes</span>` : ''}
        </div>
        <div class="app-row"><span class="lbl">Version</span><span>${esc(spec.version)}</span></div>
        ${status?.resolved_version ? `<div class="app-row"><span class="lbl">Resolved</span><span>${esc(status.resolved_version)}</span></div>` : ''}
        ${spec.route ? `<div class="app-row"><span class="lbl">Route</span><span style="font-family:monospace">${esc(spec.route)}</span></div>` : ''}
        ${status?.message ? `<div class="app-row"><span class="lbl">Message</span><span>${esc(status.message)}</span></div>` : ''}
        ${nodes.length > 0 ? `
        <div style="margin-top:6px">
          ${nodes.map(n => `<span class="app-node">${esc(n.node_id)} ${phaseBadge(n.phase)} ${n.error_message ? `<span style="color:var(--error-color);font-size:.72rem">${esc(n.error_message)}</span>` : ''}</span>`).join('')}
        </div>` : ''}
        <div class="app-actions">
          <button class="app-action-btn app-action-btn--danger" data-undeploy="${esc(name)}">Undeploy</button>
        </div>
      </div>`
  }

  private async renderDeployForm() {
    const el = this.querySelector('#deployForm') as HTMLElement
    if (!el) return

    // Load available APPLICATION artifacts
    await this.loadAppArtifacts()

    const appOpts = this._appArtifacts.length > 0
      ? this._appArtifacts.map(a => `<option value="${esc(a.publisher)}/${esc(a.name)}">${esc(a.publisher)}/${esc(a.name)}</option>`).join('')
      : '<option value="">No APPLICATION artifacts found</option>'

    el.innerHTML = `
      <div class="app-form">
        <h4>Deploy Application</h4>
        <div class="app-form-grid">
          <label>Application
            <select id="dfApp">${appOpts}</select>
          </label>
          <label>Version
            <select id="dfVersion"><option value="">Select app first</option></select>
          </label>
          <label>Route (optional)
            <input id="dfRoute" placeholder="/apps/myapp" />
          </label>
          <label>Index File
            <input id="dfIndex" value="index.html" />
          </label>
        </div>
        <div style="display:flex;gap:8px">
          <button class="deploy-btn" id="dfSubmit">Deploy</button>
          <button class="app-action-btn" id="dfCancel">Cancel</button>
        </div>
      </div>`

    // Update version selector when app changes
    const appSel = el.querySelector('#dfApp') as HTMLSelectElement
    const verSel = el.querySelector('#dfVersion') as HTMLSelectElement
    const updateVersions = () => {
      const val = appSel.value
      const app = this._appArtifacts.find(a => `${a.publisher}/${a.name}` === val)
      verSel.innerHTML = app && app.versions.length > 0
        ? app.versions.map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join('')
        : '<option value="">No versions</option>'
    }
    appSel.addEventListener('change', updateVersions)
    updateVersions()

    el.querySelector('#dfCancel')?.addEventListener('click', () => { this._showDeploy = false; this.render() })
    el.querySelector('#dfSubmit')?.addEventListener('click', async () => {
      const appVal = appSel.value
      const parts = appVal.split('/')
      if (parts.length < 2) return
      const version = verSel.value
      if (!version) { this._error = 'Select a version'; this.render(); return }

      const spec: ApplicationReleaseSpec = {
        publisher_id: parts[0],
        app_name: parts.slice(1).join('/'),
        version,
        route: (el.querySelector('#dfRoute') as HTMLInputElement).value.trim(),
        index_file: (el.querySelector('#dfIndex') as HTMLInputElement).value.trim() || 'index.html',
      }

      try {
        await deployApplication(spec)
        this._showDeploy = false
        this._error = ''
        await this.load()
      } catch (e: any) {
        this._error = e?.message || 'Deploy failed'
        this.render()
      }
    })
  }

  private wireEvents() {
    this.querySelector('#btnRefresh')?.addEventListener('click', () => { this._loading = true; this.render(); this.load() })
    this.querySelector('#btnDeploy')?.addEventListener('click', () => { this._showDeploy = true; this.render(); this.renderDeployForm() })

    if (this._showDeploy) this.renderDeployForm()

    this.querySelectorAll('[data-undeploy]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const name = (btn as HTMLElement).dataset.undeploy!
        const ok = await confirmDialog({
          title: 'Undeploy Application',
          message: `Remove "${name}" from the cluster?\n\nThe application files will be deleted from all nodes.`,
          okLabel: 'Undeploy', variant: 'danger',
        })
        if (!ok) return
        try { await undeployApplication(name); await this.load() }
        catch (e: any) { this._error = e?.message || 'Undeploy failed'; this.render() }
      })
    })
  }
}

customElements.define('page-repo-applications', PageRepoApplications)
