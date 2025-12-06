import getUuidByString from "uuid-by-string";
import { displayError, displaySuccess, displayMessage } from "@globular/backend";

import '@polymer/iron-icons/editor-icons.js';
import '@polymer/iron-icon/iron-icon.js';
import '@polymer/paper-button/paper-button.js';
import '@polymer/paper-progress/paper-progress.js';
import '@polymer/paper-tabs/paper-tabs.js';
import '@polymer/paper-tabs/paper-tab.js';

import { VideoPreview } from "../fileExplorer/videoPreview";
import { TitleInfoEditor } from "./titleInformationsEditor";
import { PersonEditor } from "./personEditor";
import "./castPersonPanel.js";
import { randomUUID } from "../utility";
import { playAudio } from "../audio";
import { playVideo } from "../video";

// ✅ Backend wrappers
import { getFile } from "@globular/backend";
import {
  deleteTitle,
  dissociateFileWithTitle,
  getTitleFiles,
  getTitleInfo,
  invalidateFileCaches,
  invalidateTitleCache,
  refreshTitleMetadata,
  searchTitles,
  updateTitleMetadata
} from "@globular/backend";
import { Backend } from "@globular/backend";
import { getToken } from "@globular/backend";

/* =========================================================
 * Utilities
 * =======================================================*/

/**
 * Promisified wrapper for file metadata/thumbnail lookup.
 * Uses new backend/files.getFile wrapper (signature-tolerant).
 */
async function promisifiedGetFile(path) {
  return getFile(path);
}

/**
 * Create a <globular-video-preview> + filename label for a path.
 */
async function createVideoPreviewComponent(parentElement, filePath, titleId) {
  const previewDivId = `_video_preview_${getUuidByString(filePath)}`;
  let existingPreviewDiv = parentElement.querySelector(`#${previewDivId}`);
  if (existingPreviewDiv) return existingPreviewDiv;

  try {
    const file = await promisifiedGetFile(filePath);

    const preview = new VideoPreview();
    preview.setFile(file, 64);

    preview.name = titleId;
    preview.setOnPreview(() => {
      parentElement.querySelectorAll("globular-video-preview").forEach(p => {
        if (preview.name !== p.name && p.stopPreview) p.stopPreview();
      });
    });

    const previewDiv = document.createElement("div");
    previewDiv.id = previewDivId;
    previewDiv.classList.add("title-file-item");
    previewDiv.appendChild(preview);

    const fileNameSpan = document.createElement("span");
    fileNameSpan.classList.add("title-file-name");
    fileNameSpan.textContent = filePath.substring(filePath.lastIndexOf("/") + 1);
    previewDiv.appendChild(fileNameSpan);

    const unlinkBtnId = `_unlink_btn_${randomUUID()}`;
    const unlinkBtn = document.createElement("paper-icon-button");
    unlinkBtn.setAttribute("icon", "icons:remove-circle");
    unlinkBtn.id = unlinkBtnId;
    unlinkBtn.setAttribute("aria-label", "Dissociate file");
    unlinkBtn.classList.add("title-file-unlink");
    previewDiv.appendChild(unlinkBtn);

    const updateLabelWidth = () => {
      const width = Math.max(96, preview.width || 96);
      fileNameSpan.style.maxWidth = `${width + 16}px`;
    };
    preview.setOnResize(updateLabelWidth);
    updateLabelWidth();

    unlinkBtn.addEventListener('click', async (evt) => {
      evt.stopPropagation();
      await showDissociateFileConfirmation(filePath, titleId, previewDiv);
    });

    preview.setOnPlay(async (f) => {
      const path = f.getPath();
      const mime = f.getMime();

      let mediaPlayer = null;
      if (path.endsWith(".mp3") || (mime && mime.startsWith("audio"))) {
        mediaPlayer = playAudio(path, () => { }, null, null);
      } else if (mime && mime.startsWith("video")) {
        mediaPlayer = playVideo(path, () => { }, null, null);
      }

      if (mediaPlayer && mediaPlayer.toggleFullscreen) {
        mediaPlayer.toggleFullscreen();
      }

      const titleInfoBox = document.getElementById("title-info-box");
      if (titleInfoBox && titleInfoBox.parentNode) {
        titleInfoBox.parentNode.removeChild(titleInfoBox);
      }
    });

    return previewDiv;
  } catch (err) {
    displayError(`Failed to create video preview for ${filePath}: ${err.message}`, 3000);
    throw err;
  }
}

/**
 * Dissociate a file from a title with a confirmation toast (uses backend wrapper).
 */
async function showDissociateFileConfirmation(filePath, titleId, previewDiv) {
  const fileName = filePath.substring(filePath.lastIndexOf("/") + 1);
  const toast = displayMessage(`
    <style>
      #dissociate-file-dialog { display: flex; flex-direction: column; align-items: center; }
      #dissociate-file-dialog p { font-style: italic; max-width: 300px; text-align: center; margin-bottom: 10px; }
      #dissociate-file-dialog .dialog-actions { display: flex; justify-content: flex-end; gap: 10px; width: 100%; margin-top: 20px; }
    </style>
    <div id="dissociate-file-dialog">
      <div>You are about to delete file association for:</div>
      <p id="file-name">${fileName}</p>
      <div>Is that what you want to do?</div>
      <div class="dialog-actions">
        <paper-button id="dialog-cancel-btn">Cancel</paper-button>
        <paper-button id="dialog-ok-btn">Ok</paper-button>
      </div>
    </div>
  `, 60 * 1000);

  const cancelBtn = toast.toastElement.querySelector("#dialog-cancel-btn");
  const okBtn = toast.toastElement.querySelector("#dialog-ok-btn");

  cancelBtn.addEventListener('click', () => toast.hideToast());
  okBtn.addEventListener('click', async () => {
    toast.hideToast();
    try {
      // Heuristic preserved: titles vs videos index
      const indexPath = titleId.startsWith("tt") ? "/search/titles" : "/search/videos";
      await dissociateFileWithTitle(filePath, titleId, indexPath);

      if (previewDiv && previewDiv.parentNode) {
        previewDiv.parentNode.removeChild(previewDiv);
      }
      displayMessage("File association was deleted!", 3000);
    } catch (err) {
      displayError(`Failed to dissociate file: ${err.message}`, 3000);
    }
  });
}

/**
 * Get associated file paths for a title using backend wrapper.
 */
export async function getTitleFilePaths(title, indexPath = "/search/titles") {
  if (!title) {
    throw new Error("Missing title for getTitleFilePaths.");
  }
  try {
    const paths = await getTitleFiles(title.getId(), indexPath);
    return paths || [];
  } catch (err) {
    displayError(`Failed to get files for title ${title.getId()}: ${err.message}`, 3000);
    throw err;
  }
}

/**
 * Stream search via backend wrapper and collect TVEpisode results.
 */
async function searchEpisodesBySerie(serieId, indexPath = "/search/titles") {
  const episodes = [];
  try {
    const res = await searchTitles(serieId, indexPath, [], 1000, 0);
    const hits = (res && res.hits) ? res.hits : [];
    hits.forEach(h => {
      if (h && h.getTitle && h.getTitle()) {
        const t = h.getTitle();
        if (t.getType && t.getType() === "TVEpisode" && t.getSerie && t.getSerie() === serieId) {
          episodes.push(t);
        }
      }
    });

    episodes.sort((a, b) => {
      if (a.getSeason() === b.getSeason()) {
        return a.getEpisode() - b.getEpisode();
      }
      return a.getSeason() - b.getSeason();
    });
    return episodes;
  } catch (err) {
    displayError(`Failed to search episodes: ${err.message}`, 3000);
    throw err;
  }
}

/* =========================================================
 * Public helpers used by other UI bits
 * =======================================================*/

/**
 * Render previews for a title’s files.
 */
export async function GetTitleFiles(indexPath = "/search/titles", title, parentElement) {
  if (!title || !indexPath) {
    throw new Error("Missing title or index path for GetTitleFiles.");
  }
  parentElement.innerHTML = '<paper-progress indeterminate></paper-progress>';

  try {
    const filePaths = await getTitleFilePaths(title, indexPath);
    parentElement.innerHTML = '';

    const previews = await Promise.all(
      filePaths.map(filePath =>
        createVideoPreviewComponent(parentElement, filePath, title.getId())
      )
    );

    previews.forEach(p => parentElement.appendChild(p));
    return previews;
  } catch (err) {
    displayError(`Failed to load title files: ${err.message}`, 3000);
    parentElement.innerHTML = '<p>Failed to load associated files.</p>';
    return [];
  }
}

/**
 * Cache + aggregate episodes across all globules.
 */
export async function GetEpisodes(indexPath = "/search/titles", title) {
  if (title.__episodes__ !== undefined) return title.__episodes__;

  const episodes = await searchEpisodesBySerie(title.getId(), indexPath);

  // Deduplicate by id
  const uniqueEpisodes = [...new Map(episodes.map(e => [e.getId(), e])).values()];

  // Sort global list
  uniqueEpisodes.sort((a, b) => {
    if (a.getSeason() === b.getSeason()) {
      return a.getEpisode() - b.getEpisode();
    }
    return a.getSeason() - b.getSeason();
  });

  title.__episodes__ = uniqueEpisodes;
  return uniqueEpisodes;
}

export async function searchEpisodes(serieId, indexPath = "/search/titles") {
  return GetEpisodes(indexPath, { getId: () => serieId, __episodes__: undefined });
}

/* =========================================================
 * Web Component
 * =======================================================*/

const TITLE_INFO_GLOBAL_STYLE = `
:host {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.title-div {
  display: flex;
  gap: 20px;
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
}

.title-poster-div {
  padding-right: 20px;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.title-informations-div {
  font-size: 1em;
  min-width: 350px;
  max-width: 450px;
  max-height: 600px;
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.title-poster-div img, p { }

.title-genre-span {
  border: 1px solid var(--palette-divider);
  padding: 1px 5px;
  margin-right: 5px;
  user-select: none;
  border-radius: 4px;
  background-color: var(--surface-color-dark, var(--surface-elevated-color));
}

.rating-star {
  --iron-icon-fill-color: rgb(245, 197, 24);
  padding-right: 10px;
  height: 30px;
  width: 30px;
}

.title-rating-div {
  display: flex;
  align-items: center;
  color: var(--secondary-text-color);
  font-size: 1rem;
  margin-top: 10px;
}

#rating-span {
  font-weight: 600;
  font-size: 1.2rem;
  color: var(--primary-text-color);
  user-select: none;
}

.title-genres-div {
  padding: 5px;
  display: flex;
  flex-wrap: wrap;
  font-size: .9rem;
  gap: 5px;
}

.title-credit {
  flex-grow: 1;
  color: var(--primary-text-color);
  border-bottom: 1px solid var(--palette-divider);
  width: 100%;
  margin-bottom: 10px;
  padding-bottom: 5px;
}
.title-credit:last-of-type { border-bottom: none; }

.title-files-div {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  padding: 0 15px 10px;
  margin-top: 15px;
  align-items: flex-start;
}
.title-files-div paper-progress {
  width: 100%;
}
.title-file-item {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-start;
  flex: 0 0 100px;
  gap: 8px;
  padding: 10px 8px 12px;
  border: 1px solid var(--divider-color, rgba(255, 255, 255, 0.08));
  background: var(--surface-color);
  border-radius: 10px;
  min-height: 120px;
  line-break: anywhere;
  overflow: hidden;
}
.title-file-item globular-video-preview {
  width: 100%;
  margin-top: 2px;
  border-radius: 6px;
  overflow: hidden;
}
.title-file-item paper-icon-button {
  position: absolute;
  top: 6px;
  right: 6px;
  z-index: 10;
  width: 28px;
  height: 28px;
  padding: 0;
  --paper-icon-button-ink-color: #fff;
  background: rgba(0, 0, 0, 0.6);
  border-radius: 50%;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.4);
}
.title-file-name {
  font-size: .75rem;
  color: var(--primary-text-color);
  text-align: center;
  width: 100%;
  white-space: normal;
  overflow: hidden;
  text-overflow: ellipsis;
  display: block;
  line-height: 1.15em;
  max-height: 3.45em;
  word-break: break-word;
}

.title-top-credit, .title-credit {
  margin-top: 15px;
  display: flex;
  flex-direction: column;
}

.title-credit-title {
  font-weight: 500;
  font-size: 1.1rem;
  color: var(--primary-text-color);
  margin-bottom: 5px;
}

.title-credit-lst {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}
.title-credit-lst a {
  color: var(--palette-action-active);
  font-size: 1rem;
  text-decoration: none;
  white-space: nowrap;
}
.title-credit-lst a:hover {
  text-decoration: underline;
  cursor: pointer;
}

@media only screen and (max-width: 600px) {
  .title-div {
    flex-direction: column;
    max-height: calc(100vh - 300px);
    overflow-y: auto; overflow-x: hidden;
  }
  .title-poster-div {
    display: flex; justify-content: center; margin-bottom: 20px;
    flex-direction: column; width: 100%; padding-right: 0;
  }
  .title-poster-img {
    max-width: 256px; max-height: 256px; width: auto; height: auto;
  }
  .title-files-div { justify-content: center; padding-left: 0; }
  .title-informations-div { min-width: unset; max-width: 100%; }
}

.episodes-div {
  display: flex; flex-direction: column; width: 100%; height: 100%; min-height: 0;
}
.episodes-header-tabs paper-tabs {
  --paper-tabs-selection-bar-color: var(--primary-color);
  color: var(--primary-text-color);
  --paper-tab-ink: var(--palette-action-disabled);
  width: 100%;
}
.season-page-div {
  display: flex;
  flex-wrap: wrap;
  gap: 25px;
  padding: 8px 0;
  justify-content: center;
  overflow-y: auto;
}
.season-page-div::-webkit-scrollbar {
  height: 6px;
}
.season-page-div::-webkit-scrollbar-thumb {
  background: var(--palette-divider);
  border-radius: 3px;
}
.episode-small-div {
  display: flex;
  flex-direction: column;
  position: relative;
  width: 125px;
  min-width: 125px;
  border-radius: 8px;
  overflow: hidden;
  box-shadow: var(--shadow-elevation-2dp);
  transition: box-shadow 0.2s ease;
}
.episode-small-div:hover { box-shadow: var(--shadow-elevation-4dp); cursor: pointer; }
.episode-small-div img {
  width: 100%;
  height: 150px;
  object-fit: cover;
  display: block;
}
.episode-number-badge {
  position: absolute; top: 8px; right: 8px;
  background-color: color-mix(in srgb, var(--surface-color-dark, #000) 90%, transparent);
  color: var(--on-primary-color);
  font-weight: 600; font-size: 1.1rem; padding: 4px 8px; border-radius: 4px;
}
.play-episode-button {
  position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
  color: rgb(0, 179, 255); font-size: 48px; opacity: 0; transition: opacity 0.2s ease;
  width: 48px; height: 48px; --iron-icon-width:48px; --iron-icon-height:48px;
}
.episode-small-div:hover .play-episode-button { opacity: 1; }
.slide-on-panel {
  color: var(--on-primary-color); position: absolute; bottom: 0; left: 0; right: 0;
  background: color-mix(in srgb, var(--surface-color-dark, #000) 85%, transparent); padding: 8px;
  border-top: 1px solid color-mix(in srgb, var(--surface-color-dark, #000) 70%, transparent);
  display: flex; align-items: center; transform: translateY(100%); transition: transform 0.3s ease;
}
.episode-small-div:hover .slide-on-panel { transform: translateY(0); }
.slide-on-panel-title-name {
  flex-grow: 1; font-size: .9rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.info-episode-button {
  color: var(--on-surface-color);
  margin-left: 8px;
  background: rgba(0, 0, 0, 0.3);
  border-radius: 50%;
  padding: 4px;
  /* set the size of the icon button */
  height:30px;
  width:30px;
  --iron-icon-width:20px;
  --iron-icon-height:20px;
  --paper-icon-button-ink-color: var(--on-surface-color);
}
`;

export class TitleInfo extends HTMLElement {
  // Data
  _title = null;
  _isShortMode = false;
  _ondelete = null;
  _listeners = {};
  _refreshing = false;

  // DOM refs
  _titleDivContainer = null;
  _titleHeaderDiv = null;
  _posterImg = null;
  _filesProgress = null;
  _genresDiv = null;
  _synopsisDiv = null;
  _ratingSpan = null;
  _ratingTotalDiv = null;
  _directorsListDiv = null;
  _writersListDiv = null;
  _actorsListDiv = null;
  _filesDiv = null;
  _episodesDiv = null;
  _editButton = null;
  _deleteButton = null;

  static get observedAttributes() { return ['short']; }

  /**
   * @param {HTMLElement} titleHeaderDiv
   * @param {boolean} isShort
   */
  constructor(titleHeaderDiv, isShort) {
    super();
    this.attachShadow({ mode: 'open' });

    this._titleHeaderDiv = titleHeaderDiv;
    this._isShortMode = isShort;

    this._renderInitialStructure();
    this._getDomReferences();
    this._bindEventListeners();
  }

  connectedCallback() {
    this._setupBackendSubscriptions();
    
  }

  disconnectedCallback() {
    this._clearSubscriptions();
  }

  attributeChangedCallback(name, _oldValue, newValue) {
    if (name === 'short') {
      const newIsShort = newValue === 'true';
      if (this._isShortMode !== newIsShort) {
        this._isShortMode = newIsShort;
        this._renderTitleSpecificContent();
      }
    }
  }

  set ondelete(callback) { this._ondelete = callback; }
  get ondelete() { return this._ondelete; }

  setTitle(title) {
    this.title = title;
  }

  set title(title) {
    if (this._title !== title) {
      this._title = title;
      this._renderTitleSpecificContent();
      this._setupBackendSubscriptions();
      if(this._title.getType() === "TVSeries"){
        this._episodesContainerDiv.style.display = "block";
      } else {
        this._episodesContainerDiv.style.display = "none";
      }
    }
  }
  get title() { return this._title; }

  _renderInitialStructure() {
    this.shadowRoot.innerHTML = `
      <style>
        ${TITLE_INFO_GLOBAL_STYLE}
        .title-div {
          overflow-y: auto;
          height: 100%;
          scrollbar-width: thin;
          scrollbar-color: var(--scroll-thumb, var(--palette-divider))
          var(--scroll-track, var(--surface-color));
        }
        .action-div {
          display: flex; justify-content: flex-end; gap: 10px;
          border-top: 1px solid var(--palette-divider); margin-top: 15px;
        }
        .title-info-container {
          flex: 1 1 auto;
          display: flex;
          flex-direction: row;
          height: 100%;
          min-height: 0;
          gap: 20px;
        }
        .title-poster-div {
          flex: 0 0 320px;
          min-width: 280px;
        }
        .title-poster-img {
          max-width: 300px;
          max-height: 450px;
          width: auto;
          height: auto;
        }
        #episodes-div {
          width: 50%;
          height: 100%;
   
        }
        #episodes-content{
            scrollbar-width: thin;
            scrollbar-color: var(--scroll-thumb, var(--palette-divider))
            var(--scroll-track, var(--surface-color));
        }
        @media (max-width: 1100px), (max-height: 700px) {
          .title-info-container {
            flex-direction: column;
            display: block;
          }
          #episodes-div {
            width: 100%;
            height: 30%;
            min-height: 220px;
          }
        }
        .title-synopsis-div {
          font-size: .9 rem;
          color: var(--primary-text-color);
          scrollbar-width: thin;
          scrollbar-color: var(--scroll-thumb, var(--palette-divider))
          var(--scroll-track, var(--surface-color));
        }
      </style>
      <div class="title-info-container">
        <div class="title-div">
          <div style="display: flex; flex-direction: column;">
            <div class="title-poster-div">
              <img class="title-poster-img"></img>
            </div>
            <div class="title-files-div">
              <paper-progress indeterminate></paper-progress>
            </div>
          </div>
          <div class="title-informations-div">
            <div class="title-genres-div"></div>
            <p class="title-synopsis-div"></p>
            <div class="title-rating-div">
              <iron-icon class="rating-star" icon="icons:star"></iron-icon>
              <div style="display: flex; flex-direction: column;">
                <div><span id="rating-span"></span>/10</div>
                <div id="rating-total-div"></div>
              </div>
            </div>
            <div class="title-top-credit">
              <div class="title-credit">
                <div id="title-directors-title" class="title-credit-title">Director</div>
                <div id="title-directors-lst" class="title-credit-lst"></div>
              </div>
              <div class="title-credit">
                <div id="title-writers-title" class="title-credit-title">Writer</div>
                <div id="title-writers-lst" class="title-credit-lst"></div>
              </div>
              <div class="title-credit">
                <div id="title-actors-title" class="title-credit-title">Star</div>
                <div id="title-actors-lst" class="title-credit-lst"></div>
              </div>
            </div>
          </div>
        </div>
        <div id="episodes-div" style="display: none;">
          <slot name="episodes"></slot>
        </div>
      </div>
      <div class="action-div">
        <paper-button id="edit-indexation-btn">Edit</paper-button>
        <paper-button id="delete-indexation-btn">Delete</paper-button>
      </div>
    `;
  }

  _getDomReferences() {
    this._posterImg = this.shadowRoot.querySelector(".title-poster-img");
    this._filesDiv = this.shadowRoot.querySelector(".title-files-div");
    this._filesProgress = this.shadowRoot.querySelector(".title-files-div paper-progress");
    this._genresDiv = this.shadowRoot.querySelector(".title-genres-div");
    this._synopsisDiv = this.shadowRoot.querySelector(".title-synopsis-div");
    this._ratingSpan = this.shadowRoot.querySelector("#rating-span");
    this._ratingTotalDiv = this.shadowRoot.querySelector("#rating-total-div");
    this._directorsListDiv = this.shadowRoot.querySelector("#title-directors-lst");
    this._writersListDiv = this.shadowRoot.querySelector("#title-writers-lst");
    this._actorsListDiv = this.shadowRoot.querySelector("#title-actors-lst");
    this._episodesContainerDiv = this.shadowRoot.querySelector("#episodes-div");

    this._editButton = this.shadowRoot.querySelector("#edit-indexation-btn");
    this._deleteButton = this.shadowRoot.querySelector("#delete-indexation-btn");

    this._posterDiv = this.shadowRoot.querySelector(".title-poster-div");
    this._filesDivContainer = this.shadowRoot.querySelector(".title-files-div");
    this._synopsisP = this.shadowRoot.querySelector(".title-synopsis-div");
    this._topCreditDiv = this.shadowRoot.querySelector(".title-top-credit");
    this._actionDiv = this.shadowRoot.querySelector(".action-div");
  }

  _bindEventListeners() {
    if (this._editButton) this._editButton.addEventListener('click', this._handleEditClick.bind(this));
    if (this._deleteButton) this._deleteButton.addEventListener('click', this._handleDeleteClick.bind(this));
  }

  _clearSubscriptions() {
    const hub = Backend.eventHub;
    if (!hub) return;
    for (const [evt, uuid] of Object.entries(this._listeners)) {
      hub.unsubscribe(evt, uuid);
    }
    this._listeners = {};
  }

  _setupBackendSubscriptions() {
    if (!this._title) {
      console.warn("TitleInfo: Cannot setup backend subscriptions without title.");
      return;
    }
    const hub = Backend.eventHub;
    if (!hub) return;

    const titleId = this._title.getId();

    // Clear previous
    this._clearSubscriptions();

    // Updated event — re-render (optionally refetch if you add a getTitleById wrapper later)
    hub.subscribe(
      `${titleId}_title_updated_event`,
      (uuid) => { this._listeners[`${titleId}_title_updated_event`] = uuid; },
      async (_evt) => {
        try {
          // If you later expose getTitleById in backend/media/title, you can refetch here.
          // For now, re-render current instance data.
          this._renderTitleSpecificContent();
        } catch (err) {
          displayError(`Failed to update title from event: ${err.message}`, 3000);
        }
      },
      false,
      this
    );

    // Delete event — remove from DOM & bubble callback
    hub.subscribe(
      `${titleId}_title_delete_event`,
      (uuid) => { this._listeners[`${titleId}_title_delete_event`] = uuid; },
      (_evt) => {
        if (this.parentNode) this.parentNode.removeChild(this);
        if (this._ondelete) this._ondelete();
      },
      false,
      this
    );
  }

  async _renderTitleSpecificContent() {
    if (!this._title) return;

    // Header
    if (this._titleHeaderDiv) {
      let typeText = this._title.getType();
      let yearDurationText = this._title.getYear() ? String(this._title.getYear()) : "";

      if (this._title.getType() === "TVEpisode") {
        if (this._title.getSeason() > 0 && this._title.getEpisode() > 0) {
          yearDurationText = `S${this._title.getSeason()} · E${this._title.getEpisode()}`;
          if (this._title.getYear()) yearDurationText = `${this._title.getYear()} · ${yearDurationText}`;
        }
      }
      if (this._title.getDuration && this._title.getDuration() > 0) {
        const durationMinutes = Math.floor(this._title.getDuration() / 60);
        const durationSeconds = String(this._title.getDuration() % 60).padStart(2, '0');
        yearDurationText += ` · ${durationMinutes}:${durationSeconds}min`;
      }

      this._titleHeaderDiv.innerHTML = `
        <span class="title-main-text">${this._title.getName()}</span>
        <span class="title-sub-text">${typeText} ${yearDurationText ? `&middot; ${yearDurationText}` : ''}</span>
      `;
    }

    // Poster
    const posterUrl = this._title.getPoster() ? this._title.getPoster().getContenturl() : "";
    if (this._posterImg) {
      this._posterImg.src = posterUrl;
      this._posterImg.style.display = posterUrl ? "block" : "none";
      this._posterImg.onload = () => {
        if (this._posterImg.naturalWidth && this._posterImg.naturalHeight) {
          this._posterImg.style.aspectRatio = `${this._posterImg.naturalWidth} / ${this._posterImg.naturalHeight}`;
        }
      };
    }

    // Genres, synopsis, rating
    if (this._genresDiv) {
      this._genresDiv.innerHTML = "";
      this._title.getGenresList().forEach(g => {
        const genreSpan = document.createElement("span");
        genreSpan.classList.add("title-genre-span");
        genreSpan.textContent = g;
        this._genresDiv.appendChild(genreSpan);
      });
    }
    if (this._synopsisDiv) this._synopsisDiv.textContent = this._title.getDescription();
    if (this._ratingSpan) this._ratingSpan.textContent = this._title.getRating().toFixed(1);
    if (this._ratingTotalDiv) this._ratingTotalDiv.textContent = this._title.getRatingcount();

    // People lists
    const displayPersonsList = (listDiv, persons, titleDiv, roleLabel) => {
      if (!listDiv) return;
      listDiv.innerHTML = "";
      if (persons && persons.length > 0) {
        persons.forEach(p => {
          const lnk = document.createElement("a");
          lnk.href = p.getUrl();
          lnk.textContent = p.getFullname();
          lnk.target = "_blank";
          lnk.id = `_${getUuidByString(p.getId())}`;
          lnk.addEventListener('click', (e) => {
            e.preventDefault();
            this._showCastPersonPanel(p, roleLabel);
          });
          listDiv.appendChild(lnk);
        });
        if (titleDiv) titleDiv.style.display = 'block';
      } else if (titleDiv) {
        titleDiv.style.display = 'none';
      }
    };
    displayPersonsList(this._directorsListDiv, this._title.getDirectorsList(), this.shadowRoot.querySelector("#title-directors-title"), "Director");
    displayPersonsList(this._writersListDiv, this._title.getWritersList(), this.shadowRoot.querySelector("#title-writers-title"), "Writer");
    displayPersonsList(this._actorsListDiv, this._title.getActorsList(), this.shadowRoot.querySelector("#title-actors-title"), "Actor");

    // Short mode toggles
    this._posterDiv.style.display = this._isShortMode ? "none" : "flex";
    this._filesDivContainer.style.display = this._isShortMode ? "none" : "flex";
    this._synopsisP.style.display = this._isShortMode ? "none" : "block";
    this._topCreditDiv.style.display = this._isShortMode ? "none" : "flex";
    this._actionDiv.style.display = this._isShortMode ? "none" : "flex";
    this._episodesContainerDiv.style.display = this._isShortMode ? "none" : "block";

    // Files / episodes
    if (this._filesProgress) this._filesProgress.style.display = "block";
    if (this._title.getType() === "TVSeries") {
      this._filesDiv.style.paddingLeft = "0px";
      const indexPath = "/search/titles";
      const episodes = await GetEpisodes(indexPath, this._title);
      if (this._title.onLoadEpisodes) this._title.onLoadEpisodes(episodes);
      this._displayEpisodes(episodes, this.shadowRoot.querySelector("#episodes-div"));
    } else {
      this._filesDiv.style.paddingLeft = "15px";
      await GetTitleFiles("/search/titles", this._title, this._filesDiv);
    }
    if (this._filesProgress) this._filesProgress.style.display = "none";

    await this._updateButtonVisibility();
  }

  showPersonEditor(person) {
    // Assumes PersonEditor is globally available like before
    const personEditor = new PersonEditor(person, this._title);
    personEditor.slot = this.slot;

    const parent = this.parentNode;
    if (parent) {
      parent.removeChild(this);
      parent.appendChild(personEditor);

      personEditor.onclose = () => {
        if (parent) {
          parent.removeChild(personEditor);
          parent.appendChild(this);
          this._renderTitleSpecificContent();
        }
      };
      personEditor.onremovefromcast = (_removedPerson) => {
        this._renderTitleSpecificContent();
      };
    } else {
      document.body.appendChild(personEditor);
    }
    personEditor.focus();
  }

  _showCastPersonPanel(person, roleLabel = "Cast") {
    if (!person) return;
    let panel = document.body.querySelector("globular-cast-person-panel");
    if (!panel) {
      panel = document.createElement("globular-cast-person-panel");
      document.body.appendChild(panel);
    }
    panel.setPerson(person, roleLabel, {
      onEdit: () => this.showPersonEditor(person),
    });
    panel.open();
  }

  _handleEditClick() {
    if (!this._title) return;
    const editor = new TitleInfoEditor(this._title, this);
    const parent = this.parentNode;

    if (parent) {
      parent.removeChild(this);
      parent.appendChild(editor);
      displayMessage("Edit mode enabled.", 2000);
    } else {
      displayError("Cannot open editor: Component not attached to DOM.", 3000);
    }
  }

  _handleDeleteClick() {
    if (!this._title) return;

    const toast = displayMessage(`
      <style>
        #delete-title-dialog {
          display: flex; flex-direction: column; align-items: center; padding: 15px;
        }
        #delete-title-dialog p {
          font-style: italic; max-width: 300px; text-align: center; margin-bottom: 10px;
        }
        #delete-title-dialog img {
          width: 185px; height: auto; object-fit: contain; padding-top: 10px; padding-bottom: 15px; align-self: center;
        }
        #delete-title-dialog .dialog-actions {
          display: flex; justify-content: flex-end; gap: 10px; width: 100%;
        }
      </style>
      <div id="delete-title-dialog">
        <div>You're about to delete indexation for:</div>
        <p id="title-name-display"></p>
        <img id="title-poster-display"></img>
        <div>Is that what you want to do?</div>
        <div class="dialog-actions">
          <paper-button id="delete-cancel-btn">Cancel</paper-button>
          <paper-button id="delete-ok-btn">Ok</paper-button>
        </div>
      </div>
    `, 60 * 1000);

    const dialogTitleName = toast.toastElement.querySelector("#title-name-display");
    const dialogTitlePoster = toast.toastElement.querySelector("#title-poster-display");
    const okBtn = toast.toastElement.querySelector("#delete-ok-btn");
    const cancelBtn = toast.toastElement.querySelector("#delete-cancel-btn");

    dialogTitleName.textContent = this._title.getName();
    dialogTitlePoster.src = this._title.getPoster() ? this._title.getPoster().getContenturl() : 'placeholder.png';

    cancelBtn.addEventListener('click', () => toast.hideToast());
    okBtn.addEventListener('click', async () => {
      toast.hideToast();
      if (!this._title) return;

      let associatedFilePaths = [];
      try {
        associatedFilePaths = await getTitleFilePaths(this._title, "/search/titles");
      } catch (err) {
        console.warn("TitleInfo: failed to enumerate associated files before delete", err);
      }

      try {
        await deleteTitle(this._title.getId(), "/search/titles");

        displaySuccess(`"${this._title.getName()}" was deleted!`, 3000);
        associatedFilePaths.forEach((p) => invalidateFileCaches(p));
        Backend.eventHub.publish(
          `_delete_infos_${this._title.getId()}_evt`,
          {
            filePaths: associatedFilePaths,
            infoType: "title",
          },
          true
        );

        if (this.parentNode) this.parentNode.removeChild(this);
        if (this._ondelete) this._ondelete();
      } catch (err) {
        displayError(`Failed to delete title: ${err.message}`, 3000);
      }
      });
  }

  async refreshServerInfo() {
    if (!this._title) {
      displayError("No title selected for refresh.", 3000);
      return;
    }
    if (this._refreshing) {
      displayMessage("Title refresh already in progress.", 2500);
      return;
    }

    this._refreshing = true;
    const titleId = this._title.getId();
    if (!titleId) {
      displayError("Cannot refresh title without an ID.", 3000);
      this._refreshing = false;
      return;
    }

    try {
      await refreshTitleMetadata(titleId);
      invalidateTitleCache(titleId);
      const refreshed = await getTitleInfo(titleId);
      if (!refreshed) {
        throw new Error("Refresh response did not contain updated title data.");
      }
      await updateTitleMetadata(refreshed);
      this._title = refreshed;
      await this._renderTitleSpecificContent();
      this._setupBackendSubscriptions();
      this.dispatchEvent(
        new CustomEvent("title-refreshed", {
          detail: { title: refreshed },
          bubbles: true,
          composed: true,
        })
      );
      displaySuccess(`"${refreshed.getName()}" metadata refreshed.`, 3000);
    } catch (err) {
      displayError(`Failed to refresh title info: ${err?.message || err}`, 4000);
      throw err;
    } finally {
      this._refreshing = false;
    }
  }

  _displayEpisodes(episodes, parentElement) {
    if (!parentElement) return;

    parentElement.innerHTML = `
      <div class="episodes-div">
        <div class="episodes-header-tabs">
          <paper-tabs selected="0" scrollable></paper-tabs>
        </div>
        <div id="episodes-content" style="width: 100%; overflow-y: auto;"></div>
      </div>
    `;

    const tabsContainer = parentElement.querySelector("paper-tabs");
    const episodesContent = parentElement.querySelector("#episodes-content");

    const seasons = {};
    episodes.forEach(e => {
      if (e.getType() === "TVEpisode" && e.getSeason() > 0) {
        if (!seasons[e.getSeason()]) seasons[e.getSeason()] = [];
        if (!seasons[e.getSeason()].some(ep => ep.getId() === e.getId())) {
          seasons[e.getSeason()].push(e);
        }
      }
    });

    for (const s in seasons) seasons[s].sort((a, b) => a.getEpisode() - b.getEpisode());

    let tabIndex = 0;
    for (const seasonNumber in seasons) {
      const seasonEpisodes = seasons[seasonNumber];

      const tab = document.createElement("paper-tab");
      tab.id = `tab-season-${seasonNumber}`;
      tab.textContent = `Season ${seasonNumber}`;
      tabsContainer.appendChild(tab);

      const page = document.createElement("div");
      page.classList.add("season-page-div");
      episodesContent.appendChild(page);
      page.style.display = tabIndex === 0 ? "flex" : "none";

      tab.addEventListener('click', () => {
        episodesContent.querySelectorAll(".season-page-div").forEach(p => p.style.display = "none");
        page.style.display = "flex";
      });

      seasonEpisodes.forEach(episode => {
        const posterUrl = episode.getPoster() ? episode.getPoster().getContenturl() : 'placeholder.png';
        const episodeId = `_${getUuidByString(episode.getId())}`;

        const episodeHtml = `
          <div class="episode-small-div">
            <div class="episode-number-badge">${episode.getEpisode()}</div>
            <iron-icon id="play-btn-${episodeId}" class="play-episode-button" icon="av:play-circle-filled"></iron-icon>
            <img src="${posterUrl}" alt="Episode Poster">
            <div class="slide-on-panel">
              <div class="slide-on-panel-title-name">${episode.getName()}</div>
              <iron-icon id="infos-btn-${episodeId}" class="info-episode-button" icon="icons:info-outline"></iron-icon>
            </div>
          </div>
        `;
        page.appendChild(document.createRange().createContextualFragment(episodeHtml));

        const playBtn = page.querySelector(`#play-btn-${episodeId}`);
        const infosBtn = page.querySelector(`#infos-btn-${episodeId}`);

        playBtn.addEventListener('click', async (evt) => {
          evt.stopPropagation();
          await this._playEpisodeVideo(episode);
        });
        infosBtn.addEventListener('click', (evt) => {
          evt.stopPropagation();
          this.showTitleInfo(episode);
        });
      });

      tabIndex++;
    }
  }

  async _playEpisodeVideo(episode) {
    if (!episode || !episode.getId()) {
      displayError("Cannot play episode: episode info missing.", 3000);
      return;
    }
    try {
      const indexPath = "/search/titles";
      const filePaths = await getTitleFilePaths(episode, indexPath);

      if (filePaths.length === 0) {
        displayMessage(`No video file found for episode "${episode.getName()}".`, 3000);
        return;
      }

      const videoPath = filePaths[0];
      const titleInfoBox = document.getElementById("title-info-box");

      await playVideo(videoPath, () => {
        if (titleInfoBox && titleInfoBox.parentNode) {
          // placeholder for fullscreen/close callback
        }
      }, null, episode);

      if (titleInfoBox && titleInfoBox.parentNode) {
        titleInfoBox.parentNode.removeChild(titleInfoBox);
      }
    } catch (err) {
      displayError(`Failed to play episode "${episode.getName()}": ${err.message}`, 3000);
    }
  }

  showTitleInfo(title) {
    let titleInfoBoxDialog = document.getElementById(`video-info-box-dialog-${title.getId()}`);
    if (!titleInfoBoxDialog) {
      const html = `
        <paper-card id="video-info-box-dialog-${title.getId()}" style="background: var(--surface-color); border-top: 1px solid var(--surface-color); border-left: 1px solid var(--surface-color); z-index: 1001; position: fixed; top: 75px; left: 50%; transform: translate(-50%); max-height: calc(100vh - 150px); overflow-y: auto; box-shadow: var(--shadow-elevation-8dp); border-radius: 8px; width: 90%; max-width: 800px;">
          <globular-informations-manager id="title-info-box"></globular-informations-manager>
        </paper-card>
      `;
      const range = document.createRange();
      document.body.appendChild(range.createContextualFragment(html));
      titleInfoBoxDialog = document.getElementById(`video-info-box-dialog-${title.getId()}`);
      titleInfoBoxDialog.querySelector('globular-informations-manager').onclose = () => {
        if (titleInfoBoxDialog.parentNode) {
          titleInfoBoxDialog.parentNode.removeChild(titleInfoBoxDialog);
        }
      };
    }

    const informationsManager = titleInfoBoxDialog.querySelector('globular-informations-manager');
    informationsManager.setTitlesInformation([title]);
  }

  async _updateButtonVisibility() {
    const token = getToken();
    const isLoggedIn = !!token;
    if (this._editButton) this._editButton.style.display = isLoggedIn ? "" : "none";
    if (this._deleteButton) this._deleteButton.style.display = isLoggedIn ? "" : "none";
  }
}

customElements.define('globular-title-info', TitleInfo);