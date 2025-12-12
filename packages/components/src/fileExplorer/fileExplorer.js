import {
  Backend,
  startProcessVideo,
  startProcessAudio,
  uploadVideoByUrl,
  addPublicDir,
  buildFileUrl,
  createDir,
  createLink,
  getFilesCache,
  getPublicDirs,
  markAsPublic,
  readDir,
  readDirFresh,
  upload,
  getFile as getFileInfo,
  displayError,
  displayMessage,
  getCurrentAccount,
  getFileAudiosInfo,
  clearAllTitleCaches,
  invalidateFileCaches,
} from "@globular/backend"; // include getUrl
import { randomUUID } from "../utility.js";
import { FilesListView } from "./filesListView.js";
import { FilesIconView } from "./filesIconView.js";
import { PermissionsManager } from "../permissionManager/permissionManager.js";
import { InformationsManager } from "../informationManager/informationsManager.js";
import { ImageViewer } from "../image.js";
import { GlobularFileReader } from "./fileReader.js";

import { fireResize } from '../utility.js';
import { DiskSpaceManager } from "./diskSpaceManager.js"
import { playVideo } from "../video.js";
import { playAudio } from "../audio.js";
import '@polymer/paper-input/paper-input.js';
import '@polymer/paper-button/paper-button.js';
import '@polymer/paper-radio-group/paper-radio-group.js';
import '@polymer/paper-radio-button/paper-radio-button.js';
import '@polymer/iron-icon/iron-icon.js';
import '@polymer/paper-progress/paper-progress.js';
import { SharePanel } from "../share/sharePanel.js"
import { ShareResourceWizard } from "../share/shareResourceWizard.js"
import { Dialog } from '../dialog.js';
import './paperTray.js';
import './selectionBar.js';
import '../splitView.js';
// Import sub-components
import "./searchDocument.js";
import "./fileNavigator.js";
import "./pathNavigator.js";
import "../share/shareResourceMenu";
import "../menu.js";
import { FilesUploader } from './fileUploader';

// ✅ helpers centralize VM/proto normalization
import { adaptFileVM, adaptDirVM, extractPath, mimeOf, pathOf, nameOf, thumbOf } from "./filevm-helpers.js";

function getElementIndex(element) {
  return Array.from(element.parentNode.children).indexOf(element);
}

function collectFilePaths(file, out = []) {
  if (!file) return out;
  if (!file.isDir && file.path) {
    out.push(file.path);
  }
  if (Array.isArray(file.files)) {
    file.files.forEach((child) => collectFilePaths(child, out));
  }
  return out;
}

function refreshDirectoryCaches(path, dirNode) {
  if (!path || !dirNode) return;
  clearAllTitleCaches();
  const cache = getFilesCache();
  cache?.invalidate(path);
  if (dirNode.path && dirNode.path !== path) cache?.invalidate(dirNode.path);
  const filePaths = collectFilePaths(dirNode);
  filePaths.forEach((filePath) => invalidateFileCaches(filePath));
}

export class FileExplorer extends HTMLElement {
  static paperTray = [];
  static fileUploader = null;
  static editMode = "";
  static STATE_STORAGE_KEY = "__globular_file_explorer_state__";
  static _lastSessionState = null;

  static getPersistedState() {
    if (FileExplorer._lastSessionState) return FileExplorer._lastSessionState;
    if (typeof sessionStorage === "undefined") return null;
    try {
      const raw = sessionStorage.getItem(FileExplorer.STATE_STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      FileExplorer._lastSessionState = parsed;
      return parsed;
    } catch (err) {
      console.warn("FileExplorer: failed to restore previous state", err);
      return null;
    }
  }

  static setPersistedState(state) {
    FileExplorer._lastSessionState = state || null;
    if (typeof sessionStorage === "undefined") return;
    try {
      if (!state) {
        sessionStorage.removeItem(FileExplorer.STATE_STORAGE_KEY);
      } else {
        sessionStorage.setItem(FileExplorer.STATE_STORAGE_KEY, JSON.stringify(state));
      }
    } catch (err) {
      console.warn("FileExplorer: failed to persist state", err);
    }
  }

  _id = null;
  _path = undefined;
  _root = undefined;
  _navigations = [];
  _onerror = (err) => displayError(err, 3000);
  _dialog = undefined;
  _onclose = undefined;
  _onopen = undefined;
  _onloaded = undefined;
  _listeners = {};
  _currentReadToken = 0;

  _filesListView = undefined;
  _filesIconView = undefined;
  _permissionManager = undefined;
  _informationManager = undefined;
  _videoPlayer = undefined;
  _audioPlayer = undefined;
  _pathNavigator = undefined;
  _fileNavigator = undefined;
  _filesListBtn = undefined;
  _fileIconBtn = undefined;
  _fileUploaderBtn = undefined;
  _fileUploaderBusy = false;
  _fileUploaderVisible = false;
  _refreshBtn = undefined;
  _backNavigationBtn = undefined;
  _fowardNavigationBtn = undefined;
  _upwardNavigationBtn = undefined;
  _navigationListCard = null;
  _lstNavigationBtn = undefined;
  _createDirectoryBtn = undefined;
  _uploadBtn = undefined;
  _sharePanelBtn = undefined;
  _sharePanel = undefined;
  _shareWizard = null;
  _progressDiv = undefined;
  _documentSearchBar = undefined;
  _diskSpaceManager = undefined;
  _fileExplorerContent = undefined;
  _fileSelectionPanel = undefined;
  _fileReader = undefined;
  _imageViewer = undefined;

  _currentDirVM = undefined;
  _publicAliasMap = new Map();
  _aliasToRealMap = new Map();
  _publicAliasMap = new Map();
  _account = null;
  _restoredState = null;

  // 🔧 NEW: track current delete-sub for info panel to avoid stacking
  _currentInfoDeleteSub = { event: null, uuid: null };
  _currentInfoInvalidationSub = { event: null, uuid: null };

  // 🔧 NEW: progressive directory loading handle
  _currentReadHandle = null;
  _boundWindowResizeHandler = null;

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });

    this._id = `_${randomUUID()}`;
    this.setAttribute("id", this._id);

    this._path = undefined;
    this._root = undefined;
    this._navigations = [];
    this._listeners = {};
    this._restoredState = FileExplorer.getPersistedState();

    if (FileExplorer.fileUploader === null) {
      FileExplorer.fileUploader = new FilesUploader();
      FileExplorer.fileUploader.id = "globular-files-uploader";
      FileExplorer.fileUploader.setAttribute("style", "position:absolute; z-index:1000; right:15px; bottom:2px;");
    }
  }

  resetPublicAliasMap(prefix) {
    if (!this._publicAliasMap) this._publicAliasMap = new Map();
    if (!this._aliasToRealMap) this._aliasToRealMap = new Map();
    if (!prefix) {
      this._publicAliasMap.clear();
      this._aliasToRealMap.clear();
      return;
    }
    const normalize = (p) => {
      if (!p) return "/";
      let out = String(p).trim();
      if (!out) return "/";
      if (!out.startsWith("/")) out = `/${out}`;
      out = out.replace(/\/{2,}/g, "/");
      if (out.length > 1 && out.endsWith("/")) out = out.slice(0, -1);
      return out || "/";
    };
    const normPrefix = normalize(prefix);
    const entries = Array.from(this._publicAliasMap.entries());
    entries.forEach(([real, alias]) => {
      if (
        alias === normPrefix ||
        alias.startsWith(normPrefix === "/" ? "/" : `${normPrefix}/`)
      ) {
        this._publicAliasMap.delete(real);
        this._aliasToRealMap.delete(alias);
      }
    });
  }

  registerPublicAlias(realPath, aliasPath) {
    if (!realPath || !aliasPath) return;
    const normalize = (p) => {
      if (!p) return "/";
      let out = String(p).trim();
      if (!out) return "/";
      if (!out.startsWith("/")) out = `/${out}`;
      out = out.replace(/\/{2,}/g, "/");
      if (out.length > 1 && out.endsWith("/")) out = out.slice(0, -1);
      return out || "/";
    };
    const normReal = normalize(realPath);
    const normAlias = normalize(aliasPath);
    this._publicAliasMap.set(normReal, normAlias);
    this._aliasToRealMap.set(normAlias, normReal);
  }

  _computePublicAliasPath(name) {
    let segment = String(name ?? "").trim();
    if (!segment) segment = "public-dir";
    segment = segment.replace(/^\/+/, "");
    const alias = `/public/${segment}`;
    return alias.replace(/\/{2,}/g, "/").replace(/\/$/, "") || "/public";
  }

  _syntheticAliasInfoForRealPath(path) {
    if (!path || !this._publicAliasMap?.size) return null;
    const normalize = (p) => {
      if (!p) return "/";
      let out = String(p).trim();
      if (!out) return "/";
      if (!out.startsWith("/")) out = `/${out}`;
      out = out.replace(/\/{2,}/g, "/");
      if (out.length > 1 && out.endsWith("/")) out = out.slice(0, -1);
      return out || "/";
    };
    const norm = normalize(path);
    let best = null;
    for (const [real, alias] of this._publicAliasMap.entries()) {
      if (norm === real || norm.startsWith(real === "/" ? "/" : `${real}/`)) {
        if (!best || real.length > best.real.length) {
          best = { real, alias };
        }
      }
    }
    if (!best) return null;
    const remainderRaw = norm.slice(best.real.length);
    const remainder = remainderRaw
      ? (remainderRaw.startsWith("/") ? remainderRaw : `/${remainderRaw}`)
      : "";
    const aliasWithSuffix = `${best.alias}${remainder}`.replace(/\/{2,}/g, "/") || best.alias;
    return {
      alias: aliasWithSuffix,
      aliasBase: best.alias,
      realBase: best.real,
      remainder,
    };
  }

  _syntheticPathForRealPath(path) {
    const info = this._syntheticAliasInfoForRealPath(path);
    return info?.alias || null;
  }

  connectedCallback() {
    this._initializeLayout();
    this._initializeComponents();
    this._bindEventHandlers();
    this._setupBackendSubscriptions();
    this._loadInitialData();
  }

  disconnectedCallback() {
    for (const name in this._listeners) {
      try { Backend.eventHub.unsubscribe(name, this._listeners[name]); } catch { }
    }
    this._listeners = {};

    // also clean the info delete sub if any
    this._unsubscribeInfoDelete();

    this._closeAllGlobalDialogs();

    this._filesIconView?.stopPreview?.();
    this._filesListView?.stopPreview?.();

    // cancel any in-flight directory read
    this._cancelCurrentRead();

    if (FileExplorer.fileUploader && FileExplorer.fileUploader.parentNode === this) {
      this.removeChild(FileExplorer.fileUploader);
    }

    if (this._boundWindowResizeHandler) {
      window.removeEventListener("resize", this._boundWindowResizeHandler);
      this._boundWindowResizeHandler = null;
    }

    this._persistSessionState();
  }

  _initializeLayout() {
    const fileExplorerIcon = new URL('../../assets/icons/folder-flat.svg', import.meta.url).href;
    this.shadowRoot.innerHTML = `
    <style>
      /* -------- scrollbars: use theme vars (light & dark) -------- */
      ::-webkit-scrollbar {
        width: 10px;
      }
      ::-webkit-scrollbar-track {
        background: var(--scroll-track, var(--surface-color));
      }
      ::-webkit-scrollbar-thumb {
        background: var(--scroll-thumb, var(--palette-divider));
        border-radius: 6px;
      }
      ::-webkit-scrollbar-thumb:hover {
        background: var(--scroll-thumb-hover, var(--palette-divider));
      }

      paper-icon-button:hover {
        cursor: pointer;
      }

      /* local helper: prefer divider-color, fall back to palette-divider */
      :host {
        --fx-border-color: var(--divider-color, var(--palette-divider));
      }

      #file-navigation-panel,
      #file-selection-panel {
        background-color: var(--surface-color);
        color: var(--on-surface-color);
      }

      #file-navigation-panel {
        border-right: 1px solid var(--fx-border-color);
      }

      #file-explorer-content {
        position: relative;
        display: flex;
        flex-direction: column;
        height: calc(100% - 40px);
        background-color: var(--surface-color);
        color: var(--on-surface-color);
      }

      #file-navigation-header {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 4px 8px;
        border-bottom: 1px solid var(--fx-border-color);
        background-color: var(--surface-color);
      }

      #file-explorer-layout {
        display: flex;
        flex-grow: 1;
        overflow: hidden;
      }

      globular-file-reader {
        height: 100%;
      }

      globular-permissions-manager,
      globular-informations-manager {
        background-color: var(--surface-color);
        color: var(--on-surface-color);
        position: relative;
        flex: 1 1 auto;
        width: 100%;
        height: 100%;
        min-height: 0;
        overflow: hidden;
        z-index: 100;
      }

      globular-permissions-manager > *,
      globular-informations-manager > * {
        flex: 1 1 auto;
        min-height: 0;
        width: 100%;
      }

      #progress-div {
        position: absolute;
        bottom: 0;
        left: 10px;
        display: none;
        font-size: 0.85rem;
        background-color: var(--surface-color);
        color: var(--on-surface-color);
        border: 1px solid var(--fx-border-color);
        border-radius: 6px 6px 0 0;
        padding: 4px 8px;
        box-shadow: 0 -2px 4px rgba(0, 0, 0, 0.15);
        z-index: 1000;
      }

      #progress-div paper-progress {
        width: 120px;
        margin-left: 8px;
      }

      #active-directory {
        display: none;
        padding: 0 8px;
        font-size: 0.75rem;
        color: var(--palette-text-secondary, var(--on-surface-color));
        opacity: 0.8;
      }

      .card-actions.footer {
        display: flex !important;
        align-items: center;
        background-color: var(--surface-color);
        color: var(--on-surface-color);
        border-top: 1px solid var(--fx-border-color);
      }

      @media (max-width: 500px) {
        .footer {
          width: calc(100vw - 35px);
          bottom: 0;
          position: fixed;
        }
        #file-explorer-content {
          margin-bottom: 40px;
        }
        #enter-full-screen-btn {
          display: none;
        }
      }
    </style>

    <globular-dialog
      id="globular-file-explorer-dialog"
      class="file-explorer"
      name="file-explorer"
      overflow="hidden"
      is-moveable="true"
      is-maximizeable="true"
      is-resizeable="true"
      show-icon="true"
      is-minimizeable="true"
      offset="0">

      <globular-search-document-bar slot="search"></globular-search-document-bar>
      <span id="title-span" slot="title">File Explorer</span>
      <img slot="icon" src="${fileExplorerIcon}"/>

      <paper-icon-button slot="header" id="show-share-panel-btn" icon="social:share"></paper-icon-button>
      <paper-icon-button slot="header" id="navigation-cloud-upload-btn" icon="icons:cloud-upload"></paper-icon-button>
      <paper-icon-button slot="header" id="navigation-create-dir-btn" icon="icons:create-new-folder"></paper-icon-button>
      <paper-icon-button slot="header" id="navigation-refresh-btn" icon="icons:refresh"></paper-icon-button>

      <div id="file-explorer-content" class="card-content no-select">
        <div id="file-navigation-header">
          <div id="btn-group-0" style="display: flex;">
            <paper-icon-button id="navigation-back-btn" icon="icons:arrow-back"></paper-icon-button>
            <paper-icon-button id="navigation-forward-btn" icon="icons:arrow-forward"></paper-icon-button>
            <paper-icon-button id="navigation-upward-btn" icon="icons:arrow-upward"></paper-icon-button>
            <paper-icon-button id="navigation-lst-btn" icon="icons:list" style="display: none;"></paper-icon-button>
          </div>
          <globular-path-navigator style="flex-grow: 1;"></globular-path-navigator>
        </div>

        <globular-split-view id="file-explorer-layout">
          <globular-split-pane id="file-navigation-panel" style="width: 360px;">
            <globular-file-navigator></globular-file-navigator>
          </globular-split-pane>
          <globular-split-pane id="file-selection-panel" style="position: relative; width: 100%;">
            <div style="position: relative; height: auto; width: 100%;" id="file-explorer-main-view">
              <globular-papertray id="paper-tray"></globular-papertray>
              <globular-selectionbar id="selection-bar"></globular-selectionbar>
            </div>
            <slot></slot>
          </globular-split-pane>
        </globular-split-view>
      </div>

      <div class="card-actions footer">
        <div id="progress-div">
            <span id="progress-message">Loading...</span>
            <paper-progress id="globular-dir-loading-progress-bar" indeterminate></paper-progress>
        </div>
        <span id="active-directory" style="display:none;"></span>
        <globular-disk-space-manager account="sa@localhost" style="display: none;"></globular-disk-space-manager>
        <span style="flex-grow: 1;"></span>
        <paper-icon-button
          id="files-icon-btn"
          class="active"
          icon="icons:view-module"
          style="--iron-icon-fill-color: var(--palette-action-active);"
          role="button"
          tabindex="0"
          aria-disabled="false">
        </paper-icon-button>
        <paper-icon-button
          id="files-list-btn"
          icon="icons:view-list"
          style="--iron-icon-fill-color: var(--palette-action-disabled);"
          role="button"
          tabindex="1"
          aria-disabled="false">
        </paper-icon-button>
        <paper-icon-button
          id="file_uploader_icon"
          icon="icons:file-upload"
          style="--iron-icon-fill-color: var(--palette-action-disabled);">
        </paper-icon-button>
      </div>
    </globular-dialog>
  `;
    this._dialog = this.shadowRoot.querySelector("globular-dialog");
    if (this._dialog) {
      const uniqueDialogId = `${this._id}-dialog`;
      this._dialog.setAttribute("id", uniqueDialogId);
    }
    this._dialog.getPreview = this.getPreview.bind(this);
    this._ensureDefaultDialogSize();
  }

  _initializeComponents() {
    this._progressDiv = this.shadowRoot.querySelector("#progress-div");
    this._permissionManager = new PermissionsManager();
    this._informationManager = new InformationsManager();
    this._pathNavigator = this.shadowRoot.querySelector("globular-path-navigator");
    this._pathNavigator.setFileExplorer(this);
    this._fileNavigator = this.shadowRoot.querySelector("globular-file-navigator");
    this._fileNavigator.setFileExplorer(this);
    this._diskSpaceManager = this.shadowRoot.querySelector("globular-disk-space-manager");
    this._fileSelectionPanel = this.shadowRoot.querySelector("#file-selection-panel");
    this._documentSearchBar = this.shadowRoot.querySelector("globular-search-document-bar");
    this._documentSearchBar.setFileExplorer(this);
    this._fileExplorerContent = this.shadowRoot.querySelector("#file-explorer-content");
    // NEW: paper tray
    this._paperTray = this.shadowRoot.querySelector("globular-papertray");
    if (this._paperTray) {
      this._paperTray.setFileExplorer(this);
    }

    this._selectionBar = this.shadowRoot.querySelector("globular-selectionbar");
    if (this._selectionBar) {
      this._selectionBar.setFileExplorer(this);
      this._selectionBar.addEventListener('selection-bar-action', (evt) => {
        const action = evt.detail?.action;

        // Ask views who is active instead of poking privates
        const view =
          (this._filesListView?.isActive?.()) ? this._filesListView :
            (this._filesIconView?.isActive?.()) ? this._filesIconView :
              null;

        const selectionClearingActions = ['cut', 'copy', 'link', 'delete', 'download', 'clear-selection'];

        if (!view && action === 'clear-selection') {
          this.clearSelections();
          this.updateSelectionBar?.([]);
          return;
        }

        switch (action) {
          case 'cut':
            view?._handleCutAction?.();
            break;
          case 'copy':
            view?._handleCopyAction?.();
            break;
          case 'link':
            view?._handleLinkAction?.();
            break;
          case 'delete':
            view?._handleDeleteAction?.();
            break;
          case 'download':
            view?._handleDownloadAction?.();
            break;
          case 'clear-selection':
            this.clearSelections();
            break;
        }

        // After any action that logically clears the selection,
        // explicitly hide the selection bar.
        if (selectionClearingActions.includes(action)) {
          this.updateSelectionBar?.([]);
        }
      });
    }


    this._filesListView = new FilesListView();
    this._filesListView.id = "globular-files-list-view";
    this._filesListView.setFileExplorer(this);
    this.appendChild(this._filesListView);

    this._filesIconView = new FilesIconView();
    this._filesIconView.id = "globular-files-icon-view";
    this._filesIconView.setFileExplorer(this);
    this._filesIconView.setActive(true);
    this.appendChild(this._filesIconView);

    this._fileReader = new GlobularFileReader();
    this._fileReader.id = "globular-file-reader";
    this._fileReader.style.display = "none";
    this._fileReader.style.zIndex = 1000;
    this._fileReader.setFileExplorer(this);
    this.appendChild(this._fileReader);

    this._imageViewer = new ImageViewer();
    this._imageViewer.id = "globular-image-viewer";
    this._imageViewer.style.display = "none";
    this._imageViewer.setAttribute("closeable", "true");
    this.appendChild(this._imageViewer);

    this._fileSelectionPanel.appendChild(this._permissionManager);
    this._fileSelectionPanel.appendChild(this._informationManager);
    this._permissionManager.style.display = "none";
    this._informationManager.style.display = "none";

    this._permissionManager.onclose = () => {
      this._permissionManager.style.display = "none";
      this._permissionManager.path = null;
      this._displayView(this._currentDir);
      return false;
    };
    // ensure closing the info manager restores the file view
    this._informationManager.onclose = () => {
      this._informationManager.path = null;
      this._displayView(this._currentDir)
    };

    this._sharePanel = null;
    this._setUploaderVisibility(false);
  }

  _bindEventHandlers() {
    this._dialog.onclose = () => {
      this._filesIconView.hide();
      this._filesListView.hide();
      if (this._onclose) this._onclose();
    };
    this._dialog.onmove = () => {
      this._filesIconView.hideMenu();
      this._filesListView.hideMenu();
      this._keepDialogInViewport();
    };
    this._ensureDefaultDialogSize();
    this._keepDialogInViewport();
    if (!this._boundWindowResizeHandler) {
      this._boundWindowResizeHandler = () => this._keepDialogInViewport();
      window.addEventListener("resize", this._boundWindowResizeHandler);
    }

    this._refreshBtn = this.shadowRoot.querySelector("#navigation-refresh-btn");
    this._createDirectoryBtn = this.shadowRoot.querySelector("#navigation-create-dir-btn");
    this._uploadBtn = this.shadowRoot.querySelector("#navigation-cloud-upload-btn");
    this._filesListBtn = this.shadowRoot.querySelector("#files-list-btn");
    this._fileIconBtn = this.shadowRoot.querySelector("#files-icon-btn");
    this._fileUploaderBtn = this.shadowRoot.querySelector("#file_uploader_icon");
    this._backNavigationBtn = this.shadowRoot.querySelector("#navigation-back-btn");
    this._fowardNavigationBtn = this.shadowRoot.querySelector("#navigation-forward-btn");
    this._upwardNavigationBtn = this.shadowRoot.querySelector("#navigation-upward-btn");
    this._lstNavigationBtn = this.shadowRoot.querySelector("#navigation-lst-btn");
    this._sharePanelBtn = this.shadowRoot.querySelector("#show-share-panel-btn");

    this._refreshBtn.addEventListener('click', this._handleRefreshClick.bind(this));
    this._createDirectoryBtn.addEventListener('click', this._handleCreateDirectoryClick.bind(this));
    this._uploadBtn.addEventListener('click', this._handleUploadClick.bind(this));
    this._sharePanelBtn.addEventListener('click', this._handleSharePanelClick.bind(this));

    this._filesListBtn.addEventListener('click', this._handleViewToggleClick.bind(this, 'list'));
    this._fileIconBtn.addEventListener('click', this._handleViewToggleClick.bind(this, 'icon'));
    this._fileUploaderBtn.addEventListener('click', this._handleShowUploader.bind(this));

    this._backNavigationBtn.addEventListener('click', this._handleNavigationClick.bind(this, 'back'));
    this._fowardNavigationBtn.addEventListener('click', this._handleNavigationClick.bind(this, 'forward'));
    this._upwardNavigationBtn.addEventListener('click', this._handleNavigationClick.bind(this, 'upward'));
  }

  _setupBackendSubscriptions() {
    const explorerId = this._id;

    Backend.eventHub.subscribe("__set_dir_event__",
      (uuid) => { this._listeners["__set_dir_event__"] = uuid; },
      (evt) => {
        if (evt.file_explorer_id === explorerId) this._handleSetDirEvent(evt);
      }, true, this
    );

    Backend.eventHub.subscribe("__upload_files_event__",
      (uuid) => { this._listeners[`upload_files_event_`] = uuid; },
      (evt) => {
        const dirPath = extractPath(evt.dir);
        if (dirPath && dirPath === this._path) {
          const cache = getFilesCache();
          cache?.invalidate?.(this._path);
          this._handleRefreshClick();
          // display the files uploader if not already visible
          if (FileExplorer.fileUploader?.parentNode !== this._fileExplorerContent) {
            this._fileExplorerContent.appendChild(FileExplorer.fileUploader);
            this._setUploaderVisibility(true);
          }
        }
      }, false, this
    );

    Backend.eventHub.subscribe(
      "__file_uploader_activity__",
      (uuid) => { this._listeners["__file_uploader_activity__"] = uuid; },
      (evt) => this._updateUploaderBusyState(evt?.active),
      true,
      this
    );

    Backend.eventHub.subscribe("follow_link_event_",
      (uuid) => { this._listeners["follow_link_event_"] = uuid; },
      async (evt) => {
        if (evt.file_explorer_id && evt.file_explorer_id !== explorerId) return;
        try {
          const file = await getFileInfo(evt.path);
          if (!file) throw new Error("File not found.");
          const f = adaptFileVM(file);
          this._closeSharePanel();
          const isDir = f.getIsDir();
          const mime = f.getMime();
          const p = f.getPath();
          if (isDir) this.publishSetDirEvent(p);
          else if ((mime || "").startsWith("video")) { this.playVideo(f); }
          else if ((mime || "").startsWith("audio")) { this.playAudio(f); }
          else if ((mime || "").startsWith("image")) {
            // first I will set the dir to the image parent dir
            const parentPath = p.substring(0, p.lastIndexOf("/")) || "/";
            let parentDir = await readDir(parentPath);
            if (!parentDir) {
              const parentHandle = readDirFresh(parentPath, { recursive: false });
              parentDir = await parentHandle.promise;
            }
            this.setDir(adaptDirVM(parentDir));

            this.showImage(f);
          }
          else { this.readFile(f); }
        } catch (err) {
          displayError(`Failed to follow link: ${err.message}`, 3000);
        }
      }, true, this
    );

    Backend.eventHub.subscribe(
      "share_resources_event_",
      (uuid) => { this._listeners["share_resources_event_"] = uuid; },
      async (evt) => {
        if (evt.file_explorer_id && evt.file_explorer_id !== explorerId) return;
        const paths = Array.isArray(evt.paths) ? [...new Set(evt.paths.filter(Boolean))] : [];
        if (!paths.length) {
          displayError("No files selected to share.", 2500);
          return;
        }
        await this._showShareWizard(paths);
      },
      true,
      this
    );

    Backend.eventHub.subscribe(`update_globular_service_configuration_evt`,
      (uuid) => { this._listeners[`update_globular_service_configuration_evt`] = uuid; },
      () => { }, false, this
    );

    Backend.eventHub.subscribe("file_rename_event",
      (uuid) => { this._listeners[`file_rename_event`] = uuid; },
      (path) => {
        if (this._root && typeof this.getRoot === "function" && path.startsWith(this.getRoot())) {
          this.publishSetDirEvent(this._path);
        }
      }, false, this
    );

    Backend.eventHub.subscribe(`display_permission_manager_${explorerId}_event`,
      (uuid) => { this._listeners[`display_permission_manager_${explorerId}_event`] = uuid; },
      (file) => {
        if (!this._permissionManager.parentElement) {
          this._fileSelectionPanel.appendChild(this._permissionManager);
        }
        this._permissionManager._permissions = null;
        const filePath = extractPath(file);
        this._permissionManager.path = filePath;
        this._permissionManager._resourceType = "file";
        this._permissionManager.style.display = "";
        this._hideAllViewsExcept(this._permissionManager);
      }, false, this
    );

    // 🔧 Centralize info panel show logic
    const unwrapPayload = (payload) => {
      const isWrapper = payload && typeof payload === "object" && Object.prototype.hasOwnProperty.call(payload, "file");
      const file = isWrapper ? payload.file : payload;
      const view = isWrapper ? payload.view : undefined;
      return { file, view };
    };

    Backend.eventHub.subscribe(`display_media_infos_${explorerId}_event`,
      (uuid) => { this._listeners[`display_media_infos_${explorerId}_event`] = uuid; },
      (payload) => {
        const { file, view } = unwrapPayload(payload);
        this._showInformation(file, view);
      },
      false,
      this
    );

    Backend.eventHub.subscribe(`display_file_infos_${explorerId}_event`,
      (uuid) => { this._listeners[`display_file_infos_${explorerId}_event`] = uuid; },
      (payload) => {
        const { file } = unwrapPayload(payload);
        this._showInformation(file, "file");
      },
      false,
      this
    );

    Backend.eventHub.subscribe("reload_dir_event",
      (uuid) => { this._listeners[`reload_dir_event`] = uuid; },
      async (path) => {
        if (this._path && path && path === this._path) {
          this.displayWaitMessage(`Loading ${path}...`);
          this._filesIconView.setSelected({});
          this._filesListView.setSelected({});
          try {
            let dirVM;
            if (path === "/public") {
              dirVM = await this._buildPublicDirVM();
            } else {
              const dirHandle = readDirFresh(path, { recursive: false });
              dirVM = await dirHandle.promise;
            }
            if (dirVM) {
              refreshDirectoryCaches(path, dirVM);
            }
            if (this._fileNavigator?.reload) this._fileNavigator.reload(adaptDirVM(dirVM));
            if (dirVM.path === this._path) {
              const adapted = adaptDirVM(dirVM);
              this._currentDirVM = dirVM;
              Backend.eventHub.publish("__set_dir_event__", { dir: adapted, file_explorer_id: explorerId }, true);
            }
            this._diskSpaceManager?.refresh?.();
            if (this._permissionManager?.path) {
              const currentPermissionPath = this._permissionManager.path;
              this._permissionManager._path = undefined;
              this._permissionManager.path = currentPermissionPath;
              this._permissionManager.style.display = "";
            }
            if (this._informationManager?.path) {
              const currentInfoPath = this._informationManager.path;
              this._informationManager._path = undefined;
              this._informationManager.path = currentInfoPath;
              this._informationManager.style.display = "";
            }
          } catch (err) {
            displayError(`Failed to reload directory ${path}: ${err.message}`, 3000);
          } finally {
            this.resume();
          }
        } else if (!path) {
          this.resume();
        }
      }, false, this
    );

    Backend.eventHub.subscribe("__play_video__",
      (uuid) => { this._listeners["__play_video__"] = uuid; },
      (evt) => { if (evt.file_explorer_id === explorerId) this.playVideo(evt.file); },
      true, this
    );

    Backend.eventHub.subscribe("__play_audio__",
      (uuid) => { this._listeners["__play_audio__"] = uuid; },
      (evt) => { if (evt.file_explorer_id === explorerId) this.playAudio(evt.file); },
      true, this
    );

    Backend.eventHub.subscribe("__read_file__",
      (uuid) => { this._listeners["__read_file__"] = uuid; },
      (evt) => { if (evt.file_explorer_id === explorerId) this.readFile(evt.file); },
      true, this
    );

    Backend.eventHub.subscribe("__show_image__",
      (uuid) => { this._listeners["__show_image__"] = uuid; },
      (evt) => { if (evt.file_explorer_id === explorerId) this.showImage(evt.file); },
      true, this
    );

    Backend.eventHub.subscribe("__show_share_wizard__",
      (uuid) => { this._listeners[`__show_share_wizard__`] = uuid; },
      (evt) => {
        if (evt.file_explorer_id === explorerId) {
          evt.wizard.style.position = "absolute";
          evt.wizard.style.zIndex = 1000;
          evt.wizard.style.top = "0px";
          evt.wizard.style.left = "0px";
          evt.wizard.style.right = "0px";
          evt.wizard.style.bottom = "0px";
          this.showShareWizard(evt.wizard);
        }
      }, true, this
    );

    Backend.eventHub.subscribe(
      "__file_uploader_close__",
      (uuid) => { this._listeners["__file_uploader_close__"] = uuid },
      () => {
        // Only act if *this* explorer is the one hosting the uploader
        if (FileExplorer.fileUploader?.parentNode === this._fileExplorerContent) {
          this._fileExplorerContent.removeChild(FileExplorer.fileUploader)
          this._setUploaderVisibility(false) // updates icon color + internal flag
        }
      },
      true,
      this
    )
    
    Backend.eventHub.subscribe("__refresh_media_request__",
      (uuid) => { this._listeners["__refresh_media_request__"] = uuid; },
      async (evt) => {
        const path = evt?.path;
        if (!path) return;
        try {
          if (evt.type === "audio") {
            await startProcessAudio(path);
          } else {
            await startProcessVideo(path);
          }
          displayMessage("Media refresh requested.", 2500);
        } catch (err) {
          displayError(`Failed to refresh media: ${err?.message || err}`, 3000);
          console.error(err);
        }
      }, true, this
    );

    Backend.eventHub.subscribe("__download_media_from_channel__",
      (uuid) => { this._listeners["__download_media_from_channel__"] = uuid; },
      async (evt) => {
        const path = evt?.path;
        const url = evt?.url;
        const format = evt?.format || "mp4";
        if (!path || !url) return;
        try {
          await uploadVideoByUrl(path, url, format === "mp3" ? "mp3" : "mp4", () => { });
          displayMessage("Channel download request submitted.", 3000);
        } catch (err) {
          displayError(`Failed to download media from channel: ${err?.message || err}`, 3000);
          console.error(err);
        }
      }, true, this
    );
  }

  async _loadInitialData() {
    this.displayWaitMessage("Initializing file explorer...");

    try {
      this._account = getCurrentAccount();
    } catch (e) {
      console.warn("Failed to resolve session account:", e);
      this._account = null;
    }

    if (this._diskSpaceManager) {
      if (this._account?.id && this._account?.domain) {
        this._diskSpaceManager.account = `${this._account.id}@${this._account.domain}`;
      } else {
        this._diskSpaceManager.style.display = "none";
      }
    }

    const readAndSetRoot = async (dirPath) => {
      try {
        const dirVM = await readDir(dirPath);
        const adapted = adaptDirVM(dirVM);

        this._root = adapted;
        this._currentDirVM = dirVM;
        this._path = adapted.getPath();

        this._fileNavigator.setDir(adapted);
        this._pathNavigator.setDir(adapted);
        this._filesListView.setDir(adapted);
        this._filesIconView.setDir(adapted);

        this._displayView(adapted);
        Backend.eventHub.publish("__set_dir_event__", { dir: adapted, file_explorer_id: this._id }, true);
      } catch (err) {
        this._onerror(err);
        console.error(`Failed to read root directory ${dirPath}:`, err);
      }
    };

    try {
      const userDir =
        (this._account?.id && this._account?.domain)
          ? `/users/${this._account.id}@${this._account.domain}`
          : "/public";

      await readAndSetRoot(userDir);

      this.resume();
      this._onloaded?.();
      const preferredView = this._restoredState?.viewMode === "list" ? "list" : "icon";
      if (preferredView === "list") this._filesListBtn.click();
      else this._fileIconBtn.click();
    } catch (err) {
      this.resume();
      displayError(`Failed to initialize file explorer: ${err.message}`, 5000);
      console.error("File explorer initialization failed:", err);
    }
  }

  // --- helpers for progressive directory loading ---

  _cancelCurrentRead() {
    if (this._currentReadHandle && typeof this._currentReadHandle.cancel === "function") {
      this._currentReadHandle.cancel();
    }
    this._currentReadHandle = null;
    this._currentReadToken++;
  }

  _keepDialogInViewport() {
    const dialog = this._dialog;
    if (!dialog || typeof dialog.getCoords !== "function" || typeof dialog.setPosition !== "function") {
      return;
    }
    const dialogHost = dialog.shadowRoot?.querySelector(".dialog");
    if (dialogHost?.classList.contains("maximized")) {
      return; // let maximized dialogs span the viewport naturally
    }
    const coords = dialog.getCoords();
    if (!coords) return;
    const width = typeof dialog.getWidth === "function" ? dialog.getWidth() : dialogHost?.offsetWidth || 0;
    const height = typeof dialog.getHeight === "function" ? dialog.getHeight() : dialogHost?.offsetHeight || 0;
    if (!width || !height) return;

    const margin = 16;
    const scrollLeft = window.pageXOffset || document.documentElement.scrollLeft || document.body.scrollLeft || 0;
    const scrollTop = window.pageYOffset || document.documentElement.scrollTop || document.body.scrollTop || 0;
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;

    const minLeft = scrollLeft + margin;
    const minTop = scrollTop + margin;
    const maxLeftCandidate = scrollLeft + viewportWidth - width - margin;
    const maxTopCandidate = scrollTop + viewportHeight - height - margin;
    const maxLeft = Math.max(minLeft, maxLeftCandidate);
    const maxTop = Math.max(minTop, maxTopCandidate);

    let newLeft = Math.min(Math.max(coords.left, minLeft), maxLeft);
    let newTop = Math.min(Math.max(coords.top, minTop), maxTop);

    if (Math.abs(newLeft - coords.left) > 1 || Math.abs(newTop - coords.top) > 1) {
      dialog.setPosition(newLeft, newTop);
    }
  }

  _ensureDefaultDialogSize() {
    const dialog = this._dialog;
    if (!dialog) return;
    const MIN_WIDTH = 1024;
    const MIN_HEIGHT = 768;
    const ensure = () => {
      if (!dialog) return;
      const getter = typeof dialog.getWidth === "function" ? dialog.getWidth.bind(dialog) : null;
      const heightGetter = typeof dialog.getHeight === "function" ? dialog.getHeight.bind(dialog) : null;
      const width = getter ? getter() : dialog.offsetWidth;
      const height = heightGetter ? heightGetter() : dialog.offsetHeight;
      if (!width || width <= 0) {
        if (typeof dialog.setWidth === "function") dialog.setWidth(Math.max(1024, MIN_WIDTH));
        else dialog.style.width = `${Math.max(1024, MIN_WIDTH)}px`;
      } else if (width < MIN_WIDTH) {
        if (typeof dialog.setWidth === "function") dialog.setWidth(MIN_WIDTH);
        else dialog.style.width = `${MIN_WIDTH}px`;
      }
      if (!height || height <= 0) {
        if (typeof dialog.setHeight === "function") dialog.setHeight(Math.max(768, MIN_HEIGHT));
        else dialog.style.height = `${Math.max(768, MIN_HEIGHT)}px`;
      } else if (height < MIN_HEIGHT) {
        if (typeof dialog.setHeight === "function") dialog.setHeight(MIN_HEIGHT);
        else dialog.style.height = `${MIN_HEIGHT}px`;
      }
      this._keepDialogInViewport();
    };
    ensure();
    requestAnimationFrame(ensure);
  }

  _startProgressiveDirLoad(fetchPath, displayPath) {
    this._cancelCurrentRead();

    const explorerId = this._id;
    let rootInitialized = false;
    const effectiveDisplayPath = displayPath || fetchPath;
    const token = this._currentReadToken;
    let pendingRoot = null;
    let flushScheduled = false;

    const flush = () => {
      flushScheduled = false;
      if (token !== this._currentReadToken) return;
      const root = pendingRoot;
      pendingRoot = null;
      if (!root) return;

      if (!rootInitialized) {
        rootInitialized = true;
        let dirVM = root;

        const synthetic =
          this._syntheticPathForRealPath(effectiveDisplayPath) ||
          dirVM.__syntheticPublicPath;
        if (synthetic) {
          dirVM.__syntheticPublicPath = synthetic;
        }

        this._currentDirVM = dirVM;
        const adapted = adaptDirVM(dirVM);
        Backend.eventHub.publish(
          "__set_dir_event__",
          { dir: adapted, file_explorer_id: explorerId, displayPath: effectiveDisplayPath },
          true
        );
        return;
      }

      let dirVM = root;
      const synthetic =
        this._syntheticPathForRealPath(effectiveDisplayPath) ||
        dirVM.__syntheticPublicPath;
      if (synthetic) {
        dirVM.__syntheticPublicPath = synthetic;
      }
      this._currentDirVM = dirVM;
      const adapted = adaptDirVM(dirVM);
      Backend.eventHub.publish(
        "__set_dir_event__",
        { dir: adapted, file_explorer_id: explorerId, displayPath: effectiveDisplayPath, preserveHistory: true },
        true
      );
    };

    const enqueueFlush = () => {
      if (flushScheduled) return;
      flushScheduled = true;
      requestAnimationFrame(flush);
    };

    const handle = readDirFresh(fetchPath, {
      recursive: false,
      onEntry: (entry, root) => {
        if (token !== this._currentReadToken) return;
        if (!root) return;
        pendingRoot = root;
        enqueueFlush();
      },
      onDone: (root) => {
        pendingRoot = root;
        flush();
        this.resume();
      },
    });

    this._currentReadHandle = handle;

    handle.promise.catch(async (err) => {
      if (token !== this._currentReadToken) return;
      if (!err) return;
      const msg = String(err?.message || err);
      if (msg === "readDirFresh cancelled") return;

      const lowerMsg = msg.toLowerCase();
      if (lowerMsg.includes("not a directory")) {
        // When a file path is passed instead of a directory, open the file instead of failing
        this.resume();
        try {
          const file = await getFileInfo(fetchPath);
          if (file) {
            const adapted = adaptFileVM(file);
            const mimeRoot = mimeOf(adapted).split("/")[0];
            if (mimeRoot === "video") this.playVideo(adapted);
            else if (mimeRoot === "audio") this.playAudio(adapted);
            else if (mimeRoot === "image") this.showImage(adapted);
            else this.readFile(adapted);
            return;
          }
        } catch (infoErr) {
          console.warn("Failed to open file after readDir error", infoErr);
          displayError(`Failed to open ${effectiveDisplayPath}: ${infoErr?.message || infoErr}`, 3000);
          return;
        }
      }

      console.error("readDirFresh failed", err);
      displayError(`Failed to load directory ${effectiveDisplayPath}: ${msg}`, 3000);
      this.resume();
    });
  }

  // --- put these inside class FileExplorer ---

  /** Compute quick stats for the current directory */
  _computeStats(dir) {
    const files = Array.isArray(dir && dir.files) ? dir.files : [];
    const total = files.length;
    let dirs = 0, images = 0, videos = 0, audios = 0, docs = 0;

    for (const f of files) {
      if (f.is_dir || (f.getIsDir && f.getIsDir())) { dirs++; continue; }
      const mime = ((f.mime || (f.getMime && f.getMime()) || "") + "").toLowerCase();
      if (mime.startsWith("image/")) images++;
      else if (mime.startsWith("video/")) videos++;
      else if (mime.startsWith("audio/")) audios++;
      else docs++;
    }
    return { total, dirs, images, videos, audios, docs };
  }

  /** Build once a pretty preview card element (for the dock) */
  _buildPreviewCard() {
    const folderIconUrl = new URL('../../assets/icons/folder-flat.svg', import.meta.url).href;

    const card = document.createElement('div');
    card.style.cssText = [
      'box-sizing:border-box',
      'width:320px;height:200px',
      'display:flex;flex-direction:column',
      'border-radius:12px',
      'background:linear-gradient(180deg, rgba(28,28,30,.9) 0%, rgba(28,28,30,.75) 60%, rgba(28,28,30,.6) 100%)',
      'color:#fff',
      'box-shadow:0 6px 24px rgba(0,0,0,.35)',
      'overflow:hidden',
      'font-family:system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, Noto Sans, Helvetica, Arial, sans-serif',
      'backdrop-filter:saturate(140%) blur(2px)',
      'border:1px solid rgba(255,255,255,.08)',
      'user-select:none',
      'cursor:pointer'
    ].join(';');

    // header
    const header = document.createElement('div');
    header.style.cssText = 'display:flex;align-items:center;gap:10px;padding:10px 12px;border-bottom:1px solid rgba(255,255,255,.08)';
    const icon = document.createElement('img');
    icon.src = folderIconUrl;
    icon.alt = 'File Explorer';
    icon.style.cssText = 'width:22px;height:22px;opacity:.95;filter:drop-shadow(0 1px 0 rgba(0,0,0,.25))';
    const title = document.createElement('div');
    title.textContent = 'File Explorer';
    title.style.cssText = 'font-weight:600;letter-spacing:.2px';
    header.appendChild(icon);
    header.appendChild(title);

    // body
    const body = document.createElement('div');
    body.style.cssText = 'flex:1;display:flex;flex-direction:column;gap:8px;padding:12px 12px 10px 12px';

    const pathLine = document.createElement('div');
    pathLine.style.cssText = 'font-size:.9rem;opacity:.95;white-space:nowrap;overflow:hidden;text-overflow:ellipsis';
    pathLine.id = 'fx-prev-path';

    const grid = document.createElement('div');
    grid.style.cssText = 'display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:4px';

    function makeStat(label, id) {
      const chip = document.createElement('div');
      chip.style.cssText = [
        'display:flex;flex-direction:column;gap:2px',
        'background:rgba(255,255,255,.06)',
        'border:1px solid rgba(255,255,255,.08)',
        'border-radius:10px',
        'padding:8px 10px',
        'min-width:0'
      ].join(';');
      const n = document.createElement('div');
      n.id = id;
      n.style.cssText = 'font-weight:700;font-size:1.05rem;letter-spacing:.2px';
      const l = document.createElement('div');
      l.textContent = label;
      l.style.cssText = 'font-size:.72rem;opacity:.8';
      chip.appendChild(n); chip.appendChild(l);
      return chip;
    }

    const statTotal = makeStat('Items', 'fx-prev-n-total');
    const statDirs = makeStat('Folders', 'fx-prev-n-dirs');
    const statImages = makeStat('Images', 'fx-prev-n-img');
    const statVideos = makeStat('Videos', 'fx-prev-n-vid');
    const statAudios = makeStat('Audios', 'fx-prev-n-aud');

    grid.appendChild(statTotal);
    grid.appendChild(statDirs);
    grid.appendChild(statImages);
    grid.appendChild(statVideos);
    grid.appendChild(statAudios);

    // footer
    const footer = document.createElement('div');
    footer.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:8px 12px;border-top:1px solid rgba(255,255,255,.08)';

    const hint = document.createElement('div');
    hint.textContent = 'Click to open';
    hint.style.cssText = 'font-size:.78rem;opacity:.75';

    const dots = document.createElement('div');
    dots.style.cssText = 'display:flex;gap:6px';
    for (let i = 0; i < 3; i++) {
      const d = document.createElement('span');
      d.style.cssText = 'width:6px;height:6px;border-radius:50%;background:rgba(255,255,255,.3)';
      dots.appendChild(d);
    }

    body.appendChild(pathLine);
    body.appendChild(grid);
    footer.appendChild(hint);
    footer.appendChild(dots);

    card.appendChild(header);
    card.appendChild(body);
    card.appendChild(footer);

    // Click → bring the dialog to front (best-effort)
    card.addEventListener('click', () => {
      // after the handle undocks the dialog, gently focus it
      if (this._dialog && this._dialog.focus) {
        queueMicrotask(() => this._dialog.focus());
      }
    });

    // updater
    card._update = () => {
      const p = this._path || '';
      const pathEl = card.querySelector('#fx-prev-path');
      if (pathEl) pathEl.textContent = p || '/';

      const stats = this._computeStats(this._currentDir || this._currentDirVM || {});
      function set(sel, v) {
        const el = card.querySelector(sel);
        if (el) el.textContent = String(v == null ? 0 : v);
      }
      set('#fx-prev-n-total', stats.total);
      set('#fx-prev-n-dirs', stats.dirs);
      set('#fx-prev-n-img', stats.images);
      set('#fx-prev-n-vid', stats.videos);
      set('#fx-prev-n-aud', stats.audios);
    };

    return card;
  }

  updateSelectionBar(files) {
    this._selectionBar?.setSelection?.(files || []);
  }

  clearSelections() {
    this._filesIconView?.setSelected?.({});
    this._filesListView?.setSelected?.({});
    this._filesIconView?.clearSelectionUI?.();
    this._filesListView?.clearSelectionUI?.();

    // Tell the selection bar there is no active selection anymore
    this.updateSelectionBar?.([]);

    Backend.eventHub.publish(
      "__clear_selection_evt__",
      { file_explorer_id: this._id },
      true
    );
  }

  /** Set clipboard content (mode + paths) */
  setClipboard(mode, paths) {
    this._paperTray?.setClipboard?.(mode, paths);
  }

  /** Append to clipboard */
  appendToClipboard(mode, paths) {
    this._paperTray?.appendToClipboard?.(mode, paths);
  }

  /** Clear clipboard (used after paste or Clear button) */
  clearClipboard() {
    this._paperTray?.clearClipboard?.();
  }

  /** Get clipboard for context-menu Paste */
  getClipboard() {
    return this._paperTray?.getClipboard?.() || { mode: "", items: [] };
  }

  /** Return a stable element for the dock; update it each time */
  getPreview() {
    if (this.previewElement && this.previewElement._update) {
      this.previewElement._update();
      return this.previewElement;
    }
    const el = this._buildPreviewCard();
    this.previewElement = el;
    if (el._update) el._update();
    return el;
  }

  clearSelections() {
    this._filesIconView?.setSelected?.({});
    this._filesListView?.setSelected?.({});
    this._filesIconView?.clearSelectionUI?.();
    this._filesListView?.clearSelectionUI?.();
    Backend.eventHub.publish("__clear_selection_evt__", { file_explorer_id: this._id }, true);
  }

  _handleRefreshClick() {
    if (this._path === "/public") {
      this.publishSetDirEvent("/public");
      Backend.eventHub.publish("public_change_permission_event", null, false);
      return;
    }
    Backend.eventHub.publish("reload_dir_event", this._path, true);
  }

  _handleCreateDirectoryClick() {
    const isPublicContext = this._path === "/public";
    const inputLabel = isPublicContext ? "Directory path to make public" : "New folder name";
    const defaultValue = isPublicContext ? "" : "Untitled Folder";

    const dialogId = "new-dir-dialog";
    let dialog = this._fileExplorerContent.querySelector(`#${dialogId}`);

    if (!dialog) {
      const html = `
        <style>
          #${dialogId} {
            display: flex;
            position: absolute;
            flex-direction: column;
            right: 60px;
            top: 50px;
            z-index: 100;
            background-color: var(--surface-color);
            color: var(--on-surface-color);
            box-shadow: var(--shadow-elevation-2dp);
            border-radius: 8px;
            overflow: hidden;
            border: 1px solid var(--palette-divider);
          }
          .new-dir-dialog-actions {
            font-size: .85rem;
            align-items: center;
            justify-content: flex-end;
            display: flex;
            background-color: var(--surface-color);
            color: var(--on-surface-color);
            padding: 8px;
            border-top: 1px solid var(--palette-divider);
          }
          .card-content { padding: 16px; }
          .helper-text {
            font-size: 0.8rem;
            color: var(--palette-text-secondary);
            margin-top: 8px;
          }
          paper-input {
            --paper-input-container-color: var(--on-surface-color);
            --paper-input-container-focus-color: var(--on-surface-color);
            --paper-input-container-label-floating-color: var(--on-surface-color);
            --paper-input-container-input-color: var(--on-surface-color);
          }
        </style>
        <paper-card id="${dialogId}">
          <div class="card-content">
            <paper-input id="new-dir-input" label="${inputLabel}" value="${defaultValue}"></paper-input>
            <div class="helper-text" data-public-helper style="display:${isPublicContext ? "block" : "none"};">
              Enter an existing directory path (e.g., /users/john@domain/media).
            </div>
          </div>
          <div class="new-dir-dialog-actions">
            <paper-button id="new-dir-cancel-btn">Cancel</paper-button>
            <paper-button id="new-dir-create-btn">Create</paper-button>
          </div>
        </paper-card>
      `;
      const range = document.createRange();
      this._fileExplorerContent.appendChild(range.createContextualFragment(html));
      dialog = this._fileExplorerContent.querySelector(`#${dialogId}`);
    }

    const input = dialog.querySelector("#new-dir-input");
    const helper = dialog.querySelector("[data-public-helper]");
    if (input) {
      input.label = inputLabel;
      input.value = defaultValue;
    }
    if (helper) {
      helper.style.display = isPublicContext ? "block" : "none";
    }
    setTimeout(() => {
      input.focus();
      if (!isPublicContext) {
        input.inputElement._inputElement.select();
      }
    }, 50);

    const cancelBtn = dialog.querySelector("#new-dir-cancel-btn");
    const createBtn = dialog.querySelector("#new-dir-create-btn");

    const removeDialog = () => { if (dialog && dialog.parentNode) dialog.parentNode.removeChild(dialog); };

    cancelBtn.onclick = (evt) => { evt.stopPropagation(); removeDialog(); };
    input.onkeydown = (evt) => { if (evt.keyCode === 13) createBtn.click(); else if (evt.keyCode === 27) cancelBtn.click(); };

    createBtn.onclick = async (evt) => {
      evt.stopPropagation();
      removeDialog();

      const rawValue = (input.value || "").trim();
      if (!rawValue) {
        const msg = isPublicContext ? "Directory path cannot be empty." : "Folder name cannot be empty.";
        return displayMessage(msg, 3000);
      }

      if (!isPublicContext && /[\\/]/.test(rawValue)) {
        return displayMessage("Folder name cannot contain slashes.", 3000);
      }

      try {
        if (isPublicContext) {
          let publicPath = rawValue;
          if (!publicPath.startsWith("/")) publicPath = `/${publicPath}`;
          await addPublicDir(publicPath);
          displayMessage(`Directory "${publicPath}" added to public list.`, 3000);
          Backend.eventHub.publish("public_change_permission_event", null, false);
          this.publishSetDirEvent("/public");
        } else {
          await createDir(this._path, rawValue);
          displayMessage(`Folder "${rawValue}" created!`, 3000);
          Backend.eventHub.publish("reload_dir_event", this._path, false);
        }
      } catch (err) {
        const prefix = isPublicContext ? "Failed to add public directory" : "Failed to create folder";
        displayError(`${prefix}: ${err.message}`, 3000);
      }
    };
  }

  _handleUploadClick() {
    if (this._path === "/public") {
      displayError("Select a specific public directory before uploading.", 4000);
      return;
    }
    let fileInput = document.querySelector("input#file-input");
    if (!fileInput) {
      fileInput = document.createElement("input");
      fileInput.id = "file-input";
      fileInput.type = "file";
      fileInput.multiple = true;
      fileInput.style.display = "none";
      document.body.appendChild(fileInput);
    }

    fileInput.click();
    fileInput.onchange = async () => {
      if (fileInput.files.length > 0) {
        try {
          await upload(this._path, fileInput.files);
          displayMessage("Files uploaded successfully!", 3000);
          Backend.eventHub.publish("reload_dir_event", this._path, false);
        } catch (err) {
          displayError(`Upload failed: ${err?.message || err}`, 4000);
        }
      }
      fileInput.value = '';
    };
  }

  _handleSharePanelClick(evt) {
    evt.stopPropagation();
    this._permissionManager.style.display = "none";
    this._informationManager.style.display = "none";

    if (this._sharePanel === null) {
      this._sharePanel = new SharePanel(this._account || undefined);
      this._sharePanel.setFileExplorer(this);
      this._sharePanel.id = "share-panel";
      this._sharePanel.onclose = () => {
        this._sharePanel = null;
        this._displayView(this._currentDir);
      };
      this._fileSelectionPanel.appendChild(this._sharePanel);
    }
    this._hideAllViewsExcept(this._sharePanel);
    this._sharePanel.style.display = "";
  }

  async _showShareWizard(paths) {
    const fileList = paths || [];
    if (!fileList.length) return;
    const files = [];
    for (const p of fileList) {
      if (!p) continue;
      try {
        const fileInfo = await getFileInfo(p);
        if (fileInfo) files.push(fileInfo);
      } catch (err) {
        console.warn("Failed to load file for sharing:", err);
      }
    }
    if (!files.length) {
      displayError("No valid files selected for sharing.", 3000);
      return;
    }

    if (this._shareWizard && this._shareWizard.parentNode) {
      this._shareWizard.parentNode.removeChild(this._shareWizard);
      this._shareWizard = null;
    }

    this._shareWizard = new ShareResourceWizard(files, this);
    this._shareWizard.setFileExplorer?.(this);
    this._shareWizard.id = "share-resource-wizard";
    this._shareWizard.onclose = () => {
      this._shareWizard?.remove();
      this._shareWizard = null;
      this._displayView(this._currentDir);
    };
    this._fileSelectionPanel.appendChild(this._shareWizard);
    this._hideAllViewsExcept(this._shareWizard);
    this._shareWizard.style.display = "";
    this._selectionBar?.setSelection([]);
  }

  _closeSharePanel() {
    if (!this._sharePanel) return;
    const panel = this._sharePanel;
    if (panel.parentNode) panel.parentNode.removeChild(panel);
    const onclose = panel.onclose;
    this._sharePanel = null;
    if (typeof onclose === "function") {
      onclose();
    } else {
      this._displayView(this._currentDir);
    }
  }

  _handleNavigationClick(type, evt) {
    evt.stopPropagation();

    if (!this._navigations.length) return;

    if (type === 'back') {
      if (this._navigationIndex > 0) {
        this._navigationIndex--;
        this._navigatingFromHistory = true;
        const targetPath = this._navigations[this._navigationIndex];
        this.publishSetDirEvent(targetPath);
      }
      return;
    }

    if (type === 'forward') {
      if (this._navigationIndex < this._navigations.length - 1) {
        this._navigationIndex++;
        this._navigatingFromHistory = true;
        const targetPath = this._navigations[this._navigationIndex];
        this.publishSetDirEvent(targetPath);
      }
      return;
    }

    if (type === 'upward') {
      const path = this._path || "";
      const pathParts = path.split("/");
      if (pathParts.length > 2) {
        const targetPath = path.substring(0, path.lastIndexOf("/"));
        // upward is a *new* navigation, not history → let setDir manage history
        this.publishSetDirEvent(targetPath);
      }
      return;
    }
  }

  _handleShowUploader(evt) {
    evt.stopPropagation();

    if (FileExplorer.fileUploader?.parentNode) {
      FileExplorer.fileUploader.parentNode.removeChild(FileExplorer.fileUploader);
      this._setUploaderVisibility(false);
    } else {
      this._fileExplorerContent.appendChild(FileExplorer.fileUploader);
      this._setUploaderVisibility(true);
    }

  }

  _setUploaderVisibility(visible) {
    this._fileUploaderVisible = visible;
    this._refreshUploaderIconColor();
  }

  _refreshUploaderIconColor() {
    if (!this._fileUploaderBtn) return;
    const color = this._fileUploaderBusy
      ? "var(--palette-success, #4caf50)"
      : this._fileUploaderVisible
        ? "var(--palette-action-active)"
        : "var(--palette-action-disabled)";
    this._fileUploaderBtn.style.setProperty("--iron-icon-fill-color", color);
    this._fileUploaderBtn.classList.toggle("active", this._fileUploaderVisible);
  }

  _updateUploaderBusyState(active) {
    if (this._fileUploaderBusy === !!active) return;
    this._fileUploaderBusy = !!active;
    this._refreshUploaderIconColor();
  }

  _handleViewToggleClick(viewType, evt) {
    evt.stopPropagation();

    this._imageViewer.style.display = "none";
    this._filesListView.hide();
    this._filesIconView.hide();
    this._fileReader.style.display = "none";
    this._permissionManager.style.display = "none";
    this._informationManager.style.display = "none";
    this._closeSharePanel();

    this._filesListBtn.classList.remove("active");
    this._fileIconBtn.classList.remove("active");
    this._fileUploaderBtn.classList.remove("active");
    this._filesListBtn.style.setProperty("--iron-icon-fill-color", "var(--palette-action-disabled)");
    this._fileIconBtn.style.setProperty("--iron-icon-fill-color", "var(--palette-action-disabled)");

    if (viewType === 'list') {
      this._filesListView.show();
      this._filesIconView.setActive(false);
      this._filesListView.setActive(true);
      this._filesListBtn.classList.add("active");
      this._filesListBtn.style.setProperty("--iron-icon-fill-color", "var(--palette-action-active)");
    } else if (viewType === 'icon') {
      this._filesIconView.show();
      this._filesIconView.setActive(true);
      this._filesListView.setActive(false);
      this._fileIconBtn.classList.add("active");
      this._fileIconBtn.style.setProperty("--iron-icon-fill-color", "var(--palette-action-active)");
    }

    this._filesListView.hideMenu();
    this._filesIconView.hideMenu();
    this.clearSelections();
    this._persistSessionState();
  }

  async publishSetDirEvent(path) {
    this.displayWaitMessage(`Loading ${path}...`);
    try {
      if (path === "/shared" || path === "/Shared") {
        if (this.openSharedRoot()) {
          this.resume();
          return;
        }
      }
      if (path?.startsWith("/Shared/")) {
        if (this.openSharedOwner(path)) {
          this.resume();
          return;
        }
      }

      const fetchPath = this._resolveRealPath(path) || path;
      const displayPath = path;

      if (fetchPath === "/public" || fetchPath?.startsWith("/public/")) {
        const dirVM = await this._buildPublicDirVM();
        const adapted = adaptDirVM(dirVM);
        this._currentDirVM = dirVM;
        Backend.eventHub.publish(
          "__set_dir_event__",
          { dir: adapted, file_explorer_id: this._id, displayPath },
          true
        );
        this.resume();
      } else {
        // non-public: progressive loading
        this._startProgressiveDirLoad(fetchPath, displayPath);
      }
    } catch (err) {
      displayError(`Failed to load directory ${path}: ${err.message}`, 3000);
      this._onerror(err);
      this.resume();
    }
  }

  _handleSetDirEvent(evt) {
    const dir = evt?.dir;
    const displayPath = evt?.displayPath;
    const preserveHistory = !!evt?.preserveHistory;

    if (displayPath) {
      // make sure the synthetic path follows the event if present
      dir.__syntheticPublicPath = displayPath;
    }

    this.setDir(dir, undefined, preserveHistory);
  }

  _resolveRealPath(path) {
    if (!path || !this._aliasToRealMap?.size) return "";
    const normalize = (p) => {
      if (!p) return "/";
      let out = String(p).trim();
      if (!out.startsWith("/")) out = `/${out}`;
      out = out.replace(/\/{2,}/g, "/");
      if (out.length > 1 && out.endsWith("/")) out = out.slice(0, -1);
      return out || "/";
    };
    const norm = normalize(path);
    return this._aliasToRealMap.get(norm) || "";
  }

  openSharedRoot() {
    const root = this._fileNavigator?._sharedRootVM;
    if (!root) return false;
    const adapted = adaptDirVM(root);
    this._currentDirVM = root;
    Backend.eventHub.publish(
      "__set_dir_event__",
      { dir: adapted, file_explorer_id: this._id, displayPath: "/Shared" },
      true
    );
    return true;
  }

  openSharedOwner(aliasPath) {
    if (!aliasPath || !aliasPath.startsWith("/Shared/")) return false;
    const sharedRoot = this._fileNavigator?._sharedRootVM;
    if (!sharedRoot || !Array.isArray(sharedRoot.files)) return false;
    const target = sharedRoot.files.find(
      (f) =>
        f.__syntheticPublicPath === aliasPath ||
        `/Shared/${nameOf(f)}` === aliasPath
    );
    if (!target) return false;
    const adapted = adaptDirVM(target);
    this._currentDirVM = target;
    Backend.eventHub.publish(
      "__set_dir_event__",
      { dir: adapted, file_explorer_id: this._id, displayPath: aliasPath },
      true
    );
    return true;
  }

  setDir(dir, callback, preserveHistory) {
    this._currentDir = dir;
    this._path = extractPath(dir);

    if (!this._path) {
      // no path, nothing useful to track
      this._updateNavigationButtonStates();
      this._updateNavigationListMenu(dir);
      return;
    }

    // Update active directory display
    const activeDirSpan = this.shadowRoot.querySelector("#active-directory");
    if (activeDirSpan) {
      activeDirSpan.textContent = this._path || "/";
      activeDirSpan.style.display = "block";
    }

    // Navigation history handling (can be suppressed for progressive updates)
    if (!preserveHistory) {
      if (!this._navigations.length) {
        // first visited directory
        this._navigations = [this._path];
        this._navigationIndex = 0;
      } else if (this._navigatingFromHistory) {
        // We are moving along existing history: do NOT change _navigations
        // _navigationIndex has already been set in _handleNavigationClick
        this._navigatingFromHistory = false;

        // Make sure the history entry at that index matches the new path
        this._navigations[this._navigationIndex] = this._path;
      } else {
        // Normal navigation (clicking folders, path navigator, create dir, etc.)
        // Browser-like behavior: if we're not at the end, drop "forward" entries
        if (this._navigationIndex < this._navigations.length - 1) {
          this._navigations = this._navigations.slice(0, this._navigationIndex + 1);
        }

        this._navigations.push(this._path);
        this._navigationIndex = this._navigations.length - 1;
      }
    }

    // --- existing UI updates ---

    const syntheticPathOverride =
      dir?.__syntheticPublicPath ||
      this._syntheticPathForRealPath(this._path);

    this._pathNavigator.setDir(dir, syntheticPathOverride);
    this._fileNavigator.setDir(dir);
    this._filesListView.setDir(dir);
    this._filesIconView.setDir(dir);

    this._loadImages(dir, callback);

    this._fileReader.style.display = "none";
    this._imageViewer.style.display = "none";
    this._permissionManager.style.display = "none";
    this._informationManager.style.display = "none";
    this._closeSharePanel();

    this._imageViewer.onclose = () => this._displayView(this._currentDir);
    this._fileReader.onclose = () => this._displayView(this._currentDir);

    this._updateNavigationButtonStates();
    this._updateNavigationListMenu(dir);
    this._persistSessionState();
  }

  _persistSessionState(extra = {}) {
    const path =
      this._path ||
      extractPath(this._currentDir) ||
      extractPath(this._currentDirVM);
    if (!path) return;

    const synthetic =
      (this._currentDir && this._currentDir.__syntheticPublicPath) ||
      (this._currentDirVM && this._currentDirVM.__syntheticPublicPath) ||
      this._syntheticPathForRealPath(path) ||
      path;
    const viewMode = this._filesListBtn?.classList.contains("active") ? "list" : "icon";

    FileExplorer.setPersistedState({
      path,
      displayPath: synthetic || path,
      viewMode,
      timestamp: Date.now(),
      ...extra,
    });
  }

  async _buildPublicDirVM() {
    this.resetPublicAliasMap();
    const paths = await getPublicDirs();
    const children = await Promise.all(
      paths.map(async (p) => {
        try {
          const dir = await readDir(p);
          markAsPublic(dir);
          dir.name = dir.name || p.split("/").pop() || p;
          const aliasBase = this._computePublicAliasPath(dir.name || p);
          dir.__syntheticPublicPath = aliasBase;
          this.registerPublicAlias(p, aliasBase);
          return dir;
        } catch (err) {
          const stub = {
            path: p,
            name: p.split("/").pop() || p,
            isDir: true,
            files: [],
          };
          markAsPublic(stub);
          const aliasBase = this._computePublicAliasPath(stub.name);
          stub.__syntheticPublicPath = aliasBase;
          this.registerPublicAlias(p, aliasBase);
          return stub;
        }
      })
    );
    return {
      path: "/public",
      name: "Public",
      isDir: true,
      mime: "synthetic/public-root",
      files: children,
    };
  }
  _updateNavigationButtonStates() {
    const idx = this._navigationIndex;
    const total = this._navigations.length;

    const enableButton = (btn) => btn && btn.style.setProperty("--iron-icon-fill-color", "var(--palette-action-active)");
    const disableButton = (btn) => btn && btn.style.setProperty("--iron-icon-fill-color", "var(--palette-action-disabled)");

    if (!total || idx < 0) {
      disableButton(this._backNavigationBtn);
      disableButton(this._fowardNavigationBtn);
      disableButton(this._upwardNavigationBtn);
      return;
    }

    if (this._backNavigationBtn) {
      idx > 0 ? enableButton(this._backNavigationBtn) : disableButton(this._backNavigationBtn);
    }
    if (this._fowardNavigationBtn) {
      idx < total - 1 ? enableButton(this._fowardNavigationBtn) : disableButton(this._fowardNavigationBtn);
    }
    if (this._upwardNavigationBtn) {
      const pathParts = (this._path || "").split("/");
      pathParts.length > 2 ? enableButton(this._upwardNavigationBtn) : disableButton(this._upwardNavigationBtn);
    }
  }

  _updateNavigationListMenu(/* currentDir */) {
    if (!this._lstNavigationBtn) return;

    // Host for absolute positioning (the button group div)
    const host = this._lstNavigationBtn.parentNode;
    if (!host) return;

    // Make sure the host is a positioning context
    const hostStyle = getComputedStyle(host);
    if (hostStyle.position === "static" || !hostStyle.position) {
      host.style.position = "relative";
    }

    // Create the card once and keep a reference to it
    let navigationLst = this._navigationListCard;
    if (!navigationLst || !navigationLst.isConnected) {
      navigationLst = document.createElement("paper-card");
      navigationLst.className = "directories-selector";
      navigationLst.style.display = "none";
      navigationLst.style.flexDirection = "column";
      navigationLst.style.position = "absolute";
      navigationLst.style.padding = "5px";
      navigationLst.style.zIndex = "1000";
      navigationLst.style.top = "calc(100% + 5px)";
      navigationLst.style.left = "0px";
      navigationLst.style.backgroundColor = "var(--surface-color)";
      navigationLst.style.color = "var(--primary-text-color)";
      host.appendChild(navigationLst);
      this._navigationListCard = navigationLst;

      // Toggle visibility on button click
      this._lstNavigationBtn.onclick = (evt) => {
        evt.stopPropagation();
        const cur = navigationLst.style.display;
        navigationLst.style.display = (cur === "flex") ? "none" : "flex";
      };

      // Hide when mouse leaves the card
      navigationLst.addEventListener("mouseleave", () => {
        navigationLst.style.display = "none";
      });
    }

    // --- Build unique paths + last index for each path ---
    const uniquePaths = [];
    const lastIndexByPath = new Map();

    this._navigations.forEach((path, idx) => {
      if (!path || path.includes(".hidden")) return;
      if (!uniquePaths.includes(path)) {
        uniquePaths.push(path);
      }
      // track the most recent index of this path
      lastIndexByPath.set(path, idx);
    });

    // If only one unique entry, hide button & list
    if (uniquePaths.length <= 1) {
      this._lstNavigationBtn.style.display = "none";
      navigationLst.style.display = "none";
      navigationLst.innerHTML = "";
      return;
    }

    // We have history → show the button
    this._lstNavigationBtn.style.display = "inline-flex";

    // Rebuild the list content
    navigationLst.innerHTML = "";
    const range = document.createRange();
    const currentHistIndex = this._navigationIndex;

    uniquePaths.forEach((path) => {
      const histIdx = lastIndexByPath.get(path);
      if (histIdx == null) return;

      const label = path.split("/").pop() || "Root";
      const html = `
        <div style="display: flex; align-items: center; padding: 4px;">
          <iron-icon style="height: 16px; width: 16px; margin-right: 8px;"></iron-icon>
          <span>${label}</span>
        </div>
      `;
      navigationLst.appendChild(range.createContextualFragment(html));

      const navigationLine = navigationLst.lastElementChild;
      const icon = navigationLine.querySelector("iron-icon");

      if (histIdx < currentHistIndex) icon.icon = "icons:arrow-back";
      else if (histIdx > currentHistIndex) icon.icon = "icons:arrow-forward";
      else icon.icon = "icons:check";

      navigationLine.onmouseover = () => {
        navigationLine.style.cursor = "pointer";
        navigationLine.style.backgroundColor = "var(--palette-action-hover)";
      };
      navigationLine.onmouseleave = () => {
        navigationLine.style.cursor = "default";
        navigationLine.style.backgroundColor = "transparent";
      };
      navigationLine.onclick = () => {
        navigationLst.style.display = "none";
        this._navigationIndex = histIdx;
        this._navigatingFromHistory = true; // move along history
        this.publishSetDirEvent(this._navigations[histIdx]);
      };
    });
  }


  setAtTop() {
    const draggables = document.querySelectorAll(".draggable");
    draggables.forEach(d => d.style.zIndex = 100);
  }

  displayWaitMessage(message) {
    if (this._progressDiv) {
      this._progressDiv.style.display = "flex";
      const messageDiv = this._progressDiv.querySelector("#progress-message");
      messageDiv.innerHTML = message;
    }
    const textMessage = this._sanitizeProgressMessage(message);
    this._dialog?.setBackgroundActivity(textMessage, true);
  }

  resume() {
    if (this._progressDiv) this._progressDiv.style.display = "none";
    this._dialog?.setBackgroundActivity("", false);
  }

  _sanitizeProgressMessage(message) {
    if (typeof message === "string") {
      return message.replace(/<[^>]+>/g, "").trim();
    }
    if (message === undefined || message === null) {
      return "";
    }
    return String(message);
  }

  _buildMediaWaitMessage(kind, file, info) {
    const pick = (obj, keys) => {
      if (!obj) return "";
      for (const key of keys) {
        try {
          const val = typeof obj[key] === "function" ? obj[key]() : obj[key];
          if (val !== undefined && val !== null) {
            const str = String(val).trim();
            if (str) return str;
          }
        } catch { /* ignore */ }
      }
      return "";
    };

    const baseInfo =
      info ||
      (kind === "audio" ? file?.audios?.[0] : file?.videos?.[0]) ||
      file?.titles?.[0];

    const title = pick(baseInfo, ["getTitle", "getName", "getDescription", "title", "name", "description"]);
    const artist = pick(baseInfo, ["getArtist", "artist", "getArtistName"]);
    const album = pick(baseInfo, ["getAlbum", "album"]);

    let label = "";
    if (artist && title) label = `${artist} - ${title}`;
    else if (title) label = title;
    else if (artist && album) label = `${artist} - ${album}`;
    else if (album) label = album;
    else if (artist) label = artist;

    if (!label) {
      label = nameOf(file) || pathOf(file) || extractPath(file) || kind;
    }

    return `Opening ${kind} "${label}"...`;
  }

  hideNavigator() { this._fileNavigator.hide(); fireResize(); }
  showNavigator() { this._fileNavigator.show(); fireResize(); }

  openMediaWatching(mediaWatching) { this.appendChild(mediaWatching); }

  playVideo(file) {
    this.style.zIndex = 1;
    let videoInfo = null;
    if (file?.videos?.length > 0) videoInfo = file.videos[0];
    else if (file?.titles?.length > 0) videoInfo = file.titles[0];
    const path = extractPath(file);
    if (!path) {
      displayError("Invalid file path.", 3000);
      this.resume();
      return;
    }

    let resumed = false;
    const resumeOnce = () => {
      if (resumed) return;
      resumed = true;
      this.resume();
    };

    this.displayWaitMessage(this._buildMediaWaitMessage("video", file, videoInfo));
    let cleanup = () => { };
    try {
      const vp = playVideo(
        path,
        null,
        () => { cleanup(); resumeOnce(); this._videoPlayer = undefined; },
        videoInfo
      );
      if (vp) vp.fileExplorer = this;
      this._videoPlayer = vp;
      const ve = vp?.videoElement;
      let onPlayEvt = null;
      let onErrEvt = null;
      cleanup = () => {
        if (!ve) return;
        if (onPlayEvt) ve.removeEventListener("playing", onPlayEvt);
        if (onErrEvt) ve.removeEventListener("error", onErrEvt);
      };
      if (ve) {
        onPlayEvt = () => { cleanup(); resumeOnce(); };
        onErrEvt = () => { cleanup(); resumeOnce(); };
        ve.addEventListener("playing", onPlayEvt);
        ve.addEventListener("error", onErrEvt);
      }
    } catch (err) {
      displayError(`Failed to open video: ${err?.message || err}`, 3000);
      resumeOnce();
    }
  }

  async playAudio(file) {
    this.style.zIndex = 1;
    const path = extractPath(file);
    const initialInfo = (file?.audios?.length ? file.audios[0] : null) || (file?.titles?.length ? file.titles[0] : null);

    if (!path) {
      displayError("Invalid file path.", 3000);
      this.resume();
      return;
    }

    let resumed = false;
    const resumeOnce = () => {
      if (resumed) return;
      resumed = true;
      this.resume();
    };

    this.displayWaitMessage(this._buildMediaWaitMessage("audio", file, initialInfo));
    try {
      const audios = await getFileAudiosInfo(path);
      const audioInfo = (audios && audios.length > 0) ? audios[0] : initialInfo;

      if (audioInfo) {
        const player = await playAudio(
          path,
          () => resumeOnce(),
          () => { resumeOnce(); this._audioPlayer = undefined; },
          audioInfo
        );
        if (player) player.fileExplorer = this;
        this._audioPlayer = player;
        const ws = player?._wavesurfer;
        if (ws?.on) {
          const onPlay = () => { if (ws.un) ws.un("play", onPlay); if (ws.un) ws.un("error", onErr); resumeOnce(); };
          const onErr = () => { if (ws.un) ws.un("play", onPlay); if (ws.un) ws.un("error", onErr); resumeOnce(); };
          ws.on("play", onPlay);
          ws.on("error", onErr);
        }
      } else {
        displayMessage("No audio information found for this file.", 3000);
        resumeOnce();
      }

    } catch (err) {
      displayError(`Failed to get audio info: ${err.message}`, 3000);
      resumeOnce();
    }
  }

  setSearchResults(results) {
    this.shadowRoot.querySelectorAll("globular-document-search-results").forEach(el => el.parentNode.removeChild(el));
    results.style.position = "absolute";
    results.style.zIndex = 1000;
    results.style.top = "0px"; results.style.left = "0px"; results.style.right = "0px"; results.style.bottom = "0px";
    results.style.backgroundColor = "var(--surface-color)";
    results.style.color = "var(--on-surface-color)";
    results.style.overflow = "auto";
    this.appendChild(results);
  }

  async createLink(file, dest) {
    const filePath = extractPath(file);
    const fileName = filePath.substring(filePath.lastIndexOf("/") + 1);
    const linkName = fileName.includes(".") ? fileName.substring(0, fileName.indexOf(".")) + ".lnk" : fileName + ".lnk";
    try {
      await createLink(dest, linkName, (file && file.serializeBinary) ? file : file);
      displayMessage(`Link "${linkName}" created!`, 3000);
      Backend.eventHub.publish("reload_dir_event", dest, false);
    } catch (err) {
      displayError(`Failed to create link: ${err.message}`, 3000);
    }
  }

  readFile(file, page = 1) {
    this._hideAllViewsExcept(this._fileReader);
    this._fileReader.style.display = "block";
    this._fileReader.read(file, page);
  }

  showShareWizard(wizard) {
    this._hideAllViewsExcept(wizard);
    wizard.style.display = "";
    wizard.onclose = () => { this._displayView(this._currentDir); };
  }

  showImage(file) {
    this._hideAllViewsExcept(this._imageViewer);
    this._imageViewer.style.display = "block";
    this._imageViewer.width = this._fileSelectionPanel.offsetWidth;
    this._imageViewer.height = this._fileSelectionPanel.offsetHeight;
    for (let i = 0; i < this._imageViewer.children.length; i++) {
      if (this._imageViewer.children[i].name === extractPath(file)) {
        this._imageViewer.activeImage(getElementIndex(this._imageViewer.children[i]));
        break;
      }
    }
    this._imageViewer.redraw();
  }

  _displayView(dir) {
    if (dir) {
      this._filesListView.setDir(dir);
      this._filesIconView.setDir(dir);
      this._filesIconView.menu.close();
      this._filesListView.menu.close();
    }

    this._filesListView.hide();
    this._filesIconView.hide();

    this._fileReader.style.display = "none";
    this._imageViewer.style.display = "none";
    this._permissionManager.style.display = "none";
    this._informationManager.style.display = "none";
    this._closeSharePanel();

    if (this._filesListBtn.classList.contains("active")) this._filesListView.show();
    else this._filesIconView.show();
  }

  _hideAllViewsExcept(exceptElement) {
    const views = [
      this._filesListView, this._filesIconView,
      this._fileReader, this._imageViewer,
      this._permissionManager, this._informationManager,
      this._sharePanel, this._shareWizard
    ];

    views.forEach(view => {
      if (view && view !== exceptElement) {
        if (view === this._filesListView || view === this._filesIconView) view.hide();
        else view.style.display = "none";
      }
    });
    if (exceptElement) exceptElement.style.display = "";
  }

  _closeAllGlobalMenus() {
    this._filesListView.hideMenu();
    this._filesIconView.hideMenu();
    document.querySelectorAll("globular-dropdown-menu").forEach(menu => { if (menu.parentNode) menu.parentNode.removeChild(menu); });
    document.querySelectorAll("#file-actions-menu").forEach(menu => { if (menu.parentNode) menu.parentNode.removeChild(menu); });
    document.querySelectorAll("#rename-file-dialog").forEach(dialog => { if (dialog.parentNode) dialog.parentNode.removeChild(dialog); });
  }

  _buildImageSrc(path) {
    if (!path) return "";
    try {
      const { url, headers } = buildFileUrl(path);
      const token = headers?.token;
      if (token) {
        const glue = url.includes("?") ? "&" : "?";
        return `${url}${glue}token=${encodeURIComponent(token)}`;
      }
      return url;
    } catch (err) {
      console.warn("Failed to build image URL:", err);
      return path || "";
    }
  }


  async _loadImages(dir, callback) {
    try {
      const vm = dir;
      const list = Array.isArray(vm?.files) ? vm.files : [];
      const imageVMs = list
        .map((file) => {
          const target = file?.linkTarget || file;
          return { file, target, mime: mimeOf(target) || "" };
        })
        .filter((entry) => entry.mime.startsWith("image"));
      if (imageVMs.length === 0) {
        this._imageViewer.innerHTML = "";
        this._imageViewer.populateChildren();
        if (callback) callback();
        return;
      }
      this._imageViewer.innerHTML = "";
      if (typeof this._imageViewer.beginBatch === "function") {
        this._imageViewer.beginBatch();
      }

      const parseDimension = (val) => {
        if (val == null) return undefined;
        if (typeof val === "number" && Number.isFinite(val)) return Math.round(val);
        if (typeof val === "string") {
          const match = val.match(/([0-9]+(?:\.[0-9]+)?)/);
          if (match) return Math.round(parseFloat(match[1]));
        }
        return undefined;
      };

      const extractDimsFromMeta = (meta) => {
        if (!meta || typeof meta !== "object") return { width: undefined, height: undefined };
        const pick = (...keys) => {
          for (const key of keys) {
            if (meta[key] != null) return meta[key];
          }
          return undefined;
        };
        const width =
          parseDimension(pick("OriginalWidth", "ImageWidth", "Image Width")) ||
          parseDimension(pick("ThumbnailWidth", "Thumbnail Width"));
        const height =
          parseDimension(pick("OriginalHeight", "ImageHeight", "Image Height")) ||
          parseDimension(pick("ThumbnailHeight", "Thumbnail Height"));
        return { width, height };
      };

      imageVMs.forEach((entry) => {
        const sourceFile = entry.target || entry.file;
        const realPath = pathOf(sourceFile) || pathOf(entry.file);
        if (!realPath) return;


        const img = document.createElement("img");
        img.name = realPath;
        img.slot = "images";
        img.draggable = false;
        img.setAttribute("data-name", nameOf(sourceFile) || nameOf(entry.file) || "");

        const fullSrc = this._buildImageSrc(realPath);
        if (fullSrc) {
          img.setAttribute("data-fullsrc", fullSrc);
        }
        const thumbSrc = thumbOf(sourceFile) || thumbOf(entry.file) || "";
        if (thumbSrc) {
          img.setAttribute("data-thumb", thumbSrc);
          img.setAttribute("src", thumbSrc);
        } else if (fullSrc) {
          img.setAttribute("src", fullSrc);
        }

        let width = sourceFile?.width || sourceFile?.getWidth?.();
        let height = sourceFile?.height || sourceFile?.getHeight?.();

        if (!width || !height) {
          const dims = extractDimsFromMeta(sourceFile?.metadata || entry.file?.metadata);
          if (dims.width && !width) width = dims.width;
          if (dims.height && !height) height = dims.height;
        }

        if (width) {
          img.setAttribute("width", `${width}`);
          img.dataset.origWidth = `${width}`;
        }
        if (height) {
          img.setAttribute("height", `${height}`);
          img.dataset.origHeight = `${height}`;
        }
        if (width && height) {
          img.style.aspectRatio = `${width}/${height}`;
        }

        img.dataset.fullLoaded =
          thumbSrc && fullSrc && thumbSrc !== fullSrc ? "false" : "true";

        this._imageViewer.addImage(img);
      });
      if (typeof this._imageViewer.endBatch === "function") {
        this._imageViewer.endBatch();
      } else {
        this._imageViewer.populateChildren();
      }
    } catch (err) {
      displayError(`Failed to load images: ${err.message}`, 3000);
      console.error("Image loading error:", err);
    } finally {
      if (callback) callback();
    }
  }

  getRoot() {
    if (!this._root) return "";
    const values = this._root.path ? this._root.path.split("/") : extractPath(this._root).split("/");
    return `/${values[1]}/${values[2]}`;
  }

  hideActions() {
    const cardActions = this.shadowRoot.querySelector(".card-actions");
    if (cardActions) cardActions.style.display = "none";
  }

  delete() {
    if (this.parentNode) this.parentNode.removeChild(this);
  }

  _closeAllGlobalDialogs() {
    document.querySelectorAll("#new-dir-dialog, #rename-file-dialog, #file-actions-menu").forEach(dialog => {
      if (dialog.parentNode) dialog.parentNode.removeChild(dialog);
    });
  }

  // ====== NEW: centralized info panel logic ======

  _unsubscribeInfoInvalidation() {
    const { event, uuid } = this._currentInfoInvalidationSub || {};
    if (event && uuid) {
      try {
        Backend.eventHub.unsubscribe(event, uuid);
      } catch {}
    }
    this._currentInfoInvalidationSub = { event: null, uuid: null };
  }

  _unsubscribeInfoDelete() {
    const { event, uuid } = this._currentInfoDeleteSub || {};
    if (event && uuid) {
      try { Backend.eventHub.unsubscribe(event, uuid); } catch { }
    }
    this._currentInfoDeleteSub = { event: null, uuid: null };
    this._unsubscribeInfoInvalidation();
  }

  _pruneDeletedInfoFromFile(file, infoId, arrKey) {
    if (!file || !infoId || !arrKey || !Array.isArray(file[arrKey])) return;
    const filtered = file[arrKey].filter((item) => {
      const itemId = typeof item?.getId === "function" ? item.getId() : item?.id || item?.ID || "";
      return itemId !== infoId;
    });
    if (filtered.length === file[arrKey].length) return;
    if (filtered.length === 0) {
      delete file[arrKey];
    } else {
      file[arrKey] = filtered;
    }
  }

  _pruneDirInfo(dir, infoId, arrKey, filePaths = []) {
    if (!dir) return;
    const files = typeof dir.getFilesList === "function" ? dir.getFilesList() : (dir.files || []);
    if (!Array.isArray(files)) return;
    files.forEach((file) => {
      const filePath = pathOf(file) || file?.path || "";
      if (!filePath || filePaths.length === 0 || filePaths.includes(filePath)) {
        this._pruneDeletedInfoFromFile(file, infoId, arrKey);
      }
    });
  }

  _removeInfoFromFiles(infoId, infoType = "title", filePaths = []) {
    if (!infoId) return;
    const arrKey = infoType === "audio" ? "audios" : infoType === "video" ? "videos" : "titles";
    this._pruneDirInfo(this._currentDir, infoId, arrKey, filePaths);
    this._pruneDirInfo(this._currentDirVM, infoId, arrKey, filePaths);
  }

  _invalidateInfoInFiles(infoId, infoType = "title", filePaths = []) {
    if (!infoId) return;
    const arrKey = infoType === "audio" ? "audios" : infoType === "video" ? "videos" : "titles";
    this._pruneDirInfo(this._currentDir, infoId, arrKey, filePaths);
    this._pruneDirInfo(this._currentDirVM, infoId, arrKey, filePaths);
  }

  _showInformation(file, forceView) {
    // Always clear before repopulating to avoid stale UI
    this._informationManager.clear?.();

    // Populate depending on payload shape
    if (forceView === "file") {
      this._informationManager.setFileInformation(file);
      this._hideAllViewsExcept(this._informationManager);
      this._closeAllGlobalMenus();
      this._informationManager.style.display = "";
      return;
    }
    let infos = null;
    if (file?.titles?.length > 0) {
      this._informationManager.setTitlesInformation(file.titles);
      infos = file.titles[0];
    }
    if (file?.videos?.length > 0) {
      this._informationManager.setVideosInformation(file.videos);
      infos = infos || file.videos[0];
    }
    if (file?.audios?.length > 0) {
      this._informationManager.setAudiosInformation(file.audios);
      infos = infos || file.audios[0];
    }
    if (!infos && file) {
      // fallback to raw file info if provided
      this._informationManager.setFileInformation?.(file);
    }

    // Show panel
    this._hideAllViewsExcept(this._informationManager);
    this._closeAllGlobalMenus();
    this._informationManager.style.display = "";

    // Rewire delete subscription safely (avoid stacking from previous opens)
    this._unsubscribeInfoDelete();
    const infoId = infos && typeof infos.getId === "function" ? infos.getId() : null;
    if (infoId) {
      const delEvt = `_delete_infos_${infoId}_evt`;
      Backend.eventHub.subscribe(
        delEvt,
        (uuid2) => { this._currentInfoDeleteSub = { event: delEvt, uuid: uuid2 }; },
        (evtData) => {
          this._removeInfoFromFiles(infoId, evtData?.infoType, evtData?.filePaths);
          this._informationManager.clear?.();
          this._informationManager.style.display = "none";
          this._displayView(this._currentDir);
          this._unsubscribeInfoDelete();
        },
        true,
        this
      );
      const invalidEvt = `_invalidate_infos_${infoId}_evt`;
      Backend.eventHub.subscribe(
        invalidEvt,
        (uuid2) => { this._currentInfoInvalidationSub = { event: invalidEvt, uuid: uuid2 }; },
        (evtData) => {
          this._invalidateInfoInFiles(infoId, evtData?.infoType, evtData?.filePaths);
          if (this._currentDir) this._displayView(this._currentDir);
        },
        true,
        this
      );
    }
  }
}

customElements.define('globular-file-explorer', FileExplorer);
