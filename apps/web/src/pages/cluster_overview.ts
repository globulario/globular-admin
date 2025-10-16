// src/pages/cluster_overview.ts
import '../widgets/network_config'
import '../components/markdown.js'                  // registers <globular-markdown>
import '@polymer/iron-icons/iron-icons.js'
import '@polymer/paper-icon-button/paper-icon-button.js'

class PageClusterOverview extends HTMLElement {
  private infoBtn!: HTMLElement
  private docsBox!: HTMLDivElement

  connectedCallback() {
    this.style.display = 'block'
    this.innerHTML = `
      <section class="wrap">
        <header class="header">
          <h2>Cluster Overview</h2>
          <div class="spacer"></div>
          <paper-icon-button id="infoBtn" icon="icons:info-outline" title="Page info"></paper-icon-button>
        </header>

        <p class="subtitle">Peers, CPU/RAM, storage, service health.</p>

        <network-config></network-config>

        <div id="docs" class="docs" hidden></div>
      </section>

      <style>
        .wrap { padding:16px; color:var(--on-surface-color); background:var(--background-color); }
        .header { display:flex; align-items:center; gap:.5rem; margin-bottom:.5rem; }
        .header h2 { margin:0; font-weight:800; }
        .subtitle { margin:.25rem 0 1rem; opacity:.85; }
        .spacer { flex:1; }

        .docs {
          margin-top: 12px;
          border-radius: 12px;
          background: var(--surface-color);
          color: var(--on-surface-color);
          box-shadow: 0 0 0 1px color-mix(in srgb, var(--on-surface-color) 12%, transparent);
          padding: 0;
        }
        .docs[hidden]{ display:none; }
      </style>
    `
    this.infoBtn = this.querySelector('#infoBtn') as HTMLElement
    this.docsBox = this.querySelector('#docs') as HTMLDivElement
    this.infoBtn.addEventListener('click', () => this.toggleDocs())
    this.renderDocs()
  }

  private toggleDocs() {
    if (this.docsBox.hasAttribute('hidden')) this.docsBox.removeAttribute('hidden')
    else this.docsBox.setAttribute('hidden', '')
  }

  private renderDocs() {
    this.docsBox.innerHTML = ''
    const md = document.createElement('globular-markdown') as HTMLElement
    md.textContent = `
# Cluster Overview

This page lets you review **basic cluster health** and edit **network configuration** of the current node.

## Network configuration

- **Hostname** — human-friendly name for this node.
- **DNS servers** — comma-separated list (e.g. \`1.1.1.1, 8.8.8.8\`).
- **Interfaces** — list of NICs with MAC, MTU, and assigned IPv4/IPv6 addresses.

> Saving changes may require elevated privileges and can briefly disrupt connectivity.

\`\`\`bash
# Example (placeholder): show network on the node
globular admin network info
\`\`\`

## Notes

- Interface management (adding/removing IPs, changing MTU) can be added later.
- This UI talks to the backend via gRPC-web through your Admin service, same as the Peers page.
`.trim()
    this.docsBox.appendChild(md)
  }
}

customElements.define('page-cluster-overview', PageClusterOverview)
