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

// Import sub-components
import "./searchDocument.js";
import './fileNavigator.js';
import './pathNavigator.js';
import "../share/shareResourceMenu";
import "../menu.js";

import {
  addPublicDir,
  buildFileUrl,
  createDir,
  createLink,
  getFilesCache,
  readDir,
  upload,
  getFile as getFileInfo,
  getFileMetadata,
} from "../../backend/cms/files";

import { displayError, displayMessage } from "../../backend/ui/notify";

// use session-driven account VM
import { getCurrentAccount } from "../../backend/rbac/accounts";
import { getFileAudiosInfo } from '../../backend/media/title';
import { FilesUploader } from './fileUploader';
import { pathOf, thumbOf } from './filevm-helpers';

/** Helper to extract a path from a DirVM/FileVM/String */
function extractPath(v) {
  if (!v) return "";
  if (typeof v === "string") return v;
  if (v && typeof v.path === "string") return v.path;
  return "";
}

function getElementIndex(element) {
  return Array.from(element.parentNode.children).indexOf(element);
}

export class FileExplorer extends HTMLElement {
  static paperTray = [];
  static fileUploader = null;

  _id = null;
  _path = undefined;
  _root = undefined;            // DirVM
  _navigations = [];
  _onerror = (err) => displayError(err, 3000);
  _navigatingFromHistory = false;
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

  // keep a reference to the latest DirVM for image loading, etc.
  _currentDirVM = undefined;

  // ✅ new: resolved account VM
  _account /**: AccountVM | null*/ = null;

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
      // Assumes FilesUploader is globally available in your app (as in original code)
      FileExplorer.fileUploader = new FilesUploader();
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
    // Unsubscribe all events associated with this component context
    for (const name in this._listeners) {
      try {
        Backend.eventHub.unsubscribe(name, this._listeners[name]);
      } catch { /* ignore */ }
    }
    this._listeners = {};

    this._closeAllGlobalDialogs();

    if (this._filesIconView?.stopPreview) this._filesIconView.stopPreview();
    if (this._filesListView?.stopPreview) this._filesListView.stopPreview();

    if (FileExplorer.fileUploader && FileExplorer.fileUploader.parentNode === this) {
      this.removeChild(FileExplorer.fileUploader);
    }
  }

  _initializeLayout() {
    this.shadowRoot.innerHTML = `
      <style>
        ::-webkit-scrollbar { width: 10px; }
        ::-webkit-scrollbar-track { background: var(--scroll-track, var(--surface-color)); }
        ::-webkit-scrollbar-thumb { background: var(--scroll-thumb, var(--palette-divider)); border-radius: 6px; }
        paper-icon-button:hover { cursor: pointer; }
        #file-navigation-panel, #file-selection-panel {
          background-color: var(--surface-color);
          color: var(--primary-text-color);
        }
        #file-explorer-content { display: flex; flex-direction: column; height: calc(100% - 40px); }
        #file-explorer-layout { display: flex; flex-grow: 1; overflow: hidden; }
        globular-file-reader { height: 100%; }
        globular-permissions-manager, globular-informations-manager {
          background-color: var(--surface-color);
          position: absolute; top: 0; left: 0; right: 0; bottom: 0;
          overflow: auto; z-index: 100;
        }
        #progress-div {
          position: absolute; bottom: 0; left: 10px;
          display: none; font-size: 0.85rem;
          background-color: var(--surface-color);
          z-index: 1000;
        }
        .card-actions { display: flex; }
        @media (max-width: 500px) {
          .footer { width: calc(100vw - 35px); bottom: 0; position: fixed; }
          #file-explorer-content { margin-bottom: 40px; }
          #enter-full-screen-btn { display: none; }
        }
      </style>
      <globular-dialog id="globular-file-explorer-dialog" class="file-explorer" name="file-explorer"
        is-moveable="true" is-maximizeable="true" is-resizeable="true"
        show-icon="true" is-minimizeable="true">
        <globular-search-document-bar slot="search"></globular-search-document-bar>
        <span id="title-span" slot="title">File Explorer</span>

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
              <globular-file-navigator ></globular-file-navigator>
            </globular-split-pane>
            <globular-split-pane id="file-selection-panel" style="position: relative; width: 100%;">
              <slot></slot>
              <div id="progress-div">
                <span id="progress-message">Loading...</span>
                <paper-progress id="globular-dir-loading-progress-bar" indeterminate></paper-progress>
              </div>
            </globular-split-pane>
          </globular-split-view>
        </div>

        <div class="card-actions footer" style="background-color: var(--surface-color);">
          <globular-disk-space-manager account="sa@localhost" style="display: none;"></globular-disk-space-manager>
          <span style="flex-grow: 1;"></span>
          <paper-icon-button id="files-icon-btn" class="active" icon="icons:view-module" style="--iron-icon-fill-color: var(--palette-action-active);" role="button" tabindex="0" aria-disabled="false"></paper-icon-button>
          <paper-icon-button id="files-list-btn" icon="icons:view-list" style="--iron-icon-fill-color: var(--palette-action-disabled);" role="button" tabindex="1" aria-disabled="false" ></paper-icon-button>
          <paper-icon-button id="file_uploader_icon" icon="icons:file-upload" style="--iron-icon-fill-color: var(--palette-action-disabled);" ></paper-icon-button >
        </div>
      </globular-dialog>
    `;
    this._dialog = this.shadowRoot.querySelector("globular-dialog");
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

    // NOTE: we can't set disk space manager account until we resolve the session (done in _loadInitialData)

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

    this._sharePanel = null;
  }

  _bindEventHandlers() {
    this._dialog.onclose = () => {
      this._filesIconView.hide();
      this._filesListView.hide();
      if (this._onclose) {
        this._onclose();
      }
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
    this._fileUploaderBtn.addEventListener('click', this._handleViewToggleClick.bind(this, 'uploader'));

    this._backNavigationBtn.addEventListener('click', this._handleNavigationClick.bind(this, 'back'));
    this._fowardNavigationBtn.addEventListener('click', this._handleNavigationClick.bind(this, 'forward'));
    this._upwardNavigationBtn.addEventListener('click', this._handleNavigationClick.bind(this, 'upward'));
    // Dynamic List button wired in setDir()
  }

  _setupBackendSubscriptions() {
    const explorerId = this._id;

    Backend.eventHub.subscribe("__set_dir_event__",
      (uuid) => { this._listeners["__set_dir_event__"] = uuid; },
      (evt) => {
        if (evt.file_explorer_id === explorerId) {
          this._handleSetDirEvent(evt.dir); // DirVM
        }
      }, true, this
    );

    Backend.eventHub.subscribe("__upload_files_event__",
      (uuid) => { this._listeners[`upload_files_event_`] = uuid; },
      (evt) => {
        const dirPath = extractPath(evt.dir);
        if (dirPath && dirPath === this._path) {
          const cache = getFilesCache();
          if (cache) cache.invalidate(this._path);
          this._handleRefreshClick();
        }
      }, false, this
    );

    Backend.eventHub.subscribe("follow_link_event_",
      (uuid) => { this._listeners["follow_link_event_"] = uuid; },
      async (evt) => {
        if (evt.file_explorer_id !== explorerId) return;
        try {
          const file = await getFileInfo(evt.path); // FileVM | null
          if (!file) throw new Error("File not found.");

          if (this._sharePanel?.parentElement) {
            this._sharePanel.parentElement.removeChild(this._sharePanel);
          }
          const isDir = !!file.isDir;
          const mime = file.mime || "";
          const p = file.path || "";

          if (isDir) {
            this.publishSetDirEvent(p);
          } else {
            if (mime.startsWith("video")) {
              this.playVideo(file);
            } else if (mime.startsWith("audio")) {
              this.playAudio(file);
            } else {
              this.readFile(file);
            }
          }
        } catch (err) {
          displayError(`Failed to follow link: ${err.message}`, 3000);
        }
      }, true, this
    );

    Backend.eventHub.subscribe(`update_globular_service_configuration_evt`,
      (uuid) => { this._listeners[`update_globular_service_configuration_evt`] = uuid; },
      (event) => {
        const config = JSON.parse(event);
        // hook if needed when file service config changes
        if (config.Name === "file.FileService") {
          // noop
        }
      }, false, this
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
        this._permissionManager.permissions = null;
        const filePath = extractPath(file);
        this._permissionManager.setPath(filePath);
        this._permissionManager.setResourceType = "file";
        this._permissionManager.style.display = "";
        this._hideAllViewsExcept(this._permissionManager);
      }, false, this
    );

    Backend.eventHub.subscribe(`display_media_infos_${explorerId}_event`,
      (uuid) => { this._listeners[`display_media_infos_${explorerId}_event`] = uuid; },
      (file) => {
        let infos = null;
        if (file.titles && file.titles.length > 0) {
          this._informationManager.setTitlesInformation(file.titles);
          infos = file.titles[0];
        }
        if (file.videos && file.videos.length > 0) {
          this._informationManager.setVideosInformation(file.videos);
          infos = file.videos[0];
        }
        if (file.audios && file.audios.length > 0) {
          this._informationManager.setAudiosInformation(file.audios);
          infos = file.audios[0];
        }
        this._hideAllViewsExcept(this._informationManager);
        this._closeAllGlobalMenus();
        this._informationManager.style.display = "";

        if (infos && typeof infos.getId === "function") {
          Backend.eventHub.subscribe(`_delete_infos_${infos.getId()}_evt`,
            (uuid2) => { this._listeners[`_delete_infos_${infos.getId()}_evt`] = uuid2; },
            () => {
              if (this._informationManager.parentNode) {
                this._informationManager.parentNode.removeChild(this._informationManager);
              }
            }, true, this
          );
        }
      }, false, this
    );

    Backend.eventHub.subscribe(`display_file_infos_${explorerId}_event`,
      (uuid) => { this._listeners[`display_file_infos_${explorerId}_event`] = uuid; },
      (file) => {
        this._informationManager.setFileInformation(file);
        this._hideAllViewsExcept(this._informationManager);
        this._informationManager.style.display = "";
      }, false, this
    );

    Backend.eventHub.subscribe("reload_dir_event",
      (uuid) => { this._listeners[`reload_dir_event`] = uuid; },
      async (path) => {
        if (this._path && path && path === this._path) {
          this.displayWaitMessage(`Loading ${path}...`);
          FileExplorer.paperTray = [];
          this._filesIconView.setSelected({});
          this._filesListView.setSelected({});
          try {
            const dirVM = await readDir(path, true); // DirVM { path, files: FileVM[] }
            // only reload file navigator if we have it
            if (this._fileNavigator?.reload) this._fileNavigator.reload(dirVM);
            if (dirVM.path === this._path) {
              this._currentDirVM = dirVM;
              Backend.eventHub.publish("__set_dir_event__", { dir: dirVM, file_explorer_id: explorerId }, true);
            }
            if (this._diskSpaceManager?.refresh) this._diskSpaceManager.refresh();
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
      (evt) => {
        if (evt.file_explorer_id === explorerId) {
          this.playVideo(evt.file);
        }
      }, true, this
    );

    Backend.eventHub.subscribe("__play_audio__",
      (uuid) => { this._listeners["__play_audio__"] = uuid; },
      (evt) => {
        if (evt.file_explorer_id === explorerId) {
          this.playAudio(evt.file);
        }
      }, true, this
    );

    Backend.eventHub.subscribe("__read_file__",
      (uuid) => { this._listeners["__read_file__"] = uuid; },
      (evt) => {
        if (evt.file_explorer_id === explorerId) {
          this.readFile(evt.file);
        }
      }, true, this
    );

    Backend.eventHub.subscribe("__show_image__",
      (uuid) => { this._listeners["__show_image__"] = uuid; },
      (evt) => {
        if (evt.file_explorer_id === explorerId) {
          this.showImage(evt.file);
        }
      }, true, this
    );

    Backend.eventHub.subscribe("__show_share_wizard__",
      (uuid) => { this._listeners["__show_share_wizard__"] = uuid; },
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

    // ✅ Resolve current account from session (JWT)
    try {
      this._account = getCurrentAccount();
    } catch (e) {
      console.warn("Failed to resolve session account:", e);
      this._account = null;
    }

    // ✅ Set disk space manager account once we know it
    if (this._diskSpaceManager) {
      if (this._account && this._account.id && this._account.domain) {
        // DiskSpaceManager commonly expects "user@domain" string
        this._diskSpaceManager.account = `${this._account.id}@${this._account.domain}`;
      } else {
        // fallback (keeps it hidden if it needs a valid account)
        this._diskSpaceManager.style.display = "none";
      }
    }

    const readAndSetRoot = async (dirPath) => {
      try {
        const dirVM = await readDir(dirPath); // DirVM
        this._root = dirVM;
        this._currentDirVM = dirVM;
        this._path = dirVM.path || "";

        this._fileNavigator.setDir(dirVM);
        this._pathNavigator.setDir(dirVM);
        this._filesListView.setDir(dirVM);
        this._filesIconView.setDir(dirVM);

        this._displayView(dirVM);
        Backend.eventHub.publish("__set_dir_event__", { dir: dirVM, file_explorer_id: this._id }, true);
      } catch (err) {
        this._onerror(err);
        console.error(`Failed to read root directory ${dirPath}:`, err);
      }
    };

    try {
      // ✅ Build user dir from AccountVM (id + domain). Fallback to /public if missing.
      const userDir =
        (this._account?.id && this._account?.domain)
          ? `/users/${this._account.id}@${this._account.domain}`
          : "/public";

      await readAndSetRoot(userDir);

      const applicationDir = `/applications/${window.location.pathname.split('/')[1]}`;
      if (applicationDir && applicationDir !== userDir) {
        await readAndSetRoot(applicationDir);
      }

      this.resume();
      if (this._onloaded) {
        this._onloaded();
      }
      this._fileIconBtn.click();
    } catch (err) {
      this.resume();
      displayError(`Failed to initialize file explorer: ${err.message}`, 5000);
      console.error("File explorer initialization failed:", err);
    }
  }

  _handleRefreshClick() {
    Backend.eventHub.publish("reload_dir_event", this._path, true);
  }

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

    const removeDialog = () => {
      if (dialog && dialog.parentNode) dialog.parentNode.removeChild(dialog);
    };

    cancelBtn.onclick = (evt) => { evt.stopPropagation(); removeDialog(); };
    input.onkeydown = (evt) => { if (evt.keyCode === 13) createBtn.click(); else if (evt.keyCode === 27) cancelBtn.click(); };

    createBtn.onclick = async (evt) => {
      evt.stopPropagation();
      removeDialog();

      const newFolderName = input.value;
      if (!newFolderName) {
        displayMessage("Folder name cannot be empty.", 3000);
        return;
      }

      try {
        if (this._path === "/public") {
          await addPublicDir(newFolderName);
        } else {
          await createDir(this._path, newFolderName);
        }
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
    fileInput.onchange = () => {
      if (fileInput.files.length > 0) {
        upload(this._path, fileInput.files);
      }
      fileInput.value = '';
    };
  }

  _handleSharePanelClick(evt) {
    evt.stopPropagation();
    this._permissionManager.style.display = "none";
    this._informationManager.style.display = "none";

    if (this._sharePanel === null) {
      // ✅ pass the resolved AccountVM (or null) — SharePanel should accept it
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
    let targetPath = this._path;
    const currentIndex = this._navigations.indexOf(this._path);

    if (type === 'back') {
      if (currentIndex > 0) {
        targetPath = this._navigations[currentIndex - 1];
        this._navigatingFromHistory = true; // 🔧 moving along history
      } else {
        return;
      }
    } else if (type === 'forward') {
      if (currentIndex < this._navigations.length - 1) {
        targetPath = this._navigations[currentIndex + 1];
        this._navigatingFromHistory = true; // 🔧 moving along history
      } else {
        return;
      }
    } else if (type === 'upward') {
      const pathParts = (this._path || "").split("/");
      if (pathParts.length > 2) {
        targetPath = this._path.substring(0, this._path.lastIndexOf("/"));
        // upward is *not* a history move → normal push/truncate logic
      } else {
        return;
      }
    } else {
      return;
    }

    this.publishSetDirEvent(targetPath);
  }


  _handleViewToggleClick(viewType, evt) {
    evt.stopPropagation();

    this._imageViewer.style.display = "none";
    this._filesListView.hide();
    this._filesIconView.hide();
    this._fileReader.style.display = "none";
    this._permissionManager.style.display = "none";
    this._informationManager.style.display = "none";
    if (this._sharePanel?.parentNode) {
      this._sharePanel.parentNode.removeChild(this._sharePanel);
    }

    this._filesListBtn.classList.remove("active");
    this._fileIconBtn.classList.remove("active");
    this._fileUploaderBtn.classList.remove("active");
    this._filesListBtn.style.setProperty("--iron-icon-fill-color", "var(--palette-action-disabled)");
    this._fileIconBtn.style.setProperty("--iron-icon-fill-color", "var(--palette-action-disabled)");
    this._fileUploaderBtn.style.setProperty("--iron-icon-fill-color", "var(--palette-action-disabled)");

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
    } else if (viewType === 'uploader') {
      this.appendChild(FileExplorer.fileUploader);
      this._filesIconView.setActive(false);
      this._filesListView.setActive(false);
      this._fileUploaderBtn.classList.add("active");
      this._fileUploaderBtn.style.setProperty("--iron-icon-fill-color", "var(--palette-action-active)");
    }

    this._filesListView.hideMenu();
    this._filesIconView.hideMenu();
  }

  async publishSetDirEvent(path) {
    this.displayWaitMessage(`Loading ${path}...`);
    try {
      const dirVM = await readDir(path); // DirVM
      this._currentDirVM = dirVM;
      Backend.eventHub.publish("__set_dir_event__", { dir: dirVM, file_explorer_id: this._id }, true);
    } catch (err) {
      displayError(`Failed to load directory ${path}: ${err.message}`, 3000);
      this._onerror(err);
    } finally {
      this.resume();
    }
  }

  /** Just forwards to setDir */
  _handleSetDirEvent(dir) {
    this.setDir(dir);
  }

  setDir(dir, callback) {
    this._currentDir = dir;
    this._path = extractPath(dir);

    const currentPathIndex = this._navigations.indexOf(this._path);

    if (this._navigatingFromHistory) {
      // 🔧 We’re moving along existing history: do NOT truncate forward entries
      this._navigatingFromHistory = false;

      // If somehow this path wasn’t in history, just append it.
      if (currentPathIndex === -1) {
        this._navigations.push(this._path);
      }
    } else {
      // Normal navigation (clicking folders, path segments, upward, etc.)
      if (currentPathIndex === -1) {
        this._navigations.push(this._path);
      } else if (currentPathIndex !== this._navigations.length - 1) {
        // Jump into the middle of history → cut off forward entries
        this._navigations = this._navigations.slice(0, currentPathIndex + 1);
      }
    }

    this._pathNavigator.setDir(dir);
    this._fileNavigator.setDir(dir);
    this._filesListView.setDir(dir);
    this._filesIconView.setDir(dir);

    this._loadImages(dir, callback);

    this._fileReader.style.display = "none";
    this._imageViewer.style.display = "none";
    this._permissionManager.style.display = "none";
    this._informationManager.style.display = "none";
    if (this._sharePanel?.parentNode) this._sharePanel.parentNode.removeChild(this._sharePanel);

    this._imageViewer.onclose = () => this._displayView(this._currentDir);
    this._fileReader.onclose = () => this._displayView(this._currentDir);
    this._informationManager.onclose = () => this._displayView(this._currentDir);

    this._updateNavigationButtonStates();
    this._updateNavigationListMenu(dir);
  }


  _updateNavigationButtonStates() {
    const currentPathIndex = this._navigations.indexOf(this._path);

    const enableButton = (btn) => btn.style.setProperty("--iron-icon-fill-color", "var(--palette-action-active)");
    const disableButton = (btn) => btn.style.setProperty("--iron-icon-fill-color", "var(--palette-action-disabled)");

    if (this._backNavigationBtn) {
      currentPathIndex > 0 ? enableButton(this._backNavigationBtn) : disableButton(this._backNavigationBtn);
    }
    if (this._fowardNavigationBtn) {
      currentPathIndex < this._navigations.length - 1 ? enableButton(this._fowardNavigationBtn) : disableButton(this._fowardNavigationBtn);
    }
    if (this._upwardNavigationBtn) {
      const pathParts = (this._path || "").split("/");
      pathParts.length > 2 ? enableButton(this._upwardNavigationBtn) : disableButton(this._upwardNavigationBtn);
    }
  }

  _updateNavigationListMenu(currentDir) {
    if (!this._lstNavigationBtn) return;

    let navigationLst = this._lstNavigationBtn.parentNode.querySelector(".directories-selector");

    if (this._navigations.length > 1) {
      this._lstNavigationBtn.style.display = "block";
      if (!navigationLst) {
        navigationLst = document.createElement("paper-card");
        navigationLst.className = "directories-selector";
        navigationLst.style.display = "none";
        navigationLst.style.flexDirection = "column";
        navigationLst.style.position = "absolute";
        navigationLst.style.padding = "5px";
        navigationLst.style.zIndex = "100";
        navigationLst.style.top = "calc(100% + 5px)";
        navigationLst.style.left = "0px";
        navigationLst.style.backgroundColor = "var(--surface-color)";
        navigationLst.style.color = "var(--primary-text-color)";
        this._lstNavigationBtn.parentNode.appendChild(navigationLst);

        this._lstNavigationBtn.onclick = (evt) => {
          evt.stopPropagation();
          navigationLst.style.display = navigationLst.style.display === "flex" ? "none" : "flex";
        };
        navigationLst.onmouseleave = () => {
          navigationLst.style.display = "none";
        };
      }

      navigationLst.innerHTML = "";
      const range = document.createRange();

      this._navigations.forEach((path, index) => {
        if (!path.includes(".hidden")) {
          const html = `
            <div style="display: flex; align-items: center; padding: 4px;">
              <iron-icon style="height: 16px; width: 16px; margin-right: 8px;"></iron-icon>
              <span>${path.split("/").pop() || "Root"}</span>
            </div>
          `;
          navigationLst.appendChild(range.createContextualFragment(html));
          const navigationLine = navigationLst.children[navigationLst.children.length - 1];
          const icon = navigationLine.querySelector('iron-icon');

          const currentIndex = this._navigations.indexOf(extractPath(currentDir));
          if (index < currentIndex) {
            icon.icon = "icons:arrow-back";
          } else if (index > currentIndex) {
            icon.icon = "icons:arrow-forward";
          } else {
            icon.icon = "icons:check";
          }

          navigationLine.onmouseover = () => { navigationLine.style.cursor = "pointer"; navigationLine.style.backgroundColor = "var(--palette-action-hover)"; };
          navigationLine.onmouseleave = () => { navigationLine.style.cursor = "default"; navigationLine.style.backgroundColor = "transparent"; };
          navigationLine.onclick = () => {
            navigationLst.style.display = "none";
            this.publishSetDirEvent(this._navigations[index]);
          };
        }
      });
    } else {
      this._lstNavigationBtn.style.display = "none";
      if (navigationLst?.parentNode) {
        navigationLst.parentNode.removeChild(navigationLst);
      }
    }
  }

  setAtTop() {
    const draggables = document.querySelectorAll(".draggable");
    draggables.forEach(d => d.style.zIndex = 100);
    this.style.zIndex = 1000;
  }

  displayWaitMessage(message) {
    if (this._progressDiv) {
      this._progressDiv.style.display = "block";
      const messageDiv = this._progressDiv.querySelector("#progress-message");
      messageDiv.innerHTML = message;
    }
  }

  resume() {
    if (this._progressDiv) {
      this._progressDiv.style.display = "none";
    }
  }

  hideNavigator() {
    this._fileNavigator.hide();
    fireResize();
  }

  showNavigator() {
    this._fileNavigator.show();
    fireResize();
  }

  openMediaWatching(mediaWatching) {
    this.appendChild(mediaWatching);
  }

  playVideo(file) {
    this.style.zIndex = 1;
    let videoInfo = null;
    if (file?.videos?.length > 0) {
      videoInfo = file.videos[0];
    } else if (file?.titles?.length > 0) {
      videoInfo = file.titles[0];
    }
    const path = file?.path || "";
    if (!path) {
      displayError("Invalid file path.", 3000);
      return;
    }
    playVideo(path, null, () => { }, videoInfo);
  }

  async playAudio(file) {
    this.style.zIndex = 1;

    try {
      const path = pathOf(file);
      if (!path) {
        displayError("Invalid file path.", 3000);
        return;
      }

      const audios = await getFileAudiosInfo(path);
      const audioInfo = (audios && audios.length > 0) ? audios[0] : null;

      if (audioInfo) {
        playAudio(path, () => { }, () => { }, audioInfo);
      } else {
        displayMessage("No audio information found for this file.", 3000);
      }
    } catch (err) {
      displayError(`Failed to get audio info: ${err.message}`, 3000);
    }
  }

  setSearchResults(results) {
    this.shadowRoot.querySelectorAll("globular-document-search-results").forEach(el => el.parentNode.removeChild(el));

    results.style.position = "absolute";
    results.style.zIndex = 1000;
    results.style.top = "0px";
    results.style.left = "0px";
    results.style.right = "0px";
    results.style.bottom = "0px";
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
      // NOTE: your backend createLink expects a serialized proto or bytes.
      // If you still pass a proto elsewhere, this remains compatible.
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
    wizard.onclose = () => {
      this._displayView(this._currentDir);
    };
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
    if (FileExplorer.fileUploader?.parentNode) {
      FileExplorer.fileUploader.parentNode.removeChild(FileExplorer.fileUploader);
    }
    this._fileReader.style.display = "none";
    this._imageViewer.style.display = "none";
    this._permissionManager.style.display = "none";
    this._informationManager.style.display = "none";
    if (this._sharePanel?.parentNode) {
      this._sharePanel.parentNode.removeChild(this._sharePanel);
    }

    if (this._fileUploaderBtn.classList.contains("active")) {
      this.appendChild(FileExplorer.fileUploader);
    } else if (this._filesListBtn.classList.contains("active")) {
      this._filesListView.show();
    } else {
      this._filesIconView.show();
    }
  }

  _hideAllViewsExcept(exceptElement) {
    const views = [
      this._filesListView, this._filesIconView,
      this._fileReader, this._imageViewer,
      this._permissionManager, this._informationManager,
      this._sharePanel,
      FileExplorer.fileUploader
    ];

    views.forEach(view => {
      if (view && view !== exceptElement) {
        if (view === this._filesListView || view === this._filesIconView) {
          view.hide();
        } else if (view === FileExplorer.fileUploader) {
          if (view.parentNode) view.parentNode.removeChild(view);
        } else {
          view.style.display = "none";
        }
      }
    });
    if (exceptElement) exceptElement.style.display = "";
  }

  _closeAllGlobalMenus() {
    this._filesListView.hideMenu();
    this._filesIconView.hideMenu();
    document.querySelectorAll("globular-dropdown-menu").forEach(menu => {
      if (menu.parentNode) menu.parentNode.removeChild(menu);
    });
    document.querySelectorAll("#file-actions-menu").forEach(menu => {
      if (menu.parentNode) menu.parentNode.removeChild(menu);
    });
    document.querySelectorAll("#rename-file-dialog").forEach(dialog => {
      if (dialog.parentNode) dialog.parentNode.removeChild(dialog);
    });
  }

  async _loadImages(dir, callback) {
    try {
      // prefer VM for fetching images (paths + auth)
      const vm = this._currentDirVM;
      const list = Array.isArray(vm?.files) ? vm.files : [];

      const imageVMs = list.filter(f => (f.mime || "").startsWith("image"));
      if (imageVMs.length === 0) {
        this._imageViewer.innerHTML = "";
        this._imageViewer.populateChildren();
        if (callback) callback();
        return;
      }

      this._imageViewer.innerHTML = "";
      this._imageViewer.beginBatch?.();
      const parseDimension = (val: any) => {
        if (val == null) return undefined;
        if (typeof val === "number" && Number.isFinite(val)) return Math.round(val);
        if (typeof val === "string") {
          const match = val.match(/([0-9]+(?:\.[0-9]+)?)/);
          if (match) return Math.round(parseFloat(match[1]));
        }
        return undefined;
      };
      const extractDims = (meta: any) => {
        if (!meta || typeof meta !== "object") return { width: undefined, height: undefined };
        const pick = (...keys: string[]) => {
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

      for (const vm of imageVMs) {
        if (!vm.path) continue;
        const img = document.createElement("img");
        const { url, headers } = buildFileUrl(vm.path);
        const token = headers?.token;
        const fullSrc = token ? `${url}${url.includes("?") ? "&" : "?"}token=${encodeURIComponent(token)}` : url;
        const thumb = thumbOf(vm) || "";
        img.name = vm.path;
        img.slot = "images";
        img.draggable = false;
        img.setAttribute("data-name", vm.name || "");
        if (fullSrc) img.setAttribute("data-fullsrc", fullSrc);
        if (thumb) {
          img.setAttribute("data-thumb", thumb);
          img.src = thumb;
          img.dataset.fullLoaded = thumb === fullSrc ? "true" : "false";
        } else if (fullSrc) {
          img.src = fullSrc;
          img.dataset.fullLoaded = "true";
        }
        let width = vm.width || vm.getWidth?.();
        let height = vm.height || vm.getHeight?.();
        if (!width || !height) {
          const dims = extractDims(vm.metadata);
          if (!width && dims.width) width = dims.width;
          if (!height && dims.height) height = dims.height;
        }
        if (width) {
          img.setAttribute("width", String(width));
          img.dataset.origWidth = String(width);
          img.style.width = `${width}px`;
        }
        if (height) {
          img.setAttribute("height", String(height));
          img.dataset.origHeight = String(height);
          img.style.height = `${height}px`;
        }
        if (width && height) {
          img.style.aspectRatio = `${width}/${height}`;
        }
        img.dataset.fullLoaded = thumb && fullSrc && thumb !== fullSrc ? "false" : "true";
        this._imageViewer.addImage(img);
      }
      this._imageViewer.endBatch?.();
    } catch (err) {
      displayError(`Failed to load images: ${err.message}`, 3000);
      console.error("Image loading error:", err);
    } finally {
      if (callback) callback();
    }
  }

  getRoot() {
    if (!this._root || !this._root.path) {
      return "";
    }
    const values = this._root.path.split("/");
    return `/${values[1]}/${values[2]}`;
  }

  hideActions() {
    const cardActions = this.shadowRoot.querySelector(".card-actions");
    if (cardActions) cardActions.style.display = "none";
  }

  delete() {
    if (this.parentNode) {
      this.parentNode.removeChild(this);
    }
  }

  _closeAllGlobalDialogs() {
    document.querySelectorAll("#new-dir-dialog, #rename-file-dialog, #file-actions-menu").forEach(dialog => {
      if (dialog.parentNode) {
        dialog.parentNode.removeChild(dialog);
      }
    });
  }
}

customElements.define('globular-file-explorer', FileExplorer);
