// src/components/groups/groupInfo.js
import '@polymer/iron-icon/iron-icon.js';
import { listToString } from '../utility';

/**
 * <globular-group-info>
 * Displays basic group information.
 * Accepts either a plain object { id, name, members[] } or a proto with
 * getId(), getName(), getMembersList().
 */
export class GroupInfo extends HTMLElement {
  /** @type {{id?: string, name?: string, members?: string[]}|null} */
  _group = null;

  // Dom refs
  _idEl = null;
  _nameEl = null;
  _membersEl = null;

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  connectedCallback() {
    this._render();
  }

  set group(group) {
    if (this._group === group) return;
    this._group = this._toVM(group);
    // If already connected, refresh UI
    if (this.shadowRoot && this.isConnected) {
      this._render();
    }
  }

  get group() {
    return this._group;
  }

  /** Normalize input to a simple VM { id, name, members[] } */
  _toVM(src) {
    if (!src) return { id: '', name: '', members: [] };

    const isProto =
      typeof src.getId === 'function' ||
      typeof src.getName === 'function' ||
      typeof src.getMembersList === 'function';

    if (isProto) {
      const id = typeof src.getId === 'function' ? src.getId() : '';
      const name = typeof src.getName === 'function' ? src.getName() : '';
      const members = typeof src.getMembersList === 'function' ? src.getMembersList() : [];
      return {
        id: id ?? '',
        name: name ?? '',
        members: Array.isArray(members) ? members : [],
      };
    }

    // Plain object fallback
    return {
      id: src.id ?? '',
      name: src.name ?? '',
      members: Array.isArray(src.members) ? src.members : [],
    };
  }

  _render() {
    if (!this._group) {
      this.shadowRoot.innerHTML = `
        <style>
          #container { display:flex; color: var(--primary-text-color); padding:10px; }
        </style>
        <div id="container"><p>No group data available.</p></div>
      `;
      return;
    }

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
          height: 40px;
          width: 40px;
          padding-left: 15px;
          flex-shrink: 0;
          color: var(--primary-color);
        }
        .info-table {
          display: table;
          flex-grow: 1;
          border-collapse: separate;
          border-spacing: 0 5px;
          width: 100%;
        }
        .row { display: table-row; }
        .label {
          display: table-cell;
          font-weight: 500;
          padding-right: 15px;
          vertical-align: top;
          white-space: nowrap;
        }
        .value {
          display: table-cell;
          word-break: break-word;
        }
      </style>
      <div id="container">
        <div class="icon-container">
          <iron-icon id="icon" icon="social:people"></iron-icon>
        </div>
        <div class="info-table">
          <div class="row">
            <div class="label">Id:</div>
            <div id="id" class="value"></div>
          </div>
          <div class="row">
            <div class="label">Name:</div>
            <div id="name" class="value"></div>
          </div>
          <div class="row">
            <div class="label">Members:</div>
            <div id="members" class="value"></div>
          </div>
        </div>
      </div>
    `;

    // Cache refs + assign via textContent to avoid HTML injection
    this._idEl = this.shadowRoot.querySelector('#id');
    this._nameEl = this.shadowRoot.querySelector('#name');
    this._membersEl = this.shadowRoot.querySelector('#members');

    const vm = this._group ?? { id: '', name: '', members: [] };
    this._idEl.textContent = vm.id || '—';
    this._nameEl.textContent = vm.name || '—';
    this._membersEl.textContent =
      (Array.isArray(vm.members) && vm.members.length > 0)
        ? listToString(vm.members)
        : '—';
  }
}

customElements.define('globular-group-info', GroupInfo);