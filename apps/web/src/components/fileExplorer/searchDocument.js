// src/components/search/searchDocumentBar.js

import { displayMessage, displayError } from "../../backend/ui/notify";
// Use typed wrappers instead of wildcard import
import { readDir, getFile } from "../../backend/cms/files";
import { searchDocuments } from "../../backend/search/search_document"; // facade wrapper

import "@polymer/iron-icon/iron-icon.js";
import "@polymer/paper-icon-button/paper-icon-button.js";

/**
 * The search document bar component.
 */
export class SearchDocumentBar extends HTMLElement {
  /** @type {any|null} */
  _fileExplorer = null;

  constructor() {
    super();
    this.attachShadow({ mode: "open" });
  }

  connectedCallback() {
    this.shadowRoot.innerHTML = `
      <style>
        input {
          width: 100%;
          border: none;
          margin-right: 11px;
          background: transparent;
          color: var(--on-primary-color);
          box-sizing: border-box;
          font-size: 1.2rem;
        }
        ::placeholder {
          color: var(--on-text-color, var(--palette-text-accent));
          opacity: 1;
        }
        iron-icon {
          padding-left: 11px;
          padding-right: 11px;
          --iron-icon-fill-color: var(--on-text-color, var(--palette-text-accent));
        }
        input:focus { 
          outline: none; 
          box-shadow: var(--dark-mode-shadow);
          background-color: var(--surface-color);
          color: var(--on-surface-color);
        }
        input:-webkit-autofill {
          background-color: var(--surface-color) !important;
          color: var(--on-surface-color) !important;
          box-shadow: 0 0 0px 1000px var(--surface-color) inset !important;
        }
        input:-webkit-autofill:not(:focus) {
          background-color: var(--primary-color) !important;
          color: var(--on-primary-color) !important;
          box-shadow: 0 0 0px 1000px var(--primary-color) inset !important;
          color: var(--on-primary-color) !important;
        }
        #search-bar {
          min-width: 280px;
          display: flex;
          align-items: center;
          border-radius: 22px;
          box-sizing: border-box;
          font-size: 16px;
          height: var(--searchbox-height);
          opacity: 1;
          transition: box-shadow .15s ease, background-color .15s ease;
          background: transparent;
          color: var(--palette-text-accent);
          border: 1px solid var(--palette-divider);
          position: relative;
        }
        #search_icon:hover { cursor: pointer; }

        /* subtle "searching…" state */
        #search-bar.searching {
          box-shadow: var(--dark-mode-shadow);
          background-color: var(--surface-color);
        }
        #search-bar.searching::after {
          content: "Searching…";
          position: absolute;
          right: 14px;
          font-size: 0.75rem;
          color: var(--palette-text-secondary);
          pointer-events: none;
        }
      </style>
      <div id="search-bar">
        <iron-icon id="search_icon" icon="search"></iron-icon>
        <input id="search_input" placeholder="Search" />
      </div>
    `;

    this.searchInput = this.shadowRoot.getElementById("search_input");
    this.searchIcon = this.shadowRoot.getElementById("search_icon");
    this.searchBarDiv = this.shadowRoot.getElementById("search-bar");

    this._addEventListeners();
  }

  /** @param {any} fileExplorer */
  setFileExplorer(fileExplorer) {
    this._fileExplorer = fileExplorer;
  }

  _addEventListeners() {
    this.searchInput.addEventListener(
      "blur",
      this._handleSearchInputBlur.bind(this)
    );
    this.searchInput.addEventListener(
      "focus",
      this._handleSearchInputFocus.bind(this)
    );
    this.searchInput.addEventListener(
      "keyup",
      this._handleSearchInputKeyup.bind(this)
    );
    this.searchIcon.addEventListener("click", this.search.bind(this));
  }

  _handleSearchInputBlur() {
    this.searchBarDiv.classList.remove("searching");
    this.searchBarDiv.style.boxShadow = "";
    this.searchBarDiv.style.backgroundColor = "";
    this.searchInput.style.backgroundColor = "transparent";
    this.searchInput.style.color = "var(--on-primary-color)";
    this.searchIcon.style.setProperty(
      "--iron-icon-fill-color",
      "var(--palette-text-accent)"
    );
  }

  /** @param {Event} evt */
  _handleSearchInputFocus(evt) {
    evt.stopPropagation();
    this.searchBarDiv.style.boxShadow = "var(--dark-mode-shadow)";
    this.searchBarDiv.style.backgroundColor = "var(--surface-color)";
    this.searchInput.style.color = "var(--on-surface-color)";
    this.searchIcon.style.setProperty(
      "--iron-icon-fill-color",
      "var(--on-surface-color)"
    );

    const previousResults = this._fileExplorer
      ? this._fileExplorer.querySelector("globular-document-search-results")
      : null;
    if (previousResults) previousResults.style.display = "";
  }

  /** @param {KeyboardEvent} evt */
  _handleSearchInputKeyup(evt) {
    if (evt.key === "Enter") this.search();
    if (this.searchInput.value.length === 0) {
      const previousResults = this._fileExplorer
        ? this._fileExplorer.querySelector("globular-document-search-results")
        : null;
      if (previousResults && previousResults.parentElement) {
        previousResults.parentElement.removeChild(previousResults);
      }
    }
  }

  /**
   * Run a document search in the indexes located under the current folder’s `.hidden`.
   */
  async search() {
    const searchValue = this.searchInput.value.trim();

    if (!searchValue) {
      displayMessage("Please enter a search query.");
      return;
    }
    if (!this._fileExplorer) {
      displayError("File explorer is not available for search.", 3000);
      return;
    }

    // Use the explorer accessor if available, with fallbacks to legacy fields
    const basePath =
      this._fileExplorer.getCurrentPath?.() ??
      this._fileExplorer.path ??
      this._fileExplorer._path;

    if (!basePath) {
      displayError("File explorer path is not available for search.", 3000);
      return;
    }

    this.searchBarDiv.classList.add("searching");

    try {
      const start = `${basePath}/.hidden`;
      const indexPaths = await this._getIndexPathsInCurrentFolder(start);

      if (indexPaths.length === 0) {
        displayMessage("No index found for the search in the current folder.");
        return;
      }

      const router = document.querySelector("globular-router");
      const application = router ? router.getAttribute("base") || "" : "";

      const results = await searchDocuments({
        paths: indexPaths,
        language: "en",
        fields: ["Text"],
        offset: 0,
        pageSize: 1000,
        query: `Text:${searchValue}`,
        application,
      });

      const searchResults = new DocumentSearchResults();
      searchResults.setFileExplorer(this._fileExplorer);
      searchResults.setResults(results);
      this._fileExplorer.setSearchResults(searchResults);
    } catch (error) {
      displayError(`Search failed: ${error?.message || error}`, 3000);
    } finally {
      this.searchBarDiv.classList.remove("searching");
    }
  }

  /**
   * Recursively find index file paths (__index_db__) under a starting path.
   * @param {string} startPath
   * @returns {Promise<string[]>}
   */
  async _getIndexPathsInCurrentFolder(startPath) {
    const indexPaths = [];

    const traverseDir = async (currentDir) => {
      let dir;
      try {
        // Use new wrapper; includeHidden = true
        dir = await readDir(currentDir);
      } catch (e) {
        // Silently skip unreadable dirs
        return;
      }

      const files = Array.isArray(dir?.files) ? dir.files : [];
      for (const f of files) {
        if (f.name === "__index_db__") {
          indexPaths.push(f.path);
        } else if (f.isDir) {
          await traverseDir(f.path);
        }
      }
    };

    await traverseDir(startPath);
    return indexPaths;
  }
}

customElements.define("globular-search-document-bar", SearchDocumentBar);

/** Helper: adapt FileVM to the minimal interface your reader expects. */
function toFileLike(vm) {
  return {
    getPath: () => vm.path,
    getMime: () => vm.mime || "",
    getThumbnail: () =>
      (Array.isArray(vm.thumbnail) ? vm.thumbnail[0] : undefined),
  };
}

/**
 * Displays search results for documents.
 */
class DocumentSearchResults extends HTMLElement {
  /** @type {any|null} */
  _fileExplorer = null;

  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this.shadowRoot.innerHTML = `
      <style>
        #document-search-results {
          display: flex;
          flex-direction: column;
          background-color: var(--surface-color);
          padding: 10px;
        }
        paper-icon-button {
          color: var(--on-surface-color);
          align-self: flex-end;
          margin-bottom: 10px;
        }
        .result-container {
          display: flex;
          flex-direction: column;
          margin-bottom: 15px;
          padding-bottom: 15px;
          border-bottom: 1px solid var(--palette-divider);
        }
        .result-container:last-child {
          border-bottom: none;
        }
        .result-header {
          display: flex;
          align-items: baseline;
          margin-left: 2px;
          margin-bottom: 8px;
        }
        .result-rank {
          font-size: 1.1rem;
          padding-right: 10px;
          color: var(--palette-text-secondary);
        }
        .result-link {
          font-size: 1rem;
          font-weight: 500;
          text-decoration: underline;
          color: var(--primary-color);
          cursor: pointer;
          overflow: hidden;
          white-space: nowrap;
          text-overflow: ellipsis;
          flex-grow: 1;
        }
        .result-link:hover {
          text-decoration-color: var(--primary-color-dark);
        }
        .content-wrapper {
          display: flex;
          align-items: flex-start;
          gap: 20px;
        }
        .thumbnail-img {
          width: 128px;
          height: 128px;
          object-fit: contain;
          padding: 10px;
          flex-shrink: 0;
        }
        .thumbnail-img:hover { cursor: pointer; }
        .snippet-container {
          flex-grow: 1;
          font-size: 0.9rem;
          color: var(--primary-text-color);
          display: flex;
          flex-direction: column;
          gap: 5px;
        }
        .snippet-text { line-height: 1.4; }
        @media (max-width: 600px) {
          .content-wrapper {
            flex-direction: column;
            align-items: center;
          }
          .thumbnail-img {
            margin-bottom: 10px;
          }
        }
      </style>
      <div id="document-search-results">
        <paper-icon-button id="close-results-btn" icon="close"></paper-icon-button>
      </div>
    `;
  }

  /** @param {any} fileExplorer */
  setFileExplorer(fileExplorer) {
    this._fileExplorer = fileExplorer;
  }

  /**
   * @param {Array<{rank:number, dataJson:string, snippetJson:string, doc?:any, snippet?:any}>} results
   */
  setResults(results) {
    const container = this.shadowRoot.querySelector(
      "#document-search-results"
    );
    container
      .querySelectorAll(".result-container")
      .forEach((el) => el.remove());

    const closeBtn = container.querySelector("#close-results-btn");
    if (closeBtn) {
      closeBtn.onclick = () =>
        this.parentElement && this.parentElement.removeChild(this);
    }

    results.forEach(async (r) => {
      try {
        const doc = r.doc ?? JSON.parse(r.dataJson || "{}");
        const snippet = r.snippet ?? JSON.parse(r.snippetJson || "{}");
        const uuid =
          typeof crypto !== "undefined" && crypto.randomUUID
            ? crypto.randomUUID()
            : Math.random().toString(36).slice(2);
        const resultContainer = document.createElement("div");
        resultContainer.className = "result-container";

        // keep previous visual scaling if you want:
        const rankDisplay = Number(r.rank)
          ? (Number(r.rank) / 1000).toFixed(3)
          : "0.000";
        const path = doc?.Path || "";

        resultContainer.innerHTML = `
          <div class="result-header">
            <span class="result-rank">${rankDisplay}</span>
            <div id="page-${uuid}-lnk" class="result-link" title="${path}">${path}</div>
          </div>
          <div id="content-${uuid}" class="content-wrapper">
            <div id="snippets-${uuid}-div" class="snippet-container"></div>
          </div>
        `;
        container.appendChild(resultContainer);

        const contentWrapper = resultContainer.querySelector(
          `#content-${uuid}`
        );
        const snippetsDiv = resultContainer.querySelector(
          `#snippets-${uuid}-div`
        );
        const resultLink = resultContainer.querySelector(
          `#page-${uuid}-lnk`
        );

        // Render snippets
        const textSnippets = Array.isArray(snippet?.Text) ? snippet.Text : [];
        textSnippets.forEach((s) => {
          const div = document.createElement("div");
          div.className = "snippet-text";
          div.innerHTML = s; // server already returns highlighted HTML
          snippetsDiv.appendChild(div);
        });

        // Fetch file info (for thumbnail) via files facade
        try {
          if (path) {
            const vm = await getFile(path);
            if (vm) {
              const thumb = Array.isArray(vm.thumbnail)
                ? vm.thumbnail[0]
                : undefined;
              const open = () => {
                this.style.display = "none";
                if (this._fileExplorer?.readFile) {
                  this._fileExplorer.readFile(
                    toFileLike(vm),
                    (doc?.Number ?? 0) + 1
                  );
                }
              };

              if (thumb) {
                const img = document.createElement("img");
                img.src = thumb;
                img.className = "thumbnail-img";
                contentWrapper.insertBefore(img, snippetsDiv);
                img.addEventListener("click", open);
              }

              resultLink.addEventListener("click", open);
            }
          }
        } catch (thumbErr) {
          displayError(
            `Error getting thumbnail for ${path}: ${
              thumbErr?.message || thumbErr
            }`,
            3000
          );
        }
      } catch (e) {
        console.error("Error parsing search result entry:", e);
        displayError("Error processing search result.", 3000);
      }
    });
  }
}

customElements.define(
  "globular-document-search-results",
  DocumentSearchResults
);
