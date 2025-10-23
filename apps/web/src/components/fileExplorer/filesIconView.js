// components/filesIconView.js

import "./fileIconViewSection.js";
import "@polymer/iron-icon/iron-icon.js";
import "./fileIconView.js";
import getUuidByString from "uuid-by-string";
import { Backend } from "../../backend/backend.js";
import { displayError } from "../../backend/ui/notify.js";

// --- Constants ---
const DEFAULT_IMAGE_HEIGHT = 80;
const DEFAULT_IMAGE_WIDTH = 80;

/**
 * Minimal base class shared by file views.
 */
export class FilesView extends HTMLElement {
  constructor() {
    super();
    this.div = document.createElement("div"); // optional holder if you need it
    this.div.style.width = "100%";
    this.div.style.height = "100%";

    this.selected = {};      // selection map: path -> file
    this._file_explorer_ = null; // reference to explorer (kept for compatibility)
    this.menu = null;        // context menu ref
  }

  init() {}
  show() { this.style.display = "block"; }
  hide() { this.style.display = "none"; }
  hideMenu() { if (this.menu?.close) this.menu.close(); }
  rename(card, file, offset) { /* hook if needed */ }
}

/**
 * Icon/grid view implementation.
 */
export class FilesIconView extends FilesView {
  _imageHeight = DEFAULT_IMAGE_HEIGHT;
  _imageWidth = DEFAULT_IMAGE_WIDTH;

  constructor() {
    super();
    // ✅ FIX: create shadow root before touching this.shadowRoot
    this.attachShadow({ mode: "open" });

    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; width: 100%; height: 100%; overflow-y: auto; }
        #container { background: var(--surface-color); display: flex; flex-direction: column; padding: 8px; height: 100%; }
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
  }

  /**
   * Wire dependencies.
   */
  init(fileExplorer, menu, imageHeight = DEFAULT_IMAGE_HEIGHT, imageWidth = DEFAULT_IMAGE_WIDTH) {
    this._file_explorer_ = fileExplorer;
    this.menu = menu;
    this._imageHeight = imageHeight;
    this._imageWidth = imageWidth;
  }

  // ---------- Container handlers ----------

  _handleContainerMouseLeave(evt) {
    evt.stopPropagation();
    this.querySelectorAll("globular-file-icon-view").forEach((v) => v.resetActive());
  }

  _handleContainerClick(evt) {
    evt.stopPropagation();
    this.hideMenu();
  }

  _handleContainerDrop(evt) {
    evt.preventDefault();
    evt.stopPropagation();

    const filesJson = evt.dataTransfer.getData("files");
    const domainFromDnD = evt.dataTransfer.getData("domain");
    const fileList = evt.dataTransfer.files;

    // If user dropped native files from their OS → use unified uploader event
    if (fileList && fileList.length > 0) {
      const currentPath =
        (this._file_explorer_?.getCurrentPath && this._file_explorer_.getCurrentPath()) ||
        this._file_explorer_?._path ||
        "/";

      Backend.eventHub.publish(
        "__upload_files_event__",
        { dir: currentPath, files: Array.from(fileList), lnk: null },
        true
      );
      return;
    }

    // If it was an internal drag from another explorer → forward via event hub
    if (filesJson && domainFromDnD) {
      try {
        const files = JSON.parse(filesJson);
        const sourceId = evt.dataTransfer.getData("id");

        if (this._file_explorer_ && files.length > 0) {
          const destPath =
            (this._file_explorer_?.getCurrentPath && this._file_explorer_.getCurrentPath()) ||
            this._file_explorer_?._path ||
            "/";

          files.forEach((f) => {
            Backend.eventHub.publish(
              `drop_file_${this._file_explorer_.id}_event`,
              { file: f, dir: destPath, id: sourceId, domain: domainFromDnD },
              true
            );
          });
        }
      } catch (e) {
        console.error("Error parsing dropped files data:", e);
        displayError("Failed to process dropped files.", 3000);
      }
    }
  }

  _handleContainerDragOver(evt) {
    evt.preventDefault();
    // keep explorer on top if your layout implements it
    this._file_explorer_?.setAtTop?.();
  }

  // ---------- Rendering ----------

  /**
   * Render a directory in icon view.
   * Expects a FileInfo/proto-like object with getFilesList(), getIsDir(), getMime(), etc.
   */
  setDir(dir) {
    // ✅ clear only the light DOM so the shadow/template remains intact
    while (this.firstChild) this.removeChild(this.firstChild);

    // Sort: directories first, then name
    const sorted = [...dir.getFilesList()].sort((a, b) => {
      if (a.getIsDir() && !b.getIsDir()) return -1;
      if (!a.getIsDir() && b.getIsDir()) return 1;
      return a.getName().localeCompare(b.getName());
    });

    // Group by type
    const byType = { folder: [], video: [], audio: [], image: [], document: [], other: [] };

    // Map of hidden/sidecar files if you need them later
    const hiddenFilesMap = {};
    dir.getFilesList().forEach((f) => {
      if (f.getName().startsWith(".hidden")) {
        f.getFilesList().forEach((hf) => {
          hiddenFilesMap[hf.getPath().replace("/.hidden/", "/")] = hf;
        });
      }
    });

    for (const f of sorted) {
      if (f.getName().startsWith(".") && !f.getName().startsWith(".hidden")) continue;

      const mime = f.getMime() || "";
      const [type, sub] = mime.split("/");
      if (f.getIsDir()) byType.folder.push(f);
      else if (type === "video") byType.video.push(f);
      else if (type === "audio") byType.audio.push(f);
      else if (type === "image") byType.image.push(f);
      else if (type === "text" || sub === "pdf") byType.document.push(f);
      else byType.other.push(f);
    }

    // Keep references to existing playlists if present
    dir.__audioPlaylist__ = dir.getFilesList().find((f) => f.getName() === "audio.m3u") || null;
    dir.__videoPlaylist__ = dir.getFilesList().find((f) => f.getName() === "video.m3u") || null;

    const order = ["folder", "video", "audio", "image", "document", "other"];

    order.forEach((fileType) => {
      const files = byType[fileType];
      if (!files || files.length === 0) return;

      const section = document.createElement("globular-file-icon-view-section");
      section.id = `${fileType}_section`;
      section.setAttribute("filetype", fileType);
      this.appendChild(section); // goes into light DOM (rendered via <slot>)

      // init section with dir + view
      section.init(dir, fileType, this);

      files.forEach((file) => {
        const icon = document.createElement("globular-file-icon-view");
        icon.id = `_${getUuidByString(file.getPath())}`;
        icon.setAttribute("height", String(this._imageHeight));
        icon.setAttribute("width", String(this._imageWidth));

        // DnD support
        icon.draggable = true;
        icon.addEventListener("dragstart", (evt) => this._handleFileDragStart(evt, icon, file));
        icon.addEventListener("dragend", (evt) => this._handleFileDragEnd(evt));

        // Let the icon render itself
        icon.setFile(file, this);
        section.appendChild(icon);
      });

      section.updateCount();
    });
  }

  // ---------- Drag helpers ----------

  _handleFileDragStart(evt, draggedElement, file) {
    evt.stopPropagation();

    // Drag all selected if any, otherwise the single item
    const selectedPaths = Object.keys(this.selected);
    const filesToDrag = selectedPaths.length > 0
      ? selectedPaths.map((p) => this.selected[p])
      : [file];

    // best-effort domain without `.globule`
    const domain =
      (Backend?.getDomain && Backend.getDomain()) ||
      Backend?.domain ||
      window.location.host;

    const payload = filesToDrag.map((f) => ({ domain, path: f.getPath() }));

    evt.dataTransfer.setData("files", JSON.stringify(payload));
    evt.dataTransfer.setData("id", this._file_explorer_?.id || "explorer");
    evt.dataTransfer.setData("domain", domain);
    evt.dataTransfer.effectAllowed = "move";

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
