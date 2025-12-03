// src/pages/rbac_roles.ts
import "../widgets/roles_manager";          // <globular-roles-manager>
import "@globular/components/markdown.js";            // optional info panel
import "@polymer/iron-icons/iron-icons.js";
import "@polymer/paper-icon-button/paper-icon-button.js";
import "@polymer/iron-collapse/iron-collapse.js";

class PageRbacRoles extends HTMLElement {
  private infoBtn!: HTMLElement;
  private infoPanel!: any;
  private content!: HTMLElement;

  connectedCallback() {
    this.style.display = 'block';
    this.innerHTML = `
      <section class="page">
        <div class="header">
          <h2>Roles management</h2>
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
RBAC Roles

Use this page to **create**, **update**, and **delete** roles, and manage **accounts**, **organizations**, and **actions**.

- **Add role** — give it a name/description; you can stage members, organizations, and actions before saving.
- **Edit** — click a row to open the inline editor.
- **Members (Accounts)** — add/remove accounts from the role.
- **Organizations** — associate organizations to the role.
- **Actions** — assign allowed RPC actions to the role. Potential actions are listed from the Services Manager.

> All operations use the same refreshed-token backend RPC helpers as other RBAC pages.
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

    // Mount the roles manager widget
    const mgr = document.createElement("globular-roles-manager");
    this.content.appendChild(mgr);
  }
}

customElements.define("page-rbac-roles", PageRbacRoles);