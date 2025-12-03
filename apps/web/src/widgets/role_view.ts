// role_view.ts
// Refactored to mirror group_view.ts patterns: no Polymer deps, native <details>, clean attrs handling.

import "./styles.css"; // keeps the same token variables used by group_view.ts

// Minimal interfaces to avoid tight coupling (adjust if you already have types)
type Role = {
  getId(): string
  getName(): string
  getDescription(): string
  getMembersList(): string[]
  getOrganizationsList(): string[]
}

// External helpers you already use elsewhere
declare function getUserById(id: string): Promise<any>
declare function getOrganizationById(id: string): Promise<any>
declare class UserView extends HTMLElement { constructor(user: any) }
declare class OrganizationView extends HTMLElement { constructor(org: any) }

// Utility: simple inline icons (keeps bundle tiny)
const XIcon = `
<svg viewBox="0 0 24 24" aria-hidden="true" width="16" height="16">
  <path fill="currentColor" d="M18.3 5.71a1 1 0 0 0-1.41 0L12 10.59 7.11 5.7A1 1 0 0 0 5.7 7.11L10.59 12 5.7 16.89a1 1 0 1 0 1.41 1.41L12 13.41l4.89 4.89a1 1 0 0 0 1.41-1.41L13.41 12l4.89-4.89a1 1 0 0 0 0-1.4Z"/>
</svg>
`;

const PlusIcon = `
<svg viewBox="0 0 24 24" aria-hidden="true" width="16" height="16">
  <path fill="currentColor" d="M11 5a1 1 0 0 1 2 0v6h6a1 1 0 1 1 0 2h-6v6a1 1 0 1 1-2 0v-6H5a1 1 0 1 1 0-2h6V5Z"/>
</svg>
`;

export class RoleView extends HTMLElement {
  static get observedAttributes() {
    return ["closeable", "addable", "summary"];
  }

  // Public hooks (optional): set these from parent if needed
  onClose?: () => void;
  onAdd?: () => void;

  // Internal state
  private shadow!: ShadowRoot;
  private _role!: Role;

  // Refs
  private elContent!: HTMLElement;
  private elTitle!: HTMLSpanElement;
  private elSubTitle!: HTMLDivElement;
  private elMembersCount!: HTMLSpanElement;
  private elOrgsCount!: HTMLSpanElement;
  private elDetails!: HTMLDetailsElement;
  private btnClose!: HTMLButtonElement;
  private btnAdd!: HTMLButtonElement;

  // Event handler bound once for removeEventListener symmetry
  private handleExternalRefresh = async () => {
    try {
      // Reuse your existing get-by-id flow
      // (the original code used getRoleById which returns an array; mirror that if needed)
      const id = this._role.getId();
      const evt = new CustomEvent("role:fetch", {
        bubbles: true,
        composed: true,
        detail: { id, apply: (fresh: Role) => this.setRole(fresh) }
      });
      this.dispatchEvent(evt);
      // If no external handler replaces the role, the component stays as-is.
      // Consumers can listen for "role:fetch" on a parent and call detail.apply(freshRole).
    } catch (err: any) {
      console.warn("RoleView refresh failed:", err?.message || err);
    }
  };

  constructor(r?: Role) {
    super();
    this.shadow = this.attachShadow({ mode: "open" });
    if (r) this._role = r;

    this.shadow.innerHTML = `
      <style>
        @import url('./styles.css');

        :host { display: block; }

        #content {
          display:flex; flex-direction:column;
          background: var(--surface-color); color: var(--on-surface-color);
          padding: 1rem; border-radius: .5rem;
          box-shadow: 0 0 0 1px var(--divider-color, color-mix(in oklab, currentColor 15%, transparent));
        }
        #content:hover { cursor: pointer; }

        .header-row {
          display:flex; align-items:center; gap:.5rem; width:100%;
        }
        .spacer { flex:1 1 auto; }

        .icon-btn {
          appearance: none; border: 0; background: transparent;
          width: 30px; height: 30px; border-radius: .5rem;
          display:grid; place-items:center;
          color: var(--on-surface-variant-color, currentColor);
        }
        .icon-btn:hover { background: color-mix(in oklab, var(--on-surface-color) 8%, transparent); }
        .icon-btn:focus-visible { outline: 2px solid var(--primary-color); outline-offset: 2px; }

        #title {
          font-size: 1rem; line-height:1.5rem;
          text-decoration: underline; text-align: center;
          padding-inline: .5rem;
        }
        #sub-title {
          font-size: .9rem; opacity:.9; text-align:center;
          padding: .25rem .5rem .5rem .5rem;
        }

        details {
          margin-top: .25rem;
          transition: all .25s ease;
          overflow: clip;
          border-radius: .5rem;
        }

        .section { display:flex; flex-direction:column; padding:.5rem; gap:.25rem; }
        .label { font-weight: 600; opacity:.9; }

        .pill-row { display:flex; flex-wrap:wrap; gap:.5rem; }

        /* Slot containers (we append children with slot attr) */
        .members, .organizations { display:flex; flex-wrap:wrap; gap:.5rem; }
      </style>

      <div id="content" part="card">
        <div class="header-row">
          <button id="close-btn" class="icon-btn" title="Close" aria-label="Close" hidden>${XIcon}</button>
          <button id="add-btn" class="icon-btn" title="Add" aria-label="Add" hidden>${PlusIcon}</button>
          <span id="title"></span>
          <div class="spacer"></div>
        </div>

        <details id="details">
          <summary role="button" aria-expanded="false" style="list-style:none;">
            <div id="sub-title"></div>
          </summary>

          <div class="section">
            <span id="members-count" class="label"></span>
            <div class="members">
              <slot name="members"></slot>
            </div>
          </div>

          <div class="section">
            <span id="organizations-count" class="label"></span>
            <div class="organizations">
              <slot name="organizations"></slot>
            </div>
          </div>
        </details>
      </div>
    `;
  }

  // ---------- Lifecycle ----------
  connectedCallback() {
    // Bind refs
    this.elContent = this.shadow.getElementById("content") as HTMLElement;
    this.elTitle = this.shadow.getElementById("title") as HTMLSpanElement;
    this.elSubTitle = this.shadow.getElementById("sub-title") as HTMLDivElement;
    this.elMembersCount = this.shadow.getElementById("members-count") as HTMLSpanElement;
    this.elOrgsCount = this.shadow.getElementById("organizations-count") as HTMLSpanElement;
    this.elDetails = this.shadow.getElementById("details") as HTMLDetailsElement;
    this.btnClose = this.shadow.getElementById("close-btn") as HTMLButtonElement;
    this.btnAdd = this.shadow.getElementById("add-btn") as HTMLButtonElement;

    // Attribute → UI init
    this.syncAttr("closeable", this.getAttribute("closeable"));
    this.syncAttr("addable", this.getAttribute("addable"));
    this.syncAttr("summary", this.getAttribute("summary"));

    // Interactions
    this.elContent.addEventListener("click", this.handleSelect);
    this.elDetails.addEventListener("toggle", this.syncSummaryAria);

    // Role-scoped refresh (mirror group pattern: refresh_<id>)
    if (this._role?.getId) {
      document.addEventListener(`refresh_${this._role.getId()}`, this.handleExternalRefresh);
    }

    // Initial render
    this.refresh();
  }

  disconnectedCallback() {
    this.elContent?.removeEventListener("click", this.handleSelect);
    this.elDetails?.removeEventListener("toggle", this.syncSummaryAria);

    if (this._role?.getId) {
      document.removeEventListener(`refresh_${this._role.getId()}`, this.handleExternalRefresh);
    }
  }

  // ---------- Attributes ----------
  attributeChangedCallback(name: string, _old: string | null, value: string | null) {
    this.syncAttr(name, value);
  }

  private syncAttr(name: string, value: string | null) {
    if (!this.shadowRoot) return;

    if (name === "closeable") {
      const on = value === "true";
      this.btnClose.hidden = !on;
      this.btnClose.onclick = on ? this.handleClose : null;
    }

    if (name === "addable") {
      const on = value === "true";
      this.btnAdd.hidden = !on;
      this.btnAdd.onclick = on ? this.handleAdd : null;
    }

    if (name === "summary") {
      // summary="true" → keep collapsed (like group_view)
      const collapsed = value === "true";
      // only set if it actually differs to avoid double toggle events
      if (!!this.elDetails?.open === collapsed) {
        this.elDetails.open = !collapsed;
        this.syncSummaryAria();
      }
    }
  }

  // ---------- Public API ----------
  setRole(role: Role) {
    this._role = role;
    this.refresh();
  }

  // ---------- Render ----------
  private refresh() {
    if (!this._role) return;

    // Clear previously appended children in the light DOM for both slots
    this.querySelectorAll('[slot="members"]').forEach(n => n.remove());
    this.querySelectorAll('[slot="organizations"]').forEach(n => n.remove());

    // Header + sub header
    this.elTitle.textContent = this._role.getName() || "";
    this.elSubTitle.textContent = this._role.getDescription() || "";

    const members = this._role.getMembersList() || [];
    const orgs = this._role.getOrganizationsList() || [];
    this.elMembersCount.textContent = `Members (${members.length})`;
    this.elOrgsCount.textContent = `Organizations (${orgs.length})`;

    // Populate members
    members.forEach(async (memberId) => {
      try {
        const user = await getUserById(memberId);
        const view = new UserView(user);
        view.id = `${memberId}_view`;
        (view as any).slot = "members";
        this.appendChild(view);
      } catch (err: any) {
        console.warn(`RoleView: failed to load member ${memberId}: ${err?.message || err}`);
      }
    });

    // Populate organizations
    orgs.forEach(async (orgId) => {
      try {
        const org = await getOrganizationById(orgId);
        const view = new OrganizationView(org);
        view.id = `${orgId}_view`;
        (view as any).slot = "organizations";
        view.setAttribute("summary", "true");
        this.appendChild(view);
      } catch (err: any) {
        console.warn(`RoleView: failed to load org ${orgId}: ${err?.message || err}`);
      }
    });
  }

  // ---------- Handlers ----------
  private handleSelect = (e: Event) => {
    // Don’t fire when clicking the summary toggle itself
    // (clicking inside the details header triggers toggle)
    const path = e.composedPath() as Element[];
    const clickedSummary = path.some(el => el instanceof HTMLElement && el.tagName === "SUMMARY");
    if (clickedSummary) return;

    if (this._role?.getId) {
      // Mirror group_view interop: a focused “current” broadcast
      document.dispatchEvent(new CustomEvent("currentRoleIdChanged", {
        detail: this._role.getId()
      }));

      // Also fire a semantic event scoped to this component
      this.dispatchEvent(new CustomEvent("role:select", {
        bubbles: true,
        composed: true,
        detail: { id: this._role.getId() }
      }));
    }
  };

  private handleClose = (evt: MouseEvent) => {
    evt.stopPropagation();
    this.onClose?.();
  };

  private handleAdd = (evt: MouseEvent) => {
    evt.stopPropagation();
    this.onAdd?.();
  };

  private syncSummaryAria = () => {
    const summary = this.elDetails.querySelector("summary");
    if (summary) summary.setAttribute("aria-expanded", String(this.elDetails.open));
  };
}

customElements.define("globular-role-view", RoleView);