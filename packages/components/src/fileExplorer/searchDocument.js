// src/components/search/searchDocumentBar.js

import { displayMessage, displayError } from "@globular/sdk";
// Use typed wrappers instead of wildcard import
import { readDir, getFile, findIndexes } from "@globular/sdk";
import { searchDocuments } from "@globular/sdk"; // facade wrapper


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
          color: #fff;
          -webkit-text-fill-color: #fff;
          caret-color: #fff;
          box-sizing: border-box;
          font-size: 1.2rem;
        }
        ::placeholder { color: rgba(255,255,255,.6); opacity: 1; }
        iron-icon {
          padding-left: 11px;
          padding-right: 11px;
          --iron-icon-fill-color: rgba(255,255,255,.7);
        }
        input:focus { outline: none; }

        input:-webkit-autofill,
        input:-webkit-autofill:focus,
        input:-webkit-autofill:not(:focus) {
          -webkit-text-fill-color: var(--on-surface-color) !important;
          box-shadow: 0 0 0px 1000px var(--surface-color) inset !important;
          caret-color: var(--on-surface-color);
        }

        #search-bar {
          margin:3px;
          min-width: 280px;
          width: 100%;
          display: flex;
          align-items: center;
          border-radius: 22px;
          box-sizing: border-box;
          font-size: 16px;
          height: var(--searchbox-height);
          background: rgba(0,0,0,.25);
          color: #fff;
          border: 1px solid rgba(255,255,255,.15);
          position: relative;
          transition: box-shadow 0.2s ease, background-color 0.2s ease;
        }
        #search_icon:hover { cursor: pointer; }

        #recursive_toggle {
          padding: 0 6px;
          cursor: pointer;
          --iron-icon-fill-color: rgba(255,255,255,.35);
          transition: all .15s ease;
          height: 20px;
          width: 20px;
        }
        #recursive_toggle:hover {
          --iron-icon-fill-color: rgba(255,255,255,.7);
        }
        #recursive_toggle.active {
          --iron-icon-fill-color: var(--accent-color, #4dabf7);
        }
        #recursive_toggle_label {
          font-size: .65rem;
          color: rgba(255,255,255,.35);
          padding-right: 8px;
          white-space: nowrap;
          user-select: none;
          cursor: pointer;
          transition: color .15s ease;
        }
        #recursive_toggle.active ~ #recursive_toggle_label,
        :host #recursive_toggle_label.active {
          color: var(--accent-color, #4dabf7);
        }

        /* subtle "searching…" state */
        #search-bar.searching {
          box-shadow: 0 2px 8px rgba(0,0,0,.3);
          background-color: rgba(0,0,0,.35);
        }
        #search-bar.searching #recursive_toggle,
        #search-bar.searching #recursive_toggle_label {
          display: none;
        }
        #search-bar.searching #search_status {
          display: block;
        }
        #search_status {
          display: none;
          font-size: 0.72rem;
          color: rgba(255,255,255,.6);
          padding-right: 10px;
          white-space: nowrap;
          pointer-events: none;
        }

        @media (max-width: 600px) {
          #search-bar {
            min-width: 0;
            border-radius: 12px;
          }
          input {
            font-size: 1rem;
          }
        }
      </style>
      <div id="search-bar">
        <iron-icon id="search_icon" icon="search"></iron-icon>
        <input id="search_input" placeholder="Search" />
        <span id="recursive_toggle_label">Subfolders</span>
        <span id="search_status">Searching…</span>
      </div>
    `;

    this.searchInput = this.shadowRoot.getElementById("search_input");
    this.searchIcon = this.shadowRoot.getElementById("search_icon");
    this.searchBarDiv = this.shadowRoot.getElementById("search-bar");
    this._recursiveToggle = this.shadowRoot.getElementById("recursive_toggle");
    this._recursiveLabel = this.shadowRoot.getElementById("recursive_toggle_label");
    this._searchStatus = this.shadowRoot.getElementById("search_status");
    this._recursive = false;

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

    const toggleRecursive = () => {
      this._recursive = !this._recursive;
      this._recursiveToggle.classList.toggle("active", this._recursive);
      this._recursiveLabel.classList.toggle("active", this._recursive);
      this._recursiveLabel.textContent = "Subfolders";
      this.searchInput.placeholder = this._recursive ? "Search (all subfolders)" : "Search";
    };
    //this._recursiveToggle.addEventListener("click", toggleRecursive);
    this._recursiveLabel.addEventListener("click", toggleRecursive);
  }

  _handleSearchInputBlur() {
    this.searchBarDiv.classList.remove("searching");
    this.searchBarDiv.style.boxShadow = "";
    this.searchBarDiv.style.backgroundColor = "";
  }

  /** @param {Event} evt */
  _handleSearchInputFocus(evt) {
    evt.stopPropagation();
    this.searchBarDiv.style.boxShadow = "0 2px 8px rgba(0,0,0,.3)";
    this.searchBarDiv.style.backgroundColor = "rgba(0,0,0,.35)";

    const previousResults = this._fileExplorer?._fileExplorerContent?.querySelector("globular-document-search-results");
    if (previousResults) previousResults.style.display = "";
  }

  /** @param {KeyboardEvent} evt */
  _handleSearchInputKeyup(evt) {
    if (evt.key === "Enter") this.search();
    if (this.searchInput.value.length === 0) {
      const previousResults = this._fileExplorer?._fileExplorerContent?.querySelector("globular-document-search-results");
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
    this._searchStatus.textContent = "Finding indexes…";

    try {
      // Single server-side call to find all index paths
      const indexPaths = await findIndexes(basePath, this._recursive);

      if (indexPaths.length === 0) {
        displayMessage(this._recursive
          ? "No index found in current folder or subfolders."
          : "No index found for the search in the current folder.");
        return;
      }

      this._searchStatus.textContent = `Searching ${indexPaths.length} index${indexPaths.length > 1 ? "es" : ""}…`;

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
        dir = await readDir(currentDir);
      } catch (e) {
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

  /**
   * Recursively find __index_db__ paths across the current folder AND all subfolders.
   * For each directory, checks its .hidden/ for indexes, then recurses into subdirs.
   * @param {string} basePath
   * @returns {Promise<string[]>}
   */
  async _getIndexPathsRecursive(basePath) {
    const indexPaths = [];
    let scanned = 0;

    const processDir = async (dirPath) => {
      // 1) Check .hidden/ in this directory for indexes
      const hiddenPath = `${dirPath}/.hidden`;
      const hiddenIndexes = await this._getIndexPathsInCurrentFolder(hiddenPath);
      indexPaths.push(...hiddenIndexes);

      scanned++;
      if (this._searchStatus) {
        this._searchStatus.textContent = `Scanning… ${scanned} folders, ${indexPaths.length} indexes`;
      }

      // 2) List this directory's children and recurse into subdirs
      let dir;
      try {
        dir = await readDir(dirPath);
      } catch {
        return;
      }
      const files = Array.isArray(dir?.files) ? dir.files : [];
      const subdirs = files.filter(f => f.isDir && f.name !== ".hidden");

      // Process subdirectories in parallel (batch of 6)
      const BATCH = 6;
      for (let i = 0; i < subdirs.length; i += BATCH) {
        await Promise.all(subdirs.slice(i, i + BATCH).map(f => processDir(f.path)));
      }
    };

    await processDir(basePath);
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
          padding: 16px;
          gap: 4px;
        }
        #close-results-btn {
          color: var(--on-surface-color);
          align-self: flex-end;
          margin-bottom: 8px;
        }
        .result-container {
          display: flex;
          flex-direction: column;
          padding: 12px;
          border-radius: 8px;
          background: color-mix(in srgb, var(--on-surface-color) 4%, transparent);
          border: 1px solid color-mix(in srgb, var(--palette-divider) 30%, transparent);
          transition: background .15s ease, border-color .15s ease;
        }
        .result-container:hover {
          background: color-mix(in srgb, var(--on-surface-color) 7%, transparent);
          border-color: color-mix(in srgb, var(--accent-color) 30%, transparent);
        }
        .result-header {
          display: flex;
          align-items: center;
          gap: 10px;
          margin-bottom: 8px;
        }
        .result-rank {
          font-size: .7rem;
          font-weight: 600;
          padding: 2px 8px;
          border-radius: 999px;
          background: color-mix(in srgb, var(--accent-color) 15%, transparent);
          color: var(--accent-color);
          white-space: nowrap;
          flex-shrink: 0;
        }
        .result-link {
          font-size: .88rem;
          font-weight: 600;
          text-decoration: none;
          color: var(--primary-text-color);
          cursor: pointer;
          overflow: hidden;
          white-space: nowrap;
          text-overflow: ellipsis;
          flex-grow: 1;
        }
        .result-link:hover {
          color: var(--accent-color);
        }
        .result-path {
          font-size: .7rem;
          color: var(--secondary-text-color);
          opacity: .7;
          overflow: hidden;
          white-space: nowrap;
          text-overflow: ellipsis;
          margin-bottom: 6px;
        }
        .content-wrapper {
          display: flex;
          align-items: flex-start;
          gap: 12px;
        }
        .thumbnail-img {
          width: 80px;
          height: 80px;
          object-fit: contain;
          border-radius: 6px;
          flex-shrink: 0;
          background: color-mix(in srgb, var(--on-surface-color) 6%, transparent);
        }
        .thumbnail-img:hover { cursor: pointer; }
        .snippet-container {
          flex-grow: 1;
          font-size: .8rem;
          line-height: 1.5;
          color: var(--secondary-text-color);
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .snippet-text {
          line-height: 1.5;
        }
        /* Fix highlight colors for dark theme */
        .snippet-text mark,
        .snippet-text b,
        .snippet-text strong {
          background: color-mix(in srgb, var(--accent-color) 25%, transparent);
          color: var(--accent-color);
          padding: 1px 3px;
          border-radius: 3px;
          font-weight: 600;
        }
        @media (max-width: 600px) {
          .content-wrapper {
            flex-direction: column;
            align-items: center;
          }
          .thumbnail-img {
            margin-bottom: 8px;
          }
        }
        .results-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 8px;
        }
        .results-count {
          font-size: .78rem;
          color: var(--secondary-text-color);
        }
        .pagination {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          padding: 10px 0 4px;
        }
        .pagination button {
          background: color-mix(in srgb, var(--on-surface-color) 8%, transparent);
          border: 1px solid color-mix(in srgb, var(--palette-divider) 40%, transparent);
          color: var(--on-surface-color);
          border-radius: 6px;
          padding: 4px 12px;
          font-size: .78rem;
          cursor: pointer;
          transition: background .15s ease;
        }
        .pagination button:hover {
          background: color-mix(in srgb, var(--accent-color) 15%, transparent);
        }
        .pagination button:disabled {
          opacity: .3;
          cursor: default;
        }
        .pagination .page-info {
          font-size: .75rem;
          color: var(--secondary-text-color);
          min-width: 80px;
          text-align: center;
        }
      </style>
      <div id="document-search-results">
        <div class="results-header">
          <span class="results-count" id="results-count"></span>
          <paper-icon-button id="close-results-btn" icon="close"></paper-icon-button>
        </div>
        <div id="results-list"></div>
        <div class="pagination" id="pagination">
          <button id="prev-btn">Previous</button>
          <span class="page-info" id="page-info"></span>
          <button id="next-btn">Next</button>
        </div>
      </div>
    `;
  }

  /** @param {any} fileExplorer */
  setFileExplorer(fileExplorer) {
    this._fileExplorer = fileExplorer;
  }

  _allResults = [];
  _page = 0;
  _pageSize = 20;

  /**
   * @param {Array<{rank:number, dataJson:string, snippetJson:string, doc?:any, snippet?:any}>} results
   */
  setResults(results) {
    this._allResults = results;
    this._page = 0;

    const closeBtn = this.shadowRoot.querySelector("#close-results-btn");
    if (closeBtn) {
      closeBtn.onclick = () =>
        this.parentElement && this.parentElement.removeChild(this);
    }

    const prevBtn = this.shadowRoot.querySelector("#prev-btn");
    const nextBtn = this.shadowRoot.querySelector("#next-btn");
    prevBtn.addEventListener("click", () => { if (this._page > 0) { this._page--; this._renderPage(); } });
    nextBtn.addEventListener("click", () => {
      if ((this._page + 1) * this._pageSize < this._allResults.length) { this._page++; this._renderPage(); }
    });

    this._renderPage();
  }

  _renderPage() {
    const container = this.shadowRoot.querySelector("#results-list");
    container.innerHTML = "";

    const start = this._page * this._pageSize;
    const end = Math.min(start + this._pageSize, this._allResults.length);
    const totalPages = Math.ceil(this._allResults.length / this._pageSize);

    // Update header & pagination
    const countEl = this.shadowRoot.querySelector("#results-count");
    if (countEl) countEl.textContent = `${this._allResults.length} result${this._allResults.length !== 1 ? "s" : ""}`;
    const pageInfo = this.shadowRoot.querySelector("#page-info");
    if (pageInfo) pageInfo.textContent = `${this._page + 1} / ${totalPages}`;
    const prevBtn = this.shadowRoot.querySelector("#prev-btn");
    const nextBtn = this.shadowRoot.querySelector("#next-btn");
    if (prevBtn) prevBtn.disabled = this._page === 0;
    if (nextBtn) nextBtn.disabled = end >= this._allResults.length;

    const pageResults = this._allResults.slice(start, end);
    pageResults.forEach(async (r) => {
      try {
        const doc = r.doc ?? JSON.parse(r.dataJson || "{}");
        const snippet = r.snippet ?? JSON.parse(r.snippetJson || "{}");
        const uuid =
          typeof crypto !== "undefined" && crypto.randomUUID
            ? crypto.randomUUID()
            : Math.random().toString(36).slice(2);
        const resultContainer = document.createElement("div");
        resultContainer.className = "result-container";

        const rankDisplay = Number(r.rank)
          ? (Number(r.rank) / 1000).toFixed(3)
          : "0.000";
        const path = doc?.Path || "";
        const fileName = path ? path.substring(path.lastIndexOf("/") + 1) : "Unknown";
        const pageNum = doc?.Number != null ? ` — Page ${Number(doc.Number) + 1}` : "";

        resultContainer.innerHTML = `
          <div class="result-header">
            <span class="result-rank">${rankDisplay}</span>
            <div id="page-${uuid}-lnk" class="result-link" title="${path}">${fileName}${pageNum}</div>
          </div>
          <div class="result-path" title="${path}">${path}</div>
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

        // Attach click handler immediately (don't wait for thumbnail)
        const openFile = (vm, page) => {
          this.style.display = "none";
          if (this._fileExplorer?.readFile) {
            this._fileExplorer.readFile(
              vm ? toFileLike(vm) : { getPath: () => path, getMime: () => "", getThumbnail: () => undefined },
              page
            );
          }
        };

        let fileVM = null;
        resultLink.addEventListener("click", () => openFile(fileVM, (doc?.Number ?? 0) + 1));

        // Try to fetch file info for thumbnail (non-blocking)
        if (path) {
          getFile(path).then(vm => {
            if (!vm) return;
            fileVM = vm;
            const thumb = typeof vm.thumbnail === "string" ? vm.thumbnail
              : Array.isArray(vm.thumbnail) ? vm.thumbnail[0] : undefined;
            if (thumb) {
              const img = document.createElement("img");
              img.src = thumb;
              img.className = "thumbnail-img";
              contentWrapper.insertBefore(img, snippetsDiv);
              img.addEventListener("click", () => openFile(vm, (doc?.Number ?? 0) + 1));
            }
          }).catch(() => { /* thumbnail fetch failed — link still works */ });
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