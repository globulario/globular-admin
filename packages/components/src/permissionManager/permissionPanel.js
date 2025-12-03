// src/widgets/permissionPanel.js — refactored to new backend (JS)

import { randomUUID } from "../utility.js"

// New backend wrappers (adjust paths if your repo differs)
import { listAccounts } from "@globular/backend"
import { listGroups } from "@globular/backend"
import { listOrganizations } from "@globular/backend"
import { listApplications } from "@globular/backend"; // NEW apps accessor (ApplicationVM[])
import { listPeers } from "@globular/backend"

import { displayError } from "@globular/backend"

// UI deps
import '@polymer/iron-collapse/iron-collapse.js'
import '@polymer/paper-icon-button/paper-icon-button.js'
import '@polymer/iron-icon/iron-icon.js'
import '@polymer/paper-ripple/paper-ripple.js'
import '@polymer/paper-card/paper-card.js'

// Specific SearchableList types
import {
  SearchableGroupList,
  SearchableAccountList,
  SearchableApplicationList,
  SearchablePeerList,
  SearchableOrganizationList
} from "./list.js"

// ---------- tiny access helpers to work with either proto objects or VMs ----------
const callIf = (o, m) => (o && typeof o[m] === "function") ? o[m]() : undefined
const has = (o, k) => Object.prototype.hasOwnProperty.call(o || {}, k)

function getId(o) {
  // common: account/group/org/app have getId()/id; peers often don't (use mac)
  return callIf(o, "getId") ?? o?.id ?? ""
}
function getDomain(o) {
  return callIf(o, "getDomain") ?? o?.domain ?? ""
}
function getMac(o) {
  return callIf(o, "getMac") ?? o?.mac ?? ""
}

// For peers, use MAC as the "id" portion
function getPeerKey(o) {
  const mac = getMac(o)
  const dom = getDomain(o)
  return dom ? `${mac}@${dom}` : mac
}

// Compose a fully-qualified ID consistently
function fqid(id, domain) {
  return domain ? `${id}@${domain}` : id
}

// Safe “includes” for string arrays
function hasId(list, id, domain) {
  const a = fqid(id, domain)
  return list.includes(a) || list.includes(id) // accept both raw and fq forms
}

// =====================================================================================

/**
 * Represents a panel for managing a specific Permission entry
 * (e.g., an "allowed" or "denied" permission). It renders collapsible sections
 * for Accounts, Groups, Applications, Organizations, and Peers.
 */
export class PermissionPanel extends HTMLElement {
  constructor(permissionManager) {
    super()
    this.attachShadow({ mode: 'open' })

    // External references
    this._permissionManager = permissionManager

    // State
    this._permission = null
    this._hideTitle = false

    // DOM refs
    this._panelTitleDiv = null
    this._membersContainer = null

    // Render base UI
    this._renderInitialStructure()
    this._getDomReferences()
  }

  describeSummary() {
    if (!this.shadowRoot) return ""
    const sections = this.shadowRoot.querySelectorAll('.collapsible-section .collapsible-header span')
    if (!sections.length) return ""
    const name = this._permission?.getName?.() ?? this._permission?.name ?? ""
    const counts = Array.from(sections)
      .map(span => span.textContent || "")
      .filter(text => !/\(\s*0\s*\)/.test(text))
    if (!counts.length) return ""
    return `${name} ${counts.join(', ')}`
  }

  connectedCallback() {
    // population happens in setPermission()
  }

  // --------------------------------------------------------------------------- UI base
  _renderInitialStructure() {
    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: block;
          width: 100%;
        }
        .title {
          flex-grow: 1;
          font-size: 1.2rem;
          font-weight: 500;
          color: var(--primary-text-color);
          border-color: var(--palette-divider);
          padding-bottom: 5px;
          margin-bottom: 5px;
        }
        .members { display: flex; flex-direction: column; width: 100%; gap: 6px; }
        .collapsible-section {
          padding-left: 24px;
          width: 100%;
          box-sizing: border-box;
          border-left: 2px solid var(--palette-divider);
          margin-left: 6px;
        }
        .collapsible-header {
          display:flex; align-items:center; padding:5px 0; cursor:pointer;
        }
        .collapsible-header iron-icon {
          margin-right: 8px; --iron-icon-fill-color: var(--primary-text-color);
        }
        .collapsible-header span { flex-grow: 1; font-weight: 400; font-size: 1rem; }
        iron-collapse { margin: 5px; }

      </style>
      <div>
        <div class="title"></div>
        <div class="members"></div>
      </div>
    `
  }

  _getDomReferences() {
    this._panelTitleDiv = this.shadowRoot.querySelector(".title")
    this._membersContainer = this.shadowRoot.querySelector(".members")
  }

  // ------------------------------------------------------------------ public API
  /**
   * Sets the permission and (re)renders the panel.
   * @param {any} permission proto Permission-like object
   * @param {boolean} [hideTitle=false]
   */
  setPermission(permission, hideTitle = false) {
    this._permission = permission
    this._hideTitle = hideTitle

    if (this._hideTitle) {
      this._panelTitleDiv.style.display = "none"
    } else {
      this._panelTitleDiv.style.display = ""
      this._panelTitleDiv.textContent = permission.getName?.() ?? permission.name ?? ""
    }

    // Clear existing members
    this._membersContainer.innerHTML = ""

    // Build each entity section
    this._setEntitiesPermissions(
      "Accounts",
      this._permission.getAccountsList?.() ?? [],
      this._permission.setAccountsList?.bind(this._permission),
      SearchableAccountList,
      // ID getter for compare/add/remove
      (item) => getId(item),
      (item) => getDomain(item)
    )

    this._setEntitiesPermissions(
      "Groups",
      this._permission.getGroupsList?.() ?? [],
      this._permission.setGroupsList?.bind(this._permission),
      SearchableGroupList,
      (item) => getId(item),
      (item) => getDomain(item)
    )

    this._setEntitiesPermissions(
      "Applications",
      this._permission.getApplicationsList?.() ?? [],
      this._permission.setApplicationsList?.bind(this._permission),
      SearchableApplicationList,
      (item) => getId(item),
      (item) => getDomain(item)
    )

    this._setEntitiesPermissions(
      "Organizations",
      this._permission.getOrganizationsList?.() ?? [],
      this._permission.setOrganizationsList?.bind(this._permission),
      SearchableOrganizationList,
      (item) => getId(item),
      (item) => getDomain(item)
    )

    this._setEntitiesPermissions(
      "Peers",
      this._permission.getPeersList?.() ?? [],
      this._permission.setPeersList?.bind(this._permission),
      SearchablePeerList,
      // Peers: use MAC as id part
      (item) => getMac(item),
      (item) => getDomain(item),
      true // peers flag
    )
  }

  // ----------------------------------------------------------- sections & data plumbing
  _createCollapsibleSection(title, count = 0) {
    const uuid = `_collapsible_${randomUUID()}`
    const html = `
      <div class="collapsible-section">
        <div class="collapsible-header">
          <paper-icon-button id="${uuid}-btn" icon="unfold-less"></paper-icon-button>
          <span>${title} (${count})</span>
        </div>
        <iron-collapse id="${uuid}-collapse-panel"></iron-collapse>
      </div>
    `
    this._membersContainer.appendChild(document.createRange().createContextualFragment(html))

    const contentPanel = this.shadowRoot.querySelector(`#${uuid}-collapse-panel`)
    const toggleButton = this.shadowRoot.querySelector(`#${uuid}-btn`)
    const headerLabel = toggleButton?.parentElement?.querySelector('span')

    if (toggleButton && contentPanel) {
      contentPanel.opened = false
      toggleButton.icon = "unfold-more"
      toggleButton.addEventListener('click', () => {
        contentPanel.toggle()
        toggleButton.icon = contentPanel.opened ? "unfold-less" : "unfold-more"
      })
    }
    return { panel: contentPanel, headerLabel }
  }

  /**
   * Generic section binder for an entity type.
   * @param {string} title
   * @param {string[]} entityIdsInPermission current IDs stored in permission (string fqids)
   * @param {Function} permissionListSetter setter on permission (e.g., setAccountsList)
   * @param {Class} SearchableListClass list UI class
   * @param {(item:any)=>string} idGetter returns the "id" part
   * @param {(item:any)=>string} domainGetter returns domain
   * @param {boolean} isPeers whether the type is peers (uses MAC-based key)
   */
  async _setEntitiesPermissions(title, entityIdsInPermission, permissionListSetter, SearchableListClass, idGetter, domainGetter, isPeers = false) {
    const initialCount = Array.isArray(entityIdsInPermission) ? entityIdsInPermission.length : 0
    const { panel, headerLabel } = this._createCollapsibleSection(title, initialCount)
    const listContainer = document.createElement('div')
    panel.appendChild(listContainer)

    try {
      // Fetch all entities (unwrap different shapes your wrappers may return)
      let all = []
      if (SearchableListClass === SearchableAccountList) {
        const { items = [] } = await (listAccounts({ pageSize: 1000 }) || {})
        all = items
      } else if (SearchableListClass === SearchableGroupList) {
        const { items = [] } = await (listGroups({ pageSize: 1000 }) || {})
        all = items
      } else if (SearchableListClass === SearchableOrganizationList) {
        const { items = [] } = await (listOrganizations({ pageSize: 1000 }) || {})
        all = items
      } else if (SearchableListClass === SearchableApplicationList) {
        const apps = await (listApplications() || [])
        all = Array.isArray(apps) ? apps : (apps.items || [])
      } else if (SearchableListClass === SearchablePeerList) {
        const peers = await (listPeers() || [])
        all = Array.isArray(peers) ? peers : (peers.items || [])
      } else {
        throw new Error(`Unknown SearchableListClass: ${SearchableListClass?.name || '(anonymous)'}`)
      }

      // Build the current list objects from IDs stored in permission
      const current = all.filter(entity => {
        const id = idGetter(entity)
        const dom = domainGetter(entity)
        if (isPeers) {
          const key = getPeerKey(entity) // mac@domain
          return entityIdsInPermission.includes(key) || hasId(entityIdsInPermission, id, dom)
        }
        return hasId(entityIdsInPermission, id, dom)
      })

      let searchableList = null
      const refreshHeaderCount = () => {
        if (!headerLabel || !searchableList) return
        const currentCount = Array.isArray(searchableList.list) ? searchableList.list.length : 0
        headerLabel.textContent = `${title} (${currentCount})`
        this._permissionManager?._refreshSectionSummaries?.()
      }

      // Create the embedded searchable list
      searchableList = new SearchableListClass(
        title,
        current,
        // ondelete
        (itemToRemove) => {
          const id = idGetter(itemToRemove)
          const dom = domainGetter(itemToRemove)
          const fq = isPeers ? getPeerKey(itemToRemove) : fqid(id, dom)

          const next = (entityIdsInPermission || []).filter(x => x !== fq && x !== id)
          if (typeof permissionListSetter === 'function') permissionListSetter(next)

          // Save via manager (support either public or “private” save)
          const mgr = this._permissionManager
          ;(mgr?._savePermissions || mgr?.savePermissions)?.call(mgr)
          refreshHeaderCount()
        },
        // onadd
        (itemToAdd) => {
          const id = idGetter(itemToAdd)
          const dom = domainGetter(itemToAdd)
          const fq = isPeers ? getPeerKey(itemToAdd) : fqid(id, dom)

          const next = Array.from(entityIdsInPermission || [])
          if (!next.includes(fq) && !next.includes(id)) next.push(fq)
          if (typeof permissionListSetter === 'function') permissionListSetter(next)

          const mgr = this._permissionManager
          ;(mgr?._savePermissions || mgr?.savePermissions)?.call(mgr)
          refreshHeaderCount()
        }
      )

      // Hide inner list’s own title to avoid redundancy
      searchableList.hideTitle?.()
      listContainer.appendChild(searchableList)
      refreshHeaderCount()
    } catch (err) {
      console.error(err)
      displayError(`Failed to load ${title}: ${err?.message || err}`, 3000)
      listContainer.innerHTML = `<p style="color:var(--palette-error-main)">Failed to load ${title}.</p>`
    }
  }
}

customElements.define('globular-permission-panel', PermissionPanel)