import getUuidByString from "uuid-by-string";
import {  Backend } from "../../backend/backend";
import { displayError, displaySuccess, displayMessage} from "../../backend/ui/notify";
import '@polymer/iron-icons/editor-icons.js';
import '@polymer/paper-input/paper-input.js';
import '@polymer/paper-icon-button/paper-icon-button.js';
import '@polymer/iron-collapse/iron-collapse.js';
import '@polymer/paper-button/paper-button.js';
import { ImageSelector } from '../image.js';

// ✅ use accessor helpers instead of raw protobuf requests / direct services
import {
  createOrUpdatePerson,
  createOrUpdateTitle,
  createOrUpdateVideo,
  deletePerson as deletePersonById,
} from "../../backend/media/title";


export class PersonEditor extends HTMLElement {
  _person = null;
  _titleInfo = null;
  _uuid = null;

  _headerTextDiv = null;
  _removePersonBtn = null;
  _collapseButton = null;
  _collapsePanel = null;
  _imageSelector = null;

  _personIdDiv = null; _personIdInput = null; _editPersonIdBtn = null;
  _personUrlDiv = null; _personUrlInput = null; _editPersonUrlBtn = null;
  _personNameDiv = null; _personNameInput = null; _editPersonNameBtn = null;
  _personAliasesDiv = null; _personAliasesInput = null; _editPersonAliasesBtn = null;
  _personBirthdateDiv = null; _personBirthdateInput = null; _editPersonBirthdateBtn = null;
  _personBirthplaceDiv = null; _personBirthplaceInput = null; _editPersonBirthplaceBtn = null;
  _personBiographyDiv = null; _personBiographyInput = null; _editPersonBiographyBtn = null;

  _saveCastBtn = null;
  _deleteBtn = null;

  onclose = null;
  onremovefromcast = null;

  constructor(person, title) {
    super();
    this.attachShadow({ mode: 'open' });

    this._person = person;
    this.setTitleObject(title);
    this._uuid = `_${getUuidByString(person.getId())}`;

    this._renderInitialStructure();
    this._getDomReferences();
    this._bindEventListeners();
    this._populateFields();

    // keep old subscription behavior
    Backend.eventHub.subscribe(
      `delete_${this._person.getId()}_evt`,
      () => {},
      () => {
        if (this.parentNode) this.parentNode.removeChild(this);
      },
      true,
      this
    );
  }

  _renderInitialStructure() {
    const imageUrl = this._person.getPicture() || "";
    let bio = this._person.getBiography();
    try { bio = bio ? atob(bio) : ""; } catch { bio = this._person.getBiography() || ""; }

    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: flex;
          width: 100%;
          min-width: 0;
          min-height: 0;
        }
        #container {
          display:flex;
          flex-grow:1;
          flex-direction:column;
          color:var(--primary-text-color);
          padding:15px;
          border:1px solid var(--palette-divider);
          border-radius:8px;
          margin:0 0 15px 0;
          width:100%;
          box-sizing:border-box;
        }
        .header-row { display:flex; align-items:center; border-bottom:1px solid var(--palette-divider); padding-bottom:10px; margin-bottom:10px; }
        .header-text { flex-grow:1; font-size:1.2rem; font-weight:bold; margin-left:8px; }
        .content-area { display:flex; flex-wrap:wrap; min-width:0; gap:20px; }
        .image-column { display:flex; flex-direction:column; justify-content:flex-start; margin-right:20px; flex-shrink:0; align-items:center; min-width:150px; }
        .info-table { display:table; width:100%; border-collapse:collapse; flex-grow:1; min-width:0; }
        .info-row { display:table-row; border-bottom:1px solid var(--palette-divider); }
        .info-row:last-child { border-bottom:none; }
        .label { display:table-cell; font-weight:500; padding-right:15px; min-width:120px; vertical-align:middle; padding:8px 0; white-space:nowrap; }
        .value-display { display:table-cell; width:100%; padding:8px 0; vertical-align:middle; }
        .input-field {
          display:table-cell;
          width:100%;
          padding:8px 0;
          vertical-align:middle;
        }
        .input-field.hidden { display:none; }
        .value-display a { color:var(--primary-text-color); }
        .value-display a:hover { text-decoration:underline; }
        .input-field paper-input, .input-field iron-autogrow-textarea {
          width:100%;
          --paper-input-container-color: var(--primary-text-color);
          --paper-input-container-focus-color: var(--primary-color);
          --paper-input-container-label-floating-color: var(--primary-color);
          --paper-input-container-input-color: var(--primary-text-color);
        }
        .button-cell { display:table-cell; width:48px; vertical-align:middle; }
        .button-cell iron-icon { color:var(--primary-text-color); }
        .button-cell iron-icon:hover { color:var(--primary-color); cursor:pointer; }
        .action-buttons-bottom { display:flex; justify-content:flex-end; gap:10px; padding-top:15px; }
        paper-button { background-color:var(--primary-color); color:var(--on-primary-color); padding:8px 16px; border-radius:4px; }
        paper-button:hover { background-color:var(--primary-dark-color); }
      </style>

      <div id="container">
        <div class="header-row">
          <paper-icon-button id="collapse-btn" icon="unfold-more"></paper-icon-button>
          <div id="header-text" class="header-text">${this._person.getFullname()}</div>
          <paper-icon-button id="edit-${this._uuid}-person-remove-btn" icon="icons:close" title="Remove from list"></paper-icon-button>
        </div>
        <iron-collapse id="collapse-panel">
          <div class="content-area">
            <div class="image-column">
              <globular-image-selector label="Profile Picture" url="${imageUrl}"></globular-image-selector>
            </div>
            <div class="info-table">
              <div class="info-row">
                <div class="label">Id:</div>
                <div class="value-display" id="${this._uuid}-person-id-div"></div>
                <div class="input-field hidden"><paper-input id="${this._uuid}-person-id-input" no-label-float></paper-input></div>
                <div class="button-cell"><paper-icon-button id="edit-${this._uuid}-person-id-btn" icon="editor:mode-edit"></paper-icon-button></div>
              </div>

              <div class="info-row">
                <div class="label">Url:</div>
                <div class="value-display" id="${this._uuid}-person-url-div"></div>
                <div class="input-field hidden"><paper-input id="${this._uuid}-person-url-input" no-label-float></paper-input></div>
                <div class="button-cell"><paper-icon-button id="edit-${this._uuid}-person-url-btn" icon="editor:mode-edit"></paper-icon-button></div>
              </div>

              <div class="info-row">
                <div class="label">Name:</div>
                <div class="value-display" id="${this._uuid}-person-name-div"></div>
                <div class="input-field hidden"><paper-input id="${this._uuid}-person-name-input" no-label-float></paper-input></div>
                <div class="button-cell"><paper-icon-button id="edit-${this._uuid}-person-name-btn" icon="editor:mode-edit"></paper-icon-button></div>
              </div>

              <div class="info-row">
                <div class="label">Aliases:</div>
                <div class="value-display" id="${this._uuid}-person-aliases-div"></div>
                <div class="input-field hidden"><paper-input id="${this._uuid}-person-aliases-input" no-label-float></paper-input></div>
                <div class="button-cell"><paper-icon-button id="edit-${this._uuid}-person-aliases-btn" icon="editor:mode-edit"></paper-icon-button></div>
              </div>

              <div class="info-row">
                <div class="label">Date of birth:</div>
                <div class="value-display" id="${this._uuid}-person-birthdate-div"></div>
                <div class="input-field hidden"><paper-input id="${this._uuid}-person-birthdate-input" no-label-float></paper-input></div>
                <div class="button-cell"><paper-icon-button id="edit-${this._uuid}-person-birthdate-btn" icon="editor:mode-edit"></paper-icon-button></div>
              </div>

              <div class="info-row">
                <div class="label">Place of birth:</div>
                <div class="value-display" id="${this._uuid}-person-birthplace-div"></div>
                <div class="input-field hidden"><paper-input id="${this._uuid}-person-birthplace-input" no-label-float></paper-input></div>
                <div class="button-cell"><paper-icon-button id="edit-${this._uuid}-person-birthplace-btn" icon="editor:mode-edit"></paper-icon-button></div>
              </div>

              <div class="info-row">
                <div class="label" style="vertical-align: top;">Biography:</div>
                <div class="value-display" id="${this._uuid}-person-biography-div"></div>
                <div class="input-field hidden">
                  <iron-autogrow-textarea id="${this._uuid}-person-biography-input" style="border:none; width:100%;"></iron-autogrow-textarea>
                </div>
                <div class="button-cell"><paper-icon-button id="edit-${this._uuid}-person-biography-btn" icon="editor:mode-edit" style="vertical-align: top;"></paper-icon-button></div>
              </div>
            </div>
          </div>
        </iron-collapse>
        <div class="action-buttons-bottom">
          <paper-button id="${this._uuid}-save-btn" title="Save person information">Save</paper-button>
          <paper-button id="${this._uuid}-delete-btn" title="Delete person information">Delete</paper-button>
        </div>
      </div>
    `;
  }

  _getDomReferences() {
    this._headerTextDiv = this.shadowRoot.querySelector("#header-text");
    this._removePersonBtn = this.shadowRoot.querySelector(`#edit-${this._uuid}-person-remove-btn`);
    this._collapseButton = this.shadowRoot.querySelector("#collapse-btn");
    this._collapsePanel = this.shadowRoot.querySelector("#collapse-panel");
    this._imageSelector = this.shadowRoot.querySelector("globular-image-selector");

    this._personIdDiv = this.shadowRoot.querySelector(`#${this._uuid}-person-id-div`);
    this._personIdInput = this.shadowRoot.querySelector(`#${this._uuid}-person-id-input`);
    this._editPersonIdBtn = this.shadowRoot.querySelector(`#edit-${this._uuid}-person-id-btn`);

    this._personUrlDiv = this.shadowRoot.querySelector(`#${this._uuid}-person-url-div`);
    this._personUrlInput = this.shadowRoot.querySelector(`#${this._uuid}-person-url-input`);
    this._editPersonUrlBtn = this.shadowRoot.querySelector(`#edit-${this._uuid}-person-url-btn`);

    this._personNameDiv = this.shadowRoot.querySelector(`#${this._uuid}-person-name-div`);
    this._personNameInput = this.shadowRoot.querySelector(`#${this._uuid}-person-name-input`);
    this._editPersonNameBtn = this.shadowRoot.querySelector(`#edit-${this._uuid}-person-name-btn`);

    this._personAliasesDiv = this.shadowRoot.querySelector(`#${this._uuid}-person-aliases-div`);
    this._personAliasesInput = this.shadowRoot.querySelector(`#${this._uuid}-person-aliases-input`);
    this._editPersonAliasesBtn = this.shadowRoot.querySelector(`#edit-${this._uuid}-person-aliases-btn`);

    this._personBirthdateDiv = this.shadowRoot.querySelector(`#${this._uuid}-person-birthdate-div`);
    this._personBirthdateInput = this.shadowRoot.querySelector(`#${this._uuid}-person-birthdate-input`);
    this._editPersonBirthdateBtn = this.shadowRoot.querySelector(`#edit-${this._uuid}-person-birthdate-btn`);

    this._personBirthplaceDiv = this.shadowRoot.querySelector(`#${this._uuid}-person-birthplace-div`);
    this._personBirthplaceInput = this.shadowRoot.querySelector(`#${this._uuid}-person-birthplace-input`);
    this._editPersonBirthplaceBtn = this.shadowRoot.querySelector(`#edit-${this._uuid}-person-birthplace-btn`);

    this._personBiographyDiv = this.shadowRoot.querySelector(`#${this._uuid}-person-biography-div`);
    this._personBiographyInput = this.shadowRoot.querySelector(`#${this._uuid}-person-biography-input`);
    this._editPersonBiographyBtn = this.shadowRoot.querySelector(`#edit-${this._uuid}-person-biography-btn`);

    this._saveCastBtn = this.shadowRoot.querySelector(`#${this._uuid}-save-btn`);
    this._deleteBtn = this.shadowRoot.querySelector(`#${this._uuid}-delete-btn`);
  }

  _bindEventListeners() {
    if (this._collapseButton && this._collapsePanel) {
      this._collapseButton.addEventListener('click', this._handleCollapseToggle.bind(this));
      this._collapseButton.icon = this._collapsePanel.opened ? "unfold-less" : "unfold-more";
    }

    if (this._imageSelector) {
      this._imageSelector.ondelete = () => { if (this._person) this._person.setPicture(""); };
      this._imageSelector.onselectimage = (url) => { if (this._person) this._person.setPicture(url); };
    }

    if (this._saveCastBtn) this._saveCastBtn.addEventListener('click', this._handleSaveClick.bind(this));
    if (this._deleteBtn) this._deleteBtn.addEventListener('click', this._handleDeleteClick.bind(this));
    if (this._removePersonBtn) this._removePersonBtn.addEventListener('click', this._handleRemoveFromCastClick.bind(this));

    this._setupEditableField(this._personIdDiv, this._personIdInput, this._editPersonIdBtn, 'setId');
    this._setupEditableField(this._personUrlDiv, this._personUrlInput, this._editPersonUrlBtn, 'setUrl');
    this._setupEditableField(this._personNameDiv, this._personNameInput, this._editPersonNameBtn, 'setFullname', 'text', this._updateHeaderText.bind(this));
    this._setupEditableField(this._personAliasesDiv, this._personAliasesInput, this._editPersonAliasesBtn, 'setAliasesList', 'stringList');
    this._setupEditableField(this._personBirthdateDiv, this._personBirthdateInput, this._editPersonBirthdateBtn, 'setBirthdate');
    this._setupEditableField(this._personBirthplaceDiv, this._personBirthplaceInput, this._editPersonBirthplaceBtn, 'setBirthplace');
    this._setupEditableField(this._personBiographyDiv, this._personBiographyInput, this._editPersonBiographyBtn, 'setBiography', 'textarea', this._encodeBiography.bind(this));
  }

  _populateFields() {
    if (!this._person) return;

    this._imageSelector.url = this._person.getPicture();
    this._headerTextDiv.textContent = this._person.getFullname();

    this._personIdDiv.textContent = this._person.getId();
    this._personIdInput.value = this._person.getId();

    this._personUrlDiv.textContent = this._person.getUrl();
    this._personUrlInput.value = this._person.getUrl();

    this._personNameDiv.textContent = this._person.getFullname();
    this._personNameInput.value = this._person.getFullname();

    this._personAliasesDiv.textContent = this._person.getAliasesList().join(", ");
    this._personAliasesInput.value = this._person.getAliasesList().join(", ");

    this._personBirthdateDiv.textContent = this._person.getBirthdate();
    this._personBirthdateInput.value = this._person.getBirthdate();

    this._personBirthplaceDiv.textContent = this._person.getBirthplace();
    this._personBirthplaceInput.value = this._person.getBirthplace();

    let decodedBio = this._person.getBiography();
    try { decodedBio = decodedBio ? atob(decodedBio) : ""; } catch { decodedBio = this._person.getBiography(); }
    this._personBiographyDiv.textContent = decodedBio;
    this._personBiographyInput.value = decodedBio;

    this._resetEditableFieldState(this._personIdDiv, this._personIdInput);
    this._resetEditableFieldState(this._personUrlDiv, this._personUrlInput);
    this._resetEditableFieldState(this._personNameDiv, this._personNameInput);
    this._resetEditableFieldState(this._personAliasesDiv, this._personAliasesInput);
    this._resetEditableFieldState(this._personBirthdateDiv, this._personBirthdateInput);
    this._resetEditableFieldState(this._personBirthplaceDiv, this._personBirthplaceInput);
    this._resetEditableFieldState(this._personBiographyDiv, this._personBiographyInput, 'textarea');
  }

  _setupEditableField(displayEl, inputEl, editBtn, setter, inputType = 'text', onSaveCb = null) {
    if (!displayEl || !inputEl || !editBtn) return;

    const inputContainer = (inputType === 'textarea' ? inputEl.parentNode : inputEl.parentNode ?? inputEl);
    const showInput = () => inputContainer?.classList?.remove("hidden");
    const hideInput = () => inputContainer?.classList?.add("hidden");
    hideInput();

    editBtn.addEventListener('click', () => {
      displayEl.style.display = 'none';
      showInput();
      setTimeout(() => {
        const focusEl = inputEl?.textarea ?? inputEl?.inputElement?._inputElement ?? null;
        if (focusEl) { focusEl.focus(); focusEl.select && focusEl.select(); }
      }, 100);
    });

    const saveAndDisplay = () => {
      const newValue = inputEl.value;
      let valueToSet = newValue;

      if (inputType === 'stringList') {
        valueToSet = newValue.split(',').map(s => s.trim()).filter(Boolean);
        displayEl.textContent = valueToSet.join(", ");
      } else if (setter === 'setBiography') {
        valueToSet = btoa(newValue);
        displayEl.textContent = newValue;
      } else {
        displayEl.textContent = newValue;
      }

      if (this._person && typeof this._person[setter] === 'function') {
        this._person[setter](valueToSet);
      }

      hideInput();
      displayEl.style.display = 'table-cell';
      if (onSaveCb) onSaveCb(newValue);
    };

    inputEl.addEventListener('blur', saveAndDisplay);
    inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && inputType !== 'textarea') { e.preventDefault(); saveAndDisplay(); }
      else if (e.key === 'Escape') {
        e.preventDefault();
        inputEl.value = displayEl.textContent;
        hideInput();
        displayEl.style.display = 'table-cell';
      }
    });
  }

  _resetEditableFieldState(displayEl, inputEl, inputType = 'text') {
    if (!displayEl || !inputEl) return;
    displayEl.style.display = 'table-cell';
    const inputContainer = (inputType === 'textarea' ? inputEl.parentNode : inputEl.parentNode ?? inputEl);
    inputContainer?.classList?.add("hidden");
  }

  setTitleObject(title) {
    if (this._titleInfo !== title) {
      this._titleInfo = title;
    }
    return this;
  }

  getTitleObject() {
    return this._titleInfo;
  }

  setTitle(title) {
    return this.setTitleObject(title);
  }

  _updateHeaderText(newName) {
    if (this._headerTextDiv) this._headerTextDiv.textContent = newName;
  }

  _encodeBiography(bio) { return btoa(bio); }

  _handleCollapseToggle() {
    if (this._collapsePanel) {
      this._collapsePanel.toggle();
      this._collapseButton.icon = this._collapsePanel.opened ? "unfold-less" : "unfold-more";
    }
  }

  _saveAllFieldsToPersonObject() {
    if (!this._person) return;
    [
      this._personIdInput, this._personUrlInput, this._personNameInput,
      this._personAliasesInput, this._personBirthdateInput, this._personBirthplaceInput,
      this._personBiographyInput
    ].forEach(input => {
      if (!input || typeof input.blur !== 'function') return;
      const container = input.parentNode ?? input;
      const isHidden = container?.classList?.contains('hidden');
      if (!isHidden) input.blur();
    });

    this._person.setId(this._personIdInput.value);
    this._person.setFullname(this._personNameInput.value);
    this._person.setUrl(this._personUrlInput.value);
    this._person.setBiography(btoa(this._personBiographyInput.value));
    if (this._imageSelector?.getImageUrl) this._person.setPicture(this._imageSelector.getImageUrl());

    const aliases = this._personAliasesInput.value.split(',').map(a => a.trim()).filter(Boolean);
    this._person.setAliasesList(aliases);
    this._person.setBirthdate(this._personBirthdateInput.value);
    this._person.setBirthplace(this._personBirthplaceInput.value);
  }

  // Helper to pick a sensible indexPath (falls back to title.ts defaults)
  _resolveIndexPath(kind /* 'titles' | 'videos' */) {
    const dataPath = this._person?.globule?.config?.DataPath; // optional
    if (!dataPath) return undefined; // let accessor default ("/search/...") kick in
    return `${dataPath}/search/${kind}`;
  }

  async _handleSaveClick() {
    if (!this._person) {
      displayError("Person object not set.", 3000);
      return;
    }

    this._saveAllFieldsToPersonObject();

    try {
      // 1) Save person itself
      const personIndex = this._resolveIndexPath('titles'); // people live in titles index by default
      await createOrUpdatePerson(this._person, personIndex);
      displaySuccess(`${this._person.getFullname()} info was saved!`, 3000);

      // 2) If attached to a Title/Video, mirror the association on both sides and upsert the media doc
      if (this._titleInfo) {
        const titleId = this._titleInfo.getId?.();
        if (titleId) {
          const addId = (getter, setter) => {
            let arr = getter.call(this._person) || [];
            if (!arr.includes(titleId)) arr = [...arr, titleId];
            setter.call(this._person, arr);
          };
          const addPerson = (getter, setter) => {
            let arr = getter.call(this._titleInfo) || [];
            if (!arr.some(p => p.getId() === this._person.getId())) arr = [...arr, this._person];
            setter.call(this._titleInfo, arr);
          };

          if (this.slot === "casting") {
            addId(this._person.getCastingList, this._person.setCastingList);
            addPerson(this._titleInfo.getCastingList, this._titleInfo.setCastingList);
            await createOrUpdateVideo(this._titleInfo, this._resolveIndexPath('videos'));
          } else if (this.slot === "actors") {
            addId(this._person.getActingList, this._person.setActingList);
            addPerson(this._titleInfo.getActorsList, this._titleInfo.setActorsList);
            await createOrUpdateTitle(this._titleInfo, this._resolveIndexPath('titles'));
          } else if (this.slot === "writers") {
            addId(this._person.getWritingList, this._person.setWritingList);
            addPerson(this._titleInfo.getWritersList, this._titleInfo.setWritersList);
            await createOrUpdateTitle(this._titleInfo, this._resolveIndexPath('titles'));
          } else if (this.slot === "directors") {
            addId(this._person.getDirectingList, this._person.setDirectingList);
            addPerson(this._titleInfo.getDirectorsList, this._titleInfo.setDirectorsList);
            await createOrUpdateTitle(this._titleInfo, this._resolveIndexPath('titles'));
          }
        }
      }
    } catch (err) {
      displayError(`Failed to save person info: ${err.message}`, 3000);
      return;
    }

    displaySuccess("Saved.", 1200);
  }

  async _handleDeleteClick() {
    if (!this._person || this._person.getFullname().length === 0) {
      if (this.parentNode) this.parentNode.removeChild(this);
      return;
    }

    const dialogHtml = `
      <style>
        #delete-person-dialog-content { display:flex; flex-direction:column; align-items:center; text-align:center; }
        #delete-person-dialog-content img { width:185px; height:auto; object-fit:contain; padding:10px 0 15px; align-self:center; }
        #delete-person-dialog-content .dialog-actions { display:flex; justify-content:flex-end; width:100%; gap:10px; margin-top:20px; }
      </style>
      <div id="delete-person-dialog-content">
        <div>You're about to delete <span style="font-size:1.2rem; font-weight:bold;">${this._person.getFullname()}</span></div>
        <img src="${this._person.getPicture()}" alt="Person Profile">
        <div>Is that what you want to do?</div>
        <div class="dialog-actions">
          <paper-button id="delete-person-cancel-btn">Cancel</paper-button>
          <paper-button id="delete-person-ok-btn">Ok</paper-button>
        </div>
      </div>
    `;
    const toast = displayMessage(dialogHtml, 60 * 1000);

    const cancelBtn = toast.toastElement.querySelector("#delete-person-cancel-btn");
    const okBtn = toast.toastElement.querySelector("#delete-person-ok-btn");
    cancelBtn.onclick = () => toast.hideToast();

    okBtn.onclick = async () => {
      toast.hideToast();
      try {
        const personIndex = this._resolveIndexPath('titles');
        await deletePersonById(this._person.getId(), personIndex);
        displaySuccess(`${this._person.getFullname()} information was deleted!`, 3000);
        Backend.eventHub.publish(`delete_${this._person.getId()}_evt`, {}, true);
      } catch (err) {
        displayError(`Failed to delete person: ${err.message}`, 3000);
      }
    };
  }

  async _handleRemoveFromCastClick() {
    if (!this._person || this._person.getFullname().length === 0) {
      if (this.parentNode) this.parentNode.removeChild(this);
      return;
    }
    if (!this._titleInfo) {
      if (this.parentNode) this.parentNode.removeChild(this);
      if (this.onclose) this.onclose();
      return;
    }

    const dialogHtml = `
      <style>
        #remove-from-cast-dialog { display:flex; flex-direction:column; align-items:center; text-align:center; }
        #remove-from-cast-dialog img { width:185px; height:auto; object-fit:contain; padding:10px 0 15px; align-self:center; }
        #remove-from-cast-dialog .dialog-actions { display:flex; justify-content:flex-end; width:100%; gap:10px; margin-top:20px; }
      </style>
      <div id="remove-from-cast-dialog">
        <div>You're about to remove <span style="font-size:1.2rem; font-weight:bold;">${this._person.getFullname()}</span></div>
        <img src="${this._person.getPicture()}" alt="Person Profile">
        <div>from ${this._titleInfo.getDescription ? this._titleInfo.getDescription() : this._titleInfo.getName()}</div>
        <img src="${this._titleInfo.getPoster ? this._titleInfo.getPoster().getContenturl() : ''}" alt="Title Poster">
        <div>Is that what you want to do?</div>
        <div class="dialog-actions">
          <paper-button id="remove-cancel-btn">Cancel</paper-button>
          <paper-button id="remove-ok-btn">Ok</paper-button>
        </div>
      </div>
    `;
    const toast = displayMessage(dialogHtml, 60 * 1000);

    const cancelBtn = toast.toastElement.querySelector("#remove-cancel-btn");
    const okBtn = toast.toastElement.querySelector("#remove-ok-btn");
    cancelBtn.onclick = () => toast.hideToast();

    okBtn.onclick = async () => {
      toast.hideToast();
      const person = this._person;
      const titleInfo = this._titleInfo;

      try {
        // detach id ↔ object on both sides
        const removeTitleId = (getter, setter) => {
          let arr = getter.call(person) || [];
          arr = arr.filter(id => id !== titleInfo.getId());
          setter.call(person, arr);
        };
        const removePerson = (getter, setter) => {
          let arr = getter.call(titleInfo) || [];
          arr = arr.filter(p => p.getId() !== person.getId());
          setter.call(titleInfo, arr);
        };

        if (this.slot === "casting") {
          removeTitleId(person.getCastingList, person.setCastingList);
          removePerson(titleInfo.getCastingList, titleInfo.setCastingList);
          await createOrUpdatePerson(person, this._resolveIndexPath('titles'));
          await createOrUpdateVideo(titleInfo, this._resolveIndexPath('videos'));
        } else if (this.slot === "actors") {
          removeTitleId(person.getActingList, person.setActingList);
          removePerson(titleInfo.getActorsList, titleInfo.setActorsList);
          await createOrUpdatePerson(person, this._resolveIndexPath('titles'));
          await createOrUpdateTitle(titleInfo, this._resolveIndexPath('titles'));
        } else if (this.slot === "writers") {
          removeTitleId(person.getWritingList, person.setWritingList);
          removePerson(titleInfo.getWritersList, titleInfo.setWritersList);
          await createOrUpdatePerson(person, this._resolveIndexPath('titles'));
          await createOrUpdateTitle(titleInfo, this._resolveIndexPath('titles'));
        } else if (this.slot === "directors") {
          removeTitleId(person.getDirectingList, person.setDirectingList);
          removePerson(titleInfo.getDirectorsList, titleInfo.setDirectorsList);
          await createOrUpdatePerson(person, this._resolveIndexPath('titles'));
          await createOrUpdateTitle(titleInfo, this._resolveIndexPath('titles'));
        }

        displaySuccess(`${person.getFullname()} was removed from the cast of ${titleInfo.getDescription ? titleInfo.getDescription() : titleInfo.getName()}`, 3000);
        if (this.onremovefromcast) this.onremovefromcast(person);
        if (this.parentNode) this.parentNode.removeChild(this);
      } catch (err) {
        displayError(`Failed to remove ${person.getFullname()} from cast: ${err.message}`, 3000);
      }
    };
  }

  focus() {
    if (this._collapsePanel && !this._collapsePanel.opened) this._handleCollapseToggle();
    this._editPersonIdBtn?.click();
  }

  getPerson() {
    this._saveAllFieldsToPersonObject();
    return this._person;
  }
}

customElements.define('globular-person-editor', PersonEditor);
