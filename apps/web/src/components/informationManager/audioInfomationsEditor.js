// deps
import { EditableStringList } from "../list";
import { PermissionsManager } from "../permissionManager/permissionManager";
import { displayError, displaySuccess } from "../../backend/ui/notify";
import { createOrUpdateAudio, invalidateFileCaches } from "../../backend/media/title";
import { getTitleFilePaths } from "./titleInfo.js";

import "@polymer/paper-input/paper-input.js";
import "@polymer/paper-icon-button/paper-icon-button.js";
import "@polymer/iron-collapse/iron-collapse.js";
import "@polymer/paper-button/paper-button.js";
import "@polymer/iron-autogrow-textarea/iron-autogrow-textarea.js";
import "../image.js";

// protos
import { Poster } from "globular-web-client/title/title_pb";

/**
 * <globular-audio-info-editor> — edit audio metadata with permissions.
 */
export class AudioInfoEditor extends HTMLElement {
  _audio = null;                 // expected: proto-like object with getters/setters
  _audioInfosDisplay = null;     // component to return to
  _permissionManager = null;

  // refs
  _imageSelector = null;

  _audioIdDiv = null;           _audioIdInput = null;           _editAudioIdBtn = null;
  _audioUrlDiv = null;          _audioUrlInput = null;          _editAudioUrlBtn = null;
  _audioTitleDiv = null;        _audioTitleInput = null;        _editAudioTitleBtn = null;
  _audioArtistDiv = null;       _audioArtistInput = null;       _editAudioArtistBtn = null;
  _audioAlbumArtistDiv = null;  _audioAlbumArtistInput = null;  _editAudioAlbumArtistBtn = null;
  _audioComposerDiv = null;     _audioComposerInput = null;     _editAudioComposerBtn = null;
  _audioAlbumDiv = null;        _audioAlbumInput = null;        _editAudioAlbumBtn = null;
  _audioCommentDiv = null;      _audioCommentInput = null;      _editAudioCommentBtn = null;
  _audioLyricsDiv = null;       _audioLyricsInput = null;       _editAudioLyricsBtn = null;
  _audioYearDiv = null;         _audioYearInput = null;         _editAudioYearBtn = null;
  _audioDiscNumberDiv = null;   _audioDiscNumberInput = null;   _editAudioDiscNumberBtn = null;
  _audioDiscTotalDiv = null;    _audioDiscTotalInput = null;    _editAudioDiscTotalBtn = null;
  _audioTrackNumberDiv = null;  _audioTrackNumberInput = null;  _editAudioTrackNumberBtn = null;
  _audioTrackTotalDiv = null;   _audioTrackTotalInput = null;   _editAudioTrackTotalBtn = null;

  _audioGenresDiv = null;       _audioGenresList = null;

  _editPermissionsBtn = null;
  _collapsePanel = null;
  _saveButton = null;
  _cancelButton = null;

  constructor(audio, audioInfosDisplay) {
    super();
    this.attachShadow({ mode: "open" });
    this._audio = audio ?? null;
    this._audioInfosDisplay = audioInfosDisplay ?? null;

    this._render();
    this._cacheRefs();
    this._bind();
    this._initPermissionsManager();
    this._populate();
  }

  connectedCallback() {
    // No-op (all done in constructor). Keep here if you later need focus, etc.
  }

  // ---- public API ----
  set audio(a) {
    if (this._audio !== a) {
      this._audio = a;
      this._populate();
      this._initPermissionsManager();
    }
  }
  get audio() { return this._audio; }

  set audioInfosDisplay(el) { this._audioInfosDisplay = el; }
  get audioInfosDisplay() { return this._audioInfosDisplay; }

  // ---- internals ----
  _render() {
    const coverUrl =
      this._audio?.getPoster?.()?.getContenturl?.() ??
      this._audio?.posterUrl ??
      "";

    this.shadowRoot.innerHTML = `
      <style>
        :host { display:block; }
        #container {
          display:flex;
          flex-direction:column;
          margin:15px 0;
          padding:0 15px;
          box-sizing:border-box;
          height:100%;
          min-height:0;
        }
        #content {
          flex:1 1 auto;
          display:flex;
          flex-direction:column;
          min-height:0;
          gap:10px;
        }
        #header {
          display:flex;
          align-items:center;
          gap:.5rem;
        }
        #header-text {
          font-size:1.2rem;
          font-weight:600;
        }
        .content-scroll {
          flex:1 1 auto;
          display:flex;
          gap:20px;
          min-height:0;
          overflow:auto;
          padding-bottom:10px;
        }
        .image-column {
          display:flex;
          flex-direction:column;
          align-items:center;
          flex-shrink:0;
          min-width:150px;
        }
        .info-column {
          flex:1 1 auto;
          display:flex;
          flex-direction:column;
          min-width:280px;
        }
        .info-table {
          display:table;
          width:100%;
          border-collapse:collapse;
        }
        .info-row {
          display:table-row;
          border-bottom:1px solid var(--palette-divider, #ddd);
        }
        .info-row:last-child {
          border-bottom:none;
        }
        .label {
          display:table-cell;
          font-weight:600;
          padding:8px 10px 8px 0;
          min-width:120px;
          vertical-align:middle;
        }
        .value-display {
          display:table-cell;
          width:100%;
          padding:8px 0;
          vertical-align:middle;
        }
        .input-field {
          display:table-cell;
          width:100%;
          padding:8px 0;
          vertical-align:middle;
        }
        .input-field.hidden {
          display:none;
        }
        paper-input,
        iron-autogrow-textarea {
          width:100%;
        }
        .button-cell {
          display:table-cell;
          vertical-align:middle;
          width:48px;
          text-align:center;
        }
        .action-div {
          display:flex;
          align-items:center;
          justify-content:flex-end;
          gap:10px;
          border-top:1px solid var(--palette-divider, #ddd);
          padding:12px 0;
          margin-top:auto;
          position:sticky;
          bottom:0;
          z-index:2;
          background:var(--surface-elevated-color, var(--surface-color));
        }
        paper-button {
          background:var(--primary-color);
          color:var(--on-primary-color);
          padding:8px 16px;
          border-radius:4px;
        }
        paper-button:hover { background:var(--primary-dark-color); }
        paper-icon-button {
          --paper-icon-button-ink-color:var(--primary-color);
        }
        iron-collapse {
          display:flex;
          flex-direction:column;
          margin-top:10px;
        }
        @media (max-width:600px) {
          .content-scroll {
            flex-direction:column;
          }
          .image-column {
            min-width:auto;
          }
        }
      </style>

      <div id="container">
        <div id="content">
          <div id="header">
            <div id="header-text">Audio Information</div>
          </div>

          <div class="content-scroll">
            <div class="image-column">
              <globular-image-selector id="image-selector" label="Cover" url="${coverUrl}"></globular-image-selector>
            </div>

            <div class="info-column">
              <div class="info-table">
                <div class="info-row" style="border-bottom:1px solid var(--palette-divider, #ddd)">
                  <div class="label">Audio Details</div>
                  <div class="value-display"></div>
                  <div class="button-cell"></div>
                </div>

                ${this._row("Id", "audio-id")}
                ${this._row("Url", "audio-url")}
                ${this._row("Title", "audio-title")}
                ${this._row("Artist", "audio-artist")}
                ${this._row("Album Artist", "audio-album-artist")}
                ${this._row("Composer", "audio-composer")}
                ${this._row("Album", "audio-album")}
                ${this._rowArea("Comment", "audio-comment")}
                ${this._rowArea("Lyrics", "audio-lyrics")}
                ${this._rowNum("Year", "audio-year")}
                ${this._rowNum("Disc Number", "audio-disc-number")}
                ${this._rowNum("Disc Total", "audio-disc-total")}
                ${this._rowNum("Track Number", "audio-track-number")}
                ${this._rowNum("Track Total", "audio-track-total")}

                <div class="info-row">
                  <div class="label">Genres:</div>
                  <div class="value-display" id="audio-genres-div"></div>
                  <div class="input-field hidden"></div>
                  <div class="button-cell"></div>
                </div>
              </div>
            </div>
          </div>

          <iron-collapse id="collapse-panel"></iron-collapse>
        </div>

        <div class="action-div">
          <paper-button id="edit-permissions-btn" title="Set who can edit this audio information">Permissions</paper-button>
          <span style="flex:1 1 auto;"></span>
          <paper-button id="save-indexation-btn">Save</paper-button>
          <paper-button id="cancel-indexation-btn">Cancel</paper-button>
        </div>
      </div>
    `;
  }

  _row(label, key) {
    return `
      <div class="info-row">
        <div class="label">${label}:</div>
        <div class="value-display" id="${key}-div"></div>
        <div class="input-field hidden">
          <paper-input id="${key}-input" no-label-float></paper-input>
        </div>
        <div class="button-cell">
          <paper-icon-button id="edit-${key}-btn" icon="image:edit"></paper-icon-button>
        </div>
      </div>
    `;
  }

  _rowNum(label, key) {
    return `
      <div class="info-row">
        <div class="label">${label}:</div>
        <div class="value-display" id="${key}-div"></div>
        <div class="input-field hidden">
          <paper-input id="${key}-input" type="number" no-label-float></paper-input>
        </div>
        <div class="button-cell">
          <paper-icon-button id="edit-${key}-btn" icon="image:edit"></paper-icon-button>
        </div>
      </div>
    `;
  }

  _rowArea(label, key) {
    return `
      <div class="info-row">
        <div class="label">${label}:</div>
        <div class="value-display" id="${key}-div"></div>
        <div class="input-field hidden">
          <iron-autogrow-textarea id="${key}-input" no-label-float></iron-autogrow-textarea>
        </div>
        <div class="button-cell">
          <paper-icon-button id="edit-${key}-btn" icon="image:edit"></paper-icon-button>
        </div>
      </div>
    `;
  }

  _cacheRefs() {
    const $ = (id) => this.shadowRoot.getElementById(id);

    this._imageSelector = $("image-selector");

    this._audioIdDiv = $("audio-id-div");                   this._audioIdInput = $("audio-id-input");                   this._editAudioIdBtn = $("edit-audio-id-btn");
    this._audioUrlDiv = $("audio-url-div");                 this._audioUrlInput = $("audio-url-input");                 this._editAudioUrlBtn = $("edit-audio-url-btn");
    this._audioTitleDiv = $("audio-title-div");             this._audioTitleInput = $("audio-title-input");             this._editAudioTitleBtn = $("edit-audio-title-btn");
    this._audioArtistDiv = $("audio-artist-div");           this._audioArtistInput = $("audio-artist-input");           this._editAudioArtistBtn = $("edit-audio-artist-btn");
    this._audioAlbumArtistDiv = $("audio-album-artist-div");this._audioAlbumArtistInput = $("audio-album-artist-input");this._editAudioAlbumArtistBtn = $("edit-audio-album-artist-btn");
    this._audioComposerDiv = $("audio-composer-div");       this._audioComposerInput = $("audio-composer-input");       this._editAudioComposerBtn = $("edit-audio-composer-btn");
    this._audioAlbumDiv = $("audio-album-div");             this._audioAlbumInput = $("audio-album-input");             this._editAudioAlbumBtn = $("edit-audio-album-btn");
    this._audioCommentDiv = $("audio-comment-div");         this._audioCommentInput = $("audio-comment-input");         this._editAudioCommentBtn = $("edit-audio-comment-btn");
    this._audioLyricsDiv = $("audio-lyrics-div");           this._audioLyricsInput = $("audio-lyrics-input");           this._editAudioLyricsBtn = $("edit-audio-lyrics-btn");
    this._audioYearDiv = $("audio-year-div");               this._audioYearInput = $("audio-year-input");               this._editAudioYearBtn = $("edit-audio-year-btn");
    this._audioDiscNumberDiv = $("audio-disc-number-div");  this._audioDiscNumberInput = $("audio-disc-number-input");  this._editAudioDiscNumberBtn = $("edit-audio-disc-number-btn");
    this._audioDiscTotalDiv = $("audio-disc-total-div");    this._audioDiscTotalInput = $("audio-disc-total-input");    this._editAudioDiscTotalBtn = $("edit-audio-disc-total-btn");
    this._audioTrackNumberDiv = $("audio-track-number-div");this._audioTrackNumberInput = $("audio-track-number-input");this._editAudioTrackNumberBtn = $("edit-audio-track-number-btn");
    this._audioTrackTotalDiv = $("audio-track-total-div");  this._audioTrackTotalInput = $("audio-track-total-input");  this._editAudioTrackTotalBtn = $("edit-audio-track-total-btn");

    this._audioGenresDiv = $("audio-genres-div");

    this._editPermissionsBtn = $("edit-permissions-btn");
    this._collapsePanel = $("collapse-panel");
    this._saveButton = $("save-indexation-btn");
    this._cancelButton = $("cancel-indexation-btn");
  }

  _bind() {
    // image selector
    if (this._imageSelector) {
      this._imageSelector.ondelete = () => {
        if (this._audio?.getPoster?.()) this._audio.getPoster().setContenturl("");
      };
      this._imageSelector.onselectimage = (url) => {
        if (!this._audio) return;
        if (!this._audio.getPoster?.()) this._audio.setPoster(new Poster());
        this._audio.getPoster().setContenturl(url || "");
      };
    }

    // actions
    this._cancelButton?.addEventListener("click", () => this._handleCancel());
    this._saveButton?.addEventListener("click", () => this._handleSave());
    this._editPermissionsBtn?.addEventListener("click", () => this._handlePermissionsToggle());

    // field wiring
    this._wireEditable(this._audioIdDiv,          this._audioIdInput,          this._editAudioIdBtn,          "setId");
    this._wireEditable(this._audioUrlDiv,         this._audioUrlInput,         this._editAudioUrlBtn,         "setUrl");
    this._wireEditable(this._audioTitleDiv,       this._audioTitleInput,       this._editAudioTitleBtn,       "setTitle");
    this._wireEditable(this._audioArtistDiv,      this._audioArtistInput,      this._editAudioArtistBtn,      "setArtist");
    this._wireEditable(this._audioAlbumArtistDiv, this._audioAlbumArtistInput, this._editAudioAlbumArtistBtn, "setAlbumartist");
    this._wireEditable(this._audioComposerDiv,    this._audioComposerInput,    this._editAudioComposerBtn,    "setComposer");
    this._wireEditable(this._audioAlbumDiv,       this._audioAlbumInput,       this._editAudioAlbumBtn,       "setAlbum");
    this._wireEditable(this._audioCommentDiv,     this._audioCommentInput,     this._editAudioCommentBtn,     "setComment", "textarea");
    this._wireEditable(this._audioLyricsDiv,      this._audioLyricsInput,      this._editAudioLyricsBtn,      "setLyrics",  "textarea");
    this._wireEditable(this._audioYearDiv,        this._audioYearInput,        this._editAudioYearBtn,        "setYear", "number");
    this._wireEditable(this._audioDiscNumberDiv,  this._audioDiscNumberInput,  this._editAudioDiscNumberBtn,  "setDiscnumber", "number");
    this._wireEditable(this._audioDiscTotalDiv,   this._audioDiscTotalInput,   this._editAudioDiscTotalBtn,   "setDisctotal", "number");
    this._wireEditable(this._audioTrackNumberDiv, this._audioTrackNumberInput, this._editAudioTrackNumberBtn, "setTracknumber", "number");
    this._wireEditable(this._audioTrackTotalDiv,  this._audioTrackTotalInput,  this._editAudioTrackTotalBtn,  "setTracktotal", "number");
  }

  _populate() {
    if (!this._audio) return;

    const get = (fn, fallback = "") => {
      try { return typeof fn === "function" ? fn.call(this._audio) ?? fallback : fallback; }
      catch { return fallback; }
    };

    // image
    if (this._imageSelector) {
      const posterUrl = get(this._audio.getPoster)?.getContenturl?.() ?? "";
      this._imageSelector.url = posterUrl || "";
    }

    // text fields
    this._assign(this._audioIdDiv,          get(this._audio.getId));
    this._assignInput(this._audioIdInput,   get(this._audio.getId));

    this._assign(this._audioUrlDiv,         get(this._audio.getUrl));
    this._assignInput(this._audioUrlInput,  get(this._audio.getUrl));

    this._assign(this._audioTitleDiv,       get(this._audio.getTitle));
    this._assignInput(this._audioTitleInput,get(this._audio.getTitle));

    this._assign(this._audioArtistDiv,      get(this._audio.getArtist));
    this._assignInput(this._audioArtistInput,get(this._audio.getArtist));

    this._assign(this._audioAlbumArtistDiv, get(this._audio.getAlbumartist) ?? get(this._audio.getAlbumArtist));
    this._assignInput(this._audioAlbumArtistInput, get(this._audio.getAlbumartist) ?? get(this._audio.getAlbumArtist));

    this._assign(this._audioComposerDiv,    get(this._audio.getComposer));
    this._assignInput(this._audioComposerInput, get(this._audio.getComposer));

    this._assign(this._audioAlbumDiv,       get(this._audio.getAlbum));
    this._assignInput(this._audioAlbumInput, get(this._audio.getAlbum));

    this._assign(this._audioCommentDiv,     get(this._audio.getComment));
    this._assignInput(this._audioCommentInput, get(this._audio.getComment));

    this._assign(this._audioLyricsDiv,      get(this._audio.getLyrics));
    this._assignInput(this._audioLyricsInput, get(this._audio.getLyrics));

    this._assign(this._audioYearDiv,        get(this._audio.getYear));
    this._assignInput(this._audioYearInput, get(this._audio.getYear));

    this._assign(this._audioDiscNumberDiv,  get(this._audio.getDiscnumber) ?? get(this._audio.getDiscNumber));
    this._assignInput(this._audioDiscNumberInput, get(this._audio.getDiscnumber) ?? get(this._audio.getDiscNumber));

    this._assign(this._audioDiscTotalDiv,   get(this._audio.getDisctotal) ?? get(this._audio.getDiscTotal));
    this._assignInput(this._audioDiscTotalInput, get(this._audio.getDisctotal) ?? get(this._audio.getDiscTotal));

    this._assign(this._audioTrackNumberDiv, get(this._audio.getTracknumber) ?? get(this._audio.getTrackNumber));
    this._assignInput(this._audioTrackNumberInput, get(this._audio.getTracknumber) ?? get(this._audio.getTrackNumber));

    this._assign(this._audioTrackTotalDiv,  get(this._audio.getTracktotal) ?? get(this._audio.getTrackTotal));
    this._assignInput(this._audioTrackTotalInput, get(this._audio.getTracktotal) ?? get(this._audio.getTrackTotal));

    // genres
    const genres = get(this._audio.getGenresList, []);
    if (this._audioGenresList) {
      this._audioGenresList.setItems(Array.isArray(genres) ? genres : []);
    } else {
      this._audioGenresList = new EditableStringList(Array.isArray(genres) ? genres : []);
      this._audioGenresDiv?.appendChild(this._audioGenresList);
    }

    this._updateButtonsVisibility();
  }

  _assign(el, v) { if (el) el.textContent = (v ?? "") + ""; }
  _assignInput(el, v) { if (el) el.value = v ?? ""; }

  _wireEditable(displayEl, inputEl, editBtn, setter, type = "text") {
    if (!displayEl || !inputEl || !editBtn) return;

    const container = inputEl.parentElement;
    const focusInput = () => {
      const focusTarget =
        type === "textarea"
          ? inputEl.textarea
          : inputEl.inputElement?.inputElement ?? inputEl;
      focusTarget?.focus?.();
      if (type !== "textarea") focusTarget?.select?.();
    };

    const showInput = () => {
      displayEl.style.display = "none";
      container?.classList?.remove("hidden");
      setTimeout(focusInput, 50);
    };

    const hideInput = () => {
      container?.classList?.add("hidden");
      displayEl.style.display = "table-cell";
    };

    const commit = () => {
      const raw = inputEl.value;
      const value = type === "number" ? (parseInt(raw, 10) || 0) : raw;
      if (this._audio && typeof this._audio[setter] === "function") this._audio[setter](value);
      displayEl.textContent = (value ?? "") + "";
      hideInput();
    };

    editBtn.addEventListener("click", showInput);
    inputEl.addEventListener("blur", commit);
    inputEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && type !== "textarea") { e.preventDefault(); commit(); }
    });
  }

  _initPermissionsManager() {
    if (!this._audio?.globule || !this._collapsePanel) return;

    this._permissionManager = new PermissionsManager();
    this._permissionManager.permissions = null;
    this._permissionManager.globule = this._audio.globule;
    // Use audio ID as resource path; adjust if your resource path differs
    if (this._permissionManager.setPath) this._permissionManager.setPath(this._audio.getId?.() || "");
    // Previous code assigned to setter name; make it a property or call the right setter:
    if (typeof this._permissionManager.setResourceType === "function") {
      this._permissionManager.setResourceType("audio_info");
    } else {
      this._permissionManager.resourceType = "audio_info";
    }

    this._permissionManager.onclose = () => this._collapsePanel?.toggle?.();

    this._collapsePanel.innerHTML = "";
    this._collapsePanel.appendChild(this._permissionManager);
  }

  _handlePermissionsToggle() {
    this._collapsePanel?.toggle?.();
  }

  _updateButtonsVisibility() {
    const token = sessionStorage.getItem("__globular_token__");
    const isLoggedIn = !!(token && token !== "undefined" && token !== "");
    this._editPermissionsBtn && (this._editPermissionsBtn.style.display = isLoggedIn ? "" : "none");
    this._saveButton && (this._saveButton.style.display = isLoggedIn ? "" : "none");
  }

  _handleCancel() {
    const parent = this.parentNode;
    if (!parent) return;
    if (this._audioInfosDisplay) parent.replaceChild(this._audioInfosDisplay, this);
    else parent.removeChild(this);
  }

  async _handleSave() {
    if (!this._audio) {
      displayError("No audio data is loaded to save.", 3000);
      return;
    }

    if (this._audioGenresList?.getItems) {
      const items = this._audioGenresList.getItems();
      if (typeof this._audio.setGenresList === "function") this._audio.setGenresList(items);
    }

    try {
      const indexPath = this._getIndexPath();
      await createOrUpdateAudio(this._audio, indexPath);
      await this._invalidateAssociatedFiles(indexPath);

      displaySuccess(`Audio information for "${this._audio.getTitle?.() || "Audio"}" was saved!`, 3000);
      if (this._audioInfosDisplay?.setAudio) this._audioInfosDisplay.setAudio(this._audio);
      this._handleCancel();
    } catch (err) {
      displayError(`Failed to save audio information: ${err?.message || err}`, 3000);
      console.error("Save audio info error:", err);
    }
  }

  _getIndexPath() {
    return "/search/audios";
  }

  async _invalidateAssociatedFiles(indexPath) {
    if (!this._audio) return;
    try {
      const paths = await getTitleFilePaths(this._audio, indexPath);
      paths.forEach((p) => invalidateFileCaches(p));
    } catch (err) {
      console.warn("AudioInfoEditor: failed to refresh associated file caches.", err);
    }
  }
}

if (!customElements.get("globular-audio-info-editor")) {
  customElements.define("globular-audio-info-editor", AudioInfoEditor);
}
