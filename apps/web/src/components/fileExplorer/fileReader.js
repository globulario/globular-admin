// components/fileReader.js — token-safe, PDF-proof (blob + wrapper, conditional sandbox)
import "@polymer/paper-icon-button/paper-icon-button.js";
import "@polymer/iron-icons/iron-icons.js";
import { getBaseUrl } from "../../backend/core/endpoints";
import { Backend } from "../../backend/backend";
import { pathOf, mimeOf, nameOf as vmNameOf } from "./filevm-helpers";

/* ----------------------------- constants ------------------------------ */
const PDF_MIME = "application/pdf";
const NON_PDF_SANDBOX =
  "allow-same-origin allow-scripts allow-downloads allow-forms";

/* ----------------------------- module state --------------------------- */
let currentFileObjectUrl = null;    // blob: for the file itself
let currentWrapperObjectUrl = null; // blob: for the HTML wrapper (PDF only)

/* ----------------------------- tiny helpers --------------------------- */
async function getToken() {
  return sessionStorage.getItem("__globular_token__") || "";
}

/**
 * Build a direct download URL (server may also accept token in query).
 * We still add ?token= for compatibility, but we authenticate via header too.
 */
function buildDownloadUrl(filePath, token) {
  let url = (getBaseUrl() || "").replace(/\/$/, "");
  (filePath || "").split("/").forEach((seg) => {
    if (seg && seg.trim()) url += "/" + encodeURIComponent(seg.trim());
  });
  if (token) {
    url += (url.includes("?") ? "&" : "?") + `token=${encodeURIComponent(token)}`;
  }
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

async function fetchAsBlob(url, token) {
  const res = await fetch(url, {
    method: "GET",
    headers: token ? { token } : undefined,
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText}`);
  }
  return await res.blob();
}

/** Create a blob URL for the file, ensuring the desired mime type. */
function makeFileObjectUrl(blob, explicitMime) {
  const type = explicitMime || blob.type || "application/octet-stream";
  return URL.createObjectURL(new Blob([blob], { type }));
}

/** Wrap a PDF blob URL in a tiny HTML page using <embed>, return its blob URL. */
function makePdfWrapperObjectUrl(pdfBlobUrl) {
  const html = `<!doctype html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;overflow:hidden;background:#fff">
  <embed src="${pdfBlobUrl}" type="application/pdf" style="width:100vw;height:100vh;border:0;display:block"/>
</body>
</html>`;
  return URL.createObjectURL(new Blob([html], { type: "text/html" }));
}

/* ------------------------------ element ------------------------------- */
export class GlobularFileReader extends HTMLElement {
  _file = null;
  _onCloseCallback = null;
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
    this.style.display = "none"; // hidden until read()
  }

  disconnectedCallback() {
    window.removeEventListener("keydown", this._onKeydown);
    this._cleanupObjectUrls();
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
        color: var(--on-surface-color, var(--primary-text-color));
      }

      /* Scrollbars on the host container if it ever scrolls */
      :host::-webkit-scrollbar { width: 5px; height: 5px; }
      :host::-webkit-scrollbar-track {
        background: var(--scroll-track, var(--surface-color));
      }
      :host::-webkit-scrollbar-thumb {
        background: var(--scroll-thumb, var(--palette-divider));
      }

      #content {
        display: none;
        flex-direction: column;
        width: 100%;
        height: 100%;
        background: var(--surface-color);
      }

      #header {
        display: flex;
        align-items: center;
        gap: 8px;
        background: var(--surface-color);
        color: var(--on-surface-color, var(--primary-text-color));
        border-bottom: 1px solid var(--palette-divider);
        padding: 8px;
        flex-shrink: 0;
      }

      #title {
        flex: 1;
        text-align: center;
        font-size: 1.2rem;
        font-weight: 500;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      #close-btn {
        --iron-icon-fill-color: var(--on-surface-color, var(--primary-text-color));
        cursor: pointer;
      }

      #frame {
        width: 100%;
        height: 100%;
        border: none;
        flex: 1;
        background: var(--file-reader-page-bg, #ffffff);
      }

      #loading {
        position: absolute;
        inset: 48px 8px 8px;
        display: none;
        align-items: center;
        justify-content: center;
        background: transparent;
        pointer-events: none;
      }

      #loading span {
        padding: 6px 10px;
        border-radius: 8px;
        background: var(
          --surface-elevated-color,
          rgba(0, 0, 0, 0.06)
        );
        color: var(--on-surface-color, var(--primary-text-color));
        font-size: .9rem;
        box-shadow: 0 1px 3px rgba(0,0,0,.25);
      }
    </style>

    <div id="content" role="dialog" aria-modal="true" aria-label="File viewer">
      <div id="header">
        <span id="title"></span>
        <paper-icon-button
          icon="icons:close"
          id="close-btn"
          title="Close (Esc)">
        </paper-icon-button>
      </div>
      <!-- NOTE: no sandbox in markup; we toggle it dynamically -->
      <iframe id="frame"></iframe>
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
    this._onKeydown = (e) => { if (e.key === "Escape") this.close(); };
    window.addEventListener("keydown", this._onKeydown);

    this._domRefs.frame.addEventListener("load", () => this._hideLoading());
    this._domRefs.frame.addEventListener("error", () => this._hideLoading());
  }

  setFileExplorer(fileExplorer) { this._fileExplorer = fileExplorer; }
  set onclose(cb) { this._onCloseCallback = cb; }
  get onclose() { return this._onCloseCallback; }

  /** Toggle iframe sandbox depending on content type. */
  _applySandbox(isPdf) {
    const f = this._domRefs.frame;
    if (!f) return;
    if (isPdf) {
      // Chrome PDF plugin cannot load inside a sandboxed iframe.
      f.removeAttribute("sandbox");
    } else {
      f.setAttribute("sandbox", NON_PDF_SANDBOX);
    }
  }

  /**
   * Show a file in the iframe.
   * @param {object|string} file - proto/VM with getPath()/getMime() or a string path
   * @param {number} [page=0]   - for PDFs, 1-based page number to jump to
   */
  async read(file, page = 0) {
    this._file = file;

    const p = pathOf(file);
    const m = (mimeOf(file) || "").toLowerCase();
    const isPdf = m === PDF_MIME;

    if (!p) {
      console.error("GlobularFileReader: invalid file (missing path).");
      return;
    }

    try {
      const token = await getToken();
      if (!token) throw new Error("User is not authenticated.");

      const url = buildDownloadUrl(p, token);

      this._showLoading();
      this._domRefs.title.textContent = safeTitle(file);

      // 1) fetch the file with auth header
      const blob = await fetchAsBlob(url, token);

      // 2) make blob: URL for the file with correct mime
      let fileUrl = makeFileObjectUrl(blob, m);

      // Respect #page for PDFs
      if (isPdf && page > 0) {
        fileUrl += `#page=${Number(page)}`;
      }

      // 3) For PDFs, wrap with <embed> HTML; otherwise use the file blob directly
      let frameUrl = fileUrl;
      if (isPdf) {
        const wrapperUrl = makePdfWrapperObjectUrl(fileUrl);
        frameUrl = wrapperUrl;

        // Revoke previous wrapper if any, then track the new one
        if (currentWrapperObjectUrl) {
          try { URL.revokeObjectURL(currentWrapperObjectUrl); } catch {}
        }
        currentWrapperObjectUrl = wrapperUrl;
      }

      // 4) set sandbox appropriately (no sandbox for PDFs)
      this._applySandbox(isPdf);

      // 5) set iframe src; cleanup old file URL if any
      if (currentFileObjectUrl) {
        try { URL.revokeObjectURL(currentFileObjectUrl); } catch {}
      }
      currentFileObjectUrl = fileUrl;

      this._domRefs.frame.src = frameUrl;
      setVisible(this._domRefs.content, true);
      this.style.display = "flex";
    } catch (err) {
      console.error("GlobularFileReader: Failed to read file:", err);
      this.close();
    } finally {
      this._hideLoading();
    }
  }

  close() {
    setVisible(this._domRefs.content, false);
    this._domRefs.frame.src = "about:blank";
    this.style.display = "none";
    this._hideLoading();
    // Restore safe default sandbox for next non-PDF usage
    this._applySandbox(false);
    this._cleanupObjectUrls();
    if (typeof this._onCloseCallback === "function") {
      try { this._onCloseCallback(); } catch { /* ignore */ }
    }
  }

  _cleanupObjectUrls() {
    if (currentFileObjectUrl) {
      try { URL.revokeObjectURL(currentFileObjectUrl); } catch {}
      currentFileObjectUrl = null;
    }
    if (currentWrapperObjectUrl) {
      try { URL.revokeObjectURL(currentWrapperObjectUrl); } catch {}
      currentWrapperObjectUrl = null;
    }
  }

  _showLoading() { setVisible(this._domRefs.loading, true); }
  _hideLoading() { setVisible(this._domRefs.loading, false); }
}

customElements.define("globular-file-reader", GlobularFileReader);
