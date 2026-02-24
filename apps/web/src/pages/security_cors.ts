import {
  fetchCorsPolicies, saveServiceCorsPolicy,
  fetchGatewayCorsPolicy, saveGatewayCorsPolicy,
} from '@globular/backend'
import type { ServiceCorsPolicy, GatewayCorsPolicy } from '@globular/backend'

const GATEWAY_ID = '__gateway__'

class PageSecurityCors extends HTMLElement {
  private policies: ServiceCorsPolicy[] = []
  private gateway: GatewayCorsPolicy | null = null
  private dirty = new Set<string>()       // service ids + GATEWAY_ID
  private tableBody!: HTMLTableSectionElement
  private statusEl!: HTMLElement
  private saveAllBtn!: HTMLButtonElement

  connectedCallback() {
    this.style.display = 'block'
    this.render()
    this.load()
  }

  private render() {
    this.innerHTML = `
      <section class="page">
        <div class="header">
          <h2>CORS Policy Management</h2>
          <div class="spacer"></div>
          <button id="saveAllBtn" class="submit" disabled style="min-width:120px">Apply All</button>
        </div>
        <p class="subtitle">Controls which browser origins may call the gateway and each Globular service. Changes take effect immediately.</p>

        <div class="card" style="overflow:auto;margin-top:12px;">
          <table style="width:100%;border-collapse:collapse;font-size:0.9rem;">
            <thead>
              <tr style="border-bottom:2px solid var(--border-subtle-color,rgba(0,0,0,.12));text-align:left;">
                <th style="padding:10px 14px;font-weight:600;">Service</th>
                <th style="padding:10px 14px;font-weight:600;white-space:nowrap;">Allow All Origins</th>
                <th style="padding:10px 14px;font-weight:600;">Allowed Origins <span style="font-weight:400;opacity:.6;font-size:.8em">(comma-separated, ignored when Allow All is on)</span></th>
                <th style="padding:10px 14px;font-weight:600;"></th>
              </tr>
            </thead>
            <tbody id="corsBody">
              <tr><td colspan="4" style="padding:20px;text-align:center;opacity:.6;">Loading…</td></tr>
            </tbody>
          </table>
        </div>

        <div style="margin-top:16px;padding:12px 16px;border-radius:8px;background:var(--surface-color);border:1px solid var(--border-subtle-color,rgba(0,0,0,.12));font-size:.85rem;line-height:1.6;opacity:.85;">
          <strong>Notes:</strong><br>
          • <strong>Envoy</strong>: Route-level CORS is derived from the XDS bootstrap config — changes here update the gateway process config and the XDS watcher picks them up on next reconcile.<br>
          • <strong>MinIO</strong>: CORS is managed separately via the MinIO Admin API (<code>mc admin cors</code>).
        </div>

        <div id="corsStatus" style="margin-top:10px;min-height:24px;font-size:.85rem;"></div>
      </section>
    `
    this.tableBody = this.querySelector('#corsBody') as HTMLTableSectionElement
    this.statusEl = this.querySelector('#corsStatus') as HTMLElement
    this.saveAllBtn = this.querySelector('#saveAllBtn') as HTMLButtonElement
    this.saveAllBtn.addEventListener('click', () => this.saveAll())
  }

  private async load() {
    this.dirty.clear()
    this.syncSaveAllBtn()
    try {
      const [gw, services] = await Promise.allSettled([
        fetchGatewayCorsPolicy(),
        fetchCorsPolicies(),
      ])
      this.gateway = gw.status === 'fulfilled' ? gw.value : null
      this.policies = services.status === 'fulfilled' ? services.value : []

      const gwErr = gw.status === 'rejected' ? (gw.reason?.message ?? gw.reason) : null
      const svcErr = services.status === 'rejected' ? (services.reason?.message ?? services.reason) : null

      this.populateTable()

      if (gwErr || svcErr) {
        const parts = [gwErr && `Gateway: ${gwErr}`, svcErr && `Services: ${svcErr}`].filter(Boolean)
        this.setStatus(`Some items failed to load — ${parts.join('; ')}`, true)
      }
    } catch (err: any) {
      this.tableBody.innerHTML = `<tr><td colspan="4" style="padding:20px;color:var(--error-color,#c62828);">
        Failed to load CORS policies: ${err?.message ?? err}
      </td></tr>`
    }
  }

  private populateTable() {
    this.tableBody.innerHTML = ''

    // Gateway row — always first, visually distinct
    if (this.gateway) {
      this.tableBody.appendChild(this.buildGatewayRow(this.gateway))
    } else {
      const tr = document.createElement('tr')
      tr.innerHTML = `<td colspan="4" style="padding:10px 14px;opacity:.5;font-size:.85rem;">Gateway config unavailable</td>`
      this.tableBody.appendChild(tr)
    }

    // Divider between gateway and per-service rows
    const div = document.createElement('tr')
    div.innerHTML = `<td colspan="4" style="padding:4px 14px;font-size:.75rem;font-weight:600;letter-spacing:.06em;opacity:.45;text-transform:uppercase;background:var(--surface-color);">Services</td>`
    this.tableBody.appendChild(div)

    if (this.policies.length === 0) {
      const tr = document.createElement('tr')
      tr.innerHTML = `<td colspan="4" style="padding:20px;text-align:center;opacity:.6;">No services found.</td>`
      this.tableBody.appendChild(tr)
    } else {
      for (const p of this.policies) {
        this.tableBody.appendChild(this.buildRow(p))
      }
    }
  }

  private buildGatewayRow(gw: GatewayCorsPolicy): HTMLTableRowElement {
    const tr = document.createElement('tr')
    tr.dataset.id = GATEWAY_ID
    tr.style.cssText = 'border-bottom:1px solid var(--border-subtle-color,rgba(0,0,0,.08));transition:background .15s;'

    tr.innerHTML = `
      <td style="padding:10px 14px;">
        <div style="font-weight:600;">Gateway (Globular)</div>
        <div style="font-size:.75em;opacity:.55;margin-top:1px;">HTTP gateway — applies to all proxied traffic</div>
      </td>
      <td style="padding:10px 14px;text-align:center;">
        <label style="display:inline-flex;align-items:center;gap:6px;cursor:pointer;">
          <input type="checkbox" class="allow-all-cb" ${gw.allowAllOrigins ? 'checked' : ''}>
          <span class="allow-all-label" style="font-size:.82em;opacity:.7">${gw.allowAllOrigins ? 'Yes' : 'No'}</span>
        </label>
      </td>
      <td style="padding:10px 14px;">
        <input type="text" class="origins-input"
          value="${escapeHtml(gw.allowedOrigins)}"
          placeholder="e.g. https://app.example.com,https://admin.example.com"
          ${gw.allowAllOrigins ? 'disabled' : ''}
          style="width:100%;box-sizing:border-box;padding:6px 10px;border-radius:6px;
                 border:1px solid var(--border-subtle-color,rgba(0,0,0,.18));
                 background:var(--surface-color);color:var(--on-surface-color);font-size:.88rem;
                 outline:none;min-width:240px;">
      </td>
      <td style="padding:10px 14px;text-align:right;white-space:nowrap;">
        <button class="save-row-btn submit" disabled
          style="font-size:.8rem;padding:5px 14px;">Save</button>
      </td>
    `

    const cb = tr.querySelector('.allow-all-cb') as HTMLInputElement
    const input = tr.querySelector('.origins-input') as HTMLInputElement
    const saveBtn = tr.querySelector('.save-row-btn') as HTMLButtonElement

    cb.addEventListener('change', () => {
      const lbl = cb.parentElement?.querySelector('.allow-all-label') as HTMLElement
      if (lbl) lbl.textContent = cb.checked ? 'Yes' : 'No'
      input.disabled = cb.checked
      this.markDirty(GATEWAY_ID, tr, saveBtn)
    })
    input.addEventListener('input', () => this.markDirty(GATEWAY_ID, tr, saveBtn))
    saveBtn.addEventListener('click', () => this.saveGatewayRow(tr, saveBtn))

    return tr
  }

  private buildRow(p: ServiceCorsPolicy): HTMLTableRowElement {
    const tr = document.createElement('tr')
    tr.dataset.id = p.id
    tr.style.cssText = 'border-bottom:1px solid var(--border-subtle-color,rgba(0,0,0,.08));transition:background .15s'

    const label = p.name || p.id
    const subtitle = p.name ? `<div style="font-size:.75em;opacity:.55;margin-top:1px">${escapeHtml(p.id)}</div>` : ''

    tr.innerHTML = `
      <td style="padding:10px 14px;">
        <div style="font-weight:500">${escapeHtml(label)}</div>
        ${subtitle}
      </td>
      <td style="padding:10px 14px;text-align:center;">
        <label style="display:inline-flex;align-items:center;gap:6px;cursor:pointer;">
          <input type="checkbox" class="allow-all-cb" data-id="${escapeHtml(p.id)}" ${p.allowAllOrigins ? 'checked' : ''}>
          <span class="allow-all-label" style="font-size:.82em;opacity:.7">${p.allowAllOrigins ? 'Yes' : 'No'}</span>
        </label>
      </td>
      <td style="padding:10px 14px;">
        <input type="text" class="origins-input" data-id="${escapeHtml(p.id)}"
          value="${escapeHtml(p.allowedOrigins)}"
          placeholder="e.g. https://app.example.com,https://admin.example.com"
          ${p.allowAllOrigins ? 'disabled' : ''}
          style="width:100%;box-sizing:border-box;padding:6px 10px;border-radius:6px;
                 border:1px solid var(--border-subtle-color,rgba(0,0,0,.18));
                 background:var(--surface-color);color:var(--on-surface-color);font-size:.88rem;
                 outline:none;min-width:240px;">
      </td>
      <td style="padding:10px 14px;text-align:right;white-space:nowrap;">
        <button class="save-row-btn submit" data-id="${escapeHtml(p.id)}" disabled
          style="font-size:.8rem;padding:5px 14px;">Save</button>
      </td>
    `

    const cb = tr.querySelector('.allow-all-cb') as HTMLInputElement
    const input = tr.querySelector('.origins-input') as HTMLInputElement
    const saveBtn = tr.querySelector('.save-row-btn') as HTMLButtonElement

    cb.addEventListener('change', () => {
      const lbl = cb.parentElement?.querySelector('.allow-all-label') as HTMLElement
      if (lbl) lbl.textContent = cb.checked ? 'Yes' : 'No'
      input.disabled = cb.checked
      this.markDirty(p.id, tr, saveBtn)
    })
    input.addEventListener('input', () => this.markDirty(p.id, tr, saveBtn))
    saveBtn.addEventListener('click', () => this.saveRow(p.id, tr, saveBtn))

    return tr
  }

  // ── Dirty tracking ──────────────────────────────────────────────────────────

  private markDirty(id: string, tr: HTMLTableRowElement, saveBtn: HTMLButtonElement) {
    this.dirty.add(id)
    tr.style.background = 'color-mix(in srgb, var(--primary-color,#1976d2) 6%, transparent)'
    saveBtn.disabled = false
    this.syncSaveAllBtn()
  }

  private clearDirty(id: string, tr: HTMLTableRowElement, saveBtn: HTMLButtonElement) {
    this.dirty.delete(id)
    tr.style.background = ''
    saveBtn.disabled = true
    this.syncSaveAllBtn()
  }

  private syncSaveAllBtn() {
    this.saveAllBtn.disabled = this.dirty.size === 0
  }

  // ── Save logic ──────────────────────────────────────────────────────────────

  private readRowValues(tr: HTMLTableRowElement): { allowAllOrigins: boolean; allowedOrigins: string } {
    const cb = tr.querySelector('.allow-all-cb') as HTMLInputElement
    const input = tr.querySelector('.origins-input') as HTMLInputElement
    return { allowAllOrigins: cb.checked, allowedOrigins: input.value.trim() }
  }

  private async saveGatewayRow(tr: HTMLTableRowElement, saveBtn: HTMLButtonElement) {
    const vals = this.readRowValues(tr)
    saveBtn.disabled = true
    saveBtn.textContent = '…'
    try {
      await saveGatewayCorsPolicy(vals.allowAllOrigins, vals.allowedOrigins)
      this.gateway = vals
      this.clearDirty(GATEWAY_ID, tr, saveBtn)
      this.setStatus('Saved gateway CORS policy.', false)
    } catch (err: any) {
      saveBtn.disabled = false
      this.setStatus(`Error saving gateway CORS: ${err?.message ?? err}`, true)
    } finally {
      saveBtn.textContent = 'Save'
    }
  }

  private async saveRow(id: string, tr: HTMLTableRowElement, saveBtn: HTMLButtonElement) {
    const vals = this.readRowValues(tr)
    saveBtn.disabled = true
    saveBtn.textContent = '…'
    try {
      await saveServiceCorsPolicy(id, vals.allowAllOrigins, vals.allowedOrigins)
      this.clearDirty(id, tr, saveBtn)
      const p = this.policies.find(x => x.id === id)
      if (p) { p.allowAllOrigins = vals.allowAllOrigins; p.allowedOrigins = vals.allowedOrigins }
      this.setStatus(`Saved CORS policy for ${id}.`, false)
    } catch (err: any) {
      saveBtn.disabled = false
      this.setStatus(`Error saving ${id}: ${err?.message ?? err}`, true)
    } finally {
      saveBtn.textContent = 'Save'
    }
  }

  private async saveAll() {
    const ids = [...this.dirty]
    if (ids.length === 0) return
    this.saveAllBtn.disabled = true
    let errors = 0
    for (const id of ids) {
      if (id === GATEWAY_ID) {
        const tr = this.tableBody.querySelector(`tr[data-id="${GATEWAY_ID}"]`) as HTMLTableRowElement | null
        const saveBtn = tr?.querySelector('.save-row-btn') as HTMLButtonElement | null
        if (tr && saveBtn) await this.saveGatewayRow(tr, saveBtn).catch(() => { errors++ })
      } else {
        const tr = this.tableBody.querySelector(`tr[data-id="${CSS.escape(id)}"]`) as HTMLTableRowElement | null
        const saveBtn = tr?.querySelector('.save-row-btn') as HTMLButtonElement | null
        if (tr && saveBtn) await this.saveRow(id, tr, saveBtn).catch(() => { errors++ })
      }
    }
    this.syncSaveAllBtn()
    if (errors === 0) {
      this.setStatus('All changes saved successfully.', false)
    } else {
      this.setStatus(`${errors} item(s) failed to save. Check individual rows.`, true)
    }
  }

  private setStatus(msg: string, isError: boolean) {
    this.statusEl.textContent = msg
    this.statusEl.style.color = isError
      ? 'var(--error-color,#c62828)'
      : 'var(--primary-color,#1976d2)'
    if (!isError) {
      setTimeout(() => {
        if (this.statusEl.textContent === msg) this.statusEl.textContent = ''
      }, 4000)
    }
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

customElements.define('page-security-cors', PageSecurityCors)
