// src/widgets/peer_discovery.ts
//
// Peer discovery backend was removed. This stub keeps the custom element
// registered so existing HTML that references <peer-discovery> does not
// break, but the scan button simply reports "not available".


/** <peer-card> – stub */
class PeerCard extends HTMLElement {}
customElements.define('peer-card', PeerCard)

/** <peer-discovery> – stub */
export class PeerDiscovery extends HTMLElement {
  private shadow!: ShadowRoot

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
        }
        .title { font-weight: 800; font-size: 1.05rem; margin-bottom: .5rem; }
        .msg   { opacity: .7; font-size: .95rem; }
      </style>
      <div class="wrap">
        <div class="title">Local peers</div>
        <div class="msg">Peer discovery is not available in this version.</div>
      </div>
    `
  }
}
customElements.define('peer-discovery', PeerDiscovery)
