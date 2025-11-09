import '@polymer/iron-icon/iron-icon.js';
import { listToString } from '../utility'; // expects (arr?: any[]) => string

/**
 * Displays basic organization information (proto or VM/plain object).
 */
export class OrganizationInfo extends HTMLElement {
  /** @type {any|null} */
  _organization = null;

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  connectedCallback() {
    this._render();
  }

  /** @param {any} organization */
  set organization(organization) {
    if (this._organization !== organization) {
      this._organization = organization;
      this._render();
    }
  }

  get organization() {
    return this._organization;
  }

  /** Safe accessors to support proto or plain objects */
  _getId() {
    const o = this._organization;
    if (!o) return '';
    return typeof o.getId === 'function' ? o.getId() : (o.id ?? '');
  }
  _getName() {
    const o = this._organization;
    if (!o) return '';
    return typeof o.getName === 'function' ? o.getName() : (o.name ?? '');
  }
  _getList(fieldBase) {
    const o = this._organization;
    if (!o) return [];
    const getListName = `get${fieldBase}List`; // e.g., getAccountsList
    if (typeof o[getListName] === 'function') return o[getListName]() ?? [];
    const key = fieldBase.toLowerCase(); // accounts, groups, roles, applications
    return Array.isArray(o[key]) ? o[key] : [];
  }

  _render() {
    if (!this._organization) {
      this.shadowRoot.innerHTML = `
        <style>
          #container { display:flex; color: var(--primary-text-color); padding:10px; }
        </style>
        <div id="container"><p>No organization data available.</p></div>
      `;
      return;
    }

    const id = this._getId();
    const name = this._getName();
    const accounts = this._getList('Accounts');
    const groups = this._getList('Groups');
    const roles = this._getList('Roles');
    const applications = this._getList('Applications');

    this.shadowRoot.innerHTML = `
      <style>
        #container {
          display: flex;
          color: var(--primary-text-color);
          padding: 15px;
          gap: 20px;
          align-items: flex-start;
        }
        .icon-container iron-icon {
          height: 40px; width: 40px;
          padding-left: 15px;
          flex-shrink: 0;
          color: var(--primary-color);
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
        <div class="icon-container">
          <iron-icon id="icon" icon="social:domain"></iron-icon>
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
            <div class="info-label">Accounts:</div>
            <div class="info-value">${listToString(accounts) || '<span class="muted">None</span>'}</div>
          </div>
          <div class="info-row">
            <div class="info-label">Groups:</div>
            <div class="info-value">${listToString(groups) || '<span class="muted">None</span>'}</div>
          </div>
          <div class="info-row">
            <div class="info-label">Roles:</div>
            <div class="info-value">${listToString(roles) || '<span class="muted">None</span>'}</div>
          </div>
          <div class="info-row">
            <div class="info-label">Applications:</div>
            <div class="info-value">${listToString(applications) || '<span class="muted">None</span>'}</div>
          </div>
        </div>
      </div>
    `;
  }
}

customElements.define('globular-organization-info', OrganizationInfo);
