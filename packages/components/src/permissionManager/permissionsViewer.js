// src/widgets/permissionsViewer.js — VM-based + direct backend save (JS)

// New backend list wrappers (adjust paths if your repo differs)
import { listAccounts } from "@globular/sdk"
import { listGroups } from "@globular/sdk"
import { listOrganizations } from "@globular/sdk"
import { listApplications } from "@globular/sdk"; // NEW apps accessor (ApplicationVM[])
// VM persistence utilities
import { setResourcePermissions } from "@globular/sdk"
import { permissionsProtoToVM, permissionsVMToProto } from "./permissionsUtils.js"

// Optional UI feedback (adjust if your notify helpers live elsewhere)
import { displayError, displayMessage } from "@globular/sdk"

// UI deps

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
// -------------------- light data caches to avoid repeated list calls ------
const caches = {
  accounts: new Map(), groups: new Map(), orgs: new Map(), apps: new Map(),
}
let _accountsLoaded = false, _groupsLoaded = false, _orgsLoaded = false, _appsLoaded = false
const keyId  = (id, domain) => domain ? `${id}@${domain}` : String(id || "")

const cloneVM = (vm) => JSON.parse(JSON.stringify(vm || {}))
const emptyVM = () => ({
  path: "",
  resourceType: "",
  owners: { accounts: [], groups: [], applications: [], organizations: [] },
  allowed: [],
  denied: [],
})

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
async function resolveAccount(idOrFqid) { await ensureAccounts(); const { id, domain } = parseFQID(idOrFqid); return caches.accounts.get(keyId(id, domain)) || caches.accounts.get(keyId(id, "")) }
async function resolveGroup(idOrFqid)   { await ensureGroups();  const { id, domain } = parseFQID(idOrFqid); return caches.groups.get(keyId(id, domain))   || caches.groups.get(keyId(id, "")) }
async function resolveOrg(idOrFqid)     { await ensureOrgs();    const { id, domain } = parseFQID(idOrFqid); return caches.orgs.get(keyId(id, domain))     || caches.orgs.get(keyId(id, "")) }
async function resolveApp(idOrFqid)     { await ensureApps();    const { id, domain } = parseFQID(idOrFqid); return caches.apps.get(keyId(id, domain))     || caches.apps.get(keyId(id, "")) }

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

  /** Attach a PermissionsVM or proto Permissions */
  setPermissions(permissionsInput) {
    let vm
    if (permissionsInput && typeof permissionsInput.getPath === "function") {
      vm = permissionsProtoToVM(permissionsInput)
    } else if (permissionsInput) {
      vm = cloneVM(permissionsInput)
    } else {
      vm = emptyVM()
    }
    this._permissions = vm
    this._processPermissionsData()
    this._renderPermissionsTable()
  }

  // ---------------------------- render skeleton ---------------------------
  _renderInitialStructure() {
    this.shadowRoot.innerHTML = `
      <style>
        #subjects-div { vertical-align: middle; text-align: center; }
        #permissions-div {
          display: table;
          width: 100%;
          border-collapse: collapse;
          font-size: .85rem;
        }
        #permissions-header {
          display: table-row;
          font-size: .75rem;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: .04em;
          color: var(--secondary-text-color);
          border-bottom: 1px solid color-mix(in srgb, var(--palette-divider) 50%, transparent);
          background: color-mix(in srgb, var(--on-surface-color) 5%, var(--surface-color));
        }
        #permissions-header div {
          display: table-cell;
          padding: 10px 8px;
          text-align: center;
          vertical-align: middle;
        }
        .subject-cell {
          display: table-cell;
          padding: 8px;
          text-align: left;
          vertical-align: middle;
          max-width: 250px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .permission-cell {
          text-align: center;
          vertical-align: middle;
          padding: 6px;
          display: table-cell;
        }
        .permission-cell iron-icon {
          width: 20px;
          height: 20px;
          color: var(--secondary-text-color);
          opacity: .5;
          transition: opacity .2s, color .2s;
        }
        .permission-cell iron-icon:hover { cursor: pointer; opacity: 1; color: var(--accent-color); }
        .permission-cell iron-icon[icon="icons:check"] { color: var(--palette-success-main, #4caf50); opacity: 1; }
        .permission-cell iron-icon[icon="av:not-interested"] { color: var(--palette-error-main, #f44336); opacity: .8; }
        .permission-cell iron-icon[icon="icons:remove"] { color: var(--secondary-text-color); opacity: .35; }

        .permission-row {
          display: table-row;
          border-bottom: 1px solid color-mix(in srgb, var(--palette-divider) 30%, transparent);
          transition: background .15s;
        }
        .permission-row:last-child { border-bottom: none; }
        .permission-row:hover {
          background: color-mix(in srgb, var(--on-surface-color) 4%, transparent);
        }

        .item-subject-display { display: flex; align-items: center; padding: 4px 2px; gap: 8px; }
        .item-subject-icon {
          width: 28px; height: 28px; border-radius: 50%; object-fit: cover;
          flex-shrink: 0;
        }
        .item-subject-icon-placeholder {
          width: 28px; height: 28px; flex-shrink: 0;
          fill: var(--palette-action-disabled);
          --iron-icon-fill-color: var(--palette-action-disabled);
        }
        .item-subject-text {
          display: flex;
          flex-direction: column;
          font-size: .82rem;
          flex-grow: 1;
          min-width: 0;
          gap: 1px;
        }
        .item-subject-text span:first-child {
          font-weight: 600;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .item-subject-text span:last-child {
          font-size: .72rem;
          color: var(--secondary-text-color);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          opacity: .8;
        }

        /* Action column (remove button) */
        .action-col {
          width: 32px;
          min-width: 32px;
        }
        .remove-btn {
          width: 18px; height: 18px;
          fill: var(--secondary-text-color);
          opacity: .3;
          cursor: pointer;
          transition: opacity .2s, fill .2s;
        }
        .remove-btn:hover {
          fill: var(--palette-error-main, #f44336);
          opacity: 1;
        }

        /* Add subject bar */
        #add-subject-bar {
          display: flex;
          align-items: center;
          padding: 4px 8px;
          position: relative;
        }
        #add-subject-btn {
          width: 32px; height: 32px;
          color: var(--secondary-text-color);
          opacity: .6;
          transition: opacity .2s, color .2s;
        }
        #add-subject-btn:hover { color: var(--accent-color); opacity: 1; }

        .add-popup {
          position: absolute;
          left: 8px;
          top: 40px;
          z-index: 200;
          background: var(--surface-color);
          border: 1px solid var(--palette-divider);
          border-radius: 8px;
          box-shadow: 0 4px 16px rgba(0,0,0,.25);
          min-width: 220px;
          overflow: hidden;
        }
        .add-popup-types {
          display: flex;
          flex-direction: column;
        }
        .add-popup-type {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 10px 16px;
          cursor: pointer;
          font-size: .82rem;
          font-weight: 500;
          color: var(--primary-text-color);
          transition: background .15s;
        }
        .add-popup-type:hover {
          background: color-mix(in srgb, var(--on-surface-color) 8%, transparent);
        }
        .add-popup-type iron-icon {
          width: 20px; height: 20px;
          fill: var(--secondary-text-color);
        }

        #add-subject-search {
          border-top: 1px solid var(--palette-divider);
          padding: 8px;
        }
        #add-subject-input {
          width: 100%;
          box-sizing: border-box;
          padding: 6px 10px;
          border: 1px solid var(--palette-divider);
          border-radius: 6px;
          background: color-mix(in srgb, var(--on-surface-color) 5%, var(--surface-color));
          color: var(--primary-text-color);
          font-size: .82rem;
          outline: none;
        }
        #add-subject-input:focus { border-color: var(--accent-color); }
        #add-subject-results {
          max-height: 200px;
          overflow-y: auto;
          margin-top: 6px;
          scrollbar-width: thin;
        }
        .add-result-item {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 6px 8px;
          cursor: pointer;
          border-radius: 4px;
          font-size: .8rem;
          transition: background .15s;
        }
        .add-result-item:hover {
          background: color-mix(in srgb, var(--on-surface-color) 8%, transparent);
        }
        .add-result-item iron-icon {
          width: 22px; height: 22px;
          fill: var(--secondary-text-color);
          flex-shrink: 0;
        }
        .add-result-item img {
          width: 22px; height: 22px;
          border-radius: 50%;
          object-fit: cover;
          flex-shrink: 0;
        }
        .add-result-text {
          display: flex;
          flex-direction: column;
          min-width: 0;
        }
        .add-result-text span:first-child { font-weight: 500; }
        .add-result-text span:last-child { font-size: .7rem; color: var(--secondary-text-color); }
      </style>

      <div>
        <div id="subjects-div"></div>
        <div id="permissions-div">
          <div id="permissions-header">
            <div class="subject-cell">Subject</div>
            ${this._permissionsNames.map(n => `<div class="permission-cell">${n}</div>`).join('')}
            <div class="permission-cell action-col"></div>
          </div>
        </div>
        <div id="add-subject-bar">
          <paper-icon-button id="add-subject-btn" icon="icons:add" title="Add subject"></paper-icon-button>
          <div id="add-subject-popup" class="add-popup" style="display:none;">
            <div class="add-popup-types">
              <div class="add-popup-type" data-type="account"><iron-icon icon="account-circle"></iron-icon><span>Account</span></div>
              <div class="add-popup-type" data-type="group"><iron-icon icon="social:people"></iron-icon><span>Group</span></div>
              <div class="add-popup-type" data-type="organization"><iron-icon icon="social:domain"></iron-icon><span>Organization</span></div>
            </div>
            <div id="add-subject-search" style="display:none;">
              <input id="add-subject-input" type="text" placeholder="Search..." />
              <div id="add-subject-results"></div>
            </div>
          </div>
        </div>
      </div>
    `
  }

  _getDomReferences() {
    this._subjectsDiv = this.shadowRoot.querySelector("#subjects-div")
    this._permissionsDiv = this.shadowRoot.querySelector("#permissions-div")
    this._permissionsHeader = this.shadowRoot.querySelector("#permissions-header")

    // Add-subject UI
    this._addBtn = this.shadowRoot.querySelector("#add-subject-btn")
    this._addPopup = this.shadowRoot.querySelector("#add-subject-popup")
    this._addSearch = this.shadowRoot.querySelector("#add-subject-search")
    this._addInput = this.shadowRoot.querySelector("#add-subject-input")
    this._addResults = this.shadowRoot.querySelector("#add-subject-results")

    this._wireAddSubject()
  }

  // ----------------------------- add-subject wiring ---------------------------
  _wireAddSubject() {
    if (!this._addBtn) return

    // Toggle popup
    this._addBtn.addEventListener("click", (e) => {
      e.stopPropagation()
      const showing = this._addPopup.style.display !== "none"
      this._closeAddPopup()
      if (!showing) {
        this._addPopup.style.display = ""
        this._addSearch.style.display = "none"
      }
    })

    // Close on outside click (use capture on shadow root host)
    this.addEventListener("click", (e) => {
      if (this._addPopup.style.display === "none") return
      const path = e.composedPath()
      const inPopup = path.includes(this._addPopup) || path.includes(this._addBtn)
      if (!inPopup) this._closeAddPopup()
    })

    // Type buttons
    this._addPopup.querySelectorAll(".add-popup-type").forEach(btn => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation()
        const type = btn.dataset.type
        this._showSubjectSearch(type)
      })
    })

    // Search input
    this._addInput?.addEventListener("input", () => {
      this._filterSearchResults(this._addInput.value)
    })
    this._addInput?.addEventListener("click", (e) => e.stopPropagation())
  }

  _closeAddPopup() {
    if (this._addPopup) this._addPopup.style.display = "none"
    if (this._addSearch) this._addSearch.style.display = "none"
    if (this._addResults) this._addResults.innerHTML = ""
    if (this._addInput) this._addInput.value = ""
    this._addPopupEntities = []
    this._addPopupType = ""
  }

  async _showSubjectSearch(type) {
    this._addPopupType = type
    this._addSearch.style.display = ""
    this._addInput.value = ""
    this._addInput.placeholder = `Search ${type}s...`
    this._addResults.innerHTML = `<div style="padding:8px;font-size:.8rem;color:var(--secondary-text-color);">Loading...</div>`
    this._addInput.focus()

    // Fetch entities
    let items = []
    try {
      if (type === "account") {
        const r = await listAccounts({ pageSize: 2000 })
        items = r?.items || []
      } else if (type === "group") {
        const r = await listGroups({ pageSize: 2000 })
        items = r?.items || []
      } else if (type === "organization") {
        const r = await listOrganizations({ pageSize: 2000 })
        items = r?.items || []
      }
    } catch (e) {
      console.warn("Failed to load entities:", e)
    }

    // Filter out subjects already in the table
    const existingKeys = new Set(Object.keys(this._subjects))
    this._addPopupEntities = items.filter(item => {
      const id = getId(item)
      const domain = getDomain(item)
      const fq = domain ? `${id}@${domain}` : id
      return !existingKeys.has(`${fq}::${type}`) && !existingKeys.has(`${id}::${type}`)
    })

    this._filterSearchResults("")
  }

  _filterSearchResults(query) {
    if (!this._addResults) return
    this._addResults.innerHTML = ""
    const q = (query || "").toLowerCase()
    const type = this._addPopupType

    const filtered = this._addPopupEntities.filter(item => {
      const id = getId(item)
      const name = getName(item)
      const email = getEmail(item)
      return !q || id.toLowerCase().includes(q) || name.toLowerCase().includes(q) || email.toLowerCase().includes(q)
    })

    if (filtered.length === 0) {
      this._addResults.innerHTML = `<div style="padding:8px;font-size:.8rem;color:var(--secondary-text-color);">No results</div>`
      return
    }

    filtered.slice(0, 30).forEach(item => {
      const id = getId(item)
      const domain = getDomain(item)
      const fq = domain ? `${id}@${domain}` : id
      const div = document.createElement("div")
      div.className = "add-result-item"

      let mainText = "", subText = "", iconName = "account-circle", iconUrl = ""
      if (type === "account") {
        const fn = getFirstName(item), ln = getLastName(item)
        mainText = (fn && ln) ? `${fn} ${ln}` : (getName(item) || id)
        subText = getEmail(item) || fq
        iconUrl = getProfilePicture(item)
      } else if (type === "group") {
        mainText = getName(item) || id
        subText = fq
        iconName = "social:people"
      } else if (type === "organization") {
        mainText = getName(item) || id
        subText = fq
        iconName = "social:domain"
      }

      div.innerHTML = `
        ${iconUrl ? `<img src="${iconUrl}" alt="">` : `<iron-icon icon="${iconName}"></iron-icon>`}
        <div class="add-result-text">
          <span>${mainText}</span>
          <span>${subText}</span>
        </div>
      `

      div.addEventListener("click", () => {
        this._addSubjectToPermissions(fq, type)
        this._closeAddPopup()
      })

      this._addResults.appendChild(div)
    })
  }

  _addSubjectToPermissions(subjectId, type) {
    if (!this._permissions) return

    // Add to owners by default (will show as a row with owner=unset, user can toggle)
    // Actually, just add the subject key so it appears — with all permissions unset
    const key = `${subjectId}::${type}`
    if (this._subjects[key]) return // already present

    this._subjects[key] = { id: subjectId, type, permissions: {} }
    this._renderPermissionsTable()
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

        // Remove button
        const actionCell = document.createElement("div")
        actionCell.className = "permission-cell action-col"
        const removeIcon = document.createElement("iron-icon")
        removeIcon.className = "remove-btn"
        removeIcon.icon = "icons:close"
        removeIcon.title = "Remove subject"
        removeIcon.addEventListener("click", async () => {
          await this._removeSubject(subject)
        })
        actionCell.appendChild(removeIcon)
        row.appendChild(actionCell)

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

  async _removeSubject(subject) {
    if (!this._permissions) return
    const subjId = subject.id
    const type = subject.type

    const removeFromList = (list) => list.filter(x => x !== subjId)
    const removeFromEntries = (entries) => {
      for (const entry of entries) {
        if (type === "account") entry.accounts = removeFromList(entry.accounts || [])
        else if (type === "group") entry.groups = removeFromList(entry.groups || [])
        else if (type === "application") entry.applications = removeFromList(entry.applications || [])
        else if (type === "organization") entry.organizations = removeFromList(entry.organizations || [])
        else if (type === "peer") entry.peers = removeFromList(entry.peers || [])
      }
    }

    // Remove from owners
    const owners = this._permissions.owners
    if (owners) {
      if (type === "account") owners.accounts = removeFromList(owners.accounts || [])
      else if (type === "group") owners.groups = removeFromList(owners.groups || [])
      else if (type === "application") owners.applications = removeFromList(owners.applications || [])
      else if (type === "organization") owners.organizations = removeFromList(owners.organizations || [])
      else if (type === "peer") owners.peers = removeFromList(owners.peers || [])
    }

    // Remove from allowed and denied
    removeFromEntries(this._permissions.allowed || [])
    removeFromEntries(this._permissions.denied || [])

    // Rebuild and persist
    this._processPermissionsData()
    this._renderPermissionsTable()
    await this._persistPermissionsVM()
  }

  async _persistPermissionsVM() {
    const vm = cloneVM(this._permissions || {})

    if (!vm.path && this.permissionManager?._path) {
      vm.path = this.permissionManager._path
    }
    if (!vm.resourceType) {
      vm.resourceType =
        this.permissionManager?._permissions?.getResourceType?.() ||
        this.permissionManager?._permissions?.getResourcetype?.() ||
        this.permissionManager?.resourceType ||
        vm.resourceType ||
        "file"
    }

    if (this.permissionManager?.updatePermissionsFromViewer) {
      await this.permissionManager.updatePermissionsFromViewer(vm)
      return
    }

    try {
      if (!vm.path || !vm.resourceType) {
        displayError?.("Missing path or resourceType on PermissionsVM.", 3000)
        return
      }
      const proto = permissionsVMToProto(vm)
      await setResourcePermissions(proto)
      displayMessage?.("Permissions saved.", 2000)
    } catch (err) {
      console.error(err)
      displayError?.(`Failed to save permissions: ${err?.message || err}`, 4000)
    }
  }
}

customElements.define('globular-permissions-viewer', PermissionsViewer)