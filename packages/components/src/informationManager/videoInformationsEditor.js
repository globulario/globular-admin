import getUuidByString from "uuid-by-string";
import { EditableStringList } from "../list";
import { PermissionsManager } from "../permissionManager/permissionManager.js";
import { displayError, displaySuccess} from "@globular/backend";
import { PersonEditor } from "./personEditor.js";
import { SearchPersonInput } from "./searchPersonInput";
import { randomUUID } from "../utility.js";

// Protobuf message classes (kept for data structures used in UI)
import { Person, Poster, Publisher } from "globular-web-client/title/title_pb";

// Polymer / web components
import "@polymer/paper-input/paper-input.js";
import "@polymer/iron-autogrow-textarea/iron-autogrow-textarea.js";
import "@polymer/paper-icon-button/paper-icon-button.js";
import "@polymer/iron-collapse/iron-collapse.js";
import "@polymer/paper-button/paper-button.js";
import "@polymer/iron-icons/image-icons.js";

import { ImageSelector } from "../image.js";

// 🔧 Centralized backend helpers from title.ts (DRY)
import {
  createOrUpdatePerson,
  createOrUpdateVideo,
  getTitleFiles,
  invalidateFileCaches,
  updateVideoMetadata,
} from "@globular/backend"; // add `.js` if your bundler requires it
import { Backend } from "@globular/backend";

export class VideoInfoEditor extends HTMLElement {
  static FALLBACK_INDEX_PATHS = {
    videos: "/search/videos",
    persons: "/search/titles",
  };
  _video = null;            // current Video proto
  _videoInfosDisplay = null;
  _permissionManager = null;

  // DOM refs
  _imageSelector = null;
  _headerTextDiv = null;

  _publisherIdDiv = null; _publisherIdInput = null; _editPublisherIdBtn = null;
  _publisherUrlDiv = null; _publisherUrlInput = null; _editPublisherUrlBtn = null;
  _publisherNameDiv = null; _publisherNameInput = null; _editPublisherNameBtn = null;

  _addCastingBtn = null;
  _castingTable = null;

  _videoIdDiv = null; _videoIdInput = null; _editVideoIdBtn = null;
  _videoUrlDiv = null; _videoUrlInput = null; _editVideoUrlBtn = null;
  _videoDescriptionDiv = null; _videoDescriptionInput = null; _editVideoDescriptionBtn = null;

  _videoGenresDiv = null; _videoGenresList = null;
  _videoTagsDiv = null; _videoTagsList = null;

  _editPermissionsBtn = null;
  _collapsePanel = null;
  _saveButton = null;
  _cancelButton = null;

  constructor(video, videoInfosDisplay) {
    super();
    this.attachShadow({ mode: "open" });

    this._video = video;
    this._videoInfosDisplay = videoInfosDisplay;

    this._renderInitialStructure();
    this._getDomReferences();
    this._bindEventListeners();
    this._initPermissionsManager();
    this._populateFields();
  }

  connectedCallback() {
    this._populatePersonEditors();
  }

  set video(v) {
    if (this._video !== v) {
      this._video = v;
      this._populateFields();
      this._initPermissionsManager();
      this._populatePersonEditors();
    }
  }
  get video() { return this._video; }

  // ---------- Render ----------
  _renderInitialStructure() {
    const imageUrl = this._video?.getPoster?.() ? this._video.getPoster().getContenturl() : "";

    this.shadowRoot.innerHTML = `
      <style>
        #container {
          display:flex;
          flex-direction:column;
          margin:15px 0;
          padding:0 15px;
          box-sizing:border-box;
          height:100%;
          min-height:0;
        }
        .content-scroll {
          flex:1 1 auto;
          min-height:0;
          display:flex;
          gap:20px;
        }
        .image-column {
          display:flex;
          flex-direction:column;
          justify-content:flex-start;
          margin-right:20px;
          align-items:center;
          flex-shrink:0;
          min-width:150px;
        }
        .info-column {
          display:flex;
          flex-direction:column;
          flex-grow:1;
          min-width:300px;
        }
        .info-table {
          display:table;
          width:100%;
          border-collapse:collapse;
          margin-top:20px;
          margin-bottom:10px;
        }
        .info-row {
          display:table-row;
          border-bottom:1px solid var(--palette-divider);
        }
        .info-row:last-child {
          border-bottom:none;
        }
        .label {
          display:table-cell;
          font-weight:500;
          padding-right:15px;
          min-width:120px;
          vertical-align:middle;
          padding-top:8px;
          padding-bottom:8px;
        }
        .value-display,
        .input-field {
          display:table-cell;
          width:100%;
          padding-top:8px;
          padding-bottom:8px;
          vertical-align:middle;
        }
        .input-field.hidden {
          display:none;
        }
        .input-field paper-input,
        .input-field iron-autogrow-textarea {
          width:100%;
          --paper-input-container-color:var(--primary-text-color);
          --paper-input-container-focus-color:var(--primary-color);
          --paper-input-container-label-floating-color:var(--primary-color);
          --paper-input-container-input-color:var(--primary-text-color);
        }
        .button-cell {
          display:table-cell;
          width:48px;
          vertical-align:middle;
        }
        .button-cell paper-icon-button {
          height:32px;
          width:32px;
          padding:0;
        }
        .button-cell iron-icon {
          color:var(--primary-text-color);
        }
        .button-cell iron-icon:hover {
          color:var(--primary-color);
          cursor:pointer;
        }
        .person-section-header {
          display:flex;
          align-items:center;
          border-bottom:1px solid var(--palette-divider);
          padding-bottom:8px;
          margin-bottom:8px;
        }
        .person-section-header .label {
          font-weight:500;
          font-size:1.1rem;
          padding:0;
          margin-right:0.5rem;
          flex:1;
        }
        .person-section-header .value-display {
          flex:1;
        }
        .person-section-header .button-cell {
          display:flex;
          gap:8px;
          align-items:center;
          min-width:0;
          position:relative;
        }
        .person-list-table {
          display:flex;
          width:100%;
          flex-direction:column;
          border-bottom:1px solid var(--palette-divider);
          padding-bottom:10px;
          margin-left:20px;
          margin-bottom:10px;
        }
        #header {
          display:flex;
          align-items:center;
          gap:.5rem;
          margin-bottom:6px;
        }
        #header-text {
          font-size:1.2rem;
          font-weight:600;
        }
        #content {
          flex:1;
          display:flex;
          flex-direction:column;
          overflow-y:auto;
          overflow-x:hidden;
          min-height:0;
          gap:10px;
        }
        .action-div {
          display:flex;
          justify-content:flex-end;
          gap:10px;
          border-top:1px solid var(--palette-divider);
          padding:15px;
          margin-top:auto;
          position:sticky;
          bottom:0;
          z-index:2;
          background:var(--surface-elevated-color, var(--surface-color));
        }
        paper-button {
          background-color:var(--primary-color);
          color:var(--on-primary-color);
          padding:8px 16px;
          border-radius:4px;
        }
        paper-button:hover {
          background-color:var(--primary-dark-color);
        }
        select {
          background:var(--surface-color);
          color:var(--primary-text-color);
          border:1px solid var(--palette-divider);
          outline:0;
          padding:8px;
          border-radius:4px;
          box-sizing:border-box;
        }
        select option {
          background:var(--surface-color);
          color:var(--primary-text-color);
        }
      </style>

      <div id="container">
        <div id="content">
          <div id="header">
            <div id="header-text">Video Information</div>
          </div>
      
          <div class="content-scroll">
            <div class="image-column">
              <globular-image-selector label="Cover" url="${imageUrl}"></globular-image-selector>
            </div>

          <div class="info-column">
            <div class="info-table">
              <div class="info-row" style="border-bottom:1px solid var(--palette-divider)">
                <div class="label">Publisher</div>
                <div class="value-display"></div>
                <div class="button-cell"></div>
              </div>
              <div class="info-row">
                <div class="label">Id:</div>
                <div class="value-display" id="publisher-id-div"></div>
                <div class="input-field hidden"><paper-input id="publisher-id-input" no-label-float></paper-input></div>
                <div class="button-cell"><paper-icon-button id="edit-publisher-id-btn" icon="image:edit"></paper-icon-button></div>
              </div>
              <div class="info-row">
                <div class="label">Url:</div>
                <div class="value-display" id="publisher-url-div"></div>
                <div class="input-field hidden"><paper-input id="publisher-url-input" no-label-float></paper-input></div>
                <div class="button-cell"><paper-icon-button id="edit-publisher-url-btn" icon="image:edit"></paper-icon-button></div>
              </div>
              <div class="info-row">
                <div class="label">Name:</div>
                <div class="value-display" id="publisher-name-div"></div>
                <div class="input-field hidden"><paper-input id="publisher-name-input" no-label-float></paper-input></div>
                <div class="button-cell"><paper-icon-button id="edit-publisher-name-btn" icon="image:edit"></paper-icon-button></div>
              </div>
            </div>

            <div class="person-list-table" id="casting-table">
              <div class="person-section-header">
                <div class="label">Casting</div>
                <div class="value-display"></div>
                <div class="button-cell">
                  <paper-icon-button id="add-casting-btn" icon="social:person-add" title="Add Casting"></paper-icon-button>
                </div>
              </div>
              <slot name="casting"></slot>
            </div>

            <div class="info-table">
              <div class="info-row" style="border-bottom:1px solid var(--palette-divider)">
                <div class="label">Video Information</div>
                <div class="value-display"></div>
                <div class="button-cell"></div>
              </div>
              <div class="info-row">
                <div class="label">Id:</div>
                <div class="value-display" id="video-id-div"></div>
                <div class="input-field hidden"><paper-input id="video-id-input" no-label-float></paper-input></div>
                <div class="button-cell"><paper-icon-button id="edit-video-id-btn" icon="image:edit"></paper-icon-button></div>
              </div>
              <div class="info-row">
                <div class="label">URL:</div>
                <div class="value-display" id="video-url-div"></div>
                <div class="input-field hidden"><paper-input id="video-url-input" no-label-float></paper-input></div>
                <div class="button-cell"><paper-icon-button id="edit-video-url-btn" icon="image:edit"></paper-icon-button></div>
              </div>
              <div class="info-row">
                <div class="label" style="vertical-align:top;">Description:</div>
                <div class="value-display" id="video-description-div"></div>
                <div class="input-field hidden"><iron-autogrow-textarea id="video-description-input" no-label-float></iron-autogrow-textarea></div>
                <div class="button-cell"><paper-icon-button id="edit-video-description-btn" icon="image:edit" style="vertical-align:top;"></paper-icon-button></div>
              </div>
              <div class="info-row">
                <div class="label">Genres:</div>
                <div class="value-display" id="video-genres-div"></div>
                <div class="input-field hidden"></div>
                <div class="button-cell"></div>
              </div>
              <div class="info-row">
                <div class="label">Tags:</div>
                <div class="value-display" id="video-tags-div"></div>
                <div class="input-field hidden"></div>
                <div class="button-cell"></div>
              </div>
            </div>
          </div>
        </div>
          <iron-collapse id="collapse-panel" class="permissions" style="display:flex; flex-direction:column; margin:5px;"></iron-collapse>
        </div>

        <div class="action-div">
          <paper-button id="edit-permissions-btn" title="Set who can edit this video information">Permissions</paper-button>
          <span style="flex-grow:1;"></span>
          <paper-button id="save-indexation-btn">Save</paper-button>
          <paper-button id="cancel-indexation-btn">Cancel</paper-button>
        </div>
      </div>
    `;
  }

  // ---------- DOM refs ----------
  _getDomReferences() {
    const $ = (q) => this.shadowRoot.querySelector(q);

    this._imageSelector = $("globular-image-selector");
    this._headerTextDiv = $("#header-text");

    this._publisherIdDiv = $("#publisher-id-div");
    this._publisherIdInput = $("#publisher-id-input");
    this._editPublisherIdBtn = $("#edit-publisher-id-btn");

    this._publisherUrlDiv = $("#publisher-url-div");
    this._publisherUrlInput = $("#publisher-url-input");
    this._editPublisherUrlBtn = $("#edit-publisher-url-btn");

    this._publisherNameDiv = $("#publisher-name-div");
    this._publisherNameInput = $("#publisher-name-input");
    this._editPublisherNameBtn = $("#edit-publisher-name-btn");

    this._addCastingBtn = $("#add-casting-btn");
    this._castingTable = $("#casting-table");

    this._videoIdDiv = $("#video-id-div");
    this._videoIdInput = $("#video-id-input");
    this._editVideoIdBtn = $("#edit-video-id-btn");

    this._videoUrlDiv = $("#video-url-div");
    this._videoUrlInput = $("#video-url-input");
    this._editVideoUrlBtn = $("#edit-video-url-btn");

    this._videoDescriptionDiv = $("#video-description-div");
    this._videoDescriptionInput = $("#video-description-input");
    this._editVideoDescriptionBtn = $("#edit-video-description-btn");

    this._videoGenresDiv = $("#video-genres-div");
    this._videoTagsDiv = $("#video-tags-div");
    this._videoGenresList = null;
    this._videoTagsList = null;

    this._editPermissionsBtn = $("#edit-permissions-btn");
    this._collapsePanel = $("#collapse-panel");
    this._saveButton = $("#save-indexation-btn");
    this._cancelButton = $("#cancel-indexation-btn");
  }

  // ---------- Populate ----------
  _populateFields() {
    if (!this._video) return;

    if (this._headerTextDiv) {
      const headerText =
        this._video.getTitle?.() ||
        this._video.getName?.() ||
        this._video.getDescription?.()?.split(/\r?\n/)[0]?.trim() ||
        this._video.getId?.() ||
        "Video Information";
      this._headerTextDiv.textContent = headerText;
    }

    // Poster
    if (this._imageSelector) {
      const url = this._video.getPoster?.() ? this._video.getPoster().getContenturl() : "";
      this._imageSelector.url = url;
    }

    // Publisher
    const pub = this._video.getPublisherid?.();
    const pubId = pub?.getId?.() || "";
    const pubUrl = pub?.getUrl?.() || "";
    const pubName = pub?.getName?.() || "";

    this._publisherIdDiv.textContent = pubId;
    this._publisherIdInput.value = pubId;
    this._resetEditableFieldState(this._publisherIdDiv, this._publisherIdInput);

    this._publisherUrlDiv.textContent = pubUrl;
    this._publisherUrlInput.value = pubUrl;
    this._resetEditableFieldState(this._publisherUrlDiv, this._publisherUrlInput);

    this._publisherNameDiv.textContent = pubName;
    this._publisherNameInput.value = pubName;
    this._resetEditableFieldState(this._publisherNameDiv, this._publisherNameInput);

    // Video Info
    this._videoIdDiv.textContent = this._video.getId?.() || "";
    this._videoIdInput.value = this._video.getId?.() || "";
    this._resetEditableFieldState(this._videoIdDiv, this._videoIdInput);

    this._videoUrlDiv.textContent = this._video.getUrl?.() || "";
    this._videoUrlInput.value = this._video.getUrl?.() || "";
    this._resetEditableFieldState(this._videoUrlDiv, this._videoUrlInput);

    this._videoDescriptionDiv.textContent = this._video.getDescription?.() || "";
    this._videoDescriptionInput.value = this._video.getDescription?.() || "";
    this._resetEditableFieldState(this._videoDescriptionDiv, this._videoDescriptionInput);

    // Genres
    const genres = this._video.getGenresList?.() || [];
    if (!this._videoGenresList) {
      this._videoGenresList = new EditableStringList(genres);
      this._videoGenresDiv.appendChild(this._videoGenresList);
    } else {
      this._videoGenresList.setItems(genres);
    }

    // Tags
    const tags = this._video.getTagsList?.() || [];
    if (!this._videoTagsList) {
      this._videoTagsList = new EditableStringList(tags);
      this._videoTagsDiv.appendChild(this._videoTagsList);
    } else {
      this._videoTagsList.setItems(tags);
    }
  }

  _populatePersonEditors() {
    this._castingTable?.querySelectorAll("globular-person-editor").forEach(el => el.remove());
    if (!this._video) return;
    const list = this._video.getCastingList?.() || [];
    list.forEach(p => this._appendPersonEditor(p, "casting"));
  }

  // ---------- Events ----------
  _bindEventListeners() {
    // Main buttons
    this._cancelButton?.addEventListener("click", this._handleCancelClick.bind(this));
    this._saveButton?.addEventListener("click", this._handleSaveClick.bind(this));

    // Image selector
    if (this._imageSelector) {
      this._imageSelector.ondelete = () => {
        if (this._video.getPoster?.()) this._video.getPoster().setContenturl("");
      };
      this._imageSelector.onselectimage = (imageUrl) => {
        if (!this._video.getPoster?.()) this._video.setPoster(new Poster());
        this._video.getPoster().setContenturl(imageUrl);
      };
    }

    // Permissions
    this._editPermissionsBtn?.addEventListener("click", this._handlePermissionsClick.bind(this));

    // Casting
    this._addCastingBtn?.addEventListener("click", this._handleAddCastingClick.bind(this));

    // Editable fields
    this._setupEditableField(this._publisherIdDiv, this._publisherIdInput, this._editPublisherIdBtn, "publisher:setId");
    this._setupEditableField(this._publisherUrlDiv, this._publisherUrlInput, this._editPublisherUrlBtn, "publisher:setUrl");
    this._setupEditableField(this._publisherNameDiv, this._publisherNameInput, this._editPublisherNameBtn, "publisher:setName");

    this._setupEditableField(this._videoIdDiv, this._videoIdInput, this._editVideoIdBtn, "video:setId");
    this._setupEditableField(this._videoUrlDiv, this._videoUrlInput, this._editVideoUrlBtn, "video:setUrl");
    this._setupEditableField(this._videoDescriptionDiv, this._videoDescriptionInput, this._editVideoDescriptionBtn, "video:setDescription", "textarea");
  }

  _handlePermissionsClick() {
    this._collapsePanel?.toggle();
  }

  _handleCancelClick() {
    const parent = this.parentNode;
    if (parent && this._videoInfosDisplay) {
      parent.removeChild(this);
      parent.appendChild(this._videoInfosDisplay);
    } else if (parent) {
      parent.removeChild(this);
      console.warn("VideoInfoEditor: No videoInfosDisplay component to return to.");
    }
  }

  async _handleSaveClick() {
    if (!this._video) {
      displayError("Video object not set for saving.", 3000);
      return;
    }

    // Commit UI values into the Video proto
    this._saveAllFieldsToVideoObject();

    try {
      // Save casting (persons)
      await this._saveCasting(this._video.getCastingList?.() || []);

      // Save video & metadata via helpers (title.ts)
      const videoIndexPath = this._getIndexPath("videos");
      await createOrUpdateVideo(this._video, videoIndexPath);
      await updateVideoMetadata(this._video, videoIndexPath);
      await this._invalidateAssociatedFiles(this._video.getId?.(), "video", videoIndexPath);

      displaySuccess("Video Information updated successfully!", 3000);

      // Return to display
      if (this._videoInfosDisplay?.setVideo) {
        this._videoInfosDisplay.setVideo(this._video);
      }
      this._handleCancelClick();
    } catch (err) {
      displayError(`Failed to save video information: ${err?.message || err}`, 3000);
      console.error("Save video info error:", err);
    }
  }

  // ---------- Helpers ----------
  _setupEditableField(displayEl, inputEl, editBtn, targetAndSetter, inputType = "text", onSave = null) {
    if (!displayEl || !inputEl || !editBtn) return;

    const inputContainer = inputEl.parentNode ?? inputEl;
    const showInput = () => inputContainer?.classList?.remove("hidden");
    const hideInput = () => inputContainer?.classList?.add("hidden");
    hideInput();

    editBtn.addEventListener("click", () => {
      displayEl.style.display = "none";
      showInput();
      setTimeout(() => {
        const focusEl =
          inputEl?.textarea ??
          inputEl?.inputElement?._inputElement ??
          inputEl?.inputElement?.textarea ??
          inputEl;
        if (focusEl) {
          focusEl.focus?.();
          focusEl.select?.();
        }
      }, 50);
    });

    const commit = () => {
      const val = inputEl.value;
      const [target, setter] = targetAndSetter.split(":");

      if (target === "publisher") {
        let pub = this._video.getPublisherid?.();
        if (!pub) {
          pub = new Publisher();
          this._video.setPublisherid(pub);
        }
        pub[setter]?.(val);
      } else if (target === "video") {
        const newValue = inputType === "number" ? (parseInt(val, 10) || 0) : val;
        this._video[setter]?.(newValue);
      }

      displayEl.textContent = val;
      hideInput();
      displayEl.style.display = "table-cell";
      onSave && onSave(val);
    };

    const revert = () => {
      inputEl.value = displayEl.textContent || "";
      hideInput();
      displayEl.style.display = "table-cell";
    };

    inputEl.addEventListener("blur", commit);
    inputEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && inputType !== "textarea") {
        e.preventDefault();
        commit();
      } else if (e.key === "Escape") {
        e.preventDefault();
        revert();
      }
    });
  }

  _resetEditableFieldState(displayEl, inputEl) {
    if (!displayEl || !inputEl) return;
    displayEl.style.display = "table-cell";
    const inputContainer = inputEl.parentNode ?? inputEl;
    inputContainer?.classList?.add("hidden");
  }

  _saveAllFieldsToVideoObject() {
    // Trigger blur on any visible inputs to commit via _setupEditableField
    [
      this._publisherIdInput, this._publisherUrlInput, this._publisherNameInput,
      this._videoIdInput, this._videoUrlInput, this._videoDescriptionInput
    ].forEach(inp => {
      if (inp && (inp.style.display !== "none") && typeof inp.blur === "function") inp.blur();
    });

    // Poster already handled by image-selector callbacks

    // Genres & Tags from EditableStringList
    if (this._videoGenresList?.getItems) this._video.setGenresList(this._videoGenresList.getItems());
    if (this._videoTagsList?.getItems) this._video.setTagsList(this._videoTagsList.getItems());
  }

  async _saveCasting(personList) {
    const saved = [];
    if (!Array.isArray(personList) || !personList.length) return saved;
    const personIndexPath = this._getPersonIndexPath();
    for (const person of personList) {
      this._syncPersonGlobule(person);
      try {
        await createOrUpdatePerson(person, personIndexPath);
        saved.push(person);
      } catch (err) {
        console.error(`Failed to save person ${person.getFullname?.() || ""}:`, err);
      }
    }
    return saved;
  }

  async _invalidateAssociatedFiles(infoId, infoType, indexPath) {
    if (!infoId || !indexPath) return;
    let filePaths = [];
    try {
      filePaths = await getTitleFiles(infoId, indexPath);
    } catch (err) {
      console.warn("VideoInfoEditor: failed to determine associated file paths", err);
    }
    filePaths.forEach((p) => invalidateFileCaches(p));
    Backend.eventHub.publish(
      `_invalidate_infos_${infoId}_evt`,
      { infoType, filePaths },
      true
    );
  }

  _getIndexPath(kind = "videos") {
    const dataPath = this._video?.globule?.config?.DataPath;
    if (typeof dataPath === "string" && dataPath.trim().length > 0) {
      const trimmed = dataPath.replace(/\/+$/, "");
      return `${trimmed}/search/${kind}`;
    }
    return VideoInfoEditor.FALLBACK_INDEX_PATHS[kind] || VideoInfoEditor.FALLBACK_INDEX_PATHS.videos;
  }

  _getPersonIndexPath() {
    return this._getIndexPath("persons");
  }

  _syncPersonGlobule(person) {
    if (!person) return;
    if (this._video?.globule) {
      person.globule = this._video.globule;
    } else {
      delete person.globule;
    }
  }

  _appendPersonEditor(person, slotName) {
    if (!this._video) return null;
    this._syncPersonGlobule(person);

    const editorId = `_person_editor_${getUuidByString((person.getId?.() || "") + slotName)}`;
    let editor = this.shadowRoot.querySelector(`#${editorId}`);

    if (!editor) {
      editor = new PersonEditor(person, this._video)// document.createElement("globular-person-editor");
      editor.id = editorId;
      editor.slot = slotName;

      editor.person = person;
      if (typeof editor.setTitleObject === "function") {
        editor.setTitleObject(this._video);
      }

      editor.onremovefromcast = () => {
        editor.parentNode && editor.parentNode.removeChild(editor);
        this._populatePersonEditors();
      };

      if (slotName === "casting" && this._castingTable) {
        this._castingTable.appendChild(editor);
      } else {
        console.warn(`Unknown slot container for ${slotName}`);
      }
    }
    return editor;
  }

  _handleAddCastingClick() {
    if (!this._video) return;
    const addCastingPanelId = "add-casting-panel";
    let panel = this.shadowRoot.querySelector(`#${addCastingPanelId}`);
    if (panel) return;

    const personIndexPath = this._getPersonIndexPath();
    const html = `
      <style>
        #${addCastingPanelId} {
          z-index:100;
          background-color:var(--surface-color);
          color:var(--primary-text-color);
          position:absolute; top:35px; right:5px; width:300px;
          box-shadow:var(--shadow-elevation-4dp);
          border-radius:8px; overflow:hidden; padding:10px;
          display:flex; flex-direction:column; gap:10px;
        }
        #${addCastingPanelId} .panel-actions {
          display:flex; justify-content:flex-end; gap:8px; padding-top:10px; border-top:1px solid var(--palette-divider);
        }
      </style>
      <paper-card id="${addCastingPanelId}">
        <globular-search-person-input indexpath="${personIndexPath}"></globular-search-person-input>
        <div class="panel-actions">
          <paper-button id="new-person-btn" title="Create a new person">New</paper-button>
          <paper-button id="cancel-btn">Cancel</paper-button>
        </div>
      </paper-card>
    `;

    const parentCell = this.shadowRoot.querySelector("#casting-table .button-cell");
    if (!parentCell) return;

    parentCell.appendChild(document.createRange().createContextualFragment(html));
    panel = parentCell.querySelector(`#${addCastingPanelId}`);

    const searchPersonInput = panel.querySelector("globular-search-person-input");
    const newPersonBtn = panel.querySelector("#new-person-btn");
    const cancelBtn = panel.querySelector("#cancel-btn");

    searchPersonInput.oneditperson = (person) => {
      this._syncPersonGlobule(person);
      const dialogId = `_person_editor_dialog_${getUuidByString(person.getId?.() || randomUUID())}`;
      let dialog = document.body.querySelector(`#${dialogId}`);
      if (!dialog) {
        const dialogHtml = `
          <style>
            #${dialogId}{
              z-index:1000; position:fixed; top:50%; left:50%;
              transform:translate(-50%, -50%);
              background-color:var(--surface-color);
              border:1px solid var(--palette-divider);
              box-shadow:var(--shadow-elevation-6dp);
              border-radius:8px; overflow:hidden; display:flex;
            }
          </style>
          <paper-card id="${dialogId}"></paper-card>
        `;
        document.body.appendChild(document.createRange().createContextualFragment(dialogHtml));
        dialog = document.body.querySelector(`#${dialogId}`);
      }

      const editor = new PersonEditor(person, this._video);
      editor.slot = "casting";
      editor.onclose = () => { dialog?.parentNode?.removeChild(dialog); this._populatePersonEditors(); };
      editor.onremovefromcast = () => { dialog?.parentNode?.removeChild(dialog); this._populatePersonEditors(); };
      dialog.appendChild(editor);
      editor.focus();
      panel.parentNode && panel.parentNode.removeChild(panel);
    };

    searchPersonInput.onaddcasting = async (personToAdd) => {
      this._syncPersonGlobule(personToAdd);

      try {
        // Update Person: add this video ID in their casting list (if you model it that way)
        const videoId = this._video.getId?.();
        if (videoId) {
          const list = personToAdd.getCastingList?.() || [];
          if (!list.includes(videoId)) {
            personToAdd.setCastingList?.([...list, videoId]);
          }
        }
        await createOrUpdatePerson(personToAdd, personIndexPath);

        // Update Video: add person if not already there
        const current = this._video.getCastingList?.() || [];
        if (!current.some(p => p.getId?.() === personToAdd.getId?.())) {
          this._video.setCastingList?.([...current, personToAdd]);
          this._populatePersonEditors();
        }
        const videoIndexPath = this._getIndexPath("videos");
        await createOrUpdateVideo(this._video, videoIndexPath);

        displaySuccess(`${personToAdd.getFullname?.() || "Person"} added to casting.`, 3000);
        this._populatePersonEditors();
        panel.parentNode && panel.parentNode.removeChild(panel);
      } catch (err) {
        displayError(`Failed to add person to casting: ${err?.message || err}`, 3000);
      }
    };

    newPersonBtn.onclick = () => {
      const p = new Person();
      p.setId?.(`New Person_${(randomUUID() || "").substring(0, 8)}`);
      p.setFullname?.("New Person");
      this._syncPersonGlobule(p);

      const editor = this._appendPersonEditor(p, "casting");
      editor?.focus?.();
      panel.parentNode && panel.parentNode.removeChild(panel);
    };

    cancelBtn.onclick = () => {
      panel.parentNode && panel.parentNode.removeChild(panel);
    };
  }

  _initPermissionsManager() {
    if (!this._video?.globule) return;

    this._permissionManager = new PermissionsManager();
    this._permissionManager.permissions = null;
    this._permissionManager.globule = this._video.globule;
    this._permissionManager.setPath(this._video.getId?.());
    this._permissionManager.setResourceType = "video_info";

    this._permissionManager.onclose = () => this._collapsePanel?.toggle();

    if (this._collapsePanel) {
      this._collapsePanel.innerHTML = "";
      this._collapsePanel.appendChild(this._permissionManager);
    }

    // Simple UI-based auth check (real auth handled by helpers)
    const token = sessionStorage.getItem("__globular_token__");
    const isLoggedIn = !!token && token !== "null";
    if (this._editPermissionsBtn) this._editPermissionsBtn.style.display = isLoggedIn ? "" : "none";
    if (this._saveButton) this._saveButton.style.display = isLoggedIn ? "" : "none";
    if (this._cancelButton) this._cancelButton.style.display = isLoggedIn ? "" : "none";
  }
}

customElements.define("globular-video-editor", VideoInfoEditor);