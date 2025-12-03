// src/pages/rbac_groups.ts
import "../widgets/groups_manager";          // <globular-groups-manager>
import "@globular/components/markdown.js";             // optional info panel
import "@polymer/iron-icons/iron-icons.js";
import "@polymer/paper-icon-button/paper-icon-button.js";
import "@polymer/iron-collapse/iron-collapse.js";

class PageRbacGroups extends HTMLElement {
  private infoBtn!: HTMLElement;
  private infoPanel!: any;
  private content!: HTMLElement;

  connectedCallback() {
    this.style.display = 'block';
    this.innerHTML = `
      <section class="page">
        <div class="header">
          <h2>Groups management</h2>
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
RBAC Groups

Use this page to **create**, **update**, and **delete** groups, and manage **membership**.

- **Add group** — set a name and description; you can stage members before saving.
- **Search** — filter by name or description from the toolbar search box.
- **Edit** — click a card to open the editor on the right.
- **Members** — click the “person-add” icon to open potential members.  
  - If the group isn't saved yet, selected members are **staged** and will be created with the group.
  - For existing groups, add/remove applies **immediately**.

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

    // Mount the groups manager widget
    const mgr = document.createElement("globular-groups-manager");
    this.content.appendChild(mgr);
  }
}

customElements.define("page-rbac-groups", PageRbacGroups);