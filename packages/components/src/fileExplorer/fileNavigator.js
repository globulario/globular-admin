// components/fileNavigator.js — rebuilt using the working logic from File.js
// and wired to your newer wrappers

import getUuidByString from "uuid-by-string";
import { Backend } from "@globular/backend";
import { displayError, displayMessage } from "@globular/backend";

// FS wrappers
import {
  readDir,            // (path, { refresh }?) => Promise<DirVM>
  getFile,            // (path, thumbW?, thumbH?) => Promise<FileVM>
  markAsPublic,       // (vm) => void
  markAsShare,        // (vm) => void
  listPublicDirs,     // () => Promise<string[]>
} from "@globular/backend";

// RBAC wrappers
import { getAccount, getCurrentAccount } from "@globular/backend";
import { getSharedResources, SubjectType } from "@globular/backend";

// VM helpers
import {
  pathOf,
  nameOf,
  mimeOf,
  isDir,
  filesOf as getFiles,
  adaptDirVM,
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
const isSyntheticPublic = (vm) => {
  if (!vm) return false;
  if (vm.__syntheticRoot) return true;
  const p = pathOf(vm);
  return p === "/public" || p === "/shared";
};

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
  _publicDirPaths = new Set();
  _sharedDirPaths = new Set();

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
        background: var(--scroll-track, var(--surface-color));
      }
      #file-navigator-div::-webkit-scrollbar-thumb {
        background: var(--scroll-thumb, var(--palette-divider));
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
    const isPublicDir = isSyntheticPublic(dirVM);

    // Seed "My Files" root once; don't flush sections on navigation.
    if (!isPublicDir) {
      if (!this._domRefs.userFilesDiv.__vmRoots) this._domRefs.userFilesDiv.__vmRoots = [];
      if (!this._domRefs.userFilesDiv.__vmRoots.find(v => pathOf(v) === pathOf(dirVM))) {
        this._domRefs.userFilesDiv.__vmRoots.push(dirVM);
        this._initTreeView(dirVM, this._domRefs.userFilesDiv, 0);
      }
    }

    // Public once
    if (!this._domRefs.publicFilesDiv.__initialized) {
      await this._initPublic();
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

    const isPublicRoot = key === "/public";
    const isSharedPath = key === "/shared" || key.startsWith("/shared/");

    // ---------------- PUBLIC SECTION ----------------
    if (isPublicRoot) {
      // We rebuild the entire Public section, so clear its cache & DOM.
      this._purgeCachedPaths("/public");

      this._domRefs.publicFilesDiv.innerHTML = "";
      this._domRefs.publicFilesDiv.__initialized = false;

      await this._initPublic();

      callback && callback();
      return;
    }

    // ---------------- SHARED SECTION ----------------
    if (isSharedPath) {
      // Shared is grouped under a synthetic /shared root, rebuild whole section.
      this._purgeCachedPaths("/shared");

      this._domRefs.sharedFilesDiv.innerHTML = "";
      this._domRefs.sharedFilesDiv.__initialized = false;
      this._domRefs.sharedFilesDiv.__populated = false;

      await this._initShared();
      this._domRefs.sharedFilesDiv.__initialized = true;

      callback && callback();
      return;
    }

    // ---------------- USER FILES SECTION ----------------
    if (!cached) {
      console.warn(`Attempted to reload non-cached directory: ${key}`);
      callback && callback();
      return;
    }

    // 1) Remove old DOM nodes for *this* dir (row + children container)
    const row = this.shadowRoot.getElementById(cached.id);
    const filesDiv = this.shadowRoot.getElementById(`${cached.id}_files_div`);

    if (row && row.parentElement) {
      row.parentElement.removeChild(row);
    }
    if (filesDiv && filesDiv.parentElement) {
      filesDiv.parentElement.removeChild(filesDiv);
    }

    // 2) Purge this directory AND all its descendants from the cache
    this._purgeCachedPaths(key);

    // 3) Re-append it under the same parent container at the same level
    const parentDiv =
      this.shadowRoot.getElementById(cached.parentId) ||
      this._domRefs.userFilesDiv; // fallback: root "My Files" section

    this._initTreeView(dirVM, parentDiv, cached.level);

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
    const syntheticPublic = isSyntheticPublic(dirVM);
    const allowDrops = !syntheticPublic;

    // mark build status on the container so we don't wipe it accidentally
    filesDiv.__built = false;

    const buildChildrenIfNeeded = async () => {
      if (filesDiv.__built) return;

      // Load children if needed
      if (!isSyntheticPublic(dirVM) && !getFiles(dirVM).length) {
        try {
          this._fileExplorer?.displayWaitMessage?.(`Loading ${nameOf(dirVM)}…`);
          const updated = await readDir(path);
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
      if (allowDrops) {
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
      }

      // Click to open folder in explorer
      dirLnk.addEventListener("click", async (evt) => {
        evt.stopPropagation();

        if (syntheticPublic) {
          await toggleSubdirs(true);
          if (path === "/public") {
            this._fileExplorer?.publishSetDirEvent?.("/public");
          } else if (path === "/shared" || dirVM?.__syntheticRoot === "shared-root") {
            if (this._sharedRootVM) {
              const adapted = adaptDirVM(this._sharedRootVM);
              const explorerId = this._fileExplorer?._id || this._fileExplorer?.id;
              Backend.eventHub.publish(
                "__set_dir_event__",
            { dir: adapted, file_explorer_id: explorerId, displayPath: "/Shared" },
                true
              );
            } else {
              this._fileExplorer?.publishSetDirEvent?.("/shared");
            }
          } else if (dirVM?.__syntheticRoot === "shared-owner") {
            const adapted = adaptDirVM(dirVM);
            const explorerId = this._fileExplorer?._id || this._fileExplorer?.id;
            Backend.eventHub.publish(
              "__set_dir_event__",
              {
                dir: adapted,
                file_explorer_id: explorerId,
                displayPath: dirVM.__syntheticPublicPath || path,
              },
              true
            );
          }
          this._selectRow(path);
          if (this._fileExplorer?._informationsManager?.parentNode) {
            this._fileExplorer._informationsManager.style.display = "none";
          }
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
    if (this._domRefs.publicFilesDiv.__initializingPromise) {
      try {
        await this._domRefs.publicFilesDiv.__initializingPromise;
      } catch {
        // ignore, a retry will happen below
      }
      if (this._domRefs.publicFilesDiv.__initialized) return;
    }

    // Subscribe to permission changes once
    const topic = "public_change_permission_event";
    subscribeOnce.call(this, this._listeners, topic, topic, async () => {
      this._domRefs.publicFilesDiv.__initialized = false;
      await this._initPublic();
    });

    const initPromise = (async () => {
      this._domRefs.publicFilesDiv.innerHTML = "";
      // Purge synthetic /public root and every previously rendered public directory subtree
      this._purgeCachedPaths("/public");
      if (this._publicDirPaths && this._publicDirPaths.size) {
        for (const p of this._publicDirPaths) {
          this._purgeCachedPaths(p);
        }
        this._publicDirPaths.clear();
      }
      this._fileExplorer?.resetPublicAliasMap?.();

      try {
        const paths = await listPublicDirs();
        const children = await Promise.all(
          paths.map(async (p) => {
            try {
              const dir = await readDir(p);
              markAsPublic(dir);
              dir.name = nameOf(dir) || (p.split("/").pop() || p);
              const aliasBase = `/public/${dir.name}`.replace(/\/{2,}/g, "/").replace(/\/$/, "");
              dir.__syntheticPublicPath = aliasBase;
              this._fileExplorer?.registerPublicAlias?.(p, aliasBase);
              return dir;
            } catch (err) {
              const fallback = {
                name: p.split("/").pop() || p,
                path: p,
                isDir: true,
                mime: "inode/directory",
                files: [],
              };
              markAsPublic(fallback);
              const aliasBase = `/public/${fallback.name}`.replace(/\/{2,}/g, "/").replace(/\/$/, "");
              fallback.__syntheticPublicPath = aliasBase;
              this._fileExplorer?.registerPublicAlias?.(p, aliasBase);
              return fallback;
            }
          })
        );

        const publicRoot = {
          name: "Public",
          path: "/public",
          isDir: true,
          mime: "synthetic/public-root",
          files: children,
        };
        publicRoot.__syntheticRoot = "public";
        markAsPublic(publicRoot);
        children.forEach((dir) => {
          const p = pathOf(dir);
          if (p) this._publicDirPaths.add(p);
        });

        this._initTreeView(publicRoot, this._domRefs.publicFilesDiv, 0);
        this._domRefs.publicFilesDiv.__initialized = true;
      } catch (e) {
        console.error("Failed to initialize public dirs:", e);
        displayError(`Failed to load public directories: ${e?.message || e}`, 3000);
        this._domRefs.publicFilesDiv.__initialized = false;
        throw e;
      }
    })();

    this._domRefs.publicFilesDiv.__initializingPromise = initPromise;
    try {
      await initPromise;
    } finally {
      this._domRefs.publicFilesDiv.__initializingPromise = null;
    }
  }

  _purgeCachedPaths(prefix) {
    if (!prefix) return;
    const normalized =
      prefix === "/"
        ? "/"
        : prefix.replace(/\/+$/, "");
    const shouldDelete =
      normalized === "/"
        ? () => true
        : (k) => k === normalized || k.startsWith(`${normalized}/`);
    Array.from(this._dirsCache.keys()).forEach((k) => {
      if (shouldDelete(k)) {
        this._dirsCache.delete(k);
      }
    });
  }

  /* ------------------------------ Shared ------------------------------ */

  async _initShared() {
    if (this._domRefs.sharedFilesDiv.__populated) return;
    if (this._domRefs.sharedFilesDiv.__initializingPromise) {
      try {
        await this._domRefs.sharedFilesDiv.__initializingPromise;
      } catch {
        // ignore and retry
      }
      if (this._domRefs.sharedFilesDiv.__populated) return;
    }

    const acc = getCurrentAccount();
    this._sharedRootVM = makeRoot("Shared", "/shared");
    this._sharedRootVM.__syntheticPublicPath = "/shared";
    this._sharedRootVM.__syntheticRoot = "shared-root";

    if (!acc || acc.id === "guest") {
      this._initTreeView(this._sharedRootVM, this._domRefs.sharedFilesDiv, 0);
      this._domRefs.sharedFilesDiv.__populated = true;
      return;
    }
    const subject = `${acc.id}@${acc.domain}`;
    const normalizeId = (val) =>
      (val || "")
        .toString()
        .trim()
        .replace(/\s+/g, "")
        .toLowerCase();
    const normalizedSubject = normalizeId(subject);

    const topic = `${subject}_change_permission_event`;
    subscribeOnce.call(this, this._listeners, topic, topic, async () => {
      this._domRefs.sharedFilesDiv.__populated = false;
      this._domRefs.sharedFilesDiv.__initialized = false;
      await this._initShared();
    });

    const normalizeSegment = (val, fallback) => {
      let out = String(val ?? "").trim();
      if (!out) out = fallback || "shared";
      out = out.replace(/[^0-9a-zA-Z@._-]+/g, "_");
      return out || "shared";
    };
    const getShareList = (share, getterName, fallbackProp) => {
      try {
        const getter = share?.[getterName];
        if (typeof getter === "function") {
          const list = getter.call(share);
          if (Array.isArray(list)) return list.slice();
        }
      } catch {}
      const fallback = share?.[fallbackProp];
      return Array.isArray(fallback) ? fallback.slice() : [];
    };
    const extractOwnerFromPath = (realPath) => {
      if (!realPath) return null;
      const normalizedPath = realPath.replace(/\/{2,}/g, "/");
      if (!normalizedPath.startsWith("/users/")) return null;
      const parts = normalizedPath.split("/");
      return parts.length > 2 ? parts[2] : null;
    };

    const initPromise = (async () => {
      this._domRefs.sharedFilesDiv.innerHTML = "";
      this._purgeCachedPaths("/shared");
      if (this._sharedDirPaths?.size) {
        for (const p of this._sharedDirPaths) this._purgeCachedPaths(p);
        this._sharedDirPaths.clear();
      }
      this._fileExplorer?.resetPublicAliasMap?.("/shared");

      let items = [];
      try {
        items = await getSharedResources("", subject, SubjectType.ACCOUNT);
      } catch (err) {
        const msg = String(err?.message || err);
        if (!msg.includes("no account exist with id")) {
          throw err;
        }
        items = [];
      }

      try {
        const perOwner = {};

        const ensureOwnerTopic = (ownerKey) => {
          const topicName = `${ownerKey}_change_permission_event`;
          subscribeOnce.call(this, this._listeners, topicName, topicName, async () => {
            this._domRefs.sharedFilesDiv.__populated = false;
            this._domRefs.sharedFilesDiv.__initialized = false;
            await this._initShared();
          });
        };

        const ensureOwnerEntry = async (candidate) => {
          if (!candidate?.id) return null;
          const ownerKey = `${candidate.type || "account"}:${candidate.id}`;
          if (perOwner[ownerKey]) return perOwner[ownerKey];

          let ownerDisplay = candidate.id;
          if (candidate.type === "account") {
            try {
              const ownerAcc = await getAccount(candidate.id);
              ownerDisplay =
                ownerAcc?.displayName ||
                (typeof ownerAcc?.getDisplayName === "function" ? ownerAcc.getDisplayName() : "") ||
                ownerAcc?.name ||
                (typeof ownerAcc?.getName === "function" ? ownerAcc.getName() : "") ||
                ownerDisplay;
            } catch (_) { /* fallback to raw id */ }
          }

          const safeDisplay = ownerDisplay.replace(/\//g, "-");
          const ownerAliasBase = `/Shared/${safeDisplay}`.replace(/\/{2,}/g, "/");

          perOwner[ownerKey] = {
            name: ownerDisplay,
            path: ownerAliasBase,
            isDir: true,
            files: [],
            __syntheticPublicPath: ownerAliasBase,
            __syntheticRoot: "shared-owner",
            __aliasBase: ownerAliasBase,
            __ownerKey: ownerKey,
            __ownerType: candidate.type || "account",
            __ownerId: candidate.id,
          };

          ensureOwnerTopic(ownerKey);
          return perOwner[ownerKey];
        };

        const buildSyntheticPath = (ownerEntry, realPath, resourceName) => {
          if (!ownerEntry || !realPath) return ownerEntry?.__syntheticPublicPath || "/Shared";
          const aliasInfo = this._fileExplorer?._syntheticAliasInfoForRealPath?.(realPath);
          let suffix = aliasInfo?.remainder || "";
          if (!suffix) {
            let fallback = resourceName;
            if (!fallback) {
              const parts = realPath.split("/").filter((s) => s.length);
              fallback = parts[parts.length - 1] || "shared-item";
            }
            fallback = normalizeSegment(fallback, "shared-item");
            suffix = `/${fallback}`;
          }
          if (!suffix.startsWith("/")) suffix = `/${suffix}`;
          const synthetic = `${ownerEntry.__syntheticPublicPath}${suffix}`.replace(/\/{2,}/g, "/");
          this._fileExplorer?.registerPublicAlias?.(realPath, synthetic);
          this._sharedDirPaths.add(realPath);
          return synthetic;
        };

        const loadSharedNode = async (realPath) => {
          if (!realPath) return null;
          try {
            const dir = await readDir(realPath);
            markAsShare(dir);
            return dir;
          } catch (err) {
            const msg = String(err?.message || err);
            if (msg.includes("is not a directory")) {
              try {
                return await getFile(realPath, 100, 64);
              } catch (e2) {
                console.warn("Shared file fallback failed:", e2);
              }
            } else {
              console.warn("Shared resource read failed:", err);
            }
          }
          return null;
        };

        const pickOwnerCandidate = (share) => {
          const sequences = [
            { list: share?.getAccountsList?.(), type: "account" },
            { list: share?.getGroupsList?.(), type: "group" },
            { list: share?.getApplicationsList?.(), type: "application" },
            { list: share?.getOrganizationsList?.(), type: "organization" },
            { list: share?.getPeersList?.(), type: "peer" },
          ];
          for (const seq of sequences) {
            if (!Array.isArray(seq.list)) continue;
            const found = seq.list.find(
              (val) => val && normalizeId(val) !== normalizedSubject
            );
            if (found) return { id: found, type: seq.type };
          }
          return null;
        };

        for (const sr of items) {
          const realPath =
            sr?.path || (typeof sr?.getPath === "function" ? sr.getPath() : "") || "";
          if (!realPath) continue;

          const ownerFromPath = extractOwnerFromPath(realPath);
          if (ownerFromPath && normalizeId(ownerFromPath) === normalizedSubject) {
            continue;
          }

          let candidate = null;
          if (ownerFromPath) {
            candidate = { id: ownerFromPath, type: "account" };
          } else {
            candidate = pickOwnerCandidate(sr);
          }
          if (!candidate?.id || normalizeId(candidate.id) === normalizedSubject) {
            continue;
          }

          const accounts = getShareList(sr, "getAccountsList", "accounts");
          if (
            accounts.length &&
            ownerFromPath &&
            !accounts.some((acct) => normalizeId(acct) === normalizeId(ownerFromPath))
          ) {
            continue;
          }

          const ownerEntry = await ensureOwnerEntry(candidate);
          if (!ownerEntry) continue;

          const node = await loadSharedNode(realPath);
          if (!node) continue;

          const syntheticPath = buildSyntheticPath(ownerEntry, realPath, node?.name);
          node.__syntheticPublicPath = syntheticPath;

          if (!ownerEntry.files.find((f) => f.path === realPath)) {
            ownerEntry.files.push(node);
          }
        }

        const ownerList = Object.values(perOwner).sort((a, b) =>
          (a.name || "").localeCompare(b.name || "")
        );
        this._sharedRootVM.files = ownerList;
        markAsShare(this._sharedRootVM);
        this._initTreeView(this._sharedRootVM, this._domRefs.sharedFilesDiv, 0);
        this._domRefs.sharedFilesDiv.__populated = true;
        this._domRefs.sharedFilesDiv.__initialized = true;
      } catch (e) {
        console.error("Failed to initialize shared resources:", e);
        displayError(`Failed to load shared resources: ${e?.message || e}`, 3000);
        this._domRefs.sharedFilesDiv.__populated = false;
        throw e;
      }
    })();

    this._domRefs.sharedFilesDiv.__initializingPromise = initPromise;
    try {
      await initPromise;
    } finally {
      this._domRefs.sharedFilesDiv.__initializingPromise = null;
    }
  }
}

customElements.define("globular-file-navigator", FileNavigator);