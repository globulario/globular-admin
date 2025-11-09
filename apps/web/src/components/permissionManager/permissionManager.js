// src/widgets/permissions_manager.js — refactored to the new backend (JS)

import { displayError, displayMessage, displaySuccess } from "../../backend/ui/notify"

// New RBAC wrapper (adjust path if different in your repo)
import { getResourcePermissions, setResourcePermissions } from "../../backend/rbac/permissions"

// Still using proto shapes for UI panels
import { Permission, Permissions } from "globular-web-client/rbac/rbac_pb"

import { PermissionPanel } from "./permissionPanel.js"
import { PermissionsViewer } from "./permissionsViewer.js"

// Polymer deps
import '@polymer/paper-icon-button/paper-icon-button.js'
import '@polymer/iron-collapse/iron-collapse.js'
import '@polymer/iron-icon/iron-icon.js'
import '@polymer/paper-ripple/paper-ripple.js'
import '@polymer/paper-radio-group/paper-radio-group.js'
import '@polymer/paper-radio-button/paper-radio-button.js'
import '@polymer/paper-card/paper-card.js'

/**
 * Manages and displays resource permissions (owners, allowed, denied).
 * Backend-agnostic: relies on new RBAC wrapper functions.
 */
export class PermissionsManager extends HTMLElement {
  constructor() {
    super()
    this.attachShadow({ mode: 'open' })

    // State
    this._permissions = null
    this._path = ""
    this._permissionsNames = ["read", "write", "delete"]
    this._onclose = null

    // DOM refs
    this._container = null
    this._pathDiv = null
    this._closeButton = null
    this._ownersCollapseBtn = null
    this._ownersCollapsePanel = null
    this._allowedCollapseBtn = null
    this._allowedCollapsePanel = null
    this._deniedCollapseBtn = null
    this._deniedCollapsePanel = null
    this._addDeniedBtn = null
    this._addAllowedBtn = null
    this._permissionsViewer = null
  }

  connectedCallback() {
    this._renderInitialStructure()
    this._getDomReferences()
    this._bindEventListeners()
  }

  // ---------------- Public API ----------------
  set path(path) {
    if (this._path !== path) {
      this._path = path
      this._fetchAndSetPermissions(path)
    }
  }
  get path() { return this._path }

  set permissions(permissions) {
    this._permissions = permissions || new Permissions()
    this._renderPermissionsContent()
  }

  set resourceType(resourceType) {
    if (this._permissions) this._permissions.setResourceType(resourceType)
  }

  set onclose(cb) {
    this._onclose = cb
  }

  hideHeader() {
    const header = this.shadowRoot?.querySelector("#header")
    if (header) header.style.display = "none"
  }

  showHeader() {
    const header = this.shadowRoot?.querySelector("#header")
    if (header) header.style.display = "flex"
  }

  // ---------------- Private: render & events ----------------
  _renderInitialStructure() {
    this.shadowRoot.innerHTML = `
      <style>
        #container {
          display: flex; flex-direction: column; padding: 8px;
          background-color: var(--surface-color); color: var(--primary-text-color);
          user-select: none; max-height: calc(100vh - 80px); overflow-y: auto;
        }
        #header {
          display:flex; align-items:center; padding-bottom:10px;
          border-bottom:2px solid var(--palette-divider); margin-bottom:10px;
        }
        .title { display:flex; align-items:center; flex-grow:1; font-weight:500; color:var(--primary-text-color); line-height:20px; }
        .title iron-icon { margin-right:8px; --iron-icon-fill-color: var(--primary-text-color); }

        .permissions-section { padding-right: 40px; }
        .permissions-section .title { margin-top: 15px; }

        iron-collapse {
          padding: 10px;
          border-bottom: 1px solid var(--palette-action-disabled);
        }
        iron-collapse:last-of-type { border-bottom: none; }

        paper-icon-button { color: var(--primary-text-color); }
        paper-icon-button:hover { cursor: pointer; color: var(--primary-color); }

        #add-permission-panel {
          position: absolute; right: 20px; top: 50px; z-index: 100;
          background-color: var(--surface-color); color: var(--primary-text-color);
          box-shadow: var(--shadow-elevation-4dp); border-radius: 8px; overflow: hidden;
          padding: 10px; display: flex; flex-direction: column; min-width: 200px;
        }
        #add-permission-panel .panel-header {
          display:flex; align-items:center; padding-bottom:5px; border-bottom:1px solid var(--palette-divider); margin-bottom:10px;
        }
        #add-permission-panel .panel-header > div { flex-grow: 1; font-weight: 500; }
        #add-permission-panel paper-radio-group {
          display:flex; flex-direction:column; gap:8px; padding:5px 0;
        }
        #add-permission-panel paper-radio-button {
          --paper-radio-button-checked-color: var(--primary-color);
          --paper-radio-button-label-color: var(--primary-text-color);
          --paper-radio-button-size: 16px;
        }
      </style>
      <div id="container">
        <div id="header">
          <div id="path" class="title"></div>
          <paper-icon-button id="close-button" icon="icons:close"></paper-icon-button>
        </div>
        <slot name="permission-viewer"></slot>

        <div class="permissions-section">
          <div class="title">
            <paper-icon-button id="owner-collapse-btn" icon="unfold-less"></paper-icon-button>
            Owner(s)
          </div>
          <iron-collapse id="owner" opened>
            <slot name="owner"></slot>
          </iron-collapse>
        </div>

        <div class="permissions-section">
          <div class="title">
            <paper-icon-button id="allowed-collapse-btn" icon="unfold-less"></paper-icon-button>
            Allowed(s)
          </div>
          <paper-icon-button id="add-allowed-btn" icon="icons:add"></paper-icon-button>
          <iron-collapse id="allowed" opened>
            <slot name="allowed"></slot>
          </iron-collapse>
        </div>

        <div class="permissions-section">
          <div class="title">
            <paper-icon-button id="denied-collapse-btn" icon="unfold-less"></paper-icon-button>
            Denied(s)
          </div>
          <paper-icon-button id="add-denied-btn" icon="icons:add"></paper-icon-button>
          <iron-collapse id="denied" opened>
            <slot name="denied"></slot>
          </iron-collapse>
        </div>
      </div>
    `
  }

  _getDomReferences() {
    const $ = (sel) => this.shadowRoot.querySelector(sel)

    this._container = $("#container")
    this._pathDiv = $("#path")
    this._closeButton = $("#close-button")
    this._ownersCollapsePanel = $("#owner")
    this._ownersCollapseBtn = $("#owner-collapse-btn")
    this._allowedCollapsePanel = $("#allowed")
    this._allowedCollapseBtn = $("#allowed-collapse-btn")
    this._addAllowedBtn = $("#add-allowed-btn")
    this._deniedCollapsePanel = $("#denied")
    this._deniedCollapseBtn = $("#denied-collapse-btn")
    this._addDeniedBtn = $("#add-denied-btn")
  }

  _bindEventListeners() {
    this._closeButton?.addEventListener('click', this._handleCloseClick.bind(this))

    this._ownersCollapseBtn?.addEventListener('click',
      this._handleCollapseToggle.bind(this, this._ownersCollapsePanel, this._ownersCollapseBtn))
    this._allowedCollapseBtn?.addEventListener('click',
      this._handleCollapseToggle.bind(this, this._allowedCollapsePanel, this._allowedCollapseBtn))
    this._deniedCollapseBtn?.addEventListener('click',
      this._handleCollapseToggle.bind(this, this._deniedCollapsePanel, this._deniedCollapseBtn))

    this._addAllowedBtn?.addEventListener('click',
      this._handleAddPermissionClick.bind(this, this._addAllowedBtn, "allowed"))
    this._addDeniedBtn?.addEventListener('click',
      this._handleAddPermissionClick.bind(this, this._addDeniedBtn, "denied"))
  }

  _handleCloseClick() {
    if (this._onclose) this._onclose()
    this.parentNode?.removeChild(this)
  }

  _handleCollapseToggle(panel, button) {
    if (!panel || !button) return
    panel.toggle()
    button.icon = panel.opened ? "unfold-less" : "unfold-more"
  }

  _handleAddPermissionClick(parentButton, type) {
    if (!parentButton) return
    const dialogId = "add-permission-panel"
    let dialog = parentButton.parentElement?.querySelector(`#${dialogId}`)
    if (dialog) return

    const html = `
      <paper-card id="${dialogId}">
        <div class="panel-header">
          <div>Add Permission</div>
          <paper-icon-button id="cancel-btn" icon="icons:close"></paper-icon-button>
        </div>
        <div class="card-content">
          <paper-radio-group id="permission-radio-group"></paper-radio-group>
        </div>
      </paper-card>
    `
    parentButton.parentElement?.appendChild(document.createRange().createContextualFragment(html))
    dialog = parentButton.parentElement?.querySelector(`#${dialogId}`)
    if (!dialog) return

    dialog.style.top = `${parentButton.offsetTop + parentButton.offsetHeight}px`
    dialog.style.right = "20px"

    const radioGroup = dialog.querySelector("#permission-radio-group")
    const cancelBtn = dialog.querySelector("#cancel-btn")

    this._permissionsNames.slice().sort().forEach(pName => {
      const rb = document.createElement("paper-radio-button")
      rb.setAttribute("name", pName)
      rb.value = pName
      rb.textContent = pName
      radioGroup.appendChild(rb)
    })

    radioGroup.addEventListener('iron-select', (evt) => {
      const selectedPermissionName = evt.detail.item.value
      this._createPermission(selectedPermissionName, type)
      dialog?.parentNode?.removeChild(dialog)
    })

    cancelBtn?.addEventListener('click', () => dialog?.parentNode?.removeChild(dialog))
  }

  _createPermission(name, type) {
    this._ensurePermissions()

    const list = type === "allowed"
      ? this._permissions.getAllowedList()
      : this._permissions.getDeniedList()

    if (list.some(p => p.getName() === name)) {
      displayMessage(`Permission "${name}" already exists in ${type} list.`, 3000)
      return
    }

    const panel = new PermissionPanel(this)
    panel.setAttribute("id", `permission_${name}_${type}_panel`)

    const permission = new Permission()
    permission.setName(name)
    panel.setPermission(permission)

    if (type === "allowed") {
      this._permissions.getAllowedList().push(permission)
      panel.slot = "allowed"
      this._allowedCollapsePanel?.appendChild(panel)
      if (!this._allowedCollapsePanel?.opened) this._allowedCollapsePanel?.toggle()
    } else {
      this._permissions.getDeniedList().push(permission)
      panel.slot = "denied"
      this._deniedCollapsePanel?.appendChild(panel)
      if (!this._deniedCollapsePanel?.opened) this._deniedCollapsePanel?.toggle()
    }

    this._savePermissions()
  }

  // ---------------- Backend calls via new wrapper ----------------
  async _savePermissions(callback = null) {
    try {
      if (!this._permissions || !this._path) {
        displayError("Permissions object or path not set.", 3000)
        if (callback) callback()
        return
      }
      if (!this._permissions.getResourceType()) this._permissions.setResourceType("file")

      await setResourcePermissions({
        path: this._path,
        resourceType: this._permissions.getResourceType(),
        permissions: this._permissions,
      })

      displaySuccess("Permissions saved successfully!", 3000)
      await this._fetchAndSetPermissions(this._path)
      if (callback) callback()
    } catch (err) {
      displayError(`Failed to save permissions: ${err?.message || err}`, 4000)
      await this._fetchAndSetPermissions(this._path)
      if (callback) callback()
    }
  }

  async _fetchAndSetPermissions(path) {
    if (!path) return
    if (this._pathDiv) this._pathDiv.textContent = path

    try {
      const rsp = await getResourcePermissions(path)
      const perms = rsp?.getPermissions?.() ?? rsp
      this._permissions = perms instanceof Permissions ? perms : new Permissions()
      if (!(perms instanceof Permissions)) {
        this._permissions.setPath(path)
      }
    } catch (err) {
      this._permissions = new Permissions()
      this._permissions.setPath(path)
      const owner = new Permission()
      owner.setName("owner")
      // setOwners vs setOwner depending on schema
      this._permissions.setOwners?.(owner) || this._permissions.setOwner?.(owner)
      console.warn(`Permissions fetch failed for ${path}:`, err)
    } finally {
      this._renderPermissionsContent()
      if (this._permissions?.getResourceType()) {
        this.setResourceType(this._permissions.getResourceType())
      }
    }
  }

  // ---------------- Render permissions into slots ----------------
  _renderPermissionsContent() {
    this._ensurePermissions()

    // Clear existing slotted content in light DOM
    this.innerHTML = ""

    // Viewer
    if (!this._permissionsViewer) {
      this._permissionsViewer = new PermissionsViewer(this._permissionsNames.concat("owner"))
    }
    this._permissionsViewer.slot = "permission-viewer"
    this._permissionsViewer.setPermissions(this._permissions)
    this._permissionsViewer.permissionManager = this
    this.appendChild(this._permissionsViewer)

    // Owner
    const ownersPanel = new PermissionPanel(this)
    ownersPanel.id = "permission_owners_panel"
    ownersPanel.setPermission(this._permissions.getOwners(), true)
    ownersPanel.slot = "owner"
    this.appendChild(ownersPanel)

    // Allowed
    this._permissions.getAllowedList().forEach(p => {
      const panel = new PermissionPanel(this)
      panel.id = `permission_${p.getName()}_allowed_panel`
      panel.slot = "allowed"
      panel.setPermission(p)
      this.appendChild(panel)
    })

    // Denied
    this._permissions.getDeniedList().forEach(p => {
      const panel = new PermissionPanel(this)
      panel.id = `permission_${p.getName()}_denied_panel`
      panel.slot = "denied"
      panel.setPermission(p)
      this.appendChild(panel)
    })
  }

  // ---------------- Helpers ----------------
  _ensurePermissions() {
    if (!this._permissions) {
      this._permissions = new Permissions()
      const owner = new Permission()
      owner.setName("owner")
      this._permissions.setOwners?.(owner) || this._permissions.setOwner?.(owner)
    }
  }
}

customElements.define('globular-permissions-manager', PermissionsManager)
