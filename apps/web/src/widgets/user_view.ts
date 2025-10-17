// widgets/user_view.ts
// <globular-user-view>

import type { AccountVM } from "../backend/rbac/accounts" // <-- adjust path if needed
// e.g. "../backend/rbac/account" if that’s where AccountVM is exported

// Legacy proto-like shape (optional backward compat)
type AccountProtoLike = {
  getId?: () => string
  getName?: () => string
  getEmail?: () => string
  getFirstname?: () => string
  getLastname?: () => string
  getMiddle?: () => string
  getProfilepicture?: () => string
} | null

type AnyAccount = AccountVM | AccountProtoLike | null

const DEFAULT_AVATAR = "https://www.w3schools.com/howto/img_avatar.png"

/** Coerce either AccountVM or proto-like object into AccountVM */
function coerceToVM(a: AnyAccount): AccountVM {
  if (!a) {
    return { id: "", name: "", username: "" }
  }
  // Already an AccountVM?
  if (typeof (a as AccountVM).username === "string" || "profilePicture" in (a as any)) {
    const vm = a as AccountVM
    // Ensure username/displayName sane fallbacks
    const first = vm.firstName ?? ""
    const mid = vm.middle ?? ""
    const last = vm.lastName ?? ""
    const display = vm.displayName || [first, mid, last].filter(Boolean).join(" ").trim()
    return {
      ...vm,
      username: vm.username || vm.name || "",
      displayName: display || vm.displayName,
      profilePicture: vm.profilePicture || DEFAULT_AVATAR,
    }
  }

  // Proto-like (with getters)
  const p = a as AccountProtoLike
  const first = p?.getFirstname?.() || ""
  const mid   = p?.getMiddle?.() || ""
  const last  = p?.getLastname?.() || ""
  const display = [first, mid, last].filter(Boolean).join(" ").trim()
  const name = p?.getName?.() || ""
  const id   = p?.getId?.() || name || ""

  return {
    id,
    name,
    email: p?.getEmail?.() || undefined,
    profilePicture: p?.getProfilepicture?.() || DEFAULT_AVATAR,
    firstName: first || undefined,
    lastName: last || undefined,
    middle: mid || undefined,
    username: name || id || "",
    displayName: display || undefined,
  }
}

export class UserView extends HTMLElement {
  static get observedAttributes() { return ["closeable", "summary"] }

  /** Consumer hook (used when closeable="true") */
  public onClose?: () => void

  private _vm: AccountVM = { id: "", name: "", username: "" }
  private root: ShadowRoot
  private closeBtn?: HTMLElement | null
  private nameEl?: HTMLSpanElement | null
  private imgEl?: HTMLImageElement | null

  constructor() {
    super()
    this.root = this.attachShadow({ mode: "open" })
  }

  connectedCallback() {
    this.render()
    this.applyCloseable(this.getAttribute("closeable"))
  }

  attributeChangedCallback(name: string, _old: string | null, val: string | null) {
    if (!this.isConnected) return
    if (name === "closeable") this.applyCloseable(val)
    // 'summary' kept for parity (no visual change here)
  }

  /** Preferred: pass an AccountVM */
  set accountVM(vm: AccountVM) {
    this._vm = coerceToVM(vm)
    this.updateView()
  }
  get accountVM(): AccountVM { return this._vm }

  /** Back-compat: accept proto-like or AccountVM */
  setAccount(a: AnyAccount) {
    this._vm = coerceToVM(a)
    this.updateView()
  }

  // ---------- internals ----------
  private render() {
    this.root.innerHTML = `
      <style>
        @import url('./styles.css');

        :host { display:inline-block; }
        #content {
          position:relative;
          display:flex; flex-direction:column; align-items:center;
          background: var(--surface-color); color: var(--on-surface-color);
          padding:.5rem; border-radius:.5rem; box-sizing:border-box;
        }
        #content > img {
          width:48px; height:48px; border-radius:50%; object-fit:cover;
        }
        .header-row {
          display:flex; align-items:center; justify-content:center; position:relative; width:100%;
        }
        #name {
          font-size:1rem; max-width:150px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
        }
        #close-btn {
          position:absolute; left:0; top:0;
          width:30px; height:30px;
          --iron-icon-width:10px; --iron-icon-height:10px;
          display:none; /* toggled by attribute */
        }
      </style>
      <div id="content">
        <paper-icon-button id="close-btn" icon="icons:close" role="button" tabindex="0" aria-disabled="false"></paper-icon-button>
        <img id="avatar" src="${this._vm.profilePicture || DEFAULT_AVATAR}" alt="User Profile Picture" />
        <div class="header-row">
          <span id="name">${this._vm.displayName || this._vm.name || this._vm.username || "(unknown)"}</span>
        </div>
      </div>
    `
    this.closeBtn = this.root.getElementById("close-btn")
    this.nameEl = this.root.getElementById("name") as HTMLSpanElement
    this.imgEl = this.root.getElementById("avatar") as HTMLImageElement

    this.closeBtn?.addEventListener("click", (e) => {
      e.stopPropagation()
      if (this.getAttribute("closeable") === "true") {
        if (this.onClose) this.onClose()
        else this.dispatchEvent(new CustomEvent("close", { bubbles: true }))
      }
    })

    this.updateView()
  }

  private updateView() {
    if (!this.isConnected) return
    const label = this._vm.displayName || this._vm.name || this._vm.username || "(unknown)"
    if (this.nameEl) this.nameEl.textContent = label
    if (this.imgEl) this.imgEl.src = this._vm.profilePicture || DEFAULT_AVATAR
  }

  private applyCloseable(val: string | null) {
    const show = val === "true"
    if (this.closeBtn) this.closeBtn.style.display = show ? "block" : "none"
  }
}

customElements.define("globular-user-view", UserView)
