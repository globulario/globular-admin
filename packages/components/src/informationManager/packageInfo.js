import '@polymer/iron-icon/iron-icon.js';
import { listToString } from '../utility'; // expects (arr?: any[]) => string

/**
 * Displays basic package information (application/service package).
 * Accepts proto descriptors or plain VM objects.
 */
export class PackageInfo extends HTMLElement {
  /** @type {any|null} */
  _descriptor = null;

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  connectedCallback() {
    this._render();
  }

  /** @param {any} descriptor */
  set descriptor(descriptor) {
    if (this._descriptor !== descriptor) {
      this._descriptor = descriptor;
      this._render();
    }
  }
  get descriptor() { return this._descriptor; }

  // ---- Safe accessors (proto + VM) ----
  _get(field, fallback = '') {
    const d = this._descriptor;
    if (!d) return fallback;
    const getter = `get${field}`;
    if (typeof d[getter] === 'function') return d[getter]() ?? fallback;
    const vmKey = field.charAt(0).toLowerCase() + field.slice(1); // e.g. Id -> id
    if (vmKey in d) return d[vmKey] ?? fallback;
    // common alternate key for PublisherId
    if (vmKey === 'publisherid' && 'publisherId' in d) return d.publisherId ?? fallback;
    return fallback;
  }
  _getList(field) {
    const d = this._descriptor;
    if (!d) return [];
    const listGetter = `get${field}List`; // e.g. getKeywordsList()
    if (typeof d[listGetter] === 'function') return d[listGetter]() ?? [];
    const vmKey = field.charAt(0).toLowerCase() + field.slice(1); // Keywords -> keywords
    return Array.isArray(d[vmKey]) ? d[vmKey] : [];
  }

  _render() {
    if (!this._descriptor) {
      this.shadowRoot.innerHTML = `
        <style>
          #container { display:flex; color:var(--primary-text-color); padding:10px; }
        </style>
        <div id="container"><p>No package data available.</p></div>
      `;
      return;
    }

    const id = this._get('Id');
    const name = this._get('Name');
    const version = this._get('Version');
    const publisher = this._get('Publisherid', this._get('PublisherId', ''));
    const description = this._get('Description');
    const keywords = this._getList('Keywords');

    // Type: 0 = App, 1 = Service (fallbacks for string/enum/boolean)
    const rawType = this._get('Type', 0);
    const numericType = typeof rawType === 'number'
      ? rawType
      : (rawType === 'Service' || rawType === 'SERVICE' || rawType === true ? 1 : 0);
    const typeLabel = numericType === 1 ? 'Service Package' : 'Application Package';
    const typeIcon = numericType === 1 ? 'icons:build' : 'icons:archive';

    this.shadowRoot.innerHTML = `
      <style>
        #container {
          display: flex;
          color: var(--primary-text-color);
          padding: 15px;
          gap: 20px;
          align-items: flex-start;
        }
        .icon-type-column {
          display: flex; flex-direction: column; align-items: center;
          padding-left: 15px; flex-shrink: 0;
        }
        .icon-type-column iron-icon {
          height: 40px; width: 40px; margin-bottom: 5px;
          color: var(--primary-color);
        }
        .icon-type-column span {
          font-weight: 500; font-size: .9em; text-align: center;
        }
        .info-table {
          display: table; flex-grow: 1; width: 100%;
          border-collapse: separate; border-spacing: 0 5px;
        }
        .info-row { display: table-row; }
        .info-label {
          display: table-cell; font-weight: 500;
          padding-right: 15px; vertical-align: top; white-space: nowrap;
        }
        .info-value { display: table-cell; word-break: break-word; }
        .muted { color: var(--secondary-text-color); }
      </style>
      <div id="container">
        <div class="icon-type-column">
          <iron-icon id="icon" icon="${typeIcon}"></iron-icon>
          <span>${typeLabel}</span>
        </div>
        <div class="info-table">
          <div class="info-row">
            <div class="info-label">Id:</div>
            <div class="info-value">${id}</div>
          </div>
          <div class="info-row">
            <div class="info-label">Name:</div>
            <div class="info-value">${name}</div>
          </div>
          <div class="info-row">
            <div class="info-label">Version:</div>
            <div class="info-value">${version}</div>
          </div>
          <div class="info-row">
            <div class="info-label">Publisher Id:</div>
            <div class="info-value">${publisher || '<span class="muted">N/A</span>'}</div>
          </div>
          <div class="info-row">
            <div class="info-label">Description:</div>
            <div class="info-value">${description || '<span class="muted">None</span>'}</div>
          </div>
          <div class="info-row">
            <div class="info-label">Keywords:</div>
            <div class="info-value">${listToString(keywords) || '<span class="muted">None</span>'}</div>
          </div>
        </div>
      </div>
    `;
  }
}

customElements.define('globular-package-info', PackageInfo);