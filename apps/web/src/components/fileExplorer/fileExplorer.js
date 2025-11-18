import { Backend } from '../../backend/backend'; // include getUrl
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

import {
  addPublicDir,
  createDir,
  createLink,
  getFilesCache,
  readDir,
  upload,
  getFile as getFileInfo,
  getImages, // HTMLImageElement[] loader for FileVM[]
  readDirFresh
} from "../../backend/cms/files";

import { displayError, displayMessage } from "../../backend/ui/notify";

// use session-driven account VM
import { getCurrentAccount } from "../../backend/rbac/accounts";
import { getFileAudiosInfo } from '../../backend/media/title';
import { FilesUploader } from './fileUploader';

// ✅ helpers centralize VM/proto normalization
import { adaptFileVM, adaptDirVM, extractPath } from "./filevm-helpers.js";

function getElementIndex(element) {
  return Array.from(element.parentNode.children).indexOf(element);
}

export class FileExplorer extends HTMLElement {
  static paperTray = [];
  static fileUploader = null;
  static editMode = "";

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

  _filesListView = undefined;
  _filesIconView = undefined;
  _permissionManager = undefined;
  _informationManager = undefined;
  _pathNavigator = undefined;
  _fileNavigator = undefined;
  _filesListBtn = undefined;
  _fileIconBtn = undefined;
  _fileUploaderBtn = undefined;
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
  _progressDiv = undefined;
  _documentSearchBar = undefined;
  _diskSpaceManager = undefined;
  _fileExplorerContent = undefined;
  _fileSelectionPanel = undefined;
  _fileReader = undefined;
  _imageViewer = undefined;

  _currentDirVM = undefined;
  _account = null;

  // 🔧 NEW: track current delete-sub for info panel to avoid stacking
  _currentInfoDeleteSub = { event: null, uuid: null };

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });

    this._id = `_${randomUUID()}`;
    this.setAttribute("id", this._id);

    this._path = undefined;
    this._root = undefined;
    this._navigations = [];
    this._listeners = {};

    if (FileExplorer.fileUploader === null) {
      FileExplorer.fileUploader = new FilesUploader();
      FileExplorer.fileUploader.id = "globular-files-uploader";
      FileExplorer.fileUploader.setAttribute("style", "position:absolute; z-index:1000; right:15px; bottom:2px;");
    }
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

    if (FileExplorer.fileUploader && FileExplorer.fileUploader.parentNode === this) {
      this.removeChild(FileExplorer.fileUploader);
    }
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
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        overflow: auto;
        z-index: 100;
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
        display: flex;
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
      offset="64">

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
    this._dialog.getPreview = this.getPreview.bind(this);
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

        const selectionClearingActions = ['cut', 'copy', 'delete', 'download', 'clear-selection'];

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
    this._informationManager.onclose = () =>{ 
      this._informationManager.path = null;
        this._displayView(this._currentDir)
      };

    this._sharePanel = null;
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
    };

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
        if (evt.file_explorer_id === explorerId) this._handleSetDirEvent(evt.dir);
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
            this._fileUploaderBtn.style.setProperty("--iron-icon-fill-color", "var(--palette-action-active)");
          }
        }
      }, false, this
    );

    Backend.eventHub.subscribe("follow_link_event_",
      (uuid) => { this._listeners["follow_link_event_"] = uuid; },
      async (evt) => {
        if (evt.file_explorer_id !== explorerId) return;
        try {
          const file = await getFileInfo(evt.path);
          if (!file) throw new Error("File not found.");
          const f = adaptFileVM(file);
          if (this._sharePanel?.parentElement) this._sharePanel.parentElement.removeChild(this._sharePanel);
          const isDir = f.getIsDir();
          const mime = f.getMime();
          const p = f.getPath();
          if (isDir) this.publishSetDirEvent(p);
          else if ((mime || "").startsWith("video")) this.playVideo(f);
          else if ((mime || "").startsWith("audio")) this.playAudio(f);
          else this.readFile(f);
        } catch (err) {
          displayError(`Failed to follow link: ${err.message}`, 3000);
        }
      }, true, this
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
    Backend.eventHub.subscribe(`display_media_infos_${explorerId}_event`,
      (uuid) => { this._listeners[`display_media_infos_${explorerId}_event`] = uuid; },
      (file) => this._showInformation(file), false, this
    );

    Backend.eventHub.subscribe(`display_file_infos_${explorerId}_event`,
      (uuid) => { this._listeners[`display_file_infos_${explorerId}_event`] = uuid; },
      (file) => this._showInformation(file), false, this
    );

    Backend.eventHub.subscribe("reload_dir_event",
      (uuid) => { this._listeners[`reload_dir_event`] = uuid; },
      async (path) => {
        if (this._path && path && path === this._path) {
          this.displayWaitMessage(`Loading ${path}...`);
          this._filesIconView.setSelected({});
          this._filesListView.setSelected({});
          try {
            const dirVM = await readDirFresh(path, true);
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
      this._fileIconBtn.click();
    } catch (err) {
      this.resume();
      displayError(`Failed to initialize file explorer: ${err.message}`, 5000);
      console.error("File explorer initialization failed:", err);
    }
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

  _handleRefreshClick() { Backend.eventHub.publish("reload_dir_event", this._path, true); }

  _handleCreateDirectoryClick() {
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
          paper-input {
            --paper-input-container-color: var(--on-surface-color);
            --paper-input-container-focus-color: var(--on-surface-color);
            --paper-input-container-label-floating-color: var(--on-surface-color);
            --paper-input-container-input-color: var(--on-surface-color);
          }
        </style>
        <paper-card id="${dialogId}">
          <div class="card-content">
            <paper-input id="new-dir-input" label="New folder name" value="Untitled Folder"></paper-input>
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
    setTimeout(() => {
      input.focus();
      input.inputElement._inputElement.select();
    }, 50);

    const cancelBtn = dialog.querySelector("#new-dir-cancel-btn");
    const createBtn = dialog.querySelector("#new-dir-create-btn");

    const removeDialog = () => { if (dialog && dialog.parentNode) dialog.parentNode.removeChild(dialog); };

    cancelBtn.onclick = (evt) => { evt.stopPropagation(); removeDialog(); };
    input.onkeydown = (evt) => { if (evt.keyCode === 13) createBtn.click(); else if (evt.keyCode === 27) cancelBtn.click(); };

    createBtn.onclick = async (evt) => {
      evt.stopPropagation();
      removeDialog();

      const newFolderName = input.value;
      if (!newFolderName) return displayMessage("Folder name cannot be empty.", 3000);

      try {
        if (this._path === "/public") await addPublicDir(newFolderName);
        else await createDir(this._path, newFolderName);
        displayMessage(`Folder "${newFolderName}" created!`, 3000);
        Backend.eventHub.publish("reload_dir_event", this._path, false);
      } catch (err) {
        displayError(`Failed to create folder: ${err.message}`, 3000);
      }
    };
  }

  _handleUploadClick() {
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
        await upload(this._path, fileInput.files);
        displayMessage("Files uploaded successfully!", 3000);
        Backend.eventHub.publish("reload_dir_event", this._path, false);
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
      this._sharePanel.style.position = "absolute";
      this._sharePanel.style.zIndex = 1000;
      this._sharePanel.style.top = "0px";
      this._sharePanel.style.left = "0px";
      this._sharePanel.style.right = "0px";
      this._sharePanel.style.bottom = "0px";
      this._sharePanel.onclose = () => { };
    }
    this._hideAllViewsExcept(this._sharePanel);
    this._sharePanel.style.display = "";
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
      this._fileUploaderBtn.style.setProperty("--iron-icon-fill-color", "var(--palette-action-disabled)");
    } else {
      this._fileExplorerContent.appendChild(FileExplorer.fileUploader);
      this._fileUploaderBtn.style.setProperty("--iron-icon-fill-color", "var(--palette-action-active)");
    }

  }

  _handleViewToggleClick(viewType, evt) {
    evt.stopPropagation();

    this._imageViewer.style.display = "none";
    this._filesListView.hide();
    this._filesIconView.hide();
    this._fileReader.style.display = "none";
    this._permissionManager.style.display = "none";
    this._informationManager.style.display = "none";
    if (this._sharePanel?.parentNode) this._sharePanel.parentNode.removeChild(this._sharePanel);

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
  }

  async publishSetDirEvent(path) {
    this.displayWaitMessage(`Loading ${path}...`);
    try {
      const dirVM = await readDir(path);
      const adapted = adaptDirVM(dirVM);
      this._currentDirVM = dirVM;
      Backend.eventHub.publish("__set_dir_event__", { dir: adapted, file_explorer_id: this._id }, true);
    } catch (err) {
      displayError(`Failed to load directory ${path}: ${err.message}`, 3000);
      this._onerror(err);
    } finally {
      this.resume();
    }
  }

  _handleSetDirEvent(dir) { this.setDir(dir); }

  setDir(dir, callback) {
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

    // --- existing UI updates ---

    this._pathNavigator.setDir(dir);
    this._fileNavigator.setDir(dir);
    this._filesListView.setDir(dir);
    this._filesIconView.setDir(dir);

    this._loadImages(dir, callback);

    this._fileReader.style.display = "none";
    this._imageViewer.style.display = "none";
    this._permissionManager.style.display = "none";
    this._informationManager.style.display = "none";
    if (this._sharePanel?.parentNode) {
      this._sharePanel.parentNode.removeChild(this._sharePanel);
    }

    this._imageViewer.onclose = () => this._displayView(this._currentDir);
    this._fileReader.onclose = () => this._displayView(this._currentDir);
 
    this._updateNavigationButtonStates();
    this._updateNavigationListMenu(dir);
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
  }

  resume() { if (this._progressDiv) this._progressDiv.style.display = "none"; }

  hideNavigator() { this._fileNavigator.hide(); fireResize(); }
  showNavigator() { this._fileNavigator.show(); fireResize(); }

  openMediaWatching(mediaWatching) { this.appendChild(mediaWatching); }

  playVideo(file) {
    this.style.zIndex = 1;
    let videoInfo = null;
    if (file?.videos?.length > 0) videoInfo = file.videos[0];
    else if (file?.titles?.length > 0) videoInfo = file.titles[0];
    const path = extractPath(file);
    if (!path) return displayError("Invalid file path.", 3000);
    playVideo(path, null, () => { }, videoInfo);
  }

  async playAudio(file) {
    this.style.zIndex = 1;
    try {
      const path = extractPath(file);
      if (!path) return displayError("Invalid file path.", 3000);
      const audios = await getFileAudiosInfo(path);
      const audioInfo = (audios && audios.length > 0) ? audios[0] : null;

      playAudio(path, () => { }, () => { }, audioInfo);

    } catch (err) {
      displayError(`Failed to get audio info: ${err.message}`, 3000);
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
    if (this._sharePanel?.parentNode) this._sharePanel.parentNode.removeChild(this._sharePanel);

    if (this._filesListBtn.classList.contains("active")) this._filesListView.show();
    else this._filesIconView.show();
  }

  _hideAllViewsExcept(exceptElement) {
    const views = [
      this._filesListView, this._filesIconView,
      this._fileReader, this._imageViewer,
      this._permissionManager, this._informationManager,
      this._sharePanel
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

  async _loadImages(dir, callback) {
    try {
      const vm = dir;
      const list = Array.isArray(vm?.files) ? vm.files : [];
      const imageVMs = list.filter(f => (f.mime || "").startsWith("image"));
      if (imageVMs.length === 0) {
        this._imageViewer.innerHTML = "";
        this._imageViewer.populateChildren();
        if (callback) callback();
        return;
      }
      const loadedImages = await getImages(imageVMs);
      this._imageViewer.innerHTML = "";
      loadedImages.forEach((img, i) => {
        img.name = imageVMs[i].path;
        img.slot = "images";
        img.draggable = false;
        this._imageViewer.addImage(img);
      });
      this._imageViewer.populateChildren();
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

  _unsubscribeInfoDelete() {
    const { event, uuid } = this._currentInfoDeleteSub || {};
    if (event && uuid) {
      try { Backend.eventHub.unsubscribe(event, uuid); } catch { }
    }
    this._currentInfoDeleteSub = { event: null, uuid: null };
  }

  _showInformation(file) {
    // Always clear before repopulating to avoid stale UI
    this._informationManager.clear?.();

    // Populate depending on payload shape
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
        () => {
          this._informationManager.clear?.();
          this._informationManager.style.display = "none";
          this._displayView(this._currentDir);
          this._unsubscribeInfoDelete();
        },
        true,
        this
      );
    }
  }
}

customElements.define('globular-file-explorer', FileExplorer);
