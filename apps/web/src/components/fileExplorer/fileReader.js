// components/fileReader.js
import "@polymer/paper-icon-button/paper-icon-button.js";
import "@polymer/iron-icons/iron-icons.js";
import { getBaseUrl } from "../../backend/core/endpoints.js";

/**
 * <globular-file-reader>
 * Lightweight iframe-based file viewer.
 *
 * Usage:
 *  const r = document.createElement('globular-file-reader');
 *  document.body.appendChild(r);
 *  r.onclose = () => console.log('closed');
 *  r.read(fileProtoOrVM, 1);  // page = 1 for PDFs
 */
export class GlobularFileReader extends HTMLElement {
  _file = null;              // current file (proto/VM or { path, mime }-like)
  _onCloseCallback = null;   // optional close callback
  _domRefs = {};

  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._initializeLayout();
    this._cacheDomElements();
  }

  connectedCallback() {
    this._setupEventListeners();
    // hidden by default; shown by read()
    this.style.display = "none";
  }

  // ---------- layout ----------

  _initializeLayout() {
    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: flex;
          flex-direction: column;
          width: 100%;
          height: 100%;
          background: var(--surface-color);
          color: var(--primary-text-color);
        }
        ::-webkit-scrollbar { width: 5px; height: 5px; }
        ::-webkit-scrollbar-track { background: var(--surface-color); }
        ::-webkit-scrollbar-thumb { background: var(--palette-divider); }

        #content { display: none; flex-direction: column; width: 100%; height: 100%; }
        #header {
          display: flex; align-items: center; gap: 8px;
          background: var(--surface-color);
          color: var(--on-surface-color);
          border-bottom: 1px solid var(--palette-divider);
          padding: 8px;
          flex-shrink: 0;
        }
        #title {
          flex: 1; text-align: center; font-size: 1.2rem; font-weight: 500;
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        #close-btn { --iron-icon-fill-color: var(--palette-text-accent); cursor: pointer; }

        #frame {
          width: 100%; height: 100%; border: none; background: white; flex: 1;
        }
        #loading {
          position: absolute; inset: 48px 8px 8px; display: none;
          align-items: center; justify-content: center; background: transparent;
          pointer-events: none;
        }
        #loading span {
          padding: 6px 10px; border-radius: 8px; background: rgba(0,0,0,.05);
          font-size: .9rem;
        }
      </style>
      <div id="content" role="dialog" aria-modal="true" aria-label="File viewer">
        <div id="header">
          <span id="title"></span>
          <paper-icon-button icon="icons:close" id="close-btn" title="Close (Esc)"></paper-icon-button>
        </div>
        <iframe id="frame" sandbox="allow-same-origin allow-scripts allow-downloads allow-forms"></iframe>
        <div id="loading"><span>Loading…</span></div>
      </div>
    `;
  }

  _cacheDomElements() {
    this._domRefs.content = this.shadowRoot.querySelector("#content");
    this._domRefs.title = this.shadowRoot.querySelector("#title");
    this._domRefs.closeBtn = this.shadowRoot.querySelector("#close-btn");
    this._domRefs.frame = this.shadowRoot.querySelector("#frame");
    this._domRefs.loading = this.shadowRoot.querySelector("#loading");
  }

  _setupEventListeners() {
    this._domRefs.closeBtn.addEventListener("click", () => this.close());
    // Esc to close
    this._onKeydown = (e) => { if (e.key === "Escape") this.close(); };
    window.addEventListener("keydown", this._onKeydown);

    // Basic loading state
    this._domRefs.frame.addEventListener("load", () => this._hideLoading());
    this._domRefs.frame.addEventListener("error", () => this._hideLoading());
  }

  disconnectedCallback() {
    window.removeEventListener("keydown", this._onKeydown);
  }

  // ---------- public API ----------

  set onclose(cb) { this._onCloseCallback = cb; }
  get onclose() { return this._onCloseCallback; }

  /**
   * Show a file in the iframe.
   * @param {object|string} file - proto/VM with getPath()/getMime() or a string path
   * @param {number} [page=0]   - for PDFs, 1-based page number to jump to
   */
  async read(file, page = 0) {
    this._file = file;

    const path = this._extractPath(file);
    const mime = this._extractMime(file);

    if (!path) {
      console.error("GlobularFileReader: invalid file (missing path).");
      return;
    }

    try {
      const token = sessionStorage.getItem("__globular_token__");
      if (!token) throw new Error("User is not authenticated.");

      // Build /api/v1/files/download/<encoded path...>?token=...
      let url = (getBaseUrl() || "").replace(/\/$/, "") + "/api/v1/files/download";
      path.split("/").forEach(seg => {
        if (seg && seg.trim()) url += "/" + encodeURIComponent(seg.trim());
      });
      url += `?token=${encodeURIComponent(token)}`;

      // PDF page anchor (PDF.js and most browsers understand #page=N)
      if ((mime || "").toLowerCase() === "application/pdf" && page > 0) {
        url += `#page=${Number(page)}`;
      }

      // render
      this._showLoading();
      this._domRefs.title.textContent = this._prettyName(path);
      this._domRefs.frame.src = url;
      this._domRefs.content.style.display = "flex";
      this.style.display = "flex";
    } catch (err) {
      console.error("GlobularFileReader: Failed to read file:", err);
      this.close();
    }
  }

  /**
   * Hide and cleanup.
   */
  close() {
    this._domRefs.content.style.display = "none";
    this._domRefs.frame.src = "about:blank";
    this.style.display = "none";
    this._hideLoading();
    if (typeof this._onCloseCallback === "function") {
      try { this._onCloseCallback(); } catch {}
    }
  }

  // ---------- helpers ----------

  _extractPath(file) {
    if (!file) return "";
    if (typeof file === "string") return file;
    if (typeof file.getPath === "function") return file.getPath();
    if (typeof file.path === "string") return file.path;
    return "";
    // (intentionally no .globule checks)
  }

  _extractMime(file) {
    if (!file) return "";
    if (typeof file.getMime === "function") return file.getMime() || "";
    if (typeof file.mime === "string") return file.mime;
    return "";
  }

  _prettyName(path) {
    const i = path.lastIndexOf("/");
    return i >= 0 ? path.slice(i + 1) || "File Viewer" : path || "File Viewer";
  }

  _showLoading() {
    this._domRefs.loading.style.display = "flex";
  }

  _hideLoading() {
    this._domRefs.loading.style.display = "none";
  }
}

customElements.define("globular-file-reader", GlobularFileReader);
