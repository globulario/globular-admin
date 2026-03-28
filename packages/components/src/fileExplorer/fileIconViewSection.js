// src/components/fileIconViewSection.js

import { Backend } from "@globular/sdk";
import { displayMessage, displayError, indexFile } from "@globular/sdk";
import { copyToClipboard } from "../utility.js";

// ✅ Use the shared FileVM helpers (DRY)
import {
  pathOf,
  nameOf,
  filesOf,
  mimeRootOf,
  findPlaylistManifest,
} from "./filevm-helpers";

// Proper backend wrappers (no direct HTTP fetch)
import { readText } from "@globular/sdk";

// Bounded LRU cache — media metadata lives here, NOT on the file proto
import { getMediaInfo } from "./fileMediaCache.js";

import { playVideos } from "@globular/media/video.js";
import { playAudios } from "@globular/media/audio.js";
import "./fileIconView";

// ---------- small shared utilities ----------
const ICON_FOR_SECTION = {
  audio: "image:music-note",
  video: "av:movie",
  image: "image:collections",
  text: "editor:insert-drive-file",
  pdf: "image:picture-as-pdf",
  document: "editor:insert-drive-file",
  default: "icons:folder",
};

const LABEL_FOR_SECTION = {
  folder: "Folders",
  video: "Videos",
  audio: "Audio",
  image: "Images",
  text: "Documents",
  pdf: "PDF",
  document: "Documents",
  other: "Other",
};

function buildFileHttpUrl(path) {
  // Build a stable absolute URL to the file path served by your backend's file HTTP server.
  const base = (window.location && window.location.origin)
    ? window.location.origin.replace(/\/$/, "")
    : "";
  const normalized = (path || "").startsWith("/") ? path : `/${path || ""}`;
  return `${base}${normalized}`;
}

async function tryGetAccessToken() {
  try {
    if (typeof Backend.getAccessToken === "function") {
      return await Backend.getAccessToken();
    }
  } catch (_) { }
  return undefined;
}

export class FileIconViewSection extends HTMLElement {
  _fileType = "";
  _dir = null;            // DirVM-like: { path, files }
  _fileExplorer = null;   // main FileExplorer
  _filesListView = null;
  _filesIconView = null;

  _dom = {};

  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._fileType = this.getAttribute("filetype") || "";
    this.shadowRoot.innerHTML = this._template();
    this._cacheDom();
    this._wireBasics();
  }

  /** ---------- lifecycle / init ---------- */
  init(dirVM, fileType, view) {
    this._dir = dirVM;
    this._fileType = fileType;
    this._fileExplorer = view?._fileExplorer || view || null;
    this._filesListView = this._fileExplorer?._filesListView || null;
    this._filesIconView = this._fileExplorer?._filesIconView || null;

    this._setSectionIcon(this._fileType);
    this._updateSectionLabel();
    this._setupPlaylistActions();
    this.updateCount();
  }

  updateCount() {
    const n = this.shadowRoot.querySelectorAll("globular-file-icon-view").length
      || this.querySelectorAll("globular-file-icon-view").length;
    this._dom.sectionCountSpan.textContent = ` (${n})`;
  }

  /** ---------- template / dom ---------- */
  _template() {
    return `
    <style>
      :host {
        display:flex;
        flex-direction:column;
        width:100%;
      }

      /* ShadyCSS-friendly: NO nested var() here */
      paper-checkbox {
        --paper-checkbox-unchecked-color: rgba(255,255,255,.25);
        --paper-checkbox-checked-color: #4dabf7;
        --paper-checkbox-checkmark-color: #fff;
        --paper-checkbox-label-color: inherit;
        margin-right: 6px;
      }

      iron-icon {
        fill: var(--on-surface-color, black);
      }

      .file-type-section {
        display:flex;
        flex-direction:column;
        padding:10px 0;
      }

      .file-type-section .title {
        display:flex;
        align-items:center;
        font-size:.75rem;
        font-weight:600;
        text-transform:uppercase;
        letter-spacing:.04em;
        width:100%;
        user-select:none;
        padding:4px 8px;
        box-sizing:border-box;

        background: color-mix(in srgb, var(--on-surface-color) 5%, var(--surface-color));
        color: var(--secondary-text-color, var(--palette-text-secondary));
        border-bottom: 1px solid color-mix(in srgb, var(--palette-divider) 50%, transparent);
        border-radius: 4px 4px 0 0;
      }

      .file-type-section .title iron-icon {
        user-select:none;
        height: 18px;
        width: 18px;
        opacity: .7;
      }

      .file-type-section .title span {
        font-weight:600;
        font-size:.75rem;
        flex-grow:1;
        padding-left:5px;
        color: var(--secondary-text-color);
      }

      .file-type-section .content {
        display:flex;
        flex-wrap:wrap;
        margin:16px 0;
        justify-content:flex-start;
        gap:10px;
        background-color: var(--surface-alt-color, transparent);
      }

      .playlist-actions {
        display:flex;
        align-items:center;
        gap:8px;
        background-color: var(--surface-color);
        z-index:1000;
      }

      .playlist-actions iron-icon {
        height:18px;
        width:18px;
        cursor:pointer;
        fill: var(--secondary-text-color, var(--palette-text-secondary));
        opacity: .5;
        transition: opacity .2s;
      }

      .playlist-actions iron-icon:hover {
        fill: var(--accent-color);
        opacity: 1;
      }
    </style>

    <div class="file-type-section">
      <div class="title">
        <paper-checkbox id="select-all-checkbox"></paper-checkbox>
        <iron-icon id="section-type-icon"></iron-icon>
        <span>
          ${LABEL_FOR_SECTION[this._fileType] || this._fileType}
          <span id="section_count"></span>
        </span>
        <div id="playlist-actions" class="playlist-actions"></div>
      </div>
      <div class="content" id="file_section_content"><slot></slot></div>
    </div>
  `;
  }


  _cacheDom() {
    const $ = (s) => this.shadowRoot.querySelector(s);
    this._dom.sectionCountSpan = $("#section_count");
    this._dom.selectAllCheckbox = $("#select-all-checkbox");
    this._dom.fileSectionContent = $("#file_section_content");
    this._dom.playlistActionsDiv = $("#playlist-actions");
    this._dom.sectionTypeIcon = $("#section-type-icon");
  }

  _updateSectionLabel() {
    const labelSpan = this.shadowRoot.querySelector(".title > span");
    if (labelSpan) {
      const label = LABEL_FOR_SECTION[this._fileType] || this._fileType;
      labelSpan.innerHTML = `${label} <span id="section_count"></span>`;
      this._dom.sectionCountSpan = this.shadowRoot.querySelector("#section_count");
    }
  }

  _wireBasics() {
    this._dom.selectAllCheckbox.addEventListener("change", () => {
      const isChecked = this._dom.selectAllCheckbox.checked;
      // Select / unselect every file icon child in this section
      const nodes = this.shadowRoot.querySelectorAll("globular-file-icon-view");
      const fallbacks = this.querySelectorAll("globular-file-icon-view");
      const list = nodes.length ? nodes : fallbacks;
      list.forEach((v) => (isChecked ? v.select() : v.unselect()));
    });
    this._setSectionIcon(this._fileType);
  }

  _setSectionIcon(type) {
    this._dom.sectionTypeIcon.icon =
      ICON_FOR_SECTION[type] || ICON_FOR_SECTION.default;
  }

  /** ---------- playlist / section actions ---------- */
  _setupPlaylistActions() {
    const isAudio = this._fileType === "audio";
    const isVideo = this._fileType === "video";
    const isIndexable = this._fileType === "text" || this._fileType === "pdf" || this._fileType === "document";

    if (!isAudio && !isVideo && !isIndexable) {
      this._dom.playlistActionsDiv.innerHTML = "";
      return;
    }

    if (isIndexable) {
      this._dom.playlistActionsDiv.innerHTML = `
        <iron-icon id="reindex-btn" icon="icons:refresh" title="Index ${this._fileType} files for search"></iron-icon>
      `;
      const reindexBtn = this.shadowRoot.querySelector("#reindex-btn");
      reindexBtn?.addEventListener("click", () => this._handleReindexFiles());
      return;
    }

    this._dom.playlistActionsDiv.innerHTML = `
      <iron-icon id="refresh-btn" icon="icons:refresh" title="Refresh ${this._fileType} infos and playlist"></iron-icon>
      <iron-icon id="download-btn" icon="av:playlist-add-check" title="Download new ${this._fileType} from channel" style="display:none;"></iron-icon>
      <iron-icon id="play-btn" icon="${isAudio ? "av:queue-music" : "av:playlist-play"}" title="Play ${this._fileType} files"></iron-icon>
      <iron-icon id="copy-playlist-lnk-btn" icon="icons:link" title="Copy playlist URL"></iron-icon>
    `;

    const refreshBtn = this.shadowRoot.querySelector("#refresh-btn");
    const downloadBtn = this.shadowRoot.querySelector("#download-btn");
    const playBtn = this.shadowRoot.querySelector("#play-btn");
    const copyLnkBtn = this.shadowRoot.querySelector("#copy-playlist-lnk-btn");

    let playlist = null;

    // ✅ Load .hidden/playlist.json via backend (no HTTP fetch)
    this._loadPlaylistJsonBackend().then((loaded) => {
      playlist = loaded;
      if (playlist && downloadBtn) downloadBtn.style.display = "block";
    });

    refreshBtn?.addEventListener("click", () => this._handleRefreshMedia());
    downloadBtn?.addEventListener("click", () => this._handleDownloadMedia(playlist));
    playBtn?.addEventListener("click", () => this._handlePlayAllMedia());

  }

  // DRY: one loader that uses backend wrappers
  async _loadPlaylistJsonBackend() {
    const filePath = `${pathOf(this._dir)}/.hidden/playlist.json`;
    try {
      // We only need the raw content; `readText` already takes a path string.
      const text = await readText(filePath);
      if (!text) return null;
      return JSON.parse(text);
    } catch (e) {
      // missing file is fine
      return null;
    }
  }

  async _handleReindexFiles() {
    const dirPath = pathOf(this._dir);
    if (!dirPath) {
      displayMessage("No directory path available for indexing.", 3000);
      return;
    }

    const reindexBtn = this.shadowRoot.querySelector("#reindex-btn");
    if (reindexBtn) reindexBtn.style.pointerEvents = "none";

    displayMessage(`Indexing ${this._fileType} files in ${dirPath}...`, 3000);

    try {
      let lastMsg = "";
      await indexFile(dirPath, { recursive: false, force: true }, (p) => {
        lastMsg = `${p.indexed}/${p.total}: ${p.path.split("/").pop()} (${p.status})`;
      });
      displayMessage(`Indexing complete! ${lastMsg}`, 3000);
    } catch (err) {
      displayError(`Indexing failed: ${err?.message || err}`, 5000);
    } finally {
      if (reindexBtn) reindexBtn.style.pointerEvents = "";
    }
  }

  async _handleRefreshMedia() {
    try {
      Backend.eventHub.publish(
        "__refresh_media_request__",
        { path: pathOf(this._dir), type: this._fileType },
        true
      );
      displayMessage(`${this._fileType} playlist refresh requested.`, 2500);

      // Use the same mechanism your FileExplorer uses to refresh the directory
      Backend.eventHub.publish("reload_dir_event", pathOf(this._dir), true);
    } catch (err) {
      displayError(`Failed to refresh ${this._fileType} information: ${err?.message || err}`, 3000);
      console.error(err);
    }
  }

  async _handleDownloadMedia(playlist) {
    if (!playlist) {
      displayMessage("No playlist information found to download media.", 3000);
      return;
    }
    try {
      Backend.eventHub.publish(
        "__download_media_from_channel__",
        {
          path: playlist.path,
          url: playlist.url,
          format: playlist.format,
          dir: pathOf(this._dir),
          type: this._fileType,
        },
        true
      );
      displayMessage(`Started ${this._fileType} download from channel…`, 3000);
    } catch (e) {
      displayError(`Failed to initiate download: ${e?.message || e}`, 3000);
      console.error(e);
    }
  }



  _handlePlayAllMedia() {
    const files = filesOf(this._dir) || [];
    const wantedRoot = this._fileType; // "video" | "audio" | "image" | etc.

    // Collect media objects for playback.
    // Media metadata lives in the LRU cache (fileMediaCache), not on the file
    // proto — always read from cache first, fall back to proto for legacy data.
    const toPlay = [];
    for (const f of files) {
      const mime = (f?.mime || "").toLowerCase();
      const playlistTarget = wantedRoot === "video" ? findPlaylistManifest(f) : null;
      if (playlistTarget) {
        toPlay.push(playlistTarget);
        continue;
      }
      if (mime.startsWith(wantedRoot)) {
        const cached = getMediaInfo(pathOf(f)) ?? {};
        const videos = cached.videos?.length ? cached.videos : (f.videos ?? []);
        const audios = cached.audios?.length ? cached.audios : (f.audios ?? []);
        const titles = cached.titles?.length ? cached.titles : (f.titles ?? []);

        if (wantedRoot === "video" && videos.length) toPlay.push(...videos);
        else if (wantedRoot === "audio" && audios.length) toPlay.push(...audios);
        else if (titles.length) toPlay.push(...titles);
      }
    }

    if (toPlay.length > 0) {
      const listName = nameOf(this._dir) || (pathOf(this._dir)?.split("/").pop() || "Playlist");
      if (wantedRoot === "video") playVideos(toPlay, listName);
      else if (wantedRoot === "audio") playAudios(toPlay, listName);
    } else {
      displayMessage(`No ${wantedRoot} information found to generate a playlist.`, 3000);
    }
  }
}

customElements.define("globular-file-icon-view-section", FileIconViewSection);
