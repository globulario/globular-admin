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

  constructor() {
    super();
    this.attachShadow({ mode: "open" });

    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; width: 100%; height: 100%; overflow-y: auto; }
        #container {
          background: var(--surface-color);
          display: flex; flex-direction: column;
        }
        .dragging { opacity: 0.6; }
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
  }

  /* ---------- Active state ---------- */
  setActive(isActive) { this._isActive = isActive; }
  resetActive() { this._isActive = false; }

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

  _handleContainerDrop(evt) {
    evt.preventDefault();
    evt.stopPropagation();

    const filesJson = evt.dataTransfer.getData("files");
    const domainFromDnD = evt.dataTransfer.getData("domain");
    const fileList = evt.dataTransfer.files;

    // Native OS files → upload event
    if (fileList && fileList.length > 0) {
      const currentPath =
        (typeof this.getCurrentPath === "function" && this.getCurrentPath()) ||
        this._path ||
        (this._currentDir && (this._currentDir.getPath?.() || this._currentDir.path)) ||
        "/";

      Backend.eventHub.publish(
        "__upload_files_event__",
        { dir: currentPath, files: Array.from(fileList), lnk: null },
        true
      );
      return;
    }

    // Internal drag payload (legacy contract): files = array of string paths
    if (filesJson) {
      try {
        const files = JSON.parse(filesJson);
        if (!Array.isArray(files) || files.length === 0) return;

        const destPath =
          (typeof this.getCurrentPath === "function" && this.getCurrentPath()) ||
          this._path ||
          (this._currentDir && (this._currentDir.getPath?.() || this._currentDir.path)) ||
          "/";

        const sourceId = evt.dataTransfer.getData("id") ||
          (this._fileExplorer?.id || this._fileExplorer?.id || "");
        const feId = this._fileExplorer?.id || this._fileExplorer?.id || "explorer";
        const domain = domainFromDnD || "";

        // Publish one event per file (legacy)
        files.forEach((fPath) => {
          Backend.eventHub.publish(
            `drop_file_${feId}_event`,
            { file: fPath, dir: destPath, id: sourceId, domain },
            true
          );
        });
      } catch (e) {
        console.error("Error parsing dropped files data:", e);
        displayError("Failed to process dropped files.", 3000);
      }
    }
  }

  _handleContainerDragOver(evt) {
    evt.preventDefault();
    evt.dataTransfer.dropEffect = (evt.ctrlKey || evt.metaKey) ? "copy" : "move";
    (this._fileExplorer?.setAtTop || this._fileExplorer?.setAtTop)?.();
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
