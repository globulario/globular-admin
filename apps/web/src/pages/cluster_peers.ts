// src/pages/cluster_peers.ts
import '../widgets/peer_discovery'            // registers <peer-discovery>
import "@globular/components/markdown.js";                  // registers <globular-markdown>
import '@polymer/iron-icons/iron-icons.js'
import '@polymer/paper-icon-button/paper-icon-button.js'

class PageClusterPeers extends HTMLElement {
  private infoBtn!: HTMLElement
  private docsBox!: HTMLDivElement

  connectedCallback(): void {
    this.style.display = 'block'
    this.innerHTML = `
      <section class="wrap">
        <header class="header">
          <h2>Cluster Peers</h2>
          <div class="spacer"></div>
          <paper-icon-button id="infoBtn" icon="icons:info-outline" title="Page info"></paper-icon-button>
        </header>

        <p class="subtitle">Discover peers/nodes on your local network and register them to this node.</p>

        <peer-discovery current-ip=""></peer-discovery>

        <!-- Docs panel (hidden by default) -->
        <div id="docs" class="docs" hidden></div>
      </section>

    `

    this.infoBtn = this.querySelector('#infoBtn') as HTMLElement
    this.docsBox = this.querySelector('#docs') as HTMLDivElement

    this.infoBtn.addEventListener('click', () => this.toggleDocs())
    this.renderDocs()
  }

  private toggleDocs(): void {
    if (this.docsBox.hasAttribute('hidden')) {
      this.docsBox.removeAttribute('hidden')
    } else {
      this.docsBox.setAttribute('hidden', '')
    }
  }

  private renderDocs(): void {
    // reset container
    this.docsBox.innerHTML = ''

    const md = document.createElement('globular-markdown') as HTMLElement

    // Optional per-instance overrides (keeps theme by default)
    // md.setAttribute('content-bg', 'var(--surface-color)')
    // md.setAttribute('code-bg', 'color-mix(in srgb, var(--on-surface-color) 6%, var(--surface-color))')

    const text = `
# Cluster Peers

Use this page to **discover** and **register** peer nodes on your local network.

## How it works

- **Scan** searches the LAN using the backend Admin service (no master; every node is equal).
- Each discovered host appears as a card with:
  - **Ping** — quick reachability check.
  - **Register** — initiates a backend action to trust/join the peer (implementation-specific).

## Tips

- Ensure your browser can reach peers (same subnet or routes in place).
- For accurate results on Wi-Fi, keep client isolation turned off.

\`\`\`bash
# Example admin CLI (placeholder)
globular peers scan --local
\`\`\`

> Admin permissions may be required to register a peer.
`.trim()

    md.textContent = text
    this.docsBox.appendChild(md)
  }
}

customElements.define('page-cluster-peers', PageClusterPeers)