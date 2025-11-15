// src/components/fileIconView.js
import { Backend } from "../../backend/backend";
import { getCoords } from "../utility.js";
import { displayError, displayMessage } from "../../backend/ui/notify";

// Proper backend wrappers
import { getFile, readText } from "../../backend/cms/files";
import { getTitleInfo } from "../../backend/media/title";

// FileVM helpers (DRY)
import {
  pathOf,
  nameOf,
  mimeRootOf,
  isDir as isDirVM,
  thumbOf,
} from "./filevm-helpers";

// UI deps
import "@polymer/paper-checkbox/paper-checkbox.js";
import "@polymer/paper-ripple/paper-ripple.js";
import "@polymer/iron-icon/iron-icon.js";
import "@polymer/paper-icon-button/paper-icon-button.js";

// Optional preview
import { VideoPreview } from "../fileExplorer/videoPreview";

const ICON_SIZE_DEFAULT = "48px";
const FOLDER_ICON = "icons:folder";
const FOLDER_OPEN_ICON = "icons:folder-open";

const ICON_FOR_KIND = {
  video: "av:movie",
  audio: "av:music-note",
  text: "editor:insert-drive-file",
  default: "icons:insert-drive-file",
};

// Back-compat helper
function getTitleInfoFlex(arg) {
  return new Promise((resolve, reject) => {
    try {
      getTitleInfo(arg, resolve, reject);
    } catch {
      try {
        getTitleInfo(arg, (titles) => resolve(titles), (e) => reject(e));
      } catch (e) {
        reject(e);
      }
    }
  });
}

export class FileIconView extends HTMLElement {
  _file = null;
  _preview = null;
  _viewContext = null;
  _fileExplorer = null;
  _dom = {};

  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this.shadowRoot.innerHTML = this._template();
  }

  /* ---------- Public API ---------- */
  setFile(fileVM, viewContext) {
    this._file = fileVM;
    this._viewContext = viewContext;
    this._fileExplorer = viewContext._fileExplorer;

    // sizing via attributes (80px default)
    const h = parseInt(this.getAttribute("height") || "80", 10);
    const w = parseInt(this.getAttribute("width") || "80", 10);
    this.style.setProperty("--file-icon-height", `${h}px`);
    this.style.setProperty("--file-icon-width", `${w}px`);

    this._cacheDom();
    this._wireEvents();
    this._render();
    this._hideThumbtack();
  }

  setActive() { this.classList.add("active"); }
  resetActive() { this.classList.remove("active"); }
  select() { this._dom.checkbox.checked = true; this._applySelection(true); }
  unselect() { this._dom.checkbox.checked = false; this._applySelection(false); }
  stopPreview() { this._preview?.stopPreview?.(); }

  /* ---------- Private: Structure / DOM ---------- */
  _template() {
    // NOTE: CSS mirrors the legacy .file-icon-div look & behavior
    // but now uses theme variables for dark / light mode.
    return `
      <style>
      :host {
        display: inline-flex;
      }

      iron-icon {
        fill: var(--on-surface-color, black);
      }

      /* ShadyCSS-friendly: NO nested var() here */
      paper-checkbox {
        --paper-checkbox-unchecked-color: #999;
        --paper-checkbox-checked-color: #4dabf7;
        --paper-checkbox-checkmark-color: #fff;
        --paper-checkbox-label-color: inherit;
      }


      /* Main card container (auto-height so name can grow) */
      .file-icon-content {
        display: flex;
        position: relative;
        flex-direction: column;
        margin: 5px;
        padding: 5px;
        padding-top: 25px;
        border-radius: 4px;
        border: 1px solid var(--divider-color, var(--palette-divider));
        transition: background .15s ease, box-shadow .15s ease, transform .1s ease;
        background-color: var(--surface-color);
        color: var(--on-surface-color);

        /* width is fixed; height adapts to icon + name */
        width: var(--file-icon-width, 110px);
        min-width: var(--file-icon-width, 110px);
        height: auto;

        justify-content: flex-start;
        align-items: center;
        user-select: none;
      }

      /* Hover cursor & active filter */
      .file-icon-content:hover {
        cursor: pointer;
        background-color: var(--surface-hover-color, var(--surface-color));
      }

      :host(.active) .file-icon-content {
        filter: invert(7%);
      }

      /* Icon / image area — fixed thumb height so name has its space */
      .icon-display {
        display: flex;
        width: 100%;
        height: var(--file-icon-thumb-size, 48px); /* thumbnail height */
        justify-content: center;
        align-items: center;
      }
      .icon-display iron-icon {
        height: var(--file-icon-thumb-size, 48px);
        width: var(--file-icon-thumb-size, 48px);
      }
      .icon-display img {
        display: block;
        max-height: var(--file-icon-thumb-size, 48px);
        max-width: 100%;
        object-fit: contain; /* fully visible inside the box */
      }

      /* Name text — allow full wrap without clipping */
      .file-name-span {
        display: block;
        max-width: 100%;
        margin: 6px auto 0 auto;
        text-align: center;
        font-size: .85rem;
        line-height: 1.1em;

        /* wrapping rules to handle hashes/long tokens */
        overflow-wrap: anywhere;
        word-break: break-word;
        white-space: normal;

        /* no clipping: let container grow */
        overflow: visible;

        color: var(--on-surface-color, black);
      }

      /* Shortcut badge (reply icon) */
      .shortcut-icon {
        position: absolute;
        bottom: -5px;
        left: 0;
      }
      .shortcut-icon iron-icon {
        height: 16px;
        width: 16px;
        margin-left: 2px;
        border-radius: 50%;
        background: var(--surface-color);
        fill: var(--on-surface-color);
        box-shadow: 0 0 3px rgba(0,0,0,.35);
      }

      /* Controls default hidden like legacy */
      .control-element {
        position: absolute;
        z-index: 10;
        display: none;
        visibility: hidden;
      }
      #checkbox {
        top: 5px;
        left: 5px;
        border-color: var(--on-surface-color, black);
      }

      /* thumbtack */
      #thumbtack-icon {
        top: 8px;
        left: 32px;
        height: 12px;
        fill: var(--palette-action-disabled);
      }

      /* menu button area top-right */
      #menu-btn {
        top: -6px;
        right: -6px;
      }

      /* Show controls on hover/active/selected */
      :host(:hover) .control-element,
      :host(.active) .control-element,
      :host(.selected) .control-element {
        display: block;
        visibility: visible;
      }

      /* Selected state hints */
      :host(.selected) .file-icon-content {
        border-color: var(--secondary-color, #4caf50);
        box-shadow: 0 0 6px var(--secondary-color-light, rgba(76,175,80,.6));
      }

      /* Slight hover lift */
      .file-icon-content:hover {
        transform: translateY(-1px);
      }
      </style>

      <div class="file-icon-content">
        <paper-checkbox id="checkbox" class="control-element"></paper-checkbox>

        <!-- thumbtack disabled until new local-cache API exists -->
        <svg id="thumbtack-icon" class="control-element" title="Keep file local"
             style="display:none" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 384 512">
          <path d="M32 32C32 14.3 46.3 0 64 0H320c17.7 0 32 14.3 32 32s-14.3 32-32 32H290.5l11.4 148.2c36.7 19.9 65.7 53.2 79.5 94.7l1 3c3.3 9.8 1.6 20.5-4.4 28.8s-15.7 13.3-26 13.3H32c-10.3 0-19.9-4.9-26-13.3s-7.7-19.1-4.4-28.8l1-3c13.8-41.5 42.8-74.8 79.5-94.7L93.5 64H64C46.3 64 32 49.7 32 32zM160 384h64v96c0 17.7-14.3 32-32 32s-32-14.3-32-32V384z"/>
        </svg>

        <paper-icon-button id="menu-btn" icon="icons:more-vert" class="control-element"></paper-icon-button>
        <paper-ripple recenters></paper-ripple>

        <div class="icon-display"></div>
        <span class="file-name-span"></span>
        <div class="shortcut-icon"></div>
      </div>
    `;
  }

  _cacheDom() {
    const $ = (sel) => this.shadowRoot.querySelector(sel);
    this._dom.content = $(".file-icon-content");
    this._dom.iconDisplay = $(".icon-display");
    this._dom.fileName = $(".file-name-span");
    this._dom.checkbox = $("#checkbox");
    this._dom.thumbtack = $("#thumbtack-icon");
    this._dom.menuBtn = $("#menu-btn");
    this._dom.shortcut = $(".shortcut-icon");
  }

  clearSelectionUI() {
    // keep both shadow & light DOM safe
    const root = this.shadowRoot || this;
    root.querySelectorAll('paper-checkbox, input[type="checkbox"]').forEach(cb => {
      this.classList.remove("selected");
      try { cb.checked = false; cb.removeAttribute('checked'); } catch { }
    });
  }

  /* ---------- Private: Event wiring ---------- */
  _wireEvents() {
    // open on click
    this.shadowRoot.host.addEventListener("click", (e) => {
      e.stopPropagation();
      this._handleOpen();
    });

    // checkbox
    this._dom.checkbox.addEventListener("click", (e) => {
      e.stopPropagation();
      this._applySelection(this._dom.checkbox.checked);
    });

    // thumbtack (disabled)
    this._dom.thumbtack.addEventListener("click", (e) => {
      e.stopPropagation();
      displayMessage("Local-cache pin is not wired yet in the new stack.", 2500);
    });

    // menu
    this._dom.menuBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this._openMenu();
    });

    // DnD only for folders
    if (isDirVM(this._file)) {
      this.addEventListener("dragover", (e) => this._dragOverFolder(e));
      this.addEventListener("dragleave", () => this._dragLeaveFolder());
      this.addEventListener("drop", (e) => this._dropOnFolder(e));
    }

    // hover show/hide
    this.addEventListener("mouseenter", (e) => this._mouseenter(e));
    this.addEventListener("mouseleave", (e) => this._mouseleave(e));

    // selection sync
    const keyPath = pathOf(this._file);
    Backend.eventHub.subscribe(
      `__file_select_unselect_${keyPath}`,
      () => {},
      (checked) => {
        this._dom.checkbox.checked = !!checked;
        this._applySelection(!!checked);
      },
      true,
      this
    );
  }

  /* ---------- Private: Rendering ---------- */
  async _render() {
    const f = this._file;
    this._dom.fileName.textContent = nameOf(f);
    this._clear(this._dom.iconDisplay);

    this._setShortcutBadge(hasLinkFlag(f));

    const kind = mimeRootOf(f);
    if (kind === "video") {
      await this._renderVideo(f);
      return;
    }

    if (isDirVM(f)) {
      await this._renderFolder(f);
      return;
    }

    const t = thumbOf(f);
    if (t) this._appendImg(t);
    else this._appendIcon(ICON_FOR_KIND[kind] || ICON_FOR_KIND.default);
  }

  async _renderVideo(f) {
    try {
      this._preview = new VideoPreview();
      await this._preview.setFile(f, 72);
      if (!this._preview.hasPreviewImages()) {
        throw new Error("No preview images available");
      }
      this._preview.name = nameOf(f);
      this._dom.iconDisplay.appendChild(this._preview);
    } catch {
      this._appendIcon(ICON_FOR_KIND.video);
    }
  }

  async _renderFolder(f) {
    const folderIconEl = this._appendIcon(FOLDER_ICON);
    try {
      const infosFile = await getFile(`${pathOf(f)}/infos.json`);
      const text = await readText(infosFile);
      const titleInfos = JSON.parse(text || "{}");
      if (titleInfos?.ID) {
        const titles = await getTitleInfoFlex(titleInfos.ID);
        const title = Array.isArray(titles) ? titles[0] : titles;
        if (title) {
          const poster = title.getPoster?.() || title.poster || null;
          const posterUrl = poster?.getContenturl?.() || poster?.contenturl || null;
          const titleName = title.getName?.() || title?.name || null;

          if (posterUrl) {
            this._clear(this._dom.iconDisplay);
            this._appendImg(posterUrl);
          } else {
            folderIconEl?.setAttribute?.("icon", FOLDER_ICON);
          }
          if (titleName) this._dom.fileName.textContent = titleName;
        }
      } else {
        const titles = await getTitleInfoFlex(f);
        if (Array.isArray(titles) && titles.length) {
          const t = titles[0];
          const poster = t.getPoster?.() || t.poster || null;
          const posterUrl = poster?.getContenturl?.() || poster?.contenturl || null;
          if (posterUrl) {
            this._clear(this._dom.iconDisplay);
            this._appendImg(posterUrl);
          }
          const titleName = t.getName?.() || t.name || null;
          if (titleName) this._dom.fileName.textContent = titleName;
        }
      }
    } catch {
      /* keep default folder icon */
    }
  }

  /* ---------- Private: Actions ---------- */
  _handleOpen() {
    const f = this._file;
    if (isDirVM(f)) {
      if (this._fileExplorer?.publishSetDirEvent) {
        this._fileExplorer.publishSetDirEvent(pathOf(f));
      } else {
        const feId = this._fileExplorer?._id || this._fileExplorer?.id;
        Backend.eventHub.publish(
          "__set_dir_event__",
          { dir: f, file_explorer_id: feId },
          true
        );
      }
      return;
    }

    const kind = mimeRootOf(f);
    if (kind === "video") this._fileExplorer?.playVideo?.(f);
    else if (kind === "audio") this._fileExplorer?.playAudio?.(f);
    else if (kind === "image") this._fileExplorer?.showImage?.(f);
    else this._fileExplorer?.readFile?.(f);

    const menu = this._activeMenu();
    menu?.close?.();
  }

  _applySelection(checked) {
    if (checked) {
      this.classList.add("selected");
      this._dom.checkbox.style.display = "block";
      this._viewContext._selected[pathOf(this._file)] = this._file;
    } else {
      this.classList.remove("selected");
      if (!this._dom.checkbox.checked) this._dom.checkbox.style.display = "none";
      delete this._viewContext._selected[pathOf(this._file)];
    }

    this._viewContext?._selectionChanged?.();
  }

  _openMenu() {
    const menu = this._activeMenu();
    if (!menu) return;

    const view = this._viewContext;
    if (view?.showContextMenu) {
      view.showContextMenu(this._dom.menuBtn, this._file, this);
    }
  }

  _dragOverFolder(evt) {
    evt.preventDefault();
    this._setFolderIcon(FOLDER_OPEN_ICON);
    this.classList.add("drag-over");
    this._fileExplorer?.setAtTop?.();
  }

  _dragLeaveFolder() {
    this._setFolderIcon(FOLDER_ICON);
    this.classList.remove("drag-over");
  }

  _dropOnFolder(evt) {
    evt.stopPropagation();
    evt.preventDefault();
    this._setFolderIcon(FOLDER_ICON);
    this.classList.remove("drag-over");

    const filesDataTransfer = evt.dataTransfer.getData("files");
    const domainDataTransfer = evt.dataTransfer.getData("domain");
    const urlDataTransfer = evt.dataTransfer.getData("Url");

    if (urlDataTransfer && urlDataTransfer.startsWith("https://www.imdb.com/title")) {
      this._viewContext?.setImdbTitleInfo?.(urlDataTransfer, this._file);
      return;
    }

    if (evt.dataTransfer.files?.length > 0) {
      Backend.eventHub.publish(
        "__upload_files_event__",
        { dir: this._file, files: Array.from(evt.dataTransfer.files), lnk: null },
        true
      );
      displayMessage(`Uploading ${evt.dataTransfer.files.length} file(s)...`, 3000);
      return;
    }

    if (filesDataTransfer && domainDataTransfer) {
      try {
        const filesToDrop = JSON.parse(filesDataTransfer);
        const sourceId = evt.dataTransfer.getData("id");
        const feId = this._fileExplorer?._id || this._fileExplorer?.id;
        Backend.eventHub.publish(
          `drop_file_${feId}_event`,
          { file: filesToDrop[0] || null, dir: pathOf(this._file), id: sourceId, domain: domainDataTransfer },
          true
        );
      } catch (e) {
        console.error("Error parsing dropped files data:", e);
        displayError("Failed to process dropped files.", 3000);
      }
    }
  }

  _mouseenter(evt) {
    evt.stopPropagation();
    this._dom.checkbox.style.display = "block";
    this._dom.menuBtn.style.display = "block";
    this._dom.thumbtack.style.display = "none";
    this.classList.add("active");
  }

  _mouseleave(evt) {
    evt.stopPropagation();
    if (!this._dom.checkbox.checked) this._dom.checkbox.style.display = "none";
    this._dom.menuBtn.style.display = "none";
    this._dom.thumbtack.style.display = "none";
    this.classList.remove("active");
  }

  /* ---------- Private: Small utilities (DRY) ---------- */
  _clear(node) { while (node?.firstChild) node.removeChild(node.firstChild); }
  _appendIcon(iconName) {
    const icon = document.createElement("iron-icon");
    icon.icon = iconName || ICON_FOR_KIND.default;
    this._dom.iconDisplay.appendChild(icon);
    return icon;
  }
  _appendImg(src) {
    const img = document.createElement("img");
    img.src = src; img.draggable = false;
    this._dom.iconDisplay.appendChild(img);
    return img;
  }
  _setShortcutBadge(show) {
    this._dom.shortcut.innerHTML = show ? `<iron-icon icon="icons:reply"></iron-icon>` : "";
  }
  _setFolderIcon(icon) {
    this._dom.iconDisplay.querySelector("iron-icon")?.setAttribute("icon", icon);
  }
  _hideThumbtack() {
    this._dom.thumbtack.style.display = "none";
    this._dom.thumbtack.style.visibility = "hidden";
  }
  _activeMenu() { return this._viewContext?.menu || this._viewContext?._contextMenu || null; }
}

function hasLinkFlag(v) { return !!(v?.lnk || v?.isLink || v?.link); }

customElements.define("globular-file-icon-view", FileIconView);
