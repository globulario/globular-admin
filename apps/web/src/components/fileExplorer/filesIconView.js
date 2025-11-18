// components/filesIconView.js — DRY with filevm-helper and shared menu from FilesView
import "./fileIconViewSection.js";
import "@polymer/iron-icon/iron-icon.js";
import "./fileIconView.js";
import getUuidByString from "uuid-by-string";
import { Backend } from "../../backend/backend";
import { displayError } from "../../backend/ui/notify";
import { FilesView } from "./filesView.js";

// DRY helpers
import {
  pathOf,
  nameOf,
  mimeOf,
  isDir as isDirOf,
} from "./filevm-helpers.js";

// --- Constants ---
const DEFAULT_IMAGE_HEIGHT = 80;
const DEFAULT_IMAGE_WIDTH = 80;

export class FilesIconView extends FilesView {
  _imageHeight = DEFAULT_IMAGE_HEIGHT;
  _imageWidth = DEFAULT_IMAGE_WIDTH;
  _isActive = false;
  _active = false; // <- add this

  constructor() {
    super();
    this.attachShadow({ mode: "open" });

    this.shadowRoot.innerHTML = `
    <style>
      :host {
        display: block;
        width: 100%;
        height: 100%;
        overflow-y: auto;
        background: var(--surface-color);
        color: var(--primary-text-color);
        scrollbar-width: thin;
        scrollbar-color: var(--scroll-thumb, var(--palette-divider))
                        var(--scroll-track, var(--surface-color));
      }

      /* Chrome/WebKit scrollbars */
      :host::-webkit-scrollbar {
        width: 10px;
      }
      :host::-webkit-scrollbar-track {
        background: var(--scroll-track, var(--surface-color));
      }
      :host::-webkit-scrollbar-thumb {
        background: var(--scroll-thumb, var(--palette-divider));
        border-radius: 6px;
      }



      #container {
        background: var(--surface-color);
        color: var(--primary-text-color);
        display: flex;
        flex-direction: column;
        padding: 8px;
        z-index: 100;
      }

      .dragging {
        opacity: 0.6;
      }
    </style>
    <div id="container" class="no-select">
     
      <slot></slot>
    </div>
  `;
    this.container = this.shadowRoot.querySelector("#container");

    // delegated listeners on container
    this.container.addEventListener("mouseleave", this._handleContainerMouseLeave.bind(this));
    this.container.addEventListener("click", this._handleContainerClick.bind(this));
    this.container.addEventListener("drop", this._handleContainerDrop.bind(this));
    this.container.addEventListener("dragover", this._handleContainerDragOver.bind(this));
    this.container.addEventListener("dragenter", (e) => { e.preventDefault(); });
    this.container.addEventListener("dragleave", (/*e*/) => { });

    // fallback for empty-state: allow dropping anywhere inside host
    this.addEventListener("dragover", this._handleHostDragOver.bind(this));
    this.addEventListener("drop", this._handleHostDrop.bind(this));
  }

  /* ---------- Active state ---------- */
  setActive(isActive) {
    const v = !!isActive;
    this._isActive = v;  // legacy/local
    this._active = v;    // standard flag used by others
  }

  resetActive() {
    this.setActive(false);
  }

  isActive() {
    // single source of truth
    return !!this._active;
  }

  // inside class FilesIconView
  clearSelectionUI() {
    // clear icon views check
    this.querySelectorAll('globular-file-icon-view').forEach(fileIconView => {
      fileIconView.clearSelectionUI?.();
    });
  }

  /* ---------- Container handlers ---------- */

  _handleContainerMouseLeave(evt) {
    evt.stopPropagation();
    this.querySelectorAll("globular-file-icon-view").forEach((v) => v.resetActive?.());
  }

  _handleContainerClick(evt) {
    evt.stopPropagation();
    this.menu?.close?.();
    if (this.menu?.parentNode) this.menu.parentNode.removeChild(this.menu);
  }

  /**
   * Drop anywhere on the icon grid background.
   * This should support:
   * - OS files dropped from the desktop
   * - external URLs (IMDB, etc.)
   * - internal drag from another FileExplorer or from this one
   *
   * We just delegate to FilesView.handleDropEvent so we get the
   * same Copy/Move/Create Link menu logic as the old version.
   */
  _handleContainerDrop(evt) {
    this.handleDropEvent(evt); // method from FilesView
  }


  /**
   * Allow drops over the icon area and hint move/copy mode with cursor.
   */
  _handleContainerDragOver(evt) {
    evt.preventDefault();
    const dt = evt.dataTransfer;
    if (dt) {
      // Ctrl/meta = copy, default = move
      dt.dropEffect = (evt.ctrlKey || evt.metaKey) ? "copy" : "move";
    }

    // Keep same behavior as before – keep the explorer "awake"
    if (this._fileExplorer?.setAtTop) {
      this._fileExplorer.setAtTop();
    }
  }

  _handleHostDragOver(evt) {
    const path = evt.composedPath?.() || [];
    if (path.includes(this.container)) return;
    evt.preventDefault();
    if (evt.dataTransfer) {
      evt.dataTransfer.dropEffect = (evt.ctrlKey || evt.metaKey) ? "copy" : "move";
    }
  }

  _handleHostDrop(evt) {
    const path = evt.composedPath?.() || [];
    if (path.includes(this.container)) return;
    evt.preventDefault();
    evt.stopPropagation();
    this.handleDropEvent(evt);
  }

  /* ---------- Rendering ---------- */

  setDir(dir) {
    if (!dir) return;

    this._currentDir = dir;
    this._path = (typeof dir.getPath === "function" ? dir.getPath() : dir.path) || this._path;

    while (this.firstChild) this.removeChild(this.firstChild);

    const filesList = (typeof dir.getFilesList === "function") ? dir.getFilesList() : (dir.files || []);
    if (!Array.isArray(filesList)) return;

    const sorted = [...filesList].sort((a, b) => {
      const aDir = !!isDirOf(a);
      const bDir = !!isDirOf(b);
      if (aDir && !bDir) return -1;
      if (!aDir && bDir) return 1;
      return (nameOf(a) || "").localeCompare(nameOf(b) || "");
    });

    const byType = { folder: [], video: [], audio: [], image: [], document: [], other: [] };

    for (const f of sorted) {
      const nm = nameOf(f) || "";
      if (nm.startsWith(".") && !nm.startsWith(".hidden")) continue;

      const mime = mimeOf(f) || "";
      const [type, sub] = mime.split("/");

      if (isDirOf(f)) byType.folder.push(f);
      else if (type === "video") byType.video.push(f);
      else if (type === "audio") byType.audio.push(f);
      else if (type === "image") byType.image.push(f);
      else if (type === "text" || sub === "pdf") byType.document.push(f);
      else byType.other.push(f);
    }

    const findByName = (nm) => filesList.find((x) => nameOf(x) === nm) || null;
    dir.__audioPlaylist__ = findByName("audio.m3u");
    dir.__videoPlaylist__ = findByName("video.m3u");

    const order = ["folder", "video", "audio", "image", "document", "other"];

    order.forEach((fileType) => {
      const files = byType[fileType];
      if (!files || files.length === 0) return;

      const section = document.createElement("globular-file-icon-view-section");
      section.id = `${fileType}_section`;
      section.setAttribute("filetype", fileType);
      this.appendChild(section);

      section.init(dir, fileType, this);

      files.forEach((file) => {
        const icon = document.createElement("globular-file-icon-view");
        const p = pathOf(file) || "";
        icon.id = `_${getUuidByString(p || Math.random().toString(36).slice(2))}`;
        icon.setAttribute("height", String(this._imageHeight));
        icon.setAttribute("width", String(this._imageWidth));

        // --- DnD (legacy-compatible) ---
        icon.draggable = true;
        icon.addEventListener("dragstart", (evt) => this._handleFileDragStart(evt, icon, file));
        icon.addEventListener("dragend", (evt) => this._handleFileDragEnd(evt));

        // Let the icon render itself
        icon.setFile(file, this);

        // Context menu helper
        icon.openContextMenu = (anchorEl) => this.showContextMenu?.(anchorEl, file);

        section.appendChild(icon);
      });

      section.updateCount?.();
    });
  }

  /* ---------- Drag helpers ---------- */

  _handleFileDragStart(evt, draggedElement, file) {
    evt.stopPropagation();

    // Build array of PATH STRINGS (legacy contract: array<string>)
    const selectedPaths = Object.keys(this._selected || {});
    const pathsToDrag = selectedPaths.length > 0
      ? selectedPaths
        .map((p) => (this._selected[p]?.path) || p)
        .filter(Boolean)
      : [pathOf(file)].filter(Boolean);

    // Legacy: domain string
    let domain = "";
    try {
      domain =
        (this._fileExplorer?.globule?.domain) ||
        (Backend?.getDomain && Backend.getDomain()) ||
        Backend?.domain ||
        window.location.host ||
        "";
    } catch (e) { /* noop */ }

    // Set payload exactly like legacy File.js expects
    evt.dataTransfer.setData("files", JSON.stringify(pathsToDrag));   // array<string>
    evt.dataTransfer.setData(
      "id",
      (this._fileExplorer?.id || this._fileExplorer?.id || "")       // explorer id (critical)
    );
    evt.dataTransfer.setData("domain", domain);
    evt.dataTransfer.effectAllowed = "copyMove";
    draggedElement.classList.add("dragging");
  }

  _handleFileDragEnd(evt) {
    evt.stopPropagation();
    this.querySelectorAll("globular-file-icon-view.dragging").forEach((el) =>
      el.classList.remove("dragging")
    );
  }
}

customElements.define("globular-files-icon-view", FilesIconView);
