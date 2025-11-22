// src/widgets/subjectsView.js

import getUuidByString from "uuid-by-string"

// New backend wrappers (no globule/controllers)
import { getCurrentAccount, listAccounts } from "../../backend/rbac/accounts"
import { listGroups } from "../../backend/rbac/groups"
import { listOrganizations } from "../../backend/rbac/organizations"

// Applications are optional; we'll dynamically import to avoid hard dependency
let listApplications = null
import("../../backend/rbac/applications").then(m => { listApplications = m.listApplications }).catch(() => {})

// UI helpers
import { displayError } from "../../backend/ui/notify"
import { fireResize } from "../utility.js"

// Polymer elements
import "@polymer/iron-icon/iron-icon.js"
import "@polymer/iron-collapse/iron-collapse.js"
import "@polymer/paper-ripple/paper-ripple.js"
import "@polymer/iron-icons/social-icons.js"
import "@polymer/iron-icons/maps-icons.js"
import "@polymer/iron-icons/hardware-icons.js"

/**
 * Lists selectable subjects (Accounts, Groups, Organizations, Applications).
 * Emits callbacks when an item is clicked:
 *   - on_account_click(div, account)
 *   - on_group_click(div, group)
 *   - on_organization_click(div, organization)
 *   - on_application_click(div, application)
 */
export class GlobularSubjectsView extends HTMLElement {
  // Current user (for filtering)
  _account = null

  // Public callbacks (set these from parent):
  on_accounts_change = null
  on_groups_change = null
  on_account_click = null
  on_group_click = null
  on_application_click = null
  on_organization_click = null
  on_subjects_ready = null

  // DOM refs
  _subjectsDiv = null
  _selectorsDiv = null

  _accountsSelector = null; _accountsCounter = null; _accountsCollapsePanel = null; _accountsDiv = null; _accountsTab = null
  _groupsSelector = null; _groupsCounter = null; _groupsCollapsePanel = null; _groupsDiv = null; _groupsTab = null
  _organizationsSelector = null; _organizationsCounter = null; _organizationsCollapsePanel = null; _organizationsDiv = null; _organizationsTab = null
  _applicationsSelector = null; _applicationsCounter = null; _applicationsCollapsePanel = null; _applicationsDiv = null; _applicationsTab = null

  _resizeListener = null

  constructor() {
    super()
    this.attachShadow({ mode: "open" })
  }

  async connectedCallback() {
    // Resolve current account (used to hide self & 'sa')
    try { this._account = await getCurrentAccount() } catch {}

    this._render()
    this._refs()
    this._bind()
    await this._loadAllSubjectsData()
    this._handleWindowResize() // initial responsive layout
  }

  disconnectedCallback() {
    if (this._resizeListener) {
      window.removeEventListener("resize", this._resizeListener)
      this._resizeListener = null
    }
  }

  // Allow parent to override the account later (optional)
  set account(acc) {
    this._account = acc
    this._loadAllSubjectsData()
  }

  // -------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------
  _render() {
    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display:block;
          height:100%;
        }

        #subjects-div {
          display:flex;
          flex-direction:column;
          width:100%;
          height:100%;
          box-sizing:border-box;
          overflow:hidden;
        }

        .vertical-tabs {
          display:flex;
          flex-direction:column;
          flex:1;
          min-height:0;
          gap:10px;
          padding:10px;
          border-radius:10px;
          background: var(--surface-color);
          box-shadow: inset 0 0 0 1px var(--palette-divider);
        }

        .vertical-tab {
          display:flex;
          flex-direction:column;
          flex:0 0 auto;
          min-height:0;
          border-radius:8px;
          border:1px solid var(--palette-divider);
          background: var(--palette-background-paper);
          overflow:hidden;
        }

        .selectors {
          display:flex;
          flex-direction:column;
          gap:4px;
          padding:4px 6px 10px;
          border-bottom:1px solid var(--palette-divider);
        }

        .selector {
          display:flex;
          align-items:center;
          justify-content:space-between;
          gap:8px;
          padding:8px 12px;
          color: var(--primary-text-color);
          background: color-mix(in srgb, var(--palette-primary-accent) 8%, transparent);
          border-radius:4px;
          cursor:pointer;
          position:relative;
          transition: background .2s ease, color .2s ease;
        }
        .selector:hover {
          background: color-mix(in srgb, var(--palette-primary-accent) 18%, transparent);
        }
        .counter { font-size:.85rem; color: var(--secondary-text-color); }

        .subject-div {
          padding:4px 0 8px 0;
          width:100%;
          display:flex;
          flex-direction:column;
          gap:6px;
          overflow-y:auto;
          min-height:0;
        }

        .infos {
          margin:0 12px;
          padding:8px;
          display:flex;
          align-items:center;
          gap:10px;
          border-radius:6px;
          background: var(--surface-color);
          color: var(--primary-text-color);
          box-shadow: var(--shadow-elevation-1dp);
          transition: background .2s ease, box-shadow .2s ease;
        }
        .infos:hover { box-shadow: var(--shadow-elevation-4dp); background: var(--palette-action-hover); }
        .infos.active { border:1px solid var(--primary-color); box-shadow: var(--shadow-elevation-6dp); }

        .infos img { width:44px; height:44px; border-radius:50%; object-fit:cover; }
        .infos iron-icon { width:44px; height:44px; --iron-icon-fill-color: var(--palette-action-disabled); }

        .infos .text { display:flex; flex-direction:column; min-width:0; }
        .infos .text .name { font-size:1rem; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
        .infos .text .sub { font-size:.9rem; color: var(--secondary-text-color); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }

        ::-webkit-scrollbar {
          width: 10px;
        }
        ::-webkit-scrollbar-track {
          background: var(--scroll-track, var(--surface-color));
        }
        ::-webkit-scrollbar-thumb {
          background: var(--scroll-thumb, var(--palette-divider));
          border-radius: 6px;
        }

        @media (max-width: 600px) {
          #subjects-div { margin-right:0; }
          .subject-div {
            flex-direction:row;
            overflow-x:auto;
            gap:8px;
            padding:8px;
          }
          .infos {
            flex-direction:column;
            border:1px solid var(--palette-divider);
            margin:0;
            flex:0 0 120px;
          }
          .selectors {
            display:grid;
            grid-template-columns:repeat(2, minmax(0,1fr));
            gap:6px;
            padding:8px;
            border-bottom:1px solid var(--palette-divider);
          }
          .selectors .selector {
            margin-right:0;
            padding:6px;
            justify-content:center;
          }
          .selectors .counter { display:none; }
        }
      </style>

      <div id="subjects-div">
        <div class="vertical-tabs">
          <div class="selectors">
            <span class="selector" id="accounts-selector">
              Account's <span class="counter" id="accounts-counter"></span>
              <paper-ripple recenters></paper-ripple>
            </span>
            <span class="selector" id="groups-selector">
              Group's <span class="counter" id="groups-counter"></span>
              <paper-ripple recenters></paper-ripple>
            </span>
            <span class="selector" id="organizations-selector">
              Organization's <span class="counter" id="organizations-counter"></span>
              <paper-ripple recenters></paper-ripple>
            </span>
            <span class="selector" id="applications-selector">
              Application's <span class="counter" id="applications-counter"></span>
              <paper-ripple recenters></paper-ripple>
            </span>
          </div>

          <div class="vertical-tab" id="accounts-tab">
            <iron-collapse id="accounts-collapse-panel" opened>
              <div class="subject-div" id="accounts-div"></div>
            </iron-collapse>
          </div>

          <div class="vertical-tab" id="groups-tab">
            <iron-collapse id="groups-collapse-panel">
              <div class="subject-div" id="groups-div"></div>
            </iron-collapse>
          </div>

          <div class="vertical-tab" id="organizations-tab">
            <iron-collapse id="organizations-collapse-panel">
              <div class="subject-div" id="organizations-div"></div>
            </iron-collapse>
          </div>

          <div class="vertical-tab" id="applications-tab">
            <iron-collapse id="applications-collapse-panel">
              <div class="subject-div" id="applications-div"></div>
            </iron-collapse>
          </div>
        </div>
      </div>
    `
  }

  _refs() {
    this._subjectsDiv = this.shadowRoot.querySelector("#subjects-div")
    this._selectorsDiv = this.shadowRoot.querySelector(".selectors")

    this._accountsSelector = this.shadowRoot.querySelector("#accounts-selector")
    this._accountsCounter = this.shadowRoot.querySelector("#accounts-counter")
    this._accountsCollapsePanel = this.shadowRoot.querySelector("#accounts-collapse-panel")
    this._accountsDiv = this.shadowRoot.querySelector("#accounts-div")
    this._accountsTab = this.shadowRoot.querySelector("#accounts-tab")

    this._groupsSelector = this.shadowRoot.querySelector("#groups-selector")
    this._groupsCounter = this.shadowRoot.querySelector("#groups-counter")
    this._groupsCollapsePanel = this.shadowRoot.querySelector("#groups-collapse-panel")
    this._groupsDiv = this.shadowRoot.querySelector("#groups-div")
    this._groupsTab = this.shadowRoot.querySelector("#groups-tab")

    this._organizationsSelector = this.shadowRoot.querySelector("#organizations-selector")
    this._organizationsCounter = this.shadowRoot.querySelector("#organizations-counter")
    this._organizationsCollapsePanel = this.shadowRoot.querySelector("#organizations-collapse-panel")
    this._organizationsDiv = this.shadowRoot.querySelector("#organizations-div")
    this._organizationsTab = this.shadowRoot.querySelector("#organizations-tab")

    this._applicationsSelector = this.shadowRoot.querySelector("#applications-selector")
    this._applicationsCounter = this.shadowRoot.querySelector("#applications-counter")
    this._applicationsCollapsePanel = this.shadowRoot.querySelector("#applications-collapse-panel")
    this._applicationsDiv = this.shadowRoot.querySelector("#applications-div")
    this._applicationsTab = this.shadowRoot.querySelector("#applications-tab")
  }

  _bind() {
    // Accordion behavior
    this._accountsSelector.addEventListener("click", () => this._toggle("accounts"))
    this._groupsSelector.addEventListener("click", () => this._toggle("groups"))
    this._organizationsSelector.addEventListener("click", () => this._toggle("organizations"))
    this._applicationsSelector.addEventListener("click", () => this._toggle("applications"))

    // Responsive layout
    this._resizeListener = this._handleWindowResize.bind(this)
    window.addEventListener("resize", this._resizeListener)
  }

  _toggle(which) {
    const map = {
      accounts: this._accountsCollapsePanel,
      groups: this._groupsCollapsePanel,
      organizations: this._organizationsCollapsePanel,
      applications: this._applicationsCollapsePanel,
    }
    Object.entries(map).forEach(([k, panel]) => {
      if (!panel) return
      if (k === which) panel.toggle()
      else if (panel.opened) panel.toggle()
    })
  }

  _handleWindowResize() {
    const isMobile = document.body.clientWidth <= 500
    const items = [
      { el: this._accountsSelector, tab: this._accountsTab },
      { el: this._groupsSelector, tab: this._groupsTab },
      { el: this._organizationsSelector, tab: this._organizationsTab },
      { el: this._applicationsSelector, tab: this._applicationsTab },
    ]
    items.forEach(({ el, tab }) => {
      if (!el || !tab) return
      if (isMobile) {
        if (el.parentNode !== this._selectorsDiv) this._selectorsDiv.appendChild(el)
      } else {
        if (el.parentNode !== tab) tab.insertBefore(el, tab.firstChild)
      }
    })
  }

  // -------------------------------------------------------------------
  // Data loading (new backend)
  // -------------------------------------------------------------------
  async _loadAllSubjectsData() {
    this._clearAll()

    // ACCOUNTS
    try {
      const meId = subjId(this._account)
      const accounts = await listAccounts("{}")
      let count = 0
      for (const a of accounts || []) {
        const id = subjId(a)
        if (id === "sa" || id === meId) continue
        this._appendSubjectInfo(this._accountsDiv, a, "account")
        count++
      }
      this._accountsCounter.textContent = `(${count})`
      this._accountsSelector.style.display = count ? "" : "none"
    } catch (e) {
      displayError(`Failed to load accounts: ${msg(e)}`, 3000)
      this._accountsCounter.textContent = "(Error)"
      this._accountsSelector.style.display = "none"
    }

    // GROUPS
    try {
      const groups = await listGroups("{}")
      const len = (groups || []).length
      for (const g of groups || []) this._appendSubjectInfo(this._groupsDiv, g, "group")
      this._groupsCounter.textContent = `(${len})`
      this._groupsSelector.style.display = len ? "" : "none"
    } catch (e) {
      displayError(`Failed to load groups: ${msg(e)}`, 3000)
      this._groupsCounter.textContent = "(Error)"
      this._groupsSelector.style.display = "none"
    }

    // ORGANIZATIONS
    try {
      const orgs = await listOrganizations("{}")
      const len = (orgs || []).length
      for (const o of orgs || []) this._appendSubjectInfo(this._organizationsDiv, o, "organization")
      this._organizationsCounter.textContent = `(${len})`
      this._organizationsSelector.style.display = len ? "" : "none"
    } catch (e) {
      displayError(`Failed to load organizations: ${msg(e)}`, 3000)
      this._organizationsCounter.textContent = "(Error)"
      this._organizationsSelector.style.display = "none"
    }

    // APPLICATIONS (optional)
    if (typeof listApplications === "function") {
      try {
        const apps = await listApplications("{}")
        const len = (apps || []).length
        for (const a of apps || []) this._appendSubjectInfo(this._applicationsDiv, a, "application")
        this._applicationsCounter.textContent = `(${len})`
        this._applicationsSelector.style.display = len ? "" : "none"
      } catch (e) {
        // Non-fatal; hide the tab if failing
        this._applicationsCounter.textContent = "(Error)"
        this._applicationsSelector.style.display = "none"
      }
    } else {
      this._applicationsSelector.style.display = "none"
    }

    // Helper to open panel if it has items
    function openIf(panel, counterEl) {
      const t = counterEl.textContent || ""
      if (t !== "(0)" && t !== "" && t !== "(Error)") { panel.toggle?.(); return true }
      return false
    }
    if (!this._accountsCollapsePanel.opened && !this._groupsCollapsePanel.opened &&
        !this._organizationsCollapsePanel.opened && !this._applicationsCollapsePanel.opened) {
      openIf(this._accountsCollapsePanel, this._accountsCounter) ||
      openIf(this._groupsCollapsePanel, this._groupsCounter) ||
      openIf(this._organizationsCollapsePanel, this._organizationsCounter) ||
      openIf(this._applicationsCollapsePanel, this._applicationsCounter)
    }

    fireResize()
    this._notifySubjectsReady()
  }

  _clearAll() {
    this._accountsDiv.innerHTML = ""
    this._groupsDiv.innerHTML = ""
    this._organizationsDiv.innerHTML = ""
    this._applicationsDiv.innerHTML = ""
  }

  // -------------------------------------------------------------------
  // UI item creation
  // -------------------------------------------------------------------
  _appendSubjectInfo(containerDiv, subject, type) {
    const uid = `_subject_${getUuidByString(`${subjId(subject) || ""}@${subjDomain(subject) || ""}`)}`
    const name = displayName(subject, type)
    const sub = subtitle(subject, type)
    const { img, icon } = iconFor(subject, type)

    const html = `
      <div id="${uid}" class="infos">
        ${img ? `<img src="${img}" alt="${name}">` : `<iron-icon icon="${icon}"></iron-icon>`}
        <div class="text">
          <span class="name" title="${name}">${name}</span>
          <span class="sub" title="${sub}">${sub}</span>
        </div>
      </div>
    `
    containerDiv.appendChild(document.createRange().createContextualFragment(html))

    const subjectDiv = containerDiv.querySelector(`#${uid}`)
    subjectDiv.subject = subject
    subjectDiv.addEventListener("click", () => this._handleSubjectClick(subjectDiv, subject, type))
  }

  _handleSubjectClick(div, subject, type) {
    this.shadowRoot.querySelectorAll(".infos").forEach(el => el.classList.remove("active"))
    div.classList.add("active")

    if (type === "account" && this.on_account_click) this.on_account_click(div, subject)
    else if (type === "group" && this.on_group_click) this.on_group_click(div, subject)
    else if (type === "organization" && this.on_organization_click) this.on_organization_click(div, subject)
    else if (type === "application" && this.on_application_click) this.on_application_click(div, subject)
  }

  _notifySubjectsReady() {
    if (typeof this.on_subjects_ready !== "function") return
    const collect = (container, prop) => {
      const out = []
      if (!container?.children) return out
      Array.from(container.children).forEach((child) => {
        if (child.subject) out.push(child.subject)
        else if (child[prop]) out.push(child[prop])
      })
      return out
    }
    this.on_subjects_ready({
      accounts: collect(this._accountsDiv, "account"),
      groups: collect(this._groupsDiv, "group"),
      organizations: collect(this._organizationsDiv, "organization"),
      applications: collect(this._applicationsDiv, "application")
    })
  }
}

customElements.define("globular-subjects-view", GlobularSubjectsView)

// =====================================================================
// Helpers — tolerate VM or proto-like objects
// =====================================================================
function subjId(x) { return x?.id ?? x?.getId?.() }
function subjDomain(x) { return x?.domain ?? x?.getDomain?.() }
function subjName(x) { return x?.name ?? x?.getName?.() }
function subjEmail(x) { return x?.email ?? x?.getEmail?.() }
function firstName(x) { return x?.firstName ?? x?.firstname ?? x?.getFirstName?.() ?? x?.getFirstname?.() }
function lastName(x) { return x?.lastName ?? x?.lastname ?? x?.getLastName?.() ?? x?.getLastname?.() }
function profilePicture(x) { return x?.profilePicture ?? x?.profilepicture ?? x?.getProfilePicture?.() ?? x?.getProfilepicture?.() }
function version(x) { return x?.version ?? x?.getVersion?.() }
function appIcon(x) { return x?.icon ?? x?.getIcon?.() }

function displayName(x, type) {
  if (type === "account") {
    const fn = firstName(x), ln = lastName(x)
    if (fn && ln) return `${fn} ${ln}`
  }
  return subjName(x) || subjId(x) || "(unknown)"
}

function subtitle(x, type) {
  if (type === "account") return subjEmail(x) || subjDomain(x) || ""
  if (type === "application") return version(x) ? `v${version(x)}` : (subjDomain(x) || "")
  return subjDomain(x) || ""
}

function iconFor(x, type) {
  if (type === "account") {
    const pic = profilePicture(x)
    return { img: pic || null, icon: "account-circle" }
  }
  if (type === "group") return { img: null, icon: "social:people" }
  if (type === "organization") return { img: null, icon: "social:domain" }
  if (type === "application") {
    const ico = appIcon(x)
    return { img: ico || null, icon: "apps" }
  }
  return { img: null, icon: "help-outline" }
}

function msg(e) { return e?.message || String(e || "error") }
