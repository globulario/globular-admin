import getUuidByString from "uuid-by-string";
import { EditableStringList } from "../list";
import { PermissionsManager } from "../permissionManager/permissionManager";
import { displayError, displaySuccess } from "../../backend/ui/notify";

import "@polymer/iron-icons/editor-icons.js";
import "@polymer/paper-input/paper-input.js";
import "@polymer/iron-icon/iron-icon.js";
import "@polymer/paper-icon-button/paper-icon-button.js";
import "@polymer/iron-collapse/iron-collapse.js";
import "@polymer/paper-button/paper-button.js";
import "@polymer/iron-autogrow-textarea/iron-autogrow-textarea.js";


import { PersonEditor } from "./personEditor";
import { SearchPersonInput } from "./searchPersonInput";
import { ImageSelector } from "../image.js";

// Use protobuf model classes for in-memory objects
import { Person, Poster } from "globular-web-client/title/title_pb";

// ✅ Central backend helpers from your title.ts (adjust path if needed)
import {
  createOrUpdatePerson,
  createOrUpdateTitle,
  updateTitleMetadata,
} from "../../backend/media/title";

import { randomUUID } from "../utility";

export class TitleInfoEditor extends HTMLElement {
  constructor(title, titleInfosDisplay) {
    super();
    this.attachShadow({ mode: "open" });

    // data
    this._title = title || null;
    this._titleInfosDisplay = titleInfosDisplay || null;
    this._permissionManager = null;

    // dom refs (initialized later)
    this._imageSelector = null;

    this._titleIdDiv = null; this._titleIdInput = null; this._editTitleIdBtn = null;
    this._titleNameDiv = null; this._titleNameInput = null; this._editTitleNameBtn = null;
    this._titleDescriptionDiv = null; this._titleDescriptionInput = null; this._editTitleDescriptionBtn = null;
    this._titleYearDiv = null; this._titleYearInput = null; this._editTitleYearBtn = null;

    this._titleTypeDiv = null; this._titleTypeSelect = null; this._editTitleTypeBtn = null;
    this._titleSerieRow = null; this._titleSerieDiv = null; this._titleSerieInput = null; this._editTitleSerieBtn = null;
    this._titleSeasonRow = null; this._titleSeasonDiv = null; this._titleSeasonInput = null; this._editTitleSeasonBtn = null;
    this._titleEpisodeRow = null; this._titleEpisodeDiv = null; this._titleEpisodeInput = null; this._editTitleEpisodeBtn = null;

    this._titleGenresDiv = null; this._titleGenresList = null;

    this._directorsTable = null; this._addDirectorsBtn = null;
    this._writersTable = null; this._addWritersBtn = null;
    this._actorsTable = null; this._addActorsBtn = null;

    this._editPermissionsBtn = null;
    this._collapsePanel = null;
    this._saveButton = null;
    this._cancelButton = null;

    this._collapseButton = null;
    this._headerTextDiv = null;

    this._renderInitialStructure();
    this._getDomReferences();
    this._bindEventListeners();
    this._initPermissionsManager();
    this._populateFields();
  }

  connectedCallback() {
    this._populatePersonEditors();
  }

  set title(title) {
    if (this._title !== title) {
      this._title = title;
      this._populateFields();
      this._initPermissionsManager();
      this._populatePersonEditors();
    }
  }
  get title() { return this._title; }

  // ---------- UI
  _renderInitialStructure() {
    const imageUrl = this._title?.getPoster?.() ? this._title.getPoster().getContenturl() : "";
    const titleType = this._title?.getType?.() || "Movie";

    this.shadowRoot.innerHTML = `
      <style>
        #container{display:flex;flex-wrap:wrap;margin:15px 0;padding:15px;box-sizing:border-box;}
        .image-column{display:flex;flex-direction:column;align-items:center;margin-right:20px;min-width:150px;flex-shrink:0;}
        .info-column{display:flex;flex-direction:column;flex-grow:1;min-width:300px;}

        .info-table{display:table;width:100%;border-collapse:collapse;margin:20px 0 10px;}
        .info-row{display:table-row;border-bottom:1px solid var(--palette-divider);}
        .info-row:last-child{border-bottom:none;}
        .label{display:table-cell;font-weight:500;padding-right:15px;min-width:120px;vertical-align:middle;padding:8px 15px 8px 0;}
        .value-display,.input-field{display:table-cell;width:100%;vertical-align:middle;padding:8px 0;}
        .input-field paper-input,.input-field iron-autogrow-textarea{width:100%;}
        .button-cell{display:table-cell;width:48px;vertical-align:middle;}
        .button-cell iron-icon{color:var(--primary-text-color);}
        .button-cell iron-icon:hover{color:var(--palette-primary-main);cursor:pointer;}

        .action-div{display:flex;justify-content:flex-end;gap:10px;border-top:1px solid var(--palette-divider);padding-top:15px;margin-top:20px;}
        paper-button{background:var(--palette-primary-main);color:var(--palette-primary-contrast);padding:8px 16px;border-radius:4px;}
        paper-button:hover{background:var(--palette-primary-dark);}
        select{background:var(--surface-color);color:var(--primary-text-color);border:1px solid var(--palette-divider);outline:0;padding:8px;border-radius:4px;box-sizing:border-box;}
        select option{background:var(--surface-color);color:var(--primary-text-color);}

        .person-section-header{display:table-row;border-bottom:1px solid var(--palette-divider);}
        .person-section-header .label{font-weight:500;font-size:1.1rem;padding-bottom:8px;}
        .person-list-table{display:table;width:100%;border-collapse:collapse;margin-left:20px;margin-bottom:10px;}

        #header{display:flex;align-items:center;gap:.5rem;margin-bottom:6px;}
        #header-text{font-size:1.2rem;font-weight:600;}
      </style>

      <div id="header"><div id="header-text"></div></div>

      <div id="container">
        <div class="image-column">
          <globular-image-selector label="Cover" url="${imageUrl}"></globular-image-selector>
        </div>

        <div class="info-column">
          <div class="info-table">
            <div class="info-row" style="border-bottom:1px solid var(--palette-divider)">
              <div class="label">Title Information</div>
              <div class="value-display"></div>
              <div class="button-cell"></div>
            </div>

            <div class="info-row">
              <div class="label">Id:</div>
              <div class="value-display" id="title-id-div"></div>
              <div class="input-field"><paper-input id="title-id-input" no-label-float></paper-input></div>
              <div class="button-cell"><paper-icon-button id="edit-title-id-btn" icon="editor:mode-edit"></paper-icon-button></div>
            </div>

            <div class="info-row">
              <div class="label">Title:</div>
              <div class="value-display" id="title-name-div"></div>
              <div class="input-field"><paper-input id="title-name-input" no-label-float></paper-input></div>
              <div class="button-cell"><paper-icon-button id="edit-title-name-btn" icon="editor:mode-edit"></paper-icon-button></div>
            </div>

            <div class="info-row">
              <div class="label" style="vertical-align:top;">Synopsis:</div>
              <div class="value-display" id="title-description-div" style="padding-bottom:10px;"></div>
              <div class="input-field"><iron-autogrow-textarea id="title-description-input" no-label-float></iron-autogrow-textarea></div>
              <div class="button-cell"><paper-icon-button id="edit-title-description-btn" icon="editor:mode-edit" style="vertical-align:top;"></paper-icon-button></div>
            </div>

            <div class="info-row" id="title-year-row">
              <div class="label">Year:</div>
              <div class="value-display" id="title-year-div"></div>
              <div class="input-field"><paper-input id="title-year-input" type="number" no-label-float></paper-input></div>
              <div class="button-cell"><paper-icon-button id="edit-title-year-btn" icon="editor:mode-edit"></paper-icon-button></div>
            </div>

            <div class="info-row">
              <div class="label">Type:</div>
              <div class="value-display" id="title-type-div"></div>
              <div class="input-field">
                <select id="title-type-select">
                  <option value="Movie">Movie</option>
                  <option value="TVSeries">TVSeries</option>
                  <option value="TVEpisode">TVEpisode</option>
                </select>
              </div>
              <div class="button-cell"><paper-icon-button id="edit-title-type-btn" icon="editor:mode-edit"></paper-icon-button></div>
            </div>

            <div class="info-row" id="title-serie-row" style="display:${titleType !== "TVEpisode" ? "none" : "table-row"};">
              <div class="label">Serie:</div>
              <div class="value-display" id="title-serie-div"></div>
              <div class="input-field"><paper-input id="title-serie-input" no-label-float></paper-input></div>
              <div class="button-cell"><paper-icon-button id="edit-title-serie-btn" icon="editor:mode-edit"></paper-icon-button></div>
            </div>

            <div class="info-row" id="title-season-row" style="display:${titleType !== "TVEpisode" ? "none" : "table-row"};">
              <div class="label">Season:</div>
              <div class="value-display" id="title-season-div"></div>
              <div class="input-field"><paper-input id="title-season-input" type="number" no-label-float></paper-input></div>
              <div class="button-cell"><paper-icon-button id="edit-title-season-btn" icon="editor:mode-edit"></paper-icon-button></div>
            </div>

            <div class="info-row" id="title-episode-row" style="display:${titleType !== "TVEpisode" ? "none" : "table-row"};">
              <div class="label">Episode:</div>
              <div class="value-display" id="title-episode-div"></div>
              <div class="input-field"><paper-input id="title-episode-input" type="number" no-label-float></paper-input></div>
              <div class="button-cell"><paper-icon-button id="edit-title-episode-btn" icon="editor:mode-edit"></paper-icon-button></div>
            </div>

            <div class="info-row">
              <div class="label">Genres:</div>
              <div class="value-display" id="title-genres-div"></div>
              <div class="input-field"></div>
              <div class="button-cell"></div>
            </div>
          </div>

          <div class="person-list-table">
            <div class="person-section-header">
              <div class="label">Directors</div>
              <div class="value-display"></div>
              <div class="button-cell">
                <paper-icon-button id="add-directors-btn" icon="social:person-add" title="Add Director"></paper-icon-button>
              </div>
            </div>
            <div id="directors-table"><slot name="directors"></slot></div>
          </div>

          <div class="person-list-table">
            <div class="person-section-header">
              <div class="label">Writers</div>
              <div class="value-display"></div>
              <div class="button-cell">
                <paper-icon-button id="add-writers-btn" icon="social:person-add" title="Add Writer"></paper-icon-button>
              </div>
            </div>
            <div id="writers-table"><slot name="writers"></slot></div>
          </div>

          <div class="person-list-table">
            <div class="person-section-header">
              <div class="label">Actors</div>
              <div class="value-display"></div>
              <div class="button-cell">
                <paper-icon-button id="add-actors-btn" icon="social:person-add" title="Add Actor"></paper-icon-button>
              </div>
            </div>
            <div id="actors-table"><slot name="actors"></slot></div>
          </div>

        </div>
      </div>

      <iron-collapse id="collapse-panel" class="permissions" style="display:flex;flex-direction:column;margin:5px;"></iron-collapse>

      <div class="action-div">
        <paper-button id="edit-permissions-btn" title="Set who can edit this title information">Permissions</paper-button>
        <span style="flex-grow:1;"></span>
        <paper-button id="save-indexation-btn">Save</paper-button>
        <paper-button id="cancel-indexation-btn">Cancel</paper-button>
      </div>
    `;
  }

  _getDomReferences() {
    const $ = (q) => this.shadowRoot.querySelector(q);

    this._imageSelector = $("globular-image-selector");

    this._headerTextDiv = $("#header-text");

    this._titleIdDiv = $("#title-id-div");
    this._titleIdInput = $("#title-id-input");
    this._editTitleIdBtn = $("#edit-title-id-btn");

    this._titleNameDiv = $("#title-name-div");
    this._titleNameInput = $("#title-name-input");
    this._editTitleNameBtn = $("#edit-title-name-btn");

    this._titleDescriptionDiv = $("#title-description-div");
    this._titleDescriptionInput = $("#title-description-input");
    this._editTitleDescriptionBtn = $("#edit-title-description-btn");

    this._titleYearDiv = $("#title-year-div");
    this._titleYearInput = $("#title-year-input");
    this._editTitleYearBtn = $("#edit-title-year-btn");

    this._titleTypeDiv = $("#title-type-div");
    this._titleTypeSelect = $("#title-type-select");
    this._editTitleTypeBtn = $("#edit-title-type-btn");

    this._titleSerieRow = $("#title-serie-row");
    this._titleSerieDiv = $("#title-serie-div");
    this._titleSerieInput = $("#title-serie-input");
    this._editTitleSerieBtn = $("#edit-title-serie-btn");

    this._titleSeasonRow = $("#title-season-row");
    this._titleSeasonDiv = $("#title-season-div");
    this._titleSeasonInput = $("#title-season-input");
    this._editTitleSeasonBtn = $("#edit-title-season-btn");

    this._titleEpisodeRow = $("#title-episode-row");
    this._titleEpisodeDiv = $("#title-episode-div");
    this._titleEpisodeInput = $("#title-episode-input");
    this._editTitleEpisodeBtn = $("#edit-title-episode-btn");

    this._titleGenresDiv = $("#title-genres-div");

    this._directorsTable = $("#directors-table");
    this._addDirectorsBtn = $("#add-directors-btn");

    this._writersTable = $("#writers-table");
    this._addWritersBtn = $("#add-writers-btn");

    this._actorsTable = $("#actors-table");
    this._addActorsBtn = $("#add-actors-btn");

    this._editPermissionsBtn = $("#edit-permissions-btn");
    this._collapsePanel = $("#collapse-panel");

    this._saveButton = $("#save-indexation-btn");
    this._cancelButton = $("#cancel-indexation-btn");

    this._collapseButton = $("#collapse-btn");
  }

  _bindEventListeners() {
    this._cancelButton?.addEventListener("click", this._handleCancelClick.bind(this));
    this._saveButton?.addEventListener("click", this._handleSaveClick.bind(this));

    if (this._imageSelector) {
      this._imageSelector.ondelete = () => {
        if (this._title.getPoster()) this._title.getPoster().setContenturl("");
      };
      this._imageSelector.onselectimage = (imageUrl) => {
        if (!this._title.getPoster()) this._title.setPoster(new Poster());
        this._title.getPoster().setContenturl(imageUrl);
      };
    }

    this._editPermissionsBtn?.addEventListener("click", this._handlePermissionsClick.bind(this));

    this._addActorsBtn?.addEventListener("click", (e) => this._handleAddPersonClick("actors", e));
    this._addWritersBtn?.addEventListener("click", (e) => this._handleAddPersonClick("writers", e));
    this._addDirectorsBtn?.addEventListener("click", (e) => this._handleAddPersonClick("directors", e));

    this._setupEditableField(this._titleIdDiv, this._titleIdInput, this._editTitleIdBtn, "setId", "text", this._updateHeaderName.bind(this));
    this._setupEditableField(this._titleNameDiv, this._titleNameInput, this._editTitleNameBtn, "setName", "text", this._updateHeaderName.bind(this));
    this._setupEditableField(this._titleDescriptionDiv, this._titleDescriptionInput, this._editTitleDescriptionBtn, "setDescription", "textarea");
    this._setupEditableField(this._titleYearDiv, this._titleYearInput, this._editTitleYearBtn, "setYear", "number");
    this._setupEditableField(this._titleSerieDiv, this._titleSerieInput, this._editTitleSerieBtn, "setSerie");
    this._setupEditableField(this._titleSeasonDiv, this._titleSeasonInput, this._editTitleSeasonBtn, "setSeason", "number");
    this._setupEditableField(this._titleEpisodeDiv, this._titleEpisodeInput, this._editTitleEpisodeBtn, "setEpisode", "number");

    if (this._editTitleTypeBtn && this._titleTypeSelect && this._titleTypeDiv) {
      this._editTitleTypeBtn.addEventListener("click", () => {
        this._titleTypeSelect.style.display = "table-cell";
        this._titleTypeDiv.style.display = "none";
      });
      this._titleTypeSelect.addEventListener("change", this._handleTypeChange.bind(this));
    }
  }

  _populateFields() {
    if (!this._title) return;

    if (this._imageSelector) {
      this._imageSelector.url = this._title.getPoster() ? this._title.getPoster().getContenturl() : "";
    }
    if (this._headerTextDiv) this._headerTextDiv.textContent = this._title.getName();

    if (this._titleIdDiv) this._titleIdDiv.textContent = this._title.getId();
    if (this._titleIdInput) this._titleIdInput.value = this._title.getId();

    if (this._titleNameDiv) this._titleNameDiv.textContent = this._title.getName();
    if (this._titleNameInput) this._titleNameInput.value = this._title.getName();

    if (this._titleDescriptionDiv) this._titleDescriptionDiv.textContent = this._title.getDescription();
    if (this._titleDescriptionInput) this._titleDescriptionInput.value = this._title.getDescription();

    if (this._titleYearDiv) this._titleYearDiv.textContent = String(this._title.getYear());
    if (this._titleYearInput) this._titleYearInput.value = this._title.getYear();

    if (this._titleTypeDiv) this._titleTypeDiv.textContent = this._title.getType();
    if (this._titleTypeSelect) this._titleTypeSelect.value = this._title.getType();

    if (this._titleSerieDiv) this._titleSerieDiv.textContent = this._title.getSerie();
    if (this._titleSerieInput) this._titleSerieInput.value = this._title.getSerie();

    if (this._titleSeasonDiv) this._titleSeasonDiv.textContent = String(this._title.getSeason());
    if (this._titleSeasonInput) this._titleSeasonInput.value = this._title.getSeason();

    if (this._titleEpisodeDiv) this._titleEpisodeDiv.textContent = String(this._title.getEpisode());
    if (this._titleEpisodeInput) this._titleEpisodeInput.value = this._title.getEpisode();

    if (!this._titleGenresList && this._titleGenresDiv) {
      this._titleGenresList = new EditableStringList(this._title.getGenresList());
      this._titleGenresDiv.appendChild(this._titleGenresList);
    } else if (this._titleGenresList) {
      this._titleGenresList.setItems(this._title.getGenresList());
    }

    this._updateEpisodeFieldsVisibility(this._title.getType());
  }

  _populatePersonEditors() {
    if (!this._title) return;
    const clear = (root) => root?.querySelectorAll("globular-person-editor").forEach((el) => el.remove());
    clear(this._directorsTable);
    clear(this._writersTable);
    clear(this._actorsTable);

    this._title.getDirectorsList().forEach((p) => this._appendPersonEditor(p, this._title, "directors"));
    this._title.getWritersList().forEach((p) => this._appendPersonEditor(p, this._title, "writers"));
    this._title.getActorsList().forEach((p) => this._appendPersonEditor(p, this._title, "actors"));
  }

  _setupEditableField(displayEl, inputEl, editBtn, setterName, inputType = "text", onSave) {
    if (!displayEl || !inputEl || !editBtn) return;

    editBtn.addEventListener("click", () => {
      displayEl.style.display = "none";
      (inputEl.parentNode ?? inputEl).style.display = "table-cell";
      setTimeout(() => {
        const focusEl = inputEl?.textarea ?? inputEl?.inputElement?._inputElement ?? null;
        if (focusEl && focusEl.focus) {
          focusEl.focus();
          focusEl.select && focusEl.select();
        }
      }, 0);
    });

    const saveAndDisplay = () => {
      const newValue = inputEl.value;
      let valueToSet = newValue;

      if (inputType === "number") valueToSet = parseInt(newValue) || 0;
      else if (inputType === "stringList") {
        valueToSet = newValue.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
        displayEl.textContent = valueToSet.join(", ");
      } else {
        displayEl.textContent = newValue;
      }

      if (this._title && typeof this._title[setterName] === "function") {
        this._title[setterName](valueToSet);
      }

      (inputEl.parentNode ?? inputEl).style.display = "none";
      displayEl.style.display = "table-cell";
      onSave && onSave(newValue);
    };

    inputEl.addEventListener("blur", saveAndDisplay);
    inputEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && inputType !== "textarea") { e.preventDefault(); saveAndDisplay(); }
      else if (e.key === "Escape") {
        e.preventDefault();
        inputEl.value = displayEl.textContent;
        (inputEl.parentNode ?? inputEl).style.display = "none";
        displayEl.style.display = "table-cell";
      }
    });
  }

  _updateHeaderName(name) {
    if (this._headerTextDiv) this._headerTextDiv.textContent = name;
  }

  _handleTypeChange() {
    const selectedType = this._titleTypeSelect.options[this._titleTypeSelect.selectedIndex].value;
    this._titleTypeDiv.textContent = selectedType;
    this._titleTypeSelect.style.display = "none";
    this._titleTypeDiv.style.display = "table-cell";
    if (this._title?.setType) this._title.setType(selectedType);
    this._updateEpisodeFieldsVisibility(selectedType);
  }

  _updateEpisodeFieldsVisibility(type) {
    const isEpisode = type === "TVEpisode";
    if (this._titleEpisodeRow) this._titleEpisodeRow.style.display = isEpisode ? "table-row" : "none";
    if (this._titleSerieRow) this._titleSerieRow.style.display = isEpisode ? "table-row" : "none";
    if (this._titleSeasonRow) this._titleSeasonRow.style.display = isEpisode ? "table-row" : "none";
  }

  _initPermissionsManager() {
    if (!this._title || !this._title.globule) return;

    this._permissionManager = new PermissionsManager();
    this._permissionManager.permissions = null;
    this._permissionManager.globule = this._title.globule;
    this._permissionManager.setPath(this._title.getId());
    this._permissionManager.setResourceType = "title_info";

    this._permissionManager.onclose = () => {
      this._collapsePanel?.toggle?.();
    };

    if (this._collapsePanel) {
      this._collapsePanel.innerHTML = "";
      this._collapsePanel.appendChild(this._permissionManager);
    }
  }

  _handlePermissionsClick() {
    this._collapsePanel?.toggle?.();
  }

  _handleCancelClick() {
    const parent = this.parentNode;
    if (parent && this._titleInfosDisplay) {
      parent.removeChild(this);
      parent.appendChild(this._titleInfosDisplay);
    } else if (parent) {
      parent.removeChild(this);
      console.warn("TitleInfoEditor: No titleInfosDisplay component to return to.");
    }
  }

  _saveAllFieldsToTitleObject() {
    if (!this._title) return;

    [
      this._titleIdInput, this._titleNameInput, this._titleDescriptionInput,
      this._titleYearInput, this._titleSerieInput, this._titleSeasonInput,
      this._titleEpisodeInput
    ].forEach((input) => {
      if (input && input.style.display !== "none" && typeof input.blur === "function") {
        input.blur();
      }
    });

    if (this._titleTypeSelect && this._titleTypeSelect.style.display !== "none") {
      const selectedType = this._titleTypeSelect.options[this._titleTypeSelect.selectedIndex].value;
      this._title.setType(selectedType);
    }
    if (this._titleGenresList) {
      this._title.setGenresList(this._titleGenresList.getItems());
    }
  }

  // ---------- Persistence via ../../backend/media/title
  async _handleSaveClick() {
    if (!this._title || !this._title.globule) {
      displayError("Title object or globule not set for saving.", 3000);
      return;
    }

    try {
      this._saveAllFieldsToTitleObject();

      // 1) Persist persons
      await this._savePersonsByRole(this._title.getDirectorsList(), "directors");
      await this._savePersonsByRole(this._title.getWritersList(), "writers");
      await this._savePersonsByRole(this._title.getActorsList(), "actors");

      // 2) Persist title
      await createOrUpdateTitle(this._title.globule, this._title);

      // 3) Extra metadata (if your backend helper wants it separately)
      await updateTitleMetadata(this._title.globule, this._title);

      displaySuccess("Title Information updated successfully!", 3000);

      if (this._titleInfosDisplay) {
        this._titleInfosDisplay.setTitle(this._title);
        this._handleCancelClick();
      } else {
        this.parentNode && this.parentNode.removeChild(this);
      }
    } catch (err) {
      console.error("Save title info error:", err);
      displayError(`Failed to save title information: ${err?.message || err}`, 3000);
    }
  }

  async _savePersonsByRole(personList, roleSlot) {
    const globule = this._title.globule;
    if (!globule) throw new Error("Globule not available for saving persons.");

    for (const person of personList) {
      try {
        await createOrUpdatePerson(globule, person);
      } catch (err) {
        console.error(`Failed to save person ${person.getFullname?.() || person.getId?.()} (${roleSlot})`, err);
      }
    }
  }

  // ---------- People UI
  _appendPersonEditor(person, title, slotName) {
    person.globule = title.globule;
    const editorId = `_person_editor_${getUuidByString(person.getId() + slotName)}`;
    let personEditor = this.shadowRoot.querySelector(`#${editorId}`);

    if (!personEditor) {
      personEditor = document.createElement("globular-person-editor");
      personEditor.id = editorId;
      personEditor.slot = slotName;

      personEditor.person = person;
      personEditor.title = title;

      personEditor.onremovefromcast = () => {
        personEditor.parentNode && personEditor.parentNode.removeChild(personEditor);
        this._populatePersonEditors();
      };

      if (slotName === "directors") this._directorsTable?.appendChild(personEditor);
      else if (slotName === "writers") this._writersTable?.appendChild(personEditor);
      else this._actorsTable?.appendChild(personEditor);
    }
    return personEditor;
  }

  async _handleAddPersonClick(roleSlotName, evt) {
    evt.stopPropagation();
    const buttonCell = evt.target.closest(".button-cell");
    if (!buttonCell) return;

    const panelId = "add-casting-panel";
    let addCastingPanel = buttonCell.querySelector(`#${panelId}`);
    if (addCastingPanel) return;

    const html = `
      <style>
        #${panelId}{
          z-index:101;background-color:var(--surface-color);color:var(--primary-text-color);
          position:absolute;top:100%;right:0;width:300px;box-shadow:var(--shadow-elevation-4dp);
          border-radius:8px;overflow:hidden;padding:10px;display:flex;flex-direction:column;gap:10px;
        }
        #${panelId} .panel-actions{display:flex;justify-content:flex-end;gap:8px;padding-top:10px;border-top:1px solid var(--palette-divider);}
      </style>
      <paper-card id="${panelId}">
        <globular-search-person-input indexpath="${this._title.globule.config.DataPath}/search/titles"></globular-search-person-input>
        <div class="panel-actions">
          <paper-button id="new-person-btn" title="Create a new person">New</paper-button>
          <paper-button id="cancel-btn">Cancel</paper-button>
        </div>
      </paper-card>
    `;

    buttonCell.appendChild(document.createRange().createContextualFragment(html));
    addCastingPanel = buttonCell.querySelector(`#${panelId}`);

    const searchPersonInput = addCastingPanel.querySelector("globular-search-person-input");
    const newPersonBtn = addCastingPanel.querySelector("#new-person-btn");
    const cancelBtn = addCastingPanel.querySelector("#cancel-btn");

    // Open full editor for an existing person
    searchPersonInput.oneditperson = (person) => {
      person.globule = this._title.globule;
      const editor = new PersonEditor(person, this._title);
      editor.slot = roleSlotName;

      const dialogId = `_person_editor_dialog_${getUuidByString(person.getId())}`;
      let dialog = document.body.querySelector(`#${dialogId}`);

      if (!dialog) {
        const dialogHtml = `
          <style>
            #${dialogId}{
              z-index:1000;position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);
              background-color:var(--surface-color);border:1px solid var(--palette-divider);
              box-shadow:var(--shadow-elevation-6dp);border-radius:8px;overflow:hidden;display:flex;
            }
          </style>
          <paper-card id="${dialogId}"></paper-card>
        `;
        document.body.appendChild(document.createRange().createContextualFragment(dialogHtml));
        dialog = document.body.querySelector(`#${dialogId}`);
      }
      editor.onclose = () => {
        dialog && dialog.parentNode && dialog.parentNode.removeChild(dialog);
        this._populatePersonEditors();
      };
      editor.onremovefromcast = () => {
        dialog && dialog.parentNode && dialog.parentNode.removeChild(dialog);
        this._populatePersonEditors();
      };

      dialog.appendChild(editor);
      editor.focus && editor.focus();
      addCastingPanel.parentNode && addCastingPanel.parentNode.removeChild(addCastingPanel);
    };

    // Quick-add existing person to cast
    searchPersonInput.onaddcasting = async (personToAdd) => {
      personToAdd.globule = this._title.globule;
      try {
        const titleId = this._title.getId();
        const person = personToAdd;

        const updatePersonList = (listGetter, listSetter) => {
          let current = listGetter.call(person) || [];
          if (!current.includes(titleId)) current = [...current, titleId];
          listSetter.call(person, current);
        };
        if (roleSlotName === "actors") updatePersonList(person.getActingList, person.setActingList);
        else if (roleSlotName === "writers") updatePersonList(person.getWritingList, person.setWritingList);
        else updatePersonList(person.getDirectingList, person.setDirectingList);

        // Persist person via helper
        await createOrUpdatePerson(this._title.globule, person);

        // Update title lists locally
        const addToTitle = (listGetter, listSetter) => {
          const current = listGetter.call(this._title) || [];
          if (!current.some((p) => p.getId() === person.getId())) {
            listSetter.call(this._title, [...current, person]);
          }
        };
        if (roleSlotName === "actors") addToTitle(this._title.getActorsList, this._title.setActorsList);
        else if (roleSlotName === "writers") addToTitle(this._title.getWritersList, this._title.setWritersList);
        else addToTitle(this._title.getDirectorsList, this._title.setDirectorsList);

        // Persist title via helper
        await createOrUpdateTitle(this._title.globule, this._title);

        displaySuccess(`${person.getFullname()} added to ${roleSlotName}.`, 3000);
        this._populatePersonEditors();

        addCastingPanel.parentNode && addCastingPanel.parentNode.removeChild(addCastingPanel);
      } catch (err) {
        displayError(`Failed to add person to cast: ${err?.message || err}`, 3000);
      }
    };

    // Create brand-new person and open inline editor
    newPersonBtn.onclick = () => {
      const newPerson = new Person();
      newPerson.setId(`New Person_${randomUUID().substring(0, 8)}`);
      newPerson.setFullname("New Person");
      newPerson.globule = this._title.globule;

      const editor = this._appendPersonEditor(newPerson, this._title, roleSlotName);
      editor?.focus && editor.focus();
      addCastingPanel.parentNode && addCastingPanel.parentNode.removeChild(addCastingPanel);
    };

    cancelBtn.onclick = () => {
      addCastingPanel.parentNode && addCastingPanel.parentNode.removeChild(addCastingPanel);
    };
  }
}

customElements.define("globular-title-info-editor", TitleInfoEditor);
