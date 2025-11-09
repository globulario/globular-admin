// components/fileReader.js — refactored for new backend wrappers (DRY, token-safe)
import "@polymer/paper-icon-button/paper-icon-button.js";
import "@polymer/iron-icons/iron-icons.js";
import { getBaseUrl } from "../../backend/core/endpoints";
import { Backend } from "../../backend/backend";

// ✅ DRY: shared VM helpers (works with proto, VM, or plain objects)
import { pathOf, mimeOf, nameOf as vmNameOf } from "./filevm-helpers";

/* ----------------------------- constants ------------------------------ */
const PDF_MIME = "application/pdf";

/* ----------------------------- tiny helpers --------------------------- */
async function getToken() {
  return sessionStorage.getItem("__globular_token__") || "";
}

function buildDownloadUrl(filePath, token) {
  let url = (getBaseUrl() || "").replace(/\/$/, "") + "/api/v1/files/download";
  (filePath || "").split("/").forEach((seg) => {
    if (seg && seg.trim()) url += "/" + encodeURIComponent(seg.trim());
  });
  url += `?token=${encodeURIComponent(token)}`;
  return url;
}

function setVisible(el, on) {
  if (!el) return;
  el.style.display = on ? "flex" : "none";
}

function safeTitle(file, fallback = "File Viewer") {
  const p = typeof file === "string" ? file : pathOf(file);
  const n = vmNameOf(file);
  if (n) return n;
  if (!p) return fallback;
  const i = p.lastIndexOf("/");
  return i >= 0 ? p.slice(i + 1) || fallback : p;
}

/* ------------------------------ element ------------------------------- */
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
  /** @type {any} current file (proto/VM or { path, mime }) */
  _file = null;
  /** @type {(ev?: any) => void | null} */
  _onCloseCallback = null;
  /** @type {Record<string, HTMLElement>} */
  _domRefs = {};
  _onKeydown = null;
  _fileExplorer = null;

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

  disconnectedCallback() {
    window.removeEventListener("keydown", this._onKeydown);
  }

  /* ------------------------------ layout ------------------------------ */
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

  /** Link the file explorer that owns this navigator */
  setFileExplorer(fileExplorer) {
    this._fileExplorer = fileExplorer;
  }

  /* ----------------------------- public API --------------------------- */
  set onclose(cb) { this._onCloseCallback = cb; }
  get onclose() { return this._onCloseCallback; }

  /**
   * Show a file in the iframe.
   * @param {object|string} file - proto/VM with getPath()/getMime() or a string path
   * @param {number} [page=0]   - for PDFs, 1-based page number to jump to
   */
  async read(file, page = 0) {
    this._file = file;

    const p = pathOf(file);
    const m = (mimeOf(file) || "").toLowerCase();

    if (!p) {
      console.error("GlobularFileReader: invalid file (missing path).");
      return;
    }

    try {
      const token = await getToken();
      if (!token) throw new Error("User is not authenticated.");

      let url = buildDownloadUrl(p, token);

      // PDF page anchor (PDF.js and most browsers understand #page=N)
      if (m === PDF_MIME && page > 0) {
        url += `#page=${Number(page)}`;
      }

      // render
      this._showLoading();
      this._domRefs.title.textContent = safeTitle(file);
      this._domRefs.frame.src = url;
      setVisible(this._domRefs.content, true);
      this.style.display = "flex";
    } catch (err) {
      console.error("GlobularFileReader: Failed to read file:", err);
      this.close();
    }
  }

  /** Hide and cleanup. */
  close() {
    setVisible(this._domRefs.content, false);
    this._domRefs.frame.src = "about:blank";
    this.style.display = "none";
    this._hideLoading();
    if (typeof this._onCloseCallback === "function") {
      try { this._onCloseCallback(); } catch { /* ignore */ }
    }
  }

  /* ------------------------------ helpers ---------------------------- */
  _showLoading() {
    setVisible(this._domRefs.loading, true);
  }

  _hideLoading() {
    setVisible(this._domRefs.loading, false);
  }
}

customElements.define("globular-file-reader", GlobularFileReader);
