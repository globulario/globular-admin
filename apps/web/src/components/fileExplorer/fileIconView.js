// src/components/fileIconView.js
import { Backend } from "../../backend/backend";
import { getBaseUrl } from "../../core/endpoints";
import { getCoords } from "../utility";
import { displayError, displayMessage } from "../../backend/ui/notify";

// Polymer deps
import "@polymer/paper-checkbox/paper-checkbox.js";
import "@polymer/paper-ripple/paper-ripple.js";
import "@polymer/iron-icon/iron-icon.js";

// Optional: if your preview takes only (file, size) now
import { VideoPreview } from "./videoPreview";

// Icons / layout
const ICON_SIZE_DEFAULT = "48px";
const FOLDER_ICON = "icons:folder";
const FOLDER_OPEN_ICON = "icons:folder-open";
const REMOVE_ICON_TOP_OFFSET = "8px";
const REMOVE_ICON_LEFT_OFFSET = "8px";

// Small helper to build gateway URL to a file path
function buildFileHttpUrl(path) {
  const base = (getBaseUrl() || "").replace(/\/$/, "");
  const parts = path
    .split("/")
    .map((s) => encodeURIComponent(s))
    .filter(Boolean)
    .join("/");
  return `${base}/${parts}`;
}

export class FileIconView extends HTMLElement {
  _file = null;
  _preview = null;
  _viewContext = null;     // FilesIconView or FilesListView
  _fileExplorer = null;    // main FileExplorer
  _domRefs = {};

  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display:flex; position:relative; flex-direction:column;
          margin:5px; padding:5px; padding-top:25px;
          border-radius:2.5px; border:1px solid var(--surface-color);
          transition: background .2s ease, padding .8s linear;
          background-color: var(--surface-color);
          height: var(--file-icon-height, 80px);
          min-width: var(--file-icon-width, 80px);
          justify-content:center; align-items:center;
          user-select:none; cursor:pointer;
        }
        :host(:hover) { filter: brightness(1.05); }

        .file-icon-content{ display:flex; flex-direction:column; align-items:center;
          position:relative; height:100%; width:100%; }

        .icon-display{ display:flex; height:100%; width:100%;
          justify-content:center; align-items:center; }
        .icon-display iron-icon { height:${ICON_SIZE_DEFAULT}; width:${ICON_SIZE_DEFAULT};
          fill: var(--palette-action-disabled); }
        .icon-display img { max-width:100%; max-height:100%; object-fit:contain; }

        .file-name-span{
          word-wrap:break-word; text-align:center; max-height:200px; overflow-y:hidden;
          word-break:break-all; font-size:.85rem; padding:5px; user-select:none; width:100%;
        }

        .shortcut-icon{ position:absolute; bottom:-5px; left:0; }
        .shortcut-icon iron-icon{
          background:white; fill:black; height:16px; width:16px; border-radius:50%;
          box-shadow:0 1px 3px rgba(0,0,0,.2);
        }

        .control-element{
          position:absolute; z-index:10; display:none; visibility:hidden;
        }
        .control-element iron-icon, .control-element svg{
          height:24px; width:24px; fill: var(--palette-action-disabled); cursor:pointer;
        }
        #thumbtack-icon{ top:${REMOVE_ICON_TOP_OFFSET}; left:${REMOVE_ICON_LEFT_OFFSET}; }
        #checkbox{ top:5px; left:5px; }
        #menu-btn{ top:1px; right:1px; height:32px; width:32px; }

        :host(.active){ filter: invert(10%); border:1px solid var(--primary-color, blue); }
        :host(.selected){
          border:1px solid var(--secondary-color, green);
          box-shadow:0 0 5px var(--secondary-color-light, lightgreen);
        }
        :host(:hover) .control-element, :host(.active) .control-element{ display:block; visibility:visible; }
        :host(.selected) .control-element{ display:block; visibility:visible; }

        :host(.drag-over){ box-shadow:0 0 10px 3px var(--primary-color); }
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

  /** Set the file + view context, then render */
  setFile(file, viewContext) {
    this._file = file;
    this._viewContext = viewContext;
    this._fileExplorer = viewContext._file_explorer_;

    // sizing via CSS vars
    const h = this.getAttribute("height") || "80";
    const w = this.getAttribute("width") || "80";
    this.style.setProperty("--file-icon-height", `${h}px`);
    this.style.setProperty("--file-icon-width", `${w}px`);

    this._cacheDomElements();
    this._setupEventListeners();
    this._renderFileContent();
    this._updateSelectionState?.(this._domRefs.checkbox.checked);
    this._updateThumbtackState(false); // hidden by default (no local API yet)
    this._updateEditableState?.();
  }

  _cacheDomElements() {
    this._domRefs.fileIconContent = this.shadowRoot.querySelector(".file-icon-content");
    this._domRefs.iconDisplay = this.shadowRoot.querySelector(".icon-display");
    this._domRefs.fileNameSpan = this.shadowRoot.querySelector(".file-name-span");
    this._domRefs.checkbox = this.shadowRoot.querySelector("paper-checkbox");
    this._domRefs.thumbtackIcon = this.shadowRoot.querySelector("#thumbtack-icon");
    this._domRefs.menuBtn = this.shadowRoot.querySelector("#menu-btn");
    this._domRefs.shortcutIconContainer = this.shadowRoot.querySelector(".shortcut-icon");
  }

  _setupEventListeners() {
    this.shadowRoot.host.addEventListener("click", this._handleFileClick.bind(this));

    this._domRefs.checkbox.addEventListener("click", (evt) => {
      evt.stopPropagation();
      this._toggleSelection(this._domRefs.checkbox.checked);
    });

    // thumbtack currently disabled
    this._domRefs.thumbtackIcon.addEventListener("click", (evt) => {
      evt.stopPropagation();
      displayMessage("Local-cache pin is not wired yet in the new stack.", 2500);
    });

    this._domRefs.menuBtn.addEventListener("click", this._handleMenuClick.bind(this));

    if (this._file.getIsDir()) {
      this.addEventListener("dragover", this._handleDragOverFolder.bind(this));
      this.addEventListener("dragleave", this._handleDragLeaveFolder.bind(this));
      this.addEventListener("drop", this._handleDropOnFolder.bind(this));
    }

    this.addEventListener("mouseenter", this._handleMouseEnter.bind(this));
    this.addEventListener("mouseleave", this._handleMouseLeave.bind(this));

    // sync checkbox state via eventHub
    Backend.eventHub.subscribe(
      `__file_select_unselect_${this._file.getPath()}`,
      () => {},
      (checked) => {
        this._domRefs.checkbox.checked = !!checked;
        this._updateSelectionState(!!checked);
      },
      true,
      this
    );
  }

  async _renderFileContent() {
    const f = this._file;
    this._domRefs.fileNameSpan.textContent = f.getName();
    this._domRefs.iconDisplay.innerHTML = "";

    if (f.getLnk()) {
      this._domRefs.shortcutIconContainer.innerHTML = `<iron-icon icon="icons:reply"></iron-icon>`;
    } else {
      this._domRefs.shortcutIconContainer.innerHTML = "";
    }

    const mimeRoot = (f.getMime() || "").split("/")[0];

    if (mimeRoot === "video") {
      // Try preview; otherwise generic icon
      try {
        this._preview = new VideoPreview(f, 72);
        this._preview.name = f.getName();
        this._domRefs.iconDisplay.appendChild(this._preview);
      } catch {
        const icon = document.createElement("iron-icon");
        icon.icon = "av:movie";
        this._domRefs.iconDisplay.appendChild(icon);
      }
    } else if (f.getIsDir()) {
      // default folder
      const folderIcon = document.createElement("iron-icon");
      folderIcon.icon = FOLDER_ICON;
      this._domRefs.iconDisplay.appendChild(folderIcon);

      // Try infos.json poster/name via HTTP
      try {
        const url = buildFileHttpUrl(`${f.getPath()}/infos.json`);
        const resp = await fetch(url, { credentials: "include" }).catch(() => null);
        if (resp && resp.ok) {
          const titleInfos = await resp.json();
          // Expecting something like { ID, Poster: { contenturl }, Name }
          const posterUrl = titleInfos?.Poster?.contenturl || titleInfos?.poster?.contenturl;
          const titleName = titleInfos?.Name || titleInfos?.name;
          if (posterUrl) {
            const img = document.createElement("img");
            img.src = posterUrl;
            img.draggable = false;
            this._domRefs.iconDisplay.innerHTML = "";
            this._domRefs.iconDisplay.appendChild(img);
          }
          if (titleName) {
            this._domRefs.fileNameSpan.textContent = titleName;
          }
        }
      } catch (e) {
        // keep default icon on any error
        console.warn("infos.json not found or invalid for", f.getPath(), e);
      }
    } else if (f.getThumbnail()) {
      const img = document.createElement("img");
      img.src = f.getThumbnail();
      img.draggable = false;
      this._domRefs.iconDisplay.appendChild(img);
      // (Optional) you can enrich name for audio later with your new media API
    } else {
      const icon = document.createElement("iron-icon");
      if (mimeRoot === "audio") icon.icon = "av:music-note";
      else if (mimeRoot === "text") icon.icon = "editor:insert-drive-file";
      else icon.icon = "icons:insert-drive-file";
      this._domRefs.iconDisplay.appendChild(icon);
    }
  }

  _handleFileClick(evt) {
    evt.stopPropagation();
    if (this._file.getIsDir()) {
      // publish through FilesView/FileExplorer flow
      if (this._fileExplorer?.publishSetDirEvent) {
        this._fileExplorer.publishSetDirEvent(this._file.getPath());
      } else {
        Backend.eventHub.publish("__set_dir_event__", { dir: this._file, file_explorer_id: this._fileExplorer?.id }, true);
      }
      return;
    }

    const kind = (this._file.getMime() || "").split("/")[0];
    if (kind === "video") {
      this._fileExplorer?._playMedia?.(this._file, "video");
    } else if (kind === "audio") {
      this._fileExplorer?._playMedia?.(this._file, "audio");
    } else if (kind === "image") {
      this._fileExplorer?._showImage?.(this._file);
    } else {
      this._fileExplorer?._readFile?.(this._file);
    }

    // hide menu after action
    const menu = this._viewContext?.menu || this._viewContext?._contextMenu;
    if (menu?.close) menu.close();
  }

  _toggleSelection(checked) {
    if (checked) {
      this.classList.add("selected");
      this._domRefs.checkbox.style.display = "block";
      if (this._viewContext?.selected) this._viewContext.selected[this._file.getPath()] = this._file;
    } else {
      this.classList.remove("selected");
      this._domRefs.checkbox.style.display = "none";
      if (this._viewContext?.selected) delete this._viewContext.selected[this._file.getPath()];
    }
  }

  _handleMenuClick(evt) {
    evt.stopPropagation();

    const menu = this._viewContext?.menu || this._viewContext?._contextMenu;
    if (!menu) return;

    if (menu.parentNode !== document.body) {
      document.body.appendChild(menu);
    }

    const coords = getCoords(this);
    menu.style.position = "absolute";
    menu.style.top = `${coords.top + 4}px`;
    menu.style.left = `${coords.left + this.offsetWidth + 5 - 20}px`;

    // FilesView._contextMenu has a setFile(file) helper in the new code
    if (typeof menu.setFile === "function") menu.setFile(this._file);
    // Let rename be handled by FilesView.rename(...)
    if ("rename" in this._viewContext) {
      menu.rename = () => this._viewContext.rename(this, this._file, this.offsetHeight + 6);
    }
    if (menu.showBtn) menu.showBtn();

    menu.onmouseenter = () => this.classList.add("active");
    menu.onmouseleave = () => this.classList.remove("active");
  }

  _handleDragOverFolder(evt) {
    evt.preventDefault();
    this._domRefs.iconDisplay.querySelector("iron-icon")?.setAttribute("icon", FOLDER_OPEN_ICON);
    this.classList.add("drag-over");
    this._fileExplorer?.setAtTop?.();
  }

  _handleDragLeaveFolder() {
    this._domRefs.iconDisplay.querySelector("iron-icon")?.setAttribute("icon", FOLDER_ICON);
    this.classList.remove("drag-over");
  }

  async _handleDropOnFolder(evt) {
    evt.stopPropagation();
    evt.preventDefault();
    this._domRefs.iconDisplay.querySelector("iron-icon")?.setAttribute("icon", FOLDER_ICON);
    this.classList.remove("drag-over");

    const filesDataTransfer = evt.dataTransfer.getData("files");
    const domainDataTransfer = evt.dataTransfer.getData("domain");
    const urlDataTransfer = evt.dataTransfer.getData("Url");

    if (urlDataTransfer && urlDataTransfer.startsWith("https://www.imdb.com/title")) {
      // Delegate to view logic that knows how to process IMDB links
      this._viewContext?.setImdbTitleInfo?.(urlDataTransfer, this._file);
      return;
    }

    if (evt.dataTransfer.files?.length > 0) {
      // Hand off to the unified uploader used by FilesView
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
        Backend.eventHub.publish(
          `drop_file_${this._fileExplorer?.id}_event`,
          { file: filesToDrop[0] || null, dir: this._file.getPath(), id: sourceId, domain: domainDataTransfer },
          true
        );
      } catch (e) {
        console.error("Error parsing dropped files data:", e);
        displayError("Failed to process dropped files.", 3000);
      }
    }
  }

  _handleMouseEnter(evt) {
    evt.stopPropagation();
    this._domRefs.checkbox.style.display = "block";
    this._domRefs.menuBtn.style.display = "block";
    this.classList.add("active");
    // thumbtack remains hidden until local-cache is implemented
  }

  _handleMouseLeave(evt) {
    evt.stopPropagation();
    if (!this._domRefs.checkbox.checked) this._domRefs.checkbox.style.display = "none";
    this._domRefs.menuBtn.style.display = "none";
    this._domRefs.thumbtackIcon.style.display = "none";
    this.classList.remove("active");
  }

  _updateThumbtackState(isLocal) {
    // Currently disabled: keep hidden; when you add a cache API, toggle visibility/fill here
    this._domRefs.thumbtackIcon.style.display = "none";
    this._domRefs.thumbtackIcon.style.visibility = "hidden";
  }

  // Public helpers used elsewhere
  setActive() { this.classList.add("active"); }
  resetActive() { this.classList.remove("active"); }
  select() { this._domRefs.checkbox.checked = true; this._toggleSelection(true); }
  unselect() { this._domRefs.checkbox.checked = false; this._toggleSelection(false); }

  stopPreview() { if (this._preview?.stopPreview) this._preview.stopPreview(); }
}

customElements.define("globular-file-icon-view", FileIconView);
