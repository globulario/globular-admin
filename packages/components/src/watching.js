import { SearchVideoCard } from "./search/searchVideoCard.js";
import { SearchTitleCard } from "./search/searchTitleCard.js";
import "@polymer/iron-icons/iron-icons.js";
import '@polymer/iron-icons/maps-icons';
import '@polymer/paper-icon-button/paper-icon-button.js';
import {
    Backend,
    decodeJwtPayload,
    deleteOneDocument,
    displayError,
    findDocuments,
    getTitleInfo,
    getToken,
    getVideoInfo,
    getWatchingTitle as fetchWatchingTitle,
    replaceOneDocument,
} from "@globular/backend";

// --- Constants ---
const COLLECTION_WATCHING = "watching";
const DATABASE_SUFFIX = "_db";
const MEDIA_WATCHING_VIDEO_SLOT = "video";
const MEDIA_WATCHING_TITLE_SLOT = "title";
const EVENT_REMOVE_VIDEO_PLAYER = "remove_video_player_evt_";
const EVENT_PLAY_VIDEO_PLAYER = "play_video_player_evt_";
const EVENT_STOP_VIDEO_PLAYER = "stop_video_player_evt_";
const EVENT_START_PEER = "start_peer_evt_";
const EVENT_STOP_PEER = "stop_peer_evt_";
const EVENT_REMOVE_MEDIA_WATCHING_CARD = "remove_media_watching_card_";

function sanitizeIdentifierPart(value = "") {
    return value.split("@").join("_").split(".").join("_");
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

    // DOM Element References (cached in constructor/connectedCallback)
    videoDiv = null;
    titleDiv = null;
    videoTitleElement = null;
    movieTitleElement = null;
    closeBtn = null;

    // --- Constructor ---
    constructor() {
        super();
        this.attachShadow({ mode: 'open' });
        this._closable = this.getAttribute('closable') !== 'false';
        if (this._closable) {
            this.hide();
        } else {
            this.show();
        }

        this.shadowRoot.innerHTML = `
        <style>
            :host {
                padding: 10px;
                display: block;
                box-sizing: border-box;
                color: var(--on-surface-color);
            }

            #container {
                display: flex;
                flex-direction: column;
                background-color: var(--surface-elevated-color, var(--surface-color));
                color: var(--on-surface-color);
                user-select: none;
                position: absolute;
                top: 0px;
                left: 0px;
                bottom: 0px;
                right: 0px;
                overflow: hidden;
                border: 1px solid var(--border-subtle-color);
                border-radius: 12px;
            }

            #header-row {
                display: flex;
                justify-content: center;
                align-items: center;
                border-bottom: 1px solid var(--border-subtle-color);
                background-color: var(--surface-color);
                height: 42px;
            }

            #header-row h1 {
                flex-grow: 1;
                margin: 0;
                font-size: 1rem;
                margin-left: 10px;
                color: var(--on-surface-color);
            }

            #header-row paper-icon-button {
                color: var(--on-surface-color);
            }

            .section-header {
                display: flex;
                flex-direction: column;
                margin-top: 10px;
            }

            .section-header h2 {
                margin-bottom: 4px;
                margin-left: 10px;
                border-bottom: 1px solid var(--border-subtle-color);
                width: calc(100% - 20px);
                font-size: 1.4rem;
                color: var(--on-surface-color);
            }

            .media-cards {
                display: flex;
                flex-wrap: wrap;
                justify-content: space-around;
                padding: 10px;
                gap: 8px;
            }

            .empty-message {
                text-align: center;
                color: var(--secondary-text-color, var(--palette-text-secondary));
                margin: 24px 16px;
            }

            @media (max-width: 650px) {
                .media-cards {
                    justify-content: center;
                }
            }
        </style>

        <div id="container">
            <div id="header-row">
                <h1>Continue Watching...</h1>
                <paper-icon-button id="close-btn" icon="icons:close"></paper-icon-button>
            </div>

            <div style="display: flex; flex-direction: column; flex-grow: 1; overflow-y: auto;">
                <div id="empty-message" class="empty-message">Nothing in watching yet. Start playing videos to populate this list.</div>
                <div id="video-section" class="section-header" style="display: none;">
                    <h2 id="video-title">Video(s)</h2>
                    <div class="media-cards">
                        <slot name="${MEDIA_WATCHING_VIDEO_SLOT}"></slot>
                    </div>
                </div>
                
                <div id="title-section" class="section-header" style="display: none;">
                    <h2 id="movie-title">Title(s)</h2>
                    <div class="media-cards">
                        <slot name="${MEDIA_WATCHING_TITLE_SLOT}"></slot>
                    </div>
                </div>
            </div>
        </div>
        `;

        // Cache DOM elements
        this.videoDiv = this.shadowRoot.getElementById('video-section');
        this.titleDiv = this.shadowRoot.getElementById('title-section');
        this.videoTitleElement = this.shadowRoot.getElementById('video-title');
        this.movieTitleElement = this.shadowRoot.getElementById('movie-title');
        this.closeBtn = this.shadowRoot.getElementById('close-btn');
        this.emptyMessage = this.shadowRoot.getElementById('empty-message');

        if (!this._closable) {
            this.closeBtn.style.display = 'none';
        }
    }

    // --- Lifecycle Callbacks ---
    connectedCallback() {
        if (this._closable) {
            this.closeBtn?.addEventListener('click', this._handleCloseClick);
        }
    }

    disconnectedCallback() {
        // Clean up close button listener if element is removed from DOM directly
        if (this._closable) {
            this.closeBtn?.removeEventListener('click', this._handleCloseClick);
        }
        // Any other component-specific cleanup
    }

    // --- Private Event Handlers ---
    _handleCloseClick = () => {
        this.hide();
    };

    show() {
        this.style.display = 'block';
        this.removeAttribute('hidden');
    }

    hide() {
        if (!this._closable) return;
        this.style.display = 'none';
        this.setAttribute('hidden', '');
        if (this.parentNode) {
            this.parentNode.removeChild(this);
        }
        if (this.onClose) {
            this.onClose();
        }
    }

    /**
     * Appends a title/video to the "Continue Watching" list.
     * @param {object} title - The title/video object with _id, isVideo, domain, etc.
     * @param {function} [callback] - Optional callback on success.
     * @param {function} [errorCallback] - Optional callback on error.
     */
    async appendTitle(title, callback, errorCallback) {
        if (!getUserContext()) {
            // Cannot append if not logged in
            if (errorCallback) errorCallback(new Error("User not authenticated."));
            return;
        }

        // Check if card already exists
        if (this.querySelector(`#_${title._id}`)) {
            this._updateSectionCounts(); // Just update counts if already exists
            if (callback) callback();
            return;
        }

        const card = new MediaWatchingCard();
        card.id = `_${title._id}`; // Set ID on the card itself for easy lookup

        try {
            await new Promise((resolve, reject) => {
                card.setTitle(title, resolve, reject);
            });

            this.appendChild(card);
            card.slot = title.isVideo ? MEDIA_WATCHING_VIDEO_SLOT : MEDIA_WATCHING_TITLE_SLOT;

            this._updateSectionCounts();

            // Subscribe to removal event for this specific card
            Backend.eventHub.subscribe(
                EVENT_REMOVE_VIDEO_PLAYER,
                (uuid) => { card._removeVideoSubscriptionId = uuid; },
                (evt) => {
                    if (title._id === evt._id) {
                        if (card && card.parentNode) {
                            card.parentNode.removeChild(card);
                            this._updateSectionCounts(); // Update counts after removal
                        }
                        if (card._removeVideoSubscriptionId) {
                            Backend.eventHub.unsubscribe(EVENT_REMOVE_VIDEO_PLAYER, card._removeVideoSubscriptionId);
                            delete card._removeVideoSubscriptionId;
                        }
                    }
                },
                true,
                card
            ); // persistent: true

            if (callback) callback();
        } catch (err) {
            console.error(`Failed to append title ${title._id}:`, err);
            if (errorCallback) errorCallback(err);
        }
    }

    /** Updates the displayed counts for video and title sections. */
    _updateSectionCounts() {
        const videoCount = this.querySelectorAll(`[slot="${MEDIA_WATCHING_VIDEO_SLOT}"]`).length;
        const titleCount = this.querySelectorAll(`[slot="${MEDIA_WATCHING_TITLE_SLOT}"]`).length;

        this.videoDiv.style.display = videoCount > 0 ? "flex" : "none";
        this.videoTitleElement.innerHTML = `Video(s)${videoCount > 0 ? ` (${videoCount})` : ''}`;

        this.titleDiv.style.display = titleCount > 0 ? "flex" : "none";
        this.movieTitleElement.innerHTML = `Title(s)${titleCount > 0 ? ` (${titleCount})` : ''}`;

        const hasEntries = videoCount > 0 || titleCount > 0;
        if (this.emptyMessage) {
            this.emptyMessage.style.display = hasEntries ? "none" : "block";
        }
    }
}

customElements.define('globular-media-watching', MediaWatching);


export class MediaWatchingCard extends HTMLElement {
    // --- Class Properties ---
    titleData = null; // Stores the actual title/video object

    // DOM Element References (cached in constructor)
    titleDateElement = null;
    closeButton = null;

    // --- Constructor ---
    constructor() {
        super();
        this.attachShadow({ mode: 'open' });

        this.shadowRoot.innerHTML = `
        <style>
            :host {
                display: block;
                margin: 5px;
            }
            #container {
                display: flex;
                flex-direction: column;
                padding: 16px;
                border-radius: 12px;
                background-color: var(--surface-color);
                color: var(--on-surface-color);
                border: 1px solid var(--border-subtle-color);
                box-shadow: 0 6px 18px color-mix(in srgb, var(--on-surface-color) 12%, transparent);
            }

            #header-line {
                display: flex;
                align-items: center;
                margin-bottom: 8px;
            }

            #header-line paper-icon-button {
                color: var(--on-surface-color);
            }

            #title-date {
                flex-grow: 1;
                text-align: right;
                user-select: none;
                font-size: 0.95rem;
                color: var(--secondary-text-color, var(--palette-text-secondary));
            }
        </style>

        <div id="container">
            <div id="header-line">
                <paper-icon-button id="close-card-btn" icon="icons:close"></paper-icon-button>
                <span id="title-date"></span>
            </div>
            <slot></slot>
        </div>
        `;

        // Cache DOM elements
        this.titleDateElement = this.shadowRoot.querySelector("#title-date");
        this.closeButton = this.shadowRoot.querySelector("#close-card-btn");

        // Setup event listener
        this.closeButton.addEventListener('click', this._handleCloseClick);
    }

    // --- Lifecycle Callbacks ---
    connectedCallback() {
        // No specific setup here, data is set via setTitle
    }

    disconnectedCallback() {
        // Clean up close button listener
        this.closeButton.removeEventListener('click', this._handleCloseClick);
        // Unsubscribe from specific event hub listeners if any specific to this card
        if (this.titleData) {
            Backend.eventHub.unsubscribe(EVENT_REMOVE_MEDIA_WATCHING_CARD + this.titleData._id, `card_remove_${this.titleData._id}`);
        }
    }

    // --- Private Event Handlers ---
    _handleCloseClick = () => {
        if (this.titleData) {
            // Publish event to signal this card should be removed (handled by WatchingMenu/MediaWatching)
            Backend.eventHub.publish(EVENT_REMOVE_VIDEO_PLAYER, this.titleData, true);
        }
    };

    /**
     * Sets the title/video data for the card and appends the appropriate search card.
     * @param {object} titleData - The title/video object.
     * @param {function} [callback] - Optional callback on success.
     * @param {function} [errorCallback] - Optional callback on error.
     */
    async setTitle(titleData, callback, errorCallback) {
        this.titleData = titleData; // Store the data

        // Display last view date
        const lastView = new Date(titleData.date);
        this.titleDateElement.innerHTML = `${lastView.toLocaleDateString()} ${lastView.toLocaleTimeString()}`;

        try {
            let mediaCard = null;

            if (titleData.isVideo) {
                const video = await getVideoInfo(titleData._id);
                if (!video) {
                    throw new Error(`Unable to load video ${titleData._id}`);
                }
                mediaCard = new SearchVideoCard();
                mediaCard.id = `_${video.getId ? video.getId() : titleData._id}`;
                mediaCard.setVideo(video);
            } else {
                const title = await getTitleInfo(titleData._id);
                if (!title) {
                    throw new Error(`Unable to load title ${titleData._id}`);
                }
                mediaCard = new SearchTitleCard();
                mediaCard.id = `_${title.getId ? title.getId() : titleData._id}`;
                mediaCard.setTitle(title);
            }

            if (mediaCard) {
                this.innerHTML = ''; // Clear previous slot content
                this.appendChild(mediaCard);
                if (callback) callback();
            } else {
                throw new Error("Failed to create media card.");
            }
        } catch (err) {
            console.error(`Error setting title for MediaWatchingCard (${titleData._id}):`, err);
            if (err && err.message) {
                displayError(err.message, 4000);
            }
            if (errorCallback) errorCallback(err);
        }
    }
}

customElements.define('globular-media-watching-card', MediaWatchingCard);


export class WatchingMenu extends HTMLElement {
    // --- Class Properties ---
    mediaWatchingInstance = null; // Reference to the globally available MediaWatching component
    onClose = null; // Callback for when MediaWatching is closed via its own close button

    // --- Constructor ---
    constructor() {
        super();
        this.attachShadow({ mode: 'open' });

        this.shadowRoot.innerHTML = `
        <style>
            :host {
                height: 24px;
                display: flex;
                align-items: center;
                justify-content: center;
                cursor: pointer;
                color: var(--on-surface-color);
            }

            iron-icon {
                color: inherit;
                transition: opacity 0.2s ease;
            }
/*
            :host(:hover) iron-icon {
                color: var(--palette-primary);
                opacity: 0.85;
            }
            */
        </style>

        <iron-icon title="Watching" icon="maps:local-movies"></iron-icon>
        `   ;
        // Attempt to get existing MediaWatching instance or initialize a new one
        this.mediaWatchingInstance = document.querySelector("globular-media-watching");

        // Setup click listener for the menu button
        this.addEventListener('click', this._handleMenuClick);

        // Initialize watching titles if MediaWatching is not yet in DOM (meaning this is the first WatchingMenu instance)
        if (!this.mediaWatchingInstance) {
            this.init();
        }
    }

    // --- Lifecycle Callbacks ---
    connectedCallback() {
        // No additional setup needed here beyond constructor
    }

    disconnectedCallback() {
        // Remove click listener
        this.removeEventListener('click', this._handleMenuClick);

        // Unsubscribe from all global event hub listeners managed by this instance
        Backend.eventHub.unsubscribe(EVENT_START_PEER, this._peerStartSubscriptionId);
        Backend.eventHub.unsubscribe(EVENT_STOP_PEER, this._peerStopSubscriptionId);
        Backend.eventHub.unsubscribe(EVENT_PLAY_VIDEO_PLAYER, this._playVideoSubscriptionId);
        Backend.eventHub.unsubscribe(EVENT_STOP_VIDEO_PLAYER, this._stopVideoSubscriptionId);
        Backend.eventHub.unsubscribe(EVENT_REMOVE_VIDEO_PLAYER, this._removeVideoSubscriptionId);
    }

    // --- Private Event Handlers ---
    _handleMenuClick = async () => {
        const watcher = await this._ensureMediaWatching();
        if (!watcher) return;
        watcher.show();

        const openMediaWatchingEvt = new CustomEvent("open-media-watching", {
            bubbles: true,
            composed: true,
            detail: {
                mediaWatching: watcher
            }
        });
        this.dispatchEvent(openMediaWatchingEvt);
    };

    async _ensureMediaWatching() {
        if (!this.mediaWatchingInstance) {
            await this.init();
        }
        return this.mediaWatchingInstance;
    }

    // --- Core Logic Methods ---

    /**
     * Initializes the MediaWatching component and sets up global event listeners
     * for real-time updates of watching titles.
     */
    async init() {
        // Create MediaWatching instance if it doesn't exist yet
        if (!this.mediaWatchingInstance) {
            this.mediaWatchingInstance = new MediaWatching();
            // Set the onclose callback for the MediaWatching instance
            this.mediaWatchingInstance.onClose = this.onClose; // Pass the external callback
            // Append it to the body (it will be styled by its parent when slotted)
            document.body.appendChild(this.mediaWatchingInstance);
        }

        // Subscribe to global event hub events
        Backend.eventHub.subscribe(
            EVENT_START_PEER,
            (uuid) => { this._peerStartSubscriptionId = uuid; },
            this._handlePeerStart,
            true,
            this
        );
        Backend.eventHub.subscribe(
            EVENT_STOP_PEER,
            (uuid) => { this._peerStopSubscriptionId = uuid; },
            this._handlePeerStop,
            true,
            this
        );
        Backend.eventHub.subscribe(
            EVENT_PLAY_VIDEO_PLAYER,
            (uuid) => { this._playVideoSubscriptionId = uuid; },
            this._handlePlayVideoEvent,
            true,
            this
        );
        Backend.eventHub.subscribe(
            EVENT_STOP_VIDEO_PLAYER,
            (uuid) => { this._stopVideoSubscriptionId = uuid; },
            this._handleStopVideoEvent,
            true,
            this
        );
        Backend.eventHub.subscribe(
            EVENT_REMOVE_VIDEO_PLAYER,
            (uuid) => { this._removeVideoSubscriptionId = uuid; },
            this._handleRemoveVideoEvent,
            true,
            this
        );

        // Load initial watching titles
        await this._loadInitialWatchingTitles();
    }

    _handlePeerStart = async (peer) => {
        // Re-fetch watching titles when a peer starts, indicating new data might be available
        await this._loadInitialWatchingTitles();
    };

    _handlePeerStop = (peer) => {
        // If a peer stops, remove relevant watching cards
        Backend.eventHub.publish(`${EVENT_REMOVE_MEDIA_WATCHING_CARD}${peer.getDomain()}.${peer.getDomain()}_evt_`, {}, true);
        // Consider re-loading titles or more granular cleanup if needed
    };

    _handlePlayVideoEvent = async (eventData) => {
        await this.saveWatchingTitle(eventData);
    };

    _handleStopVideoEvent = async (eventData) => {
        await this.saveWatchingTitle(eventData);
        // Append title to watching list after stopping (if not already there)
        await this.mediaWatchingInstance.appendTitle(eventData); // Assuming MediaWatching handles duplicates
    };

    _handleRemoveVideoEvent = async (eventData) => {
        await this.removeWatchingTitle(eventData);
        // The MediaWatching component itself is subscribed to this event to remove the card
    };


    /** Loads and appends initial watching titles to MediaWatching. */
    async _loadInitialWatchingTitles() {
        try {
            const titles = await this.getWatchingTitles();
            // Clear existing titles in MediaWatching to prevent duplicates on reload
            this.mediaWatchingInstance.querySelectorAll(`[slot="${MEDIA_WATCHING_VIDEO_SLOT}"]`).forEach(el => el.remove());
            this.mediaWatchingInstance.querySelectorAll(`[slot="${MEDIA_WATCHING_TITLE_SLOT}"]`).forEach(el => el.remove());

            for (const title of titles) {
                // localStorage.setItem(title._id, title.currentTime); // Handled by saveWatchingTitle
                await this.mediaWatchingInstance.appendTitle(title);
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
        const ctx = getUserContext();
        if (!ctx) return [];

        const dbId = `${sanitizeIdentifierPart(ctx.username)}${DATABASE_SUFFIX}`;

        try {
            const docs = await findDocuments({
                connectionId: dbId,
                database: dbId,
                collection: COLLECTION_WATCHING,
                query: "{}",
            });
            return Array.isArray(docs) ? docs : [];
        } catch (error) {
            console.error("Error fetching watching titles:", error);
            displayError(`Failed to get watching titles: ${error.message}`);
            return [];
        }
    }

    /**
     * Retrieves information for a specific watching title.
     * This method is a wrapper around TitleController.getWacthingTitle.
     * @param {string} titleId - The ID of the title to retrieve.
     * @returns {Promise<object>} A promise that resolves with the watching title object.
     */
    async getWatchingTitle(titleId) {
        if (!titleId) {
            throw new Error("Missing title id.");
        }
        try {
            if (typeof fetchWatchingTitle === "function") {
                return await fetchWatchingTitle(titleId);
            }
            throw new Error("Watching title lookup is not available.");
        } catch (err) {
            displayError(err?.message || "Failed to get watching title.", 3000);
            throw err;
        }
    }

    /**
     * Removes a watching title from the user's history.
     * @param {object} title - The title object to remove.
     * @returns {Promise<void>}
     */
    async removeWatchingTitle(title) {
        const ctx = getUserContext();
        if (!ctx) return;

        const dbId = `${sanitizeIdentifierPart(ctx.username)}${DATABASE_SUFFIX}`;

        localStorage.removeItem(title._id);

        try {
            await deleteOneDocument({
                connectionId: dbId,
                database: dbId,
                collection: COLLECTION_WATCHING,
                query: `{"_id":"${title._id}"}`,
            });
            console.log(`Watching title ${title._id} removed from backend.`);
        } catch (err) {
            if (!err.message || !err.message.includes("not found")) {
                displayError(`Failed to remove watching title ${title._id}: ${err.message}`, 3000);
            } else {
                console.warn(`Watching title ${title._id} already removed or not found.`);
            }
        }
    }

    /**
     * Saves or updates a watching title in the user's history.
     * @param {object} title - The title object to save.
     * @returns {Promise<void>}
     */
    async saveWatchingTitle(title) {
        const ctx = getUserContext();
        if (!ctx) return;

        const dbId = `${sanitizeIdentifierPart(ctx.username)}${DATABASE_SUFFIX}`;

        if (!title || !title._id) {
            displayError("Cannot save watching history: missing title identifier.", 3000);
            return;
        }

        if (!title.domain && ctx.domain) {
            title.domain = ctx.domain;
        }

        const currentTimeValue = typeof title.currentTime === "number" ? title.currentTime : 0;
        localStorage.setItem(title._id, currentTimeValue.toString());

        try {
            await replaceOneDocument({
                connectionId: dbId,
                database: dbId,
                collection: COLLECTION_WATCHING,
                query: `{"_id":"${title._id}"}`,
                value: JSON.stringify({ ...title, currentTime: currentTimeValue, date: title.date || new Date() }),
                options: `[{"upsert": true}]`,
            });
            console.log(`Watching title ${title._id} saved/updated.`);
        } catch (err) {
            displayError(`Failed to save watching title ${title._id}: ${err.message}`, 3000);
        }
    }
}

customElements.define('globular-watching-menu', WatchingMenu);
