import "@polymer/iron-icons/iron-icons.js";
import "@polymer/iron-icons/maps-icons";
import "@polymer/paper-icon-button/paper-icon-button.js";
import "@polymer/paper-progress/paper-progress.js";

import {
  Backend,
  decodeJwtPayload,
  displayError,
  displayMessage,
  getTitleInfo,
  getToken,
  getVideoInfo,
  getAudioInfo,
  getWatchingTitle as fetchWatchingTitle,
  getWatchingTitles as fetchWatchingTitles,
  saveWatchingTitle as persistWatchingTitle,
  removeWatchingTitle as deleteWatchingEntry,
  getTitleFiles,
  getBaseUrl,
} from "@globular/backend";

import { playVideo } from "./video";
import { showGlobalVideoInfo } from "./search/searchVideoCard.js";
import { showGlobalTitleInfo } from "./search/searchTitleCard.js";

// --- Constants ---
const MEDIA_WATCHING_VIDEO_SLOT = "video";
const MEDIA_WATCHING_TITLE_SLOT = "title";
const EVENT_REMOVE_VIDEO_PLAYER = "remove_video_player_evt_";
const EVENT_PLAY_VIDEO_PLAYER = "play_video_player_evt_";
const EVENT_STOP_VIDEO_PLAYER = "stop_video_player_evt_";
const EVENT_START_PEER = "start_peer_evt_";
const EVENT_STOP_PEER = "stop_peer_evt_";
const EVENT_REMOVE_MEDIA_WATCHING_CARD = "remove_media_watching_card_";
const TITLE_ID_PATTERN = /^tt\d+/i;

const INDEX_VIDEOS = "/search/videos";
const INDEX_TITLES = "/search/titles";

// ---------------- Normalization helpers ----------------

function normalizeWatchingEntry(entry = {}) {
  if (!entry) return null;
  const titleId = entry.titleId || entry.title_id || entry._id || entry.id;
  if (!titleId) return null;

  const normalized = {
    ...entry,
    titleId,
    _id: titleId,
    watchingId: entry.id || entry._id || titleId,
    date: entry.date || entry.updated_at || new Date().toISOString(),
  };

  const entryType = determineEntryType(normalized);
  normalized.mediaType = entryType;
  normalized.entryType = entryType;

  // currentTime (seconds)
  if (typeof normalized.currentTime !== "number") {
    const posMs = normalized.position_ms || normalized.positionMs || 0;
    const posMsNum = Number(posMs) || 0;
    normalized.currentTime = posMsNum ? posMsNum / 1000 : 0;
  }

  // duration (seconds)
  if (typeof normalized.duration !== "number") {
    const durationMs = normalized.duration_ms || normalized.durationMs || 0;
    const durMsNum = Number(durationMs) || 0;
    normalized.duration = durMsNum ? durMsNum / 1000 : 0;
  }

  // ensure duration_ms
  if (normalized.duration_ms == null && typeof normalized.duration === "number") {
    normalized.duration_ms = Math.round(Math.max(0, normalized.duration) * 1000);
  }

  // ensure position_ms
  const positionMs =
    typeof normalized.position_ms === "number"
      ? normalized.position_ms
      : typeof normalized.currentTime === "number"
      ? Math.round(Math.max(0, normalized.currentTime) * 1000)
      : 0;
  normalized.position_ms = Number(positionMs) || 0;

  return normalized;
}

function determineEntryType(entry = {}) {
  const id = entry.titleId || entry.title_id || entry._id || entry.id || "";
  const hint =
    typeof entry.mediaType === "string"
      ? entry.mediaType.toLowerCase()
      : typeof entry.type === "string"
      ? entry.type.toLowerCase()
      : typeof entry.kind === "string"
      ? entry.kind.toLowerCase()
      : "";
  const looksLikeTitle = TITLE_ID_PATTERN.test(String(id || "").toLowerCase());

  if (hint === "title") return "title";
  if (hint === "audio" || entry.isAudio === true) return "audio";
  if (hint === "video") return looksLikeTitle ? "title" : "video";
  if (["movie", "film", "episode", "series"].includes(hint)) return "title";

  if (entry.isVideo === false) return "audio";
  if (entry.isVideo === true && !looksLikeTitle) return "video";

  if (typeof entry.mimeType === "string") {
    const mime = entry.mimeType.toLowerCase();
    if (mime.startsWith("audio/")) return "audio";
    if (mime.startsWith("video/")) return looksLikeTitle ? "title" : "video";
  }

  if (looksLikeTitle) return "title";
  return hint === "audio" ? "audio" : "video";
}

function getUserContext() {
  const token = getToken();
  if (!token) return null;

  const payload = decodeJwtPayload(token);
  if (!payload) return null;

  const username =
    payload.username ||
    payload.preferred_username ||
    payload.name ||
    payload.sub ||
    payload.email ||
    "";

  let domain = payload.user_domain || payload.domain || "";
  if (!domain && typeof payload.preferred_username === "string" && payload.preferred_username.includes("@")) {
    domain = payload.preferred_username.split("@")[1];
  }

  return {
    token,
    username,
    domain,
  };
}

/**
 * MediaWatching Web Component.
 * Displays a list of recently watched videos and titles.
 */
export class MediaWatching extends HTMLElement {
  // --- Class Properties ---
  onClose = null; // Callback when the component is closed
  _closable = true;
  emptyMessage = null;
  _listeners = Object.create(null);
  _initialized = false;

  // DOM Element References (cached in constructor/connectedCallback)
  videoDiv = null;
  titleDiv = null;
  videoTitleElement = null;
  movieTitleElement = null;
  closeBtn = null;

  // --- Constructor ---
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._closable = this.getAttribute("closable") !== "false";
    if (this._closable) {
      this.hide();
    } else {
      this.show();
    }

    this.shadowRoot.innerHTML = `
        <style>
            :host {
                display: block;
                padding: 16px;
                box-sizing: border-box;
                color: var(--on-surface-color);
                min-height: 100%;
            }

            #container {
                display: flex;
                flex-direction: column;
                gap: 16px;
                background-color: color-mix(in srgb, var(--surface-color) 92%, transparent);
                border-radius: 20px;
                border: 1px solid color-mix(in srgb, var(--border-subtle-color) 40%, transparent);
                padding: 20px;
            }

            #header-row {
                display: flex;
                align-items: center;
                gap: 8px;
                padding: 4px 0;
            }

            #header-row h1 {
                flex: 1;
                margin: 0;
                font-size: 1.25rem;
                font-weight: 600;
                color: var(--on-surface-color);
            }

            #header-row paper-icon-button {
                color: var(--on-surface-color);
            }

            .sections-wrapper {
                display: flex;
                flex-direction: column;
                gap: 24px;
            }

            .section-header {
                padding: 12px 0 0;
                border-top: 1px solid color-mix(in srgb, var(--border-subtle-color) 60%, transparent);
            }

            .section-header h2 {
                margin: 0 0 16px;
                font-size: 1rem;
                font-weight: 600;
                color: color-mix(in srgb, var(--on-surface-color) 90%, transparent);
                letter-spacing: 0.04em;
                text-transform: uppercase;
            }

            .media-cards {
                display: grid;
                grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
                gap: 20px;
            }

            .empty-message {
                text-align: center;
                color: var(--secondary-text-color, var(--palette-text-secondary));
                margin: 40px 16px;
                font-size: 0.95rem;
            }
        </style>

        <div id="container">
            <div id="header-row">
                <h1>Continue Watching...</h1>
                <paper-icon-button id="close-btn" icon="icons:close"></paper-icon-button>
            </div>

            <div class="sections-wrapper" style="flex-grow: 1; overflow-y: auto;">
                <div id="empty-message" class="empty-message">Nothing in watching yet. Start playing videos to populate this list.</div>
                <div id="video-section" class="section-header" style="display: none;">
                    <h2 id="video-title">Video(s)</h2>
                    <div id="video-cards" class="media-cards"></div>
                </div>
                
                <div id="title-section" class="section-header" style="display: none;">
                    <h2 id="movie-title">Title(s)</h2>
                    <div id="title-cards" class="media-cards"></div>
                </div>
            </div>
        </div>
        `;

    // Cache DOM elements
    this.videoDiv = this.shadowRoot.getElementById("video-section");
    this.titleDiv = this.shadowRoot.getElementById("title-section");
    this.videoTitleElement = this.shadowRoot.getElementById("video-title");
    this.movieTitleElement = this.shadowRoot.getElementById("movie-title");
    this.closeBtn = this.shadowRoot.getElementById("close-btn");
    this.emptyMessage = this.shadowRoot.getElementById("empty-message");
    this.videoCardsContainer = this.shadowRoot.getElementById("video-cards");
    this.titleCardsContainer = this.shadowRoot.getElementById("title-cards");

    if (!this._closable) {
      this.closeBtn.style.display = "none";
    }
  }

  // --- Lifecycle Callbacks ---
  connectedCallback() {
    if (this._closable) {
      this.closeBtn?.addEventListener("click", this._handleCloseClick);
    }
    this._ensureInitialized();
  }

  disconnectedCallback() {
    // Clean up close button listener if element is removed from DOM directly
    if (this._closable) {
      this.closeBtn?.removeEventListener("click", this._handleCloseClick);
    }
    this._teardownWatchingSubscriptions();
  }

  // --- Private Event Handlers ---
  _handleCloseClick = () => {
    this.hide();
  };

  show() {
    this.style.display = "block";
    this.removeAttribute("hidden");
  }

  hide() {
    if (!this._closable) return;
    this.style.display = "none";
    this.setAttribute("hidden", "");
    if (this.parentNode) {
      this.parentNode.removeChild(this);
    }
    if (this.onClose) {
      this.onClose();
    }
  }

  _ensureInitialized() {
    if (this._initialized) return;
    this._initialized = true;
    this._subscribeToWatchingEvents();
    this._loadInitialWatchingTitles();
  }

  _subscribeToWatchingEvents() {
    this._registerWatchingEvent(EVENT_START_PEER, this._handlePeerStart);
    this._registerWatchingEvent(EVENT_STOP_PEER, this._handlePeerStop);
    this._registerWatchingEvent(EVENT_PLAY_VIDEO_PLAYER, this._handlePlayVideoEvent);
    this._registerWatchingEvent(EVENT_STOP_VIDEO_PLAYER, this._handleStopVideoEvent);
    this._registerWatchingEvent(EVENT_REMOVE_VIDEO_PLAYER, this._handleRemoveVideoEvent);
  }

  _registerWatchingEvent(eventName, handler) {
    if (!Backend?.eventHub?.subscribe || !eventName || !handler) return;
    Backend.eventHub.subscribe(
      eventName,
      (uuid) => {
        this._listeners[eventName] = uuid;
      },
      handler,
      false,
      this
    );
  }

  _teardownWatchingSubscriptions() {
    if (!this._listeners) return;
    Object.entries(this._listeners).forEach(([eventName, uuid]) => {
      try {
        Backend.eventHub.unsubscribe(eventName, uuid);
      } catch {
        // ignore
      }
    });
    this._listeners = Object.create(null);
    this._initialized = false;
  }

  _handlePeerStart = async (_peer) => {
    await this._loadInitialWatchingTitles();
  };

  _handlePeerStop = (peer) => {
    if (!peer) return;
    Backend.eventHub.publish(
      `${EVENT_REMOVE_MEDIA_WATCHING_CARD}${peer.getDomain()}.${peer.getDomain()}_evt_`,
      {},
      true
    );
  };

  _handlePlayVideoEvent = async (eventData) => {
    const payload = this._normalizeEventPayload(eventData);
    if (!payload || typeof payload.currentTime !== "number" || payload.currentTime <= 0) {
      return;
    }
    try {
      localStorage.setItem(payload._id, String(payload.currentTime));
    } catch {
      // ignore storage errors
    }
  };

  _handleStopVideoEvent = async (eventData) => {
    const payload = this._normalizeEventPayload(eventData);
    const saved = await this.saveWatchingTitle(payload);
    const entry = saved || payload;
    await this.appendTitle(entry);
  };

  _handleRemoveVideoEvent = async (eventData) => {
    const payload = this._normalizeEventPayload(eventData);
    if (!payload?._id) {
      return;
    }

    let existingEntry = null;
    try {
      const raw = await fetchWatchingTitle(payload._id);
      existingEntry = normalizeWatchingEntry(raw);
    } catch {
      existingEntry = null;
    }

    const eventTime = Date.parse(payload.date || payload.updated_at || "");
    const currentTime = existingEntry
      ? Date.parse(existingEntry.date || existingEntry.updated_at || "")
      : NaN;
    if (
      existingEntry &&
      Number.isFinite(eventTime) &&
      Number.isFinite(currentTime) &&
      currentTime > eventTime
    ) {
      // Stale removal event; entry has been updated after this event was emitted.
      return;
    }

    await this.removeWatchingTitle(payload);
    this._removeCardElement(payload._id);
  };

  _normalizeEventPayload(eventData = {}) {
    const payload = { ...eventData };
    const currentTime = Number(payload.currentTime ?? 0);
    const duration =
      payload.duration != null
        ? Number(payload.duration)
        : payload.duration_ms != null
        ? Number(payload.duration_ms) / 1000
        : 0;

    const derivedType = determineEntryType(payload);
    payload.mediaType = derivedType;
    payload.entryType = derivedType;

    if (typeof payload.duration_ms !== "number" && Number.isFinite(duration)) {
      payload.duration_ms = Math.round(Math.max(0, duration) * 1000);
    }
    if (typeof payload.position_ms !== "number" && Number.isFinite(currentTime)) {
      payload.position_ms = Math.round(Math.max(0, currentTime) * 1000);
    }

    payload.currentTime = Number.isFinite(currentTime) ? currentTime : 0;
    payload.duration = Number.isFinite(duration) ? duration : payload.duration ?? 0;

    try {
      payload.date = payload.date ? new Date(payload.date).toISOString() : new Date().toISOString();
    } catch {
      payload.date = new Date().toISOString();
    }
    return payload;
  }

  _removeCardElement(id) {
    if (!id) return;
    const card =
      this.videoCardsContainer?.querySelector?.(`#_${id}`) ||
      this.titleCardsContainer?.querySelector?.(`#_${id}`);
    if (card?.parentNode) {
      card.parentNode.removeChild(card);
      this._updateSectionCounts();
    }
  }

  /** Loads and appends initial watching titles to MediaWatching. */
  async _loadInitialWatchingTitles() {
    try {
      const titles = await this.getWatchingTitles();
      if (this.videoCardsContainer) this.videoCardsContainer.innerHTML = "";
      if (this.titleCardsContainer) this.titleCardsContainer.innerHTML = "";

      for (const title of titles) {
        await this.appendTitle(title);
      }
    } catch (err) {
      console.error("Failed to load initial watching titles:", err);
      displayError("Failed to load watching history.");
    }
  }

  /**
   * Retrieves the list of all watching titles for the current user.
   * @returns {Promise<object[]>} A promise that resolves with an array of watching title objects.
   */
  async getWatchingTitles() {
    try {
      const entries = await fetchWatchingTitles();
      return entries
        .map((entry) => normalizeWatchingEntry(entry))
        .filter((entry) => !!entry);
    } catch (error) {
      console.error("Error fetching watching titles:", error);
      displayError(`Failed to get watching titles: ${error.message}`);
      return [];
    }
  }

  /**
   * Retrieves information for a specific watching title.
   */
  async getWatchingTitle(titleId) {
    if (!titleId) {
      throw new Error("Missing title id.");
    }
    try {
      if (typeof fetchWatchingTitle === "function") {
        const entry = await fetchWatchingTitle(titleId);
        return normalizeWatchingEntry(entry);
      }
      throw new Error("Watching title lookup is not available.");
    } catch (err) {
      displayError(err?.message || "Failed to get watching title.", 3000);
      throw err;
    }
  }

  /**
   * Removes a watching title from the user's history.
   */
  async removeWatchingTitle(title) {
    const id = typeof title === "string" ? title : title?._id;
    if (!id) return;

    localStorage.removeItem(id);

    try {
      await deleteWatchingEntry(id);
      console.log(`Watching title ${id} removed from backend.`);
    } catch (err) {
      displayError(
        `Failed to remove watching title ${id}: ${err?.message || err}`,
        3000
      );
    }
  }

  /**
   * Saves or updates a watching title in the user's history.
   */
  async saveWatchingTitle(title) {
    const normalized = normalizeWatchingEntry(title);
    if (!normalized?._id) {
      displayError("Cannot save watching history: missing title identifier.", 3000);
      return undefined;
    }

    let existingEntry = null;
    try {
      const raw = await fetchWatchingTitle(normalized._id);
      existingEntry = normalizeWatchingEntry(raw);
    } catch {
      existingEntry = null;
    }

    if (typeof normalized.currentTime !== "number" || normalized.currentTime <= 0) {
      return existingEntry || normalized;
    }

    const newTime =
      typeof normalized.currentTime === "number" ? normalized.currentTime : 0;
    const existingTime =
      typeof existingEntry?.currentTime === "number" ? existingEntry.currentTime : 0;

    if (existingEntry && newTime <= existingTime) {
      try {
        localStorage.setItem(normalized._id, String(existingTime));
      } catch {
        // ignore storage errors
      }
      console.log(
        `Watching entry ${normalized._id} already at ${existingTime}s, skipping update.`
      );
      return existingEntry;
    }

    try {
      localStorage.setItem(
        normalized._id,
        normalized.currentTime?.toString() || "0"
      );
    } catch {
      // ignore storage errors
    }

    try {
      await persistWatchingTitle(normalized);
      console.log(`Watching title ${normalized._id} saved/updated.`);
      try {
        const refreshed = await this.getWatchingTitle(normalized._id);
        if (refreshed?.currentTime !== undefined) {
          try {
            localStorage.setItem(
              normalized._id,
              String(refreshed.currentTime || 0)
            );
          } catch {
            // ignore
          }
        }
        return refreshed || normalized;
      } catch {
        return normalized;
      }
    } catch (err) {
      displayError(
        `Failed to save watching title ${normalized._id}: ${err?.message || err}`,
        3000
      );
      return normalized;
    }
  }

  /**
   * Appends a title/video to the "Continue Watching" list.
   * @param {object} title - The watching object with _id, entryType, domain, etc.
   * @param {function} [callback] - Optional callback on success.
   * @param {function} [errorCallback] - Optional callback on error.
   */
  async appendTitle(title, callback, errorCallback) {
    if (!getUserContext()) {
      // Cannot append if not logged in
      if (errorCallback) errorCallback(new Error("User not authenticated."));
      return;
    }

    const normalized = normalizeWatchingEntry(title);
    if (!normalized?._id) {
      if (errorCallback) errorCallback(new Error("Invalid watching entry."));
      return;
    }

    const resumeSeconds =
      typeof normalized.currentTime === "number" && normalized.currentTime > 0
        ? normalized.currentTime
        : 0;
    if (resumeSeconds > 0) {
      try {
        localStorage.setItem(normalized._id, String(resumeSeconds));
      } catch {
        // ignore storage failures
      }
    }

    // Check if card already exists inside either container
    const existingCard =
      this.videoCardsContainer.querySelector(`#_${normalized._id}`) ||
      this.titleCardsContainer.querySelector(`#_${normalized._id}`);

    if (existingCard && typeof existingCard.setTitle === "function") {
      await existingCard.setTitle(normalized, callback, errorCallback);
      this._updateSectionCounts();
      return;
    }

    const card = new MediaWatchingCard();
    card.id = `_${normalized._id}`; // Set ID on the card itself for easy lookup

    try {
      const entryType = (normalized.entryType || normalized.mediaType || "video").toLowerCase();
      await new Promise((resolve, reject) => {
        card.setTitle(normalized, resolve, reject);
      });

      const container =
        entryType === "title" ? this.titleCardsContainer : this.videoCardsContainer;
      container.appendChild(card);

      this._updateSectionCounts();

      if (callback) callback();
    } catch (err) {
      console.error(`Failed to append title ${title._id}:`, err);
      const msg = `${err?.message || err}`.toLowerCase();
      if (
        msg.includes("no video found") ||
        msg.includes("no title found") ||
        msg.includes("no audio found")
      ) {
        await this.removeWatchingTitle(normalized);
        return;
      }
      if (errorCallback) errorCallback(err);
    }
  }

  /** Updates the displayed counts for video and title sections. */
  _updateSectionCounts() {
    const videoCount = this.videoCardsContainer.children.length;
    const titleCount = this.titleCardsContainer.children.length;

    this.videoDiv.style.display = videoCount > 0 ? "block" : "none";
    this.videoTitleElement.innerHTML = `Video(s)${
      videoCount > 0 ? ` (${videoCount})` : ""
    }`;

    this.titleDiv.style.display = titleCount > 0 ? "block" : "none";
    this.movieTitleElement.innerHTML = `Title(s)${
      titleCount > 0 ? ` (${titleCount})` : ""
    }`;

    const hasEntries = videoCount > 0 || titleCount > 0;
    if (this.emptyMessage) {
      this.emptyMessage.style.display = hasEntries ? "none" : "block";
    }
  }
}

customElements.define("globular-media-watching", MediaWatching);

// -----------------------------------------------------------------------------
// Card
// -----------------------------------------------------------------------------

export class MediaWatchingCard extends HTMLElement {
  // Stores the watching entry + backend object (video/title/audio)
  titleData = null;
  _mediaObject = null;
  _indexPath = INDEX_VIDEOS;

  // DOM Element References
  titleDateElement = null;
  closeButton = null;
  thumbnailImg = null;
  titleTextEl = null;
  metaTextEl = null;
  playButton = null;
  infoButton = null;
  progressBar = null;
  progressLabel = null;

  constructor() {
    super();
    this.attachShadow({ mode: "open" });

    this.shadowRoot.innerHTML = `
        <style>
            :host {
                display: block;
                min-width: 220px;
            }

            #container {
                display: flex;
                flex-direction: column;
                padding: 12px;
                border-radius: 16px;
                background-color: color-mix(in srgb, var(--surface-color) 95%, transparent);
                color: var(--on-surface-color);
                border: 1px solid color-mix(in srgb, var(--border-subtle-color) 40%, transparent);
                gap: 10px;
                height: 100%;
                box-sizing: border-box;
            }

            #header-line {
                display: flex;
                align-items: center;
                gap: 12px;
                font-size: 0.8rem;
                color: var(--secondary-text-color, var(--palette-text-secondary));
            }

            #title-date {
                flex-grow: 1;
                text-align: left;
                user-select: none;
            }

            #thumb-wrapper {
                width: 100%;
                border-radius: 10px;
                overflow: hidden;
                background-color: color-mix(in srgb, var(--on-surface-color) 6%, transparent);
                position: relative;
                min-height: 180px;
            }

            #thumbnail,
            #preview {
                width: 100%;
                height: 180px;
                object-fit: cover;
                display: block;
            }

            #preview {
                position: absolute;
                inset: 0;
                opacity: 0;
                transition: opacity 0.18s ease;
                pointer-events: none;
            }

            #info-block {
                display: flex;
                flex-direction: column;
                gap: 6px;
            }

            #primary-row {
                display: flex;
                align-items: center;
                gap: 10px;
            }

            #title-text {
                flex: 1;
                font-size: 0.95rem;
                font-weight: 600;
                line-height: 1.3;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }

            #buttons-row {
                display: flex;
                align-items: center;
                gap: 4px;
                flex-shrink: 0;
            }

            #meta-text {
                font-size: 0.8rem;
                color: var(--secondary-text-color, var(--palette-text-secondary));
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }

            #buttons-row paper-icon-button {
                color: var(--on-surface-color);
                --iron-icon-width: 20px;
                --iron-icon-height: 20px;
            }

            #play-btn,
            #info-btn {
                color: var(--on-surface-color);
            }

            #thumb-wrapper img {
                cursor: pointer;
            }

            paper-progress {
                width: 100%;
                --paper-progress-active-color: color-mix(in srgb, var(--palette-primary) 70%, var(--palette-secondary));
                --paper-progress-secondary-color: color-mix(in srgb, var(--palette-primary) 40%, transparent);
                --paper-progress-container-color: color-mix(in srgb, var(--on-surface-color) 18%, transparent);
                --paper-progress-height: 4px;
                margin-top: 6px;
            }

            #progress-label {
                font-size: 0.75rem;
                letter-spacing: 0.08em;
                color: color-mix(in srgb, var(--secondary-text-color) 90%, transparent);
                text-transform: uppercase;
                margin-top: 4px;
            }
        </style>

        <div id="container">
            <div id="header-line">
                <span id="title-date"></span>
                <paper-icon-button id="close-card-btn" icon="icons:close"></paper-icon-button>
            </div>

            <div id="thumb-wrapper">
                <img id="thumbnail" alt="thumbnail" />
                <video id="preview" muted loop playsinline preload="metadata"></video>
            </div>

            <div id="info-block">
                <div id="primary-row">
                    <div id="title-text"></div>
                    <div id="buttons-row">
                        <paper-icon-button id="play-btn" icon="av:play-circle-outline" title="Play / Resume"></paper-icon-button>
                        <paper-icon-button id="info-btn" icon="icons:info-outline" title="Details"></paper-icon-button>
                    </div>
                </div>
                <div id="meta-text"></div>
                <paper-progress id="progress-bar" hidden min="0" max="100" value="0"></paper-progress>
                <span id="progress-label" hidden>Progress • 0%</span>
            </div>
        </div>
        `;

    // Cache DOM elements
    this.titleDateElement = this.shadowRoot.querySelector("#title-date");
    this.closeButton = this.shadowRoot.querySelector("#close-card-btn");
        this.thumbnailImg = this.shadowRoot.querySelector("#thumbnail");
        this.previewVideo = this.shadowRoot.querySelector("#preview");
    this.titleTextEl = this.shadowRoot.querySelector("#title-text");
    this.metaTextEl = this.shadowRoot.querySelector("#meta-text");
    this.playButton = this.shadowRoot.querySelector("#play-btn");
    this.infoButton = this.shadowRoot.querySelector("#info-btn");
    this.progressBar = this.shadowRoot.querySelector("#progress-bar");
    this.progressLabel = this.shadowRoot.querySelector("#progress-label");

    // Setup event listeners
    this.closeButton.addEventListener("click", this._handleCloseClick);
    this.playButton.addEventListener("click", this._handlePlayClick);
    this.infoButton.addEventListener("click", this._handleInfoClick);
    if (this.thumbnailImg) {
      this.thumbnailImg.addEventListener("click", this._handlePlayClick);
      this.thumbnailImg.addEventListener("mouseenter", this._handleThumbEnter);
      this.thumbnailImg.addEventListener("mouseleave", this._handleThumbLeave);
    }
  }

  connectedCallback() {}

  disconnectedCallback() {
    this.closeButton.removeEventListener("click", this._handleCloseClick);
    this.playButton.removeEventListener("click", this._handlePlayClick);
    this.infoButton.removeEventListener("click", this._handleInfoClick);
    if (this.thumbnailImg) {
      this.thumbnailImg.removeEventListener("click", this._handlePlayClick);
      this.thumbnailImg.removeEventListener("mouseenter", this._handleThumbEnter);
      this.thumbnailImg.removeEventListener("mouseleave", this._handleThumbLeave);
    }

    if (this.titleData) {
      try {
        Backend.eventHub.unsubscribe(
          EVENT_REMOVE_MEDIA_WATCHING_CARD + this.titleData._id,
          `card_remove_${this.titleData._id}`
        );
      } catch {
        // ignore
      }
    }
  }

  // --- Private Event Handlers ---

  _handleCloseClick = () => {
    if (this.titleData) {
      Backend.eventHub.publish(EVENT_REMOVE_VIDEO_PLAYER, this.titleData, true);
    }
  };

  _handleInfoClick = () => {
    if (!this._mediaObject) return;
    const entryType = (this.titleData?.entryType || this.titleData?.mediaType || "video").toLowerCase();
    if (entryType === "title") {
      showGlobalTitleInfo(this._mediaObject);
    } else {
      showGlobalVideoInfo(this._mediaObject);
    }
  };

  _handlePlayClick = async () => {
    if (!this._mediaObject && !this.titleData) return;

    const id =
      (this._mediaObject && this._mediaObject.getId && this._mediaObject.getId()) ||
      this.titleData._id ||
      this.titleData.titleId;

    const indexPath = this._indexPath || INDEX_VIDEOS;

    try {
      const filePaths = await getTitleFiles(id, indexPath);
      if (Array.isArray(filePaths) && filePaths.length > 0) {
        const mainVideoPath = filePaths[0];
        await playVideo(mainVideoPath, null, null, this._mediaObject || this.titleData);
      } else {
        displayMessage(`No main video file found for "${this.titleTextEl?.textContent || id}".`, 3000);
      }
    } catch (err) {
      displayError(`Failed to get main video file: ${err?.message || err}`, 3000);
    }
  };

  _handleThumbEnter = () => {
    if (!this.previewVideo || !this.previewVideo.src) return;
    this.previewVideo.style.opacity = "1";
    this.previewVideo.play().catch(() => {});
  };

  _handleThumbLeave = () => {
    if (!this.previewVideo) return;
    this.previewVideo.pause();
    this.previewVideo.currentTime = 0;
    this.previewVideo.style.opacity = "0";
  };

  /**
   * Sets the title/video data for the card and populates basic info + progress.
   * @param {object} titleData - normalized watching entry.
   */
  async setTitle(titleData, callback, errorCallback) {
    this.titleData = normalizeWatchingEntry(titleData) || titleData;

    // Display last view date
    try {
      const lastView = this.titleData.date ? new Date(this.titleData.date) : new Date();
      this.titleDateElement.innerHTML = `${lastView.toLocaleDateString()} ${lastView.toLocaleTimeString()}`;
    } catch {
      this.titleDateElement.textContent = "";
    }

    try {
      const entryType = (this.titleData.entryType || this.titleData.mediaType || "video").toLowerCase();
      const id = this.titleData.titleId || this.titleData._id;

      let mediaObj = null;
      let indexPath = INDEX_VIDEOS;

      if (entryType === "audio") {
        mediaObj = await getAudioInfo(id);
        indexPath = INDEX_VIDEOS;
      } else if (entryType === "title") {
        mediaObj = await getTitleInfo(id);
        indexPath = INDEX_TITLES;
      } else {
        // default: video
        mediaObj = await getVideoInfo(id);
        indexPath = INDEX_VIDEOS;
      }

      this._mediaObject = mediaObj || null;
      this._indexPath = indexPath;

      this._populateBasicInfo(entryType);
      this._loadPreviewSource(entryType, id);
      this._updateProgress();

      if (callback) callback();
    } catch (err) {
      console.error(`Error setting title for MediaWatchingCard (${titleData._id}):`, err);
      const msg = `${err?.message || ""}`.toLowerCase();
      const isMissingMedia =
        msg.includes("no video found") ||
        msg.includes("no title found") ||
        msg.includes("no audio found");
      if (!isMissingMedia && err?.message) {
        displayError(err.message, 4000);
      }
      if (errorCallback) errorCallback(err);
    }
  }

  _populateBasicInfo(entryType) {
    const obj = this._mediaObject || {};
    const td = this.titleData || {};

    // thumbnail
    let thumb =
      obj.getPoster?.()?.getContenturl?.() ||
      obj.posterUrl ||
      td.poster ||
      td.thumbnail ||
      "";

    if (!thumb) {
      // simple placeholder
      thumb =
        "data:image/svg+xml;base64," +
        btoa(
          `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="225"><rect width="100%" height="100%" fill="#222"/><text x="50%" y="50%" fill="#888" font-size="16" font-family="sans-serif" text-anchor="middle">No thumbnail</text></svg>`
        );
    }
    if (this.thumbnailImg) {
      this.thumbnailImg.src = thumb;
    }

    // Title text
    const lineFromDesc = (d) =>
      (d || "")
        .toString()
        .split(/\r?\n/)[0]
        .trim();

    const titleText =
      obj.getTitle?.() ||
      obj.getPrimarytitle?.() ||
      obj.getName?.() ||
      lineFromDesc(obj.getDescription?.() || "") ||
      td.name ||
      td.title ||
      td.fileName ||
      td._id;

    if (this.titleTextEl) {
      this.titleTextEl.textContent = titleText || "(untitled)";
    }

    // Meta text: type + duration / resume
    const durMs = (() => {
      if (td.duration_ms != null) return Number(td.duration_ms) || 0;
      if (typeof td.duration === "number") return Math.round(Math.max(0, td.duration) * 1000);
      return 0;
    })();

    const posMs = (() => {
      if (td.position_ms != null) return Number(td.position_ms) || 0;
      if (typeof td.currentTime === "number") return Math.round(Math.max(0, td.currentTime) * 1000);
      return 0;
    })();

    const formatTime = (s) => {
      s = Math.max(0, Math.floor(s));
      const h = Math.floor(s / 3600);
      const m = Math.floor((s % 3600) / 60);
      const sec = s % 60;
      const mm = m.toString().padStart(2, "0");
      const ss = sec.toString().padStart(2, "0");
      return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
    };

    const durSec = durMs > 0 ? Math.round(durMs / 1000) : 0;
    const posSec = posMs > 0 ? Math.round(posMs / 1000) : 0;

    const parts = [];
    parts.push(entryType === "audio" ? "Audio" : entryType === "title" ? "Title" : "Video");
    if (durSec > 0) parts.push(`Duration ${formatTime(durSec)}`);
    if (posSec > 0) parts.push(`Resume at ${formatTime(posSec)}`);

    if (this.metaTextEl) {
      this.metaTextEl.textContent = parts.join(" • ");
    }
  }

  async _loadPreviewSource(entryType, id) {
    if (!this.previewVideo) return;
    this.previewVideo.pause();
    this.previewVideo.style.opacity = "0";
    this.previewVideo.removeAttribute("src");
    this.previewVideo.load();

    if (entryType === "audio") {
      return; // no video preview for audio entries
    }

    const indexPath = entryType === "title" ? INDEX_TITLES : INDEX_VIDEOS;

    try {
      const filePaths = await getTitleFiles(id, indexPath).catch(() => []);
      if (!Array.isArray(filePaths) || filePaths.length === 0) {
        return;
      }
      const mainVideoPath = filePaths[0];
      const previewUrl = this._buildPreviewUrl(mainVideoPath);
      if (previewUrl) {
        this.previewVideo.src = previewUrl;
        this.previewVideo.load();
      }
    } catch (err) {
      console.warn("Failed to load preview for", id, err);
    }
  }

  _buildPreviewUrl(videoPath = "") {
    if (!videoPath) return "";
    let basePath = videoPath;
    const lower = basePath.toLowerCase();
    if (lower.includes(".")) {
      basePath = basePath.substring(0, basePath.lastIndexOf("."));
    }
    const hiddenSegment =
      basePath.substring(0, basePath.lastIndexOf("/") + 1) +
      ".hidden" +
      basePath.substring(basePath.lastIndexOf("/"));
    const previewPath = `${hiddenSegment}/preview.mp4`;
    let url = getBaseUrl?.() || "";
    previewPath.split("/").forEach((segment) => {
      const sanitized = encodeURIComponent(segment.trim());
      if (sanitized.length > 0) {
        url += `/${sanitized}`;
      }
    });
    return url;
  }

  _updateProgress() {
    if (!this.progressBar || !this.progressLabel || !this.titleData) return;

    const td = this.titleData;

    let durationMs = 0;
    if (td.duration_ms != null) {
      durationMs = Math.max(0, Math.round(Number(td.duration_ms) || 0));
    } else if (td.duration != null) {
      durationMs = Math.max(
        0,
        Math.round((Number(td.duration) || 0) * 1000)
      );
    }

    let positionMs = 0;
    if (td.position_ms != null) {
      positionMs = Math.max(0, Math.round(Number(td.position_ms) || 0));
    } else if (td.currentTime != null) {
      positionMs = Math.max(
        0,
        Math.round((Number(td.currentTime) || 0) * 1000)
      );
    } else {
      const id = td._id || td.titleId;
      if (id) {
        const cached = localStorage.getItem(id);
        const storedSeconds = cached ? Number(cached) : 0;
        if (Number.isFinite(storedSeconds) && storedSeconds > 0) {
          positionMs = Math.round(storedSeconds * 1000);
        }
      }
    }

    const percent =
      durationMs > 0
        ? Math.min(100, Math.max(0, Math.round((positionMs / durationMs) * 100)))
        : 0;

    if (durationMs <= 0 || percent <= 0) {
      this.progressBar.hidden = true;
      this.progressLabel.hidden = true;
      return;
    }

    this.progressBar.hidden = false;
    this.progressLabel.hidden = false;
    this.progressBar.value = percent;
    this.progressBar.setAttribute("value", String(percent));
    this.progressLabel.textContent = `Progress • ${percent}%`;
  }
}

customElements.define("globular-media-watching-card", MediaWatchingCard);
