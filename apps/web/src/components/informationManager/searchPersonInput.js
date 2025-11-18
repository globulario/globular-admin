import getUuidByString from "uuid-by-string";
import { displayError, displaySuccess} from "../../backend/ui/notify";

// Use your accessor functions from title.ts (no direct gRPC here)
import { searchPersons } from "../../backend/media/title"; // <-- adjust path if needed

// UI deps
import '@polymer/paper-input/paper-input.js';
import '@polymer/iron-icon/iron-icon.js';
import '@polymer/iron-icons/iron-icons.js';
import '@polymer/iron-icons/editor-icons.js';
import '@polymer/paper-button/paper-button.js';

/**
 * Custom element providing a search input for persons and displaying results.
 * Allows editing or adding persons to a casting list.
 */
export class SearchPersonInput extends HTMLElement {
  _indexPath = null;
  _titleInfo = null;
  _searchInput = null;
  _searchResultsDiv = null;
  _searchIcon = null;

  /** Optional callbacks provided by the host */
  onclose = null;
  oneditperson = null;
  onaddcasting = null;

  constructor() {
    super();
    this.attachShadow({ mode: "open" });

    // indexpath can be provided as an attribute
    this._indexPath = this.getAttribute("indexpath") || "";

    this._renderInitialStructure();
    this._getDomReferences();
    this._bindEventListeners();
  }

  connectedCallback() {
    if (this._searchInput) {
      setTimeout(() => {
        this._searchInput.focus();
        if (
          this._searchInput.inputElement &&
          this._searchInput.inputElement._inputElement
        ) {
          this._searchInput.inputElement._inputElement.select();
        }
      }, 100);
    }
  }

  /** Optionally provide the Title/Video object if you need context for add-to-casting actions */
  setTitleInfo(titleInfo) {
    this._titleInfo = titleInfo;
  }

  _renderInitialStructure() {
    this.shadowRoot.innerHTML = `
      <style>
        #container {
          display: flex;
          flex-direction: column;
          background-color: var(--surface-color);
          color: var(--primary-text-color);
          border-radius: 8px;
          overflow: hidden;
        }

        .search-input-row {
          display: flex;
          align-items: center;
          min-width: 240px;
          padding: 5px;
          border-bottom: 1px solid var(--palette-divider);
        }

        paper-input {
          flex-grow: 1;
          margin-left: 5px;
          --paper-input-container-color: var(--primary-text-color);
          --paper-input-container-focus-color: var(--primary-color);
          --paper-input-container-label-floating-color: var(--primary-color);
          --paper-input-container-input-color: var(--primary-text-color);
          --paper-input-container-underline: { height: 1px; };
          --paper-input-container-underline-focus: { height: 2px; };
        }

        ::-webkit-scrollbar {
          width: 10px;
        }
        ::-webkit-scrollbar-track {
          background: var(--scroll-track, var(--surface-color));
        }
        ::-webkit-scrollbar-thumb {
          background: var(--scroll-thumb, var(--palette-divider));
          border-radius: 6px;
        }

        .search-results {
          background-color: var(--surface-color);
          color: var(--primary-text-color);
          max-height: 300px;
          padding: 10px;
          overflow-y: auto;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
        }

        .search-results-item {
          display: flex;
          min-width: 240px;
          align-items: center;
          border-bottom: 1px solid var(--palette-divider);
          padding-bottom: 10px;
          margin-bottom: 10px;
          width: 100%;
          box-sizing: border-box;
        }
        .search-results-item:last-child {
          border-bottom: none;
        }

        .search-results-item img {
          height: 55px;
          width: 55px;
          border-radius: 50%;
          object-fit: cover;
          margin-right: 10px;
          flex-shrink: 0;
        }

        .person-info {
          display: flex;
          flex-direction: column;
          flex-grow: 1;
        }

        .person-name {
          font-size: 1.2rem;
          margin-bottom: 5px;
          font-weight: 500;
        }

        .person-actions {
          display: flex;
          justify-content: flex-end;
          gap: 5px;
        }

        iron-icon {
          height: 18px;
          width: 18px;
          color: var(--primary-text-color);
        }

        iron-icon:hover {
          cursor: pointer;
          color: var(--primary-color);
        }
      </style>

      <div id="container">
        <div class="search-input-row">
          <iron-icon icon="icons:search"></iron-icon>
          <paper-input id="search-input" placeholder="Search Person" no-label-float></paper-input>
        </div>
        <div class="search-results"></div>
      </div>
    `;
  }

  _getDomReferences() {
    this._searchInput = this.shadowRoot.querySelector("#search-input");
    this._searchResultsDiv = this.shadowRoot.querySelector(".search-results");
    this._searchIcon = this.shadowRoot.querySelector(
      "iron-icon[icon='icons:search']"
    );
  }

  _bindEventListeners() {
    if (this._searchInput) {
      this._searchInput.addEventListener(
        "keyup",
        this._handleSearchKeyup.bind(this)
      );
    }
    if (this._searchIcon) {
      this._searchIcon.addEventListener("click", this._performSearch.bind(this));
    }
  }

  _handleSearchKeyup(evt) {
    if (evt.key === "Enter") {
      this._performSearch();
    } else if (evt.key === "Escape") {
      this._clearSearchResults();
      if (this.onclose) this.onclose();
    }
  }

  async _performSearch() {
    const query = (this._searchInput?.value || "").trim();
    this._clearSearchResults();

    if (query.length < 3) {
      displaySuccess("Search value must be longer than 3 characters.", 3500);
      return;
    }

    try {
      // Call accessor from title.ts
      const persons = await searchPersons(query, this._indexPath || "");
      this._displaySearchResults(persons || []);
    } catch (err) {
      displayError(`Search failed: ${err.message}`, 3000);
    }
  }

  _clearSearchResults() {
    if (this._searchResultsDiv) {
      this._searchResultsDiv.innerHTML = "";
    }
  }

  _displaySearchResults(persons) {
    if (!this._searchResultsDiv) return;

    if (!persons || persons.length === 0) {
      this._searchResultsDiv.innerHTML = "<p>No results found.</p>";
      return;
    }

    persons.forEach((p) => {
      const uuid = `_${getUuidByString(p.getId())}`;
      const html = `
        <div id="${uuid}-div" class="search-results-item">
          <img src="${p.getPicture?.() || "placeholder.png"}" alt="${p.getFullname?.() || ""}">
          <div class="person-info">
            <span class="person-name">${p.getFullname?.() || ""}</span>
            <div class="person-actions">
              <iron-icon id="${uuid}-edit-btn" icon="editor:mode-edit" title="Edit person information"></iron-icon>
              <iron-icon id="${uuid}-add-btn" icon="icons:add" title="Add to the casting"></iron-icon>
            </div>
          </div>
        </div>
      `;
      const temp = document.createElement("div");
      temp.innerHTML = html;
      const itemEl = temp.firstElementChild;
      this._searchResultsDiv.appendChild(itemEl);

      const editBtn = itemEl.querySelector(`#${uuid}-edit-btn`);
      const addBtn = itemEl.querySelector(`#${uuid}-add-btn`);

      if (editBtn) editBtn.addEventListener("click", () => this._handleEditPerson(p));
      if (addBtn) addBtn.addEventListener("click", () => this._handleAddPerson(p));
    });
  }

  _handleEditPerson(person) {
    if (this.oneditperson) this.oneditperson(person);
  }

  _handleAddPerson(person) {
    if (this.onaddcasting) this.onaddcasting(person);
  }
}

customElements.define("globular-search-person-input", SearchPersonInput);
