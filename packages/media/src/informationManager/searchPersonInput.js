import getUuidByString from "uuid-by-string";
import { displayError, displaySuccess} from "@globular/sdk";

// Use your accessor functions from title.ts (no direct gRPC here)
import { searchPersons } from "@globular/sdk"; // <-- adjust path if needed

// UI deps

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
        this._searchInput.select?.();
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
          padding: 4px;
          border: 1px solid color-mix(in srgb, var(--palette-divider) 60%, transparent);
          border-radius: 22px;
          background: color-mix(in srgb, var(--on-surface-color) 5%, transparent);
          transition: border-color .15s ease, box-shadow .15s ease;
        }
        .search-input-row:focus-within {
          border-color: var(--accent-color);
          box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent-color) 20%, transparent);
        }

        .search-input-row iron-icon {
          opacity: .4;
          flex-shrink: 0;
          padding-left: 10px;
          width: 18px;
          height: 18px;
        }

        .search-input-row input {
          flex-grow: 1;
          border: none;
          padding: 8px 12px;
          font-size: .85rem;
          font-family: inherit;
          background: transparent;
          color: var(--on-surface-color);
          outline: none;
        }
        .search-input-row input::placeholder {
          color: var(--secondary-text-color);
          opacity: .6;
        }

        .search-results {
          background-color: var(--surface-color);
          color: var(--on-surface-color);
          max-height: 50vh;
          padding: 4px;
          overflow-y: auto;
          display: flex;
          flex-direction: column;
          gap: 2px;
          scrollbar-width: thin;
          scrollbar-color: var(--scroll-thumb, var(--palette-divider))
            var(--scroll-track, var(--surface-color));
        }

        .search-results-item {
          display: flex;
          align-items: center;
          padding: 8px 10px;
          width: 100%;
          box-sizing: border-box;
          border-radius: 8px;
          transition: background .1s ease;
          gap: 12px;
        }
        .search-results-item:hover {
          background: color-mix(in srgb, var(--on-surface-color) 6%, transparent);
        }

        .search-results-item img {
          height: 36px;
          width: 36px;
          border-radius: 50%;
          object-fit: cover;
          flex-shrink: 0;
          background: color-mix(in srgb, var(--on-surface-color) 8%, transparent);
        }

        .person-info {
          display: flex;
          flex-direction: column;
          flex-grow: 1;
          min-width: 0;
        }

        .person-name {
          font-size: .85rem;
          font-weight: 500;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .person-actions {
          display: flex;
          gap: 6px;
          flex-shrink: 0;
          align-items: center;
        }

        .person-actions iron-icon {
          height: 20px;
          width: 20px;
          padding: 4px;
          border-radius: 50%;
          color: var(--secondary-text-color);
          opacity: .5;
          transition: opacity .15s, color .15s, background .15s;
        }

        .person-actions iron-icon:hover {
          cursor: pointer;
          color: var(--accent-color);
          opacity: 1;
          background: color-mix(in srgb, var(--accent-color) 12%, transparent);
        }
      </style>

      <div id="container">
        <div class="search-input-row">
          <iron-icon icon="icons:search"></iron-icon>
          <input id="search-input" type="text" placeholder="Search person by name..." />
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