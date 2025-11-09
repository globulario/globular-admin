// src/widgets/peer_discovery.ts
import { displayError, displaySuccess } from '../backend/ui/notify'
import { scanPeers, pingPeer, registerPeer, DiscoveredHost } from '../backend/rbac/peers'

function toHostSafe(h: any): DiscoveredHost {
  // allow raw objects too
  return {
    name: String(h.name || h.host || '(unknown)'),
    ip: String(h.ip || ''),
    mac: String(h.mac || ''),
    infos: h.infos,
  }
}

/** <peer-card> */
class PeerCard extends HTMLElement {
  private shadow!: ShadowRoot
  private host!: DiscoveredHost
  private btnRegister!: HTMLButtonElement
  private btnPing!: HTMLButtonElement

  constructor() {
    super()
    this.shadow = this.attachShadow({ mode: 'open' })
    this.shadow.innerHTML = `
      <style>
        :host { display: block; }
        .card {
          user-select: none;
          background: var(--surface-color);
          color: var(--on-surface-color);
          border-radius: 12px;
          padding: .75rem;
          width: 220px;
          box-shadow: 0 0 0 1px color-mix(in srgb, var(--on-surface-color) 12%, transparent);
          display: grid; gap: .25rem;
        }
        .name { font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .meta { font-size: .85rem; opacity: .85; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .actions { display: flex; gap: .5rem; margin-top: .5rem; }
        .btn {
          padding: .4rem .6rem;
          border-radius: .6rem;
          border: 1px solid color-mix(in srgb, var(--on-surface-color) 30%, transparent);
          background: transparent;
          color: var(--on-surface-color);
          cursor: pointer; font-weight: 600;
        }
        .btn:hover { background: color-mix(in srgb, var(--on-surface-color) 10%, transparent); }
        .primary {
          background: var(--primary-color);
          color: var(--on-primary-color);
          border-color: transparent;
        }
        .primary:hover { filter: brightness(1.05); }
      </style>
      <div class="card">
        <div class="name" id="hname">host</div>
        <div class="meta" id="hip">ip</div>
        <div class="meta" id="hmac">mac</div>
        <div class="meta" id="hinfo"></div>
        <div class="actions">
          <button class="btn" id="ping">Ping</button>
          <button class="btn primary" id="register">Register</button>
        </div>
      </div>
    `
  }

  connectedCallback() {
    this.btnRegister = this.shadow.getElementById('register') as HTMLButtonElement
    this.btnPing = this.shadow.getElementById('ping') as HTMLButtonElement

    this.btnPing.onclick = async () => {
      const ok = await pingPeer(this.host.ip)
      ok ? displaySuccess(`Reachable: ${this.host.ip}`) : displayError(`Cannot reach ${this.host.ip}`)
    }

    this.btnRegister.onclick = async () => {
      // let parent handle it too (event), but also call the backend here
      this.dispatchEvent(new CustomEvent('peer:register', {
        bubbles: true, composed: true, detail: { host: this.host },
      }))
      try {
        await registerPeer({
          mac: this.host.mac,
          hostname: this.host.name,
          localIpAddress: this.host.ip
        })
        displaySuccess(`Registration sent to ${this.host.ip}`)
      } catch (e: any) {
        displayError(e?.message || 'Registration failed')
      }
    }
  }

  setHost(h: DiscoveredHost) {
    this.host = toHostSafe(h)
    ;(this.shadow.getElementById('hname') as HTMLElement).textContent = this.host.name || '(unknown)'
    ;(this.shadow.getElementById('hip') as HTMLElement).textContent = this.host.ip
    ;(this.shadow.getElementById('hmac') as HTMLElement).textContent = this.host.mac
    ;(this.shadow.getElementById('hinfo') as HTMLElement).textContent = this.host.infos || ''
  }
}
customElements.define('peer-card', PeerCard)

/** <peer-discovery> */
export class PeerDiscovery extends HTMLElement {
  private shadow!: ShadowRoot
  private list!: HTMLElement
  private btnScan!: HTMLButtonElement
  private spinner!: HTMLSpanElement

  constructor() {
    super()
    this.shadow = this.attachShadow({ mode: 'open' })
    this.shadow.innerHTML = `
      <style>
        :host { display: block; }
        .wrap {
          background: var(--surface-color);
          color: var(--on-surface-color);
          border-radius: 12px;
          padding: 1rem;
          box-shadow: 0 0 0 1px color-mix(in srgb, var(--on-surface-color) 12%, transparent);
          display: grid; gap: 1rem;
        }
        .bar { display: flex; align-items: center; gap: .75rem; }
        .title { font-weight: 800; font-size: 1.05rem; }
        .spacer { flex: 1; }
        .btn {
          padding: .5rem .75rem;
          border-radius: .6rem;
          border: 1px solid color-mix(in srgb, var(--on-surface-color) 30%, transparent);
          background: transparent;
          color: var(--on-surface-color);
          cursor: pointer; font-weight: 600;
        }
        .btn:hover { background: color-mix(in srgb, var(--on-surface-color) 10%, transparent); }
        .grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
          gap: .75rem;
        }
        .spinner {
          display: none;
          width: 16px; height: 16px; border-radius: 50%;
          border: 2px solid color-mix(in srgb, var(--on-surface-color) 30%, transparent);
          border-top-color: var(--on-surface-color);
          animation: spin .9s linear infinite;
        }
        @keyframes spin { to { transform: rotate(360deg) } }
        .empty { opacity: .7; font-size: .95rem; }
      </style>
      <div class="wrap">
        <div class="bar">
          <div class="title">Local peers</div>
          <div class="spacer"></div>
          <span class="spinner" id="spin"></span>
          <button class="btn" id="scan">Scan</button>
        </div>
        <div class="grid" id="list"></div>
        <div class="empty" id="empty" style="display:none">No peers found yet.</div>
      </div>
    `
  }

  connectedCallback() {
    this.list = this.shadow.getElementById('list') as HTMLElement
    this.btnScan = this.shadow.getElementById('scan') as HTMLButtonElement
    this.spinner = this.shadow.getElementById('spin') as HTMLSpanElement

    this.btnScan.onclick = () => this.scan()
    queueMicrotask(() => this.scan())
  }

  private setBusy(on: boolean) {
    this.btnScan.disabled = on
    this.spinner.style.display = on ? 'inline-block' : 'none'
  }

  private clearList() {
    this.list.innerHTML = ''
    ;(this.shadow.getElementById('empty') as HTMLElement).style.display = 'none'
  }

  private addCard(h: DiscoveredHost) {
    const selfIp = this.getAttribute('current-ip')
    if (selfIp && h.ip === selfIp) return
    const card = document.createElement('peer-card') as any
    card.setHost(h)
    this.list.appendChild(card)
  }

  async scan() {
    this.setBusy(true)
    this.clearList()
    try {
      const hosts = await scanPeers()
      if (!hosts.length) {
        ;(this.shadow.getElementById('empty') as HTMLElement).style.display = 'block'
      } else {
        hosts.forEach(h => this.addCard(h))
      }
    } catch (err: any) {
      displayError(err?.message || 'Scan failed')
      ;(this.shadow.getElementById('empty') as HTMLElement).style.display = 'block'
    } finally {
      this.setBusy(false)
    }
  }
}
customElements.define('peer-discovery', PeerDiscovery)
