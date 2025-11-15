// components/fileNavigator.js — rebuilt using the working logic from File.js
// and wired to your newer wrappers

import getUuidByString from "uuid-by-string";
import { Backend } from "../../backend/backend";
import { displayError, displayMessage } from "../../backend/ui/notify";

// FS wrappers
import {
  readDir,            // (path, { refresh }?) => Promise<DirVM>
  getFile,            // (path, thumbW?, thumbH?) => Promise<FileVM>
  markAsPublic,       // (vm) => void
  markAsShare,        // (vm) => void
  listPublicDirs,     // () => Promise<string[]>
} from "../../backend/cms/files";

// RBAC wrappers
import { getAccount, getCurrentAccount } from "../../backend/rbac/accounts";
import { getSharedResources, SubjectType } from "../../backend/rbac/permissions";

// VM helpers
import {
  pathOf,
  nameOf,
  mimeOf,
  isDir,
  filesOf as getFiles,
} from "./filevm-helpers";

// UI deps
import "@polymer/paper-spinner/paper-spinner.js";
import "@polymer/paper-input/paper-input.js";
import "@polymer/paper-button/paper-button.js";
import "@polymer/iron-icon/iron-icon.js";
import "@polymer/paper-ripple/paper-ripple.js";

/* ----------------------------- utils ----------------------------- */

const ensureArray = (a) => (Array.isArray(a) ? a : []);
const setFiles = (vm, children) => (vm.files = ensureArray(children));

function subscribeOnce(map, key, topic, cb) {
  if (map.has(key)) return;
  Backend.eventHub.subscribe(
    topic,
    (uuid) => map.set(key, uuid),
    cb,
    false,
    this
  );
}

function makeRoot(name, path) {
  return { name, path, isDir: true, mime: "inode/directory", files: [] };
}

// Synthetic 'Public' root checker
const isSyntheticPublic = (vm) => pathOf(vm) === "/public";

/* ----------------------------- component ----------------------------- */

export class FileNavigator extends HTMLElement {
  _path = undefined;
  _fileExplorer = undefined;
  _listeners = new Map();
  _dirsCache = new Map();            // path -> { id, level, parentId }
  _expanded = new Set();             // expanded paths
  _selectedPath = null;              // currently selected path

  _domRefs = {};
  _shared = {}; // grouped by "/shared/<userId@domain>"
  _sharedRootVM = null;

  constructor() {
    super();
    this.attachShadow({ mode: "open" });

    this._initializeLayout();
    this._cacheDomElements();
    this._setupPeerSelector(); // hidden if no peers
  }

  disconnectedCallback() {
    for (const [eventName, uuid] of this._listeners.entries()) {
      Backend.eventHub.unsubscribe(eventName, uuid);
    }
    this._listeners.clear();
  }

  set fileExplorer(explorer) { this._fileExplorer = explorer; }
  setFileExplorer(explorer) { this._fileExplorer = explorer; }

  hide() { this.style.display = "none"; }
  show() { this.style.display = ""; }

  /* --------------------------- DOM / Layout --------------------------- */

  _initializeLayout() {
    this.shadowRoot.innerHTML = `
    <style>
      :host {
        display: flex;
        flex-direction: column;
        width: 100%;
        height: 100%;
        user-select: none;
        background-color: var(--surface-color);
        color: var(--primary-text-color);
      }

      /* Scrollbars for modern browsers (element that actually scrolls) */
      #file-navigator-div {
        min-width: 360px;
        flex-grow: 1;
        display: flex;
        flex-direction: column;
        overflow-y: auto;
        border-right: 1px solid var(--palette-divider);
        scrollbar-width: thin;
        scrollbar-color: var(--scroll-thumb, rgba(120,120,120,0.7))
                         var(--scroll-track, rgba(0,0,0,0.05));
      }

      /* Chrome/WebKit scrollbars */
      #file-navigator-div::-webkit-scrollbar {
        width: 10px;
      }
      #file-navigator-div::-webkit-scrollbar-track {
        background: var(--scroll-track, rgba(0,0,0,0.05));
      }
      #file-navigator-div::-webkit-scrollbar-thumb {
        background: var(--scroll-thumb, rgba(120,120,120,0.7));
        border-radius: 6px;
      }

      select {
        padding: 8px;
        background: var(--surface-color);
        color: var(--primary-text-color);
        font-size: 1.0rem;
        font-family: var(--font-family);
        width: 100%;
        border: none;
        outline: none;
        margin-bottom: 10px;
        border-bottom: 1px solid var(--palette-divider);
      }

      .section-header {
        background-color: var(--surface-subheader-color,
                               var(--surface-alt-color, var(--surface-color)));
        color: var(--secondary-text-color, var(--palette-text-secondary));
        font-weight: 600;
        border-bottom: 1px solid var(--palette-divider);
        padding: 6px 8px;
        margin-top: 4px;
        margin-bottom: 2px;
        text-transform: uppercase;
        font-size: 0.85rem;
        letter-spacing: 0.04em;
      }

      .directory-item {
        display: flex;
        align-items: center;
        padding: 5px 0;
        position: relative;
        cursor: pointer;
      }

      .directory-item:hover {
        background-color: var(--list-hover-bg,
                               var(--palette-action-hover, rgba(255,255,255,0.06)));
      }

      .directory-item.selected {
        background-color: var(--list-selected-bg,
                               var(--primary-selected-bg, rgba(0,0,0,0.06)));
      }

      .directory-item iron-icon {
        height: 24px;
        width: 24px;
        --iron-icon-fill-color: var(--on-surface-color, var(--primary-text-color));
        flex-shrink: 0;
      }

      .folder-name-span {
        margin-left: 5px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        flex-grow: 1;
        color: var(--on-surface-color, var(--primary-text-color));
      }

      .expand-toggle {
        margin-right: 5px;
        cursor: pointer;
      }

      .folder-icon {
        margin-right: 5px;
        width: 20px;
        height: 20px;
      }

      .directory-lnk {
        display: flex;
        align-items: center;
        flex-grow: 1;
        overflow: hidden;
      }

      .directory-sub-files {
        display: none;
        flex-direction: column;
      }

      .directory-item.drag-over {
        box-shadow: 0 0 5px 2px var(--primary-color);
        background-color: var(--drag-over-bg,
                               var(--primary-light-color, rgba(25,118,210,0.18)));
      }

      .directory-item.drag-over .folder-icon {
        --iron-icon-fill-color: var(--primary-color);
      }
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

    this._domRefs.peerSelect.addEventListener("change", async (e) => {
      const idx = parseInt(e.target.value, 10);
      const selected = peers[idx];
      if (selected && this._fileExplorer?.setPeer) this._fileExplorer.setPeer(selected);

      // Clear per-peer UI + caches
      this._dirsCache.clear();
      this._expanded.clear();
      this._selectedPath = null;

      // Reset containers
      this._domRefs.userFilesDiv.innerHTML = "";
      this._domRefs.userFilesDiv.__vmRoots = [];

      this._domRefs.sharedFilesDiv.innerHTML = "";
      this._domRefs.sharedFilesDiv.__initialized = false;
      this._domRefs.sharedFilesDiv.__populated = false;

      this._domRefs.publicFilesDiv.innerHTML = "";
      this._domRefs.publicFilesDiv.__initialized = false;
    });

    // default to first
    this._domRefs.peerSelect.value = "0";
    this._domRefs.peerSelect.dispatchEvent(new Event("change"));
  }

  /* ------------------------ Public entrypoint ------------------------ */

  async setDir(dirVM, callback) {
    this._path = pathOf(dirVM);

    // Seed "My Files" root once; don't flush sections on navigation.
    if (!this._domRefs.userFilesDiv.__vmRoots) this._domRefs.userFilesDiv.__vmRoots = [];
    if (!this._domRefs.userFilesDiv.__vmRoots.find(v => pathOf(v) === pathOf(dirVM))) {
      this._domRefs.userFilesDiv.__vmRoots.push(dirVM);
      this._initTreeView(dirVM, this._domRefs.userFilesDiv, 0);
    }

    // Public once
    if (!this._domRefs.publicFilesDiv.__initialized) {
      await this._initPublic();
      this._domRefs.publicFilesDiv.__initialized = true;
    }

    // Shared once
    if (!this._domRefs.sharedFilesDiv.__initialized) {
      await this._initShared();
      this._domRefs.sharedFilesDiv.__initialized = true;
    }

    await this.expandTo(this._path);
    callback && callback();
  }

  async reload(dirVM, callback) {
    const key = pathOf(dirVM);
    const cached = this._dirsCache.get(key);
    if (!cached) {
      console.warn(`Attempted to reload non-cached directory: ${key}`);
      callback && callback();
      return;
    }

    // Remove old DOM nodes
    const parentDiv = this.shadowRoot.querySelector(`#${cached.parentId}`);
    if (parentDiv) {
      const node = parentDiv.querySelector(`#${cached.id}`);
      node?.parentElement?.removeChild(node);
      const filesDiv = this.shadowRoot.querySelector(`#${cached.id}_files_div`);
      filesDiv?.parentElement?.removeChild(filesDiv);
    }
    this._dirsCache.delete(key);

    // Re-append in the same section
    if (key !== "/public" && !key.startsWith("/shared/")) {
      this._initTreeView(dirVM, this._domRefs.userFilesDiv, cached.level);
    } else if (key === "/public") {
      this._domRefs.publicFilesDiv.__initialized = false;
      await this._initPublic();
      this._domRefs.publicFilesDiv.__initialized = true;
    } else {
      this._domRefs.sharedFilesDiv.__initialized = false;
      await this._initShared();
      this._domRefs.sharedFilesDiv.__initialized = true;
    }
    callback && callback();
  }

  /* -------------------------- Tree rendering -------------------------- */

  _initTreeView(dirVM, parentDiv, level) {
    if (!parentDiv) return;
    if (nameOf(dirVM).startsWith(".") || mimeOf(dirVM) === "video/hls-stream") return;

    const path = pathOf(dirVM);
    const id = `nav-dir-${getUuidByString(path).replace(/-/g, "_")}`;
    if (this._dirsCache.has(path)) return;

    if (!parentDiv.id) parentDiv.id = `nav-parent-${Math.random().toString(36).slice(2)}`;
    this._dirsCache.set(path, { id, level, parentId: parentDiv.id });

    // Friendly name for user's root
    let displayName = nameOf(dirVM);
    const acc = getCurrentAccount();
    if (acc && path.startsWith(`/users/${acc.id}@`)) {
      displayName = acc.displayName || acc.name || displayName;
    }

    const pad = 10 * level;
    const html = `
      <div id="${id}" class="directory-item" style="padding-left:${pad}px;">
        <iron-icon id="${id}_expand_btn" icon="icons:chevron-right" class="expand-toggle" style="--iron-icon-fill-color:var(--on-surface-color, var(--primary-text-color));"></iron-icon>
        <iron-icon id="${id}_shrink_btn" icon="icons:expand-more" class="expand-toggle" style="--iron-icon-fill-color:var(--on-surface-color, var(--primary-text-color)); display:none;"></iron-icon>
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
    const rowDiv = this.shadowRoot.getElementById(id);

    // mark build status on the container so we don't wipe it accidentally
    filesDiv.__built = false;

    const buildChildrenIfNeeded = async () => {
      if (filesDiv.__built) return;

      // Load children if needed
      if (!isSyntheticPublic(dirVM) && !getFiles(dirVM).length) {
        try {
          this._fileExplorer?.displayWaitMessage?.(`Loading ${nameOf(dirVM)}…`);
          const updated = await readDir(path, { refresh: true });
          setFiles(dirVM, getFiles(updated));
        } catch (e) {
          console.error(`Failed to load subdirectories for ${path}:`, e);
        } finally {
          this._fileExplorer?.resume?.();
        }
      }

      // Build once
      let hasSubdir = false;
      getFiles(dirVM).forEach((f) => {
        if (isDir(f)) {
          this._initTreeView(f, filesDiv, level + 1);
          hasSubdir = true;
        }
      });

      // show/hide expand based on actual subdirs
      if (expandBtn) expandBtn.style.visibility = hasSubdir ? "visible" : "hidden";
      filesDiv.__built = true;
    };

    const toggleSubdirs = async (expand) => {
      if (expand) {
        await buildChildrenIfNeeded();          // build once, no clearing
        filesDiv.style.display = "flex";
        if (shrinkBtn) shrinkBtn.style.display = "block";
        if (expandBtn) expandBtn.style.display = "none";
        if (dirIco) dirIco.icon = "icons:folder-open";
        this._expanded.add(path);
      } else {
        // just hide; do NOT clear children or they'll be gone due to _dirsCache short-circuit
        filesDiv.style.display = "none";
        if (shrinkBtn) shrinkBtn.style.display = "none";
        if (expandBtn) expandBtn.style.display = "block";
        if (dirIco) dirIco.icon = "icons:folder";
        this._expanded.delete(path);
      }
    };

    // initial visibility for expandBtn
    const hasInitialSubdirs = getFiles(dirVM).some((f) => isDir(f));
    if (expandBtn) expandBtn.style.visibility = hasInitialSubdirs ? "visible" : "hidden";

    // restore expanded state
    if (this._expanded.has(path)) {
      toggleSubdirs(true);
    }

    if (expandBtn) expandBtn.addEventListener("click", (e) => { e.stopPropagation(); toggleSubdirs(true); });
    if (shrinkBtn) shrinkBtn.addEventListener("click", (e) => { e.stopPropagation(); toggleSubdirs(false); });

    // Drag & drop onto folder
    if (dirLnk) {
      dirLnk.addEventListener("dragover", (evt) => {
        evt.preventDefault();
        if (dirIco) dirIco.icon = "icons:folder-open";
        dirLnk.closest(".directory-item")?.classList.add("drag-over");
      });

      dirLnk.addEventListener("dragleave", () => {
        if (!this._expanded.has(path) && dirIco) dirIco.icon = "icons:folder";
        dirLnk.closest(".directory-item")?.classList.remove("drag-over");
      });

      dirLnk.addEventListener("drop", async (evt) => {
        evt.stopPropagation();
        evt.preventDefault();
        if (!this._expanded.has(path) && dirIco) dirIco.icon = "icons:folder";
        dirLnk.closest(".directory-item")?.classList.remove("drag-over");

        const filesDataTransfer = evt.dataTransfer?.getData("files");
        const domainDataTransfer = evt.dataTransfer?.getData("domain");
        const urlDataTransfer = evt.dataTransfer?.getData("Url");
        const fileListTransfer = evt.dataTransfer?.files || [];

        try {
          if (urlDataTransfer && urlDataTransfer.startsWith("https://www.imdb.com/title")) {
            displayMessage("IMDb title drop not implemented here.", 2500);
          } else if (fileListTransfer.length > 0) {
            Backend.eventHub.publish(
              "__upload_files_event__",
              { dir: dirVM, files: Array.from(fileListTransfer), lnk: null },
              true
            );
          } else if (filesDataTransfer && domainDataTransfer) {
            const files = JSON.parse(filesDataTransfer);
            const sourceId = evt.dataTransfer?.getData("id");
            if (files.length > 0) {
              files.forEach((f) => {
                Backend.eventHub.publish(
                  `drop_file_${this._fileExplorer?.id}_event`,
                  { file: f, dir: path, id: sourceId, domain: domainDataTransfer },
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

      // Click to open folder in explorer
      dirLnk.addEventListener("click", (evt) => {
        evt.stopPropagation();

        // Synthetic Public: toggle expand instead of navigating
        if (isSyntheticPublic(dirVM)) {
          const isCollapsed = expandBtn && expandBtn.style.display !== "none";
          toggleSubdirs(isCollapsed);
          this._selectRow(path);
          return;
        }

        // Real directories: navigate normally
        this._fileExplorer?.publishSetDirEvent?.(path);
        this._selectRow(path);
        if (this._fileExplorer?._informationsManager?.parentNode) {
          this._fileExplorer._informationsManager.style.display = "none";
        }
      });
    }

    // Selection restore
    if (this._selectedPath === path && rowDiv) {
      rowDiv.classList.add("selected");
    }
  }

  _selectRow(path) {
    // clear previous
    if (this._selectedPath && this._dirsCache.has(this._selectedPath)) {
      const prev = this._dirsCache.get(this._selectedPath);
      const prevRow = this.shadowRoot.getElementById(prev.id);
      prevRow?.classList.remove("selected");
    }
    this._selectedPath = path;
    const cur = this._dirsCache.get(path);
    const curRow = cur && this.shadowRoot.getElementById(cur.id);
    curRow?.classList.add("selected");
  }

  async expandTo(targetPath) {
    if (!targetPath) return;

    // Walk each ancestor incrementally, expanding as needed
    const parts = targetPath.split("/").filter(Boolean);
    let curPath = targetPath.startsWith("/") ? "/" : "";
    let parentDiv = this._domRefs.userFilesDiv;

    for (let i = 0; i < parts.length; i++) {
      curPath = (curPath === "/" ? "" : curPath) + "/" + parts[i];

      const cached = this._dirsCache.get(curPath);
      if (!cached) {
        // ensure parent expanded so children render
        const parentPath = curPath.substring(0, curPath.lastIndexOf("/")) || "/";
        const parentCached = this._dirsCache.get(parentPath);
        if (parentCached) {
          const filesDiv = this.shadowRoot.getElementById(`${parentCached.id}_files_div`);
          const parentRowExpand = this.shadowRoot.getElementById(`${parentCached.id}_expand_btn`);
          if (filesDiv && parentRowExpand && filesDiv.style.display !== "flex") {
            parentRowExpand.click(); // will load and render children (build once)
          }
        }
        continue;
      } else {
        // expand this node if it’s not expanded
        const filesDiv = this.shadowRoot.getElementById(`${cached.id}_files_div`);
        const expandBtn = this.shadowRoot.getElementById(`${cached.id}_expand_btn`);
        if (filesDiv && expandBtn && filesDiv.style.display !== "flex") {
          expandBtn.click();
        }
        parentDiv = filesDiv || parentDiv;
      }
    }

    // Select target row
    this._selectRow(targetPath);
  }

  /* ------------------------------ Public ------------------------------ */

  async _initPublic() {
    if (this._domRefs.publicFilesDiv.__initialized) return;

    this._domRefs.publicFilesDiv.innerHTML = "";

    // Subscribe to permission changes once
    const topic = "public_change_permission_event";
    subscribeOnce.call(this, this._listeners, topic, topic, async () => {
      // rebuild Public only
      this._domRefs.publicFilesDiv.__initialized = false;
      await this._initPublic();
    });

    try {
      const paths = await listPublicDirs(); // list of real backend directories

      // Build a synthetic root "/public" that only exists client-side
      const publicRoot = {
        name: "Public",
        path: "/public",
        isDir: true,
        mime: "synthetic/public-root",
        files: [],
      };
      markAsPublic(publicRoot);

      // Each child is a *real* backend directory (presented under /public)
      publicRoot.files = await Promise.all(
        paths.map(async (p) => {
          try {
            const d = await readDir(p, { refresh: true });
            markAsPublic(d);
            d.name = nameOf(d) || (p.split("/").pop() || p);
            return d;
          } catch {
            const stub = { name: p.split("/").pop() || p, path: p, isDir: true, mime: "inode/directory", files: [] };
            markAsPublic(stub);
            return stub;
          }
        })
      );

      this._initTreeView(publicRoot, this._domRefs.publicFilesDiv, 0);
      this._domRefs.publicFilesDiv.__initialized = true;
    } catch (e) {
      console.error("Failed to initialize public dirs:", e);
      displayError(`Failed to load public directories: ${e?.message || e}`, 3000);
    }
  }

  /* ------------------------------ Shared ------------------------------ */

  async _initShared() {
    if (this._domRefs.sharedFilesDiv.__populated) return;
    this._domRefs.sharedFilesDiv.innerHTML = "";

    // Root (rendered as a group of owners)
    this._sharedRootVM = makeRoot("Shared", "/shared");

    const acc = getCurrentAccount();
    if (!acc || acc.id === "guest") {
      this._initTreeView(this._sharedRootVM, this._domRefs.sharedFilesDiv, 0);
      this._domRefs.sharedFilesDiv.__populated = true;
      return;
    }
    const subject = `${acc.id}@${acc.domain}`;

    const topic = `${subject}_change_permission_event`;
    subscribeOnce.call(this, this._listeners, topic, topic, async () => {
      // Refresh only Shared section
      this._domRefs.sharedFilesDiv.__populated = false;
      this._domRefs.sharedFilesDiv.__initialized = false;
      await this._initShared();
    });

    try {
      const rsp = await getSharedResources({ subject, type: SubjectType.ACCOUNT });
      const items =
        typeof rsp?.getSharedresourceList === "function"
          ? rsp.getSharedresourceList()
          : Array.isArray(rsp?.sharedResources)
            ? rsp.sharedResources
            : [];

      const perUser = {}; // ownerKey => VM

      const enqueue = async (sr) => {
        const srPath = sr?.path || (typeof sr?.getPath === "function" ? sr.getPath() : "") || "";
        if (!srPath) return;

        // owner id like "<id>@<domain>" from /users/<id>@<domain>/...
        const segs = srPath.split("/");
        const ownerId = segs[2];

        if (!ownerId || ownerId === acc.id || ownerId === subject) return;

        let ownerAcc = null;
        try { ownerAcc = await getAccount(ownerId); } catch (_) { }
        const ownerAccId =
          ownerAcc?.id || (typeof ownerAcc?.getId === "function" ? ownerAcc.getId() : ownerId);
        const ownerAccDomain =
          ownerAcc?.domain || (typeof ownerAcc?.getDomain === "function" ? ownerAcc.getDomain() : (ownerId.split("@")[1] || ""));
        const ownerAccName =
          ownerAcc?.displayName ||
          (typeof ownerAcc?.getDisplayName === "function" ? ownerAcc.getDisplayName() : "") ||
          ownerAcc?.name ||
          (typeof ownerAcc?.getName === "function" ? ownerAcc.getName() : "") ||
          ownerId;

        const ownerKey = `/shared/${ownerAccId}@${ownerAccDomain}`;
        if (!perUser[ownerKey]) {
          perUser[ownerKey] = { name: ownerAccName, path: ownerKey, isDir: true, files: [] };
        }

        try {
          const d = await readDir(srPath, { refresh: true });
          markAsShare(d);
          if (!perUser[ownerKey].files.find((f) => f.path === d.path)) perUser[ownerKey].files.push(d);
        } catch (e) {
          const msg = String(e?.message || e);
          if (msg.includes("is not a directory")) {
            try {
              const f = await getFile(srPath, 100, 64);
              if (f.path.includes("/.hidden/")) {
                let hiddenDir = perUser[ownerKey].files.find((x) => x.name === ".hidden");
                if (!hiddenDir) {
                  hiddenDir = { name: ".hidden", path: `${ownerKey}/.hidden`, isDir: true, mime: "", files: [] };
                  perUser[ownerKey].files.push(hiddenDir);
                }
                if (!hiddenDir.files.find((x) => x.path === f.path)) hiddenDir.files.push(f);
              } else {
                if (!perUser[ownerKey].files.find((x) => x.path === f.path)) perUser[ownerKey].files.push(f);
              }
            } catch (e2) {
              console.warn("Shared file fallback failed:", e2);
            }
          } else {
            console.warn("Shared resource read failed:", e);
          }
        }
      };

      for (const sr of items) await enqueue(sr);

      this._sharedRootVM.files = Object.values(perUser);
      markAsShare(this._sharedRootVM);
      this._initTreeView(this._sharedRootVM, this._domRefs.sharedFilesDiv, 0);
      this._domRefs.sharedFilesDiv.__populated = true;
    } catch (e) {
      console.error("Failed to initialize shared resources:", e);
      displayError(`Failed to load shared resources: ${e?.message || e}`, 3000);
    }
  }
}

customElements.define("globular-file-navigator", FileNavigator);
