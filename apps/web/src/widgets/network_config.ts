// src/widgets/network_config.ts
import '@polymer/paper-icon-button/paper-icon-button.js'
import '@polymer/iron-icons/iron-icons.js'
import { fetchNetworkSummary, applyNetworkUpdate, NetworkSummary } from '../backend/core/network'
import { displayError, displaySuccess } from '../backend/ui/notify'

class NetworkConfig extends HTMLElement {
  private shadow!: ShadowRoot
  private saveBtn!: HTMLButtonElement
  private refreshBtn!: HTMLButtonElement
  private hostInput!: HTMLInputElement
  private dnsInput!: HTMLInputElement
  private list!: HTMLElement
  private busy = false

  constructor() {
    super()
    this.shadow = this.attachShadow({ mode: 'open' })
    this.shadow.innerHTML = `
      <style>
        :host { display:block; }
        .wrap {
          background: var(--surface-color);
          color: var(--on-surface-color);
          border-radius: 12px;
          box-shadow: 0 0 0 1px color-mix(in srgb, var(--on-surface-color) 12%, transparent);
          padding: 1rem;
          display: grid; gap: 1rem;
        }
        .bar { display:flex; align-items:center; gap:.5rem; }
        .title { font-weight: 800; font-size: 1.05rem; }
        .spacer { flex:1; }

        .grid {
          display:grid;
          grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
          gap: .75rem;
        }
        .card {
          border-radius: 10px;
          padding: .75rem;
          background: color-mix(in srgb, var(--surface-color) 80%, var(--background-color));
          box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--on-surface-color) 10%, transparent);
          display:grid; gap:.25rem;
        }
        .name { font-weight:700; }
        .muted { opacity:.8; font-size:.9rem; }
        .row { display:flex; flex-wrap:wrap; gap:.4rem .6rem; }
        .chip {
          border:1px solid color-mix(in srgb, var(--on-surface-color) 20%, transparent);
          border-radius: 999px;
          padding: .1rem .5rem;
          font-size: .85rem;
        }

        .form {
          display:grid; gap:.5rem;
          grid-template-columns: 1fr;
        }
        .field { display:grid; gap:.25rem; }
        .field input {
          padding: .55rem .6rem;
          border-radius: .6rem;
          border: 1px solid color-mix(in srgb, var(--on-surface-color) 25%, transparent);
          background: transparent;
          color: var(--on-surface-color);
          outline: none;
        }
        .actions { display:flex; gap:.5rem; justify-content:flex-end; }
        .btn {
          padding:.55rem .8rem; border-radius:.6rem; border:1px solid transparent;
          background: var(--primary-color); color: var(--on-primary-color); cursor:pointer; font-weight:700;
        }
        .btn.secondary {
          background: transparent; color: var(--on-surface-color);
          border-color: color-mix(in srgb, var(--on-surface-color) 25%, transparent);
        }
        .btn[disabled] { opacity:.6; cursor: default; }

        .spinner {
          display:none; width:16px; height:16px; border-radius:50%;
          border:2px solid color-mix(in srgb, var(--on-surface-color) 30%, transparent);
          border-top-color: var(--on-surface-color);
          animation: spin .9s linear infinite;
        }
        .busy .spinner { display:inline-block; }
        @keyframes spin { to { transform: rotate(360deg) } }
      </style>

      <div class="wrap">
        <div class="bar">
          <div class="title">Network configuration</div>
          <div class="spacer"></div>
          <span class="spinner" id="spin"></span>
          <button class="btn secondary" id="refresh">Refresh</button>
          <button class="btn" id="save">Save</button>
        </div>

        <div class="form">
          <div class="field">
            <label for="hostname">Hostname</label>
            <input id="hostname" placeholder="e.g. node-01" />
          </div>
          <div class="field">
            <label for="dns">DNS servers (comma-separated)</label>
            <input id="dns" placeholder="e.g. 1.1.1.1, 8.8.8.8" />
          </div>
        </div>

        <div>
          <div class="title" style="font-size:.95rem">Interfaces</div>
          <div id="list" class="grid"></div>
        </div>
      </div>
    `
  }

  connectedCallback(): void {
    this.saveBtn = this.shadow.getElementById('save') as HTMLButtonElement
    this.refreshBtn = this.shadow.getElementById('refresh') as HTMLButtonElement
    this.hostInput = this.shadow.getElementById('hostname') as HTMLInputElement
    this.dnsInput = this.shadow.getElementById('dns') as HTMLInputElement
    this.list = this.shadow.getElementById('list') as HTMLElement

    this.refreshBtn.onclick = () => this.load()
    this.saveBtn.onclick = () => this.save()

    queueMicrotask(() => this.load())
  }

  private setBusy(on: boolean) {
    this.busy = on
    const wrap = this.shadow.querySelector('.wrap') as HTMLElement
    if (on) wrap.classList.add('busy'); else wrap.classList.remove('busy')
    this.saveBtn.disabled = on
    this.refreshBtn.disabled = on
  }

  private render(summary: NetworkSummary) {
    this.hostInput.value = summary.hostname || ''
    this.dnsInput.value = (summary.dnsServers || []).join(', ')

    this.list.innerHTML = ''
    for (const i of summary.interfaces) {
      const card = document.createElement('div')
      card.className = 'card'
      card.innerHTML = `
        <div class="name">${i.name || '(iface)'}</div>
        <div class="muted">${i.mac || ''} ${i.up ? ' • up' : ' • down'}</div>
        ${i.mtu ? `<div class="muted">MTU ${i.mtu}</div>` : ''}
        <div class="row">${(i.ipv4 || []).map(ip => `<span class="chip">${ip}</span>`).join('')}</div>
        <div class="row">${(i.ipv6 || []).map(ip => `<span class="chip">${ip}</span>`).join('')}</div>
      `
      this.list.appendChild(card)
    }
  }

  private parseDns(): string[] {
    return this.dnsInput.value
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)
  }

  async load() {
    this.setBusy(true)
    try {
      const data = await fetchNetworkSummary()
      this.render(data)
    } catch (e: any) {
      displayError(e?.message || 'Failed to load network configuration')
    } finally {
      this.setBusy(false)
    }
  }

  async save() {
    this.setBusy(true)
    try {
      await applyNetworkUpdate({
        hostname: this.hostInput.value.trim() || undefined,
        dnsServers: this.parseDns(),
      })
      displaySuccess('Network settings saved')
      await this.load()
    } catch (e: any) {
      displayError(e?.message || 'Failed to save network settings')
    } finally {
      this.setBusy(false)
    }
  }
}

customElements.define('network-config', NetworkConfig)
