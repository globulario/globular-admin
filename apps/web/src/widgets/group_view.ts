// widgets/group_view.ts
// <globular-group-view> — works with GroupVM *or* legacy proto-like groups

import { displayError } from "../backend/ui/notify"
import { AccountVM, getAccount } from "../backend/rbac/accounts"              // adjust if needed
import type { GroupVM } from "../backend/rbac/groups"                        // adjust if needed
import "./user_view"                                              // ensures <globular-user-view> is registered

// Legacy proto-like shape (for backward compatibility)
type GroupProtoLike = {
  getId?: () => string
  getName?: () => string
  getDescription?: () => string
  getMembersList?: () => string[]
} | null

type AnyGroup = GroupVM | GroupProtoLike | null

/** Coerce either GroupVM or proto-like object into GroupVM */
function coerceGroup(a: AnyGroup): GroupVM {
  if (!a) return { id: "", name: "", description: "", members: [] }

  // If it looks like a VM already
  if ((a as GroupVM).name !== undefined || (a as any).members) {
    const g = a as GroupVM
    return {
      id: g.id || "",
      name: g.name || "",
      description: g.description || "",
      members: Array.isArray(g.members) ? g.members.slice() : [],
    }
  }

  // Proto-like (with getters)
  const p = a as GroupProtoLike
  return {
    id: p?.getId?.() || "",
    name: p?.getName?.() || "",
    description: p?.getDescription?.() || "",
    members: p?.getMembersList?.() || [],
  }
}

export class GroupView extends HTMLElement {
  static get observedAttributes() { return ["closeable", "addable", "summary"] }

  /** Consumer hooks */
  public onClose?: () => void
  public onAdd?: () => void

  private root: ShadowRoot
  private _group: GroupVM = { id: "", name: "", description: "", members: [] }

  // cached refs
  private titleEl?: HTMLSpanElement | null
  private subTitleEl?: HTMLSpanElement | null
  private details?: any | null         // <iron-collapse>
  private membersCountEl?: HTMLSpanElement | null
  private closeBtn?: HTMLElement | null
  private addBtn?: HTMLElement | null
  private content?: HTMLElement | null

  constructor(group?: AnyGroup) {
    super()
    this.root = this.attachShadow({ mode: "open" })
    if (group) this._group = coerceGroup(group)
  }

  connectedCallback() {
    this.render()
    this.applyAttributes()
    this.refresh() // initial data fill
  }

  disconnectedCallback() {
    // no global listeners by default
  }

  attributeChangedCallback(name: string, _old: string | null, val: string | null) {
    if (!this.isConnected) return
    switch (name) {
      case "closeable":
        if (this.closeBtn) this.closeBtn.style.display = val === "true" ? "block" : "none"
        break
      case "addable":
        if (this.addBtn) this.addBtn.style.display = val === "true" ? "block" : "none"
        break
      case "summary":
        if (this.details) this.details.opened = val !== "true"
        break
    }
  }

  /** Preferred: set a GroupVM */
  set groupVM(g: GroupVM) {
    this._group = coerceGroup(g)
    this.refresh()
  }
  get groupVM(): GroupVM { return this._group }

  /** Back-compat: accept proto-like or VM */
  setGroup(g: AnyGroup) {
    this._group = coerceGroup(g)
    this.refresh()
  }

  // -------- internals --------
  private render() {
    this.root.innerHTML = `
      <style>
        @import url('./styles.css');
        :host { display: inline-block; }
        #content {
          display:flex; flex-direction:column;
          background: var(--surface-color); color: var(--on-surface-color);
          padding: 1rem; border-radius: .5rem;
        }
        #content:hover { cursor: pointer; }
        .row { display:flex; align-items:center; gap:.5rem; }
        #title {
          font-size: 1rem; line-height:1.5rem; flex:1 1 auto; text-decoration: underline;
        }
        #sub-title { font-size: .9rem; opacity:.9; }
        #close-btn, #add-btn {
          width: 30px; height: 30px;
          --iron-icon-width: 10px; --iron-icon-height: 10px;
          display:none; /* toggled by attributes */
        }
        #details { display:flex; flex-direction:column; padding: .5rem 1rem; }
        .members { display:flex; flex-wrap:wrap; gap:.5rem; padding: .5rem 0; }
        iron-collapse { --iron-collapse-transition-duration: .3s; }
        iron-collapse[aria-hidden="true"] {
          max-height:0; width:0; overflow:hidden; padding:0;
        }
      </style>
      <div id="content">
        <div class="row">
          <paper-icon-button id="close-btn" icon="icons:close" role="button" tabindex="0" aria-disabled="false"></paper-icon-button>
          <paper-icon-button id="add-btn" icon="icons:add" role="button" tabindex="0" aria-disabled="false"></paper-icon-button>
          <span id="title"></span>
        </div>
        <iron-collapse id="details">
          <span id="sub-title"></span>
          <div style="display:flex; flex-direction:column; padding:.5rem 0;">
            <span id="members-count">Members (0)</span>
            <div class="members">
              <slot name="members"></slot>
            </div>
          </div>
        </iron-collapse>
      </div>
    `

    // cache
    this.titleEl = this.root.getElementById("title") as HTMLSpanElement
    this.subTitleEl = this.root.getElementById("sub-title") as HTMLSpanElement
    this.details = this.root.getElementById("details")
    this.membersCountEl = this.root.getElementById("members-count") as HTMLSpanElement
    this.closeBtn = this.root.getElementById("close-btn")
    this.addBtn = this.root.getElementById("add-btn")
    this.content = this.root.getElementById("content")

    // listeners
    this.titleEl?.addEventListener("click", (e) => {
      e.stopPropagation()
      this.details?.toggle?.()
    })
    this.content?.addEventListener("click", () => {
      if (this._group?.id) {
        this.dispatchEvent(new CustomEvent("currentGroupIdChanged", { bubbles: true, detail: this._group.id }))
      }
    })
    this.closeBtn?.addEventListener("click", (e) => {
      e.stopPropagation()
      this.onClose?.()
    })
    this.addBtn?.addEventListener("click", (e) => {
      e.stopPropagation()
      this.onAdd?.()
    })
  }

  private applyAttributes() {
    this.attributeChangedCallback("closeable", null, this.getAttribute("closeable"))
    this.attributeChangedCallback("addable", null, this.getAttribute("addable"))
    this.attributeChangedCallback("summary", null, this.getAttribute("summary"))
  }

  /** Refresh text + (re)load members */
  private async refresh() {
    // text
    if (this.titleEl) this.titleEl.textContent = this._group.name || ""
    if (this.subTitleEl) this.subTitleEl.textContent = this._group.description || ""
    if (this.membersCountEl) {
      const n = Array.isArray(this._group.members) ? this._group.members.length : 0
      this.membersCountEl.textContent = `Members (${n})`
    }

    // clear old member views (only the slotted children we added)
    this.querySelectorAll('globular-user-view[slot="members"]').forEach(el => el.remove())

    // add current members
    const ids = Array.isArray(this._group.members) ? this._group.members : []
    for (const memberId of ids) {
      try {
        const acc: AccountVM | null = await getAccount(memberId)
        // Create the view even if acc is null, with fallbacks
        const el = document.createElement("globular-user-view") as any
        if (acc) el.accountVM = acc
        else el.accountVM = { id: memberId, name: memberId, username: memberId }
        el.slot = "members"
        this.appendChild(el)
      } catch (err: any) {
        console.warn(`Failed loading member ${memberId}:`, err?.message || err)
        displayError(err?.message || `Failed to load member ${memberId}`)
      }
    }
  }
}

customElements.define("globular-group-view", GroupView)
