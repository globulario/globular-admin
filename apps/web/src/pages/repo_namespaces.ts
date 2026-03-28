import {
  listArtifacts, listNamespaces, claimNamespace,
  grantNamespaceAccess, revokeNamespaceAccess,
  type ArtifactManifest, type NamespaceInfo,
} from '@globular/sdk'
import { confirmDialog } from '../utils/confirm_dialog'

/* eslint-disable @typescript-eslint/no-explicit-any */
function ext(a: ArtifactManifest): any { return a as any }

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

interface NSRow {
  id: string
  claimed: boolean
  owners: string[]
  collaborators: { subject: string; role: string }[]
  packageCount: number
  latestPublish: number
  verified: boolean
}

class PageRepoNamespaces extends HTMLElement {
  private _timer: number | null = null
  private _rows: NSRow[] = []
  private _loading = true
  private _error = ''
  private _search = ''
  private _expanded: string | null = null
  private _showClaimForm = false
  private _showGrantForm: string | null = null

  connectedCallback() {
    this.style.display = 'block'
    this.render()
    this.load()
    this._timer = window.setInterval(() => this.load(), 30_000)
  }

  disconnectedCallback() {
    if (this._timer) clearInterval(this._timer)
  }

  private async load() {
    try {
      const [artifacts, claimed] = await Promise.all([
        listArtifacts(),
        listNamespaces().catch(() => [] as NamespaceInfo[]),
      ])

      // Build namespace map from artifacts
      const nsMap = new Map<string, NSRow>()
      for (const a of artifacts) {
        const pub = a.ref?.publisherId || ''
        if (!pub) continue
        const e = ext(a)
        const ts: number = e.publishedUnix || a.modifiedUnix || 0
        const trust: string[] = e.trustLabelsList || []
        const isVerified = trust.includes('owned') || trust.includes('official') || trust.includes('verified_namespace')

        if (!nsMap.has(pub)) {
          nsMap.set(pub, { id: pub, claimed: false, owners: [], collaborators: [], packageCount: 0, latestPublish: 0, verified: false })
        }
        const r = nsMap.get(pub)!
        r.packageCount++
        if (isVerified) r.verified = true
        if (ts > r.latestPublish) r.latestPublish = ts
      }

      // Merge claimed namespaces from RBAC
      for (const ns of claimed) {
        if (!nsMap.has(ns.name)) {
          nsMap.set(ns.name, { id: ns.name, claimed: false, owners: [], collaborators: [], packageCount: 0, latestPublish: 0, verified: false })
        }
        const r = nsMap.get(ns.name)!
        r.claimed = ns.claimed
        r.owners = ns.owners || []
        r.collaborators = ns.collaborators || []
        if (ns.claimed) r.verified = true
        if (ns.artifactCount && ns.artifactCount > r.packageCount) r.packageCount = ns.artifactCount
      }

      this._rows = Array.from(nsMap.values()).sort((a, b) => a.id.localeCompare(b.id))
      this._error = ''
    } catch (e: any) {
      this._error = e?.message || 'Failed to load'
    }
    this._loading = false
    this.render()
  }

  private get filtered(): NSRow[] {
    if (!this._search) return this._rows
    const q = this._search.toLowerCase()
    return this._rows.filter(n => n.id.toLowerCase().includes(q))
  }

  private relTime(epoch: number): string {
    if (!epoch) return '—'
    const d = Math.floor(Date.now() / 1000) - epoch
    if (d < 0) return 'now'
    if (d < 60) return `${d}s ago`
    if (d < 3600) return `${Math.floor(d / 60)}m ago`
    if (d < 86400) return `${Math.floor(d / 3600)}h ago`
    return `${Math.floor(d / 86400)}d ago`
  }

  private statusBadge(ns: NSRow): string {
    const reserved = ['globular', 'system', 'core', 'internal', 'admin']
    const isReserved = reserved.some(p => ns.id === p || ns.id.startsWith(p + '.') || ns.id.startsWith(p + '-') || ns.id.startsWith(p + '_') || ns.id.startsWith(p + '@'))
    if (isReserved) return '<span style="display:inline-block;font-size:.65rem;font-weight:700;padding:2px 6px;border-radius:4px;background:#e0e7ff;color:#3730a3">Reserved</span>'
    if (ns.claimed) return '<span style="display:inline-block;font-size:.65rem;font-weight:700;padding:2px 6px;border-radius:4px;background:#dcfce7;color:#166534">Claimed</span>'
    return '<span style="display:inline-block;font-size:.65rem;font-weight:700;padding:2px 6px;border-radius:4px;background:#fef3c7;color:#92400e">Unclaimed</span>'
  }

  private render() {
    const list = this.filtered
    const total = this._rows.length
    const claimed = this._rows.filter(n => n.claimed).length

    this.innerHTML = `
      <style>
        .ns-page { padding: 16px; display: flex; flex-direction: column; gap: 20px; }
        .ns-page h2 { margin:0; font: var(--md-typescale-headline-small); }
        .ns-sub { margin:2px 0 0; font: var(--md-typescale-body-medium); color:var(--secondary-text-color); }
        .stat-row { display:flex; gap:12px; flex-wrap:wrap; }
        .stat-pill { background:var(--md-surface-container-low); border:1px solid var(--border-subtle-color); border-radius:var(--md-shape-md); padding:12px 20px; box-shadow:var(--md-elevation-1); }
        .stat-pill .label { font-size:.7rem; font-weight:600; text-transform:uppercase; letter-spacing:.06em; color:var(--secondary-text-color); margin-bottom:4px; }
        .stat-pill .value { font-size:1.6rem; font-weight:800; line-height:1; }
        .toolbar { display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
        .toolbar .search-input { padding:8px 12px; border:1px solid var(--border-strong-color); border-radius:var(--md-shape-sm); background:var(--md-surface-container-lowest); color:var(--on-surface-color); font:var(--md-typescale-body-medium); outline:none; min-width:200px; flex:1; max-width:360px; }
        .toolbar .search-input:focus { border-color:var(--accent-color); box-shadow:var(--md-focus-ring); }
        .claim-btn { padding:6px 16px; border:none; border-radius:var(--md-shape-sm); background:var(--primary-color); color:var(--on-primary-color); font-size:.82rem; font-weight:600; cursor:pointer; }
        .claim-btn:hover { opacity:.85; }
        .ns-detail { background:var(--md-surface-container-low); border:1px solid var(--border-subtle-color); border-radius:var(--md-shape-sm); padding:12px 16px; margin:4px 0; }
        .ns-detail-row { display:flex; gap:8px; font-size:.82rem; line-height:1.6; }
        .ns-detail-row .lbl { min-width:100px; color:var(--secondary-text-color); font-size:.78rem; font-weight:600; }
        .ns-collab { display:flex; align-items:center; gap:8px; font-size:.82rem; padding:3px 0; }
        .ns-collab .role-badge { font-size:.65rem; padding:1px 6px; border-radius:3px; background:color-mix(in srgb, var(--primary-color) 15%, transparent); color:var(--primary-color); }
        .ns-action-btn { background:none; border:none; cursor:pointer; font-size:.78rem; padding:2px 8px; border-radius:4px; color:var(--primary-color); }
        .ns-action-btn:hover { background:color-mix(in srgb, var(--primary-color) 10%, transparent); }
        .ns-action-btn--danger { color:var(--error-color); }
        .ns-action-btn--danger:hover { background:color-mix(in srgb, var(--error-color) 10%, transparent); }
        .ns-form { background:var(--md-surface-container-low); border:1px solid var(--border-subtle-color); border-radius:var(--md-shape-md); padding:14px; margin-bottom:12px; }
        .ns-form h4 { margin:0 0 10px; font-size:.88rem; }
        .ns-form-row { display:flex; gap:8px; align-items:end; flex-wrap:wrap; }
        .ns-form-row label { display:flex; flex-direction:column; gap:3px; font-size:.78rem; color:var(--secondary-text-color); }
        .ns-form-row input, .ns-form-row select { padding:5px 8px; border:1px solid var(--border-subtle-color); border-radius:4px; background:var(--surface-color); color:var(--on-surface-color); font-size:.82rem; }
        .empty-state { text-align:center; padding:48px 16px; color:var(--secondary-text-color); }
      </style>

      <div class="ns-page">
        <div>
          <h2>Namespaces</h2>
          <p class="ns-sub">Publisher identities, ownership, and access control.</p>
        </div>

        ${this._loading ? '<div style="color:var(--secondary-text-color);font-size:.85rem;padding:16px">Loading namespaces...</div>' : ''}
        ${this._error ? `<div style="color:var(--error-color);padding:8px">${esc(this._error)}</div>` : ''}

        ${!this._loading ? `
        <div class="stat-row">
          <div class="stat-pill"><div class="label">Total</div><div class="value">${total}</div></div>
          <div class="stat-pill"><div class="label">Claimed</div><div class="value" style="color:#16a34a">${claimed}</div></div>
          <div class="stat-pill"><div class="label">Unclaimed</div><div class="value" style="color:#ca8a04">${total - claimed}</div></div>
        </div>

        <div class="toolbar">
          <input type="text" class="search-input" id="nsSearch" placeholder="Search namespaces..." value="${this._search.replace(/"/g, '&quot;')}" />
          <button class="claim-btn" id="btnClaim">+ Claim Namespace</button>
          <button class="md-btn md-btn-outlined" id="btnRefresh">Refresh</button>
        </div>

        <div id="claimForm"></div>

        ${list.length > 0 ? `
        <div class="md-panel" style="margin-bottom:0">
          <table class="md-table">
            <thead><tr><th>Namespace</th><th>Status</th><th>Owners</th><th>Packages</th><th>Last Published</th></tr></thead>
            <tbody class="md-interactive">
              ${list.map(ns => `
              <tr class="ns-row" data-ns="${esc(ns.id)}" style="cursor:pointer">
                <td style="font-weight:600">${esc(ns.id)}</td>
                <td>${this.statusBadge(ns)}</td>
                <td style="font-size:.82rem">${ns.owners.length > 0 ? esc(ns.owners.join(', ')) : '—'}</td>
                <td>${ns.packageCount}</td>
                <td style="color:var(--secondary-text-color);white-space:nowrap">${this.relTime(ns.latestPublish)}</td>
              </tr>
              ${this._expanded === ns.id ? `<tr><td colspan="5">${this.renderDetail(ns)}</td></tr>` : ''}
              `).join('')}
            </tbody>
          </table>
        </div>
        ` : '<div class="empty-state">No namespaces found. Publish a package or claim a namespace.</div>'}
        ` : ''}
      </div>
    `
    this.wireEvents()
    if (this._showClaimForm) this.renderClaimForm()
  }

  private renderDetail(ns: NSRow): string {
    const collabs = ns.collaborators.length > 0
      ? ns.collaborators.map(c => `
        <div class="ns-collab">
          <span>${esc(c.subject)}</span>
          <span class="role-badge">${esc(c.role)}</span>
          <button class="ns-action-btn ns-action-btn--danger" data-revoke-ns="${esc(ns.id)}" data-revoke-user="${esc(c.subject)}">Revoke</button>
        </div>`).join('')
      : '<div style="font-size:.82rem;color:var(--secondary-text-color)">No collaborators</div>'

    return `
      <div class="ns-detail">
        <div class="ns-detail-row"><span class="lbl">Owners</span><span>${ns.owners.length > 0 ? esc(ns.owners.join(', ')) : '—'}</span></div>
        <div style="margin-top:8px;font-size:.78rem;font-weight:600;color:var(--secondary-text-color)">Collaborators</div>
        ${collabs}
        <div style="margin-top:8px;display:flex;gap:6px">
          ${ns.claimed ? `<button class="ns-action-btn" data-grant-ns="${esc(ns.id)}">+ Grant Access</button>` : ''}
          ${!ns.claimed ? `<button class="claim-btn" style="font-size:.75rem;padding:4px 10px" data-claim-quick="${esc(ns.id)}">Claim</button>` : ''}
          <button class="ns-action-btn" data-view-pkgs="${esc(ns.id)}">View Packages</button>
        </div>
        <div id="grantForm-${esc(ns.id)}"></div>
      </div>`
  }

  private renderClaimForm() {
    const el = this.querySelector('#claimForm') as HTMLElement
    if (!el) return
    el.innerHTML = `
      <div class="ns-form">
        <h4>Claim Namespace</h4>
        <div class="ns-form-row">
          <label>Name <input id="claimName" placeholder="dave@globular.io" style="width:200px" /></label>
          <label>Organization (optional) <input id="claimOrg" placeholder="acme-corp" style="width:150px" /></label>
          <button class="claim-btn" id="claimSubmit">Claim</button>
          <button class="ns-action-btn" id="claimCancel">Cancel</button>
        </div>
      </div>`
    el.querySelector('#claimCancel')?.addEventListener('click', () => { this._showClaimForm = false; this.render() })
    el.querySelector('#claimSubmit')?.addEventListener('click', async () => {
      const name = (el.querySelector('#claimName') as HTMLInputElement).value.trim()
      const org = (el.querySelector('#claimOrg') as HTMLInputElement).value.trim()
      if (!name) return
      try { await claimNamespace(name, org || undefined); this._showClaimForm = false; await this.load() }
      catch (e: any) { this._error = e?.message || 'Claim failed'; this.render() }
    })
  }

  private renderGrantForm(nsId: string) {
    const el = this.querySelector(`#grantForm-${nsId}`) as HTMLElement
    if (!el) return
    el.innerHTML = `
      <div class="ns-form" style="margin-top:8px">
        <div class="ns-form-row">
          <label>User <input id="grantUser" placeholder="alice" style="width:160px" /></label>
          <label>Role <select id="grantRole">
            <option value="namespace:viewer">Viewer</option>
            <option value="namespace:publisher" selected>Publisher</option>
            <option value="namespace:admin">Admin</option>
          </select></label>
          <button class="claim-btn" style="font-size:.78rem;padding:4px 10px" id="grantSubmit">Grant</button>
          <button class="ns-action-btn" id="grantCancel">Cancel</button>
        </div>
      </div>`
    el.querySelector('#grantCancel')?.addEventListener('click', () => { this._showGrantForm = null; this.render() })
    el.querySelector('#grantSubmit')?.addEventListener('click', async () => {
      const user = (el.querySelector('#grantUser') as HTMLInputElement).value.trim()
      const role = (el.querySelector('#grantRole') as HTMLSelectElement).value
      if (!user) return
      try { await grantNamespaceAccess(nsId, user, role); this._showGrantForm = null; await this.load() }
      catch (e: any) { this._error = e?.message || 'Grant failed'; this.render() }
    })
  }

  private wireEvents() {
    this.querySelector('#btnRefresh')?.addEventListener('click', () => { this._loading = true; this.render(); this.load() })
    this.querySelector('#btnClaim')?.addEventListener('click', () => { this._showClaimForm = true; this.render() })

    const search = this.querySelector('#nsSearch') as HTMLInputElement
    if (search) {
      search.addEventListener('input', () => { this._search = search.value; this.render(); (this.querySelector('#nsSearch') as HTMLInputElement)?.focus() })
    }

    // Row expand/collapse
    this.querySelectorAll('.ns-row').forEach(row => {
      row.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).closest('button')) return
        const ns = (row as HTMLElement).dataset.ns || ''
        this._expanded = this._expanded === ns ? null : ns
        this._showGrantForm = null
        this.render()
      })
    })

    // Quick claim from detail panel
    this.querySelectorAll('[data-claim-quick]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const ns = (btn as HTMLElement).dataset.claimQuick!
        try { await claimNamespace(ns); await this.load() }
        catch (e: any) { this._error = e?.message || 'Claim failed'; this.render() }
      })
    })

    // Grant access button
    this.querySelectorAll('[data-grant-ns]').forEach(btn => {
      btn.addEventListener('click', () => {
        const ns = (btn as HTMLElement).dataset.grantNs!
        this._showGrantForm = ns
        this.render()
        if (this._showGrantForm === ns) this.renderGrantForm(ns)
      })
    })

    // Revoke
    this.querySelectorAll('[data-revoke-ns]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const ns = (btn as HTMLElement).dataset.revokeNs!
        const user = (btn as HTMLElement).dataset.revokeUser!
        const ok = await confirmDialog({
          title: 'Revoke Access',
          message: `Revoke ${user}'s access to namespace "${ns}"?`,
          okLabel: 'Revoke', variant: 'danger',
        })
        if (!ok) return
        try { await revokeNamespaceAccess(ns, user); await this.load() }
        catch (e: any) { this._error = e?.message || 'Revoke failed'; this.render() }
      })
    })

    // View packages
    this.querySelectorAll('[data-view-pkgs]').forEach(btn => {
      btn.addEventListener('click', () => {
        const ns = (btn as HTMLElement).dataset.viewPkgs!
        window.location.hash = '#/repository/catalog'
        setTimeout(() => {
          const page = document.querySelector('page-repository') as any
          if (page) { page._publisherFilter = ns; page.render?.() }
        }, 100)
      })
    })

    // Grant form rendering if already showing
    if (this._showGrantForm) this.renderGrantForm(this._showGrantForm)
  }
}

customElements.define('page-repo-namespaces', PageRepoNamespaces)
