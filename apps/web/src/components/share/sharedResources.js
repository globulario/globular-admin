// src/widgets/shared_resources.js — new-backend (JS)

import getUuidByString from "uuid-by-string"
import { displayError, displayMessage} from "../../backend/ui/notify";

// RBAC protos (only for SubjectType enum if you still want to reuse it)
import { SubjectType } from "globular-web-client/rbac/rbac_pb"

// ---- New backend wrappers (adjust import paths to your repo) -------------
// Expectation:
// - listSharedResources(ownerFqid: string, subjectFqid: string, subjectType: SubjectType) => Promise<SharedResourceProto[]>
// - removeSubjectFromShare(path: string, subjectFqid: string, subjectType: SubjectType) => Promise<void>
import {
  getSharedResources,
  removeSubjectFromShare,
} from "../../backend/rbac/permissions"

// Current account helper (or keep your AccountController.account if you prefer)
import { getCurrentAccount } from "../../backend/rbac/accounts"

// Files backend: getFile(path, { width, height }) -> Promise<FileVM|proto>
import { getFile } from "../../backend/cms/files"

// UI
import { Link } from "../link"
import '@polymer/paper-tabs/paper-tabs.js'
import '@polymer/paper-tabs/paper-tab.js'
import '@polymer/paper-ripple/paper-ripple.js'
import '@polymer/paper-badge/paper-badge.js'

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

        #container {
          display: flex; flex-direction: column;
          height: 100%; width: 100%; box-sizing: border-box;
        }
        .resource-share-panel {
          flex-grow: 1; position: relative; overflow: hidden; display: flex; flex-direction: column;
        }
        #scroll-container {
          position: absolute; overflow-y: auto; top:0; left:0; right:0; bottom:0; padding:10px;
        }
        #share-with-you-list, #you-share-with-list {
          display:flex; flex-wrap:wrap; margin-top:10px; gap:15px; justify-content:flex-start;
        }
        #you-share-with-list { display:none; }

        globular-link { margin-left: 15px; }

        paper-tabs {
          --paper-tabs-selection-bar-color: var(--primary-color);
          color: var(--primary-text-color);
          --paper-tab-ink: var(--palette-action-disabled);
          width: 100%;
          background: var(--surface-color);
          border-bottom: 1px solid var(--palette-divider);
          flex-shrink: 0;
        }
        paper-tab { padding-right: 25px; }
        paper-tab paper-badge {
          --paper-badge-background: var(--palette-warning-main);
          --paper-badge-width: 16px;
          --paper-badge-height: 16px;
          --paper-badge-margin-left: 10px;
        }

        @media(max-width: 500px){
          #container { width: calc(100vw - 10px); margin: 0; }
          .resource-share-panel { width: calc(100vw - 10px); }
          #scroll-container { padding: 5px; }
          #share-with-you-list, #you-share-with-list { justify-content: center; }
        }
      </style>
      <div id="container">
        <paper-tabs selected="0">
          <paper-tab id="tab-share-with-you">Share with you</paper-tab>
          <paper-tab id="tab-you-share-with">You share with</paper-tab>
        </paper-tabs>

        <div class="resource-share-panel">
          <div id="scroll-container">
            <div id="share-with-you-list"></div>
            <div id="you-share-with-list"></div>
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
    if (which === 'shareWithYou') {
      this._youShareWithDiv.style.display = "none"
      this._shareWithYouDiv.style.display = "flex"
    } else {
      this._youShareWithDiv.style.display = "flex"
      this._shareWithYouDiv.style.display = "none"
    }
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
      const meFqid = fqid(me)
      const subjFqid = fqid(this._subject)

      // You share with (owner = me, shared with subject)
      const youShareWith = await getSharedResources(meFqid, subjFqid, subjectType)
      this._renderList(this._youShareWithDiv, youShareWith, this._subject, true)

      // Shared with you (owner = subject, shared with me)
      const sharedWithYou = await getSharedResources(subjFqid, meFqid, SubjectType.ACCOUNT)
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
  _renderList(containerDiv, resources, subjectContext, isDeletableByYou) {
    if (!containerDiv) return
    if (!resources || resources.length === 0) {
      containerDiv.innerHTML = '<p style="padding: 10px; color: var(--secondary-text-color);">No shared resources found.</p>'
      return
    }

    containerDiv.innerHTML = ""
    resources.forEach(async (r) => {
      try {
        // r is a SharedResource proto/VM with at least getPath(), maybe getDomain()
        const path = r.getPath?.() ?? r.path
        if (!path) return

        // Fetch file details (thumbnail, mime, etc.)
        const file = await getFile(path, { width: 100, height: 64 })

        const id = `_link_${getUuidByString(path)}`
        const subjectType = inferSubjectType(subjectContext)
        const subjectFqid = fqid(subjectContext)

        // decide if current user can delete this share (only in "You share with" list)
        let showDelete = false
        if (isDeletableByYou) {
          // SharedResource usually carries lists: accounts, groups, applications...
          const accounts = r.getAccountsList?.() ?? r.accounts ?? []
          const groups   = r.getGroupsList?.() ?? r.groups ?? []
          if (subjectType === SubjectType.ACCOUNT) {
            showDelete = accounts.includes(subjectFqid)
          } else if (subjectType === SubjectType.GROUP) {
            showDelete = groups.includes(subjectFqid)
          }
        }

        // alias: use media metadata if present, else filename
        let alias = path.substring(path.lastIndexOf("/") + 1)
        const v = file?.videos?.[0]
        const t = file?.titles?.[0]
        const a = file?.audios?.[0]
        if (v?.getDescription) alias = v.getDescription()
        else if (t?.getName) alias = t.getName()
        else if (a?.getTitle) alias = a.getTitle()

        const link = document.createElement('globular-link')
        link.alias = alias
        link.mime = file?.getMime?.() ?? file?.mime ?? ""
        link.id = id
        link.path = path
        link.thumbnail = file?.getThumbnail?.() ?? file?.thumbnail ?? ""
        link.domain = file?.getDomain?.() ?? file?.domain ?? ""
        link.deleteable = !!showDelete
        link.setFileExplorer?.(this._fileExplorer)

        link.ondelete = async () => {
          try {
            await removeSubjectFromShare(path, subjectFqid, subjectType)
            displayMessage(`Unshared "${alias}" from "${getId(subjectContext)}".`, 2500)
            this._load() // refresh lists
          } catch (e) {
            displayError(`Failed to unshare: ${e?.message || e}`, 3000)
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
    })
  }
}

customElements.define('globular-shared-resources', SharedResources)
