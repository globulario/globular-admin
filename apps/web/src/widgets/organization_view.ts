// /widgets/organization_view.ts
// <globular-organization-view> — works with OrganizationVM *or* legacy proto-like organization objects

import { displayError } from "../backend/ui/notify";
import { AccountVM, getAccount } from "../backend/rbac/accounts";
import type { OrganizationVM } from "../backend/rbac/organizations";
import { GroupView } from "./group_view";                 // ensures <globular-group-view> is registered
import { getGroupById } from "../backend/rbac/groups";     // returns GroupVM | null (adjust if your API differs)
import "./user_view";                                      // ensures <globular-user-view> is registered

// Legacy proto-like shape (for backward compatibility)
type OrganizationProtoLike = {
  getId?: () => string;
  getName?: () => string;
  getDescription?: () => string;
  getIcon?: () => string;
  getEmail?: () => string;
  getDomain?: () => string;
  getAccountsList?: () => string[];
  getGroupsList?: () => string[];
} | null;

type AnyOrganization = OrganizationVM | OrganizationProtoLike | null;

const DEFAULT_ORG_ICON = "assets/icons/organization-icon-original.svg";

/** Coerce either OrganizationVM or proto-like object into a VM-like object with icon support */
function coerceOrganization(a: AnyOrganization): OrganizationVM & { icon?: string } {
  if (!a) {
    return {
      id: "",
      name: "",
      email: "",
      description: "",
      icon: DEFAULT_ORG_ICON,
      accounts: [],
      groups: [],
      domain: "",
    };
  }

  // Already looks like a VM
  if ((a as OrganizationVM).name !== undefined || (a as any).accounts) {
    const o = a as OrganizationVM & { icon?: string };
    return {
      id: o.id || "",
      name: o.name || "",
      email: o.email || "",
      description: o.description || "",
      icon: o.icon || DEFAULT_ORG_ICON,
      accounts: Array.isArray(o.accounts) ? [...o.accounts] : [],
      groups: Array.isArray(o.groups) ? [...o.groups] : [],
      domain: o.domain || "",
    };
  }

  // Proto-like (with getters)
  const p = a as OrganizationProtoLike;
  return {
    id: p?.getId?.() || "",
    name: p?.getName?.() || "",
    email: p?.getEmail?.() || "",
    description: p?.getDescription?.() || "",
    icon: p?.getIcon?.() || DEFAULT_ORG_ICON,
    accounts: p?.getAccountsList?.() || [],
    groups: p?.getGroupsList?.() || [],
    domain: p?.getDomain?.() || "",
  } as any;
}

export class OrganizationView extends HTMLElement {
  static get observedAttributes() {
    return ["closeable", "summary", "addable"];
  }

  /** Consumer hooks */
  public onClose?: () => void;
  public onAdd?: () => void;

  private root: ShadowRoot;
  private _org: (OrganizationVM & { icon?: string }) = coerceOrganization(null);

  // cached refs
  private nameEl?: HTMLSpanElement | null;
  private descEl?: HTMLSpanElement | null;
  private details?: any | null; // <iron-collapse>
  private membersCountEl?: HTMLSpanElement | null;
  private groupsCountEl?: HTMLSpanElement | null;
  private closeBtn?: HTMLElement | null;
  private addBtn?: HTMLElement | null;
  private content?: HTMLElement | null;
  private iconEl?: HTMLImageElement | null;

  constructor(organization?: AnyOrganization) {
    super();
    this.root = this.attachShadow({ mode: "open" });
    if (organization) this._org = coerceOrganization(organization);
  }

  connectedCallback() {
    this.render();
    this.applyAttributes();
    this.refresh(); // initial fill
  }

  disconnectedCallback() {
    // no global listeners by default
  }

  attributeChangedCallback(name: string, _old: string | null, val: string | null) {
    if (!this.isConnected) return;
    switch (name) {
      case "closeable":
        if (this.closeBtn) this.closeBtn.style.display = val === "true" ? "block" : "none";
        break;
      case "addable":
        if (this.addBtn) this.addBtn.style.display = val === "true" ? "block" : "none";
        break;
      case "summary":
        if (this.details) this.details.opened = val !== "true";
        break;
    }
  }

  /** Preferred: set an OrganizationVM */
  set organizationVM(o: OrganizationVM) {
    this._org = coerceOrganization(o);
    this.refresh();
  }
  get organizationVM(): OrganizationVM { return this._org; }

  /** Back-compat: accept proto-like or VM */
  setOrganization(o: AnyOrganization) {
    this._org = coerceOrganization(o);
    this.refresh();
  }

  // -------- internals --------

  private render() {
    this.root.innerHTML = `
      <style>
        @import url('./styles.css');

        :host { display:inline-block; width: 300px; }

        #content {
          background: var(--surface-color);
          color: var(--on-surface-color);
          border-radius: .75rem;
          box-shadow: 0 0 0 1px var(--divider-color);
          padding: .75rem .9rem;
          box-sizing: border-box;
        }
        #content:hover { cursor: pointer; box-shadow: 0 0 0 1px var(--primary-color); }

        /* Header */
        .header-row {
          display:grid;
          grid-template-columns: auto 1fr auto;
          gap:.6rem;
          align-items:center;
        }
        #org-icon {
          width:42px; height:42px;
          border-radius:50%;
          object-fit: cover;
          border: 1px solid var(--divider-color);
        }
        #name {
          font-size: 1rem; line-height: 1.25rem;
          text-decoration: underline;
          text-align: left;
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }

        .controls {
          display:flex; align-items:center; gap:.2rem;
        }
        #close-btn, #add-btn {
          width: 28px; height: 28px;
          --iron-icon-width: 12px; --iron-icon-height: 12px;
          display:none; /* toggled by attributes */
        }

        /* Body */
        #details { display:flex; flex-direction:column; padding: .6rem .2rem .2rem; }
        .sub { font-size: .9rem; opacity: .85; margin: .25rem 0 .6rem; }

        .section {
          display:flex; flex-direction:column; margin-top:.35rem;
        }
        .section-title {
          display:flex; align-items:center; gap:.5rem;
          font-weight: 700; font-size: .9rem;
          margin-bottom:.35rem;
        }
        .divider {
          height:1px; flex:1;
          background: color-mix(in srgb, var(--on-surface-color) 12%, transparent);
        }

        .pane {
          display:flex; flex-wrap:wrap; gap:.4rem .5rem;
          padding-top:.25rem;
        }

        /* collapse animation */
        iron-collapse { --iron-collapse-transition-duration: .2s; }
        iron-collapse[aria-hidden="true"] { max-height:0; overflow:hidden; padding:0; }

        /* compact child tiles a bit */
        .pane ::slotted(globular-user-view),
        .pane ::slotted(globular-group-view) {
          transform: scale(.9);
          transform-origin: top left;
        }
      </style>

      <div id="content">
        <div class="header-row">
          <img id="org-icon" alt="Organization Icon"/>
          <span id="name"></span>
          <div class="controls">
            <paper-icon-button id="add-btn" icon="icons:add" role="button" tabindex="0"></paper-icon-button>
            <paper-icon-button id="close-btn" icon="icons:close" role="button" tabindex="0"></paper-icon-button>
          </div>
        </div>

        <iron-collapse id="details">
          <div class="sub" id="sub-title"></div>

          <div class="section">
            <div class="section-title">
              <span id="members-count">Accounts (0)</span>
              <div class="divider"></div>
            </div>
            <div class="pane"><slot name="members"></slot></div>
          </div>

          <div class="section">
            <div class="section-title">
              <span id="groups-count">Groups (0)</span>
              <div class="divider"></div>
            </div>
            <div class="pane"><slot name="groups"></slot></div>
          </div>
        </iron-collapse>
      </div>
    `;

    // cache
    this.nameEl = this.root.getElementById("name") as HTMLSpanElement;
    this.descEl = this.root.getElementById("sub-title") as HTMLSpanElement;
    this.details = this.root.getElementById("details");
    this.membersCountEl = this.root.getElementById("members-count") as HTMLSpanElement;
    this.groupsCountEl = this.root.getElementById("groups-count") as HTMLSpanElement;
    this.closeBtn = this.root.getElementById("close-btn");
    this.addBtn = this.root.getElementById("add-btn");
    this.content = this.root.getElementById("content");
    this.iconEl = this.root.getElementById("org-icon") as HTMLImageElement;

    // listeners
    this.nameEl?.addEventListener("click", (e) => {
      e.stopPropagation();
      this.details?.toggle?.();
    });
    this.content?.addEventListener("click", () => {
      if (this._org?.id) {
        this.dispatchEvent(new CustomEvent("currentOrganizationIdChanged", { bubbles: true, detail: this._org.id }));
      }
    });
    this.closeBtn?.addEventListener("click", (e) => { e.stopPropagation(); this.onClose?.(); });
    this.addBtn?.addEventListener("click", (e) => { e.stopPropagation(); this.onAdd?.(); });
  }

  private applyAttributes() {
    this.attributeChangedCallback("closeable", null, this.getAttribute("closeable"));
    this.attributeChangedCallback("addable", null, this.getAttribute("addable"));
    this.attributeChangedCallback("summary", null, this.getAttribute("summary"));
  }

  /** Refresh header + counts + (re)load accounts & groups */
  private async refresh() {
    // header
    if (this.nameEl) this.nameEl.textContent = this._org.name || "";
    if (this.descEl) this.descEl.textContent = this._org.description || "";
    if (this.iconEl) this.iconEl.src = (this._org as any).icon || DEFAULT_ORG_ICON;

    const accIds = Array.isArray(this._org.accounts) ? this._org.accounts : [];
    const grpIds = Array.isArray(this._org.groups) ? this._org.groups : [];

    if (this.membersCountEl) this.membersCountEl.textContent = `Accounts (${accIds.length})`;
    if (this.groupsCountEl) this.groupsCountEl.textContent = `Groups (${grpIds.length})`;

    // clear old dynamic children
    this.querySelectorAll('globular-user-view[slot="members"]').forEach(el => el.remove());
    this.querySelectorAll('globular-group-view[slot="groups"]').forEach(el => el.remove());

    // add member accounts
    for (const accountId of accIds) {
      try {
        const acc: AccountVM | null = await getAccount(accountId);
        const el = document.createElement("globular-user-view") as any;
        if (acc) el.accountVM = acc;
        else el.accountVM = { id: accountId, name: accountId, username: accountId };
        el.slot = "members";
        el.setAttribute("summary", "true");
        this.appendChild(el);
      } catch (err: any) {
        console.warn(`Failed to load account ${accountId}:`, err?.message || err);
        displayError(err?.message || `Failed to load account ${accountId}`);
      }
    }

    // add groups
    for (const gid of grpIds) {
      try {
        const g = await getGroupById(gid); // GroupVM | null
        if (!g) continue;
        const gv = new GroupView(g as any);
        gv.slot = "groups";
        gv.setAttribute("summary", "true");
        this.appendChild(gv);
      } catch (err: any) {
        console.warn(`Failed to load group ${gid}:`, err?.message || err);
        displayError(err?.message || `Failed to load group ${gid}`);
      }
    }
  }
}

customElements.define("globular-organization-view", OrganizationView);
