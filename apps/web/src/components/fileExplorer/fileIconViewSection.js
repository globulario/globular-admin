// src/components/fileIconViewSection.js

// Removed legacy protobuf/gRPC imports and all ".globule" usage
import { Backend } from "../../backend/backend";
import { displayMessage, displayError } from "../../backend/ui/notify";
import { getBaseUrl } from "../../core/endpoints";
import {copyToClipboard } from "../utility.js";
import "@polymer/iron-icon/iron-icon.js";
import "@polymer/paper-checkbox/paper-checkbox.js";
import { playVideos } from "../video";
import { playAudios } from "../audio";
import "./fileIconView";

// Small helper: build gateway URL from a repo path
function buildFileHttpUrl(path) {
  const base = (getBaseUrl() || "").replace(/\/$/, "");
  const parts = path.split("/").map(encodeURIComponent).filter(Boolean).join("/");
  return `${base}/${parts}`;
}

// Optional seam: if you have a token getter in new backend, plug it here.
async function tryGetAccessToken() {
  try {
    if (typeof Backend.getAccessToken === "function") {
      return await Backend.getAccessToken();
    }
  } catch (_) {}
  return undefined;
}

export class FileIconViewSection extends HTMLElement {
  _fileType = "";
  _dir = null;
  _fileExplorer = null;    // main FileExplorer
  _filesListView = null;   // for selection sync if you keep it
  _filesIconView = null;   // for selection sync if you keep it

  _domRefs = {};

  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._fileType = this.getAttribute("filetype") || "";
    this._initializeLayout();
    this._cacheDomElements();
    this._setupEventListeners();
  }

  _initializeLayout() {
    this.shadowRoot.innerHTML = `
      <style>
        :host { display:flex; flex-direction:column; width:100%; }
        .file-type-section { display:flex; flex-direction:column; padding:10px 0; }
        .file-type-section .title {
          display:flex; align-items:center; font-size:1.2rem; font-weight:400;
          text-transform:uppercase; color: var(--palette-text-secondary);
          border-bottom:2px solid var(--palette-divider); width:100%; user-select:none; padding-bottom:5px;
        }
        .file-type-section .title iron-icon { height:32px; width:32px; user-select:none; margin-left:5px; }
        .file-type-section .title paper-checkbox {
          margin-right:5px;
          --paper-checkbox-checked-color: var(--primary-color);
          --paper-checkbox-unchecked-color: var(--palette-action-disabled);
        }
        .file-type-section .title span { font-weight:400; font-size:1rem; flex-grow:1; padding-left:5px; }
        .file-type-section .content {
          display:flex; flex-wrap:wrap; margin:16px 0; justify-content:flex-start; gap:10px;
        }
        .playlist-actions { display:flex; align-items:center; gap:8px; }
        .playlist-actions iron-icon { height:24px; width:24px; cursor:pointer; fill: var(--palette-text-secondary); }
        .playlist-actions iron-icon:hover { fill: var(--primary-color); }
      </style>

      <div class="file-type-section">
        <div class="title">
          <paper-checkbox id="select-all-checkbox"></paper-checkbox>
          <iron-icon id="section-type-icon"></iron-icon>
          <span>
            ${this._fileType}
            <span id="section_count"></span>
          </span>
          <div id="playlist-actions" class="playlist-actions"></div>
        </div>
        <div class="content" id="file_section_content"><slot></slot></div>
      </div>
    `;
  }

  _cacheDomElements() {
    this._domRefs.sectionCountSpan = this.shadowRoot.querySelector("#section_count");
    this._domRefs.selectAllCheckbox = this.shadowRoot.querySelector("#select-all-checkbox");
    this._domRefs.fileSectionContent = this.shadowRoot.querySelector("#file_section_content"); // fixed
    this._domRefs.playlistActionsDiv = this.shadowRoot.querySelector("#playlist-actions");
    this._domRefs.sectionTypeIcon = this.shadowRoot.querySelector("#section-type-icon");
  }

  _setupEventListeners() {
    this._domRefs.selectAllCheckbox.addEventListener("change", this._handleSelectAllChange.bind(this));

    // Set type icon
    if (this._fileType === "audio") this._domRefs.sectionTypeIcon.icon = "av:music-note";
    else if (this._fileType === "video") this._domRefs.sectionTypeIcon.icon = "av:movie";
    else if (this._fileType === "image") this._domRefs.sectionTypeIcon.icon = "image:collections";
    else this._domRefs.sectionTypeIcon.icon = "icons:folder";
  }

  _handleSelectAllChange() {
    const isChecked = this._domRefs.selectAllCheckbox.checked;
    this.querySelectorAll("globular-file-icon-view").forEach((fileIconView) => {
      if (isChecked) fileIconView.select();
      else fileIconView.unselect();
    });
  }

  /**
   * Initialize with dir + type + parent view
   */
  init(dir, fileType, view) {
    this._dir = dir;
    this._fileType = fileType;
    this._fileExplorer = view._file_explorer_;  // keep reference (no .globule anywhere)
    this._filesListView = this._fileExplorer?._filesListView || null;
    this._filesIconView = this._fileExplorer?._filesIconView || null;

    this._setupPlaylistActions();
    this.updateCount();
  }

  /**
   * Create the actions block per section type (audio/video)
   */
  _setupPlaylistActions() {
    const isAudio = this._fileType === "audio";
    const isVideo = this._fileType === "video";

    if (!isAudio && !isVideo) {
      this._domRefs.playlistActionsDiv.innerHTML = "";
      return;
    }

    this._domRefs.playlistActionsDiv.innerHTML = `
      ${isAudio ? "" : '<globular-watching-menu style="padding:0;height:24px;width:24px;"></globular-watching-menu>'}
      <iron-icon id="refresh-btn" icon="icons:refresh" title="Refresh ${this._fileType} infos and playlist"></iron-icon>
      <iron-icon id="download-btn" icon="av:playlist-add-check" title="Download new ${this._fileType} from channel" style="display:none;"></iron-icon>
      <iron-icon id="play-btn" icon="${isAudio ? "av:queue-music" : "av:playlist-play"}" title="Play ${this._fileType} files"></iron-icon>
      <iron-icon id="copy-playlist-lnk-btn" icon="icons:link" title="Copy playlist URL"></iron-icon>
    `;

    const refreshBtn = this.shadowRoot.querySelector("#refresh-btn");
    const downloadBtn = this.shadowRoot.querySelector("#download-btn");
    const playBtn = this.shadowRoot.querySelector("#play-btn");
    const copyLnkBtn = this.shadowRoot.querySelector("#copy-playlist-lnk-btn");
    const watchingMenu = this.shadowRoot.querySelector("globular-watching-menu");

    let playlist = null;

    // Load playlist.json via HTTP
    this._loadPlaylistJson().then((loaded) => {
      playlist = loaded;
      if (playlist && downloadBtn) downloadBtn.style.display = "block";
    });

    refreshBtn?.addEventListener("click", this._handleRefreshMedia.bind(this));
    downloadBtn?.addEventListener("click", () => this._handleDownloadMedia(playlist));
    playBtn?.addEventListener("click", this._handlePlayAllMedia.bind(this));
    copyLnkBtn?.addEventListener("click", () => this._handleCopyPlaylistLink(playlist));

    watchingMenu?.addEventListener("open-media-watching", (evt) => {
      this._fileExplorer?.openMediaWatching?.(evt.detail.mediaWatching);
    });
  }

  /**
   * Fetch .hidden/playlist.json (no gRPC; simple HTTP)
   */
  async _loadPlaylistJson() {
    const filePath = `${this._dir.getPath()}/.hidden/playlist.json`;
    try {
      const resp = await fetch(buildFileHttpUrl(filePath), { credentials: "include" });
      if (!resp.ok) return null; // missing file is fine
      return await resp.json();
    } catch (e) {
      console.warn("Failed to load playlist.json:", e);
      return null;
    }
  }

  /**
   * Ask backend to (re)process media metadata for this dir.
   * Wire this to your new media wrapper if available.
   */
  async _handleRefreshMedia() {
    try {
      // If you have a media service wrapper, call it here.
      // Otherwise, publish an app-level event your backend listens to:
      Backend.eventHub.publish(
        "__refresh_media_request__",
        { path: this._dir.getPath(), type: this._fileType },
        true
      );

      displayMessage(`${this._fileType} playlist refresh requested.`, 2500);
      // Optionally poll/refresh UI:
      this._fileExplorer?._refreshCurrentDirectory?.();
    } catch (err) {
      displayError(`Failed to refresh ${this._fileType} information: ${err?.message || err}`, 3000);
      console.error(err);
    }
  }

  /**
   * Start a channel download based on playlist.json (if present).
   * Emits progress to the same uploader events your UI already consumes.
   */
  async _handleDownloadMedia(playlist) {
    if (!playlist) {
      displayMessage("No playlist information found to download media.", 3000);
      return;
    }

    try {
      // Publish a high-level intent; your new download worker should react to it.
      Backend.eventHub.publish(
        "__download_media_from_channel__",
        {
          path: playlist.path,
          url: playlist.url,
          format: playlist.format,
          dir: this._dir.getPath(),
          type: this._fileType,
        },
        true
      );

      displayMessage(`Started ${this._fileType} download from channel…`, 3000);
      // Optionally refresh once your worker signals completion
    } catch (e) {
      displayError(`Failed to initiate download: ${e?.message || e}`, 3000);
      console.error(e);
    }
  }

  /**
   * Build a shareable playlist URL (uses base URL, optional token if available)
   */
  async _buildPlaylistCopyUrl(playlist) {
    let playlistPath =
      this._dir.__videoPlaylist__?.getPath() ||
      this._dir.__audioPlaylist__?.getPath();

    if (!playlistPath && this._fileType === "video") {
      const hls = this._dir.getFilesList().find((f) => f.getMime() === "video/hls-stream");
      if (hls) playlistPath = `${hls.getPath()}/playlist.m3u8`;
    }
    if (!playlistPath) return "";

    let url = buildFileHttpUrl(playlistPath);
    const token = await tryGetAccessToken();
    if (token) {
      url += (url.includes("?") ? "&" : "?") + `token=${encodeURIComponent(token)}`;
    }

    const layout = document.querySelector("globular-app-layout");
    const app = layout?.getAttribute("application");
    if (app) {
      url += (url.includes("?") ? "&" : "?") + `application=${encodeURIComponent(app)}`;
    }
    return url;
  }

  async _handleCopyPlaylistLink(playlist) {
    const url = await this._buildPlaylistCopyUrl(playlist);
    if (url) {
      copyToClipboard(url);
      displayMessage("URL was copied to clipboard.", 3000);
    } else {
      displayMessage("No valid playlist URL found to copy.", 3000);
    }
  }

  /**
   * Play all media in this section (uses your existing play helpers)
   */
  _handlePlayAllMedia() {
    const filesToPlay = [];
    this._dir.getFilesList().forEach((f) => {
      if (!f.getMime().startsWith(this._fileType)) return;
      if (this._fileType === "video" && f.videos) filesToPlay.push(...f.videos);
      else if (this._fileType === "audio" && f.audios) filesToPlay.push(...f.audios);
      else if (f.titles) filesToPlay.push(...f.titles);
    });

    if (filesToPlay.length > 0) {
      if (this._fileType === "video") playVideos(filesToPlay, this._dir.getName());
      else if (this._fileType === "audio") playAudios(filesToPlay, this._dir.getName());
    } else {
      displayMessage(`No ${this._fileType} information found to generate a playlist.`, 3000);
    }
  }

  updateCount() {
    const n = this.querySelectorAll("globular-file-icon-view").length;
    this._domRefs.sectionCountSpan.textContent = ` (${n})`;
  }
}

customElements.define("globular-file-icon-view-section", FileIconViewSection);
