// src/components/files/file_info.js
import { getFileSizeString } from "../utility";
import { displayError } from "../../backend/ui/notify";
import { getFileMetadata } from "../../backend/cms/files";   // <-- NEW backend accessor
import "./fileMetaDataInfo.js";                          // <globular-file-metadata-info>

/**
 * <globular-file-info>
 * Displays detailed information about a file and its dynamic metadata.
 * Works with either a proto File object (getXxx()) or a plain VM { xxx }.
 */
export class FileInfo extends HTMLElement {
  /** @type {any|null} */
  _file = null;
  _metadataEditor = null;

  constructor() {
    super();
    this.attachShadow({ mode: "open" });
  }

  connectedCallback() {
    this._render();
    this._getDomReferences();
    if (this._file) this._fetchAndDisplayMetadata();
  }

  /** Set the file object (proto or VM) */
  set file(file) {
    if (this._file !== file) {
      this._file = file;
      if (this.shadowRoot && this.shadowRoot.isConnected) {
        this._render();
        this._getDomReferences();
        this._fetchAndDisplayMetadata();
      }
    }
  }
  get file() {
    return this._file;
  }

  /** Safe getter (supports getXxx() and plain props) */
  _v(obj, names, fallback = undefined) {
    if (!obj) return fallback;
    for (const n of names) {
      const fn = obj[n];
      if (typeof fn === "function") {
        try { return fn.call(obj); } catch {}
      }
      if (n in obj) return obj[n];
    }
    return fallback;
  }

  /** Convert seconds→ms if needed and return Date (or null) */
  _tsToDate(t) {
    if (!t && t !== 0) return null;
    const num = Number(t);
    if (!Number.isFinite(num)) return null;
    const ms = num > 1e12 ? num : num * 1000;
    return new Date(ms);
  }

  _render() {
    if (!this._file) {
      this.shadowRoot.innerHTML = `
        <style>
          #container {
            display: flex;
            background: var(--surface-color);
            color: var(--primary-text-color);
            padding: 10px;
          }
        </style>
        <div id="container"><p>No file data available.</p></div>
      `;
      return;
    }

    // Pull values safely from proto/VM
    const name = this._v(this._file, ["getName", "name"], "");
    const mime = this._v(this._file, ["getMime", "mime"], "");
    const path = this._v(this._file, ["getPath", "path"], "");
    const size = this._v(this._file, ["getSize", "size"], 0);
    const checksum = this._v(this._file, ["getChecksum", "checksum"], "");
    const mtimeRaw = this._v(this._file, ["getModeTime", "getModTime", "modTime", "modeTime", "mtime"], 0);
    const thumbnail = this._v(this._file, ["getThumbnail", "thumbnail"], "");

    const modDate = this._tsToDate(mtimeRaw);

    this.shadowRoot.innerHTML = `
      <style>
        #container {
          display: flex;
          background: var(--surface-color);
          color: var(--primary-text-color);
          padding: 15px;
          gap: 20px;
          align-items: flex-start;
          flex-wrap: wrap;
        }
        img {
          max-height: 180px;
          width: auto;
          object-fit: contain;
          flex-shrink: 0;
          border-radius: 8px;
          border: 1px solid var(--palette-divider);
          display: ${thumbnail ? "block" : "none"};
        }
        .info-table {
          display: table;
          flex-grow: 1;
          border-collapse: separate;
          border-spacing: 0 5px;
          min-width: 280px;
        }
        .info-row { display: table-row; }
        .info-label {
          display: table-cell;
          font-weight: 500;
          padding-right: 15px;
          vertical-align: top;
          white-space: nowrap;
        }
        .info-value {
          display: table-cell;
          word-break: break-word;
        }
      </style>
      <div id="container">
        <div><img id="thumb" src="${thumbnail || ""}" alt="File Thumbnail"></div>
        <div class="info-table">
          <div class="info-row">
            <div class="info-label">Name:</div>
            <div class="info-value" id="name">${name || "—"}</div>
          </div>
          <div class="info-row">
            <div class="info-label">Type:</div>
            <div class="info-value" id="mime">${mime || "—"}</div>
          </div>
          <div class="info-row">
            <div class="info-label">Location:</div>
            <div class="info-value" id="path">${path || "—"}</div>
          </div>
          <div class="info-row">
            <div class="info-label">Modified:</div>
            <div class="info-value" id="mod">${modDate ? modDate.toLocaleString() : "—"}</div>
          </div>
          <div class="info-row">
            <div class="info-label">Size:</div>
            <div class="info-value" id="size">${getFileSizeString(Number(size) || 0)}</div>
          </div>
          <div class="info-row">
            <div class="info-label">Checksum:</div>
            <div class="info-value" id="chksum">${checksum || "—"}</div>
          </div>
          <div class="info-row">
            <div class="info-label">Metadata:</div>
            <div class="info-value">
              <globular-file-metadata-info id="metadata-info-component"></globular-file-metadata-info>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  _getDomReferences() {
    this._metadataEditor = this.shadowRoot.querySelector("#metadata-info-component");
  }

  async _fetchAndDisplayMetadata() {
    if (!this._file || !this._metadataEditor) return;

    const path =
      this._v(this._file, ["getPath", "path"], "") ||
      this._v(this._file, ["Path"], ""); // last-ditch

    if (!path) {
      this._metadataEditor.setMetadata?.({});
      return;
    }

    try {
      // New backend accessor handles token/base URL internally
      const meta = await getFileMetadata(path); // -> returns plain object map
      this._metadataEditor.setMetadata?.(meta || {});
    } catch (err) {
      displayError(`Failed to get file metadata: ${err?.message ?? err}`, 3000);
      this._metadataEditor.setMetadata?.({});
    }
  }
}

customElements.define("globular-file-info", FileInfo);
