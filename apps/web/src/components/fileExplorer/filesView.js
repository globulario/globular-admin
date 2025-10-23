// components/filesView.js — integrated with new backend wrappers

import { v4 as uuidv4 } from "uuid";
import { ShareResourceMenu } from "../share/shareResourceMenu";
import { DropdownMenu } from "../menu.js";
// New notify + endpoints imports
import { displayError, displayMessage } from "../../backend/ui/notify";
import { getBaseUrl } from "../../core/endpoints";
// Keep Backend only for event hub/pub-sub that UI still relies on
import { Backend } from "../../backend/backend";

// New filesystem/media/title wrappers
import {
  upload as uploadFilesHttp,
  download as downloadHttp,
  readDir,
  removeDir,
  removeFile,
  renameFile,
} from "../../backend/files";
import {
  convertVideoToMpeg4H264,
  convertVideoToHls,
  createVideoTimeLine,
  createVideoPreview,
  startProcessVideo,
  uploadVideoByUrl,
} from "../../backend/media";
import {
  createTitleAndAssociate,
  createVideoAndAssociate,
} from "../../backend/title";
import {
  Title as TitleMsg,
  Video as VideoMsg,
  Poster as PosterMsg,
  Publisher as PublisherMsg,
} from "globular-web-client/title/title_pb";

import { FileExplorer } from "./fileExplorer.js";
import { getCoords, copyToClipboard } from "../utility.js";
import getUuidByString from "uuid-by-string";
import "@polymer/paper-input/paper-input.js";
import "@polymer/paper-radio-group/paper-radio-group.js";
import "@polymer/paper-radio-button/paper-radio-button.js";
import "@polymer/paper-button/paper-button.js";
import "@polymer/iron-icon/iron-icon.js";
import "@polymer/paper-progress/paper-progress.js";

// ---- helpers to build HTTP file URL (replace your getUrl(globule)) ----
function buildFileHttpUrl(path) {
  const base = (getBaseUrl() || "").replace(/\/$/, "");
  const parts = path
    .split("/")
    .map((s) => encodeURIComponent(s))
    .filter(Boolean)
    .join("/");
  return `${base}/${parts}`;
}



// ---- path normalization if you still need to prefix a data root ----
import { toAbsoluteFsPath } from "../../backend/paths";
const DATA_ROOT = undefined; // set if you must emulate globule.config.DataPath

/**
 * Base class for FilesListView and FilesIconView.
 * Manages common file operations and context menu interactions.
 */
export class FilesView extends HTMLElement {
  /** @type {boolean} Indicates if this view is currently active. */
  _active = false;
  /** @type {FileExplorer | null} Reference to the parent FileExplorer instance. */
  _fileExplorer = null;
  /** @type {string | undefined} The active explorer path. */
  _path = undefined;
  /** @type {any | null} The current directory object. */
  _currentDir = null;
  /** @type {Object<string, any>} Stores selected files by their path. */
  _selected = {};
  /** @type {ShareResourceMenu | null} The share resource menu instance. */
  _shareResourceMenu = null;
  /** @type {DropdownMenu | null} The context menu instance for file actions. */
  _contextMenu = null;
  /** @type {string} Stores the current edit mode (e.g., "cut", "copy"). */
  _editMode = "";

  // References to specific menu items (initialized in connectedCallback)
  _videoMenuItem = null;
  _fileInfosMenuItem = null;
  _titleInfosMenuItem = null;
  _refreshInfoMenuItem = null;
  _manageAccessMenuItem = null;
  _sharedMenuItem = null;
  _renameMenuItem = null;
  _deleteMenuItem = null;
  _downloadMenuItem = null;
  _openInNewTabItem = null;
  _copyUrlItem = null;
  _generateTimeLineItem = null;
  _generatePreviewItem = null;
  _toMp4MenuItem = null;
  _toHlsMenuItem = null;
  _cutMenuItem = null;
  _copyMenuItem = null;
  _pasteMenuItem = null;

  /** @type {HTMLElement | null} The main content div of the component. */
  div = null;

  constructor() {
    super();
    this.attachShadow({ mode: "open" });
  }

  connectedCallback() {
    const id = `files_view_${uuidv4().replace(/-/g, "_")}`;

    this._shareResourceMenu = new ShareResourceMenu(this);

    const menuItemsHTML = `
            <globular-dropdown-menu-item id="cut-menu-item" icon="icons:content-cut" text="Cut" title="Cut the selected item"></globular-dropdown-menu-item>
            <globular-dropdown-menu-item id="copy-menu-item" icon="content-copy" text="Copy" title="Copy the selected item"></globular-dropdown-menu-item>
            <globular-dropdown-menu-item id="paste-menu-item" icon="icons:content-paste" text="Paste" title="Paste title the copied item"></globular-dropdown-menu-item>
            <globular-dropdown-menu-item id="rename-menu-item" icon="icons:create" text="Rename" title="Rename the selected item"></globular-dropdown-menu-item>
            <globular-dropdown-menu-item id="delete-menu-item" icon="icons:delete" text="Delete" title="Delete the selected item"></globular-dropdown-menu-item>

            <globular-dropdown-menu-item separator="true" id="file-infos-menu-item" icon="icons:info" text="File Infos" title="View file information"></globular-dropdown-menu-item>
            <globular-dropdown-menu-item id="title-infos-menu-item" icon="icons:info" text="Title Infos" title="View title information" style="display: none;"></globular-dropdown-menu-item>
            <globular-dropdown-menu-item id="refresh-infos-menu-item" icon="icons:refresh" text="Refresh Infos" title="Convert media format to MP4 and fix audio codec. Generate timeline and preview." style="display: none;"></globular-dropdown-menu-item>

            <globular-dropdown-menu-item separator="true" id="shared-menu-item" icon="social:share" text="Share" title="Share this item"></globular-dropdown-menu-item>
            <globular-dropdown-menu-item id="manage-acess-menu-item" icon="folder-shared" text="Manage Access" title="Manage access permissions"></globular-dropdown-menu-item>

            <globular-dropdown-menu-item separator="true" id="video-menu-item" icon="maps:local-movies" text="Movies" title="Movie-related actions" style="display: none;">
                <globular-dropdown-menu>
                    <globular-dropdown-menu-item id="generate-timeline-menu-item" icon="maps:local-movies" text="Generate Timeline" title="Generate a timeline for the movie"></globular-dropdown-menu-item>
                    <globular-dropdown-menu-item id="generate-preview-menu-item" icon="maps:local-movies" text="Generate Preview" title="Generate a preview for the movie"></globular-dropdown-menu-item>
                    <globular-dropdown-menu-item id="to-mp4-menu-item" icon="maps:local-movies" text="Convert to MP4" title="Convert the movie to MP4 format" style="display: none;"></globular-dropdown-menu-item>
                    <globular-dropdown-menu-item id="to-hls-menu-item" icon="maps:local-movies" text="Convert to HLS" title="Convert the movie to HLS format" style="display: none;"></globular-dropdown-menu-item>
                </globular-dropdown-menu>
            </globular-dropdown-menu-item>

            <globular-dropdown-menu-item separator="true" id="download-menu-item" icon="icons:cloud-download" text="Download" title="Download the selected item"></globular-dropdown-menu-item>
            <globular-dropdown-menu-item id="open-in-new-tab-menu-item" icon="icons:open-in-new" text="Open in New Tab" title="Open the selected item in a new tab" style="display: none;"></globular-dropdown-menu-item>
            <globular-dropdown-menu-item id="copy-url-menu-item" icon="icons:link" text="Copy URL" title="Copy the URL of the selected item"></globular-dropdown-menu-item>
        `;

    this._contextMenu = new DropdownMenu("icons:more-vert");
    this._contextMenu.style.zIndex = 1000;
    this._contextMenu.className = "file-dropdown-menu";
    this._contextMenu.innerHTML = menuItemsHTML;

    // Get references to all menu items
    this._videoMenuItem = this._contextMenu.querySelector("#video-menu-item");
    this._fileInfosMenuItem = this._contextMenu.querySelector("#file-infos-menu-item");
    this._titleInfosMenuItem = this._contextMenu.querySelector("#title-infos-menu-item");
    this._refreshInfoMenuItem = this._contextMenu.querySelector("#refresh-infos-menu-item");
    this._manageAccessMenuItem = this._contextMenu.querySelector("#manage-acess-menu-item");
    this._sharedMenuItem = this._contextMenu.querySelector("#shared-menu-item");

    this._renameMenuItem = this._contextMenu.querySelector("#rename-menu-item");
    this._deleteMenuItem = this._contextMenu.querySelector("#delete-menu-item");
    this._downloadMenuItem = this._contextMenu.querySelector("#download-menu-item");
    this._openInNewTabItem = this._contextMenu.querySelector("#open-in-new-tab-menu-item");
    this._copyUrlItem = this._contextMenu.querySelector("#copy-url-menu-item");

    this._generateTimeLineItem = this._contextMenu.querySelector("#generate-timeline-menu-item");
    this._generatePreviewItem = this._contextMenu.querySelector("#generate-preview-menu-item");
    this._toMp4MenuItem = this._contextMenu.querySelector("#to-mp4-menu-item");
    this._toHlsMenuItem = this._contextMenu.querySelector("#to-hls-menu-item");

    this._cutMenuItem = this._contextMenu.querySelector("#cut-menu-item");
    this._copyMenuItem = this._contextMenu.querySelector("#copy-menu-item");
    this._pasteMenuItem = this._contextMenu.querySelector("#paste-menu-item");

    this._setupMenuActions();

    this.shadowRoot.innerHTML += `
            <style>
                table { text-align: left; position: relative; border-collapse: separate; border-spacing: 0; }
                table th, table td { border-right: 1px solid var(--palette-action-disabled); }
                table th:last-child, table td:last-child { border-right: none; }
                thead { display: table-header-group; }
                tbody { display: table-row-group; }
                tr { color: var(--primary-text-color); }
                th, td { padding: 0.25rem; min-width: 150px; padding-left: 5px; }
                th { z-index: 100; position: sticky; background-color: var(--surface-color); top: 0; }
                .files-list-view-header { padding-left: 5px; padding-right: 5px; }
                .files-list-view-info { padding: 2px; }
                .files-view-div { display: flex; flex-direction: column; background-color: var(--surface-color); color: var(--primary-text-color); position: absolute; top: 0; left: 0; bottom: 0; padding-bottom: 0; right: 5px; overflow: auto; }
                popup-menu-element { background-color: var(--surface-color); color: var(--primary-text-color); }
                ::-webkit-scrollbar { width: 5px; height: 5px; }
                ::-webkit-scrollbar-track { background: var(--surface-color); }
                ::-webkit-scrollbar-thumb { background: var(--palette-divider); }
            </style>
            <div class="files-view-div no-select" id="${id}"></div>
        `;

    this.div = this.shadowRoot.getElementById(id);

    this._addDivEventListeners();
    this._setupObserver();
    this._setupBackendSubscriptions();
  }

  disconnectedCallback() {
    this._closeContextMenu();
  }

  setActive(active) { this._active = active; }
  setFileExplorer(explorer) { this._fileExplorer = explorer; }
  setDir(dir) { this._currentDir = dir; this._path = dir ? dir.getPath() : undefined; }
  setSelected(selected) { this._selected = selected; }

  _addDivEventListeners() {
    if (!this.div) return;
    this.div.addEventListener("scroll", this._handleScroll.bind(this));
    this.div.addEventListener("mouseover", this._handleMouseOver.bind(this));
    this.div.addEventListener("click", this._handleClick.bind(this));
    this.div.addEventListener("drop", this._handleDrop.bind(this));
    this.div.addEventListener("dragover", (evt) => evt.preventDefault());
  }

  _setupObserver() {
    if (!this.div) return;
    const observer = new MutationObserver((mutationsList) => {
      for (const mutation of mutationsList) {
        if (mutation.type === "attributes" && mutation.attributeName === "style") {
          const displayValue = getComputedStyle(this.div).display;
          if (displayValue === "none") {
            this._closeContextMenu();
          }
        }
      }
    });
    observer.observe(this.div, { attributes: true, attributeFilter: ["style"] });
  }

  _setupBackendSubscriptions() {
    Backend.eventHub.subscribe(
      "__create_link_event__",
      (uuid) => {},
      (evt) => {
        if (this._fileExplorer && this._fileExplorer.id === evt.file_explorer_id) {
          if (!this._active) return;
          this._fileExplorer.createLink(evt.file, evt.dest, evt.globule);
        }
      },
      true,
      this
    );

    Backend.eventHub.subscribe(
      "__set_dir_event__",
      (uuid) => {},
      (evt) => {
        if (this._fileExplorer && this._fileExplorer.id === evt.file_explorer_id) {
          if (evt.dir) {
            this._currentDir = evt.dir;
            this._contextMenu.setFile(evt.dir);
            this.setDir(evt.dir);
          }
        }
      },
      true,
      this
    );

    Backend.eventHub.subscribe(
      `drop_file_${this._fileExplorer ? this._fileExplorer.id : "default"}_event`,
      async (uuid, infos) => {
        if (!this._fileExplorer || this._fileExplorer.style.zIndex !== "1000") {
          return;
        }
        const originalDiv = this.div.querySelector("#" + infos.id);
        if (originalDiv) {
          originalDiv.parentNode.style.display = "none";
        }
        if (this._editMode.length === 0) { this._editMode = "cut"; }
        FileExplorer.paperTray = [];
        if (Object.keys(this._selected).length > 0) {
          for (const key in this._selected) {
            FileExplorer.paperTray.push(this._selected[key].path);
          }
        } else if (infos.file) {
          FileExplorer.paperTray.push(infos.file);
        }
        // Keep domain-specific behavior as-is for now
        if (infos.domain !== (this._fileExplorer.globule && this._fileExplorer.globule.domain)) {
          if (this._handleCrossDomainFileDrop) await this._handleCrossDomainFileDrop(infos);
        } else {
          if (this._handleSameDomainFileDrop) await this._handleSameDomainFileDrop(infos);
        }
        this._selected = {};
      },
      true,
      this
    );
  }

  _handleScroll() {
    if (!this.div) return;
    if (this.div.scrollTop === 0) {
      this.div.style.boxShadow = "";
      this.div.style.borderTop = "";
    } else {
      this.div.style.boxShadow = "inset 0px 5px 6px -3px rgb(0 0 0 / 40%)";
      this.div.style.borderTop = "1px solid var(--palette-divider)";
    }
    this._closeContextMenu();
  }

  _handleMouseOver() {
    if (!this._contextMenu) return;
    if (!this._contextMenu.isOpen()) {
      this._closeContextMenu();
    }
    const fileIconDivs = this.div.querySelectorAll(".file-icon-div");
    fileIconDivs.forEach((div) => div.classList.remove("active"));
  }

  _handleClick() { this._closeContextMenu(); }

  _closeContextMenu() {
    if (this._contextMenu && this._contextMenu.isOpen()) {
      this._contextMenu.close();
    }
    if (this._contextMenu && this._contextMenu.parentNode) {
      this._contextMenu.parentNode.removeChild(this._contextMenu);
    }
  }

  _setupMenuActions() {
    this._contextMenu.setFile = (file) => {
      this._contextMenu.file = file;
      const mime = file.getMime();
      const name = file.getName();

      // Hide by default
      this._videoMenuItem.style.display = "none";
      this._titleInfosMenuItem.style.display = "none";
      this._toHlsMenuItem.style.display = "none";
      this._toMp4MenuItem.style.display = "none";
      this._generateTimeLineItem.style.display = "none";
      this._generatePreviewItem.style.display = "none";
      this._openInNewTabItem.style.display = "none";
      this._refreshInfoMenuItem.style.display = "none";

      if (mime.startsWith("video")) {
        this._titleInfosMenuItem.style.display = "block";
        this._videoMenuItem.style.display = "block";
        this._openInNewTabItem.style.display = "block";
        this._generateTimeLineItem.style.display = "block";
        this._generatePreviewItem.style.display = "block";
        if (name.toLowerCase().endsWith(".mp4")) {
          this._toHlsMenuItem.style.display = "block";
        } else if (mime === "video/hls-stream") {
          // no conversion for HLS
        } else {
          this._toMp4MenuItem.style.display = "block";
        }
      } else if (mime.startsWith("audio") || file.videos || file.titles) {
        this._titleInfosMenuItem.style.display = "block";
      }

      if (file.getIsDir()) {
        this._refreshInfoMenuItem.style.display = "block";
      }
    };

    this._sharedMenuItem.action = this._handleShareAction.bind(this);
    this._refreshInfoMenuItem.action = this._handleRefreshInfoAction.bind(this);
    this._cutMenuItem.action = this._handleCutAction.bind(this);
    this._copyMenuItem.action = this._handleCopyAction.bind(this);
    this._pasteMenuItem.action = this._handlePasteAction.bind(this);
    this._openInNewTabItem.action = this._handleOpenInNewTabAction.bind(this);
    this._copyUrlItem.action = this._handleCopyUrlAction.bind(this);
    this._downloadMenuItem.action = this._handleDownloadAction.bind(this);
    this._deleteMenuItem.action = this._handleDeleteAction.bind(this);
    this._renameMenuItem.action = this._handleRenameAction.bind(this);
    this._fileInfosMenuItem.action = this._handleFileInfosAction.bind(this);
    this._titleInfosMenuItem.action = this._handleTitleInfosAction.bind(this);
    this._manageAccessMenuItem.action = this._handleManageAccessAction.bind(this);

    this._generateTimeLineItem.action = this._handleGenerateTimelineAction.bind(this);
    this._generatePreviewItem.action = this._handleGeneratePreviewAction.bind(this);
    this._toMp4MenuItem.action = this._handleConvertToMp4Action.bind(this);
    this._toHlsMenuItem.action = this._handleConvertToHlsAction.bind(this);
  }

  _getFilesForAction() {
    const files = [];
    if (Object.keys(this._selected).length > 0) {
      for (const key in this._selected) {
        files.push(this._selected[key]);
      }
    } else if (this._contextMenu.file) {
      files.push(this._contextMenu.file);
    }
    return files;
  }

  _handleShareAction() {
    const files = this._getFilesForAction();
    if (files.length > 0) {
      this._shareResourceMenu.setFiles(files);
      this._shareResourceMenu.share();
    }
    this._closeContextMenu();
  }

  // ---------- MEDIA actions (new wrappers) ----------
  async _handleConvertToMp4Action() {
    const file = this._contextMenu.file;
    if (!file) { displayError("No file selected.", 3000); return; }
    const abs = toAbsoluteFsPath(file.getPath(), DATA_ROOT);
    displayMessage(`Converting to MP4: ${abs}`, 3500);
    try {
      await convertVideoToMpeg4H264(abs);
      displayMessage("Conversion to MP4 done!", 3500);
      Backend.eventHub.publish(
        "refresh_dir_evt",
        file.getPath().substring(0, file.getPath().lastIndexOf("/")),
        false
      );
    } catch (e) {
      displayError(`Failed to convert to MP4: ${e?.message || e}`, 3000);
    } finally { this._closeContextMenu(); }
  }

  async _handleConvertToHlsAction() {
    const file = this._contextMenu.file;
    if (!file) { displayError("No file selected.", 3000); return; }
    const abs = toAbsoluteFsPath(file.getPath(), DATA_ROOT);
    displayMessage(`Converting to HLS: ${abs}`, 3500);
    try {
      await convertVideoToHls(abs);
      displayMessage("Conversion to HLS done!", 3500);
      Backend.eventHub.publish(
        "refresh_dir_evt",
        file.getPath().substring(0, file.getPath().lastIndexOf("/")),
        false
      );
    } catch (e) {
      displayError(`Failed to convert to HLS: ${e?.message || e}`, 3000);
    } finally { this._closeContextMenu(); }
  }

  async _handleGenerateTimelineAction() {
    const file = this._contextMenu.file;
    if (!file) { displayError("No file selected.", 3000); return; }
    const abs = toAbsoluteFsPath(file.getPath(), DATA_ROOT);
    displayMessage(`Generating timeline for: ${abs}`, 3500);
    try {
      await createVideoTimeLine(abs, 180, 0.2);
      displayMessage("Timeline created successfully!", 3500);
    } catch (e) {
      displayError(`Failed to generate timeline: ${e?.message || e}`, 3000);
    } finally { this._closeContextMenu(); }
  }

  async _handleGeneratePreviewAction() {
    const file = this._contextMenu.file;
    if (!file) { displayError("No file selected.", 3000); return; }
    const abs = toAbsoluteFsPath(file.getPath(), DATA_ROOT);
    displayMessage(`Generating preview for: ${abs}`, 3500);
    try {
      await createVideoPreview(abs, 128, 20);
      displayMessage("Preview created successfully!", 3500);
      Backend.eventHub.publish(
        "refresh_dir_evt",
        file.getPath().substring(0, file.getPath().lastIndexOf("/")),
        false
      );
    } catch (e) {
      displayError(`Failed to generate preview: ${e?.message || e}`, 3000);
    } finally { this._closeContextMenu(); }
  }

  async _handleRefreshInfoAction() {
    const file = this._contextMenu.file;
    if (!file) { displayError("No file selected.", 3000); return; }
    const abs = toAbsoluteFsPath(file.getPath(), DATA_ROOT);
    displayMessage(`Updating information for: ${abs}`, 3500);
    try {
      await startProcessVideo(abs);
      displayMessage("Information updated successfully!", 3000);
    } catch (e) {
      displayError(`Failed to update information: ${e?.message || e}`, 3000);
    } finally { this._closeContextMenu(); }
  }

  // ---------- URL open/copy via gateway base ----------
  async _handleOpenInNewTabAction() {
    const file = this._contextMenu.file;
    if (!file) { displayError("No file to open.", 3000); return; }
    let url = buildFileHttpUrl(file.getPath());
    if (file.mime === "video/hls-stream") url += "/playlist.m3u8";
    window.open(url, "_blank", "noopener");
    this._closeContextMenu();
  }

  async _handleCopyUrlAction() {
    const file = this._contextMenu.file;
    if (!file) { displayError("No file to copy URL.", 3000); return; }
    let url = buildFileHttpUrl(file.getPath());
    if (file.mime === "video/hls-stream") url += "/playlist.m3u8";
    copyToClipboard(url);
    displayMessage("URL was copied to clipboard!", 3000);
    this._closeContextMenu();
  }

  // ---------- Delete / Rename / Download using new files wrappers ----------
  async _handleDeleteAction() {
    const files = this._getFilesForAction().map((f) => (f.lnk && !f.getName().endsWith(".lnk")) ? f.lnk : f);
    if (files.length === 0) { this._closeContextMenu(); return; }

    const fileListHtml = files.map((f) => `<div>${f.getPath()}</div>`).join("");
    this._showConfirmationDialog(
      `
        <div>You're about to delete files:</div>
        <div style="display:flex;flex-direction:column;">${fileListHtml}</div>
        <div>Are you sure you want to do this?</div>
      `,
      async () => {
        try {
          for (const f of files) {
            const p = f.getPath().replace(/\\/g, "/");
            if (f.getIsDir()) await removeDir(p);
            else await removeFile(p);
            Backend.eventHub.publish(
              "reload_dir_event",
              p.substring(0, p.lastIndexOf("/")),
              false
            );
          }
          displayMessage("Files are now deleted!", 3000);
          this._selected = {};
        } catch (e) {
          displayError(`Failed to delete: ${e?.message || e}`, 3000);
        } finally {
          this._closeContextMenu();
        }
      },
      () => {},
      "yes-delete-files",
      "no-delete-files"
    );
  }

  async rename(parent, f, offset) {
    const html = `
      <style>
        #rename-file-dialog{ display:flex; position:absolute; flex-direction:column; left:5px; min-width:200px; z-index:100; background-color:var(--surface-color); color:var(--primary-text-color); box-shadow:var(--shadow-elevation-2dp); border-radius:8px; overflow:hidden; }
        .rename-file-dialog-actions{ font-size:.85rem; align-items:center; justify-content:flex-end; display:flex; padding:8px; border-top:1px solid var(--palette-divider); }
        .card-content{ padding:16px; }
        paper-textarea{ --paper-input-container-color:var(--primary-text-color); --paper-input-container-focus-color:var(--primary-color); --paper-input-container-label-floating-color:var(--primary-color); --paper-input-container-input-color:var(--primary-text-color); }
      </style>
      <paper-card id="rename-file-dialog" style="top:${offset}px;">
        <div class="card-content">
          <paper-textarea id="rename-file-input" label="New name" value="${f.getName()}"></paper-textarea>
        </div>
        <div class="rename-file-dialog-actions">
          <paper-button id="rename-file-cancel-btn">Cancel</paper-button>
          <paper-button id="rename-file-ok-btn">Rename</paper-button>
        </div>
      </paper-card>`;

    let renameDialog = document.body.querySelector("#rename-file-dialog");
    if (!renameDialog) {
      const range = document.createRange();
      document.body.appendChild(range.createContextualFragment(html));
      renameDialog = document.body.querySelector("#rename-file-dialog");
      renameDialog.addEventListener("mouseover", (evt) => evt.stopPropagation());
      renameDialog.addEventListener("mouseenter", (evt) => evt.stopPropagation());
    }
    renameDialog.style.top = `${offset}px`;

    const input = renameDialog.querySelector("#rename-file-input");
    setTimeout(() => {
      input.focus();
      const dotIndex = f.getName().lastIndexOf(".");
      if (dotIndex === -1) input.inputElement.textarea.select();
      else input.inputElement.textarea.setSelectionRange(0, dotIndex);
    }, 50);

    const cancelBtn = renameDialog.querySelector("#rename-file-cancel-btn");
    const renameBtn = renameDialog.querySelector("#rename-file-ok-btn");

    cancelBtn.addEventListener("click", (evt) => {
      evt.stopPropagation();
      if (renameDialog.parentNode) renameDialog.parentNode.removeChild(renameDialog);
    });

    input.addEventListener("keydown", (evt) => {
      if (evt.key === "Enter") renameBtn.click();
      else if (evt.key === "Escape") cancelBtn.click();
    });

    renameBtn.addEventListener("click", async (evt) => {
      evt.stopPropagation();
      if (renameDialog.parentNode) renameDialog.parentNode.removeChild(renameDialog);

      const oldPath = f.getPath();
      const parentPath = oldPath.substring(0, oldPath.lastIndexOf("/"));
      const newName = input.value;
      const oldName = f.getName();
      try {
        await renameFile(oldPath, newName, oldName);
        displayMessage(`Renamed ${oldName} to ${newName}`, 3000);
        removeDir(parentPath);
        Backend.eventHub.publish("reload_dir_event", parentPath, false);
      } catch (e) {
        displayError(`Failed to rename: ${e?.message || e}`, 3000);
      }
    });
  }

  async _handleDownloadAction() {
    const files = this._getFilesForAction();
    if (files.length === 0) return;

    if (files.length === 1 && !files[0].getIsDir()) {
      const url = buildFileHttpUrl(files[0].getPath());
      const name = files[0].getPath().split("/").pop();
      try {
        await downloadHttp(url, name);
        displayMessage(`Downloaded ${name}`, 3000);
      } catch (e) {
        displayError(`Download failed: ${e?.message || e}`, 3000);
      }
    } else {
      displayError("Archive & download not wired yet in the new wrappers.", 4000);
    }
    this._closeContextMenu();
  }

  // ---------- Existing (unchanged or lightly touched) handlers ----------
  _handleManageAccessAction() {
    if (this._fileExplorer && this._contextMenu.file) {
      Backend.eventHub.publish(
        `display_permission_manager_${this._fileExplorer.id}_event`,
        this._contextMenu.file,
        true
      );
    }
    this._closeContextMenu();
  }

  _handleCutAction() {
    this._editMode = "cut";
    FileExplorer.paperTray = this._getFilesForAction().map((f) => f.getPath());
    this._selected = {};
    this._closeContextMenu();
  }

  _handleCopyAction() {
    this._editMode = "copy";
    FileExplorer.paperTray = this._getFilesForAction().map((f) => f.getPath());
    this._selected = {};
    this._closeContextMenu();
  }

  async _handlePasteAction() {
    // NOTE: copy/move still rely on legacy services; keep as-is until wrappers exist
    const destPath = this._contextMenu.file.getPath();
    if (!FileExplorer.paperTray || FileExplorer.paperTray.length === 0) {
      displayMessage("Nothing to paste.", 3000);
      this._closeContextMenu();
      return;
    }
    try {
      // Implement your legacy move/copy here or refactor with new wrappers when available.
      displayMessage("Paste operation not yet refactored to new wrappers.", 3000);
    } catch (e) {
      displayError(`Paste operation failed: ${e?.message || e}`, 3000);
    } finally {
      this._selected = {};
      this._closeContextMenu();
    }
  }

  _handleRenameAction() {
    if (this._contextMenu && this._contextMenu.file) {
      const fileToRename = this._contextMenu.file;
      const coords = getCoords(this.div);
      this.rename(this.div, fileToRename, coords.top + (fileToRename.offsetY || 0));
    }
    this._closeContextMenu();
  }

  _handleFileInfosAction() {
    if (this._fileExplorer && this._contextMenu.file) {
      Backend.eventHub.publish(
        `display_file_infos_${this._fileExplorer.id}_event`,
        this._contextMenu.file,
        true
      );
    }
    this._closeContextMenu();
  }

  async _handleTitleInfosAction() {
    const file = this._contextMenu.file;
    if (!file) { displayError("No file selected.", 3000); this._closeContextMenu(); return; }

    if (file.videos || file.titles || file.audios) {
      Backend.eventHub.publish(`display_media_infos_${this._fileExplorer.id}_event`, file, true);
      this._closeContextMenu();
      return;
    }

    try {
      if (file.getMime().startsWith("video") || file.getIsDir()) {
        // Try fetching via existing TitleController helpers
        const videos = await promisifiedGetFileVideosInfo(file, file.globule);
        if (videos.length > 0) {
          file.videos = videos;
          Backend.eventHub.publish(`display_media_infos_${this._fileExplorer.id}_event`, file, true);
        } else {
          const titles = await promisifiedGetFileTitlesInfo(file, file.globule);
          if (titles.length > 0) {
            file.titles = titles;
            Backend.eventHub.publish(`display_media_infos_${this._fileExplorer.id}_event`, file, true);
          } else {
            await this._promptCreateVideoInfo(file);
          }
        }
      } else if (file.getMime().startsWith("audio")) {
        const audios = await getAudioInfo(file);
        if (audios.length > 0) {
          file.audios = audios;
          Backend.eventHub.publish(`display_media_infos_${this._fileExplorer.id}_event`, file, true);
        } else {
          displayMessage("No audio information found for this file.", 3000);
        }
      }
    } catch (err) {
      displayError(`Failed to retrieve media info: ${err.message}`, 3000);
      if (file.getMime().startsWith("video") || file.getIsDir()) {
        await this._promptCreateVideoInfo(file);
      }
    } finally { this._closeContextMenu(); }
  }

  async _promptCreateVideoInfo(file) {
    const toast = displayMessage(
      `
      <style>
        #yes-no-create-video-info-box{ display:flex; flex-direction:column; }
        #yes-no-create-video-info-box img{ max-height:100px; object-fit:contain; width:100%; margin-top:15px; }
        #yes-no-create-video-info-box span{ font-size:.95rem; text-align:center; }
        #yes-no-create-video-info-box paper-button{ font-size:.8rem; }
        #yes-no-create-video-info-box div{ display:flex; padding-bottom:10px; }
        paper-radio-group{ margin-top:15px; }
      </style>
      <div id="yes-no-create-video-info-box">
        <div style="margin-bottom:10px;">No information was associated with this video file.</div>
        <img src="${file.getThumbnail()}"></img>
        <span>${file.getPath().substring(file.getPath().lastIndexOf("/") + 1)}</span>
        <div style="margin-top:10px;">Do you want to create video/movie information?</div>
        <div style="justify-content:flex-end;">
          <paper-button raised id="yes-create-video-info">Yes</paper-button>
          <paper-button raised id="no-create-video-info">No</paper-button>
        </div>
      </div>
      `,
      60 * 1000
    );

    return new Promise((resolve) => {
      const yesBtn = document.querySelector("#yes-create-video-info");
      const noBtn = document.querySelector("#no-create-video-info");
      yesBtn.onclick = () => { toast.hideToast(); this._showCreateInfoTypeDialog(file); resolve(); };
      noBtn.onclick = () => { toast.hideToast(); resolve(); };
    });
  }

  _showCreateInfoTypeDialog(file) {
    const toast = displayMessage(
      `
      <div style="display:flex; flex-direction:column;">
        <div>Please select the kind of information to create...</div>
        <img style="max-height:100px; object-fit:contain; width:100%; margin-top:15px;" src="${file.getThumbnail()}"></img>
        <paper-radio-group selected="video-option" style="margin-top: 15px;">
          <paper-radio-button id="video-option" name="type-option"><span title="Simple video, e.g., YouTube">Video</span></paper-radio-button>
          <paper-radio-button id="title-option" name="type-option"><span title="Movie, TV Episode/Series">Movie or TV Episode/Series</span></paper-radio-button>
        </paper-radio-group>
        <div style="justify-content:flex-end; margin-top:20px;">
          <paper-button raised id="yes-create-info">Ok</paper-button>
          <paper-button raised id="no-create-info">Cancel</paper-button>
        </div>
      </div>
      `,
      0
    );

    const videoOption = toast.toastElement.querySelector("#video-option");
    const titleOption = toast.toastElement.querySelector("#title-option");
    const okBtn = toast.toastElement.querySelector("#yes-create-info");
    const cancelBtn = toast.toastElement.querySelector("#no-create-info");

    okBtn.onclick = async () => {
      toast.hideToast();
      try {
        if (videoOption.checked) {
          const info = await this.createVideoInformations(file);
          file.videos = [info];
        } else if (titleOption.checked) {
          const info = await this.createTitleInformations(file);
          file.titles = [info];
        }
        Backend.eventHub.publish(`display_media_infos_${this._fileExplorer.id}_event`, file, true);
      } catch (err) {
        displayError(`Failed to create information: ${err.message}`, 3000);
      } finally { this._closeContextMenu(); }
    };
    cancelBtn.onclick = () => { toast.hideToast(); this._closeContextMenu(); };
  }

  _createCommonMediaMetadata(file) {
    const uuid = getUuidByString(file.getName());
    const date = new Date();

    const publisher = new PublisherMsg();
    // Fill publisher fields from your account controller if needed
    const poster = new PosterMsg();
    poster.setContenturl(file.getThumbnail());
    poster.setUrl();

    const url = buildFileHttpUrl(file.getPath());
    return { uuid, date, publisher, poster, url };
  }

  _getVideoDuration(videoUrl) {
    return new Promise((resolve) => {
      const vid = document.createElement("video");
      vid.src = videoUrl;
      vid.onloadedmetadata = () => { resolve(parseInt(vid.duration) || 0); vid.remove(); };
      vid.onerror = () => { resolve(0); vid.remove(); };
    });
  }

  createAudioInformations(file, callback) { if (callback) callback(null); }

  async createTitleInformations(file) {
    const { uuid, url, poster } = this._createCommonMediaMetadata(file);
    const titleInfo = new TitleMsg();
    titleInfo.setId(uuid);
    titleInfo.setPoster(poster);
    titleInfo.setUrl(url);
    if (file.getIsDir()) titleInfo.setType("TVSeries");

    try {
      let duration = 0;
      if (!file.getIsDir()) duration = await this._getVideoDuration(url);
      titleInfo.setDuration(duration);
      await createTitleAndAssociate(titleInfo, file.getPath());
      displayMessage(`Title info created for ${file.getName()}`, 3000);
      return titleInfo;
    } catch (err) { displayError(`Failed to create title info: ${err.message}`, 3000); throw err; }
  }

  async createVideoInformations(file) {
    const { uuid, date, publisher, poster, url } = this._createCommonMediaMetadata(file);
    const videoInfo = new VideoMsg();
    videoInfo.setId(uuid);
    videoInfo.setDate(date.toISOString());
    videoInfo.setPublisherid(publisher);
    videoInfo.setPoster(poster);
    videoInfo.setUrl(url);

    try {
      let duration = 0;
      if (!file.getIsDir()) duration = await this._getVideoDuration(url);
      videoInfo.setDuration(duration);
      await createVideoAndAssociate(videoInfo, file.getPath());
      displayMessage(`Video info created for ${file.getName()}`, 3000);
      return videoInfo;
    } catch (err) { displayError(`Failed to create video info: ${err.message}`, 3000); throw err; }
  }

  hide() { if (this.div) this.div.style.display = "none"; this._closeContextMenu(); }
  _hideOnlyMenu() { if (this._contextMenu) { this._contextMenu.close(); if (this._contextMenu.parentNode) this._contextMenu.parentNode.removeChild(this._contextMenu); } }
  show() { this._hideOnlyMenu(); if (this.div) this.div.style.display = "block"; }

  async _handleDrop(evt) {
    evt.stopPropagation();
    evt.preventDefault();
    const lnk = evt.dataTransfer.getData("text/html");
    const url = evt.dataTransfer.getData("Url");

    if (url) {
      await this._handleUrlDrop(url, lnk);
    } else if (evt.dataTransfer.files.length > 0) {
      await this._handleFileDrop(evt.dataTransfer.files, lnk);
    } else {
      await this._handleInternalDragDrop(evt);
    }
  }

  async _handleUrlDrop(url, lnk) {
    const destPath = this._currentDir ? this._currentDir.getPath() : "/";
    try {
      if (/\.(jpeg|jpg|bmp|gif|png)$/i.test(url)) {
        const fileObject = await this._getFileObjectFromUrl(url);
        await uploadFilesHttp(destPath, [fileObject]);
        Backend.eventHub.publish("__upload_files_event__", { dir: this._currentDir, files: [fileObject], lnk }, true);
      } else {
        await this._promptAndUploadVideoLink(url, lnk);
      }
    } catch (err) { displayError(`Failed to process URL drop: ${err.message}`, 3000); }
  }

  async _getFileObjectFromUrl(url) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.timeout = 15000;
      xhr.open("GET", url);
      xhr.responseType = "blob";
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          const blob = xhr.response;
          const fileName = url.substring(url.lastIndexOf("/") + 1).split("?")[0];
          const fileObject = new File([blob], fileName, { type: blob.type, lastModified: new Date().getTime() });
          resolve(fileObject);
        } else {
          reject(new Error(`Failed to fetch file from URL: ${xhr.status} ${xhr.statusText}`));
        }
      };
      xhr.onerror = () => reject(new Error("Network error fetching file from URL."));
      xhr.ontimeout = () => reject(new Error("Timeout fetching file from URL."));
      xhr.send();
    });
  }

  async _promptAndUploadVideoLink(url, lnk) {
    const toast = displayMessage(
      `
      <div id="select-media-dialog">
        <span>What kind of file do you want to create?</span>
        <div style="display:flex; justify-content:center;">
          <paper-radio-group selected="media-type-mp4">
            <paper-radio-button id="media-type-mp4" name="media-type">Video (mp4)</paper-radio-button>
            <paper-radio-button id="media-type-mp3" name="media-type">Audio (mp3)</paper-radio-button>
          </paper-radio-group>
        </div>
        <div style="display:flex; justify-content:flex-end;">
          <paper-button id="upload-lnk-ok-button">Ok</paper-button>
          <paper-button id="upload-lnk-cancel-button">Cancel</paper-button>
        </div>
      </div>`,
      60 * 1000
    );

    const mp4Radio = toast.toastElement.querySelector("#media-type-mp4");
    const mp3Radio = toast.toastElement.querySelector("#media-type-mp3");
    const okBtn = toast.toastElement.querySelector("#upload-lnk-ok-button");
    const cancelBtn = toast.toastElement.querySelector("#upload-lnk-cancel-button");

    mp4Radio.addEventListener("change", () => { mp3Radio.checked = !mp4Radio.checked; });
    mp3Radio.addEventListener("change", () => { mp4Radio.checked = !mp3Radio.checked; });

    return new Promise((resolve, reject) => {
      okBtn.onclick = async () => {
        toast.hideToast();
        try {
          await uploadVideoByUrl({ url, dest: this._currentDir.getPath(), format: mp3Radio.checked ? "mp3" : "mp4" });
          displayMessage("Your link was queued and will be processed soon...", 3000);
          resolve();
        } catch (err) { displayError(err?.message || err, 3000); reject(err); }
      };
      cancelBtn.onclick = () => { toast.hideToast(); resolve(); };
    });
  }

  async _handleFileDrop(files, lnk) {
    if (!this._currentDir) { displayError("Current directory not available for file upload.", 3000); return; }
    try {
      Backend.eventHub.publish("__upload_files_event__", { dir: this._currentDir, files: Array.from(files), lnk }, true);
      displayMessage(`Uploading ${files.length} file(s)...`, 3000);
    } catch (err) { displayError(`Failed to initiate file upload: ${err.message}`, 3000); }
  }

  async _handleInternalDragDrop(evt) {
    // unchanged: menu to choose copy/move/link
    const filesData = JSON.parse(evt.dataTransfer.getData("files"));
    const id = evt.dataTransfer.getData("id");
    const domain = evt.dataTransfer.getData("domain");

    if (document.getElementById("file-actions-menu")) return;

    const menuHtml = `
      <style>
        #file-actions-menu{ background-color:var(--surface-color); color:var(--primary-text-color); position:absolute; min-width:140px; box-shadow:var(--shadow-elevation-2dp); border-radius:4px; overflow:hidden; }
        .menu-item{ font-size:1rem; padding:8px 10px; display:flex; align-items:center; transition:background .2s ease; }
        .menu-item iron-icon{ margin-right:10px; }
        .menu-item:hover{ cursor:pointer; background-color:var(--palette-primary-accent); }
      </style>
      <paper-card id="file-actions-menu">
        <div id="copy-menu-item" class="menu-item"><iron-icon icon="icons:content-copy"></iron-icon><span>Copy</span></div>
        <div id="move-menu-item" class="menu-item"><iron-icon icon="icons:compare-arrows"></iron-icon><span>Move</span></div>
        <div id="create-lnks-menu-item" class="menu-item"><iron-icon icon="icons:link"></iron-icon><span>Create link</span></div>
        <div id="cancel-menu-item" class="menu-item"><iron-icon icon="icons:cancel"></iron-icon><span>Cancel</span></div>
      </paper-card>`;

    const range = document.createRange();
    document.body.appendChild(range.createContextualFragment(menuHtml));
    const menu = document.getElementById("file-actions-menu");
    const coords = getCoords(this._fileExplorer.filesIconView);
    menu.style.top = `${coords.top + 44}px`;
    menu.style.left = `${coords.left + 10}px`;

    const moveListener = (e) => {
      if (menu.parentNode) {
        const updatedCoords = getCoords(this._fileExplorer.filesIconView);
        menu.style.top = `${updatedCoords.top + 44}px`;
        menu.style.left = `${updatedCoords.left + 10}px`;
      } else {
        this._fileExplorer.removeEventListener("move", moveListener);
      }
    };
    this._fileExplorer.addEventListener("move", moveListener);

    const executeDropAction = async (mode) => {
      this._editMode = mode;
      FileExplorer.paperTray = [];
      if (Object.keys(this._selected).length > 0) {
        for (const key in this._selected) FileExplorer.paperTray.push(this._selected[key].path);
      }
      filesData.forEach((f) => FileExplorer.paperTray.push(f));
      if (id) {
        const draggedDiv = this.div.querySelector("#" + id);
        if (draggedDiv && draggedDiv.parentNode) draggedDiv.parentNode.style.display = "none";
      }
      Backend.eventHub.publish(`drop_file_${this._fileExplorer.id}_event`, { file: filesData.length > 0 ? filesData[0] : null, dir: this._currentDir.getPath(), id, domain }, true);
      if (menu.parentNode) menu.parentNode.removeChild(menu);
      this._fileExplorer.removeEventListener("move", moveListener);
    };

    menu.querySelector("#copy-menu-item").onclick = () => executeDropAction("copy");
    menu.querySelector("#move-menu-item").onclick = () => executeDropAction("cut");
    menu.querySelector("#create-lnks-menu-item").onclick = () => executeDropAction("lnks");
    menu.querySelector("#cancel-menu-item").onclick = () => { if (menu.parentNode) menu.parentNode.removeChild(menu); this._fileExplorer.removeEventListener("move", moveListener); };
  }
}

customElements.define("globular-files-view", FilesView);

// ---- helpers kept from previous code (minimal shims) ----
async function promisifiedGetFileVideosInfo(file, globule) {
  return new Promise((resolve, reject) => {
    try { TitleController.getFileVideosInfo(file, resolve, reject, globule); } catch (e) { resolve([]); }
  });
}
async function promisifiedGetFileTitlesInfo(file, globule) {
  return new Promise((resolve, reject) => {
    try { TitleController.getFileTitlesInfo(file, resolve, reject, globule); } catch (e) { resolve([]); }
  });
}
async function getAudioInfo(file) { return []; }

// Simple confirm dialog helper (unchanged)
FilesView.prototype._showConfirmationDialog = function (contentHtml, onYes, onNo, yesBtnId, noBtnId) {
  const toast = displayMessage(
    `
    <style>
      #confirm-dialog-box { display:flex; flex-direction:column; }
      #confirm-dialog-box div { display:flex; padding-bottom:10px; }
      paper-button { font-size:.8rem; margin-left:8px; }
    </style>
    <div id="confirm-dialog-box">${contentHtml}
      <div style="justify-content:flex-end; padding-top:10px; padding-bottom:0;">
        <paper-button raised id="${yesBtnId}">Yes</paper-button>
        <paper-button raised id="${noBtnId}">No</paper-button>
      </div>
    </div>`,
    15 * 1000
  );
  const yesBtn = document.querySelector(`#${yesBtnId}`);
  const noBtn = document.querySelector(`#${noBtnId}`);
  if (yesBtn) yesBtn.onclick = () => { toast.hideToast(); onYes && onYes(); };
  if (noBtn) noBtn.onclick = () => { toast.hideToast(); onNo && onNo(); };
};
