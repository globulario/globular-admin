// src/widgets/resources_permissions.js — new-backend (JS)

import getUuidByString from "uuid-by-string"
import { Backend } from "@globular/backend"
import { displayError, displayMessage } from "@globular/backend"

// Only used to publish tiny payloads on eventHub
import { Permissions } from "globular-web-client/rbac/rbac_pb"

// ---- New backend wrappers ----
import {
  listResourcePermissionsByType,
  deleteResourcePermissions,
} from "@globular/backend"

// ---- Resource getters (update paths if yours differ) ----
import { listApplications } from "@globular/backend"
import { listGroups } from "@globular/backend"
import { listOrganizations } from "@globular/backend"
import { listRoles } from "@globular/backend"

// Polymer deps
import '@polymer/paper-card/paper-card.js'
import '@polymer/iron-icon/iron-icon.js'
import '@polymer/paper-ripple/paper-ripple.js'
import '@polymer/iron-collapse/iron-collapse.js'

// Local editor/viewer
import { PermissionsManager } from "./permissionsManager.js"

// ======================================================================
// ResourcesPermissionsManager
// ======================================================================
export class ResourcesPermissionsManager extends HTMLElement {
  constructor() {
    super()
    this.attachShadow({ mode: 'open' })
    this._listeners = {} // eventHub UUIDs by topic
  }

  connectedCallback() {
    this._render()
    this._subscribeEvents()
    this._appendAllTypes()
  }

  disconnectedCallback() {
    for (const k in this._listeners) {
      Backend.eventHub.unsubscribe(this._listeners[k])
    }
    this._listeners = {}
  }

  _render() {
    this.shadowRoot.innerHTML = `
      <style>
        #container { display:flex; flex-direction:column; width:100%; box-sizing:border-box; }
      </style>
      <div id="container"><slot></slot></div>
    `
  }

  _subscribeEvents() {
    // delete_resources_permissions_event
    Backend.eventHub.subscribe(
      "delete_resources_permissions_event",
      (uuid) => { this._listeners["delete"] = uuid },
      (bin) => {
        try {
          const p = Permissions.deserializeBinary(bin)
          const el = this.querySelector(`#${p.getResourceType()}-permissions`)
          if (el && typeof el.deletePermissions === "function") {
            el.deletePermissions(p)
          }
        } catch (e) {
          console.warn("delete_resources_permissions_event decode failed:", e)
        }
      },
      false,
      this
    )

    // set_resources_permissions_event
    Backend.eventHub.subscribe(
      "set_resources_permissions_event",
      (uuid) => { this._listeners["set"] = uuid },
      (bin) => {
        try {
          const p = Permissions.deserializeBinary(bin)
          const el = this.querySelector(`#${p.getResourceType()}-permissions`)
          if (el && typeof el.setPermissions === "function") {
            el.setPermissions(p)
          }
        } catch (e) {
          console.warn("set_resources_permissions_event decode failed:", e)
        }
      },
      false,
      this
    )
  }

  _appendAllTypes() {
    const resourceTypes = [
      { name: "application", getter: (path) => fetchApplicationResource(path) },
      { name: "group", getter: (path) => fetchGroupResource(path) },
      { name: "organization", getter: (path) => fetchOrganizationResource(path) },
      { name: "role", getter: (path) => fetchRoleResource(path) },
      { name: "package", getter: (path) => basicResourceFactory(path, "package") },
      { name: "conversation", getter: (path) => basicResourceFactory(path, "conversation") },
      { name: "domain", getter: (path) => basicResourceFactory(path, "domain") },
      { name: "blog", getter: (path) => basicResourceFactory(path, "blog") },
      { name: "webpage", getter: (path) => basicResourceFactory(path, "webpage") },
    ]

    resourceTypes.forEach(t => {
      if (!this.querySelector(`#${t.name}-permissions`)) {
        const cmp = new ResourcesPermissionsType(t.name, t.getter)
        cmp.id = `${t.name}-permissions`
        this.appendChild(cmp)
      }
    })
  }
}
customElements.define('globular-resources-permissions-manager', ResourcesPermissionsManager)


// ======================================================================
// ResourcesPermissionsType
// ======================================================================
export class ResourcesPermissionsType extends HTMLElement {
  constructor(resourceType, getResourceFn) {
    super()
    this.attachShadow({ mode: 'open' })
    this._resourceType = resourceType
    this._getResourceFn = getResourceFn
    this._counterSpan = null
    this._hideButton = null
    this._collapsePanel = null
  }

  connectedCallback() {
    this._render()
    this._refs()
    this._bind()
    this._load()
  }

  _render() {
    this.shadowRoot.innerHTML = `
      <style>
        paper-card {
          background: var(--surface-color);
          color: var(--primary-text-color);
          font-size: 1rem; text-align: left;
          border-radius: 8px; width: 100%;
          box-shadow: var(--shadow-elevation-2dp);
          margin-bottom: 10px;
        }
        .card-content { min-width: 728px; padding: 0; }
        @media (max-width: 800px){ .card-content{ min-width: 580px; } }
        @media (max-width: 600px){ .card-content{ min-width: 380px; } }

        #container{ display:flex; flex-direction:column; align-items:center; border-bottom:1px solid var(--palette-divider); padding-bottom:10px; }
        #container:last-child{ border-bottom:none; }

        .header{
          display:flex; align-items:center; width:100%;
          padding:10px; background: var(--surface-color);
          transition: background .2s ease;
          border-bottom:1px solid var(--palette-divider);
          border-top-left-radius:8px; border-top-right-radius:8px;
        }
        .header:hover{ background: var(--palette-action-hover); cursor:pointer; }
        .header .title{ flex:1; font-weight:500; padding-right:10px; text-transform:capitalize; color: var(--primary-text-color); }
        .header #counter{ font-weight:400; color: var(--secondary-text-color); margin-right:10px; }
        .header paper-icon-button{ --iron-icon-fill-color: var(--primary-text-color); }
        .header paper-icon-button:hover{ color: var(--primary-color); }

        #content{ display:flex; flex-direction:column; margin:10px; }
        iron-collapse{ width:100%; }
        iron-collapse.iron-collapse-opened{ max-height:1000px; transition:max-height .3s ease-in-out; }
        iron-collapse .iron-collapse-closed{ max-height:0; transition:max-height 0s; }
      </style>

      <div id="container">
        <paper-card>
          <div class="card-content">
            <div class="header">
              <span class="title">${this._resourceType}</span>
              <span id="counter">0</span>
              <paper-icon-button id="hide-btn" icon="unfold-less"></paper-icon-button>
            </div>
            <iron-collapse id="collapse-panel" opened>
              <div id="content"><slot></slot></div>
            </iron-collapse>
          </div>
        </paper-card>
      </div>
    `
  }

  _refs() {
    this._counterSpan   = this.shadowRoot.querySelector("#counter")
    this._hideButton    = this.shadowRoot.querySelector("#hide-btn")
    this._collapsePanel = this.shadowRoot.querySelector("#collapse-panel")
  }

  _bind() {
    const header = this.shadowRoot.querySelector(".header")
    const toggle = () => {
      this._collapsePanel.toggle()
      this._hideButton.icon = this._collapsePanel.opened ? "unfold-less" : "unfold-more"
    }
    header?.addEventListener('click', toggle)
    this._hideButton?.addEventListener('click', (e) => { e.stopPropagation(); toggle() })
  }

  async _load() {
    try {
      const list = await this._getPermissionsByType(this._resourceType)
      // Clear previous resource items (light DOM only)
      this.innerHTML = ""

      let count = 0
      for (const p of list) {
        try {
          const res = await this._getResourceFn(p.getPath())
          const cmp = new ResourcePermissions(res)
          cmp.id = `_${getUuidByString(p.getPath())}`
          cmp.dataset.resourceType = this._resourceType
          this.appendChild(cmp)
          count++
        } catch (e) {
          console.warn(`[${this._resourceType}] Missing resource for path ${p.getPath()}:`, e)
          await this._deleteStale(p.getPath(), this._resourceType)
        }
      }
      this._setCount(count)
    } catch (err) {
      displayError(`Failed to load ${this._resourceType} permissions: ${err?.message || err}`, 3000)
      console.error(err)
      this._setCount(0)
    }
  }

  async _getPermissionsByType(resourceType) {
    return await listResourcePermissionsByType(resourceType)
  }

  _setCount(n) {
    if (this._counterSpan) this._counterSpan.textContent = String(n)
  }

  async _deleteStale(path, resourceType) {
    try {
      await deleteResourcePermissions(path, resourceType)
      displayMessage(`Stale ${resourceType} permissions for ${path} removed.`, 2500)
    } catch (e) {
      displayError(`Failed to remove stale ${resourceType} permissions for ${path}: ${e?.message || e}`, 3000)
    }
  }

  // --- called by manager via eventHub
  deletePermissions(p) {
    const id = `_${getUuidByString(p.getPath())}`
    const el = this.querySelector(`#${id}`)
    if (el?.parentNode) {
      el.parentNode.removeChild(el)
      this._setCount(this.childElementCount)
    }
  }

  async setPermissions(p) {
    const id = `_${getUuidByString(p.getPath())}`
    try {
      const res = await this._getResourceFn(p.getPath())
      let el = this.querySelector(`#${id}`)
      if (el) el.parentNode.removeChild(el)
      el = new ResourcePermissions(res)
      el.id = id
      el.dataset.resourceType = this._resourceType
      this.appendChild(el)
      this._setCount(this.childElementCount)
    } catch (e) {
      displayError(`Failed to update ${p.getResourceType()} @ ${p.getPath()}: ${e?.message || e}`, 3000)
      await this._deleteStale(p.getPath(), p.getResourceType())
    }
  }
}
customElements.define('globular-resources-permissions-type', ResourcesPermissionsType)


// ======================================================================
// ResourcePermissions
// ======================================================================
import '@polymer/paper-icon-button/paper-icon-button.js'
import { PermissionsManager as _PM } from "./permissionsManager.js" // ensure definition is loaded

export class ResourcePermissions extends HTMLElement {
  constructor(resource) {
    super()
    this.attachShadow({ mode: 'open' })
    this._resource = resource
    this._infoTogglePanel = null
    this._permissionsTogglePanel = null
    this._infoButton = null
    this._editButton = null
    this._deleteButton = null
  }

  connectedCallback() {
    this._render()
    this._refs()
    this._bind()
    this._appendInfo()
    this._appendEditor()
  }

  _render() {
    this.shadowRoot.innerHTML = `
      <style>
        #container { display:flex; flex-direction:column; align-items:center;
          border-bottom:1px solid var(--palette-divider-light); padding-bottom:5px; }
        #container:last-child { border-bottom:none; }

        .header { display:flex; align-items:center; width:100%;
          padding:8px; background:var(--surface-color); transition: background .2s ease; border-radius:4px; }
        .header:hover { background:var(--palette-action-hover); cursor:pointer; }

        .header iron-icon { padding:5px; color:var(--primary-text-color); }
        .header iron-icon:hover { color:var(--primary-color); }

        .resource-text { flex:1; padding:5px; text-overflow:ellipsis; overflow:hidden; white-space:nowrap; max-width:584px; }

        #content { display:flex; flex-direction:column; margin:10px; background:var(--surface-color); color:var(--primary-text-color); }
        iron-collapse{ width:100%; }
        iron-collapse.iron-collapse-opened{ max-height:1000px; transition:max-height .3s ease-in-out; }
        iron-collapse.iron-collapse-closed{ max-height:0; transition:max-height 0s; }
      </style>

      <div id="container">
        <div class="header">
          <paper-icon-button id="info-btn" icon="icons:info"></paper-icon-button>
          <span class="resource-text">${this._safeHeader()}</span>
          <paper-icon-button id="edit-btn" icon="editor:mode-edit"></paper-icon-button>
          <paper-icon-button id="delete-btn" icon="icons:delete"></paper-icon-button>
        </div>

        <iron-collapse id="info-collapse-panel">
          <div id="content"><slot name="resource-info"></slot></div>
        </iron-collapse>

        <iron-collapse id="permissions-editor-collapse-panel">
          <div id="content"><slot name="resource-permissions-editor"></slot></div>
        </iron-collapse>
      </div>
    `
  }

  _safeHeader() {
    try { if (this._resource?.getHeaderText) return String(this._resource.getHeaderText()) } catch {}
    const name = this._resource?.getName?.() || this._resource?.name || ""
    const path = this._resource?.getPath?.() || this._resource?.path || ""
    return name || path || "(resource)"
  }

  _refs() {
    this._infoTogglePanel = this.shadowRoot.querySelector("#info-collapse-panel")
    this._permissionsTogglePanel = this.shadowRoot.querySelector("#permissions-editor-collapse-panel")
    this._infoButton = this.shadowRoot.querySelector("#info-btn")
    this._editButton = this.shadowRoot.querySelector("#edit-btn")
    this._deleteButton = this.shadowRoot.querySelector("#delete-btn")
  }

  _bind() {
    this._infoButton?.addEventListener('click', (e) => { e.stopPropagation(); this._infoTogglePanel?.toggle() })
    this._editButton?.addEventListener('click', (e) => { e.stopPropagation(); this._permissionsTogglePanel?.toggle() })
    this._deleteButton?.addEventListener('click', () => this._onDelete())
  }

  _appendInfo() {
    if (!this._resource?.getInfo) return
    const info = this._resource.getInfo()
    if (!info) return
    info.slot = "resource-info"

    // Heuristics to set the right property on the info component
    try {
      if ("getAlias" in this._resource) { info.application = this._resource }
      else if ("getCreationTime" in this._resource) { info.conversation = this._resource }
      else if ("getHostname" in this._resource) { info.peer = this._resource }
      else if ("getDomain" in this._resource && "getGroupsList" in this._resource) { info.organization = this._resource }
      else if ("getDomain" in this._resource) { info.domain = this._resource }
      else if ("getKeywordsList" in this._resource && "getType" in this._resource) { info.descriptor = this._resource }
      else if ("getMembersList" in this._resource) { info.group = this._resource }
      else if ("getUuid" in this._resource && "getSubtitle" in this._resource) { info.blogPost = this._resource }
      else if ("getMime" in this._resource) { info.file = this._resource }
      else if ("getPoster" in this._resource && "getCastingList" in this._resource) { info.video = this._resource }
      else if ("getTitle" in this._resource) { info.audio = this._resource }
      else if ("thumbnail" in this._resource) { info.webpage = this._resource }
      else if ("getId" in this._resource && "getDescription" in this._resource) { info.role = this._resource }
    } catch {}
    this.appendChild(info)
  }

  _appendEditor() {
    if (!this._resource?.getPath) return
    const pm = new PermissionsManager()
    pm.hideHeader()
    pm.slot = "resource-permissions-editor"
    this.appendChild(pm)

    // Provide path & type (no globule)
    pm.path = this._resource.getPath()
    const resourceType =
      this._resource.getResourceType?.() ||
      this.dataset.resourceType ||
      "file"
    if (resourceType) pm.setResourceType?.(resourceType)
  }

  async _onDelete() {
    if (!this._resource?.getPath || !this._resource?.getResourceType) {
      displayError("Resource information incomplete for deletion.", 3000)
      return
    }
    const path = this._resource.getPath()
    const rtype = this._resource.getResourceType()
    const title = this._safeHeader()

    const toast = displayMessage(`
      <style>
        #delete-permission-dialog { display:flex; flex-direction:column; align-items:center; }
        #delete-permission-dialog .dialog-actions { display:flex; justify-content:flex-end; gap:10px; width:100%; margin-top:20px; }
      </style>
      <div id="delete-permission-dialog">
        <div>You're about to delete permission for:</div>
        <div><strong>${title}</strong></div>
        <div>Is that what you want to do?</div>
        <div class="dialog-actions">
          <paper-button id="delete-permission-cancel-btn">Cancel</paper-button>
          <paper-button id="delete-permission-ok-btn">Ok</paper-button>
        </div>
      </div>
    `, 60_000)

    const cancelBtn = toast.toastElement.querySelector("#delete-permission-cancel-btn")
    const okBtn = toast.toastElement.querySelector("#delete-permission-ok-btn")

    cancelBtn.addEventListener('click', () => toast.hideToast())
    okBtn.addEventListener('click', async () => {
      toast.hideToast()
      try {
        await deleteResourcePermissions(path, rtype)
        displayMessage("Permission removed successfully!", 2500)

        // Publish compact proto so type components update themselves
        const p = new Permissions()
        p.setPath?.(path)
        p.setResourcetype?.(rtype)
        Backend.eventHub.publish("delete_resources_permissions_event", p.serializeBinary(), false)
      } catch (e) {
        displayError(`Failed to delete permission: ${e?.message || e}`, 3000)
      }
    })
  }
}
customElements.define('globular-resource-permissions', ResourcePermissions)

const RESOURCE_QUERY_LIMIT = 200

const extractItems = (result) => {
  if (Array.isArray(result)) return result
  if (result?.items) return result.items
  return []
}

const splitFqid = (value = "") => {
  const str = String(value || "")
  const at = str.lastIndexOf("@")
  if (at > 0) return { id: str.slice(0, at), domain: str.slice(at + 1) }
  return { id: str, domain: "" }
}

const buildResource = ({ path, resourceType, header, lines = [] }) => {
  return {
    getPath: () => path,
    getResourceType: () => resourceType,
    getHeaderText: () => header || path,
    getInfo: () => {
      const wrapper = document.createElement("div")
      wrapper.style.padding = "10px"
      wrapper.style.display = "flex"
      wrapper.style.flexDirection = "column"
      const title = document.createElement("div")
      title.style.fontWeight = "500"
      title.textContent = header || path
      wrapper.appendChild(title)
      const renderedLines = lines.filter(Boolean)
      if (renderedLines.length === 0) {
        const line = document.createElement("div")
        line.textContent = path
        wrapper.appendChild(line)
      } else {
        renderedLines.forEach((text) => {
          const line = document.createElement("div")
          line.textContent = text
          wrapper.appendChild(line)
        })
      }
      return wrapper
    },
  }
}

const basicResourceFactory = (path, type) =>
  Promise.resolve(buildResource({ path, resourceType: type, header: path, lines: [`Path: ${path}`] }))

async function fetchApplicationResource(path) {
  const { id, domain } = splitFqid(path)
  const query = domain
    ? { $and: [{ $or: [{ _id: id }, { id }, { alias: id }] }, { domain }] }
    : { $or: [{ _id: id }, { id }, { alias: id }, { name: id }] }

  const result = await listApplications({ query, pageSize: RESOURCE_QUERY_LIMIT })
  const items = extractItems(result)
  const match = items.find((app) => {
    const appId = app.id || app.name || ""
    const fq = app.domain ? `${appId}@${app.domain}` : appId
    return fq === path || appId === id || (app.alias && app.alias === id)
  })
  if (!match) throw new Error(`Application ${path} not found`)

  const header = `${match.alias || match.name || match.id || path} ${match.version || ""}`.trim()
  const lines = [
    match.description,
    match.domain ? `Domain: ${match.domain}` : "",
    match.path ? `Path: ${match.path}` : "",
  ]
  return buildResource({ path, resourceType: "application", header, lines })
}

async function fetchGroupResource(path) {
  const { id, domain } = splitFqid(path)
  const query = domain
    ? { $and: [{ $or: [{ _id: id }, { id }, { name: id }] }, { domain }] }
    : { $or: [{ _id: id }, { id }, { name: id }] }

  const result = await listGroups({ query, pageSize: RESOURCE_QUERY_LIMIT })
  const items = extractItems(result)
  const match = items.find((group) => {
    const gid = group.id || group.name || ""
    const fq = group.domain ? `${gid}@${group.domain}` : gid
    return fq === path || gid === id
  })
  if (!match) throw new Error(`Group ${path} not found`)

  const header = match.name || match.id || path
  const lines = [
    match.description,
    match.domain ? `Domain: ${match.domain}` : "",
    match.members ? `Members: ${match.members.length}` : "",
  ]
  return buildResource({ path, resourceType: "group", header, lines })
}

async function fetchOrganizationResource(path) {
  const { id, domain } = splitFqid(path)
  const query = domain
    ? { $and: [{ $or: [{ _id: id }, { id }, { name: id }] }, { domain }] }
    : { $or: [{ _id: id }, { id }, { name: id }] }

  const result = await listOrganizations({ query, pageSize: RESOURCE_QUERY_LIMIT })
  const items = extractItems(result)
  const match = items.find((org) => {
    const oid = org.id || org.name || ""
    const fq = org.domain ? `${oid}@${org.domain}` : oid
    return fq === path || oid === id
  })
  if (!match) throw new Error(`Organization ${path} not found`)

  const header = match.name || match.id || path
  const lines = [
    match.description,
    match.domain ? `Domain: ${match.domain}` : "",
    match.email ? `Email: ${match.email}` : "",
  ]
  return buildResource({ path, resourceType: "organization", header, lines })
}

async function fetchRoleResource(path) {
  const { id, domain } = splitFqid(path)
  const query = domain
    ? { $and: [{ $or: [{ _id: id }, { id }, { name: id }] }, { domain }] }
    : { $or: [{ _id: id }, { id }, { name: id }] }

  const result = await listRoles({ query, pageSize: RESOURCE_QUERY_LIMIT })
  const items = extractItems(result)
  const match = items.find((role) => {
    const rid = role.id || role.name || ""
    const fq = role.domain ? `${rid}@${role.domain}` : rid
    return fq === path || rid === id
  })
  if (!match) throw new Error(`Role ${path} not found`)

  const header = match.name || match.id || path
  const lines = [
    match.description,
    match.domain ? `Domain: ${match.domain}` : "",
    match.actions ? `Actions: ${match.actions.length}` : "",
  ]
  return buildResource({ path, resourceType: "role", header, lines })
}