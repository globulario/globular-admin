// /widgets/organizations_manager.ts
import {
  listOrganizations,
  createOrganization,
  updateOrganization,
  deleteOrganization,
  addOrganizationAccount,
  removeOrganizationAccount,
  addOrganizationGroup,
  removeOrganizationGroup,
  Organization,
} from "../backend/rbac/organizations";

import { displayError, displayQuestion, displaySuccess } from "../backend/ui/notify";
import { getBase64FromImageUrl } from "../components/utility.js";

import "@polymer/iron-icons/iron-icons.js";
import "@polymer/paper-icon-button/paper-icon-button.js";
import "@polymer/iron-collapse/iron-collapse.js";

import "../components/table";         // <globular-table>
import "../widgets/avatar_changer";   // <avatar-changer>

import { getAccount, listAccounts, AccountVM } from "../backend/rbac/accounts";
import { UserView } from "./user_view.js";  // <globular-user-view>

import { GroupView } from "./group_view.js"; // <globular-group-view>
import { getGroupById, listGroups } from "../backend/rbac/groups";

/* ---------- table row ---------- */
type TableRow = {
  _index?: number;
  _visible?: boolean;
  displayOrgId?: string;
  name: string;
  orgEmail: string;
  id?: string;
  icon?: string;
};

declare global { interface Window { displayOrgId?: (row: TableRow) => string } }
window.displayOrgId = (row: TableRow) => {
  const src = row.icon || "assets/icons/organization-icon-original.svg";
  const id = row.id || "(unknown)";
  return `
    <div class="org-selector" style="display:flex; align-items:center;">
      <img style="height:32px; width:32px; border-radius:6px; object-fit:cover; border:1px solid var(--divider-color);" src="${src}" alt="Icon"/>
      <span style="margin-left:.75rem; text-decoration: underline;">${id}</span>
    </div>
  `;
};

/* ============================================================
   Inline editor with staged membership changes
   ============================================================ */
class OrgInlineEditor extends HTMLElement {
  private shadow!: ShadowRoot;
  private org: Organization | null = null;
  private isReady = false;

  // UI refs
  private iconImg?: HTMLImageElement;
  private iconPicker?: HTMLElement;
  private nameInput?: HTMLInputElement;
  private emailInput?: HTMLInputElement;
  private descInput?: HTMLInputElement;
  private domainInput?: HTMLInputElement;
  private saveBtn?: HTMLButtonElement;
  private cancelBtn?: HTMLButtonElement;
  private deleteBtn?: HTMLButtonElement;

  // panes
  private membersPane?: HTMLElement;
  private potentialMembersPane?: HTMLElement;
  private groupsPane?: HTMLElement;
  private potentialGroupsPane?: HTMLElement;

  // data caches
  private allAccounts: AccountVM[] = [];
  private allGroupObjs: any[] = []; // proto objects (Group)
  // staging
  private stagedAccAdds = new Set<string>();
  private stagedAccRems = new Set<string>();
  private stagedGrpAdds = new Set<string>();
  private stagedGrpRems = new Set<string>();

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
        input[type="text"], input[type="email"] {
          flex: 1; border: none; border-bottom: 1px solid var(--divider-color);
          background: var(--surface-color); color: var(--on-surface-color); padding: 6px 4px;
        }
        input:focus { outline: none; border-bottom: 1px solid var(--primary-color); }
        .actions { display:flex; gap:.5rem; margin-top: 12px; }
        .spacer { flex: 1; }
        .avatar { display:flex; align-items:center; gap:.75rem; position: relative; }
        .avatar img { width: 48px; height:48px; border-radius: 6px; object-fit: cover; border: 1px solid var(--divider-color); cursor: pointer; }
        .inline-btn { padding: 6px 10px; border: 1px solid var(--divider-color); background: transparent; color: var(--on-surface-color); border-radius: 8px; cursor: pointer; }
        .inline-btn:hover { border-color: var(--primary-color); }
        .block {
          margin-top: 12px;
        }
        .block h4 {
          margin: 0 0 .5rem 0;
          font-size: .95rem;
        }
        .lists {
          display:grid; grid-template-columns: 1fr 1fr; gap: 12px;
        }
        .pane {
          display:flex; gap:8px; flex-wrap: wrap;
          border: 1px solid var(--divider-color);
          border-radius: 6px; min-height: 140px; padding: .5rem; overflow:auto;
        }
        .hint { opacity: .7; font-size: .85rem; }
      </style>

      <div class="card">
        <!-- Icon -->
        <div class="row avatar">
          <label>Icon</label>
          <img id="icon" src="assets/icons/organization-icon-original.svg" alt="Icon" title="Click to change"/>
          <avatar-changer id="icon-changer" style="display:none; position:absolute; top:56px; left:140px; z-index:2;"></avatar-changer>
        </div>

        <!-- Basics -->
        <div class="row"><label>Name</label><input id="name" type="text" required minlength="3" /></div>
        <div class="row"><label>Email</label><input id="email" type="email" required /></div>
        <div class="row"><label>Domain</label><input id="domain" type="text" /></div>
        <div class="row"><label>Description</label><input id="desc" type="text" /></div>

        <!-- Accounts -->
        <div class="block">
          <h4>Accounts</h4>
          <div class="lists">
            <div>
              <div class="hint">Members</div>
              <div class="pane" id="members-pane"><slot name="members"></slot></div>
            </div>
            <div>
              <div class="hint">Potential Members</div>
              <div class="pane" id="potential-members"><slot name="potential-members"></slot></div>
            </div>
          </div>
        </div>

        <!-- Groups -->
        <div class="block">
          <h4>Groups</h4>
          <div class="lists">
            <div>
              <div class="hint">Groups in organization</div>
              <div class="pane" id="groups-pane"><slot name="groups"></slot></div>
            </div>
            <div>
              <div class="hint">Potential Groups</div>
              <div class="pane" id="potential-groups"><slot name="potential-groups"></slot></div>
            </div>
          </div>
        </div>

        <!-- Actions -->
        <div class="actions">
          <button id="delete" class="inline-btn">Delete</button>
          <span class="spacer"></span>
          <button id="save" class="inline-btn">Save</button>
          <button id="cancel" class="inline-btn">Cancel</button>
        </div>
      </div>
    `;

    // bind basics
    this.iconImg = this.shadow.getElementById("icon") as HTMLImageElement;
    this.iconPicker = this.shadow.getElementById("icon-changer") as HTMLElement;
    this.nameInput = this.shadow.getElementById("name") as HTMLInputElement;
    this.emailInput = this.shadow.getElementById("email") as HTMLInputElement;
    this.descInput = this.shadow.getElementById("desc") as HTMLInputElement;
    this.domainInput = this.shadow.getElementById("domain") as HTMLInputElement;
    this.saveBtn = this.shadow.getElementById("save") as HTMLButtonElement;
    this.cancelBtn = this.shadow.getElementById("cancel") as HTMLButtonElement;
    this.deleteBtn = this.shadow.getElementById("delete") as HTMLButtonElement;

    this.membersPane = this.shadow.getElementById("members-pane") as HTMLElement;
    this.potentialMembersPane = this.shadow.getElementById("potential-members") as HTMLElement;
    this.groupsPane = this.shadow.getElementById("groups-pane") as HTMLElement;
    this.potentialGroupsPane = this.shadow.getElementById("potential-groups") as HTMLElement;

    this.isReady = true;
    if (this.org) this._apply(this.org);

    // icon picker
    this.iconImg?.addEventListener("click", () => {
      if (!this.iconPicker) return;
      this.iconPicker.style.display = this.iconPicker.style.display === "none" ? "block" : "none";
    });
    this.iconPicker?.addEventListener("image-changed", async (e: any) => {
      try {
        const imageUrl = decodeURIComponent(e.detail.src);
        const base64 = await getBase64FromImageUrl(imageUrl);
        if (this.iconImg) this.iconImg.src = base64;
      } catch (err: any) {
        console.error(err);
        displayError("Failed to set organization icon.");
      } finally {
        if (this.iconPicker) this.iconPicker.style.display = "none";
      }
    });
    this.iconPicker?.addEventListener("cancel", () => {
      if (this.iconPicker) this.iconPicker.style.display = "none";
    });

    // actions
    this.cancelBtn.onclick = () => this.dispatchEvent(new CustomEvent("edit-cancelled", { bubbles: true }));

    this.deleteBtn.onclick = async () => {
      if (!this.org?.id) return;
      const toast = displayQuestion(
        `<span>Delete organization <b>${this.org.name}</b>?</span>
         <div style="display:flex; gap:.5rem; justify-content:center; margin-top:1rem;">
           <paper-button id="yes-btn">Yes</paper-button>
           <paper-button id="no-btn">No</paper-button>
         </div>`
      );
      toast.toastElement?.querySelector("#no-btn")?.addEventListener("click", () => toast.toastElement?.remove());
      toast.toastElement?.querySelector("#yes-btn")?.addEventListener("click", async () => {
        toast.toastElement?.remove();
        try {
          await deleteOrganization(this.org!.id);
          displaySuccess("Organization deleted.");
          this.dispatchEvent(new CustomEvent("org-deleted", { bubbles: true, detail: this.org }));
        } catch (e: any) {
          console.error(e);
          displayError(e?.message || "Failed to delete organization");
        }
      });
    };

    this.saveBtn.onclick = () => this._save();
  }

  setOrganization(o: Organization | null) {
    this.org = o;
    if (this.isReady) this._apply(o);
  }

  private async _apply(o: Organization | null) {
    // reset staging
    this.stagedAccAdds.clear(); this.stagedAccRems.clear();
    this.stagedGrpAdds.clear(); this.stagedGrpRems.clear();

    const org = o ?? ({} as Organization);
    // basics
    if (this.iconImg) this.iconImg.src = org.icon || "assets/icons/organization-icon-original.svg";
    if (this.nameInput) this.nameInput.value = org.name || "";
    if (this.emailInput) this.emailInput.value = org.email || "";
    if (this.domainInput) this.domainInput.value = org.domain || "";
    if (this.descInput) this.descInput.value = org.description || "";
    if (this.deleteBtn) this.deleteBtn.style.display = org.id ? "inline-block" : "none";

    // hydrate caches then render both sides
    await Promise.all([
      (async () => { this.allAccounts = await listAccounts(); })(),
      (async () => { this.allGroupObjs = await listGroups(); })()
    ]);

    await this._renderMembersPanes();
    await this._renderGroupsPanes();
  }

  /* ------------------------- Accounts panes ------------------------- */
  private async _renderMembersPanes() {
    // clear existing
    this.querySelectorAll('globular-user-view[slot="members"]').forEach(el => el.remove());
    this.querySelectorAll('globular-user-view[slot="potential-members"]').forEach(el => el.remove());

    const currentIds = new Set<string>(this.org?.accounts || []);
    // apply staging to what we *show*
    for (const id of this.stagedAccAdds) currentIds.add(id);
    for (const id of this.stagedAccRems) currentIds.delete(id);

    // members
    for (const id of currentIds) {
      const acc = this.allAccounts.find(a => a.id === id);
      if (!acc) continue;
      const v = new UserView();
      v.accountVM = acc;
      v.slot = "members";
      v.setAttribute("summary", "true");
      v.setAttribute("closeable", "true");
      (v as any).onClose = () => { // stage removal
        if (this.org?.accounts?.includes(id)) this.stagedAccRems.add(id);
        this.stagedAccAdds.delete(id);
        this._renderMembersPanes();
      };
      this.appendChild(v);
    }

    // potential
    for (const acc of this.allAccounts) {
      if (currentIds.has(acc.id)) continue;
      const v = new UserView();
      v.accountVM = acc;
      v.slot = "potential-members";
      v.setAttribute("summary", "true");
      v.setAttribute("closeable", "false");
      v.addEventListener("click", () => { // stage add
        if (!(this.org?.accounts || []).includes(acc.id)) this.stagedAccAdds.add(acc.id);
        this.stagedAccRems.delete(acc.id);
        this._renderMembersPanes();
      });
      this.appendChild(v);
    }
  }

  /* ------------------------- Groups panes ------------------------- */
  private async _renderGroupsPanes() {
    this.querySelectorAll('globular-group-view[slot="groups"]').forEach(el => el.remove());
    this.querySelectorAll('globular-group-view[slot="potential-groups"]').forEach(el => el.remove());

    const currentIds = new Set<string>(this.org?.groups || []);
    for (const id of this.stagedGrpAdds) currentIds.add(id);
    for (const id of this.stagedGrpRems) currentIds.delete(id);

    // groups in org
    for (const g of this.allGroupObjs) {
      const gid = g.getId?.() || g.id;
      if (!gid || !currentIds.has(gid)) continue;
      const gv = new GroupView(g);
      gv.slot = "groups";
      gv.setAttribute("summary", "true");
      gv.setAttribute("closeable", "true");
      (gv as any).onClose = () => {
        if (this.org?.groups?.includes(gid)) this.stagedGrpRems.add(gid);
        this.stagedGrpAdds.delete(gid);
        this._renderGroupsPanes();
      };
      this.appendChild(gv);
    }

    // potential groups
    for (const g of this.allGroupObjs) {
      const gid = g.getId?.() || g.id;
      if (!gid || currentIds.has(gid)) continue;
      const gv = new GroupView(g);
      gv.slot = "potential-groups";
      gv.setAttribute("summary", "true");
      gv.setAttribute("closeable", "false");
      gv.setAttribute("addable", "true");
      (gv as any).onAdd = () => {
        if (!(this.org?.groups || []).includes(gid)) this.stagedGrpAdds.add(gid);
        this.stagedGrpRems.delete(gid);
        this._renderGroupsPanes();
      };
      gv.addEventListener("click", () => {
        if (!(this.org?.groups || []).includes(gid)) this.stagedGrpAdds.add(gid);
        this.stagedGrpRems.delete(gid);
        this._renderGroupsPanes();
      });
      this.appendChild(gv);
    }
  }

  /* ------------------------- Save ------------------------- */
  private async _save() {
    if (!this.nameInput?.value.trim()) { displayError("Name is required."); this.nameInput?.focus(); return; }
    if (!this.emailInput?.value.trim()) { displayError("Email is required."); this.emailInput?.focus(); return; }

    const body = {
      id: this.org?.id || this.nameInput.value.trim().toLowerCase().replace(/\s+/g, "-"),
      name: this.nameInput.value.trim(),
      email: this.emailInput.value.trim(),
      description: this.descInput?.value.trim() || "",
      icon: this.iconImg?.src || undefined,
      domain: this.domainInput?.value.trim() || "",
    };

    const isNew = !this.org?.id;

    const toast = displayQuestion(
      `<span>${isNew ? `Create` : `Update`} organization <b>${body.name}</b> and apply membership changes?</span>
       <div style="display:flex; gap:.5rem; justify-content:center; margin-top:1rem;">
         <paper-button id="yes-btn">Yes</paper-button>
         <paper-button id="no-btn">No</paper-button>
       </div>`
    );
    toast.toastElement?.querySelector("#no-btn")?.addEventListener("click", () => toast.toastElement?.remove());

    toast.toastElement?.querySelector("#yes-btn")?.addEventListener("click", async () => {
      toast.toastElement?.remove();
      try {
        let orgId = body.id;

        if (isNew) {
          const created = await createOrganization({
            name: body.name,
            email: body.email,
            description: body.description,
            icon: body.icon,
            domain: body.domain,
          });
          orgId = created.id;
          this.org = created;
        } else {
          await updateOrganization(body.id, {
            name: body.name,
            email: body.email,
            description: body.description,
            icon: body.icon,
            domain: body.domain,
          });
        }

        // Apply staged diffs (accounts)
        const accAdds = Array.from(this.stagedAccAdds);
        const accRems = Array.from(this.stagedAccRems);
        const grpAdds = Array.from(this.stagedGrpAdds);
        const grpRems = Array.from(this.stagedGrpRems);

        // Run in sequence per category to keep server load tame
        for (const id of accAdds) await addOrganizationAccount(orgId, id);
        for (const id of accRems) await removeOrganizationAccount(orgId, id);
        for (const id of grpAdds) await addOrganizationGroup(orgId, id);
        for (const id of grpRems) await removeOrganizationGroup(orgId, id);

        // Clear staging & reflect new state locally
        this.stagedAccAdds.clear(); this.stagedAccRems.clear();
        this.stagedGrpAdds.clear(); this.stagedGrpRems.clear();

        // Update the local org model to match staged effects
        this.org = {
          id: orgId,
          name: body.name,
          email: body.email,
          description: body.description,
          icon: body.icon,
          domain: body.domain,
          accounts: Array.from(new Set([...(this.org?.accounts || []), ...accAdds].filter(a => !accRems.includes(a)))),
          groups:   Array.from(new Set([...(this.org?.groups || []), ...grpAdds].filter(g => !grpRems.includes(g)))),
        };

        // Re-render both panes
        await this._renderMembersPanes();
        await this._renderGroupsPanes();

        displaySuccess(isNew ? "Organization created." : "Organization updated.");
        this.dispatchEvent(new CustomEvent(isNew ? "org-created" : "org-updated", { bubbles: true, detail: this.org }));
      } catch (e:any) {
        console.error(e);
        displayError(e?.message || "Failed to save organization.");
      }
    });
  }
}
customElements.define("org-inline-editor", OrgInlineEditor);

/* ============================================================
   OrganizationsManager — main widget (unchanged UX)
   ============================================================ */
export class OrganizationsManager extends HTMLElement {
  private shadow!: ShadowRoot;
  private table!: any;
  private editorWrap!: HTMLElement;
  private addBtn!: HTMLElement;
  private rows: Organization[] = [];

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
          <h2>RBAC — Organizations</h2>
          <div class="spacer"></div>
          <paper-icon-button id="addBtn" icon="icons:add" title="Add organization"></paper-icon-button>
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
              <span id="table-title" slot="title">Organizations</span>
              <span class="field" slot="fields" field="displayOrgId">Id</span>
              <span class="field" slot="fields" field="name">Name</span>
              <span class="field" slot="fields" field="orgEmail">Email</span>
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
      const org = this.rows.find((o) => o.id === row.id);
      this.openEditor(org || null);
    });

    this.addBtn.addEventListener("click", () => {
      const blank: Organization = {
        id: "",
        name: "",
        email: "",
        description: "",
        icon: "",
        domain: undefined,
        accounts: [],
        groups: [],
      };
      this.openEditor(blank);
    });

    this.refresh();
  }

  private async refresh() {
    try {
      this.rows = await listOrganizations({});
      const data: TableRow[] = this.rows.map((o, idx) => ({
        _index: idx,
        _visible: true,
        name: o.name || "",
        orgEmail: o.email || "",
        id: o.id,
        icon: o.icon,
      }));
      this.table.setData(data);
    } catch (e: any) {
      console.error(e);
      this.table.setData([]);
    }
  }

  private openEditor(org: Organization | null) {
    this.editorWrap.innerHTML = "";
    const ed = document.createElement("org-inline-editor") as OrgInlineEditor;
    ed.setOrganization(org);

    ed.addEventListener("org-created", () => this._afterSave());
    ed.addEventListener("org-updated", () => this._afterSave());
    ed.addEventListener("org-deleted", () => this._afterSave());
    ed.addEventListener("edit-cancelled", () => { this.editorWrap.innerHTML = ""; });

    this.editorWrap.appendChild(ed);
  }

  private async _afterSave() {
    await this.refresh();
    this.editorWrap.innerHTML = "";
  }
}
customElements.define("globular-organizations-manager", OrganizationsManager);
