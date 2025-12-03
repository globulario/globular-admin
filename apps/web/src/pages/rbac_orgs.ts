// src/pages/rbac_organizations.ts
import "../widgets/organizations_manager";   // <globular-organizations-manager>
import "@globular/components/markdown.js";             // optional info panel
import "@polymer/iron-icons/iron-icons.js";
import "@polymer/paper-icon-button/paper-icon-button.js";
import "@polymer/iron-collapse/iron-collapse.js";

class PageRbacOrganizations extends HTMLElement {
  private infoBtn!: HTMLElement;
  private infoPanel!: any;
  private content!: HTMLElement;

  connectedCallback() {
    this.style.display = 'block';
    this.innerHTML = `
      <section class="page">
        <div class="header">
          <h2>Organizations management</h2>
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
RBAC Organizations

Use this page to **create**, **update**, and **delete** organizations.  
You can also manage membership by adding/removing **accounts** and **groups**.

- **Add organization** — set name, email, description, and icon.  
- **Edit inline** — click a row to open the editor below the table.  
- **Icon** — click the icon to pick a new image.

> All operations use the refreshed-token backend RPC helpers.
          </globular-markdown>
        </iron-collapse>

        <div class="card">
          <div id="content"></div>
        </div>
      </section>
    `;

    this.infoBtn = this.querySelector("#infoBtn") as HTMLElement;
    this.infoPanel = this.querySelector("#infoPanel") as any;
    this.content = this.querySelector("#content") as HTMLElement;

    this.infoBtn.addEventListener("click", () => this.infoPanel.toggle());

    // Mount the organizations manager widget
    const mgr = document.createElement("globular-organizations-manager");
    this.content.appendChild(mgr);
  }
}

customElements.define("page-rbac-organizations", PageRbacOrganizations);