// src/widgets/shared_subjects_permissions.js — new-backend (JS)

import getUuidByString from "uuid-by-string"

// New backend VM + setter
// PermissionVM = { name: string, accounts?: string[], groups?: string[], applications?: string[], organizations?: string[], peers?: string[] }
// ResourcePermissionsVM = { owners?: PermissionVM, allowed: PermissionVM[], denied: PermissionVM[] }
import { setResourcePermissions } from "../../backend/rbac/permissions"

// UI
import '@polymer/iron-icon/iron-icon.js'
import '@polymer/paper-icon-button/paper-icon-button.js'
import '@polymer/iron-icons/iron-icons.js'
import '@polymer/iron-icons/social-icons.js'

/** tiny getters tolerant to proto/VM/plain objects */
const getStr = (o, getter, key) => o?.[getter]?.() ?? o?.[key] ?? ""
const getId = (o) => getStr(o, "getId", "id")
const getDomain = (o) => getStr(o, "getDomain", "domain")
const getName = (o) => getStr(o, "getName", "name")
const getFirstName = (o) => getStr(o, "getFirstname", "firstName")
const getLastName  = (o) => getStr(o, "getLastname", "lastName")
const getProfilePicture = (o) => getStr(o, "getProfilepicture", "profilePicture")
const fqid = (o) => `${getId(o)}@${getDomain(o)}`

/** heuristic subject typing — avoids instanceof */
function subjectKind(subject) {
  if (!subject) return "account"
  if (getProfilePicture(subject) || subject.email || subject.getEmail) return "account"
  if ("members" in subject || "membersList" in subject) return "group"
  if ((getName(subject) && !getFirstName(subject)) && subject.roles) return "group"
  return "account"
}

/**
 * Displays and toggles read/write/delete permissions for provided subjects.
 * Works with PermissionVM and can persist via setResourcePermissions if path/resourceType are set.
 */
export class SharedSubjectsPermissions extends HTMLElement {
  // External inputs you may set from parent:
  // - this.path: string (resource path)
  // - this.resourceType: string (e.g., "file", "application", ...)
  constructor() {
    super()
    this.attachShadow({ mode: 'open' })

    // state
    this._accounts = []  // array of subject objects (account-like)
    this._groups = []    // array of subject objects (group-like)
    this._permissionsTable = null
    this.path = undefined
    this.resourceType = undefined
  }

  connectedCallback() {
    this._render()
    this._refs()
  }

  // ------------------------- inputs -------------------------
  setAccounts(accounts) {
    this._accounts = Array.isArray(accounts) ? accounts : []
    this.refresh()
  }
  setGroups(groups) {
    this._groups = Array.isArray(groups) ? groups : []
    this.refresh()
  }

  // ------------------------- render -------------------------
  _render() {
    this.shadowRoot.innerHTML = `
      <style>
        #container { display:flex; flex-direction:column; width:100%; box-sizing:border-box; color: var(--primary-text-color); }
        .title { font-size:1.2rem; font-weight:500; color:var(--primary-text-color);
          padding-bottom:10px; margin-bottom:10px; border-bottom:1px solid var(--palette-divider); }
        #permissions { display:table; width:100%; border-collapse:collapse; }
        #permissions-header { display:table-row; font-size:1rem; font-weight:500; color:var(--secondary-text-color);
          border-bottom:2px solid var(--palette-divider); background:var(--palette-background-dark); }
        #permissions-header div { display:table-cell; padding:8px 5px; text-align:center; vertical-align:middle; }
        #permissions-header .subject-header-cell { text-align:left; }
        .subject-permissions-row { display:table-row; border-bottom:1px solid var(--palette-divider-light); }
        .subject-permissions-row:last-child { border-bottom:none; }
        .cell { display:table-cell; vertical-align:middle; padding:8px 5px; }
        .cell iron-icon { width:24px; height:24px; color:var(--secondary-text-color); }
        .cell iron-icon:hover { cursor:pointer; color:var(--primary-color); }
        .cell iron-icon[icon="icons:check"] { color: var(--palette-success-main); }
        .cell iron-icon[icon="av:not-interested"] { color: var(--palette-error-main); }
        .infos { display:flex; align-items:center; padding:4px; border-radius:4px; background:var(--surface-color); color:var(--primary-text-color); transition:background .2s; }
        .infos:hover { background: var(--palette-action-hover); }
        .infos img { width:32px; height:32px; border-radius:50%; object-fit:cover; margin-right:8px; }
        .infos iron-icon { width:32px; height:32px; margin-right:8px; --iron-icon-fill-color: var(--palette-action-disabled); }
        .infos span { font-size:1rem; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; flex:1; }
      </style>
      <div id="container">
        <div class="title">Set subject's permissions...</div>
        <div id="permissions">
          <div id="permissions-header">
            <div class="subject-header-cell">Subject</div>
            <div class="permission-header-cell">Read</div>
            <div class="permission-header-cell">Write</div>
            <div class="permission-header-cell">Delete</div>
          </div>
        </div>
      </div>
    `
  }

  _refs() {
    this._permissionsTable = this.shadowRoot.querySelector("#permissions")
  }

  // ------------------------- table build -------------------------
  refresh() {
    // remove current rows
    this.shadowRoot.querySelectorAll(".subject-permissions-row").forEach(r => r.remove())

    // add accounts
    this._accounts.forEach(acc => this._appendSubjectRow(acc))
    // add groups
    this._groups.forEach(grp => this._appendSubjectRow(grp))
  }

  _appendSubjectRow(subject) {
    const id = getId(subject)
    const dom = getDomain(subject)
    const uuid = `_subject_row_${getUuidByString(`${id}@${dom}`)}`
    let row = this.shadowRoot.querySelector(`#${uuid}`)
    if (row) { row.style.display = "table-row"; return }

    row = document.createElement("div")
    row.id = uuid
    row.className = "subject-permissions-row"
    row.subject = subject

    // subject cell
    const subjectCell = document.createElement("div")
    subjectCell.className = "cell"
    subjectCell.appendChild(this._subjectInfo(subject))
    row.appendChild(subjectCell)

    // three permissions
    ;["read","write","delete"].forEach(perm => {
      const cell = document.createElement("div")
      cell.className = "cell"
      const icon = document.createElement("iron-icon")
      icon.id = `${uuid}_${perm}`
      icon.classList.add("permission-icon")
      icon.name = perm
      icon.icon = "icons:remove" // default none
      icon.addEventListener("click", () => this._toggle(icon, subject, perm))
      cell.appendChild(icon)
      row.appendChild(cell)
    })

    this._permissionsTable.appendChild(row)
  }

  _subjectInfo(subject) {
    const div = document.createElement("div")
    div.className = "infos"

    const kind = subjectKind(subject)
    const pp = getProfilePicture(subject)

    if (pp) {
      const img = document.createElement("img")
      img.src = pp
      img.alt = "profile"
      div.appendChild(img)
    } else {
      const ic = document.createElement("iron-icon")
      ic.icon = (kind === "group") ? "social:people" : "account-circle"
      div.appendChild(ic)
    }

    const span = document.createElement("span")
    const fn = getFirstName(subject), ln = getLastName(subject)
    span.textContent = (fn && ln) ? `${fn} ${ln}` : (getName(subject) || getId(subject))
    div.appendChild(span)
    return div
  }

  // ------------------------- icon toggling -------------------------
  _toggle(iconEl, subject, permName) {
    const cur = iconEl.icon
    // none -> allowed -> denied -> none
    let next = "icons:remove"
    if (cur === "icons:remove") next = "icons:check"
    else if (cur === "icons:check") next = "av:not-interested"
    else next = "icons:remove"
    iconEl.icon = next

    // persist if we have enough context, else bubble event
    this._maybePersist()
  }

  async _maybePersist() {
    const vm = this.getPermissionsVM()
    if (this.path && this.resourceType) {
      try {
        await setResourcePermissions(this.path, this.resourceType, vm)
        // no toast here—delegate UX to parent if needed
      } catch (e) {
        // if save fails, emit event so parent can handle/rollback if desired
        this.dispatchEvent(new CustomEvent("permissions-error", { detail: { error: e } }))
      }
    } else {
      this.dispatchEvent(new CustomEvent("permissions-change", { detail: { permissions: vm } }))
    }
  }

  // ------------------------- VM I/O -------------------------
  /**
   * Read current UI into a ResourcePermissionsVM (owners omitted here).
   * Returns: { allowed: PermissionVM[], denied: PermissionVM[] }
   */
  getPermissionsVM() {
    const mk = () => ({ accounts: [], groups: [], applications: [], organizations: [], peers: [] })
    const allowed = { read: mk(), write: mk(), delete: mk() }
    const denied  = { read: mk(), write: mk(), delete: mk() }

    const ensure = (bag, name) => {
      // convert map-like structure to array of PermissionVM at the end
      return bag[name]
    }

    this.shadowRoot.querySelectorAll(".subject-permissions-row").forEach(row => {
      const subject = row.subject
      const kind = subjectKind(subject) // "account" | "group"
      const id = fqid(subject)

      const icons = row.querySelectorAll(".permission-icon")
      icons.forEach(icon => {
        const name = icon.name // read/write/delete
        const ic = icon.icon
        if (ic === "icons:check") {
          const p = ensure(allowed, name)
          if (kind === "account") p.accounts.push(id)
          else if (kind === "group") p.groups.push(id)
        } else if (ic === "av:not-interested") {
          const p = ensure(denied, name)
          if (kind === "account") p.accounts.push(id)
          else if (kind === "group") p.groups.push(id)
        }
      })
    })

    // flatten to arrays
    const toList = (bag) =>
      Object.keys(bag).map(name => ({ name, ...bag[name] }))
        .filter(p => (p.accounts?.length || p.groups?.length || p.applications?.length || p.organizations?.length || p.peers?.length))

    return {
      allowed: toList(allowed),
      denied:  toList(denied),
    }
  }

  /**
   * Initialize/update icons from a ResourcePermissionsVM.
   * Expects: { owners?, allowed: PermissionVM[], denied: PermissionVM[] }
   */
  setPermissions(permissionsVM) {
    // rebuild rows first (keeps current accounts/groups selection)
    this.refresh()

    const setStatus = (fq, permName, status) => {
      const row = this._rowByFqid(fq)
      if (!row) return
      const icon = row.querySelector(`#${row.id}_${permName}`)
      if (!icon) return
      icon.icon = (status === "allowed") ? "icons:check"
                : (status === "denied")  ? "av:not-interested"
                : "icons:remove"
    }

    const applyList = (list, status) => {
      (list || []).forEach(p => {
        const name = p.name
        ;(p.accounts || []).forEach(fq => setStatus(fq, name, status))
        ;(p.groups || []).forEach(fq => setStatus(fq, name, status))
        ;(p.applications || []).forEach(fq => setStatus(fq, name, status))
        ;(p.organizations || []).forEach(fq => setStatus(fq, name, status))
        ;(p.peers || []).forEach(fq => setStatus(fq, name, status))
      })
    }

    // Owners imply full allow for R/W/D — if you pass owners, reflect that first
    if (permissionsVM?.owners) {
      const o = permissionsVM.owners
      const all = []
      ;["accounts","groups","applications","organizations","peers"].forEach(k => {
        (o[k] || []).forEach(fq => all.push(fq))
      })
      all.forEach(fq => {
        setStatus(fq, "read", "allowed")
        setStatus(fq, "write", "allowed")
        setStatus(fq, "delete", "allowed")
      })
    }

    applyList(permissionsVM?.allowed, "allowed")
    applyList(permissionsVM?.denied,  "denied")
  }

  _rowByFqid(fq) {
    const uuid = `_subject_row_${getUuidByString(fq)}`
    return this.shadowRoot.querySelector(`#${uuid}`)
  }
}

customElements.define('globular-shared-subjects-permissions', SharedSubjectsPermissions)
