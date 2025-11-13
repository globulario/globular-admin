// widgets/group_view.ts
// <globular-group-view> — works with GroupVM *or* legacy proto-like groups

import { displayError } from "../backend/ui/notify"
import { AccountVM, getAccount } from "../backend/rbac/accounts"              // adjust if needed
import type { GroupVM } from "../backend/rbac/groups"                        // adjust if needed
import "./user_view"                                                         // ensures <globular-user-view> is registered

// Legacy proto-like shape (for backward compatibility)
type GroupProtoLike = {
    getId?: () => string
    getName?: () => string
    getDescription?: () => string
    getMembersList?: () => string[]
    getIcon?: () => string
} | null

type AnyGroup = GroupVM | GroupProtoLike | null

const DEFAULT_GROUP_ICON = "assets/icons/group.svg"
const groupIcon = new URL('../assets/icons/group.svg', import.meta.url).href;

/** Coerce either GroupVM or proto-like object into a GroupVM-like object with icon support */
function coerceGroup(a: AnyGroup): GroupVM & { icon?: string } {
    if (!a) return { id: "", name: "", description: "", members: [], icon: groupIcon } as any

    // If it looks like a VM already
    if ((a as GroupVM).name !== undefined || (a as any).members) {
        const g = a as GroupVM & { icon?: string }
        return {
            id: g.id || "",
            name: g.name || "",
            description: g.description || "",
            members: Array.isArray(g.members) ? g.members.slice() : [],
            icon: g.icon || groupIcon,
        } as any
    }

    // Proto-like (with getters)
    const p = a as GroupProtoLike
    return {
        id: p?.getId?.() || "",
        name: p?.getName?.() || "",
        description: p?.getDescription?.() || "",
        members: p?.getMembersList?.() || [],
        icon: p?.getIcon?.() || groupIcon,
    } as any
}

export class GroupView extends HTMLElement {
    static get observedAttributes() { return ["closeable", "addable", "summary"] }

    /** Consumer hooks */
    public onClose?: () => void
    public onAdd?: () => void

    private root: ShadowRoot
    private _group: (GroupVM & { icon?: string }) = { id: "", name: "", description: "", members: [], icon: groupIcon } as any

    // cached refs
    private titleEl?: HTMLSpanElement | null
    private subTitleEl?: HTMLSpanElement | null
    private details?: any | null         // <iron-collapse>
    private membersCountEl?: HTMLSpanElement | null
    private closeBtn?: HTMLElement | null
    private addBtn?: HTMLElement | null
    private content?: HTMLElement | null
    private iconEl?: HTMLImageElement | null
    private badgeEl?: HTMLSpanElement | null

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
    // REPLACE your current render() with this:
    private render() {
        this.root.innerHTML = `
    <style>
      @import url('./styles.css');

      :host { display:inline-block; width: 280px; }

      #content {
        background: var(--surface-color);
        color: var(--on-surface-color);
        border-radius: .75rem;
        box-shadow: 0 0 0 1px var(--divider-color);
        padding: .75rem .9rem;
      }
      #content:hover { cursor: pointer; box-shadow: 0 0 0 1px var(--primary-color); }

      /* Header */
      .header-row {
        display:grid;
        grid-template-columns: auto 1fr auto;
        gap:.6rem;
        align-items:center;
      }
      #group-icon {
        width:40px; height:40px; border-radius:50%;
        object-fit: cover; border: 1px solid var(--divider-color);
      }
      #title {
        font-size: 1rem; line-height: 1.25rem;
        text-decoration: underline;
        align-self: center;
      }

      /* header controls on the right */
      .controls {
        display:flex; align-items:center; gap:.2rem;
      }
      #close-btn, #add-btn {
        width: 28px; height: 28px;
        --iron-icon-width: 12px; --iron-icon-height: 12px;
        display:none; /* toggled by attributes */
      }

      /* members badge */
      .badge {
        display:inline-flex; align-items:center; justify-content:center;
        min-width: 22px; height: 22px; padding: 0 .45rem;
        border-radius: 999px;
        font-size: .75rem; font-weight: 600;
        background: color-mix(in srgb, var(--primary-color) 16%, transparent);
        color: var(--primary-color);
        border: 1px solid color-mix(in srgb, var(--primary-color) 35%, transparent);
      }

      /* Body */
      #details { display:flex; flex-direction:column; padding: .6rem .2rem .2rem; }
      .sub { font-size: .9rem; opacity: .85; margin: .25rem 0 .4rem; }

      .section-title {
        display:flex; align-items:center; gap:.5rem;
        font-weight: 700; font-size: .9rem;
        margin-top:.25rem; margin-bottom:.35rem;
      }
      .divider {
        height:1px; flex:1;
        background: color-mix(in srgb, var(--on-surface-color) 12%, transparent);
      }

      .members {
        display:flex; flex-wrap:wrap; gap:.4rem .5rem;
        padding-top:.25rem;
      }

      /* Compact the user tiles without changing their internals */
      .members ::slotted(globular-user-view) {
        transform: scale(.85);
        transform-origin: top left;
      }

      /* collapse animation */
      iron-collapse { --iron-collapse-transition-duration: .2s; }
      iron-collapse[aria-hidden="true"] { max-height:0; overflow:hidden; padding:0; }
    </style>

    <div id="content">
      <div class="header-row">
        <img id="group-icon" alt="Group Icon"/>
        <span id="title"></span>
        <div class="controls">
          <span id="badge" class="badge">0</span>
          <paper-icon-button id="add-btn" icon="icons:add" role="button" tabindex="0"></paper-icon-button>
          <paper-icon-button id="close-btn" icon="icons:close" role="button" tabindex="0"></paper-icon-button>
        </div>
      </div>

      <iron-collapse id="details">
        <div class="sub" id="sub-title"></div>

        <div class="section-title">
          <span>Members</span>
          <div class="divider"></div>
        </div>

        <div class="members">
          <slot name="members"></slot>
        </div>
      </iron-collapse>
    </div>
  `

        // cache
        this.titleEl = this.root.getElementById("title") as HTMLSpanElement
        this.subTitleEl = this.root.getElementById("sub-title") as HTMLSpanElement
        this.details = this.root.getElementById("details")
        this.membersCountEl = this.root.getElementById("badge") as HTMLSpanElement
        this.badgeEl = this.membersCountEl
        this.closeBtn = this.root.getElementById("close-btn")
        this.addBtn = this.root.getElementById("add-btn")
        this.content = this.root.getElementById("content")
        this.iconEl = this.root.getElementById("group-icon") as HTMLImageElement

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
        this.closeBtn?.addEventListener("click", (e) => { e.stopPropagation(); this.onClose?.() })
        this.addBtn?.addEventListener("click", (e) => { e.stopPropagation(); this.onAdd?.() })
    }

    private applyAttributes() {
        this.attributeChangedCallback("closeable", null, this.getAttribute("closeable"))
        this.attributeChangedCallback("addable", null, this.getAttribute("addable"))
        this.attributeChangedCallback("summary", null, this.getAttribute("summary"))
    }

    /** Refresh text + icon + (re)load members */
    // TWEAK in refresh(): update the icon and the badge
    private async refresh() {
        // header text + icon
        if (this.titleEl) this.titleEl.textContent = this._group.name || ""
        if (this.subTitleEl) this.subTitleEl.textContent = this._group.description || ""
        if (this.iconEl) this.iconEl.src = (this._group as any).icon || "assets/icons/group.svg"

        // badge = member count (visible even when collapsed)
        const n = Array.isArray(this._group.members) ? this._group.members.length : 0
        if (this.badgeEl) this.badgeEl.textContent = String(n)

        // clear old member views we added
        this.querySelectorAll('globular-user-view[slot="members"]').forEach(el => el.remove())

        // add members (unchanged from your version)
        const ids = Array.isArray(this._group.members) ? this._group.members : []
        for (const memberId of ids) {
            try {
                const acc: AccountVM | null = await getAccount(memberId)
                const el = document.createElement("globular-user-view") as any
                if (acc) el.accountVM = acc
                else el.accountVM = { id: memberId, name: memberId, username: memberId }
                el.slot = "members"
                el.setAttribute("summary", "true") // optional hint for future compact mode
                this.appendChild(el)
            } catch (err: any) {
                console.warn(`Failed loading member ${memberId}:`, err?.message || err)
                displayError(err?.message || `Failed to load member ${memberId}`)
            }
        }
    }

}

customElements.define("globular-group-view", GroupView)
