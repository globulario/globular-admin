// src/widgets/permissionsViewer.js — VM-based + direct backend save (JS)

// New backend list wrappers (adjust paths if your repo differs)
import { listAccounts } from "../../backend/rbac/accounts"
import { listGroups } from "../../backend/rbac/groups"
import { listOrganizations } from "../../backend/rbac/organizations"
import { listApplications } from "../../backend/rbac/applications"; // NEW apps accessor (ApplicationVM[])
import { listPeers } from "../../backend/rbac/peers"

// VM persistence (no protos here)
import { setResourcePermissions } from "../../backend/rbac/permissions"

// Optional UI feedback (adjust if your notify helpers live elsewhere)
import { displayError, displayMessage } from "../../backend/ui/notify"

// UI deps
import '@polymer/iron-icon/iron-icon.js'
import '@polymer/iron-icons/social-icons.js'
import '@polymer/iron-icons/hardware-icons.js'
import '@polymer/iron-icons/iron-icons.js'

// -------------------- tiny access helpers / id parsing --------------------
const callIf = (o, m) => (o && typeof o[m] === "function") ? o[m]() : undefined

const getStr = (o, getter, field) =>
  callIf(o, getter) ?? (o ? o[field] : "" ) ?? ""

const getId = (o) => getStr(o, "getId", "id")
const getName = (o) => getStr(o, "getName", "name")
const getDomain = (o) => getStr(o, "getDomain", "domain")
const getEmail = (o) => getStr(o, "getEmail", "email")
const getFirstName = (o) => getStr(o, "getFirstname", "firstName")
const getLastName  = (o) => getStr(o, "getLastname", "lastName")
const getProfilePicture = (o) => getStr(o, "getProfilepicture", "profilePicture")
const getAlias = (o) => getStr(o, "getAlias", "alias")
const getVersion = (o) => getStr(o, "getVersion", "version")
const getIcon = (o) => getStr(o, "getIcon", "icon")
const getHostname = (o) => getStr(o, "getHostname", "hostname")
const getMac = (o) => getStr(o, "getMac", "mac")

/** Parse "id" or "id@domain" → { id, domain } */
function parseFQID(thing) {
  const s = String(thing || "")
  const at = s.lastIndexOf("@")
  if (at > 0) return { id: s.slice(0, at), domain: s.slice(at + 1) }
  return { id: s, domain: "" }
}
function parsePeerKey(thing) { return parseFQID(thing) }

// -------------------- light data caches to avoid repeated list calls ------
const caches = {
  accounts: new Map(), groups: new Map(), orgs: new Map(), apps: new Map(), peers: new Map(),
}
let _accountsLoaded = false, _groupsLoaded = false, _orgsLoaded = false, _appsLoaded = false, _peersLoaded = false
const keyId  = (id, domain) => domain ? `${id}@${domain}` : String(id || "")
const keyMac = (mac, domain) => domain ? `${mac}@${domain}` : String(mac || "")

// -------------------- resolvers (load once, then map lookup) ---------------
async function ensureAccounts() {
  if (_accountsLoaded) return
  const { items = [] } = await (listAccounts({ pageSize: 2000 }) || {})
  items.forEach(a => {
    const id = getId(a), dom = getDomain(a)
    caches.accounts.set(keyId(id, dom), a)
    caches.accounts.set(keyId(id, ""), a)
  })
  _accountsLoaded = true
}
async function ensureGroups() {
  if (_groupsLoaded) return
  const { items = [] } = await (listGroups({ pageSize: 2000 }) || {})
  items.forEach(g => {
    const id = getId(g), dom = getDomain(g)
    caches.groups.set(keyId(id, dom), g)
    caches.groups.set(keyId(id, ""), g)
  })
  _groupsLoaded = true
}
async function ensureOrgs() {
  if (_orgsLoaded) return
  const { items = [] } = await (listOrganizations({ pageSize: 2000 }) || {})
  items.forEach(o => {
    const id = getId(o), dom = getDomain(o)
    caches.orgs.set(keyId(id, dom), o)
    caches.orgs.set(keyId(id, ""), o)
  })
  _orgsLoaded = true
}
async function ensureApps() {
  if (_appsLoaded) return
  const arr = await (listApplications() || [])
  const items = Array.isArray(arr) ? arr : (arr.items || [])
  items.forEach(a => {
    const id = getId(a), dom = getDomain(a)
    caches.apps.set(keyId(id, dom), a)
    caches.apps.set(keyId(id, ""), a)
  })
  _appsLoaded = true
}
async function ensurePeers() {
  if (_peersLoaded) return
  const arr = await (listPeers() || [])
  const items = Array.isArray(arr) ? arr : (arr.items || [])
  items.forEach(p => {
    const mac = getMac(p), dom = getDomain(p)
    caches.peers.set(keyMac(mac, dom), p)
    caches.peers.set(keyMac(mac, ""), p)
  })
  _peersLoaded = true
}

async function resolveAccount(idOrFqid) { await ensureAccounts(); const { id, domain } = parseFQID(idOrFqid); return caches.accounts.get(keyId(id, domain)) || caches.accounts.get(keyId(id, "")) }
async function resolveGroup(idOrFqid)   { await ensureGroups();  const { id, domain } = parseFQID(idOrFqid); return caches.groups.get(keyId(id, domain))   || caches.groups.get(keyId(id, "")) }
async function resolveOrg(idOrFqid)     { await ensureOrgs();    const { id, domain } = parseFQID(idOrFqid); return caches.orgs.get(keyId(id, domain))     || caches.orgs.get(keyId(id, "")) }
async function resolveApp(idOrFqid)     { await ensureApps();    const { id, domain } = parseFQID(idOrFqid); return caches.apps.get(keyId(id, domain))     || caches.apps.get(keyId(id, "")) }
async function resolvePeer(macOrFqid)   { await ensurePeers();   const { id: mac, domain } = parsePeerKey(macOrFqid); return caches.peers.get(keyMac(mac, domain)) || caches.peers.get(keyMac(mac, "")) }

// ==========================================================================

/**
 * Tabular view of a PermissionsVM object (read, write, delete, owner).
 * Persists with backend `setResourcePermissions(permissionsVM)`.
 *
 * PermissionsVM shape:
 * {
 *   path: string,
 *   resourceType: string,
 *   owners: { accounts:[], groups:[], applications:[], organizations:[], peers:[] },
 *   allowed: [{ name, accounts:[], groups:[], applications:[], organizations:[], peers:[] }],
 *   denied:  [{ name, ... }]
 * }
 */
export class PermissionsViewer extends HTMLElement {
  constructor(permissionsNames) {
    super()
    this.attachShadow({ mode: 'open' })

    this._permissionsNames = Array.isArray(permissionsNames) ? permissionsNames : []
    this._permissions = null
    this._subjects = {}

    this._subjectsDiv = null
    this._permissionsDiv = null
    this._permissionsHeader = null
  }

  connectedCallback() {
    this._renderInitialStructure()
    this._getDomReferences()
  }

  /** Attach a PermissionsVM */
  setPermissions(permissionsVM) {
    if (this._permissions !== permissionsVM) {
      this._permissions = permissionsVM
      this._processPermissionsData()
      this._renderPermissionsTable()
    }
  }

  // ---------------------------- render skeleton ---------------------------
  _renderInitialStructure() {
    this.shadowRoot.innerHTML = `
      <style>
        #subjects-div { vertical-align: middle; text-align: center; }
        #permissions-div {
          display: table; width: 100%; border-collapse: collapse; font-size: .95rem;
        }
        #permissions-header {
          display: table-row; font-size: 1rem; font-weight: 500;
          color: var(--primary-text-color);
          border-bottom: 2px solid var(--palette-divider);
          background-color: var(--palette-background-dark);
        }
        #permissions-header div {
          display: table-cell; padding: 8px 5px; text-align: center; vertical-align: middle;
        }
        .subject-cell {
          display: table-cell; padding: 5px; text-align: left; vertical-align: middle;
          max-width: 250px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        .permission-cell {
          text-align: center; vertical-align: middle; padding: 5px; display: table-cell;
        }
        .permission-cell iron-icon { width: 24px; height: 24px; color: var(--secondary-text-color); }
        .permission-cell iron-icon:hover { cursor: pointer; color: var(--primary-color); }
        .permission-cell iron-icon[icon="icons:check"] { color: var(--palette-success-main); }
        .permission-cell iron-icon[icon="av:not-interested"] { color: var(--palette-error-main); }
        .permission-cell iron-icon[icon="icons:remove"] { color: var(--secondary-text-color); }

        .permission-row { display: table-row; border-bottom: 1px solid var(--palette-divider-light); }
        .permission-row:last-child { border-bottom: none; }

        .item-subject-display { display:flex; align-items:center; padding:2px; }
        .item-subject-icon {
          width: 32px; height: 32px; border-radius: 50%; object-fit: cover;
          margin-right:5px; flex-shrink:0;
        }
        .item-subject-icon-placeholder {
          width: 32px; height: 32px; margin-right:5px; flex-shrink:0;
          --iron-icon-fill-color: var(--palette-action-disabled);
        }
        .item-subject-text { display:flex; flex-direction:column; font-size:.8em; flex-grow:1; min-width:0; }
        .item-subject-text span:first-child { font-weight:500; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
        .item-subject-text span:last-child  { font-size:.7em; color:var(--secondary-text-color); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      </style>

      <div>
        <div id="subjects-div"></div>
        <div id="permissions-div">
          <div id="permissions-header">
            <div class="subject-cell">Subject</div>
            ${this._permissionsNames.map(n => `<div class="permission-cell">${n}</div>`).join('')}
          </div>
        </div>
      </div>
    `
  }

  _getDomReferences() {
    this._subjectsDiv = this.shadowRoot.querySelector("#subjects-div")
    this._permissionsDiv = this.shadowRoot.querySelector("#permissions-div")
    this._permissionsHeader = this.shadowRoot.querySelector("#permissions-header")
  }

  // ---------------------------- data prep --------------------------------
  _processPermissionsData() {
    this._subjects = {}

    const addSubject = (id, type, permissionName, status) => {
      const key = `${id}::${type}`
      if (!this._subjects[key]) this._subjects[key] = { id, type, permissions: {} }
      this._subjects[key].permissions[permissionName] = status
    }

    const owners = this._permissions?.owners || {
      accounts: [], groups: [], applications: [], organizations: [], peers: []
    }
    owners.accounts.forEach(id => addSubject(id, "account", "owner", "allowed"))
    owners.groups.forEach(id => addSubject(id, "group", "owner", "allowed"))
    owners.applications.forEach(id => addSubject(id, "application", "owner", "allowed"))
    owners.organizations.forEach(id => addSubject(id, "organization", "owner", "allowed"))
    owners.peers.forEach(id => addSubject(id, "peer", "owner", "allowed"))

    const allowed = Array.isArray(this._permissions?.allowed) ? this._permissions.allowed : []
    const denied  = Array.isArray(this._permissions?.denied)  ? this._permissions.denied  : []

    allowed.forEach(perm => {
      const n = perm.name || ""
      ;(perm.accounts || []).forEach(id => addSubject(id, "account", n, "allowed"))
      ;(perm.groups || []).forEach(id => addSubject(id, "group", n, "allowed"))
      ;(perm.applications || []).forEach(id => addSubject(id, "application", n, "allowed"))
      ;(perm.organizations || []).forEach(id => addSubject(id, "organization", n, "allowed"))
      ;(perm.peers || []).forEach(id => addSubject(id, "peer", n, "allowed"))
    })

    denied.forEach(perm => {
      const n = perm.name || ""
      ;(perm.accounts || []).forEach(id => addSubject(id, "account", n, "denied"))
      ;(perm.groups || []).forEach(id => addSubject(id, "group", n, "denied"))
      ;(perm.applications || []).forEach(id => addSubject(id, "application", n, "denied"))
      ;(perm.organizations || []).forEach(id => addSubject(id, "organization", n, "denied"))
      ;(perm.peers || []).forEach(id => addSubject(id, "peer", n, "denied"))
    })
  }

  // ---------------------------- table render ------------------------------
  async _renderPermissionsTable() {
    this.shadowRoot.querySelectorAll('.permission-row').forEach(r => r.remove())

    const rows = await Promise.all(
      Object.values(this._subjects).map(async (subject) => {
        const subjectDiv = await this._resolveSubjectDiv(subject)
        const row = document.createElement("div")
        row.className = "permission-row"

        const subjectCell = document.createElement("div")
        subjectCell.className = "subject-cell"
        subjectCell.appendChild(subjectDiv)
        row.appendChild(subjectCell)

        this._permissionsNames.forEach(permName => {
          const status = subject.permissions[permName] // allowed/denied/undefined
          const cell = this._createPermissionCell(status, permName, subject)
          row.appendChild(cell)
        })

        return row
      })
    )

    rows.forEach(r => this._permissionsDiv.appendChild(r))
  }

  // Resolve one subject to a UI block
  async _resolveSubjectDiv(subject) {
    try {
      if (subject.type === "account")      return this._createAccountDiv(await resolveAccount(subject.id), subject.id)
      if (subject.type === "application")  return this._createApplicationDiv(await resolveApp(subject.id), subject.id)
      if (subject.type === "group")        return this._createGroupDiv(await resolveGroup(subject.id), subject.id)
      if (subject.type === "organization") return this._createOrganizationDiv(await resolveOrg(subject.id), subject.id)
      if (subject.type === "peer")         return this._createPeerDiv(await resolvePeer(subject.id), subject.id)
    } catch (e) {
      console.warn(`Failed to resolve ${subject.type} ${subject.id}`, e)
    }
    return this._createGenericSubjectDiv(`Unknown: ${subject.id}`, `Type: ${subject.type}`, "", "icons:help")
  }

  // ---------------------------- subject tiles -----------------------------
  _createGenericSubjectDiv(mainText, subText = "", iconUrl = "", iconName = "account-circle") {
    const div = document.createElement('div')
    div.className = "item-subject-display"
    div.innerHTML = `
      ${iconUrl
        ? `<img class="item-subject-icon" src="${iconUrl}" alt="icon">`
        : `<iron-icon class="item-subject-icon-placeholder" icon="${iconName}"></iron-icon>`}
      <div class="item-subject-text">
        <span>${mainText}</span>
        ${subText ? `<span>${subText}</span>` : ''}
      </div>
    `
    return div
  }

  _createAccountDiv(account, fallbackId) {
    if (!account) return this._createGenericSubjectDiv(fallbackId || "(account)", "", "", "account-circle")
    const fn = getFirstName(account), ln = getLastName(account)
    const disp = (fn && ln) ? `${fn} ${ln}` : (getName(account) || "(account)")
    return this._createGenericSubjectDiv(disp, getEmail(account), getProfilePicture(account), "account-circle")
  }
  _createApplicationDiv(app, fallbackId) {
    if (!app) return this._createGenericSubjectDiv(fallbackId || "(app)", "", "", "apps")
    return this._createGenericSubjectDiv(getAlias(app) || getName(app) || "(app)", getVersion(app), getIcon(app), "apps")
  }
  _createOrganizationDiv(org, fallbackId) {
    if (!org) return this._createGenericSubjectDiv(fallbackId || "(org)", "", "", "social:domain")
    return this._createGenericSubjectDiv(getName(org) || "(org)", `${getId(org)}@${getDomain(org)}`, "", "social:domain")
  }
  _createPeerDiv(peer, fallbackId) {
    if (!peer) return this._createGenericSubjectDiv(fallbackId || "(peer)", "", "", "hardware:computer")
    return this._createGenericSubjectDiv(getHostname(peer) || "(peer)", `(${getMac(peer)})`, "", "hardware:computer")
  }
  _createGroupDiv(group, fallbackId) {
    if (!group) return this._createGenericSubjectDiv(fallbackId || "(group)", "", "", "social:people")
    return this._createGenericSubjectDiv(getName(group) || "(group)", `${getId(group)}@${getDomain(group)}`, "", "social:people")
  }

  // ---------------------------- permission cells / toggling ----------------
  _createPermissionCell(status, permissionName, subject) {
    const cell = document.createElement("div")
    cell.className = "permission-cell"

    const icon = document.createElement("iron-icon")
    icon.icon = (status === "allowed") ? "icons:check" : (status === "denied") ? "av:not-interested" : "icons:remove"

    icon.addEventListener('click', async () => {
      await this._togglePermissionStatus(subject, permissionName, status)
    })

    cell.appendChild(icon)
    return cell
  }

  /**
   * Toggle in the VM (no protos). Cycles:
   *  - owner: allowed -> none -> allowed
   *  - others: allowed -> denied -> none -> allowed
   * Then persists via backend.setResourcePermissions(this._permissions)
   */
  async _togglePermissionStatus(subject, permissionName, currentStatus) {
    if (!this._permissions) return
    const subjId = subject.id
    const type = subject.type

    // Helpers for owner lists
    const getOwnerList = () => {
      const owners = (this._permissions.owners ||= {
        accounts: [], groups: [], applications: [], organizations: [], peers: []
      })
      if (type === "account") return owners.accounts
      if (type === "group") return owners.groups
      if (type === "application") return owners.applications
      if (type === "organization") return owners.organizations
      if (type === "peer") return owners.peers
      return []
    }
    const setOwnerList = (next) => {
      const owners = (this._permissions.owners ||= {
        accounts: [], groups: [], applications: [], organizations: [], peers: []
      })
      if (type === "account") owners.accounts = next
      else if (type === "group") owners.groups = next
      else if (type === "application") owners.applications = next
      else if (type === "organization") owners.organizations = next
      else if (type === "peer") owners.peers = next
    }

    // Helpers for a named permission entry in allowed/denied
    const getOrMakeEntry = (whereArr, name) => {
      let e = whereArr.find(x => x.name === name)
      if (!e) {
        e = { name, accounts: [], groups: [], applications: [], organizations: [], peers: [] }
        whereArr.push(e)
      }
      return e
    }
    const getListFromEntry = (entry) => {
      if (type === "account") return entry.accounts
      if (type === "group") return entry.groups
      if (type === "application") return entry.applications
      if (type === "organization") return entry.organizations
      if (type === "peer") return entry.peers
      return []
    }
    const setListOnEntry = (entry, next) => {
      if (type === "account") entry.accounts = next
      else if (type === "group") entry.groups = next
      else if (type === "application") entry.applications = next
      else if (type === "organization") entry.organizations = next
      else if (type === "peer") entry.peers = next
    }

    // Compute next status
    let nextStatus
    if (permissionName === "owner") {
      nextStatus = (currentStatus === "allowed") ? undefined : "allowed"
    } else {
      if (currentStatus === "allowed") nextStatus = "denied"
      else if (currentStatus === "denied") nextStatus = undefined
      else nextStatus = "allowed"
    }

    // Mutate VM
    if (permissionName === "owner") {
      const cur = getOwnerList()
      const filtered = cur.filter(x => x !== subjId)
      if (nextStatus === "allowed") filtered.push(subjId)
      setOwnerList(filtered)
    } else {
      const allowedArr = (this._permissions.allowed ||= [])
      const deniedArr  = (this._permissions.denied  ||= [])

      const aEntry = getOrMakeEntry(allowedArr, permissionName)
      const dEntry = getOrMakeEntry(deniedArr,  permissionName)

      const aList = getListFromEntry(aEntry).filter(x => x !== subjId)
      const dList = getListFromEntry(dEntry).filter(x => x !== subjId)

      if (nextStatus === "allowed")      aList.push(subjId)
      else if (nextStatus === "denied")  dList.push(subjId)

      setListOnEntry(aEntry, aList)
      setListOnEntry(dEntry, dList)
    }

    // Rebuild table view from updated VM
    this._processPermissionsData()
    this._renderPermissionsTable()

    // Persist with backend
    await this._persistPermissionsVM()
  }

  async _persistPermissionsVM() {
    try {
      const vm = this._permissions || {}
      if (!vm.path || !vm.resourceType) {
        displayError?.("Missing path or resourceType on PermissionsVM.", 3000)
        return
      }
      await setResourcePermissions(vm) // backend handles auth/token/domain
      displayMessage?.("Permissions saved.", 2000)
    } catch (err) {
      console.error(err)
      displayError?.(`Failed to save permissions: ${err?.message || err}`, 4000)
    }
  }
}

customElements.define('globular-permissions-viewer', PermissionsViewer)
