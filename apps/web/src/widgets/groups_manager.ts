// src/widgets/groups_manager.ts
import {
  // backend actions + VM
  listGroups,
  createGroup,
  updateGroup,
  deleteGroup,
  addGroupMember,
  removeGroupMember,
  GroupVM,
} from "../backend/rbac/groups";

import { AccountVM, listAccounts, getAccount } from "../backend/rbac/accounts";

import { displayError, displayQuestion, displaySuccess } from "../backend/ui/notify";

import "@polymer/iron-icons/iron-icons.js";
import "@polymer/paper-icon-button/paper-icon-button.js";
import "@polymer/iron-collapse/iron-collapse.js";

import "../components/table";       // <globular-table>
import "../widgets/avatar_changer"; // <avatar-changer>
import { UserView } from "./user_view.js"; // <globular-user-view>
import { getBase64FromImageUrl } from "../components/utility";

// ---------- table row ----------
type TableRow = {
  _index?: number;
  _visible?: boolean;

  displayGroupId?: string; // custom renderer via window.displayGroupId
  name: string;
  groupDescription: string;

  // helpers
  id?: string;
  icon?: string;
};
const group = new URL('../assets/icons/group.svg', import.meta.url).href;
declare global { interface Window { displayGroupId?: (row: TableRow) => string } }
window.displayGroupId = (row: TableRow) => {
  const src = row.icon || group; // provide a generic group icon in your assets
  const id = row.id || "(unknown)";
  return `
    <div class="group-selector" style="display:flex; align-items:center;">
      <img style="height:32px; width:32px; border-radius:6px; object-fit:cover; border:1px solid var(--divider-color);" src="${src}" alt="Icon"/>
      <span style="margin-left:.75rem; text-decoration: underline;">${id}</span>
    </div>
  `;
};

/* ============================================================
   Inline editor with staged membership changes
   ============================================================ */
class GroupInlineEditor extends HTMLElement {
  private shadow!: ShadowRoot;
  private group: GroupVM | (GroupVM & { icon?: string }) | null = null;
  private isReady = false;

  // UI refs
  private iconImg?: HTMLImageElement;
  private iconPicker?: HTMLElement;
  private nameInput?: HTMLInputElement;
  private descInput?: HTMLInputElement;
  private domainInput?: HTMLInputElement;
  private saveBtn?: HTMLButtonElement;
  private cancelBtn?: HTMLButtonElement;
  private deleteBtn?: HTMLButtonElement;

  // panes
  private membersPane?: HTMLElement;
  private potentialMembersPane?: HTMLElement;

  // data caches
  private allAccounts: AccountVM[] = [];

  // staging
  private stagedAccAdds = new Set<string>();
  private stagedAccRems = new Set<string>();

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
        .inline-btn { padding: 6px 10px; border: 1px solid var(--divider-color); background: transparent; color: var(--on-surface-color); border-radius: 8px; cursor: pointer; }
        .inline-btn:hover { border-color: var(--primary-color); }
        .block { margin-top: 12px; }
        .block h4 { margin: 0 0 .5rem 0; font-size: .95rem; }
        .lists { display:grid; grid-template-columns: 1fr 1fr; gap: 12px; }
        .pane {
          display:flex; gap:8px; flex-wrap: wrap;
          border: 1px solid var(--divider-color);
          border-radius: 6px; min-height: 140px; padding: .5rem; overflow:auto;
        }
        .hint { opacity: .7; font-size: .85rem; }
        .avatar { display:flex; align-items:center; gap:.75rem; position: relative; }
        .avatar img { width: 48px; height:48px; border-radius: 6px; object-fit: cover; border: 1px solid var(--divider-color); cursor: pointer; }
      </style>

      <div class="card">
        <!-- Icon -->
        <div class="row avatar">
          <label>Icon</label>
          <img id="icon" src="assets/icons/group.svg" alt="Icon" title="Click to change"/>
          <avatar-changer id="icon-changer" style="display:none; position:absolute; top:56px; left:140px; z-index:2;"></avatar-changer>
        </div>

        <!-- Basics -->
        <div class="row"><label>Name</label><input id="name" type="text" required minlength="3" /></div>
        <div class="row"><label>Domain</label><input id="domain" type="text" /></div>
        <div class="row"><label>Description</label><input id="desc" type="text" /></div>

        <!-- Accounts -->
        <div class="block">
          <h4>Members</h4>
          <div class="lists">
            <div>
              <div class="hint">Current Members</div>
              <div class="pane" id="members-pane"><slot name="members"></slot></div>
            </div>
            <div>
              <div class="hint">Potential Members</div>
              <div class="pane" id="potential-members"><slot name="potential-members"></slot></div>
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
    this.descInput = this.shadow.getElementById("desc") as HTMLInputElement;
    this.domainInput = this.shadow.getElementById("domain") as HTMLInputElement;
    this.saveBtn = this.shadow.getElementById("save") as HTMLButtonElement;
    this.cancelBtn = this.shadow.getElementById("cancel") as HTMLButtonElement;
    this.deleteBtn = this.shadow.getElementById("delete") as HTMLButtonElement;

    this.membersPane = this.shadow.getElementById("members-pane") as HTMLElement;
    this.potentialMembersPane = this.shadow.getElementById("potential-members") as HTMLElement;

    this.isReady = true;
    if (this.group) this._apply(this.group);

    // icon picker behavior
    this.iconImg?.addEventListener("click", () => {
      if (!this.iconPicker) return;
      this.iconPicker.style.display = this.iconPicker.style.display === "none" ? "block" : "none";
    });
    this.iconPicker?.addEventListener("image-changed", async (e: any) => {
      try {
        const imageUrl = decodeURIComponent(e.detail.src);
        const base64 = await getBase64FromImageUrl(imageUrl);
        if (this.iconImg) this.iconImg.src = base64;
        // store on VM (optional field)
        if (this.group) (this.group as any).icon = base64;
      } catch (err: any) {
        console.error(err);
        displayError("Failed to set group icon.");
      } finally {
        if (this.iconPicker) this.iconPicker.style.display = "none";
      }
    });
    this.iconPicker?.addEventListener("cancel", () => {
      if (this.iconPicker) this.iconPicker.style.display = "none";
    });

    // actions
    this.cancelBtn.onclick = () =>
      this.dispatchEvent(new CustomEvent("edit-cancelled", { bubbles: true }));

    this.deleteBtn.onclick = async () => {
      if (!this.group?.id) return;
      const toast = displayQuestion(
        `<span>Delete group <b>${this.group.name}</b>?</span>
         <div style="display:flex; gap:.5rem; justify-content:center; margin-top:1rem;">
           <paper-button id="yes-btn">Yes</paper-button>
           <paper-button id="no-btn">No</paper-button>
         </div>`
      );
      toast.toastElement?.querySelector("#no-btn")?.addEventListener("click", () => toast.toastElement?.remove());
      toast.toastElement?.querySelector("#yes-btn")?.addEventListener("click", async () => {
        toast.toastElement?.remove();
        try {
          await deleteGroup(this.group!.id);
          displaySuccess("Group deleted.");
          this.dispatchEvent(new CustomEvent("group-deleted", { bubbles: true, detail: this.group }));
        } catch (e: any) {
          console.error(e);
          displayError(e?.message || "Failed to delete group");
        }
      });
    };

    this.saveBtn.onclick = () => this._save();
  }

  setGroup(g: GroupVM | (GroupVM & { icon?: string }) | null) {
    this.group = g;
    if (this.isReady) this._apply(g);
  }

  private async _apply(g: GroupVM | (GroupVM & { icon?: string }) | null) {
    // reset staging
    this.stagedAccAdds.clear();
    this.stagedAccRems.clear();

    const grp = g ?? ({ id: "", name: "", description: "", members: [], domain: "" } as GroupVM);

    if (this.iconImg) this.iconImg.src = (grp as any).icon || "assets/icons/group.svg";
    if (this.nameInput) this.nameInput.value = grp.name || "";
    if (this.domainInput) this.domainInput.value = grp.domain || "";
    if (this.descInput) this.descInput.value = grp.description || "";
    if (this.deleteBtn) this.deleteBtn.style.display = grp.id ? "inline-block" : "none";

    // load accounts cache
    this.allAccounts = await listAccounts();

    await this._renderMembersPanes();
  }

  private async _renderMembersPanes() {
    this.querySelectorAll('globular-user-view[slot="members"]').forEach(el => el.remove());
    this.querySelectorAll('globular-user-view[slot="potential-members"]').forEach(el => el.remove());

    const currentIds = new Set<string>(this.group?.members || []);
    for (const id of this.stagedAccAdds) currentIds.add(id);
    for (const id of this.stagedAccRems) currentIds.delete(id);

    for (const id of currentIds) {
      const acc = this.allAccounts.find(a => a.id === id);
      if (!acc) continue;
      const v = new UserView();
      v.accountVM = acc;
      v.slot = "members";
      v.setAttribute("summary", "true");
      v.setAttribute("closeable", "true");
      (v as any).onClose = () => {
        if ((this.group?.members || []).includes(id)) this.stagedAccRems.add(id);
        this.stagedAccAdds.delete(id);
        this._renderMembersPanes();
      };
      this.appendChild(v);
    }

    for (const acc of this.allAccounts) {
      if (currentIds.has(acc.id)) continue;
      const v = new UserView();
      v.accountVM = acc;
      v.slot = "potential-members";
      v.setAttribute("summary", "true");
      v.setAttribute("closeable", "false");
      v.addEventListener("click", () => {
        if (!(this.group?.members || []).includes(acc.id)) this.stagedAccAdds.add(acc.id);
        this.stagedAccRems.delete(acc.id);
        this._renderMembersPanes();
      });
      this.appendChild(v);
    }
  }

  private async _save() {
    if (!this.nameInput?.value.trim()) { displayError("Name is required."); this.nameInput?.focus(); return; }

    const body: any = {
      id: this.group?.id || this.nameInput.value.trim().toLowerCase().replace(/\s+/g, "-"),
      name: this.nameInput.value.trim(),
      description: this.descInput?.value.trim() || "",
      domain: this.domainInput?.value.trim() || "",
      members: this.group?.members || [],
      // If your backend supports a group icon, this will be sent; fallback to default icon to mirror orgs behavior
      icon: (this.group as any)?.icon || this.iconImg?.src || "assets/icons/group.svg",
    };

    const isNew = !this.group?.id;

    const toast = displayQuestion(
      `<span>${isNew ? `Create` : `Update`} group <b>${body.name}</b> and apply membership changes?</span>
       <div style="display:flex; gap:.5rem; justify-content:center; margin-top:1rem;">
         <paper-button id="yes-btn">Yes</paper-button>
         <paper-button id="no-btn">No</paper-button>
       </div>`
    );
    toast.toastElement?.querySelector("#no-btn")?.addEventListener("click", () => toast.toastElement?.remove());

    toast.toastElement?.querySelector("#yes-btn")?.addEventListener("click", async () => {
      toast.toastElement?.remove();
      try {
        let groupId = body.id;

        if (isNew) {
          const created = await createGroup({
            name: body.name,
            description: body.description,
            domain: body.domain,
            members: Array.from(new Set([...(this.group?.members || []), ...Array.from(this.stagedAccAdds)])),
            icon: body.icon,
          } as any);
          groupId = created.id;
          // keep icon locally even if backend doesn't echo it back yet
          this.group = { ...created, icon: body.icon } as any;
        } else {
          await updateGroup(body.id, {
            name: body.name,
            description: body.description,
            domain: body.domain,
            icon: body.icon,
          } as any);

          // Apply staged diffs for existing groups
          const accAdds = Array.from(this.stagedAccAdds);
          const accRems = Array.from(this.stagedAccRems);
          for (const id of accAdds) await addGroupMember(groupId, id);
          for (const id of accRems) await removeGroupMember(groupId, id);

          const finalMembers = Array.from(
            new Set([...(this.group?.members || []), ...accAdds].filter(a => !accRems.includes(a)))
          );
          this.group = {
            id: groupId,
            name: body.name,
            description: body.description,
            domain: body.domain,
            members: finalMembers,
            // keep the icon like organizations do
            ...(body.icon ? { icon: body.icon } : {}),
          } as any;
        }

        // Clear staging, re-render panes
        this.stagedAccAdds.clear();
        this.stagedAccRems.clear();
        await this._renderMembersPanes();

        displaySuccess(isNew ? "Group created." : "Group updated.");
        this.dispatchEvent(new CustomEvent(isNew ? "group-created" : "group-updated", { bubbles: true, detail: this.group }));
      } catch (e:any) {
        console.error(e);
        displayError(e?.message || "Failed to save group.");
      }
    });
  }
}
customElements.define("group-inline-editor", GroupInlineEditor);


/* ============================================================
   GroupsManager — main widget (table + inline editor)
   ============================================================ */
export class GroupsManager extends HTMLElement {
  private shadow!: ShadowRoot;
  private table!: any;
  private editorWrap!: HTMLElement;
  private addBtn!: HTMLElement;
  private rows: GroupVM[] = [];

  constructor() {
    super();
    this.shadow = this.attachShadow({ mode: "open" });
  }

  connectedCallback() {
    this.shadow.innerHTML = `
      <style>
        :host { display:block; }
        .page {
          padding: 12px;
          color: var(--on-surface-color);
          background: var(--background-color);
        }
        .header {
          display:flex; align-items:center; gap:.5rem; margin-bottom:.5rem;
        }
        h2 {
          margin:0; font-size:1.1rem; font-weight:800;
          color: var(--on-surface-color);
        }
        .spacer { flex:1; }
        .card {
          background: var(--surface-color);
          color: var(--on-surface-color);
          padding: 1rem 1.25rem;
          border-radius: .5rem;
          border: 1px solid var(--divider-color, color-mix(in srgb, var(--on-surface-color) 12%, transparent));
        }
        .table-wrap { margin-top: 10px; }
      </style>

      <section class="page">
        <div class="header">
          <h2>RBAC — Groups</h2>
          <div class="spacer"></div>
          <paper-icon-button id="addBtn" icon="icons:add" title="Add group"></paper-icon-button>
        </div>

        <div class="card">
          <div id="editorWrap"></div>
          <div class="table-wrap">
            <globular-table
              id="tbl"
              display-index="true"
              visible-data-count="10"
              row-height="50px"
              header-background-color="var(--primary-light-color)"
              header-text-color="var(--on-primary-light-color)"
            >
              <span id="table-title" slot="title">Groups</span>
              <span class="field" slot="fields" field="displayGroupId">Id</span>
              <span class="field" slot="fields" field="name">Name</span>
              <span class="field" slot="fields" field="groupDescription">Description</span>
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
      const grp = this.rows.find((g) => g.id === row.id);
      this.openEditor(grp || null);
    });

    this.addBtn.addEventListener("click", () => {
      const blank: GroupVM = {
        id: "",
        name: "",
        description: "",
        domain: "",
        members: [],
      };
      // provide default icon on new groups (like orgs)
      (blank as any).icon = "assets/icons/group.svg";
      this.openEditor(blank);
    });

    this.refresh();
  }

  private async refresh() {
    try {
      this.rows = await listGroups({});
      const data: TableRow[] = this.rows.map((g, idx) => ({
        _index: idx,
        _visible: true,
        name: g.name || "",
        groupDescription: g.description || "",
        id: g.id,
        // show each group's icon if available; fallback to default to mirror orgs
        icon: (g as any).icon || "assets/icons/group.svg",
      }));
      this.table.setData(data);
    } catch (e: any) {
      console.error(e);
      this.table.setData([]);
    }
  }

  private openEditor(grp: GroupVM | null) {
    this.editorWrap.innerHTML = "";
    const ed = document.createElement("group-inline-editor") as GroupInlineEditor;
    ed.setGroup(grp);

    ed.addEventListener("group-created", () => this._afterSave());
    ed.addEventListener("group-updated", () => this._afterSave());
    ed.addEventListener("group-deleted", () => this._afterSave());
    ed.addEventListener("edit-cancelled", () => { this.editorWrap.innerHTML = ""; });

    this.editorWrap.appendChild(ed);
  }

  private async _afterSave() {
    await this.refresh();
    this.editorWrap.innerHTML = "";
  }
}
customElements.define("globular-groups-manager", GroupsManager);
