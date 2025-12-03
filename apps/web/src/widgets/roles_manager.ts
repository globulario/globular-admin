// /widgets/roles_manager.ts
import {
  listRoles,
  createRole,
  updateRole,
  deleteRole,
  addRoleToAccount,
  removeRoleFromAccount,
  addRoleToOrganization,
  removeRoleFromOrganization,
  addRoleActions,
  removeRoleAction,
  getRoleById,
  displayError,
  displayQuestion,
  displaySuccess,
  listAccounts,
  listOrganizations as listOrgs,
  listActions,
  RoleVM as Role,
  AccountVM,
  OrganizationVM as Organization,
} from "@globular/backend";

import "@polymer/iron-icons/iron-icons.js";
import "@polymer/paper-icon-button/paper-icon-button.js";
import "@polymer/iron-collapse/iron-collapse.js";

import "@globular/components/table.js";         // <globular-table>
import "./action_view";      // <globular-action-view>

import { UserView } from "./user_view.js"; // <globular-user-view>

import { OrganizationView } from "./organization_view"; // <globular-organization-view>


/* ---------- table row ---------- */
type TableRow = {
  _index?: number;
  _visible?: boolean;
  displayRoleId?: string;
  name: string;
  domain?: string;
  id?: string;
  description?: string;
};

declare global { interface Window { displayRoleId?: (row: TableRow) => string } }
window.displayRoleId = (row: TableRow) => {
  const id = row.id || "(unknown)";
  const domain = row.domain ? `@${row.domain}` : "";
  return `
    <div class="role-selector" style="display:flex; align-items:center;">
      <span style="font-weight:700; margin-right:.5rem; text-decoration: underline;">${id}</span>
      <span style="opacity:.75;">${domain}</span>
    </div>
  `;
};

/* ============================================================
   Inline editor with staged membership changes (accounts, orgs, actions)
   ============================================================ */
class RoleInlineEditor extends HTMLElement {
  private shadow!: ShadowRoot;
  private _role: Role | null = null;
  private isReady = false;

  // UI refs
  private nameInput?: HTMLInputElement;
  private descInput?: HTMLInputElement;
  private domainInput?: HTMLInputElement;
  private saveBtn?: HTMLButtonElement;
  private cancelBtn?: HTMLButtonElement;
  private deleteBtn?: HTMLButtonElement;

  // panes
  private membersPane?: HTMLElement;
  private potentialMembersPane?: HTMLElement;
  private orgsPane?: HTMLElement;
  private potentialOrgsPane?: HTMLElement;
  private actionsPane?: HTMLElement;
  private potentialActionsPane?: HTMLElement;

  // data caches
  private allAccounts: AccountVM[] = [];
  private allOrgs: Organization[] = [];
  private allActions: string[] = [];

  // staging
  private stagedAccAdds = new Set<string>();
  private stagedAccRems = new Set<string>();
  private stagedOrgAdds = new Set<string>();
  private stagedOrgRems = new Set<string>();
  private stagedActAdds = new Set<string>();
  private stagedActRems = new Set<string>();

  constructor() {
    super();
    this.shadow = this.attachShadow({ mode: "open" });
  }

  connectedCallback() {
    this.shadow.innerHTML = `
      <style>
        :host { display:block; }
        .card {
          background: var(--surface-color);
          color: var(--on-surface-color);
          border-radius: .5rem;
          box-shadow: 0 0 0 1px var(--divider-color);
          padding: 1rem 1.25rem;
          margin-top: 12px;
        }
        .row { display:flex; gap:10px; align-items:center; margin: 8px 0; }
        label { width: 140px; font: 500 14px/25px Roboto,sans-serif; }
        input[type="text"] {
          flex: 1; border: none; border-bottom: 1px solid var(--divider-color);
          background: var(--surface-color); color: var(--on-surface-color); padding: 6px 4px;
        }
        input:focus { outline: none; border-bottom: 1px solid var(--primary-color); }
        .actions { display:flex; gap:.5rem; margin-top: 12px; }
        .spacer { flex: 1; }

        .block { margin-top: 12px; }
        .block h4 { margin: 0 0 .5rem 0; font-size: .95rem; }
        .lists { display:grid; grid-template-columns: 1fr 1fr; gap: 12px; }
        .pane {
          display:flex; gap:8px; flex-wrap: wrap;
          border: 1px solid var(--divider-color);
          border-radius: 6px; min-height: 140px; padding: .5rem; overflow:auto;
          max-height: 450px;
          overflow-x: hidden;
        }
        .hint { opacity: .7; font-size: .85rem; }
        .inline-btn { padding: 6px 10px; border: 1px solid var(--divider-color); background: transparent; color: var(--on-surface-color); border-radius: 8px; cursor: pointer; }
        .inline-btn:hover { border-color: var(--primary-color); }
        .link-btn {
          border: none; background: transparent; color: var(--primary-color);
          cursor: pointer; font: 500 13px/20px Roboto, sans-serif; padding: 0 4px;
        }

        /* Firefox */
        .pane {
          scrollbar-width: thin;
          scrollbar-color: var(--scroll-thumb) var(--scroll-track);
        }

        /* Chromium/WebKit */
        .pane::-webkit-scrollbar {
          width: 10px;
          height: 10px;
        }
        .pane::-webkit-scrollbar-track {
          background: var(--scroll-track);
        }
        .pane::-webkit-scrollbar-thumb {
          background-color: var(--scroll-thumb);
          border-radius: 6px;
          border: 2px solid var(--scroll-track);
        }
        .pane::-webkit-scrollbar-thumb:hover {
          background-color: var(--scroll-thumb-hover);
        }
      </style>

      <div class="card">
        <!-- Basics -->
        <div class="row"><label>Name</label><input id="name" type="text" required minlength="3" /></div>
        <div class="row"><label>Domain</label><input id="domain" type="text" /></div>
        <div class="row"><label>Description</label><input id="desc" type="text" /></div>

        <!-- Accounts -->
        <div class="block">
          <h4>Members (Accounts)</h4>
          <div class="lists">
            <div>
              <div class="hint">In role</div>
              <div class="pane" id="members-pane"><slot name="members"></slot></div>
            </div>
            <div>
              <div class="hint">Potential Members</div>
              <div class="pane" id="potential-members"><slot name="potential-members"></slot></div>
            </div>
          </div>
        </div>

        <!-- Organizations -->
        <div class="block">
          <h4>Organizations</h4>
          <div class="lists">
            <div>
              <div class="hint">In role</div>
              <div class="pane" id="orgs-pane"><slot name="organizations"></slot></div>
            </div>
            <div>
              <div class="hint">Potential Organizations</div>
              <div class="pane" id="potential-orgs"><slot name="potential-organizations"></slot></div>
            </div>
          </div>
        </div>

        <!-- Actions -->
        <div class="block">
          <h4>Actions</h4>
          <div class="lists">
            <div>
              <div class="hint">In role</div>
              <div class="pane" id="actions-pane"><slot name="actions"></slot></div>
            </div>
            <div>
              <div class="hint">Potential Actions</div>
              <div class="pane" id="potential-actions"><slot name="potential-actions"></slot></div>
            </div>
          </div>
        </div>

        <!-- Footer -->
        <div class="actions">
          <button id="delete" class="inline-btn">Delete</button>
          <span class="spacer"></span>
          <button id="save" class="inline-btn">Save</button>
          <button id="cancel" class="inline-btn">Cancel</button>
        </div>
      </div>
    `;

    // bind basics
    this.nameInput = this.shadow.getElementById("name") as HTMLInputElement;
    this.descInput = this.shadow.getElementById("desc") as HTMLInputElement;
    this.domainInput = this.shadow.getElementById("domain") as HTMLInputElement;
    this.saveBtn = this.shadow.getElementById("save") as HTMLButtonElement;
    this.cancelBtn = this.shadow.getElementById("cancel") as HTMLButtonElement;
    this.deleteBtn = this.shadow.getElementById("delete") as HTMLButtonElement;

    this.membersPane = this.shadow.getElementById("members-pane") as HTMLElement;
    this.potentialMembersPane = this.shadow.getElementById("potential-members") as HTMLElement;
    this.orgsPane = this.shadow.getElementById("orgs-pane") as HTMLElement;
    this.potentialOrgsPane = this.shadow.getElementById("potential-orgs") as HTMLElement;
    this.actionsPane = this.shadow.getElementById("actions-pane") as HTMLElement;
    this.potentialActionsPane = this.shadow.getElementById("potential-actions") as HTMLElement;

    this.isReady = true;
    if (this._role) this._apply(this._role);

    // actions
    this.cancelBtn.onclick = () => this.dispatchEvent(new CustomEvent("edit-cancelled", { bubbles: true }));

    this.deleteBtn.onclick = async () => {
      if (!this._role?.id) return;
      const toast = displayQuestion(
        `<span>Delete role <b>${this._role.name}</b>?</span>
         <div style="display:flex; gap:.5rem; justify-content:center; margin-top:1rem;">
           <paper-button id="yes-btn">Yes</paper-button>
           <paper-button id="no-btn">No</paper-button>
         </div>`
      );
      toast.toastElement?.querySelector("#no-btn")?.addEventListener("click", () => toast.toastElement?.remove());
      toast.toastElement?.querySelector("#yes-btn")?.addEventListener("click", async () => {
        toast.toastElement?.remove();
        try {
          await deleteRole(this._role!.id);
          displaySuccess("Role deleted.");
          this.dispatchEvent(new CustomEvent("role-deleted", { bubbles: true, detail: this._role }));
        } catch (e: any) {
          console.error(e);
          displayError(e?.message || "Failed to delete role");
        }
      });
    };

    this.saveBtn.onclick = () => this._save();
  }

  setRole(r: Role | null) {
    this._role = r;
    if (this.isReady) this._apply(r);
  }

  private async _apply(r: Role | null) {
    // reset staging
    this.stagedAccAdds.clear(); this.stagedAccRems.clear();
    this.stagedOrgAdds.clear(); this.stagedOrgRems.clear();
    this.stagedActAdds.clear(); this.stagedActRems.clear();

    const role = r ?? ({} as Role);
    // basics
    if (this.nameInput) this.nameInput.value = role.name || "";
    if (this.domainInput) this.domainInput.value = role.domain || "";
    if (this.descInput) this.descInput.value = role.description || "";
    if (this.deleteBtn) this.deleteBtn.style.display = role.id ? "inline-block" : "none";

    // hydrate caches then render panes
    await Promise.all([
      (async () => { this.allAccounts = await listAccounts(); })(),
      (async () => { this.allOrgs = await listOrgs({}); })(),
      (async () => { this.allActions = await listActions(); })(),
    ]);

    await this._renderMembersPanes();
    await this._renderOrganizationsPanes();
    await this._renderActionsPanes();
  }

  /* ------------------------- Accounts panes ------------------------- */
  private async _renderMembersPanes() {
    this.querySelectorAll('globular-user-view[slot="members"]').forEach(el => el.remove());
    this.querySelectorAll('globular-user-view[slot="potential-members"]').forEach(el => el.remove());

    const base = new Set<string>(this._role?.members || this._role?.members || []);
    for (const id of this.stagedAccAdds) base.add(id);
    for (const id of this.stagedAccRems) base.delete(id);

    // members
    for (const id of base) {
      const acc = this.allAccounts.find(a => a.id === id);
      if (!acc) continue;
      const v = new UserView();
      v.accountVM = acc;
      v.slot = "members";
      v.setAttribute("summary", "true");
      v.setAttribute("closeable", "true");
      (v as any).onClose = () => {
        if ((this._role?.members || this._role?.members || []).includes(id)) this.stagedAccRems.add(id);
        this.stagedAccAdds.delete(id);
        this._renderMembersPanes();
      };
      this.appendChild(v);
    }

    // potential
    for (const acc of this.allAccounts) {
      if (base.has(acc.id)) continue;
      const v = new UserView();
      v.accountVM = acc;
      v.slot = "potential-members";
      v.setAttribute("summary", "true");
      v.setAttribute("closeable", "false");
      v.addEventListener("click", () => {
        if (!((this._role?.members || this._role?.members || []).includes(acc.id))) this.stagedAccAdds.add(acc.id);
        this.stagedAccRems.delete(acc.id);
        this._renderMembersPanes();
      });
      this.appendChild(v);
    }
  }

  /* ------------------------- Organizations panes ------------------------- */
  private async _renderOrganizationsPanes() {
    this.querySelectorAll('globular-organization-view[slot="organizations"]').forEach(el => el.remove());
    this.querySelectorAll('globular-organization-view[slot="potential-organizations"]').forEach(el => el.remove());

    const base = new Set<string>(this._role?.organizations || []);
    for (const id of this.stagedOrgAdds) base.add(id);
    for (const id of this.stagedOrgRems) base.delete(id);

    // in role
    for (const org of this.allOrgs) {
      const oid = org.id;
      if (!oid || !base.has(oid)) continue;
      const ov = new OrganizationView(org as any);
      ov.slot = "organizations";
      ov.setAttribute("summary", "true");
      ov.setAttribute("closeable", "true");
      (ov as any).onClose = () => {
        if ((this._role?.organizations || []).includes(oid)) this.stagedOrgRems.add(oid);
        this.stagedOrgAdds.delete(oid);
        this._renderOrganizationsPanes();
      };
      this.appendChild(ov);
    }

    // potential orgs
    for (const org of this.allOrgs) {
      const oid = org.id;
      if (!oid || base.has(oid)) continue;
      const ov = new OrganizationView(org as any);
      ov.slot = "potential-organizations";
      ov.setAttribute("summary", "true");
      ov.setAttribute("closeable", "false");
      ov.setAttribute("addable", "true");
      (ov as any).onAdd = () => {
        if (!(this._role?.organizations || []).includes(oid)) this.stagedOrgAdds.add(oid);
        this.stagedOrgRems.delete(oid);
        this._renderOrganizationsPanes();
      };
      ov.addEventListener("click", () => {
        if (!(this._role?.organizations || []).includes(oid)) this.stagedOrgAdds.add(oid);
        this.stagedOrgRems.delete(oid);
        this._renderOrganizationsPanes();
      });
      this.appendChild(ov);
    }
  }

  /* ------------------------- Actions panes ------------------------- */
  private async _renderActionsPanes() {
    this.querySelectorAll('globular-action-view[slot="actions"]').forEach(el => el.remove());
    this.querySelectorAll('globular-action-view[slot="potential-actions"]').forEach(el => el.remove());

    const current = new Set<string>(this._role?.actions || []);
    for (const a of this.stagedActAdds) current.add(a);
    for (const a of this.stagedActRems) current.delete(a);

    // actions in role
    for (const a of Array.from(current).sort()) {
      const v = document.createElement("globular-action-view") as any;
      v.setAction?.(a);
      v.slot = "actions";
      v.setAttribute("closeable", "true");
      (v as any).onClose = () => {
        if ((this._role?.actions || []).includes(a)) this.stagedActRems.add(a);
        this.stagedActAdds.delete(a);
        this._renderActionsPanes();
      };
      this.appendChild(v);
    }

    // potential actions
    for (const a of this.allActions) {
      if (current.has(a)) continue;
      const v = document.createElement("globular-action-view") as any;
      v.setAction?.(a);
      v.slot = "potential-actions";
      v.setAttribute("closeable", "false");
      v.setAttribute("addable", "true");
      (v as any).onAdd = () => {
        if (!(this._role?.actions || []).includes(a)) this.stagedActAdds.add(a);
        this.stagedActRems.delete(a);
        this._renderActionsPanes();
      };
      v.addEventListener("click", () => {
        if (!(this._role?.actions || []).includes(a)) this.stagedActAdds.add(a);
        this.stagedActRems.delete(a);
        this._renderActionsPanes();
      });
      this.appendChild(v);
    }
  }

  /* ------------------------- Save ------------------------- */
  private async _save() {
    const name = this.nameInput?.value.trim() || "";
    if (!name) { displayError("Name is required."); this.nameInput?.focus(); return; }

    const body = {
      id: this._role?.id || name.toLowerCase().replace(/\s+/g, "-"),
      name,
      description: this.descInput?.value.trim() || "",
      domain: this.domainInput?.value.trim() || "",
    };

    const isNew = !this._role?.id;

    const toast = displayQuestion(
      `<span>${isNew ? `Create` : `Update`} role <b>${body.name}</b> and apply membership/permissions changes?</span>
       <div style="display:flex; gap:.5rem; justify-content:center; margin-top:1rem;">
         <paper-button id="yes-btn">Yes</paper-button>
         <paper-button id="no-btn">No</paper-button>
       </div>`
    );
    toast.toastElement?.querySelector("#no-btn")?.addEventListener("click", () => toast.toastElement?.remove());

    toast.toastElement?.querySelector("#yes-btn")?.addEventListener("click", async () => {
      toast.toastElement?.remove();
      try {
        let roleId = body.id;

        if (isNew) {
          const created = await createRole({
            name: body.name,
            description: body.description,
            domain: body.domain,
          });
          roleId = created.id;
          this._role = created;
        } else {
          await updateRole(body.id, {
            name: body.name,
            description: body.description,
            domain: body.domain,
          });
        }

        // Apply staged diffs
        const accAdds = Array.from(this.stagedAccAdds);
        const accRems = Array.from(this.stagedAccRems);
        const orgAdds = Array.from(this.stagedOrgAdds);
        const orgRems = Array.from(this.stagedOrgRems);
        const actAdds = Array.from(this.stagedActAdds);
        const actRems = Array.from(this.stagedActRems);

        // accounts
        for (const id of accAdds) await addRoleToAccount(roleId, id);
        for (const id of accRems) await removeRoleFromAccount(roleId, id);

        // orgs
        for (const id of orgAdds) await addRoleToOrganization(roleId, id);
        for (const id of orgRems) await removeRoleFromOrganization(roleId, id);

        // actions (batch add & 1-by-1 remove to mirror available RPCs)
        if (actAdds.length > 0) await addRoleActions(roleId, actAdds);
        for (const a of actRems) await removeRoleAction(roleId, a);

        // Clear staging & reflect new state locally
        this.stagedAccAdds.clear(); this.stagedAccRems.clear();
        this.stagedOrgAdds.clear(); this.stagedOrgRems.clear();
        this.stagedActAdds.clear(); this.stagedActRems.clear();

        // Update the local role model to match staged effects
        this._role = {
          id: roleId,
          name: body.name,
          description: body.description,
          domain: body.domain,
          members: Array.from(new Set([...(this._role?.members || this._role?.members || []), ...accAdds].filter(a => !accRems.includes(a)))),
          organizations: Array.from(new Set([...(this._role?.organizations || []), ...orgAdds].filter(o => !orgRems.includes(o)))),
          actions: Array.from(new Set([...(this._role?.actions || []), ...actAdds].filter(a => !actRems.includes(a)))),
        } as Role;

        let fresh: Role | null = null;
        try {
          fresh = await getRoleById(roleId);
        } catch { /* ignore */ }

        // If server returns the role, use it; otherwise fall back to optimistic merge
        if (fresh) {
          this._role = fresh;
        } else {
          this._role = {
            id: roleId,
            name: body.name,
            description: body.description,
            domain: body.domain,
            members: Array.from(new Set([...(this._role?.members || []), ...accAdds].filter(a => !accRems.includes(a)))),
            organizations: Array.from(new Set([...(this._role?.organizations || []), ...orgAdds].filter(o => !orgRems.includes(o)))),
            actions: Array.from(new Set([...(this._role?.actions || []), ...actAdds].filter(a => !actRems.includes(a)))),
          } as Role;
        }

        // Re-render panes using the up-to-date role
        await this._renderMembersPanes();
        await this._renderOrganizationsPanes();
        await this._renderActionsPanes();

        displaySuccess(isNew ? "Role created." : "Role updated.");
        this.dispatchEvent(new CustomEvent(isNew ? "role-created" : "role-updated", { bubbles: true, detail: this.role }));
      } catch (e: any) {
        console.error(e);
        displayError(e?.message || "Failed to save role.");
      }
    });
  }
}
customElements.define("role-inline-editor", RoleInlineEditor);

/* ============================================================
   RolesManager — main widget
   ============================================================ */
export class RolesManager extends HTMLElement {
  private shadow!: ShadowRoot;
  private table!: any;
  private editorWrap!: HTMLElement;
  private addBtn!: HTMLElement;
  private rows: Role[] = [];

  constructor() {
    super();
    this.shadow = this.attachShadow({ mode: "open" });
  }

  connectedCallback() {
    this.shadow.innerHTML = `
      <style>
        :host { display:block; }
        .page { padding: 12px; color: var(--on-surface-color); background: var(--background-color); }
        .header { display:flex; align-items:center; gap:.5rem; margin-bottom:.5rem; }
        h2 { margin:0; font-size:1.1rem; font-weight:800; color: var(--on-surface-color); }
        .spacer { flex:1; }
        .card { background: var(--surface-color); color: var(--on-surface-color); padding: 1rem 1.25rem;
          border-radius: .5rem; border: 1px solid var(--divider-color, color-mix(in srgb, var(--on-surface-color) 12%, transparent)); }
        .table-wrap { margin-top: 10px; }
      </style>

      <section class="page">
        <div class="header">
          <h2>RBAC — Roles</h2>
          <div class="spacer"></div>
          <paper-icon-button id="addBtn" icon="icons:add" title="Add role"></paper-icon-button>
        </div>

        <div class="card">
          <div id="editorWrap"></div>
          <div class="table-wrap">
            <globular-table
              id="tbl"
              display-index="true"
              visible-data-count="10"
              row-height="50px"
              header-background-color="var(--surface-color)"
              header-text-color="var(--on-primary-light-color)"
            >
              <span id="table-title" slot="title">Roles</span>
              <span class="field" slot="fields" field="displayRoleId">Id</span>
              <span class="field" slot="fields" field="name">Name</span>
              <span class="field" slot="fields" field="domain">Domain</span>
            </globular-table>
          </div>
        </div>
      </section>
    `;

    this.table = this.shadow.getElementById("tbl") as any;
    this.editorWrap = this.shadow.getElementById("editorWrap") as HTMLElement;
    this.addBtn = this.shadow.getElementById("addBtn") as HTMLElement;

    this.table.addEventListener("row-click", (ev: any) => {
      const row: TableRow = ev.detail;
      const role = this.rows.find((r) => r.id === row.id);
      this.openEditor(role || null);
    });

    this.addBtn.addEventListener("click", () => {
      const blank: Role = {
        id: "",
        name: "",
        description: "",
        domain: "",
        members: [],
        organizations: [],
        actions: [],
        groups: [],
      };
      this.openEditor(blank);
    });

    this.refresh();
  }

  private async refresh() {
    try {
      this.rows = await listRoles({});
      const data: TableRow[] = this.rows.map((r, idx) => ({
        _index: idx,
        _visible: true,
        name: r.name || "",
        domain: r.domain || "",
        id: r.id,
        description: r.description,
      }));
      this.table.setData(data);
    } catch (e: any) {
      console.error(e);
      this.table.setData([]);
    }
  }

  private openEditor(role: Role | null) {
    this.editorWrap.innerHTML = "";
    const ed = document.createElement("role-inline-editor") as unknown as RoleInlineEditor;
    ed.setRole(role);

    ed.addEventListener("role-created", () => this._afterSave());
    ed.addEventListener("role-updated", () => this._afterSave());
    ed.addEventListener("role-deleted", () => this._afterSave());
    ed.addEventListener("edit-cancelled", () => { this.editorWrap.innerHTML = ""; });

    this.editorWrap.appendChild(ed);
  }

  private async _afterSave() {
    await this.refresh();
    this.editorWrap.innerHTML = "";
  }
}
customElements.define("globular-roles-manager", RolesManager);