// components/filesView.js — restored functionality with existing backend wrappers (no invented APIs)
import { ShareResourceMenu } from "../share/shareResourceMenu";
import { DropdownMenu } from "../menu.js";

import { displayError, displayMessage } from "../../backend/ui/notify";
import { Backend } from "../../backend/backend";

// FS + media wrappers (only what exists in your refactor)
import {
  upload as uploadFilesHttp,
  download as downloadHttp,
  removeDir,
  removeFile,
  removePublicDir,
  renameFile,
  createArchive,
  copyFiles,
  moveFiles
} from "../../backend/cms/files";

import {
  convertVideoToMpeg4H264,
  convertVideoToHls,
  createVideoTimeLine,
  createVideoPreview,
  startProcessVideo,
  uploadVideoByUrl,
} from "../../backend/media/media";

import {
  createTitleAndAssociate,
  createVideoAndAssociate,
} from "../../backend/media/title";

import { getBaseUrl } from "../../backend/core/endpoints";
import { getCoords, copyToClipboard } from "../utility.js";

// DRY helpers for proto/VM getters
import {
  pathOf,
  nameOf,
  mimeOf,
  isDir as isDirOf,
  thumbOf,
} from "./filevm-helpers.js";

// UI deps
import "@polymer/paper-input/paper-input.js";
import "@polymer/paper-radio-group/paper-radio-group.js";
import "@polymer/paper-radio-button/paper-radio-button.js";
import "@polymer/paper-button/paper-button.js";
import "@polymer/iron-icon/iron-icon.js";
import "@polymer/iron-icons/iron-icons.js";
import "@polymer/iron-icons/maps-icons.js";
import "@polymer/paper-progress/paper-progress.js";
import "@polymer/paper-card/paper-card.js";

import { FileExplorer } from "./fileExplorer.js";
import { get } from "@polymer/polymer/lib/utils/path";

// ---- helpers to build HTTP file URL (replaces getUrl(globule)) ----
function buildFileHttpUrl(path, isHls) {
  const base = (getBaseUrl() || "").replace(/\/$/, "");
  const parts = (path || "")
    .split("/")
    .map((s) => encodeURIComponent(s))
    .filter(Boolean)
    .join("/");
  return `${base}/${parts}${isHls ? "/playlist.m3u8" : ""}`;
}

// Optional data root adapter (keep undefined if not needed)
const DATA_ROOT = undefined;
function toAbsoluteFsPath(path, dataRoot) {
  if (!dataRoot) return path;
  return path?.startsWith("/") ? dataRoot + path : dataRoot + "/" + path;
}

/**
 * Base class for FilesListView and FilesIconView.
 */
export class FilesView extends HTMLElement {
  _active = false;
  _fileExplorer = null;
  _path = undefined;
  _currentDir = null;
  _selected = {};

  _shareResourceMenu = null;
  _contextMenu = null;
  _editMode = "";

  // Context menu items
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
  _legacyOpenMenuBound = false;

  constructor() {
    super();
    this._onDocClickClose = this._onDocClickClose.bind(this);
    this._onScrollClose = this._onScrollClose.bind(this);

    // new: universal open-menu handlers
    this._onOpenFileMenuEvent = this._onOpenFileMenuEvent.bind(this);
    this._onRightClick = this._onRightClick.bind(this);
  }

  /* ---------- visibility controls ---------- */
  show() {
    this.style.display = "";
    this.setActive(true);
    this.hideMenu();
  }

  hide() {
    this.style.display = "none";
    this.setActive(false);
    this.hideMenu();
  }

  hideMenu() {
    if (this._contextMenu?.isOpen?.()) this._contextMenu.close();
    if (this._contextMenu && this._contextMenu.parentNode === document.body) {
      document.body.removeChild(this._contextMenu);
    }
  }
  /* ---------------------------------------- */

  connectedCallback() {
    // One shared menu instance per view
    this._shareResourceMenu = new ShareResourceMenu(this);

    const menuItemsHTML = `
      <globular-dropdown-menu-item id="cut-menu-item" icon="icons:content-cut" text="Cut" title="Cut the selected item"></globular-dropdown-menu-item>
      <globular-dropdown-menu-item id="copy-menu-item" icon="icons:content-copy" text="Copy" title="Copy the selected item"></globular-dropdown-menu-item>
      <globular-dropdown-menu-item id="paste-menu-item" icon="icons:content-paste" text="Paste" title="Paste the copied item"></globular-dropdown-menu-item>
      <globular-dropdown-menu-item id="rename-menu-item" icon="icons:create" text="Rename" title="Rename the selected item"></globular-dropdown-menu-item>
      <globular-dropdown-menu-item id="delete-menu-item" icon="icons:delete" text="Delete" title="Delete the selected item"></globular-dropdown-menu-item>

      <globular-dropdown-menu-item separator="true" id="file-infos-menu-item" icon="icons:info" text="File Infos" title="View file information"></globular-dropdown-menu-item>
      <globular-dropdown-menu-item id="title-infos-menu-item" icon="icons:info" text="Title Infos" title="View title information" style="display:none;"></globular-dropdown-menu-item>
      <globular-dropdown-menu-item id="refresh-infos-menu-item" icon="icons:refresh" text="Refresh Infos" title="Convert media, generate timeline & preview" style="display:none;"></globular-dropdown-menu-item>

      <globular-dropdown-menu-item separator="true" id="shared-menu-item" icon="social:share" text="Share" title="Share this item"></globular-dropdown-menu-item>
      <globular-dropdown-menu-item id="manage-acess-menu-item" icon="icons:folder-shared" text="Manage Access" title="Manage access permissions"></globular-dropdown-menu-item>

      <globular-dropdown-menu-item separator="true" id="video-menu-item" icon="maps:local-movies" text="Movies" title="Movie-related actions" style="display:none;">
        <globular-dropdown-menu>
          <globular-dropdown-menu-item id="generate-timeline-menu-item" icon="maps:local-movies" text="Generate Timeline" title="Generate a timeline for the movie"></globular-dropdown-menu-item>
          <globular-dropdown-menu-item id="generate-preview-menu-item" icon="maps:local-movies" text="Generate Preview" title="Generate a preview for the movie"></globular-dropdown-menu-item>
          <globular-dropdown-menu-item id="to-mp4-menu-item" icon="maps:local-movies" text="Convert to MP4" title="Convert the movie to MP4 format" style="display:none;"></globular-dropdown-menu-item>
          <globular-dropdown-menu-item id="to-hls-menu-item" icon="maps:local-movies" text="Convert to HLS" title="Convert the movie to HLS format" style="display:none;"></globular-dropdown-menu-item>
        </globular-dropdown-menu>
      </globular-dropdown-menu-item>

      <globular-dropdown-menu-item separator="true" id="download-menu-item" icon="icons:cloud-download" text="Download" title="Download the selected item"></globular-dropdown-menu-item>
      <globular-dropdown-menu-item id="open-in-new-tab-menu-item" icon="icons:open-in-new" text="Open in New Tab" title="Open the selected item in a new tab" style="display:none;"></globular-dropdown-menu-item>
      <globular-dropdown-menu-item id="copy-url-menu-item" icon="icons:link" text="Copy URL" title="Copy the URL of the selected item"></globular-dropdown-menu-item>
    `;

    this._contextMenu = new DropdownMenu("icons:more-vert");
    this._contextMenu.style.zIndex = 1000;
    this._contextMenu.className = "file-dropdown-menu";
    this._contextMenu.innerHTML = menuItemsHTML;

    // light global listeners to close menu
    document.addEventListener("click", this._onDocClickClose, true);
    document.addEventListener("scroll", this._onScrollClose, true);

    // NEW: modern trigger (custom event) + right-click
    document.addEventListener("globular-open-file-menu", this._onOpenFileMenuEvent, true);
    this.addEventListener("contextmenu", this._onRightClick, true);

    // Ensure backend event subscriptions are active (incl. legacy open-menu)
    this._setupBackendSubscriptions();
    this._setupLegacyOpenMenuSubscription();
  }

  disconnectedCallback() {
    this._closeContextMenu();
    document.removeEventListener("click", this._onDocClickClose, true);
    document.removeEventListener("scroll", this._onScrollClose, true);
    document.removeEventListener("globular-open-file-menu", this._onOpenFileMenuEvent, true);
    this.removeEventListener("contextmenu", this._onRightClick, true);
  }

  _onDocClickClose() { this._closeContextMenu(); }
  _onScrollClose() { this._closeContextMenu(); }

  // expose the shared menu to children that expect `view.menu`
  get menu() { return this._contextMenu; }

  setActive(active) {
    this._active = !!active;
    this.classList.toggle("active", this._active);
  }

  setFileExplorer(explorer) {
    this._fileExplorer = explorer;
    // rebinding the legacy open-menu topic with the right id
    this._legacyOpenMenuBound = false;
    this._setupLegacyOpenMenuSubscription();
  }

  setDir(dir) { this._currentDir = dir; this._path = dir ? pathOf(dir) : undefined; }
  setSelected(selected) { this._selected = selected; }

  // ---------- modern / right-click openers ----------
  async _onOpenFileMenuEvent(e) {
    const { anchor, file, highlightEl } = e.detail || {};
    if (!anchor || !file) return;
    this.showContextMenu(anchor, file, highlightEl);
    e.stopPropagation();
  }

  async _onRightClick(e) {
    const carrier = e.target.closest("[data-file], [data-file-ref]");
    if (!carrier) return; // let native menu elsewhere
    e.preventDefault();
    let file = carrier.__file || null;
    if (!file) {
      try { file = JSON.parse(carrier.getAttribute("data-file") || "null"); } catch (_) { }
    }
    if (!file) return;
    this.showContextMenu(carrier, file, carrier);
  }

  // ---------- backend pub/sub ----------
  _setupBackendSubscriptions() {
    Backend.eventHub.subscribe(
      "__create_link_event__",
      () => { },
      (evt) => {
        if (!this._fileExplorer || this._fileExplorer.id !== evt.file_explorer_id) return;
        if (!this._active) return;
        this._fileExplorer.createLink?.(evt.file, evt.dest, evt.globule);
      },
      true,
      this
    );

    Backend.eventHub.subscribe(
      "__set_dir_event__",
      () => { },
      (evt) => {
        if (!this._fileExplorer || this._fileExplorer.id !== evt.file_explorer_id) return;
        if (evt.dir) {
          this._currentDir = evt.dir;
          this._contextMenu.setFile?.(evt.dir);
          this.setDir(evt.dir);
        }
      },
      true,
      this
    );

    const dropEvt = `drop_file_${this._fileExplorer ? this._fileExplorer.id : "default"}_event`;
    Backend.eventHub.subscribe(
      dropEvt,
      () => { },
      async (infos) => {
        try {
          // Optional: if you want to ignore drops when explorer is in background
          // if (!this._fileExplorer || this._fileExplorer.style?.zIndex !== "1000") return;

          // 1) Build the list of source paths (purely local to this operation)
          if (!this._editMode) this._editMode = "cut"; // default to move

          let srcPaths = [];

          if (this._selected && Object.keys(this._selected).length > 0) {
            for (const key in this._selected) {
              srcPaths.push(pathOf(this._selected[key]));
            }
          } else if (infos && infos.file) {
            const single = infos.file;
            const asPath =
              typeof single === "string"
                ? single
                : single.path || single._path || "";
            if (asPath) srcPaths.push(asPath);
          }

          srcPaths = srcPaths
            .filter((p) => !!p && typeof p === "string");

          if (srcPaths.length === 0) {
            return;
          }

          // 2) Destination directory (from the drop payload, or current dir as fallback)
          const destDir = (infos && infos.dir) || this._path || "/";
          const mode = this._editMode || "cut";

          if (mode === "lnks") {
            if (!this._fileExplorer?.createLink) {
              displayError("Link creation is not available in this view.", 3000);
            } else {
              for (const srcPath of srcPaths) {
                try {
                  await this._fileExplorer.createLink(srcPath, destDir);
                } catch (err) {
                  displayError(`Failed to create link for ${srcPath}: ${err?.message || err}`, 4000);
                }
              }
            }

            this._selected = {};
            this._fileExplorer?.clearSelections?.();
            this._fileExplorer?.clearClipboard?.();
            this._editMode = "";
            Backend.eventHub.publish("reload_dir_event", destDir, true);
            this._closeContextMenu();
            return;
          }

          // 3) Execute backend operation
          const isCopy = mode === "copy";

          if (isCopy) {
            await copyFiles(destDir, srcPaths);
          } else {
            await moveFiles(destDir, srcPaths);
          }

          // 4) Cleanup selection/edit mode
          this._selected = {};
          this._fileExplorer?.clearSelections?.();
          this._editMode = undefined; // reset to default

          // 5) Refresh view to reflect backend state
          Backend.eventHub.publish(
            "reload_dir_event",
            this._path || destDir,
            true
          );
        } catch (e) {
          console.error("Error handling drop_file event", e);
          displayError("Failed to complete file operation.", 4000);
        }
      },
      true,
      this
    );

  }

  // legacy EventHub opener: open_files_menu_{id}_event
  _setupLegacyOpenMenuSubscription() {
    if (this._legacyOpenMenuBound) return;
    const id = this._fileExplorer ? this._fileExplorer.id : "default";
    const openEvt = `open_files_menu_${id}_event`;
    Backend.eventHub.subscribe(
      openEvt,
      () => { },
      async ({ anchorId, file }) => {
        const anchor = document.getElementById(anchorId);
        if (anchor && file) this.showContextMenu(anchor, file, anchor);
      },
      true,
      this
    );
    this._legacyOpenMenuBound = true;
  }

  // ---------- ensure menu is attached & wired ----------
  _ensureMenuWired() {
    if (!this._contextMenu) return;

    // 1) Ensure the menu is actually in the document
    if (this._contextMenu.parentNode !== document.body) {
      document.body.appendChild(this._contextMenu);
    }

    // 4) Now query all the items (they’re upgraded & slotted)
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

    // 6) Finally wire the actions (unchanged)
    this._setupMenuActions();
  }

  _closeContextMenu() { this.hideMenu(); }

  // in components/filesView.js
  showContextMenu(anchor, file, highlightEl) {
    const menu = this._contextMenu;
    if (!menu || !file) return;

    // Ensure items exist and are wired
    this._ensureMenuWired();

    // Keep a reference and update item visibility
    menu.setFile?.(file);

    // Make sure the element lives under <body> (positioning context)
    if (menu.parentNode !== document.body) {
      document.body.appendChild(menu);
    }

    // Hide the menu’s own trigger button; we open programmatically
    menu.hideBtn?.();

    // Keep the coords for reference
    menu.reference_element = highlightEl;

    // Compute coordinates
    const rect = anchor.getBoundingClientRect();
    const x = (rect.left || 0) + rect.width;
    const y = (rect.top || 0) + 6;

    // Open at position (prefer the component’s API)
    if (typeof menu.openAt === "function") {
      menu.openAt(x, y);
    } else {
      menu.style.position = "absolute";
      menu.style.left = `${x}px`;
      menu.style.top = `${y}px`;
      menu.open?.();
    }

    // Keep the tile highlighted while the menu is open
    if (highlightEl) {
      menu.onmouseenter = () => highlightEl.classList.add("active");
      menu.onmouseleave = () => highlightEl.classList.remove("active");
    }
  }

  // ---------- Wire actions (runs only after items are attached/upgraded) ----------
  _setupMenuActions() {
    this._contextMenu.setFile = (file) => {
      this._contextMenu.file = file;
      const mime = (mimeOf(file) || "").toLowerCase();
      const name = nameOf(file) || "";

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
        } else if (mime !== "video/hls-stream") {
          this._toMp4MenuItem.style.display = "block";
        }
      } else if (mime.startsWith("audio") || file.videos || file.titles) {
        this._titleInfosMenuItem.style.display = "block";
      }

      if (isDirOf(file)) {
        this._refreshInfoMenuItem.style.display = "block";
      }
    };

    // Actions
    this._sharedMenuItem.action = this._handleShareAction.bind(this);
    this._refreshInfoMenuItem.action = this._handleRefreshInfoAction.bind(this);
    this._cutMenuItem.action = this._handleCutAction.bind(this);
    this._copyMenuItem.action = this._handleCopyAction.bind(this);
    this._pasteMenuItem.action = this._handlePasteAction.bind(this);
    this._openInNewTabItem.action = this._handleOpenInNewTabAction.bind(this);
    this._copyUrlItem.action = this._handleCopyUrlAction.bind(this);
    this._downloadMenuItem.action = this._handleDownloadAction.bind(this);
    this._deleteMenuItem.action = this._handleDeleteAction.bind(this);

    this._renameMenuItem.action = () => {
      const file = this._contextMenu.file;
      if (!file) return;
      let coords = getCoords(this._contextMenu.reference_element);
      //coords.left += this._contextMenu.reference_element.offsetWidth;
      coords.top += this._contextMenu.reference_element.offsetHeight / 2;
      this.rename(document.body, file, coords);
      this._closeContextMenu();
    };

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
      for (const key in this._selected) files.push(this._selected[key]);
    } else if (this._contextMenu.file) {
      files.push(this._contextMenu.file);
    }
    return files;
  }

  // ---------- Actions (restored) ----------
  _handleShareAction() {
    const files = this._getFilesForAction();
    if (files.length > 0) {
      this._shareResourceMenu.setFiles(files);
      this._shareResourceMenu.share();
    }
    this._closeContextMenu();
  }

  async _handleRefreshInfoAction() {
    const file = this._contextMenu.file;
    if (!file) return;

    let absPath = pathOf(file);
    if (DATA_ROOT && (absPath.startsWith("/users") || absPath.startsWith("/applications"))) {
      absPath = toAbsoluteFsPath(absPath, DATA_ROOT + "/files");
    }

    try {
      displayMessage(`Updating information for: ${absPath}`, 3500);
      await startProcessVideo(absPath); // wrapper call
      displayMessage("Information updated successfully!", 3000);
    } catch (err) {
      displayError(`Failed to update information: ${err?.message || err}`, 3000);
    } finally {
      this._closeContextMenu();
    }
  }
  _handleCutAction() {
    const files = this._getFilesForAction();
    if (!files || files.length === 0) {
      this._closeContextMenu();
      return;
    }

    const paths = files.map((f) => pathOf(f));
    this._editMode = "cut";
    this._fileExplorer?.setClipboard?.("cut", paths);

    this._selected = {};
    this._fileExplorer?.clearSelections?.();
    this._closeContextMenu();
  }

  _handleCopyAction() {
    const files = this._getFilesForAction();
    if (!files || files.length === 0) {
      this._closeContextMenu();
      return;
    }

    const paths = files.map((f) => pathOf(f));
    this._editMode = "copy";
    this._fileExplorer?.setClipboard?.("copy", paths);

    this._selected = {};
    this._fileExplorer?.clearSelections?.();
    this._closeContextMenu();
  }

  _handleLinkAction() {
    const files = this._getFilesForAction();
    if (!files || files.length === 0) {
      this._closeContextMenu();
      return;
    }

    const paths = files.map((f) => pathOf(f));
    this._editMode = "lnks";
    this._fileExplorer?.setClipboard?.("link", paths);

    this._selected = {};
    this._fileExplorer?.clearSelections?.();
    this._closeContextMenu();
  }
  async _handlePasteAction() {
    const clipboard = this._fileExplorer?.getClipboard?.() || {};
    const srcPaths = (clipboard.items || []).filter((p) => !!p && typeof p === "string");
    const mode = clipboard.mode || this._editMode || "cut";

    if (!srcPaths.length) {
      displayMessage("Nothing to paste.", 2500);
      this._closeContextMenu();
      return;
    }

    // Paste into the currently opened directory
    const destDir = this._path || (this._fileExplorer && this._fileExplorer._path) || "/";
    const isCopy = (mode === "copy");

    try {
      if (isCopy) {
        await copyFiles(destDir, srcPaths);
      } else {
        await moveFiles(destDir, srcPaths);
      }

      this._selected = {};
      this._fileExplorer?.clearSelections?.();
      this._fileExplorer?.clearClipboard?.();
      this._editMode = "";

      Backend.eventHub.publish("reload_dir_event", destDir, true);
    } catch (err) {
      console.error("Paste failed", err);
      displayError(err?.message || "Paste failed.", 4000);
    } finally {
      this._closeContextMenu();
    }
  }


  async _handleOpenInNewTabAction() {
    const file = this._contextMenu.file;
    if (!file) return;

    const mime = (mimeOf(file) || "").toLowerCase();
    const isHls = mime === "video/hls-stream";
    const url = buildFileHttpUrl(pathOf(file), isHls);

    try {
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (err) {
      displayError(`Failed to open in new tab: ${err?.message || err}`, 3000);
    } finally {
      this._closeContextMenu();
    }
  }

  async _handleCopyUrlAction() {
    const file = this._contextMenu.file;
    if (!file) return;

    const mime = (mimeOf(file) || "").toLowerCase();
    const isHls = mime === "video/hls-stream"; // fixed
    const url = buildFileHttpUrl(pathOf(file), isHls);
    const token = sessionStorage.getItem("__globular_token__") || "";
    const urlWithToken = token ? `${url}${url.includes("?") ? "&" : "?"}token=${encodeURIComponent(token)}` : url;

    try {
      copyToClipboard(urlWithToken);
      displayMessage("URL was copied to clipboard!", 3000);
    } catch (err) {
      displayError(`Failed to copy URL: ${err?.message || err}`, 3000);
    } finally {
      this._closeContextMenu();
    }
  }

  async _handleDownloadAction() {
    const selected = (this._getFilesForAction && this._getFilesForAction()) || [];
    const ctxFile = this._contextMenu && this._contextMenu.file;

    // ---------------- helpers ----------------
    const makeArchiveName = () => {
      const r = (typeof crypto !== "undefined" && crypto.randomUUID)
        ? crypto.randomUUID()
        : (Date.now().toString(16) + Math.random().toString(16).slice(2));
      return "_" + r.replace(/[-@]/g, "_");
    };
    const getToken = () => sessionStorage.getItem("__globular_token__") || "";
    const withTokenUrl = (url, token) =>
      token ? `${url}${url.includes("?") ? "&" : "?"}token=${encodeURIComponent(token)}` : url;
    const downloadByUrl = async (url, filename) => {
      try {
        const response = await fetch(url);
        const blob = await response.blob(); // Get the file content as a Blob

        const objectURL = URL.createObjectURL(blob); // Create a URL for the Blob

        const link = document.createElement('a');
        link.href = objectURL;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        URL.revokeObjectURL(objectURL); // Release the object URL after use
      } catch (error) {
        console.error('Error downloading file:', error);
      }
    };

    // Determine intent
    const manySelected = selected.length > 1;
    const oneSelected = selected.length === 1;
    const anyDirSelected = selected.some((f) => isDirOf(f));

    // ---------- CASE 1: multi or any directory -> archive ----------
    if (manySelected || anyDirSelected) {
      const files = selected.map((f) => pathOf(f)).filter(Boolean);
      if (!files.length) {
        this._closeContextMenu();
        return;
      }

      const token = getToken();
      const uuid = makeArchiveName();
      this._fileExplorer?.displayWaitMessage?.("Creating archive for selected items...");

      try {
        const archivePath = await createArchive(files, uuid, token); // returns server path like /tmp/_abc.tar.gz
        const url = withTokenUrl(buildFileHttpUrl(archivePath), token);

        this._fileExplorer?.displayWaitMessage?.("Downloading archive...");
        await downloadByUrl(url, `${uuid}.tar.gz`);

        this._fileExplorer?.displayWaitMessage?.("Removing temporary archive...");
        await removeFile(archivePath, token);

        displayMessage("Archive downloaded and cleaned up.", 2500);
      } catch (err) {
        displayError(`Archive download failed: ${err?.message || err}`, 4000);
      } finally {
        this._fileExplorer?.resume?.();
        this._fileExplorer?.clearSelections?.();
        this._selected = {};
        this._closeContextMenu();
      }
      return;
    }

    // ---------- CASE 2: exactly one selection and it's a regular file ----------
    if (oneSelected && !isDirOf(selected[0])) {
      const token = getToken();
      const filePath = pathOf(selected[0]);
      const fileName = nameOf(selected[0]);

      try {
        const url = withTokenUrl(buildFileHttpUrl(filePath), token);
        await downloadByUrl(url, fileName);
        displayMessage(`Downloaded ${fileName}`, 2500);
      } catch (err) {
        displayError(`Download failed: ${err?.message || err}`, 4000);
      } finally {
        this._fileExplorer?.clearSelections?.();
        this._selected = {};
        this._closeContextMenu();
      }
      return;
    }

    // ---------- CASE 3: no selection -> fall back to context file ----------
    if (!ctxFile) {
      this._closeContextMenu();
      return;
    }

    const token = getToken();
    const filePath = pathOf(ctxFile);
    const fileName = nameOf(ctxFile);

    if (isDirOf(ctxFile)) {
      // right-clicked on a directory → archive flow
      const uuid = makeArchiveName();
      this._fileExplorer?.displayWaitMessage?.(`Creating archive for ${fileName}...`);
      try {
        const archivePath = await createArchive([filePath], uuid, token);
        const url = withTokenUrl(buildFileHttpUrl(archivePath), token);

        this._fileExplorer?.displayWaitMessage?.("Downloading archive...");
        await downloadByUrl(url, `${fileName}.tar.gz`);

        this._fileExplorer?.displayWaitMessage?.("Removing temporary archive...");
        await removeFile(archivePath, token);

        displayMessage("Archive downloaded and cleaned up.", 2500);
      } catch (err) {
        displayError(`Directory download failed: ${err?.message || err}`, 4000);
      } finally {
        this._fileExplorer?.resume?.();
        this._selected = {};
        this._fileExplorer?.clearSelections?.();
        this._closeContextMenu();
      }
      return;
    }

    // right-clicked a single regular file → direct download
    try {
      const url = withTokenUrl(buildFileHttpUrl(filePath), token);
      await downloadByUrl(url, fileName);
      displayMessage(`Downloaded ${fileName}`, 2500);
    } catch (err) {
      displayError(`Download failed: ${err?.message || err}`, 4000);
    } finally {
      this._selected = {};
      this._fileExplorer?.clearSelections?.();
      this._closeContextMenu();
    }
  }

  async _handleDeleteAction() {
    let filesToDelete = this._getFilesForAction();
    if (!filesToDelete.length) {
      this._closeContextMenu();
      return;
    }

    const explorerPath =
      this._fileExplorer?.getCurrentPath?.() ??
      this._fileExplorer?._path ??
      "/";
    const removingFromPublicRoot = explorerPath === "/public";

    const listHtml = filesToDelete.map((f) => `<div>${pathOf(f)}</div>`).join("");

    this._showConfirmationDialog(
      `
      <div>You're about to delete:</div>
      <div style="display:flex;flex-direction:column;">${listHtml}</div>
      <div>Are you sure?</div>
      `,
      async () => {
        try {
          const reloadTargets = new Set();
          let removedPublicEntries = false;
          let deletedRegularItems = false;

          for (const f of filesToDelete) {
            const p = pathOf(f);
            if (!p) continue;

            if (removingFromPublicRoot && isDirOf(f)) {
              await removePublicDir(p);
              removedPublicEntries = true;
              reloadTargets.add("/public");
              continue;
            }

            if (isDirOf(f)) {
              await removeDir(p);
            } else {
              await removeFile(p);
            }
            deletedRegularItems = true;
            const parent = p.substring(0, p.lastIndexOf("/")) || "/";
            reloadTargets.add(parent);
          }

          if (removedPublicEntries) {
            Backend.eventHub.publish("public_change_permission_event", null, true);
          }

          reloadTargets.forEach((path) => Backend.eventHub.publish("reload_dir_event", path, false));

          const message =
            removedPublicEntries && !deletedRegularItems
              ? "Removed from public directories."
              : "Delete complete.";
          displayMessage(message, 2500);

          // Clear selection in the explorer so the bar hides too
          this._selected = {};
          this._fileExplorer?.clearSelections?.();
        } catch (err) {
          displayError(`Failed to delete: ${err?.message || err}`, 3000);
        }
      },
      () => { },
      "yes-delete-files",
      "no-delete-files"
    );

    this._closeContextMenu();
  }

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
    if (!file) return;

    if (file.videos || file.titles || file.audios) {
      Backend.eventHub.publish(`display_media_infos_${this._fileExplorer.id}_event`, file, true);
      this._closeContextMenu();
      return;
    }

    const mime = (mimeOf(file) || "").toLowerCase();

    try {
      if (mime.startsWith("video") || isDirOf(file)) {
        await this._promptCreateVideoInfo(file);
      } else if (mime.startsWith("audio")) {
        displayMessage("No audio metadata found. (Add audio getters to title.ts to auto-fetch.)", 3500);
      }
    } catch (err) {
      displayError(`Failed to retrieve media info: ${err?.message || err}`, 3000);
      if (mime.startsWith("video") || isDirOf(file)) {
        await this._promptCreateVideoInfo(file);
      }
    } finally {
      this._closeContextMenu();
    }
  }

  async _promptCreateVideoInfo(file) {
    const toast = displayMessage(
      `
      <style>
        #yes-no-create-video-info-box{display:flex;flex-direction:column;}
        #yes-no-create-video-info-box img{max-height:100px;object-fit:contain;width:100%;margin-top:15px;}
        #yes-no-create-video-info-box span{font-size:.95rem;text-align:center;}
        #yes-no-create-video-info-box paper-button{font-size:.8rem;}
        #yes-no-create-video-info-box div{display:flex;padding-bottom:10px;}
        paper-radio-group { margin-top:15px; }
      </style>
      <div id="yes-no-create-video-info-box">
        <div style="margin-bottom:10px;">No information is associated with this file.</div>
        <img src="${thumbOf(file) || ""}"></img>
        <span>${(pathOf(file) || "").split("/").pop()}</span>
        <div style="margin-top:10px;">Create video/movie information?</div>
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
      yesBtn.onclick = () => {
        toast.hideToast();
        this._showCreateInfoTypeDialog(file);
        resolve();
      };
      noBtn.onclick = () => {
        toast.hideToast();
        resolve();
      };
    });
  }

  _showCreateInfoTypeDialog(file) {
    const toast = displayMessage(
      `
      <div style="display:flex;flex-direction:column;">
        <div>Please select the kind of information to create...</div>
        <img style="max-height:100px;object-fit:contain;width:100%;margin-top:15px;" src="${thumbOf(file) || ""}"></img>
        <paper-radio-group selected="video-option" style="margin-top:15px;">
          <paper-radio-button id="video-option" name="type-option"><span>Video</span></paper-radio-button>
          <paper-radio-button id="title-option" name="type-option"><span>Movie or TV Episode/Series</span></paper-radio-button>
        </paper-radio-group>
        <div style="justify-content:flex-end;margin-top:20px;">
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
        displayError(`Failed to create information: ${err?.message || err}`, 3000);
      } finally {
        this._closeContextMenu();
      }
    };

    cancelBtn.onclick = () => {
      toast.hideToast();
      this._closeContextMenu();
    };
  }

  async createTitleInformations(file) {
    const p = pathOf(file);
    const isSeries = isDirOf(file);
    try {
      const created = await createTitleAndAssociate({
        filePath: p,
        titleType: isSeries ? "TVSeries" : undefined,
      });
      displayMessage(`Title info created for ${nameOf(file)}`, 2500);
      return created;
    } catch (err) {
      displayError(`Failed to create title info: ${err?.message || err}`, 3000);
      throw err;
    }
  }

  async createVideoInformations(file) {
    const p = pathOf(file);
    try {
      const created = await createVideoAndAssociate({ filePath: p });
      displayMessage(`Video info created for ${nameOf(file)}`, 2500);
      return created;
    } catch (err) {
      displayError(`Failed to create video info: ${err?.message || err}`, 3000);
      throw err;
    }
  }

  async _handleGenerateTimelineAction() {
    const file = this._contextMenu.file;
    if (!file) return;

    let absPath = pathOf(file);
    if (DATA_ROOT && (absPath.startsWith("/users") || absPath.startsWith("/applications"))) {
      absPath = toAbsoluteFsPath(absPath, DATA_ROOT + "/files");
    }

    try {
      displayMessage(`Generating timeline for: ${absPath}`, 3500);
      await createVideoTimeLine(absPath, 180, 0.2);
      displayMessage("Timeline created successfully!", 3000);
    } catch (err) {
      displayError(`Failed to generate timeline: ${err?.message || err}`, 3000);
    } finally {
      this._closeContextMenu();
    }
  }

  async _handleGeneratePreviewAction() {
    const file = this._contextMenu.file;
    if (!file) return;

    let absPath = pathOf(file);
    if (DATA_ROOT && (absPath.startsWith("/users") || absPath.startsWith("/applications"))) {
      absPath = toAbsoluteFsPath(absPath, DATA_ROOT + "/files");
    }

    try {
      displayMessage(`Generating preview for: ${absPath}`, 3500);

      await createVideoPreview(absPath, 80, 20);
      displayMessage("Preview created successfully!", 3000);
      const parent = pathOf(file).substring(0, pathOf(file).lastIndexOf("/"));
      Backend.eventHub.publish("reload_dir_event", parent, false);
    } catch (err) {
      displayError(`Failed to generate preview: ${err?.message || err}`, 3000);
    } finally {
      this._closeContextMenu();
    }
  }

  async _handleConvertToMp4Action() {
    const file = this._contextMenu.file;
    if (!file) return;

    let absPath = pathOf(file);
    if (DATA_ROOT && (absPath.startsWith("/users") || absPath.startsWith("/applications"))) {
      absPath = toAbsoluteFsPath(absPath, DATA_ROOT + "/files");
    }

    try {
      displayMessage(`Converting to MP4: ${absPath}`, 3500);
      await convertVideoToMpeg4H264(absPath);
      displayMessage("Conversion to MP4 done!", 3000);
      const parent = pathOf(file).substring(0, pathOf(file).lastIndexOf("/"));
      Backend.eventHub.publish("reload_dir_event", parent, false);
    } catch (err) {
      displayError(`Failed to convert to MP4: ${err?.message || err}`, 3000);
    } finally {
      this._closeContextMenu();
    }
  }

  async _handleConvertToHlsAction() {
    const file = this._contextMenu.file;
    if (!file) return;

    let absPath = pathOf(file);
    if (DATA_ROOT && (absPath.startsWith("/users") || absPath.startsWith("/applications"))) {
      absPath = toAbsoluteFsPath(absPath, DATA_ROOT + "/files");
    }

    try {
      displayMessage(`Converting to HLS: ${absPath}`, 3500);
      await convertVideoToHls(absPath);
      displayMessage("Conversion to HLS done!", 3000);
      const parent = pathOf(file).substring(0, pathOf(file).lastIndexOf("/"));
      Backend.eventHub.publish("reload_dir_event", parent, false);
    } catch (err) {
      displayError(`Failed to convert to HLS: ${err?.message || err}`, 3000);
    } finally {
      this._closeContextMenu();
    }
  }

  // ---------- Rename dialog ----------
  async rename(parent, file, rect) {
    const currentName = nameOf(file);
    const parentPath = (pathOf(file) || "").substring(0, pathOf(file).lastIndexOf("/")) || "/";

    const html = `
      <style>
        #rename-file-dialog{
          display:flex;position:absolute;flex-direction:column;left:5px;min-width:260px;
          z-index:100;background:var(--surface-color);color:var(--primary-text-color);
          box-shadow:var(--shadow-elevation-2dp);border-radius:8px;overflow:hidden;
          border:1px solid var(--palette-divider);
        }
        .rename-file-dialog-actions{
          font-size:.85rem;align-items:center;justify-content:flex-end;display:flex;
          padding:8px;border-top:1px solid var(--palette-divider);
        }
        .card-content{padding:16px;}
      </style>
      <paper-card id="rename-file-dialog">
        <div class="card-content">
          <paper-input id="rename-file-input" label="New name" value="${currentName}"></paper-input>
        </div>
        <div class="rename-file-dialog-actions">
          <paper-button id="rename-file-cancel-btn">Cancel</paper-button>
          <paper-button id="rename-file-ok-btn">Rename</paper-button>
        </div>
      </paper-card>
    `;


    let dlg = document.body.querySelector("#rename-file-dialog");
    if (!dlg) {
      const range = document.createRange();
      document.body.appendChild(range.createContextualFragment(html));
      dlg = document.body.querySelector("#rename-file-dialog");
      dlg.addEventListener("mouseover", (e) => e.stopPropagation());
      dlg.addEventListener("mouseenter", (e) => e.stopPropagation());
    }


    const left = (rect.left || 0) + 5;
    const top = (rect.top || 0) + 5;
    dlg.style.left = `${left}px`;
    dlg.style.top = `${top}px`;

    const input = dlg.querySelector("#rename-file-input");
    setTimeout(() => {
      input.focus();
      const dotIdx = currentName.lastIndexOf(".");
      if (dotIdx === -1) input.inputElement.inputElement.select();
      else input.inputElement.inputElement.setSelectionRange(0, dotIdx);
    }, 50);

    const cancelBtn = dlg.querySelector("#rename-file-cancel-btn");
    const okBtn = dlg.querySelector("#rename-file-ok-btn");

    const close = () => dlg?.parentNode && dlg.parentNode.removeChild(dlg);

    cancelBtn.addEventListener("click", (evt) => {
      evt.stopPropagation();
      close();
    });

    input.addEventListener("keydown", (evt) => {
      if (evt.key === "Enter") okBtn.click();
      else if (evt.key === "Escape") cancelBtn.click();
    });

    okBtn.addEventListener("click", async (evt) => {
      evt.stopPropagation();
      close();
      const newName = input.value?.trim();
      if (!newName || newName === currentName) return;

      try {
        await renameFile(parentPath, newName, currentName);
        displayMessage(`Renamed ${currentName} to ${newName}`, 2500);
        Backend.eventHub.publish("reload_dir_event", parentPath, false);
      } catch (err) {
        displayError(`Failed to rename: ${err?.message || err}`, 3000);
      }
    });
  }

  // ---------- Drag & drop ----------
  async handleDropEvent(evt) {
    evt.stopPropagation();
    evt.preventDefault();

    const lnkHtml = evt.dataTransfer.getData("text/html");
    const url = evt.dataTransfer.getData("Url");

    if (url) {
      await this._handleUrlDrop(url, lnkHtml);
    } else if (evt.dataTransfer.files && evt.dataTransfer.files.length > 0) {
      await this._handleFileDrop(evt.dataTransfer.files, lnkHtml);
    } else {
      await this._handleInternalDragDrop(evt);
    }
  }

  async _handleUrlDrop(url, lnkHtml) {
    const destDir = this._currentDir ? pathOf(this._currentDir) : "/";
    try {
      if (url.endsWith(".torrent") || url.startsWith("magnet:")) {
        displayError(
          "Torrent/magnet handling not yet wired to the new torrent wrapper. Add a wrapper (e.g., `downloadTorrent`) and call it here.",
          6000
        );
        return;
      }

      if (/\.(jpeg|jpg|bmp|gif|png)$/i.test(url)) {
        const fileObj = await this._fetchBlobAsFile(url);
        await uploadFilesHttp({ destPath: destDir, files: [fileObj] });
        Backend.eventHub.publish(
          "__upload_files_event__",
          { dir: this._currentDir, files: [fileObj], lnk: lnkHtml },
          true
        );
        return;
      }

      await this._promptAndUploadVideoLink(url, lnkHtml, destDir);
    } catch (err) {
      displayError(`Failed to process link: ${err?.message || err}`, 3000);
    }
  }

  async _fetchBlobAsFile(url) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.timeout = 15000;
      xhr.open("GET", url);
      xhr.responseType = "blob";
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          const blob = xhr.response;
          const fileName = url.substring(url.lastIndexOf("/") + 1).split("?")[0];
          const fileObject = new File([blob], fileName, {
            type: blob.type,
            lastModified: Date.now(),
          });
          resolve(fileObject);
        } else {
          reject(new Error(`Fetch failed: ${xhr.status} ${xhr.statusText}`));
        }
      };
      xhr.onerror = () => reject(new Error("Network error fetching URL."));
      xhr.ontimeout = () => reject(new Error("Timeout fetching URL."));
      xhr.send();
    });
  }

  async _promptAndUploadVideoLink(url, lnkHtml, destDir) {
    const toast = displayMessage(
      `
      <div id="select-media-dialog">
        <span>What kind of file do you want to create?</span>
        <div style="display:flex;justify-content:center;">
          <paper-radio-group selected="media-type-mp4">
            <paper-radio-button id="media-type-mp4" name="media-type">Video (mp4)</paper-radio-button>
            <paper-radio-button id="media-type-mp3" name="media-type">Audio (mp3)</paper-radio-button>
          </paper-radio-group>
        </div>
        <div style="display:flex;justify-content:flex-end;">
          <paper-button id="upload-lnk-ok-button">Ok</paper-button>
          <paper-button id="upload-lnk-cancel-button">Cancel</paper-button>
        </div>
      </div>
      `,
      60 * 1000
    );

    const mp4Radio = toast.toastElement.querySelector("#media-type-mp4");
    const mp3Radio = toast.toastElement.querySelector("#media-type-mp3");
    const okBtn = toast.toastElement.querySelector("#upload-lnk-ok-button");
    const cancelBtn = toast.toastElement.querySelector("#upload-lnk-cancel-button");

    mp4Radio.addEventListener("change", () => (mp3Radio.checked = !mp4Radio.checked));
    mp3Radio.addEventListener("change", () => (mp4Radio.checked = !mp3Radio.checked));

    return new Promise((resolve, reject) => {
      okBtn.onclick = async () => {
        toast.hideToast();
        try {
          const format = mp3Radio.checked ? "mp3" : "mp4";
          await uploadVideoByUrl(destDir, url, format);
          Backend.eventHub.publish(
            "__upload_link_event__",
            { path: destDir, infos: `Queued ${format} from URL`, done: true, lnk: lnkHtml },
            true
          );
          resolve();
        } catch (err) {
          displayError(err?.message || err, 3000);
          reject(err);
        }
      };
      cancelBtn.onclick = () => {
        toast.hideToast();
        resolve();
      };
    });
  }

  async _handleFileDrop(fileList, lnkHtml) {
    if (!this._currentDir) {
      displayError("No destination directory available.", 3000);
      return;
    }
    const destDir = pathOf(this._currentDir);
    try {
      const files = Array.from(fileList);
      Backend.eventHub.publish(
        "__upload_files_event__",
        { dir: this._currentDir, files, lnk: lnkHtml },
        true
      );
      displayMessage(`Uploading ${files.length} file(s)...`, 2500);
      await uploadFilesHttp(destDir, files );
    } catch (err) {
      displayError(`Failed to upload files: ${err?.message || err}`, 3000);
    }
  }

  async _handleInternalDragDrop(evt) {
    const filesData = JSON.parse(evt.dataTransfer.getData("files") || "[]");
    const id = evt.dataTransfer.getData("id");
    const domain = evt.dataTransfer.getData("domain");

    if (document.getElementById("file-actions-menu")) return;

    const menuHtml = `
      <style>
        #file-actions-menu{
          background:var(--surface-color);color:var(--primary-text-color);
          position:absolute;min-width:140px;box-shadow:var(--shadow-elevation-2dp);
          border-radius:4px;overflow:hidden;
        }
        .menu-item{font-size:1rem;padding:8px 10px;display:flex;align-items:center;transition:background .2s;}
        .menu-item iron-icon{margin-right:10px;}
        .menu-item:hover{cursor:pointer;background-color:var(--palette-primary-accent);}
      </style>
      <paper-card id="file-actions-menu">
        <div id="copy-menu-item" class="menu-item">
          <iron-icon icon="icons:content-copy"></iron-icon><span>Copy</span>
        </div>
        <div id="move-menu-item" class="menu-item">
          <iron-icon icon="icons:compare-arrows"></iron-icon><span>Move</span>
        </div>
        <div id="create-lnks-menu-item" class="menu-item">
          <iron-icon icon="icons:link"></iron-icon><span>Create link</span>
        </div>
        <div id="cancel-menu-item" class="menu-item">
          <iron-icon icon="icons:cancel"></iron-icon><span>Cancel</span>
        </div>
      </paper-card>
    `;

    const range = document.createRange();
    document.body.appendChild(range.createContextualFragment(menuHtml));
    const menu = document.getElementById("file-actions-menu");

    const coords = getCoords(this._fileExplorer?.filesIconView || document.body);
    menu.style.top = `${coords.top + 44}px`;
    menu.style.left = `${coords.left + 10}px`;

    const moveListener = () => {
      if (menu.parentNode) {
        const updated = getCoords(this._fileExplorer?.filesIconView || document.body);
        menu.style.top = `${updated.top + 44}px`;
        menu.style.left = `${updated.left + 10}px`;
      } else {
        this._fileExplorer?.removeEventListener?.("move", moveListener);
      }
    };
    this._fileExplorer?.addEventListener?.("move", moveListener);

    const executeDropAction = async (mode) => {
      this._editMode = mode;

      const localPaths = [];

      if (this._selected && Object.keys(this._selected).length > 0) {
        for (const key in this._selected) {
          localPaths.push(pathOf(this._selected[key]));
        }
      }

      filesData.forEach((p) => {
        const asPath = typeof p === "string" ? p : p.path || p._path || "";
        if (asPath) localPaths.push(asPath);
      });

      if (id) {
        const draggedDiv = document.getElementById(id);
        if (draggedDiv?.parentNode) draggedDiv.parentNode.style.display = "none";
      }

      Backend.eventHub.publish(
        `drop_file_${this._fileExplorer.id}_event`,
        {
          file: filesData.length > 0 ? filesData[0] : null,
          dir: this._currentDir ? pathOf(this._currentDir) : "/",
          id,
          domain,
        },
        true
      );

      if (menu.parentNode) menu.parentNode.removeChild(menu);
      this._fileExplorer?.removeEventListener?.("move", moveListener);
    };

    menu.querySelector("#copy-menu-item").onclick = () => executeDropAction("copy");
    menu.querySelector("#move-menu-item").onclick = () => executeDropAction("cut");
    menu.querySelector("#create-lnks-menu-item").onclick = () => executeDropAction("lnks");
    menu.querySelector("#cancel-menu-item").onclick = () => {
      if (menu.parentNode) menu.parentNode.removeChild(menu);
      this._fileExplorer?.removeEventListener?.("move", moveListener);
    };
  }

  getSelectedFiles() {
    const res = [];
    if (this._selected) {
      for (const k in this._selected) {
        res.push(this._selected[k]);
      }
    }
    return res;
  }

  _selectionChanged() {
    if (this._fileExplorer?.updateSelectionBar) {
      this._fileExplorer.updateSelectionBar(this.getSelectedFiles());
    }
  }

  // ---------- Confirm dialog helper ----------
  _showConfirmationDialog(contentHtml, onYes, onNo, yesBtnId, noBtnId) {
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
  }
}

customElements.define("globular-files-view", FilesView);
