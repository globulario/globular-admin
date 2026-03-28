// src/widgets/sharePanel.js — refactored for new backend + SharedResources API

import { SharedResources } from './sharedResources.js'

// Polymer components

// Subjects picker
import './subjectsView.js' // <globular-subjects-view>

/**
 * Panel to pick a subject (account/group/…) and view resources shared with/by it.
 */
export class SharePanel extends HTMLElement {
  /** @type {any} */
  _account = null
  /** @type {any} */
  _fileExplorer = null

  // DOM refs
  _closeButton = null
  _subjectsView = null
  _shareContentDiv = null

  /** Optional close callback */
  onclose = null

  constructor(account) {
    super()
    this.attachShadow({ mode: 'open' })
    this._account = account || null
  }

  connectedCallback() {
    this._render()
    this._refs()
    this._bind()
    this._wireSubjectsView()
  }

  setFileExplorer(explorer) {
    this._fileExplorer = explorer
  }

  // --------------------------- render ---------------------------
  _render() {
    this.shadowRoot.innerHTML = `
      <style>
        #container {
          background: var(--surface-color);
          font-size: .9rem;
          display: flex;
          height: 100%;
          width: 100%;
          box-sizing: border-box;
        }
        .card-content {
          display: flex;
          flex-direction: column;
          width: 100%;
          height: 100%;
          padding: 0;
        }
        .header-bar {
          display: flex;
          align-items: center;
          padding: 10px 16px;
          border-bottom: 1px solid color-mix(in srgb, var(--palette-divider) 50%, transparent);
          background: var(--surface-color);
          color: var(--primary-text-color);
          flex-shrink: 0;
        }
        .header-bar h1 {
          margin: 0;
          font-size: .95rem;
          font-weight: 600;
          flex: 1;
        }
        .header-bar paper-icon-button {
          color: var(--secondary-text-color);
          opacity: .7;
          transition: opacity .2s, color .2s;
        }
        .header-bar paper-icon-button:hover {
          color: var(--accent-color);
          opacity: 1;
        }
        #share_div {
          display: flex;
          flex: 1;
          overflow: hidden;
        }
        globular-subjects-view {
          border-right: none;
          flex: 0 0 240px;
          min-width: 0;
          height: 100%;
          overflow: hidden;
          background: var(--surface-color);
        }
        #share_content_div {
          display: flex;
          flex: 1;
          min-width: 0;
          padding: 0;
          overflow: hidden;
          background: var(--surface-color);
          color: var(--primary-text-color);
        }
      </style>
      <div id="container">
        <paper-card class="card-content">
          <div class="header-bar">
            <h1>Shared Resources...</h1>
            <paper-icon-button id="close-btn" icon="icons:close" title="Close"></paper-icon-button>
          </div>
          <div id="share_div">
            <globular-subjects-view></globular-subjects-view>
            <div id="share_content_div"><slot></slot></div>
          </div>
        </paper-card>
      </div>
    `
  }

  _refs() {
    this._closeButton = this.shadowRoot.querySelector('#close-btn')
    this._subjectsView = this.shadowRoot.querySelector('globular-subjects-view')
    this._shareContentDiv = this.shadowRoot.querySelector('#share_content_div')
  }

  _bind() {
    this._closeButton?.addEventListener('click', () => this._handleClose())
  }

  _wireSubjectsView() {
    if (!this._subjectsView) return

    this._subjectsView.on_account_click = (_div, account) => {
      this.displaySharedResources(account)
    }
    this._subjectsView.on_group_click = (_div, group) => {
      this.displaySharedResources(group)
    }
    this._subjectsView.on_subjects_ready = (subjects) => {
      const { accounts = [], groups = [], organizations = [] } = subjects || {}
      if (accounts.length > 0) {
        this._subjectsView.selectFirst("account")
      } else if (groups.length > 0) {
        this._subjectsView.selectFirst("group")
      } else if (organizations.length > 0) {
        this._subjectsView.selectFirst("organization")
      }
    }
    // Hook more subject types here if your subjectsView supports them:
    // this._subjectsView.on_application_click = (_d, app) => this.displaySharedResources(app)
    // this._subjectsView.on_organization_click = (_d, org) => this.displaySharedResources(org)
    // this._subjectsView.on_peer_click = (_d, peer) => this.displaySharedResources(peer)
  }

  // --------------------------- handlers ---------------------------
  _handleClose() {
    this.remove()
    if (typeof this.onclose === 'function') this.onclose()
  }

  /**
   * Mount a SharedResources element for the selected subject.
   * (Matches the refactored SharedResources API: no-arg ctor + .subject setter)
   */
  displaySharedResources(subject) {
    this._shareContentDiv.innerHTML = ''
    const el = new SharedResources()
    el.style.width = '100%'
    el.style.height = '100%'
    if (this._fileExplorer)
      el.setFileExplorer?.(this._fileExplorer)
    el.subject = subject
    this._shareContentDiv.appendChild(el)
  }
}

customElements.define('globular-share-panel', SharePanel)