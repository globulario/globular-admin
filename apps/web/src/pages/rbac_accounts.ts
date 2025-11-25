// src/pages/rbac_accounts.ts
import '../widgets/users_manager'          // <globular-users-manager>
import '../components/markdown'            // optional, if you still want the info panel
import '@polymer/iron-icons/iron-icons.js'
import '@polymer/paper-icon-button/paper-icon-button.js'
import '@polymer/iron-collapse/iron-collapse.js'

class PageRbacAccounts extends HTMLElement {
  private infoBtn!: HTMLElement
  private infoPanel!: any
  private content!: HTMLElement

  connectedCallback() {
    this.style.display = 'block';
    this.innerHTML = `
      <section class="page">
        <div class="header">
          <h2>Accounts management</h2>
          <div class="spacer"></div>
          <paper-icon-button id="infoBtn" icon="icons:help-outline" title="Page help"></paper-icon-button>
        </div>

        <iron-collapse id="infoPanel" class="info">
          <globular-markdown
            style="
              --content-bg-color: var(--surface-color);
              --content-text-color: var(--on-surface-color);
              --md-code-bg: color-mix(in srgb, var(--on-surface-color) 6%, var(--surface-color));
              --md-code-fg: var(--on-surface-color);
              --divider-color: color-mix(in srgb, var(--on-surface-color) 12%, transparent);
            "
          >
RBAC Accounts

Use this page to **create**, **update**, and **delete** accounts used to access Globular services.

- **Add account** — username, display name, email, optional roles & domain.
- **Edit inline** — click a row to open the editor below the table.
- **Avatar** — click “Set URL…” to set the profile picture.

> Changes are applied through the new backend API.
          </globular-markdown>
        </iron-collapse>

        <div class="card">
          <div id="content"></div>
        </div>
      </section>
    `;

    this.infoBtn = this.querySelector('#infoBtn') as HTMLElement
    this.infoPanel = this.querySelector('#infoPanel') as any
    this.content = this.querySelector('#content') as HTMLElement

    this.infoBtn.addEventListener('click', () => this.infoPanel.toggle())

    // Just mount the widget
    const mgr = document.createElement('globular-users-manager')
    this.content.appendChild(mgr)
  }
}

customElements.define('page-rbac-accounts', PageRbacAccounts)
