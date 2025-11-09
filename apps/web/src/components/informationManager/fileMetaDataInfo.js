// src/components/files/fileMetaDataInfo.js
import '@polymer/iron-collapse/iron-collapse.js';
import '@polymer/paper-icon-button/paper-icon-button.js';

/**
 * <globular-file-metadata-info>
 * Displays file metadata in a collapsible panel.
 * Accepts: plain objects, Map<string, any>, or protobuf-ish map/Struct values.
 */
export class FileMetaDataInfo extends HTMLElement {
  /** @type {Record<string, any>} */
  _metadata = {};
  _headerTextDiv = null;
  _collapseButton = null;
  _collapsePanel = null;
  _metadataListContainer = null;

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });

    this.shadowRoot.innerHTML = `
      <style>
        #container {
          display: flex;
          flex-direction: column;
          width: 100%;
          color: var(--primary-text-color);
        }
        .header-row {
          display: flex;
          align-items: center;
          border-bottom: 1px solid var(--palette-divider);
          margin-bottom: 10px;
          padding-bottom: 5px;
        }
        .header-text {
          flex-grow: 1;
          font-weight: 500;
          margin-left: 8px;
        }
        paper-icon-button {
          --iron-icon-fill-color: var(--primary-text-color);
        }
        paper-icon-button:hover {
          cursor: pointer;
          --iron-icon-fill-color: var(--primary-color);
        }
        iron-collapse {
          width: 100%;
          display: flex;
          flex-direction: column;
        }
        .row {
          display: table-row;
          border-bottom: 1px solid var(--palette-divider);
        }
        .row:last-child {
          border-bottom: none;
        }
        .cell-label, .cell-value {
          display: table-cell;
          padding: 5px 0;
          vertical-align: top;
        }
        .cell-label {
          min-width: 120px;
          font-weight: 400;
          padding-right: 15px;
          white-space: nowrap;
        }
        .cell-value {
          width: 100%;
          word-break: break-word;
          white-space: pre-wrap;
        }
        #metadata-list-container {
          display: table;
          width: 100%;
          border-collapse: collapse;
        }
      </style>
      <div id="container">
        <div class="header-row">
          <paper-icon-button id="collapse-btn" icon="unfold-less" title="Collapse/Expand"></paper-icon-button>
          <div id="header-text" class="header-text"></div>
        </div>
        <iron-collapse id="collapse-panel" opened>
          <div id="metadata-list-container"></div>
        </iron-collapse>
      </div>
    `;
    this._getDomReferences();
    this._bindEventListeners();
    this._updateHeaderCount(); // initial
  }

  connectedCallback() {
    // Nothing extra; rendering happens on setMetadata()
  }

  _getDomReferences() {
    this._headerTextDiv = this.shadowRoot.querySelector('#header-text');
    this._collapseButton = this.shadowRoot.querySelector('#collapse-btn');
    this._collapsePanel = this.shadowRoot.querySelector('#collapse-panel');
    this._metadataListContainer = this.shadowRoot.querySelector('#metadata-list-container');
  }

  _bindEventListeners() {
    if (this._collapseButton && this._collapsePanel) {
      this._collapseButton.addEventListener('click', () => this._toggleCollapse());
    }
  }

  _toggleCollapse() {
    if (!this._collapsePanel) return;
    this._collapsePanel.toggle();
    // iron-collapse updates `opened` synchronously
    this._collapseButton.icon = this._collapsePanel.opened ? 'unfold-less' : 'unfold-more';
  }

  /**
   * Public API — set metadata to display.
   * @param {Record<string, any> | Map<string, any> | any} metadata
   */
  setMetadata(metadata) {
    this._metadata = this._normalize(metadata || {});
    this._renderMetadata();
  }

  /**
   * Normalize inputs (Map/proto/Struct) into a plain object.
   * Supports:
   *  - Plain objects
   *  - JS Map
   *  - Protobuf Map (with .toObject or .toJavaScript)
   *  - google.protobuf.Struct-like { fields: { k: { kind } } }
   */
  _normalize(input) {
    // Protobuf wrapper with .toJavaScript()
    if (input && typeof input.toJavaScript === 'function') {
      try { return input.toJavaScript(); } catch {}
    }
    // Protobuf wrapper with .toObject()
    if (input && typeof input.toObject === 'function') {
      try { return input.toObject(); } catch {}
    }
    // Map -> plain object
    if (input instanceof Map) {
      const obj = {};
      for (const [k, v] of input.entries()) obj[k] = v;
      return obj;
    }
    // google.protobuf.Struct-ish
    if (input && typeof input === 'object' && input.fields && typeof input.fields === 'object') {
      const out = {};
      for (const k of Object.keys(input.fields)) {
        out[k] = this._unwrapValue(input.fields[k]);
      }
      return out;
    }
    // Already plain
    if (input && typeof input === 'object') return input;
    return {};
  }

  /** Unwrap google.protobuf.Value-like unions into JS values */
  _unwrapValue(v) {
    if (v == null) return null;
    if (typeof v !== 'object') return v;
    if ('nullValue' in v) return null;
    if ('boolValue' in v) return !!v.boolValue;
    if ('numberValue' in v) return Number(v.numberValue);
    if ('stringValue' in v) return String(v.stringValue);
    if ('listValue' in v && v.listValue && Array.isArray(v.listValue.values)) {
      return v.listValue.values.map((x) => this._unwrapValue(x));
    }
    if ('structValue' in v && v.structValue && v.structValue.fields) {
      const o = {};
      for (const k of Object.keys(v.structValue.fields)) {
        o[k] = this._unwrapValue(v.structValue.fields[k]);
      }
      return o;
    }
    return v;
  }

  _updateHeaderCount() {
    if (!this._headerTextDiv) return;
    const count = Object.keys(this._metadata || {}).length;
    this._headerTextDiv.textContent = `Metadata (${count})`;
  }

  _labelize(key) {
    // camelCase / PascalCase → words
    return String(key).replace(/([a-z0-9])([A-Z])/g, '$1 $2');
  }

  _formatValue(key, value) {
    // Special handling for "Comment": base64 JSON with Description
    if (key === 'Comment' && typeof value === 'string') {
      try {
        const parsed = JSON.parse(atob(value));
        if (parsed && typeof parsed === 'object' && parsed.Description) {
          return String(parsed.Description);
        }
      } catch {
        // ignore and fall through
      }
    }

    // Plain scalars
    if (
      value == null ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) {
      return String(value);
    }
    if (typeof value === 'string') {
      return value;
    }

    // Arrays & Objects → pretty JSON (compact)
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }

  _renderMetadata() {
    if (!this._metadataListContainer) return;

    // Clear existing
    this._metadataListContainer.textContent = '';

    const keys = Object.keys(this._metadata).sort((a, b) => a.localeCompare(b));
    this._updateHeaderCount();

    for (const key of keys) {
      const label = this._labelize(key);
      const pretty = this._formatValue(key, this._metadata[key]);

      const row = document.createElement('div');
      row.className = 'row';

      const cLabel = document.createElement('div');
      cLabel.className = 'cell-label';
      cLabel.textContent = `${label}:`;

      const cValue = document.createElement('div');
      cValue.className = 'cell-value';
      // Use textContent to avoid XSS (no raw HTML injection)
      cValue.textContent = pretty;

      row.appendChild(cLabel);
      row.appendChild(cValue);
      this._metadataListContainer.appendChild(row);
    }
  }
}

customElements.define('globular-file-metadata-info', FileMetaDataInfo);
