import getUuidByString from "uuid-by-string";
import { displayError, displayMessage } from "@globular/backend"; // keep your notify re-exports here
import { playAudio, playAudios } from "../audio"; // single & playlist players

// ✅ Use backend wrappers (no direct *_Request or raw client calls)
import { getTitleFiles } from "@globular/backend";
import { searchAudiosByAlbum } from "./search"; // version without globule

// Polymer component imports
import "@polymer/paper-icon-button/paper-icon-button.js";
import "@polymer/iron-icon/iron-icon.js";
import "@polymer/paper-button/paper-button.js";
import "@polymer/paper-ripple/paper-ripple.js";

/**
 * Custom element to display an audio track as a card,
 * with options to play the track, play the album, or remove the card.
 */
export class SearchAudioCard extends HTMLElement {
  // Private instance properties
  _audio = null;            // The audio object displayed by the card
  _editable = false;        // Flag to enable/disable edit/delete features
  _domInitialized = false;
  _listenersBound = false;
  _closeButton = null;      // Reference to the close/remove button
  _playAlbumButton = null;
  _playTitleButton = null;
  _imageElement = null;
  _artistSpan = null;
  _albumSpan = null;
  _titleSpan = null;
  _albumHeaderBar = null;

  // Public callback for when the card is closed/deleted
  onclose = null;

  constructor() {
    super();
    this.attachShadow({ mode: "open" });
  }

  /**
   * Called when the element is inserted into the document's DOM.
   * Performs initial rendering and sets up event listeners.
   */
  connectedCallback() {
    this._ensureDomReady();
    if (this._audio) {
      this._populateCard();
      this._updateEditableState();
    }
  }

  /**
   * Renders the initial HTML structure of the audio card.
   * @private
   */
  _renderInitialStructure() {
    if (this._domInitialized) return;
    this.shadowRoot.innerHTML = `
      <style>
        #container {
          position: relative;
          background-color: var(--surface-color);
          color: var(--primary-text-color);
          min-width: 250px;
          max-width: 300px;
          box-sizing: border-box;
          border-radius: 8px;
          box-shadow: var(--shadow-elevation-2dp);
          transition: box-shadow 0.3s ease-in-out;
          overflow: hidden;
        }

        .audio-card {
          container-type: inline-size;
          container-name: audiocard;
          display: flex;
          flex-direction: column;
          border: 1px solid var(--palette-divider);
          height: calc(100% - 2px);
          border-radius: 8px;
        }

        .audio-card:hover {
          box-shadow: var(--shadow-elevation-6dp);
        }

        .audio-card img {
          width: 100%;
          min-height: 100px;
          max-height: 180px;
          object-fit: cover;
          border-top-left-radius: 8px;
          border-top-right-radius: 8px;
          display: block;
          transition: transform 0.2s ease-in-out;
        }

        .audio-card img:hover {
          cursor: pointer;
          transform: scale(1.02);
        }

        .audio-details {
          padding: 5px;
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          flex-grow: 1;
          justify-content: space-between;
        }

        #artist, #album {
          font-weight: 500;
          font-size: 1.2rem;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          width: 100%;
        }

        #title {
          font-size: 1.25rem;
          font-weight: 350;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          width: 100%;
        }

        #album { color: var(--secondary-text-color); }

        #close-btn {
          position: absolute;
          top: 0px;
          left: 0px;
          background-color: rgba(0, 0, 0, 0.6);
          --paper-icon-button-ink-color: white;
          --iron-icon-fill-color: white;
          border-bottom-right-radius: 8px;
          border-top-left-radius: 8px;
          padding: 4px;
          width: 30px;
          height: 30px;
          --iron-icon-width: 24px;
          --iron-icon-height: 24px;
          transition: opacity 0.2s ease;
          opacity: 0;
        }
        #container:hover #close-btn { opacity: 1; }

        .album-header-bar {
          display: flex;
          align-items: center;
          position: absolute;
          background-color: rgba(0, 0, 0, 0.65);
          top: 0px; left: 0px; right: 0px;
          padding: 5px;
          transform: translateY(-100%);
          transition: transform 0.2s ease;
          justify-content: space-between;
          color: white;
        }
        #container:hover .album-header-bar { transform: translateY(0); }

        .album-header-bar paper-icon-button {
          --iron-icon-fill-color: white;
        }
        .album-header-bar span {
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          flex-grow: 1;
          padding-left: 5px;
        }

        .play-buttons-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          width: 100%;
          margin-top: 5px;
        }

        .play-buttons-row paper-icon-button {
          --iron-icon-fill-color: var(--primary-color);
          width: 36px;
          height: 36px;
        }

        /* Container Queries */
        @container audiocard (max-width: 225px) {
          .audio-card img { min-height: 120px; max-height: 120px; }
          #artist, #album { font-weight: 300; font-size: .95rem; }
          #title { font-size: 1rem; font-weight: 250; }
          .album-header-bar { max-height: 30px; padding: 3px; }
          .album-header-bar paper-icon-button { height: 24px; width: 24px; }
          #close-btn {
            padding: 3px; width: 25px; height: 25px;
            --iron-icon-width: 20px; --iron-icon-height: 20px;
          }
        }

        @container audiocard (max-width: 150px) {
          .audio-card img { min-height: 80px; max-height: 80px; }
          #artist, #album { font-weight: 300; font-size: .75rem; }
          #title { font-size: .85rem; font-weight: 250; }
          .album-header-bar { max-height: 25px; }
          .album-header-bar paper-icon-button { display: none; }
          #close-btn {
            padding: 2px; width: 20px; height: 20px;
            --iron-icon-width: 16px; --iron-icon-height: 16px;
          }
        }
      </style>

      <div id="container" class="audio-card">
        <paper-icon-button icon="icons:close" id="close-btn" title="Remove audio card"></paper-icon-button>
        <img id="audio-img" alt="Album Cover">
        <div class="audio-details">
          <span id="artist"></span>
          <div class="album-header-bar">
            <span id="album"></span>
            <paper-icon-button id="play-album-btn" title="Play Album" icon="av:play-arrow"></paper-icon-button>
          </div>
          <span id="title"></span>
          <div class="play-buttons-row">
            <paper-icon-button id="play-title-btn" title="Play Track" icon="av:play-arrow"></paper-icon-button>
          </div>
        </div>
      </div>
    `;
    this._domInitialized = true;
  }

  /**
   * Retrieves references to all necessary DOM elements.
   * @private
   */
  _getDomReferences() {
    this._closeButton = this.shadowRoot.querySelector("#close-btn");
    this._imageElement = this.shadowRoot.querySelector("#audio-img");
    this._artistSpan = this.shadowRoot.querySelector("#artist");
    this._albumSpan = this.shadowRoot.querySelector("#album");
    this._titleSpan = this.shadowRoot.querySelector("#title");
    this._playAlbumButton = this.shadowRoot.querySelector("#play-album-btn");
    this._playTitleButton = this.shadowRoot.querySelector("#play-title-btn");
    this._albumHeaderBar = this.shadowRoot.querySelector(".album-header-bar");
  }

  /**
   * Binds event listeners to interactive elements.
   * @private
   */
  _bindEventListeners() {
    if (this._listenersBound) return;
    if (this._closeButton) {
      this._closeButton.addEventListener("click", this._handleCloseClick.bind(this));
    }
    if (this._imageElement) {
      this._imageElement.addEventListener("click", this._handlePlayTitleClick.bind(this));
    }
    if (this._playTitleButton) {
      this._playTitleButton.addEventListener("click", this._handlePlayTitleClick.bind(this));
    }
    if (this._playAlbumButton) {
      this._playAlbumButton.addEventListener("click", this._handlePlayAlbumClick.bind(this));
    }
    this._listenersBound = true;
  }

  _ensureDomReady() {
    if (!this._domInitialized) {
      this._renderInitialStructure();
    }
    if (!this._imageElement) {
      this._getDomReferences();
    }
    if (!this._listenersBound) {
      this._bindEventListeners();
    }
  }

  /**
   * Sets the audio object to display in the card.
   * @param {Object} audio - The audio object containing information.
   */
  setAudio(audio) {
    this._ensureDomReady();
    if (this._audio !== audio) {
      this._audio = audio;
      this._populateCard();
      this._updateEditableState();
    }
  }

  /**
   * Gets the current audio object displayed by the component.
   * @returns {Object | null}
   */
  getAudio() {
    return this._audio;
  }

  /**
   * Populates the card's content with data from the `_audio` object.
   * @private
   */
  _populateCard() {
    if (!this._audio) return;

    const poster = this._audio.getPoster?.();
    const posterUrl = poster?.getContenturl?.() || "placeholder.png";
    this._imageElement.src = posterUrl;
    this._imageElement.alt = `Cover for ${this._audio.getTitle?.() ?? ""}`;

    this._artistSpan.textContent = this._audio.getArtist?.() ?? "";
    this._titleSpan.textContent = this._audio.getTitle?.() ?? "";
    const album = (this._audio.getAlbum?.() ?? "").trim();
    this._albumSpan.textContent = album;

    // Hide album bar if album name is empty or placeholder
    if (!album || album === "<Inconnu>") {
      this._albumHeaderBar.style.display = "none";
    } else {
      this._albumHeaderBar.style.display = "flex";
    }

    // Add genres as filterable classes
    this.classList.add("filterable");
    const genres = this._audio.getGenresList?.() ?? [];
    genres.forEach((g) => {
      g.split(" ").forEach((g_) => this.classList.add(getUuidByString(g_.toLowerCase())));
    });
  }

  /**
   * Sets whether the card is in editable mode (shows close button).
   * @param {boolean} editable
   */
  setEditable(editable) {
    this._editable = !!editable;
    this._updateEditableState();
  }

  /**
   * Updates the visibility of the close button based on `_editable` state and `onclose` callback.
   * @private
   */
  _updateEditableState() {
    if (this._closeButton) {
      this._closeButton.style.display = this._editable && this.onclose ? "block" : "none";
    }
  }

  /**
   * Handles the click event for the close/remove button.
   * @param {Event} evt
   * @private
   */
  _handleCloseClick(evt) {
    evt.stopPropagation();

    if (!this._audio) {
      console.warn("No audio data to remove.");
      return;
    }

    const poster = this._audio.getPoster?.();
    const posterUrl = poster?.getContenturl?.() || "placeholder.png";
    const title = this._audio.getTitle?.() ?? "";

    const toast = displayMessage(
      `<style>
        #yes-no-audio-delete-box {
          display: flex; flex-direction: column; align-items: center; padding: 15px;
        }
        #yes-no-audio-delete-box img {
          max-height: 256px; object-fit: contain; width: 100%; margin-top: 10px; margin-bottom: 15px;
        }
        #yes-no-audio-delete-box p {
          font-size: .85rem; text-align: center; margin-bottom: 10px;
        }
        #yes-no-audio-delete-box .dialog-actions {
          display: flex; justify-content: flex-end; width: 100%; gap: 10px; margin-top: 20px;
        }
      </style>
      <div id="yes-no-audio-delete-box">
        <div>You're about to remove audio:</div>
        <img src="${posterUrl}" alt="Album Cover">
        <p>${title}</p>
        <div>Is this what you want to do?</div>
        <div class="dialog-actions">
          <paper-button raised id="yes-delete-audio">Yes</paper-button>
          <paper-button raised id="no-delete-audio">No</paper-button>
        </div>
      </div>`,
      60 * 1000
    );

    const yesBtn = toast.toastElement.querySelector("#yes-delete-audio");
    const noBtn = toast.toastElement.querySelector("#no-delete-audio");

    yesBtn.addEventListener("click", () => {
      toast.hideToast?.();
      if (this.onclose) this.onclose();
      displayMessage(
        `<div style="display: flex; flex-direction: column;">
          <span style="font-size: .85rem;">"${title}"</span>
          <span>was removed.</span>
        </div>`,
        3000
      );
    });

    noBtn.addEventListener("click", () => {
      toast.hideToast?.();
    });
  }

  /**
   * Handles playing a single track.
   * Uses backend/title.getTitleFiles and a fixed index path (cluster-transparent).
   * @private
   */
  async _handlePlayTitleClick() {
    if (!this._audio) return;

    try {
      // Cluster-transparent: client only sees a single connection.
      // Index path is logical (server resolves the real location).
      const indexPath = "/search/audios";
      const titleId = this._audio.getId?.();
      if (!titleId) throw new Error("Missing audio title id.");

      const filePaths = await getTitleFiles(titleId, indexPath); // expects an array of file paths
      if (Array.isArray(filePaths) && filePaths.length > 0) {
        const path = filePaths[0]; // Play only the first file
        // playAudio can ignore unknown tail args; pass what your player expects
        playAudio(path, null, null, this._audio);
      } else {
        displayMessage(`No file found for track "${this._audio.getTitle?.() ?? ""}".`, 3000);
      }
    } catch (err) {
      displayError(`Failed to play track: ${err?.message || err}`, 3000);
    }
  }

  /**
   * Handles playing the entire album.
   * Uses searchAudiosByAlbum (cluster-transparent).
   * @private
   */
  async _handlePlayAlbumClick() {
    if (!this._audio) return;

    const albumName = this._audio.getAlbum?.();
    if (!albumName) return;

    try {
      const indexPath = "/search/audios";
      // The helper no longer needs a globule; it's cluster-transparent.
      const audios = await searchAudiosByAlbum(albumName, indexPath);

      const filtered = (audios || []).filter((a) => a.getAlbum?.() === albumName);
      if (filtered.length > 0) {
        filtered.sort((a, b) => (a.getTracknumber?.() || 0) - (b.getTracknumber?.() || 0));
        playAudios(filtered, albumName);
      } else {
        displayMessage(`No tracks found for album "${albumName}".`, 3000);
      }
    } catch (err) {
      displayError(`Failed to play album: ${err?.message || err}`, 3000);
    }
  }
}

customElements.define("globular-search-audio-card", SearchAudioCard);
