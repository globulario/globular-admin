// src/widgets/shared_resources.js — new-backend (JS)

import getUuidByString from "uuid-by-string"
import { displayError, displayMessage} from "@globular/sdk";

import { SubjectType } from "@globular/sdk"

// ---- New backend wrappers (adjust import paths to your repo) -------------
// Expectation:
// - listSharedResources(ownerFqid: string, subjectFqid: string, subjectType: SubjectType) => Promise<SharedResourceProto[]>
// - removeSubjectFromShare(path: string, subjectFqid: string, subjectType: SubjectType) => Promise<void>
import {
  getSharedResources,
  removeSubjectFromShare,
  getResourcePermissions,
  toPermissionsVM,
} from "@globular/sdk"

// Current account helper (or keep your AccountController.account if you prefer)
import { getCurrentAccount } from "@globular/sdk"

// Files backend: getFile(path, { width, height }) -> Promise<FileVM|proto>
import { getFile } from "@globular/sdk"

// UI
import { Link } from "../link"
import { Backend } from "@globular/sdk"

// -------------------------------------------------------------------------
// subject helpers (shape-based; avoids proto instanceof)
// -------------------------------------------------------------------------
const getId     = (o) => o?.getId?.() ?? o?.id ?? ""
const getDomain = (o) => o?.getDomain?.() ?? o?.domain ?? ""

// Best-effort subject type inference for VMs or protos.
function inferSubjectType(subject) {
  if (!subject) return SubjectType.ACCOUNT
  // Prefer explicit hint if present
  if (typeof subject.subjectType === "number") return subject.subjectType
  if (typeof subject.type === "string") {
    const t = subject.type.toLowerCase()
    if (t.includes("group")) return SubjectType.GROUP
    if (t.includes("account") || t.includes("user")) return SubjectType.ACCOUNT
  }
  // Heuristics
  if ("email" in subject || "profilePicture" in subject || "firstName" in subject) {
    return SubjectType.ACCOUNT
  }
  if ("members" in subject || "membersList" in subject || "roles" in subject) {
    // groups tend to expose members/roles
    return SubjectType.GROUP
  }
  // Default to account
  return SubjectType.ACCOUNT
}
const fqid = (o) => `${getId(o)}@${getDomain(o)}`

// -------------------------------------------------------------------------
// Component
// -------------------------------------------------------------------------
export class SharedResources extends HTMLElement {
  constructor() {
    super()
    this.attachShadow({ mode: 'open' })

    // state
    this._fileExplorer = null
    this._subject = null

    // refs
    this._scrollContainer = null
    this._shareWithYouDiv = null
    this._youShareWithDiv = null
    this._shareWithYouTab = null
    this._youShareWithTab = null
  }

  connectedCallback() {
    this._render()
    this._refs()
    this._bind()
  }

  setFileExplorer(explorer) {
    this._fileExplorer = explorer
  }

  set subject(subject) {
    if (this._subject !== subject) {
      this._subject = subject
      this._load()
    }
  }

  // -------------------------- render -------------------------------------
  _render() {
    this.shadowRoot.innerHTML = `
      <style>
        ::-webkit-scrollbar { width: 8px; }
        ::-webkit-scrollbar-track { background: var(--scroll-track, var(--surface-color)); }
        ::-webkit-scrollbar-thumb { background: var(--scroll-thumb, var(--palette-divider)); border-radius: 4px; }

        #container {
          display: flex; flex-direction: column;
          height: 100%; width: 100%; box-sizing: border-box;
        }
        .resource-share-panel {
          flex-grow: 1; position: relative; overflow: hidden; display: flex; flex-direction: column;
        }
        #scroll-container {
          position: absolute; overflow-y: auto; top: 0; left: 0; right: 0; bottom: 0;
          padding: 16px;
        }
        #share-with-you-list, #you-share-with-list {
          display: none;
          flex-wrap: wrap;
          gap: 12px;
          justify-content: flex-start;
          align-items: flex-start;
        }
        #you-share-with-list { display: flex; }

        .empty-state {
          font-size: .85rem;
          color: var(--secondary-text-color);
          padding: 24px 0;
          text-align: center;
          width: 100%;
        }

        paper-tabs {
          --paper-tabs-selection-bar-color: var(--accent-color);
          color: var(--primary-text-color);
          --paper-tab-ink: var(--palette-action-disabled);
          width: 100%;
          background: color-mix(in srgb, var(--on-surface-color) 3%, var(--surface-color));
          border-bottom: 1px solid color-mix(in srgb, var(--palette-divider) 50%, transparent);
          flex-shrink: 0;
        }
        paper-tab {
          padding-right: 25px;
          font-size: .85rem;
          color: var(--secondary-text-color);
        }
        paper-tab.iron-selected {
          color: var(--primary-text-color);
          font-weight: 600;
        }

        @media(max-width: 500px){
          #container { width: calc(100vw - 10px); margin: 0; }
          .resource-share-panel { width: calc(100vw - 10px); }
          #scroll-container { padding: 8px; }
          #share-with-you-list, #you-share-with-list { justify-content: center; }
        }
      </style>
      <div id="container">
        <paper-tabs id="share-tabs" selected="0">
          <paper-tab id="tab-you-share-with">You share with</paper-tab>
          <paper-tab id="tab-share-with-you">Share with you</paper-tab>
        </paper-tabs>

        <div class="resource-share-panel">
          <div id="scroll-container">
            <div id="you-share-with-list"></div>
            <div id="share-with-you-list"></div>
          </div>
        </div>
      </div>
    `
  }

  _refs() {
    this._scrollContainer = this.shadowRoot.querySelector("#scroll-container")
    this._shareWithYouDiv = this.shadowRoot.querySelector("#share-with-you-list")
    this._youShareWithDiv = this.shadowRoot.querySelector("#you-share-with-list")
    this._shareWithYouTab = this.shadowRoot.querySelector("#tab-share-with-you")
    this._youShareWithTab = this.shadowRoot.querySelector("#tab-you-share-with")
    this._tabs = this.shadowRoot.querySelector("#share-tabs")
  }

  _bind() {
    this._scrollContainer?.addEventListener('scroll', () => {
      if (this._scrollContainer.scrollTop === 0) {
        this._scrollContainer.style.boxShadow = ""
        this._scrollContainer.style.borderTop = ""
      } else {
        this._scrollContainer.style.boxShadow = "inset 0px 5px 6px -3px rgba(0,0,0,.40)"
        this._scrollContainer.style.borderTop = "1px solid var(--palette-divider)"
      }
    })
    this._shareWithYouTab?.addEventListener('click', () => this._switchTab('shareWithYou'))
    this._youShareWithTab?.addEventListener('click', () => this._switchTab('youShareWith'))
  }

  _switchTab(which) {
    const showShareWithYou = which === 'shareWithYou'
    this._shareWithYouDiv.style.display = showShareWithYou ? "flex" : "none"
    this._youShareWithDiv.style.display = showShareWithYou ? "none" : "flex"
    if (this._tabs) this._tabs.selected = showShareWithYou ? 1 : 0
  }

  // -------------------------- data load ----------------------------------
  async _load() {
    if (!this._subject) return
    this._clear()

    try {
      const me = await getCurrentAccount()
      if (!me) {
        displayError("Not authenticated.", 2500)
        return
      }

      const subjectType = inferSubjectType(this._subject)
      const meId = getId(me)
      const meFqid = fqid(me)
      const subjId = getId(this._subject)
      const subjFqid = fqid(this._subject)

      // You share with (owner = me, shared with subject)
      // Try plain ID first (server may store owner without domain), fall back to fqid
      let youShareWith = await getSharedResources(meId, subjFqid, subjectType)
      if ((!youShareWith || youShareWith.length === 0) && meId !== meFqid) {
        youShareWith = await getSharedResources(meFqid, subjFqid, subjectType)
      }
      this._renderList(this._youShareWithDiv, youShareWith, this._subject, true)

      // Shared with you (owner = subject, shared with me)
      let sharedWithYou = await getSharedResources(subjId, meFqid, SubjectType.ACCOUNT)
      if ((!sharedWithYou || sharedWithYou.length === 0) && subjId !== subjFqid) {
        sharedWithYou = await getSharedResources(subjFqid, meFqid, SubjectType.ACCOUNT)
      }
      // Also try with plain meId
      if ((!sharedWithYou || sharedWithYou.length === 0)) {
        sharedWithYou = await getSharedResources(subjId, meId, SubjectType.ACCOUNT)
      }
      this._renderList(this._shareWithYouDiv, sharedWithYou, me, false)

    } catch (e) {
      displayError(`Failed to load shared resources: ${e?.message || e}`, 3000)
      console.error(e)
    }
  }

  _clear() {
    if (this._youShareWithDiv) this._youShareWithDiv.innerHTML = ""
    if (this._shareWithYouDiv) this._shareWithYouDiv.innerHTML = ""
  }

  // -------------------------- list render --------------------------------
  async _renderList(containerDiv, resources, subjectContext, isDeletableByYou) {
    if (!containerDiv) return
    if (!resources || resources.length === 0) {
      containerDiv.innerHTML = '<div class="empty-state">No shared resources found.</div>'
      return
    }

    containerDiv.innerHTML = ""
    for (const r of resources) {
      try {
        const path = r.getPath?.() ?? r.path
        if (!path) continue

        const file = await getFile(path, { width: 100, height: 64 })
        const id = `_link_${getUuidByString(path)}`
        const subjectType = inferSubjectType(subjectContext)
        const subjectFqid = fqid(subjectContext)

        let showDelete = false
        if (isDeletableByYou) {
          const accounts = (r.getAccountsList?.() ?? r.accounts ?? []).map(a => String(a).toLowerCase())
          const groups = (r.getGroupsList?.() ?? r.groups ?? []).map(g => String(g).toLowerCase())
          const subjId = getId(subjectContext).toLowerCase()
          const subjFq = subjectFqid.toLowerCase()
          if (subjectType === SubjectType.ACCOUNT) {
            showDelete = accounts.includes(subjFq) || accounts.includes(subjId)
          } else if (subjectType === SubjectType.GROUP) {
            showDelete = groups.includes(subjFq) || groups.includes(subjId)
          }
        }

        let alias = path.substring(path.lastIndexOf("/") + 1)
        const v = file?.videos?.[0]
        const t = file?.titles?.[0]
        const a = file?.audios?.[0]
        if (v?.getDescription) alias = v.getDescription()
        else if (t?.getName) alias = t.getName()
        else if (a?.getTitle) alias = a.getTitle()

        const link = new Link()
        link.id = id
        link.setAttribute("path", path)
        const thumb = file?.getThumbnail?.() ?? file?.thumbnail ?? ""
        if (thumb) link.setAttribute("thumbnail", thumb)
        const domain = file?.getDomain?.() ?? file?.domain ?? ""
        if (domain) link.setAttribute("domain", domain)
        if (alias) link.setAttribute("alias", alias)
        const mime = file?.getMime?.() ?? file?.mime ?? ""
        if (mime) link.setAttribute("mime", mime)
        if (showDelete) link.setAttribute("deleteable", "true")
        const badgeLabel = await computePermissionBadge(r, subjectContext)
        if (badgeLabel) link.setAttribute("permission-badge", badgeLabel)
        link.setFileExplorer?.(this._fileExplorer)

        link.ondelete = async () => {
          try {
            await removeSubjectFromShare(path, subjectFqid, subjectType)
            displayMessage(`Unshared "${alias}" from "${getId(subjectContext)}".`, 2500)
            this._load()
          } catch (e) {
            displayError(`Failed to unshare: ${e?.message || e}`, 3000)
          }
        }

        link.onedit = async () => {
          try {
            const fileInfo = await getFile(path, { width: 64, height: 64 })
            Backend.eventHub.publish(
              `display_permission_manager_${this._fileExplorer?._id || ""}_event`,
              fileInfo,
              true
            )
          } catch (e) {
            displayError(`Failed to edit permissions: ${e?.message || e}`, 3000)
          }
        }

        containerDiv.appendChild(link)
      } catch (err) {
        console.error("Error rendering shared item:", err)
        const broken = document.createElement('div')
        const path = r.getPath?.() ?? r.path ?? "(unknown)"
        broken.innerHTML = `<span style="color: var(--palette-error-main);">[Broken Link] ${path.substring(path.lastIndexOf("/") + 1)}</span>`
        containerDiv.appendChild(broken)
      }
    }
  }
}

customElements.define('globular-shared-resources', SharedResources)

const permissionsCache = new Map()

export function clearPermissionsCache(paths) {
  if (!paths) return
  const list = Array.isArray(paths) ? paths : [paths]
  list.forEach((p) => permissionsCache.delete(p))
}

async function computePermissionBadge(sharedResource, subjectContext) {
  const path = sharedResource?.getPath?.() ?? sharedResource?.path
  const subjectKey = normalizeSubjectKey(subjectContext)
  if (!path || !subjectKey) {
    return "R"
  }
  try {
    const vm = await permissionsForPath(path)
    if (!vm) return "R"
    const subjectType = inferSubjectType(subjectContext)
    if (entryHasSubject(vm.owners, subjectType, subjectKey)) {
      return "Owner"
    }
    if (hasPermission(vm, "delete", subjectType, subjectKey)) {
      return "Manage"
    }
    if (hasPermission(vm, "write", subjectType, subjectKey)) {
      return "RW"
    }
    if (vm.allowed?.some((entry) => entryHasSubject(entry, subjectType, subjectKey))) {
      return "R"
    }
  } catch (err) {
    console.warn("computePermissionBadge failed", err)
  }
  return "R"
}

async function permissionsForPath(path) {
  if (!path) return null
  if (!permissionsCache.has(path)) {
    const prom = getResourcePermissions(path)
      .then((perms) => (perms ? toPermissionsVM(perms) : null))
      .catch((err) => {
        console.warn("getResourcePermissions failed", err)
        permissionsCache.delete(path)
        return null
      })
    permissionsCache.set(path, prom)
  }
  return permissionsCache.get(path)
}

function normalizeSubjectKey(subject) {
  if (!subject) return ""
  if (typeof subject === "string") {
    return subject.toLowerCase()
  }
  if (typeof subject === "object") {
    if (subject.fqid) return String(subject.fqid).toLowerCase()
    const id = (subject.getId?.() ?? subject.id ?? "").trim()
    const domain = (subject.getDomain?.() ?? subject.domain ?? "").trim()
    if (!id) return ""
    return (domain ? `${id}@${domain}` : id).toLowerCase()
  }
  return ""
}

function entryHasSubject(entry, subjectType, subjectKey) {
  if (!entry || !subjectKey) return false
  const check = (arr = []) => arr.some((val) => String(val || "").toLowerCase() === subjectKey)
  switch (subjectType) {
    case SubjectType.ACCOUNT:
      return check(entry.accounts)
    case SubjectType.GROUP:
      return check(entry.groups)
    case SubjectType.ORGANIZATION:
      return check(entry.organizations)
    case SubjectType.APPLICATION:
      return check(entry.applications)
    case SubjectType.PEER:
      return check(entry.peers)
    default:
      return (
        check(entry.accounts) ||
        check(entry.groups) ||
        check(entry.organizations) ||
        check(entry.applications) ||
        check(entry.peers)
      )
  }
}

function hasPermission(vm, permName, subjectType, subjectKey) {
  if (!vm?.allowed || !permName) return false
  const target = vm.allowed.find((entry) => (entry.name || "").toLowerCase() === permName.toLowerCase())
  if (!target) return false
  return entryHasSubject(target, subjectType, subjectKey)
}