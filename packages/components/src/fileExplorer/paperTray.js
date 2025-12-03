// components/paperTray.js
// Lightweight clipboard UI for FileExplorer: shows current Cut/Copy selection
// and lets user paste into the currently opened directory.

import { Backend } from '@globular/backend';
import { displayError, displayMessage } from '@globular/backend';
import { copyFiles, moveFiles, createLink } from '@globular/backend';

import '@polymer/paper-button/paper-button.js';

export class PaperTray extends HTMLElement {
  /** @type {any} */
  _fileExplorer = null;

  /** @type {'cut'|'copy'|'link'|''} */
  _mode = '';

  /** @type {string[]} */
  _items = [];

  /** DOM refs */
  _container = null;
  _label = null;
  _itemsEl = null;
  _clearBtn = null;
  _pasteBtn = null;

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
          display: none; /* toggled to flex when there are items */
          align-items: center;
          gap: 8px;
          padding: 4px 10px;
          border-bottom: 1px solid var(--border-subtle-color, var(--divider-color));
          background: var(--surface-elevated-color, var(--surface-color));
          box-shadow: inset 0 -1px 0 rgba(0, 0, 0, 0.05);
          font-size: 0.78rem;
          color: var(--on-surface-color);
        }

        #label {
          font-weight: 500;
          opacity: 0.9;
          white-space: nowrap;
        }

        #items {
          display: flex;
          flex-wrap: wrap;
          gap: 4px;
          margin-left: 6px;
          max-height: 3.2em;
          overflow-y: auto;
          flex: 1;
        }

        .chip {
          display: inline-flex;
          align-items: center;
          padding: 2px 6px;
          border-radius: 999px;
          background-color: color-mix(in srgb, var(--on-surface-color) 8%, transparent);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          font-size: 0.75rem;
        }

        .chip[title] {
          cursor: default;
        }

        .chip-remove {
          margin-left: 4px;
          border: none;
          background: transparent;
          cursor: pointer;
          font-size: 0.9em;
          padding: 0;
          color: inherit;
        }

        #actions {
          display: flex;
          align-items: center;
          gap: 4px;
          margin-left: 8px;
        }

        paper-button.small {
          --paper-button: {
            padding: 2px 6px;
            min-width: 0;
            font-size: 0.72rem;
          };
        }
      </style>

      <div id="container">
        <span id="label"></span>
        <div id="items"></div>
        <div id="actions">
          <paper-button id="clear-btn" class="small" title="Clear clipboard">
            Clear
          </paper-button>
          <paper-button id="paste-btn" class="small" title="Paste into this folder">
            Paste here
          </paper-button>
        </div>
      </div>
    `;

    this._container = shadow.querySelector('#container');
    this._label = shadow.querySelector('#label');
    this._itemsEl = shadow.querySelector('#items');
    this._clearBtn = shadow.querySelector('#clear-btn');
    this._pasteBtn = shadow.querySelector('#paste-btn');

    this._clearBtn?.addEventListener('click', () => this.clearClipboard());
    this._pasteBtn?.addEventListener('click', () => this._handlePasteHere());
  }

  connectedCallback() {
    this._render();
  }

  /**
   * Called by FileExplorer so we can access current path, clear selections, etc.
   * @param {any} explorer
   */
  setFileExplorer(explorer) {
    this._fileExplorer = explorer;
  }

  /**
   * Replace clipboard with given mode + paths.
   * @param {'cut'|'copy'} mode
   * @param {string[]} paths
   */
  setClipboard(mode, paths) {
    const m = mode === 'copy' ? 'copy' : mode === 'link' ? 'link' : 'cut';
    const clean = Array.isArray(paths) ? paths.filter(Boolean) : [];
    const seen = new Set();

    this._items = [];
    for (const p of clean) {
      if (!seen.has(p)) {
        seen.add(p);
        this._items.push(p);
      }
    }
    this._mode = this._items.length > 0 ? m : '';
    this._render();
  }

  /**
   * Append items to current clipboard (keeping single mode).
   * @param {'cut'|'copy'} mode
   * @param {string[]} paths
   */
  appendToClipboard(mode, paths) {
    const m = mode === 'copy' ? 'copy' : mode === 'link' ? 'link' : 'cut';
    const clean = Array.isArray(paths) ? paths.filter(Boolean) : [];

    if (!this._mode) {
      this._mode = m;
    } else if (this._mode !== m && clean.length > 0) {
      // User changed mode: treat this as a fresh clipboard
      this._mode = m;
      this._items = [];
    }

    const seen = new Set(this._items);
    for (const p of clean) {
      if (!seen.has(p)) {
        seen.add(p);
        this._items.push(p);
      }
    }
    this._render();
  }

  clearClipboard() {
    this._items = [];
    this._mode = '';
    this._render();
  }

  /**
   * Public accessor used by FilesView for context-menu Paste.
   */
  getClipboard() {
    return {
      mode: this._mode,
      items: [...this._items],
    };
  }

  _render() {
    if (!this._container) return;

    if (!this._items || this._items.length === 0) {
      this._container.style.display = 'none';
      return;
    }

    this._container.style.display = 'flex';

    const modeLabel =
      this._mode === 'copy'
        ? 'Copy'
        : this._mode === 'link'
          ? 'Link'
          : 'Move';
    if (this._label) {
      this._label.textContent =
        `${modeLabel} ${this._items.length} item${this._items.length > 1 ? 's' : ''} ready`;
    }

    if (this._pasteBtn) {
      if (this._mode === 'link') {
        this._pasteBtn.textContent = 'Create links here';
        this._pasteBtn.title = 'Create shortcuts in the current folder';
      } else {
        this._pasteBtn.textContent = 'Paste here';
        this._pasteBtn.title = 'Paste into this folder';
      }
    }

    if (this._itemsEl) {
      this._itemsEl.innerHTML = '';
      this._items.forEach((fullPath, index) => {
        const base = (fullPath || '')
          .split('/')
          .filter(Boolean)
          .pop() || fullPath || '…';

        const chip = document.createElement('span');
        chip.className = 'chip';
        chip.title = fullPath;
        chip.textContent = base;

        const removeBtn = document.createElement('button');
        removeBtn.className = 'chip-remove';
        removeBtn.textContent = '×';
        removeBtn.title = 'Remove from clipboard';
        removeBtn.addEventListener('click', (evt) => {
          evt.stopPropagation();
          this._removeItemAt(index);
        });

        chip.appendChild(removeBtn);
        this._itemsEl.appendChild(chip);
      });
    }
  }

  _removeItemAt(index) {
    if (index < 0 || index >= this._items.length) return;
    this._items.splice(index, 1);
    if (this._items.length === 0) {
      this._mode = '';
    }
    this._render();
  }

  async _handlePasteHere() {
    if (!this._items || this._items.length === 0) {
      displayMessage('Nothing to paste.', 2500);
      return;
    }

    const destDir = (this._fileExplorer && this._fileExplorer._path) || '/';

    if (this._mode === 'link') {
      await this._handleLinkHere(destDir);
      return;
    }

    const isCopy = (this._mode === 'copy');

    try {
      if (isCopy) {
        await copyFiles(destDir, this._items);
      } else {
        await moveFiles(destDir, this._items);
      }

      // refresh the view of that directory
      Backend.eventHub.publish('reload_dir_event', destDir, true);

      // clear clipboard & selection after a successful operation
      this.clearClipboard();
      this._fileExplorer?.clearSelections?.();
    } catch (err) {
      console.error('Paste failed', err);
      displayError(err?.message || 'Paste failed.', 4000);
    }
  }


  async _handleLinkHere(destDir) {
    if (!this._items || this._items.length === 0) {
      displayMessage('Nothing to link.', 2500);
      return;
    }
    const targetDir = destDir || (this._fileExplorer && this._fileExplorer._path) || '/';
    let successCount = 0;

    for (const sourcePath of this._items) {
      if (!sourcePath) continue;
      const fileName = sourcePath.substring(sourcePath.lastIndexOf('/') + 1);
      const linkName = fileName.includes('.')
        ? `${fileName.substring(0, fileName.indexOf('.'))}.lnk`
        : `${fileName}.lnk`;

      try {
        await createLink(targetDir, linkName, sourcePath);
        successCount++;
      } catch (err) {
        console.error(`Failed to create link for ${sourcePath}`, err);
        displayError(`Failed to create link for ${fileName}: ${err?.message || err}`, 3500);
      }
    }

    if (successCount > 0) {
      displayMessage(
        `Created ${successCount} link${successCount > 1 ? 's' : ''} in ${targetDir}.`,
        2500
      );
      Backend.eventHub.publish('reload_dir_event', targetDir, true);
    }
  }
}

customElements.define('globular-papertray', PaperTray);