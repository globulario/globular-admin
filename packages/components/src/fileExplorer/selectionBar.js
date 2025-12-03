// components/selectionBar.js
// Selection action bar: appears when there are selected items in the active view
// and exposes Cut / Copy / Delete / Download / Share actions.

import '@polymer/paper-button/paper-button.js';
import { Backend } from '@globular/backend';
import { displayError } from '@globular/backend';

export class SelectionBar extends HTMLElement {
  /** @type {any} */
  _fileExplorer = null;

  /** @type {any[]} */
  _files = [];

  _container = null;
  _label = null;
  _cutBtn = null;
  _copyBtn = null;
  _deleteBtn = null;
  _downloadBtn = null;
  _clearBtn = null;
  _linkBtn = null;
  _shareBtn = null;

  constructor() {
    super();
    const shadow = this.attachShadow({ mode: 'open' });

    shadow.innerHTML = `
      <style>
        :host {
          display: block;
          font-family: system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, Arial;
        }

        #container {
          display: none; /* becomes flex when there is a selection */
          align-items: center;
          gap: 8px;
          padding: 4px 10px;
          border-bottom: 1px solid var(--border-subtle-color, var(--divider-color));
          background: var(--surface-elevated-color, var(--surface-color));
          font-size: 0.8rem;
          color: var(--on-surface-color);
        }

        #label {
          font-weight: 500;
          opacity: 0.9;
          white-space: nowrap;
        }

        #spacer {
          flex: 1;
        }

        #actions {
          display: flex;
          align-items: center;
          gap: 4px;
        }

        paper-button.small {
          --paper-button: {
            padding: 2px 6px;
            min-width: 0;
            font-size: 0.75rem;
          };
        }

        paper-button[hidden] {
          display: none !important;
        }
      </style>

      <div id="container">
        <span id="label"></span>
        <span id="spacer"></span>
        <div id="actions">
          <paper-button id="cut-btn" class="small" title="Cut selected">Cut</paper-button>
          <paper-button id="copy-btn" class="small" title="Copy selected">Copy</paper-button>
          <paper-button id="link-btn" class="small" title="Save selection as shortcuts">Link</paper-button>
          <paper-button id="download-btn" class="small" title="Download selected">Download</paper-button>
          <paper-button id="delete-btn" class="small" title="Delete selected">Delete</paper-button>
          <paper-button id="share-btn" class="small" title="Share selected">Share</paper-button>
          <paper-button id="clear-btn" class="small" title="Clear selection">Clear</paper-button>
        </div>
      </div>
    `;

    this._container = shadow.querySelector('#container');
    this._label = shadow.querySelector('#label');
    this._cutBtn = shadow.querySelector('#cut-btn');
    this._copyBtn = shadow.querySelector('#copy-btn');
    this._linkBtn = shadow.querySelector('#link-btn');
    this._deleteBtn = shadow.querySelector('#delete-btn');
    this._downloadBtn = shadow.querySelector('#download-btn');
    this._shareBtn = shadow.querySelector('#share-btn');
    this._clearBtn = shadow.querySelector('#clear-btn');

    this._cutBtn?.addEventListener('click', () => this._emitAction('cut'));
    this._copyBtn?.addEventListener('click', () => this._emitAction('copy'));
    this._linkBtn?.addEventListener('click', () => this._emitAction('link'));
    this._deleteBtn?.addEventListener('click', () => this._emitAction('delete'));
    this._downloadBtn?.addEventListener('click', () => this._emitAction('download'));
    this._clearBtn?.addEventListener('click', () => this._emitAction('clear-selection'));
    this._shareBtn?.addEventListener('click', () => this._handleShare());
  }

  connectedCallback() {
    this._render();
  }

  setFileExplorer(explorer) {
    this._fileExplorer = explorer;
  }

  /**
   * Called by FileExplorer when selection changes.
   * @param {any[]} files
   */
  setSelection(files) {
    this._files = Array.isArray(files) ? files : [];
    this._render();
  }

  getSelection() {
    return [...this._files];
  }

  _render() {
    if (!this._container) return;

    const count = this._files?.length || 0;
    if (count === 0) {
      this._container.style.display = 'none';
      return;
    }

    this._container.style.display = 'flex';

    if (this._label) {
      this._label.textContent = `${count} item${count > 1 ? 's' : ''} selected`;
    }
  }

  _emitAction(action) {
    this.dispatchEvent(
      new CustomEvent('selection-bar-action', {
        detail: { action },
        bubbles: true,
        composed: true,
      })
    );
  }

  /**
   * Publish share_resources_event_ so FileExplorer can open the share wizard.
   */
  _handleShare() {
    const paths = Array.isArray(this._files)
      ? this._files
          // adjust "path" if your file object uses another property name
          .map((f) => f?.path)
          .filter((p) => typeof p === 'string' && p.length > 0)
      : [];

    if (!paths.length) {
      displayError('No files selected to share.', 2500);
      return;
    }

    Backend.eventHub.publish(
      'share_resources_event_',
      {
        paths,
        file_explorer_id: this._fileExplorer?._id || null,
      },
      true
    );

    // Clear selection immediately so UI and explorer are reset while wizard loads
    this._files = [];
    this._render();
    this._fileExplorer?.clearSelections?.();
  }
}

customElements.define('globular-selectionbar', SelectionBar);