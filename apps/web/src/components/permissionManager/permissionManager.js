// src/widgets/permissions_manager.js — refactored to the new backend (JS)

import { displayError, displayMessage, displaySuccess } from "../../backend/ui/notify"

// New RBAC wrapper (adjust path if different in your repo)
import { getResourcePermissions, setResourcePermissions } from "../../backend/rbac/permissions"

// Still using proto shapes for UI panels
import { Permission, Permissions } from "globular-web-client/rbac/rbac_pb"
import { permissionsProtoToVM, permissionsVMToProto } from "./permissionsUtils.js"

import  "./permissionPanel.js"
import {PermissionsViewer} from "./permissionsViewer.js"

// Polymer deps
import '@polymer/paper-icon-button/paper-icon-button.js'
import '@polymer/iron-collapse/iron-collapse.js'
import '@polymer/iron-icon/iron-icon.js'
import '@polymer/paper-ripple/paper-ripple.js'
import '@polymer/paper-radio-group/paper-radio-group.js'
import '@polymer/paper-radio-button/paper-radio-button.js'
import '@polymer/paper-card/paper-card.js'
import { PermissionPanel } from "./permissionPanel.js"

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
    this._ownerSummary = null
    this._allowedSummary = null
    this._deniedSummary = null
  }

  _refreshSectionSummaries() {
    const summarizeSlot = (slot) => {
      if (!slot) return ""
      const panels = slot.assignedElements({ flatten: true })
      return panels.map(panel => panel.describeSummary?.() || "").filter(Boolean).join(" | ")
    }

    if (this._ownerSummary) this._ownerSummary.textContent = summarizeSlot(this._ownerSlot)
    if (this._allowedSummary) this._allowedSummary.textContent = summarizeSlot(this._allowedSlot)
    if (this._deniedSummary) this._deniedSummary.textContent = summarizeSlot(this._deniedSlot)
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
    this._refreshSectionSummaries()
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

        .permissions-section {
          padding-right: 24px;
          margin-bottom: 18px;
          border: 1px solid var(--palette-divider);
          border-radius: 10px;
          background: var(--surface-raised-color, rgba(255,255,255,0.02));
        }
        .permissions-section .title {
          margin-top: 0;
          gap: 8px;
          padding: 10px 14px;
          border-bottom: 1px solid var(--palette-divider);
          align-items: center;
        }
        .section-summary {
          font-size: 0.9rem;
          color: var(--secondary-text-color);
          white-space: nowrap;
        }
        .permissions-section iron-collapse {
          padding-left: 20px;
          border-left: 2px solid var(--palette-divider);
          margin: 0 14px 14px;
          border-bottom: none;
        }

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
            <paper-icon-button id="owner-collapse-btn" icon="unfold-more"></paper-icon-button>
            <span style="flex:1;">Owner(s)</span>
            <span class="section-summary" id="owner-summary"></span>
          </div>
          <iron-collapse id="owner">
            <slot name="owner"></slot>
          </iron-collapse>
        </div>

        <div class="permissions-section">
          <div class="title">
            <paper-icon-button id="allowed-collapse-btn" icon="unfold-more"></paper-icon-button>
            <span style="flex:1;">Allowed(s)</span>
            <span class="section-summary" id="allowed-summary"></span>
            <paper-icon-button id="add-allowed-btn" icon="icons:add"></paper-icon-button>
          </div>
          <iron-collapse id="allowed">
            <slot name="allowed"></slot>
          </iron-collapse>
        </div>

        <div class="permissions-section">
          <div class="title">
            <paper-icon-button id="denied-collapse-btn" icon="unfold-more"></paper-icon-button>
            <span style="flex:1;">Denied(s)</span>
            <span class="section-summary" id="denied-summary"></span>
            <paper-icon-button id="add-denied-btn" icon="icons:add"></paper-icon-button>
          </div>
          <iron-collapse id="denied">
            <slot name="denied"></slot>
          </iron-collapse>
        </div>
      </div>
    `
  }

  _getDomReferences() {
    this._container = this.shadowRoot.querySelector("#container")
    this._pathDiv = this.shadowRoot.querySelector("#path")
    this._closeButton = this.shadowRoot.querySelector("#close-button")
    this._ownersCollapsePanel = this.shadowRoot.querySelector("#owner")
    this._ownersCollapseBtn = this.shadowRoot.querySelector("#owner-collapse-btn")
    this._allowedCollapsePanel = this.shadowRoot.querySelector("#allowed")
    this._allowedCollapseBtn = this.shadowRoot.querySelector("#allowed-collapse-btn")
    this._addAllowedBtn = this.shadowRoot.querySelector("#add-allowed-btn")
    this._deniedCollapsePanel = this.shadowRoot.querySelector("#denied")
    this._deniedCollapseBtn = this.shadowRoot.querySelector("#denied-collapse-btn")
    this._addDeniedBtn = this.shadowRoot.querySelector("#add-denied-btn")
    this._ownerSummary = this.shadowRoot.querySelector("#owner-summary")
    this._allowedSummary = this.shadowRoot.querySelector("#allowed-summary")
    this._deniedSummary = this.shadowRoot.querySelector("#denied-summary")
    this._ownerSlot = this.shadowRoot.querySelector('slot[name="owner"]')
    this._allowedSlot = this.shadowRoot.querySelector('slot[name="allowed"]')
    this._deniedSlot = this.shadowRoot.querySelector('slot[name="denied"]')
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

    this._ownerSlot?.addEventListener('slotchange', () => this._refreshSectionSummaries())
    this._allowedSlot?.addEventListener('slotchange', () => this._refreshSectionSummaries())
    this._deniedSlot?.addEventListener('slotchange', () => this._refreshSectionSummaries())
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
      this.appendChild(panel)
      if (!this._allowedCollapsePanel?.opened) this._allowedCollapsePanel?.toggle()
    } else {
      this._permissions.getDeniedList().push(permission)
      panel.slot = "denied"
      this.appendChild(panel)
      if (!this._deniedCollapsePanel?.opened) this._deniedCollapsePanel?.toggle()
    }

  }

  // ---------------- Backend calls via new wrapper ----------------
  async _savePermissions(callback = null) {
    try {
      if (!this._permissions || !this._path) {
        displayError("Permissions object or path not set.", 3000)
        if (callback) callback()
        return
      }

      this._removeEmptyPermissions()

      if (!this._permissions.getResourceType()) this._permissions.setResourceType("file")
      if (!this._permissions.getResourceType()) this._permissions.setResourceType("file")

      await setResourcePermissions(this._permissions)

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
    const permissionsVM = permissionsProtoToVM(this._permissions)
    this._permissionsViewer.slot = "permission-viewer"
    this._permissionsViewer.permissionManager = this
    this._permissionsViewer.setPermissions(permissionsVM)
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
      panel.setPermission(p)
      panel.slot = "allowed"
      this.appendChild(panel)
    })

    // Denied
    this._permissions.getDeniedList().forEach(p => {
      const panel = new PermissionPanel(this)
      panel.id = `permission_${p.getName()}_denied_panel`
      panel.setPermission(p)
      panel.slot = "denied"
      this.appendChild(panel)
    })

    this._refreshSectionSummaries()
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

  _permissionHasSubjects(permission) {
    if (!permission) return false
    const total =
      (permission.getAccountsList?.().length || 0) +
      (permission.getGroupsList?.().length || 0) +
      (permission.getApplicationsList?.().length || 0) +
      (permission.getOrganizationsList?.().length || 0) +
      (permission.getPeersList?.().length || 0)
    return total > 0
  }

  _removeEmptyPermissions() {
    const allowed = this._permissions.getAllowedList?.() || []
    const cleanedAllowed = allowed.filter((perm) => this._permissionHasSubjects(perm))
    if (this._permissions.setAllowedList) {
      this._permissions.setAllowedList(cleanedAllowed)
    }

    const denied = this._permissions.getDeniedList?.() || []
    const cleanedDenied = denied.filter((perm) => this._permissionHasSubjects(perm))
    if (this._permissions.setDeniedList) {
      this._permissions.setDeniedList(cleanedDenied)
    }
  }

  async updatePermissionsFromViewer(vm) {
    if (!vm) return
    const proto = permissionsVMToProto(vm)
    if (!proto.getPath?.()) proto.setPath?.(this._path || "")
    const existingType =
      proto.getResourcetype?.() ||
      proto.getResourceType?.() ||
      this._permissions?.getResourcetype?.() ||
      this._permissions?.getResourceType?.() ||
      vm.resourceType ||
      "file"
    proto.setResourcetype?.(existingType)
    this._permissions = proto
    await this._savePermissions()
  }
}

customElements.define('globular-permissions-manager', PermissionsManager)
