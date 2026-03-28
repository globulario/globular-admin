// src/widgets/shareResourceWizard.js

import getUuidByString from "uuid-by-string";
import { Wizard } from "../wizard.js";

// New backends (no globule, no direct protos)
import {
  // PermissionVM shape (doc only): { path, resourceType, owners?, allowed: [{name, accounts, groups, applications, organizations, peers}], denied: [...] }
  getResourcePermissions,
  setResourcePermissions,
  toPermissionsVM,
} from "@globular/sdk";
import { getCurrentAccount } from "@globular/sdk"; // used only for sender id in notifications
import { getGroupById, listGroupMembers } from "@globular/sdk"; // resolve members for notifications

// Local UI building blocks
import { GlobularSubjectsSelected } from "./subjectsSelected.js";
import { GlobularSubjectsView } from "./subjectsView.js";
import { SharedSubjectsPermissions } from "./sharedSubjectPermissions.js";
import { permissionsVMToProto } from "../permissionManager/permissionsUtils.js";
import { clearPermissionsCache } from "./sharedResources.js";

// Optional global “info” helpers (kept as-is)
import { showGlobalTitleInfo } from "@globular/media/search/searchTitleCard.js";
import { showGlobalVideoInfo } from "@globular/media/search/searchVideoCard.js";

// UI deps (Polymer)

/**
 * Wizard to share one or many resources:
 * 1) pick files, 2) pick subjects, 3) set per-subject read/write/delete, 4) summary.
 */
export class ShareResourceWizard extends HTMLElement {
  // Instance state
  _view = null;
  _files = [];

  _wizard = null;
  _closeButton = null;
  _contentArea = null;

  _filesPage = null;
  _subjectsPage = null;
  _permissionsPage = null;
  _summaryPage = null;

  _subjectsView = null;
  _selectedSubjects = null;
  _sharedSubjectsPermission = null;
  _existingPermissionsVM = null;

  /**
   * @param {any[]} files
   * @param {HTMLElement} view
   */
  constructor(files, view) {
    super();
    this.attachShadow({ mode: "open" });
    this._files = Array.isArray(files) ? files : [];
    this._view = view ?? null;
  }

  connectedCallback() {
    this._render();
    this._refs();
    this._bind();
    this._buildWizard();
    this._initializePermissionsState();
  }

  // ------------------------------------------------------------------------
  // Render
  // ------------------------------------------------------------------------
  _render() {
    this.shadowRoot.innerHTML = `
      <style>
        #container {
          display:flex;
          flex-direction:column;
          width:100%;
          height:100%;
          background: var(--surface-color);
          color: var(--primary-text-color);
          box-sizing:border-box;
        }
        .header {
          display:flex;
          align-items:center;
          padding:8px 14px;
          border-bottom:1px solid var(--palette-divider);
          background: color-mix(in srgb, var(--palette-primary-accent) 12%, transparent);
          color: var(--primary-text-color);
          min-height:42px;
        }
        .header .title {
          flex:1;
          text-align:center;
          font-size:1.05rem;
          font-weight:500;
        }
        .header paper-icon-button {
          color: var(--secondary-text-color);
          --iron-icon-fill-color: var(--secondary-text-color);
        }
        .content {
          display:flex;
          flex-direction:column;
          flex:1;
          min-height:0;
        }
        #content-host {
          flex:1;
          min-height:0;
          display:flex;
        }

        .globular-wizard-page {
          display:flex;
          flex-direction:column;
          padding:12px;
          box-sizing:border-box;
          gap:10px;
          overflow:auto;
          flex:1;
          min-height:0;
        }

        /* Files grid */
        .files-page {
          flex-wrap:wrap;
          flex-direction:row;
          align-items:flex-start;
          justify-content:flex-start;
          gap:12px;
        }
        .file-card { width: 160px; border:1px solid var(--palette-divider); border-radius:6px; padding:6px;
          background:var(--surface-color); box-shadow:var(--shadow-elevation-2dp); }
        .file-top { display:flex; align-items:center; gap:8px; }
        .file-title { font-size:.9rem; line-height:1.2; flex:1; overflow:hidden; text-overflow:ellipsis; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; }
        .file-thumb { width:100%; height:90px; object-fit:contain; margin-top:6px; }

        /* Subjects page */
        .subjects-wrap { display:flex; gap:12px; height:100%; }
        globular-subjects-view { flex:1; min-width:240px; border-right:1px solid var(--palette-divider); }
        globular-subjects-selected { flex:2; min-width:280px; }

        /* Summary page */
        .summary-page { display:flex; flex-direction:column; gap:20px; padding:8px 0; }
        .summary-banner {
          display:flex; align-items:center; gap:14px;
          padding:14px 18px; border-radius:8px;
          font-size:.9rem; font-weight:500;
        }
        .summary-banner.success {
          background: color-mix(in srgb, var(--palette-success-main, #4caf50) 12%, transparent);
          color: var(--palette-success-main, #4caf50);
        }
        .summary-banner.warning {
          background: color-mix(in srgb, var(--palette-warning-main, #ff9800) 12%, transparent);
          color: var(--palette-warning-main, #ff9800);
        }
        .summary-banner.error {
          background: color-mix(in srgb, var(--palette-error-main, #f44336) 12%, transparent);
          color: var(--palette-error-main, #f44336);
        }
        .summary-banner iron-icon { width:28px; height:28px; flex-shrink:0; }
        .summary-section-title {
          font-size:.75rem; font-weight:600; text-transform:uppercase;
          letter-spacing:.04em; color:var(--secondary-text-color);
          padding-bottom:6px;
          border-bottom:1px solid color-mix(in srgb, var(--palette-divider) 40%, transparent);
        }
        .pill-list { display:flex; flex-wrap:wrap; gap:8px; padding-top:8px; }
        .pill {
          display:flex; align-items:center; gap:8px; padding:6px 12px; border-radius:20px;
          background: color-mix(in srgb, var(--on-surface-color) 6%, var(--surface-color));
          border:1px solid color-mix(in srgb, var(--palette-divider) 30%, transparent);
          font-size:.82rem;
        }
        .pill img { width:28px; height:28px; border-radius:50%; object-fit:cover; }
        .pill .name { font-weight:500; }
        .error-list { display:flex; flex-direction:column; gap:6px; padding-top:8px; }
        .error-item {
          display:flex; align-items:flex-start; gap:8px;
          padding:8px 12px; border-radius:6px; font-size:.8rem;
          background: color-mix(in srgb, var(--palette-error-main, #f44336) 8%, transparent);
          color: var(--palette-error-main, #f44336);
          border:1px solid color-mix(in srgb, var(--palette-error-main, #f44336) 20%, transparent);
        }
        .error-item iron-icon { width:16px; height:16px; flex-shrink:0; margin-top:1px; }
        .error-item .error-text { flex:1; word-break:break-word; }
      </style>

      <div id="container">
        <div class="header">
          <iron-icon icon="social:share"></iron-icon>
          <div class="title">Share Resources Wizard</div>
          <paper-icon-button id="close-btn" icon="icons:close"></paper-icon-button>
        </div>
        <div class="content">
          <div id="content-host"></div>
        </div>
      </div>
    `;
  }

  _refs() {
    this._closeButton = this.shadowRoot.querySelector("#close-btn");
    this._contentArea = this.shadowRoot.querySelector("#content-host");
  }

  _bind() {
    this._closeButton?.addEventListener("click", () => {
      this._flushFileSelection();
      this.onclose?.();
      this.remove();
    });
  }

  // ------------------------------------------------------------------------
  // Wizard pages
  // ------------------------------------------------------------------------
  _buildWizard() {
    this._wizard = new Wizard();
    Object.assign(this._wizard.style, { flexGrow: "1", height: "100%" });
    this._contentArea.appendChild(this._wizard);

    // Page 1 — Files
    this._filesPage = document.createElement("div");
    this._filesPage.className = "globular-wizard-page files-page";
    this._renderFilesGrid(this._filesPage);
    this._wizard.appendPage(this._filesPage);

    // Page 2 — Subjects
    this._subjectsPage = document.createElement("div");
    this._subjectsPage.className = "globular-wizard-page subjects-page";
    this._renderSubjectsSelector(this._subjectsPage);
    this._wizard.appendPage(this._subjectsPage);

    // Page 3 — Permissions
    this._permissionsPage = document.createElement("div");
    this._permissionsPage.className = "globular-wizard-page";
    this._renderPermissionsEditor(this._permissionsPage);
    this._wizard.appendPage(this._permissionsPage);

    // Page 4 — Summary
    this._summaryPage = document.createElement("div");
    this._summaryPage.className = "globular-wizard-page summary-page";
    this._wizard.setSummaryPage(this._summaryPage);

    // Callbacks
    this._wizard.ondone = (sumEl) => this._onDone(sumEl);
    this._wizard.onclose = () => {
      this._flushFileSelection();
      this.onclose?.();
      this.remove();
    };
  }

  _flushFileSelection() {
    for (const file of this._files) {
      if (file && typeof file === "object") {
        delete file.selected;
      }
    }
    this._files = [];
  }

  // -------- Page 1: files grid ----------
  _renderFilesGrid(host) {
    for (const file of this._files) {
      const key = file?.getPath?.() ?? file?.path ?? "";
      const id = `_f_${getUuidByString(key)}`;
      const alias = this._aliasForFile(file);
      const thumb = file?.getThumbnail?.() ?? file?.thumbnail ?? "";

      const frag = document.createRange().createContextualFragment(`
        <div class="file-card" id="${id}">
          <div class="file-top">
            <paper-checkbox id="${id}_chk" checked></paper-checkbox>
            <div class="file-title" title="${alias}">${alias}</div>
            <iron-icon id="${id}_info" icon="icons:info"></iron-icon>
          </div>
          <img class="file-thumb" src="${thumb}" alt="">
        </div>
      `);
      host.appendChild(frag);

      const chk = host.querySelector(`#${id}_chk`);
      const infoBtn = host.querySelector(`#${id}_info`);
      file.selected = true;
      chk?.addEventListener("click", () => {
        file.selected = !!chk.checked;
      });

      const infoFn = this._infoFn(file);
      if (infoFn) infoBtn?.addEventListener("click", () => infoFn(file));
      else infoBtn.style.display = "none";
    }
  }

  _aliasForFile(file) {
    let name = file?.getName?.() ?? file?.name ?? "";
    const t = file?.titles?.[0];
    if (t?.getName) {
      name = t.getName();
      if (t.getEpisode && t.getEpisode() > 0) {
        const s = t.getSeason?.() ?? "";
        name += ` S${s}-E${t.getEpisode()}`;
      }
    } else if (file?.videos?.[0]?.getDescription) {
      name = file.videos[0].getDescription();
    } else if (file?.audios?.[0]?.getTitle) {
      name = file.audios[0].getTitle();
    }
    return name || file?.getPath?.() || file?.path || "(file)";
  }

  _infoFn(file) {
    if (file?.titles?.length) return showGlobalTitleInfo;
    if (file?.videos?.length) return showGlobalVideoInfo;
    return null;
  }

  // -------- Page 2: subjects ----------
  _renderSubjectsSelector(host) {
    this._subjectsView = new GlobularSubjectsView();
    this._selectedSubjects = new GlobularSubjectsSelected();

    const wrap = document.createElement("div");
    wrap.className = "subjects-wrap";
    wrap.appendChild(this._subjectsView);
    wrap.appendChild(this._selectedSubjects);
    host.appendChild(wrap);

    // Adders
    this._subjectsView.on_account_click = (_div, account) => {
      this._selectedSubjects.appendAccount(_div, account);
      this._sharedSubjectsPermission?.setAccounts(this._selectedSubjects.getAccounts());
      this._applyPermissionsToSubject(account);
    };
    this._subjectsView.on_group_click = (_div, group) => {
      this._selectedSubjects.appendGroup(_div, group);
      this._sharedSubjectsPermission?.setGroups(this._selectedSubjects.getGroups());
      this._applyPermissionsToSubject(group);
    };

    // Removers
    this._selectedSubjects.on_account_removed = () => {
      this._sharedSubjectsPermission?.setAccounts(this._selectedSubjects.getAccounts());
    };
    this._selectedSubjects.on_group_removed = () => {
      this._sharedSubjectsPermission?.setGroups(this._selectedSubjects.getGroups());
    };
  }

  // -------- Page 3: permissions ----------
  _renderPermissionsEditor(host) {
    this._sharedSubjectsPermission = new SharedSubjectsPermissions();
    host.appendChild(this._sharedSubjectsPermission);

    // Initialize from what is already selected
    this._sharedSubjectsPermission.setAccounts(this._selectedSubjects.getAccounts());
    this._sharedSubjectsPermission.setGroups(this._selectedSubjects.getGroups());
  }

  _applyPermissionsToSubject(subject) {
    if (!subject || !this._existingPermissionsVM) return;
    this._sharedSubjectsPermission?.applyPermissionsForSubject(subject, this._existingPermissionsVM);
  }

  async _initializePermissionsState() {
    if (!this._files?.length) return;
    const file = this._files[0];
    const path = file?.getPath?.() ?? file?.path;
    if (!path) return;
    try {
      const vm = await safeGetPermissions(path, "file");
      this._existingPermissionsVM = vm;
      (this._selectedSubjects?.getAccounts?.() || []).forEach((acc) => this._applyPermissionsToSubject(acc));
      (this._selectedSubjects?.getGroups?.() || []).forEach((grp) => this._applyPermissionsToSubject(grp));
    } catch (err) {
      console.warn("Failed to load permissions for wizard preview:", err);
    }
  }

  // ------------------------------------------------------------------------
  // Done: gather VM, persist with new backend, then show summary + notify
  // ------------------------------------------------------------------------
  async _onDone(summaryHost) {
    // 1) Build a PermissionVM-like object from the editor (allowed/denied lists of fqids)
    const vm = this._sharedSubjectsPermission.getPermissionsVM();

    // Files selected
    const selectedFiles = this._files.filter((f) => f?.selected);

    // 2) Try to set permissions for each file (resourceType: "file")
    const errors = {};
    for (const file of selectedFiles) {
      const path = file?.getPath?.() ?? file?.path;
      try {
        const existing = await safeGetPermissions(path, "file");
        const merged = mergePermissionVM(existing, vm);
        merged.path = path || merged.path;
        merged.resourceType = merged.resourceType || "file";
        const proto = permissionsVMToProto(merged);
        await setResourcePermissions(proto);
        clearPermissionsCache(path);
      } catch (e) {
        errors[path] = e;
      }
    }

    // 3) Render summary
    this._renderSummary(summaryHost, selectedFiles, errors);

    // 4) Notify participants (optional; wire your backend here if desired)
    try {
      await this._notifyParticipants(selectedFiles, errors);
    } catch {
      /* non-fatal */
    }
  }

  // ------------------------------------------------------------------------
  // Summary
  // ------------------------------------------------------------------------
  _renderSummary(host, files, errors) {
    const total = files.length;
    const failed = Object.keys(errors).length;
    const ok = total - failed;

    const bannerClass =
      failed === 0 ? "success" : failed === total ? "error" : "warning";
    const statusIcon =
      failed === 0 ? "icons:check-circle" : failed === total ? "icons:error" : "icons:warning";
    const msg =
      failed === 0
        ? `Permissions successfully set for all ${total} file(s).`
        : failed === total
        ? `Failed to set permissions for all ${total} file(s).`
        : `Permissions set for ${ok} of ${total} file(s); ${failed} failed.`;

    host.innerHTML = `
      <div class="summary-banner ${bannerClass}">
        <iron-icon icon="${statusIcon}"></iron-icon>
        <span>${msg}</span>
      </div>
      <div>
        <div class="summary-section-title">Shared resources</div>
        <div class="pill-list" id="res-list"></div>
      </div>
      ${failed ? `<div>
        <div class="summary-section-title">Errors</div>
        <div class="error-list" id="err-list"></div>
      </div>` : ``}
    `;

    const resList = host.querySelector("#res-list");
    for (const f of files) {
      const path = f?.getPath?.() ?? f?.path ?? "";
      const name = this._aliasForFile(f) || path.split("/").pop() || "(unknown)";
      const thumb = f?.getThumbnail?.() ?? f?.thumbnail ?? "";
      const isError = errors[path];
      const pill = document.createElement("div");
      pill.className = "pill";
      if (isError) pill.style.opacity = "0.5";
      pill.innerHTML = `${thumb ? `<img src="${thumb}" alt="">` : ""}<div class="name">${name}</div>`;
      resList.appendChild(pill);
    }

    if (failed) {
      const errList = host.querySelector("#err-list");
      for (const [p, err] of Object.entries(errors)) {
        const fileName = p ? p.split("/").pop() : "(unknown file)";
        const errMsg = err?.message ?? String(err);
        const div = document.createElement("div");
        div.className = "error-item";
        div.innerHTML = `<iron-icon icon="icons:error-outline"></iron-icon><div class="error-text"><strong>${fileName}</strong> — ${errMsg}</div>`;
        errList.appendChild(div);
      }
    }
  }

  // ------------------------------------------------------------------------
  // Notifications (optional; replace send path with your backend wrapper)
  // ------------------------------------------------------------------------
  async _notifyParticipants(files, errors) {
    const okFiles = files.filter((f) => !errors[f?.getPath?.() ?? f?.path]);
    if (okFiles.length === 0) return;

    // Flatten participants as accounts (unique by fqid)
    const accounts = [...this._selectedSubjects.getAccounts()];

    // Expand groups to members (if your backend exposes listGroupMembers)
    const groups = this._selectedSubjects.getGroups();
    for (const g of groups) {
      try {
        const gid = g?.getId?.() ?? g?.id;
        const dom = g?.getDomain?.() ?? g?.domain;
        const group = await getGroupById(gid, dom);
        const members = await listGroupMembers(group.id, group.domain);
        for (const m of members || []) {
          const key = `${m.id}@${m.domain}`;
          if (
            !accounts.some(
              (a) => `${a.id ?? a.getId?.()}@${a.domain ?? a.getDomain?.()}` === key
            )
          ) {
            accounts.push(m);
          }
        }
      } catch {
        // non-fatal
      }
    }

    // Filter out the sender
    let me = null;
    try {
      me = await getCurrentAccount();
    } catch {}
    const mefq = me ? `${me.id}@${me.domain}` : "";
    const recipients = accounts.filter((a) => {
      const fq = `${a.id ?? a.getId?.()}@${a.domain ?? a.getDomain?.()}`;
      return fq && fq !== mefq;
    });

    // Send via placeholder; replace with your backend when available
    await Promise.allSettled(
      recipients.flatMap((r) =>
        okFiles.map((f) => this._sendNotificationPlaceholder(r, f).catch(() => {}))
      )
    );
  }

  /** Placeholder: replace with real createNotification backend wrapper. */
  async _sendNotificationPlaceholder(_recipient, _file) {
    // No-op stub so UI flow completes without globule.
    // Hook up your resource/notification backend here when it’s ready.
    return;
  }
}

customElements.define("globular-share-resource-wizard", ShareResourceWizard);

// =====================================================================
// Helpers: safe get + merge for PermissionVM-ish objects
// =====================================================================

async function safeGetPermissions(path, resourceType) {
  try {
    const perms = await getResourcePermissions(path, resourceType);
    const vm = perms ? toPermissionsVM(perms) : null;
    if (vm && typeof vm === "object") {
      vm.path = vm.path || path;
      vm.resourceType = vm.resourceType || resourceType;
    }
    return vm;
  } catch {
    // Create an empty VM if none exists
    return { owners: undefined, allowed: [], denied: [], path, resourceType };
  }
}

/**
 * Merge existing PermissionVM with new VM from the wizard.
 * - owners: keep existing unless new specifies owners
 * - allowed/denied: union by name + fqid (accounts, groups, apps, orgs, peers)
 */
function mergePermissionVM(base, delta) {
  const out = {
    path: base.path || delta.path,
    resourceType: base.resourceType || delta.resourceType || "file",
    owners: delta.owners ?? base.owners,
    allowed: [],
    denied: [],
  };

  const mergeLane = (a = [], b = []) => {
    const byName = new Map();
    a.forEach((p) => byName.set(p.name, clonePerm(p)));
    b.forEach((p) => {
      const cur = byName.get(p.name) || emptyPerm(p.name);
      byName.set(p.name, unionPerm(cur, p));
    });
    return [...byName.values()];
  };

  out.allowed = mergeLane(base.allowed, delta.allowed);
  out.denied = mergeLane(base.denied, delta.denied);
  return out;
}

function emptyPerm(name) {
  return { name, accounts: [], groups: [], applications: [], organizations: [], peers: [] };
}
function clonePerm(p) {
  return {
    name: p.name,
    accounts: [...(p.accounts || [])],
    groups: [...(p.groups || [])],
    applications: [...(p.applications || [])],
    organizations: [...(p.organizations || [])],
    peers: [...(p.peers || [])],
  };
}
function union(listA = [], listB = []) {
  const s = new Set(listA);
  listB.forEach((x) => s.add(x));
  return [...s];
}
function unionPerm(a, b) {
  return {
    name: a.name,
    accounts: union(a.accounts, b.accounts),
    groups: union(a.groups, b.groups),
    applications: union(a.applications, b.applications),
    organizations: union(a.organizations, b.organizations),
    peers: union(a.peers, b.peers),
  };
}