// components/fileNavigator.js

import getUuidByString from "uuid-by-string";
import { Backend } from "../../backend/backend.js";
import { displayError, displayMessage } from "../../backend/ui/notify.js";

// ✅ new wrappers (JS files)
import {
  readDir,            // (path, { refresh }?) => Promise<FileInfo>
  getFile,            // (path, thumbW?, thumbH?) => Promise<FileInfo>
  validateDirAccess,  // (dir) => boolean
  markAsPublic,       // (fileInfo) => void
  markAsShare,        // (fileInfo) => void
  listPublicDirs,     // () => Promise<string[]>
} from "../../backend/files.js";

import { getAccount, currentAccount } from "../../backend/rbac/accounts.js";
import { getSharedResources, SubjectType } from "../../backend/rbac/permissions.js";

// Protobuf type (runtime class is fine in JS)
import { FileInfo } from "globular-web-client/file/file_pb";

// UI deps
import "@polymer/paper-spinner/paper-spinner.js";
import "@polymer/paper-input/paper-input.js";
import "@polymer/paper-button/paper-button.js";
import "@polymer/iron-icon/iron-icon.js";
import "@polymer/paper-ripple/paper-ripple.js";

export class FileNavigator extends HTMLElement {
  _path = undefined;
  _fileExplorer = undefined;
  _listeners = new Map();
  _dirsCache = new Map();

  _domRefs = {};

  constructor() {
    super();
    this.attachShadow({ mode: "open" });

    this._initializeLayout();
    this._cacheDomElements();
    this._setupPeerSelector(); // optional; hidden if Backend.getPeers() absent/empty
  }

  disconnectedCallback() {
    for (const [eventName, uuid] of this._listeners.entries()) {
      Backend.eventHub.unsubscribe(eventName, uuid);
    }
    this._listeners.clear();
  }

  // Allow explorer to wire itself in
  set fileExplorer(explorer) {
    this._fileExplorer = explorer;
  }

  // ---------- DOM / Layout ----------

  _initializeLayout() {
    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: flex; flex-direction: column; width: 100%; height: 100%;
          user-select: none; background-color: var(--surface-color); color: var(--primary-text-color);
        }
        #file-navigator-div { min-width: 360px; flex-grow: 1; display: flex; flex-direction: column; overflow-y: auto; }
        select {
          padding: 8px; background: var(--surface-color); color: var(--primary-text-color);
          font-size: 1.0rem; font-family: var(--font-family); width: 100%; border: none; outline: none;
          margin-bottom: 10px; border-bottom: 1px solid var(--palette-divider);
        }
        .section-header {
          font-weight: bold; padding: 8px 10px; background: var(--surface-color-dark, #f0f0f0);
          margin-top: 10px; border-top: 1px solid var(--palette-divider);
        }
        .directory-item {
          display:flex; align-items:center; padding:5px 0; margin-left:0; position:relative; cursor:pointer;
        }
        .directory-item:hover { background-color: var(--paper-grey-100, #f5f5f5); }
        .directory-item iron-icon { height:24px; width:24px; --iron-icon-fill-color: var(--palette-action-disabled); flex-shrink:0; }
        .folder-name-span { margin-left:5px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; flex-grow:1; }
        .expand-toggle { margin-right:5px; cursor:pointer; }
        .folder-icon { margin-right:5px; }
        .directory-lnk { display:flex; align-items:center; flex-grow:1; overflow:hidden; }
        .directory-sub-files { display:none; flex-direction:column; }
        .directory-item.drag-over { box-shadow:0 0 5px 2px var(--primary-color); background: var(--primary-light-color); }
        .directory-item.drag-over .folder-icon { --iron-icon-fill-color: var(--primary-color); }
      </style>

      <div id="file-navigator-div">
        <select id="peer-select"></select>
        <div class="section-header">My Files</div>
        <div id="user-files-div"></div>
        <div class="section-header">Shared with me</div>
        <div id="shared-files-div"></div>
        <div class="section-header">Public</div>
        <div id="public-files-div"></div>
      </div>
    `;
  }

  _cacheDomElements() {
    this._domRefs.fileNavigatorDiv = this.shadowRoot.querySelector("#file-navigator-div");
    this._domRefs.peerSelect = this.shadowRoot.querySelector("#peer-select");
    this._domRefs.userFilesDiv = this.shadowRoot.querySelector("#user-files-div");
    this._domRefs.sharedFilesDiv = this.shadowRoot.querySelector("#shared-files-div");
    this._domRefs.publicFilesDiv = this.shadowRoot.querySelector("#public-files-div");
  }

  _setupPeerSelector() {
    // optional in new stack
    const peers = (Backend.getPeers && Backend.getPeers()) || [];

    this._domRefs.peerSelect.innerHTML = "";
    if (!peers.length) {
      this._domRefs.peerSelect.style.display = "none";
      return;
    }

    peers.forEach((p, index) => {
      const opt = document.createElement("option");
      opt.value = String(index);
      opt.textContent = p.address || p.name || `peer-${index + 1}`;
      opt._peer = p;
      this._domRefs.peerSelect.appendChild(opt);
    });

    this._domRefs.peerSelect.addEventListener("change", (e) => {
      const idx = parseInt(e.target.value, 10);
      const selected = peers[idx];
      if (selected && this._fileExplorer?.setPeer) {
        this._fileExplorer.setPeer(selected);
      }
      // Clear UI + caches on peer switch
      this._domRefs.userFilesDiv.innerHTML = "";
      this._dirsCache.clear();
    });

    // default to first
    this._domRefs.peerSelect.value = "0";
    this._domRefs.peerSelect.dispatchEvent(new Event("change"));
  }

  // ---------- Visibility ----------

  hide() { this.style.display = "none"; }
  show() { this.style.display = ""; }

  // ---------- Public entrypoint ----------

  /**
   * Build the tree for the given directory.
   */
  async setDir(dir, callback) {
    if (!validateDirAccess(dir)) {
      console.warn(`Access denied for directory: ${dir.getPath()}`);
      callback && callback();
      return;
    }

    this._path = dir.getPath();

    // Reset sections
    this._domRefs.userFilesDiv.innerHTML = "";
    this._domRefs.publicFilesDiv.innerHTML = "";
    this._domRefs.sharedFilesDiv.innerHTML = "";
    this._dirsCache.clear();

    // User root
    this._initTreeView(dir, this._domRefs.userFilesDiv, 0);

    // Public + Shared
    await this._initPublic();
    await this._initShared();

    callback && callback();
  }

  /**
   * Reload a specific subtree.
   */
  async reload(dir, callback) {
    const key = dir.getPath();
    const cached = this._dirsCache.get(key);
    if (!cached) {
      console.warn(`Attempted to reload non-cached directory: ${dir.getPath()}`);
      callback && callback();
      return;
    }

    // Remove existing DOM nodes for that dir
    const parentDiv = this.shadowRoot.querySelector(`#${cached.parentId}`);
    if (parentDiv) {
      const node = parentDiv.querySelector(`#${cached.id}`);
      node?.parentElement?.removeChild(node);
      const filesDiv = this.shadowRoot.querySelector(`#${cached.id}_files_div`);
      filesDiv?.parentElement?.removeChild(filesDiv);
    }
    this._dirsCache.delete(key);

    // Re-append
    if (dir.getPath() !== "/public") {
      this._initTreeView(dir, this._domRefs.userFilesDiv, cached.level);
    } else {
      await this._initPublic();
    }
    callback && callback();
  }

  // ---------- Tree rendering ----------

  _initTreeView(dir, parentDiv, level) {
    // Skip hidden / HLS
    if (dir.getName().startsWith(".") || dir.getMime() === "video/hls-stream") return;
    if (!parentDiv) return;

    const id = `nav-dir-${getUuidByString(dir.getPath()).replace(/-/g, "_")}`;
    if (this._dirsCache.has(dir.getPath())) return;

    if (!parentDiv.id) parentDiv.id = `nav-parent-${Math.random().toString(36).slice(2)}`;
    this._dirsCache.set(dir.getPath(), { id, level, parentId: parentDiv.id });

    // Friendly name for user's root
    let displayName = dir.getName();
    const acc = currentAccount && currentAccount();
    if (acc && dir.getPath().startsWith(`/users/${acc.id}@`)) {
      displayName = acc.displayName || acc.name || displayName;
    }

    const pad = 10 * level;
    const html = `
      <div id="${id}" class="directory-item" style="padding-left:${pad}px;">
        <iron-icon id="${id}_expand_btn" icon="icons:chevron-right" class="expand-toggle" style="--iron-icon-fill-color:var(--palette-action-disabled);"></iron-icon>
        <iron-icon id="${id}_shrink_btn" icon="icons:expand-more" class="expand-toggle" style="--iron-icon-fill-color:var(--palette-action-active); display:none;"></iron-icon>
        <div class="directory-lnk" id="${id}_directory_lnk">
          <iron-icon id="${id}_directory_icon" icon="icons:folder" class="folder-icon"></iron-icon>
          <span class="folder-name-span" title="${displayName}">${displayName}</span>
        </div>
        <paper-ripple recenters></paper-ripple>
      </div>
      <div id="${id}_files_div" class="directory-sub-files"></div>
    `;
    const tmp = document.createElement("div");
    tmp.innerHTML = html;
    parentDiv.appendChild(tmp.firstElementChild);
    parentDiv.appendChild(tmp.lastElementChild);

    const expandBtn = this.shadowRoot.getElementById(`${id}_expand_btn`);
    const shrinkBtn = this.shadowRoot.getElementById(`${id}_shrink_btn`);
    const dirLnk = this.shadowRoot.getElementById(`${id}_directory_lnk`);
    const dirIco = this.shadowRoot.getElementById(`${id}_directory_icon`);
    const filesDiv = this.shadowRoot.getElementById(`${id}_files_div`);

    const toggleSubdirs = async (expand) => {
      if (expand) {
        try {
          if (!dir.getFilesList().length) {
            this._fileExplorer?._displayWaitMessage?.(`Loading ${dir.getName()}…`);
            const updated = await readDir(dir.getPath(), { refresh: true });
            dir.setFilesList(updated.getFilesList());
          }
        } catch (e) {
          console.error(`Failed to load subdirectories for ${dir.getPath()}:`, e);
        } finally {
          this._fileExplorer?._resumeUI?.();
        }

        filesDiv.innerHTML = "";
        let hasSubdir = false;
        dir.getFilesList().forEach((f) => {
          if (f.getIsDir()) {
            this._initTreeView(f, filesDiv, level + 1);
            hasSubdir = true;
          }
        });
        if (expandBtn) expandBtn.style.visibility = hasSubdir ? "visible" : "hidden";

        if (shrinkBtn) shrinkBtn.style.display = "block";
        if (expandBtn) expandBtn.style.display = "none";
        filesDiv.style.display = "flex";
        if (dirIco) dirIco.icon = "icons:folder-open";
      } else {
        if (shrinkBtn) shrinkBtn.style.display = "none";
        if (expandBtn) expandBtn.style.display = "block";
        filesDiv.style.display = "none";
        if (dirIco) dirIco.icon = "icons:folder";
      }
    };

    if (expandBtn) {
      expandBtn.addEventListener("click", (e) => { e.stopPropagation(); toggleSubdirs(true); });
      const hasInitialSubdirs = dir.getFilesList().some((f) => f.getIsDir());
      expandBtn.style.visibility = hasInitialSubdirs ? "visible" : "hidden";
    }
    if (shrinkBtn) shrinkBtn.addEventListener("click", (e) => { e.stopPropagation(); toggleSubdirs(false); });

    // Drag & drop onto folder
    if (dirLnk) {
      dirLnk.addEventListener("dragover", (evt) => {
        evt.preventDefault();
        if (dirIco) dirIco.icon = "icons:folder-open";
        dirLnk.closest(".directory-item")?.classList.add("drag-over");
      });

      dirLnk.addEventListener("dragleave", () => {
        if (dirIco) dirIco.icon = "icons:folder";
        dirLnk.closest(".directory-item")?.classList.remove("drag-over");
      });

      dirLnk.addEventListener("drop", async (evt) => {
        evt.stopPropagation();
        evt.preventDefault();
        if (dirIco) dirIco.icon = "icons:folder";
        dirLnk.closest(".directory-item")?.classList.remove("drag-over");

        const filesDataTransfer = evt.dataTransfer?.getData("files");
        const domainDataTransfer = evt.dataTransfer?.getData("domain");
        const urlDataTransfer = evt.dataTransfer?.getData("Url");
        const fileListTransfer = evt.dataTransfer?.files || [];

        try {
          if (urlDataTransfer && urlDataTransfer.startsWith("https://www.imdb.com/title")) {
            displayMessage("IMDb title drop not implemented here.", 2500);
          } else if (fileListTransfer.length > 0) {
            // unified uploader route
            Backend.eventHub.publish(
              "__upload_files_event__",
              { dir, files: Array.from(fileListTransfer), lnk: null },
              true
            );
          } else if (filesDataTransfer && domainDataTransfer) {
            const files = JSON.parse(filesDataTransfer);
            const sourceId = evt.dataTransfer?.getData("id");
            if (files.length > 0) {
              files.forEach((f) => {
                Backend.eventHub.publish(
                  `drop_file_${this._fileExplorer?.id}_event`,
                  { file: f, dir: dir.getPath(), id: sourceId, domain: domainDataTransfer },
                  true
                );
              });
            }
          }
        } catch (e) {
          console.error("Error processing drop:", e);
          displayError("Failed to process dropped item.", 3000);
        }
      });
    }

    // Click to open folder in explorer
    if (dirLnk) {
      dirLnk.addEventListener("click", (evt) => {
        evt.stopPropagation();
        this._fileExplorer?.publishSetDirEvent?.(dir.getPath());
        if (this._fileExplorer?._informationsManager?.parentNode) {
          this._fileExplorer._informationsManager.style.display = "none";
        }
      });
    }
  }

  // ---------- Sections ----------

  async _initPublic() {
    this._domRefs.publicFilesDiv.innerHTML = "";

    const publicRoot = new FileInfo();
    publicRoot.setName("Public");
    publicRoot.setPath("/public");
    publicRoot.setIsDir(true);
    publicRoot.setMime("inode/directory");
    publicRoot.setFilesList([]);

    const pubEvt = "public_change_permission_event";
    if (!this._listeners.has(pubEvt)) {
      const uuid = Backend.eventHub.subscribe(pubEvt, () => {}, () => this._initPublic(), false, this);
      this._listeners.set(pubEvt, uuid);
    }

    try {
      const paths = await listPublicDirs();
      const dirs = await Promise.all(
        paths.map(async (p) => {
          try {
            const d = await readDir(p, { refresh: true });
            markAsPublic(d);
            return d;
          } catch (e) {
            console.warn(`Failed to read public dir ${p}:`, e);
            return null;
          }
        })
      );

      publicRoot.setFilesList(dirs.filter(Boolean));
      this._initTreeView(publicRoot, this._domRefs.publicFilesDiv, 0);
    } catch (e) {
      console.error("Failed to initialize public dirs:", e);
      displayError(`Failed to load public directories: ${e?.message || e}`, 3000);
    }
  }

  async _initShared() {
    this._domRefs.sharedFilesDiv.innerHTML = "";

    const sharedRoot = new FileInfo();
    sharedRoot.setName("Shared");
    sharedRoot.setPath("/shared");
    sharedRoot.setIsDir(true);
    sharedRoot.setMime("inode/directory");
    sharedRoot.setFilesList([]);

    const acc = currentAccount && currentAccount();
    if (!acc || acc.id === "guest") {
      this._initTreeView(sharedRoot, this._domRefs.sharedFilesDiv, 0);
      return;
    }
    const subject = `${acc.id}@${acc.domain}`;

    const evt = `${subject}_change_permission_event`;
    if (!this._listeners.has(evt)) {
      const uuid = Backend.eventHub.subscribe(evt, () => {}, () => this._initShared(), false, this);
      this._listeners.set(evt, uuid);
    }

    try {
      const rsp = await getSharedResources({ subject, type: SubjectType.ACCOUNT });
      const items = rsp.getSharedresourceList();

      const perUser = {};

      await Promise.all(
        items.map(async (sr) => {
          try {
            // Group by resource owner
            const segs = (sr.getPath() || "").split("/");
            const ownerId = segs[2]; // /users/<id>@<domain>/...
            if (!ownerId || ownerId === acc.id || ownerId === subject) return;

            const ownerAcc = await getAccount(ownerId);
            const ownerKey = `/shared/${ownerAcc.getId()}@${ownerAcc.getDomain()}`;
            if (!perUser[ownerKey]) {
              const userDir = new FileInfo();
              userDir.setName(ownerAcc.getDisplayName() || ownerAcc.getName());
              userDir.setPath(ownerKey);
              userDir.setIsDir(true);
              userDir.setFilesList([]);
              perUser[ownerKey] = userDir;
            }

            // Try as directory; else as single file
            let node = null;
            try {
              node = await readDir(sr.getPath(), { refresh: true });
            } catch (e) {
              if (String(e?.message || e).includes("is not a directory")) {
                node = await getFile(sr.getPath(), 100, 64);
              } else {
                throw e;
              }
            }

            if (node) {
              markAsShare(node);
              perUser[ownerKey].getFilesList().push(node);
            }
          } catch (e) {
            console.warn("Shared resource load failed:", e);
          }
        })
      );

      sharedRoot.setFilesList(Object.values(perUser));
      this._initTreeView(sharedRoot, this._domRefs.sharedFilesDiv, 0);
    } catch (e) {
      console.error("Failed to initialize shared resources:", e);
      displayError(`Failed to load shared resources: ${e?.message || e}`, 3000);
    }
  }
}

customElements.define("globular-file-navigator", FileNavigator);
