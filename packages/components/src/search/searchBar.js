import { Backend } from "@globular/backend"; // keep your notify re-exports here

import { search } from "./search"; // cluster-transparent search

// Polymer component imports
import "@polymer/paper-input/paper-input.js";
import "@polymer/iron-icon/iron-icon.js";
import "@polymer/paper-icon-button/paper-icon-button.js";
import "@polymer/paper-card/paper-card.js";
import "@polymer/paper-checkbox/paper-checkbox.js";
import { displayMessage } from "@globular/backend";

/**
 * Custom element providing a search bar with configurable search contexts.
 */
export class SearchBar extends HTMLElement {
  // Private instance properties
  _searchInput = null;
  _searchIcon = null;
  _searchBarDiv = null;
  _changeSearchContextBtn = null;
  _contextSearchSelector = null;

  _titlesCheckbox = null;
  _moviesCheckbox = null;
  _tvSeriesCheckbox = null;
  _tvEpisodesCheckbox = null;
  _videosCheckbox = null;
  _youtubeCheckbox = null;
  _adultCheckbox = null;
  _audiosCheckbox = null;

  _contextCheckboxes = [];

  constructor() {
    super();
    this.attachShadow({ mode: "open" });
  }

  connectedCallback() {
    this._renderInitialStructure();
    this._getDomReferences();
    this._bindEventListeners();
    this._setupCheckboxLogic();
  }

  disconnectedCallback() {
    // Clean up the global click listener to avoid leaks.
    document.removeEventListener("click", this._boundOutsideClick, true);
  }

  _renderInitialStructure() {
    this.shadowRoot.innerHTML = `
      <style>
        input {
          width: 100%;
          border: none;
          margin-right: 11px;
          background: transparent;
          color: var(--primary-text-color, var(--on-surface-color));
          box-sizing: border-box;
          font-size: 1.2rem;
        }
        ::placeholder { color: color-mix(in srgb, var(--primary-text-color) 60%, transparent); opacity: 1; }
        iron-icon {
          padding-left: 11px;
          padding-right: 11px;
          --iron-icon-fill-color: var(--palette-text-accent);
        }
        input:focus { outline: none; }

        /* Autofill */
        input:-webkit-autofill {
          background-color: var(--surface-color) !important;
          color: var(--on-surface-color) !important;
          box-shadow: 0 0 0px 1000px var(--surface-color) inset !important;
        }
        input:-webkit-autofill:not(:focus) {
          background-color: var(--primary-color) !important;
          color: var(--on-primary-color) !important;
          box-shadow: 0 0 0px 1000px var(--primary-color) inset !important;
        }

        #context-search-selector {
          display: none;
          flex-direction: column;
          position: absolute;
          top: 55px;
          right: 0px;
          left: 0px;
          border-radius: 8px;
          background-color: var(--surface-color);
          z-index: 1000;
          color: var(--on-surface-color);
          min-width: 340px;
          box-shadow: var(--shadow-elevation-8dp);
          padding: 10px;
        }

        #search-bar {
          min-width: 280px;
          display: flex;
          align-items: center;
          border-radius: 22px;
          box-sizing: border-box;
          font-size: 16px;
          height: var(--searchbox-height);
          background: transparent;
          color: var(--palette-text-accent);
          border: 1px solid var(--palette-divider);
          position: relative;
          transition: box-shadow 0.2s ease, background-color 0.2s ease;
        }

        @media (max-width: 500px) {
          #context-search-selector {
            position: fixed;
            left: 5px;
            top: 75px;
            right: 5px;
          }
        }

        paper-card {
          background-color: var(--surface-color);
          color: var(--primary-text-color);
        }

        paper-checkbox {
          margin-left: 16px;
          margin-bottom: 8px;
          margin-top: 8px;
          --paper-checkbox-checked-color: var(--primary-color);
          --paper-checkbox-checkmark-color: var(--on-primary-color);
          --paper-checkbox-label-color: var(--primary-text-color);
        }

        .context-filter {
          display: flex;
          flex-direction: column;
          font-size: .85rem;
          margin: 0px 18px 5px 18px;
          padding-left: 20px;
          border-left: 1px solid var(--palette-divider);
        }
        .context-filter paper-checkbox { margin-left: 0px; }

        #search_icon:hover { cursor: pointer; }
        #change-search-context:hover { cursor: pointer; }
      </style>
      <div id="search-bar">
        <iron-icon id="search_icon" icon="search"></iron-icon>
        <input id="search_input" placeholder="Search" aria-label="Search" />
        <paper-icon-button id="change-search-context" icon="icons:expand-more" aria-label="Change search context"></paper-icon-button>
        <paper-card id="context-search-selector" role="dialog" aria-label="Search context">

          <div style="display: flex; flex-direction: column">
            <paper-checkbox class="context" name="titles" id="context-search-selector-titles">Titles</paper-checkbox>
            <div class="context-filter">
              <paper-checkbox name="movies" id="context-search-selector-movies">Movies</paper-checkbox>
              <paper-checkbox name="tvSeries" id="context-search-selector-tv-series">TV-Series</paper-checkbox>
              <paper-checkbox name="tvEpisodes" id="context-search-selector-tv-episodes">TV-Episodes</paper-checkbox>
            </div>
          </div>

          <div style="display: flex; flex-direction: column">
            <paper-checkbox class="context" name="videos" id="context-search-selector-videos">Videos</paper-checkbox>
            <div class="context-filter">
              <paper-checkbox name="youtube" id="context-search-selector-youtube">Youtube</paper-checkbox>
              <paper-checkbox name="adult" id="context-search-selector-adult">Adult</paper-checkbox>
            </div>
          </div>

          <paper-checkbox class="context" name="audios" id="context-search-selector-audios">Audios</paper-checkbox>
        </paper-card>
      </div>
    `;
  }

  _getDomReferences() {
    this._searchInput = this.shadowRoot.getElementById("search_input");
    this._searchIcon = this.shadowRoot.getElementById("search_icon");
    this._searchBarDiv = this.shadowRoot.getElementById("search-bar");
    this._changeSearchContextBtn = this.shadowRoot.getElementById("change-search-context");
    this._contextSearchSelector = this.shadowRoot.getElementById("context-search-selector");

    this._titlesCheckbox = this.shadowRoot.querySelector("#context-search-selector-titles");
    this._moviesCheckbox = this.shadowRoot.querySelector("#context-search-selector-movies");
    this._tvSeriesCheckbox = this.shadowRoot.querySelector("#context-search-selector-tv-series");
    this._tvEpisodesCheckbox = this.shadowRoot.querySelector("#context-search-selector-tv-episodes");

    this._videosCheckbox = this.shadowRoot.querySelector("#context-search-selector-videos");
    this._youtubeCheckbox = this.shadowRoot.querySelector("#context-search-selector-youtube");
    this._adultCheckbox = this.shadowRoot.querySelector("#context-search-selector-adult");
    this._audiosCheckbox = this.shadowRoot.querySelector("#context-search-selector-audios");

    // default selections
    if (this._titlesCheckbox) this._titlesCheckbox.checked = true;
    if (this._moviesCheckbox) this._moviesCheckbox.checked = true;
    if (this._tvSeriesCheckbox) this._tvSeriesCheckbox.checked = true;
    if (this._tvEpisodesCheckbox) this._tvEpisodesCheckbox.checked = true;
    if (this._videosCheckbox) this._videosCheckbox.checked = true;
    if (this._youtubeCheckbox) this._youtubeCheckbox.checked = true;
    if (this._audiosCheckbox) this._audiosCheckbox.checked = true;

    this._contextCheckboxes = Array.from(this.shadowRoot.querySelectorAll(".context"));
  }

  _bindEventListeners() {
    if (this._searchInput) {
      this._searchInput.addEventListener("blur", this._handleSearchInputBlur.bind(this));
      this._searchInput.addEventListener("keydown", this._handleSearchInputKeydown.bind(this));
      this._searchInput.addEventListener("focus", this._handleSearchInputFocus.bind(this));
    }
    if (this._changeSearchContextBtn) {
      this._changeSearchContextBtn.addEventListener("click", this._handleChangeSearchContextClick.bind(this));
    }
    if (this._searchIcon) {
      this._searchIcon.addEventListener("click", this._handleSearchIconClick.bind(this));
    }

    // global "click outside" handler
    this._boundOutsideClick = this._handleClickOutsideContextSelector.bind(this);
    document.addEventListener("click", this._boundOutsideClick, true);
  }

  _setupCheckboxLogic() {
    // initial state
    this._toggleSubCheckboxes(this._titlesCheckbox, this._moviesCheckbox, this._tvSeriesCheckbox, this._tvEpisodesCheckbox);
    this._toggleSubCheckboxes(this._videosCheckbox, this._youtubeCheckbox, this._adultCheckbox);

    // react to changes
    this._titlesCheckbox?.addEventListener("change", () => {
      this._toggleSubCheckboxes(this._titlesCheckbox, this._moviesCheckbox, this._tvSeriesCheckbox, this._tvEpisodesCheckbox);
    });
    this._videosCheckbox?.addEventListener("change", () => {
      this._toggleSubCheckboxes(this._videosCheckbox, this._youtubeCheckbox, this._adultCheckbox);
    });
  }

  _toggleSubCheckboxes(parentCheckbox, ...subs) {
    subs.forEach((checkbox) => {
      if (!checkbox) return;
      if (parentCheckbox?.checked) checkbox.removeAttribute("disabled");
      else checkbox.setAttribute("disabled", "");
    });
  }

  _handleSearchInputBlur() {
    if (this._contextSearchSelector?.style.display !== "flex") {
      this._resetVisualStyles();
    }
  }

  _handleSearchInputKeydown(evt) {
    if (evt.key === "Enter") {
      this.search();
    } else if (evt.key === "Escape") {
      Backend.eventHub.publish("_hide_search_results_", { id: this.id }, true);
    }
  }

  _handleSearchInputFocus(evt) {
    evt.stopPropagation();
    this._applyFocusStyles();
    if (this._contextSearchSelector) this._contextSearchSelector.style.display = "none";

    Backend.eventHub.publish("_display_search_results_", { id: this.id }, true);

    document.querySelectorAll(".highlighted").forEach((el) => {
      if (typeof el.lowlight === "function") el.lowlight();
    });
  }

  _handleSearchIconClick(evt) {
    evt.stopPropagation();
    this._searchInput?.focus();
    this._applyFocusStyles();
    if (this._contextSearchSelector) this._contextSearchSelector.style.display = "none";
    this._searchInput?.blur();
    this.search();
  }

  _handleClickOutsideContextSelector(evt) {
    if (!this._contextSearchSelector) return;

    const rect = this._contextSearchSelector.getBoundingClientRect();
    const mouseX = evt.clientX;
    const mouseY = evt.clientY;

    const isOverContextSelector =
      mouseX >= rect.left &&
      mouseX <= rect.right &&
      mouseY <= rect.bottom;

    if (
      this._searchBarDiv &&
      !this._searchBarDiv.contains(evt.target) &&
      !this._contextSearchSelector.contains(evt.target) &&
      !isOverContextSelector
    ) {
      this._contextSearchSelector.style.display = "none";
      this._resetVisualStyles();
    }
  }

  _handleChangeSearchContextClick() {
    if (!this._contextSearchSelector) return;
    if (this._contextSearchSelector.style.display !== "flex") {
      this._contextSearchSelector.style.display = "flex";
    } else {
      this._contextSearchSelector.style.display = "none";
      this._searchInput?.focus();
    }
  }

  _applyFocusStyles() {
    if (!this._searchBarDiv || !this._searchInput || !this._searchIcon || !this._changeSearchContextBtn) return;
    this._searchBarDiv.style.boxShadow = "var(--dark-mode-shadow)";
        this._searchBarDiv.style.backgroundColor = "var(--surface-color)";
        this._searchInput.style.color = "var(--on-surface-color)";
    this._searchIcon.style.setProperty("--iron-icon-fill-color", "var(--on-surface-color)");
    this._changeSearchContextBtn.style.setProperty("--iron-icon-fill-color", "var(--on-surface-color)");
  }

  _resetVisualStyles() {
    if (!this._searchBarDiv || !this._searchInput || !this._searchIcon || !this._changeSearchContextBtn) return;
    this._searchBarDiv.style.boxShadow = "";
    this._searchBarDiv.style.backgroundColor = "";
    this._searchInput.style.backgroundColor = "transparent";
    this._searchInput.style.color = "var(--primary-text-color, var(--on-surface-color))";
    this._searchIcon.style.setProperty("--iron-icon-fill-color", "var(--palette-text-accent)");
    this._changeSearchContextBtn.style.setProperty("--iron-icon-fill-color", "var(--palette-text-accent)");
  }

  /**
   * Initiates the search operation based on the current input and selected contexts.
   * Cluster-transparent: `search()` handles routing/fanout under the hood.
   */
  search() {
    const query = (this._searchInput?.value || "").trim();
    const selectedContexts = this._getSelectedContexts();

    if (selectedContexts.length === 0) {
      displayMessage(
        "You must select at least one search context (Titles, Videos, Audios).",
        3000
      );
      if (this._contextSearchSelector) this._contextSearchSelector.style.display = "flex";
      return;
    }

    let modifiedQuery = query;
    // negative filters via unchecked sub-filters
    if (!this._adultCheckbox?.checked) modifiedQuery += " -adult";
    if (!this._youtubeCheckbox?.checked) modifiedQuery += " -youtube";
    if (!this._moviesCheckbox?.checked) modifiedQuery += " -Movie";
    if (!this._tvEpisodesCheckbox?.checked) modifiedQuery += " -TVEpisode";
    if (!this._tvSeriesCheckbox?.checked) modifiedQuery += " -TVSeries";

    // fire the cluster-transparent search
    search(modifiedQuery, selectedContexts, 0, 150);

    if (this._searchInput) this._searchInput.value = "";
    Backend.eventHub.publish("_display_search_results_", { id: this.id }, true);
    this._resetVisualStyles();
    if (this._contextSearchSelector) this._contextSearchSelector.style.display = "none";
  }

  _getSelectedContexts() {
    const contexts = [];
    this._contextCheckboxes.forEach((checkbox) => {
      if (checkbox.checked) {
        if (
          checkbox.id === "context-search-selector-titles" ||
          checkbox.id === "context-search-selector-videos" ||
          checkbox.id === "context-search-selector-audios"
        ) {
          if (!contexts.includes(checkbox.name)) contexts.push(checkbox.name);
        }
      }
    });

    // Ensure main contexts still apply even if sub-filters uncheck everything
    if (this._titlesCheckbox?.checked && !contexts.includes(this._titlesCheckbox.name)) {
      contexts.push(this._titlesCheckbox.name);
    }
    if (this._videosCheckbox?.checked && !contexts.includes(this._videosCheckbox.name)) {
      contexts.push(this._videosCheckbox.name);
    }

    return [...new Set(contexts)];
  }
}

customElements.define("globular-search-bar", SearchBar);
