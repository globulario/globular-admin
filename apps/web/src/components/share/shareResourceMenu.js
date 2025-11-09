// src/widgets/shareResourceMenu.js — refactored to new wizard API (no globule deps)

import { ShareResourceWizard } from "./shareResourceWizard"
import '@polymer/iron-icon/iron-icon.js'
import '@polymer/iron-icons/social-icons.js'

/**
 * Tiny share icon that launches the ShareResourceWizard.
 */
export class ShareResourceMenu extends HTMLElement {
  /** @type {HTMLElement|null} */
  _view = null
  /** @type {any[]} */
  _files = []

  // DOM
  _shareResourceButton = null

  constructor(view) {
    super()
    this.attachShadow({ mode: 'open' })
    this._view = view || null
  }

  connectedCallback() {
    this._render()
    this._refs()
    this._bind()
  }

  // ------------------------ public API ------------------------
  /** @param {any[]} files */
  setFiles(files) {
    this._files = Array.isArray(files) ? files : []
  }

  /** @param {HTMLElement} view */
  setView(view) {
    this._view = view || null
  }

  // ------------------------ internals -------------------------
  _render() {
    this.shadowRoot.innerHTML = `
      <style>
        :host { display:inline-flex; }
        #container {
          display: inline-flex;
          align-items: center;
          justify-content: center;
        }
        #share-resource-btn {
          height: 18px; width: 18px;
          color: var(--primary-text-color);
        }
        #share-resource-btn:hover {
          cursor: pointer;
          color: var(--primary-color);
        }
      </style>
      <div id="container">
        <iron-icon id="share-resource-btn" icon="social:share" title="Share Resource"></iron-icon>
      </div>
    `
  }

  _refs() {
    this._shareResourceButton = this.shadowRoot.querySelector('#share-resource-btn')
  }

  _bind() {
    this._shareResourceButton?.addEventListener('click', (e) => this._onClick(e))
  }

  _onClick(evt) {
    evt.stopPropagation()

    let wizard
    // Preferred: no-arg ctor with setters
    try {
      wizard = new ShareResourceWizard()
      if (typeof wizard.setFiles === 'function') wizard.setFiles(this._files)
      if (typeof wizard.setView === 'function') wizard.setView(this._view)
    } catch (_) {
      // Legacy fallback: constructor(files, view)
      wizard = new ShareResourceWizard(this._files, this._view)
    }

    // Show the wizard (prefer .show(); else append to DOM)
    if (typeof wizard.show === 'function') {
      wizard.show()
    } else {
      // Minimal fallback if .show() is not implemented
      document.body.appendChild(wizard)
    }
  }
}

customElements.define('globular-share-resource-menu', ShareResourceMenu)
