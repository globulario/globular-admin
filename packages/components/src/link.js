// Date: 2021-05-17
// Creator: Dave Courtois
//
// Updated to new backend (no globule): 2025-11-04
// JS version

import { randomUUID } from "./utility.js"
import { Backend } from "@globular/sdk"
import { displayError, displayMessage } from "@globular/sdk"

import { getFileTitlesInfo, getFileVideosInfo, getFileAudiosInfo } from "@globular/sdk"
import { getFile } from "@globular/sdk"

/**
 * Custom element for a filesystem link/shortcut.
 * - No direct globule usage
 * - Uses new backend helpers for file & media lookups
 */
export class Link extends HTMLElement {
  constructor(path, thumbnail, domain = Backend.domain, deleteable = false, alias = "") {
    super()
    this.attachShadow({ mode: "open" })

    this._fileExplorer = null
    this.uuid = "_" + randomUUID()
    this.onedit = null
    this._imgEl = null
    this._nameEl = null
    this._contentDiv = null

    // Attributes bootstrap
    path = path ?? this.getAttribute("path") ?? ""
    this.setAttribute("path", path)

    thumbnail = thumbnail ?? this.getAttribute("thumbnail") ?? ""
    this.setAttribute("thumbnail", thumbnail)

    // Kept for compatibility (not used by backend anymore)
    domain = (domain ?? this.getAttribute("domain")) || ""
    this.setAttribute("domain", domain)

    if (alias !== undefined) {
      this.setAttribute("alias", alias)
    } else if (this.hasAttribute("alias")) {
      alias = this.getAttribute("alias") || ""
    }

    if (deleteable === undefined) {
      const raw = this.getAttribute("deleteable")
      deleteable = raw ? (raw.length === 0 ? true : raw === "true") : false
    }

    const name = path.split("/").pop() || path
    this.ondelete = null

    // Observe toggle of deleteable to keep UI in sync
    const observer = new MutationObserver((mutations) => {
      mutations.forEach(() => {
        if (!this.hasAttribute("deleteable")) {
          this.resetDeleteable()
        } else {
          this.setDeleteable()
        }
      })
    })
    observer.observe(this, { attributes: true })

    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: inline-flex;
        }
        .link-card {
          display: flex;
          flex-direction: column;
          position: relative;
          width: 100px;
          height: 120px;
          margin: 5px;
          padding: 5px;
          border-radius: 4px;
          border: 1px solid var(--divider-color, var(--palette-divider));
          background-color: var(--surface-color);
          color: var(--on-surface-color);
          align-items: center;
          justify-content: flex-end;
          user-select: none;
          transition: background .15s, box-shadow .15s, transform .1s;
          overflow: hidden;
        }
        .link-card:hover {
          cursor: pointer;
          transform: translateY(-2px);
          box-shadow: 0 4px 12px rgba(0,0,0,.25);
          border-color: color-mix(in srgb, var(--on-surface-color) 20%, transparent);
        }
        .thumb-area {
          position: relative;
          display: flex;
          width: 100%;
          flex: 1;
          min-height: 0;
          justify-content: center;
          align-items: center;
        }
        img {
          display: block;
          max-height: 100%;
          max-width: 100%;
          object-fit: contain;
        }
        .shortcut-icon {
          display: none;
        }
        #link-name {
          display: -webkit-box;
          max-width: 100%;
          margin: 4px auto 0 auto;
          text-align: center;
          font-size: .7rem;
          line-height: 1.15em;
          overflow: hidden;
          text-overflow: ellipsis;
          color: var(--on-surface-color);
          max-height: calc(1.15em * 2);
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          white-space: normal;
          overflow-wrap: anywhere;
          word-break: break-word;
          flex-shrink: 0;
        }
        .action-buttons {
          position: absolute;
          top: 2px;
          right: 2px;
          display: none;
          gap: 2px;
          z-index: 10;
        }
        .link-card:hover .action-buttons {
          display: flex;
        }
        .btn-div {
          display: flex;
          width: 18px;
          height: 18px;
          justify-content: center;
          align-items: center;
          background: var(--surface-color);
          border-radius: 50%;
          box-shadow: 0 1px 3px rgba(0,0,0,.3);
          cursor: pointer;
        }
        .btn-div:hover {
          background: var(--palette-error-main, #f44336);
        }
        .btn-div:hover iron-icon {
          --iron-icon-fill-color: white;
        }
        #delete-lnk-btn,
        #edit-lnk-btn {
          height: 12px;
          width: 12px;
          --iron-icon-fill-color: var(--secondary-text-color);
        }
        .badge {
          display: none;
        }
      </style>

      <div class="link-card" id="${this.uuid}-link-div">
        <div class="action-buttons">
          <div class="btn-div delete-btn-div" style="display: none;">
            <iron-icon id="delete-lnk-btn" icon="close"></iron-icon>
          </div>
          <div class="btn-div edit-btn-div" style="display: none;">
            <iron-icon id="edit-lnk-btn" icon="icons:create"></iron-icon>
          </div>
        </div>
        <div class="thumb-area" id="content">
          <div class="badge" id="${this.uuid}-badge"></div>
          <img src="${thumbnail}">
          <div class="shortcut-icon">
            <iron-icon icon="icons:reply"></iron-icon>
          </div>
          <paper-ripple recenters></paper-ripple>
        </div>
        <span id="link-name">${alias.length > 0 ? alias : name}</span>
      </div>
    `

    this._imgEl = this.shadowRoot.querySelector("img")
    this._nameEl = this.shadowRoot.querySelector("#link-name")
    this._contentDiv = this.shadowRoot.querySelector("#content")
    this._badgeEl = this.shadowRoot.querySelector(`#${this.uuid}-badge`)
    this._deleteBtnDiv = this.shadowRoot.querySelector(".delete-btn-div")
    this._editBtnDiv = this.shadowRoot.querySelector(".edit-btn-div")
    this._applyAttributes()

    const lnk = this._contentDiv
    lnk.onclick = () => {
      const path = this.getAttribute("path") || ""
      const domain = this.getAttribute("domain") || ""
      if (!path) return
      Backend.eventHub.publish(
        "follow_link_event_",
        { path, domain, file_explorer_id: this._fileExplorer?._id || null },
        true
      )
    }

    // Drag & drop metadata
    lnk.draggable = true
    this._imgEl.draggable = false
    lnk.ondragstart = (evt) => {
      const path = this.getAttribute("path") || ""
      if (!path) return
      const domain = this.getAttribute("domain") || ""
      const files = [path]
      if (evt.dataTransfer) {
        evt.dataTransfer.setData("files", JSON.stringify(files))
        evt.dataTransfer.setData("id", this.uuid)
        evt.dataTransfer.setData("domain", domain || "")
      }
    }
    lnk.ondragend = (evt) => evt.stopPropagation()

    lnk.onmouseover = (evt) => evt.stopPropagation()
    lnk.onmouseleave = (evt) => evt.stopPropagation()

    // deleteable UI state
    if (!deleteable && this.hasAttribute("deleteable")) {
      deleteable = true
    }
    if (deleteable) {
      this.setAttribute("deleteable", "true")
      this.setDeleteable()
    } else {
      this.removeAttribute("deleteable")
      this.resetDeleteable()
    }

    // delete confirmation
    this._deleteBtnDiv?.addEventListener("click", (evt) => {
      evt.stopPropagation()
      if (document.getElementById(`${this.uuid}-yes-no-link-delete-box`)) return

      const toast = displayMessage(
        `
        <style>
          #yes-no-link-delete-box{
            display: flex;
            flex-direction: column;
            justify-content: center;
          }
          #yes-no-link-delete-box globular-link-card{
            padding-bottom: 10px;
          }
          #yes-no-link-delete-box div{
            display: flex;
            padding-bottom: 10px;
          }
        </style>
        <div id="${this.uuid}-yes-no-link-delete-box">
          <div>Your about to delete link</div>
          <div style="display: flex; align-items; center; justify-content: center;">
            ${this.outerHTML}
          </div>
          <div>Is it what you want to do? </div>
          <div style="justify-content: flex-end;">
            <paper-button raised id="yes-delete-link">Yes</paper-button>
            <paper-button raised id="no-delete-link">No</paper-button>
          </div>
        </div>
        `,
        60000
      )

      const yesNoDiv = toast.toastElement.querySelector(`#${this.uuid}-yes-no-link-delete-box`)
      const yesBtn = yesNoDiv.querySelector("#yes-delete-link")
      const noBtn = yesNoDiv.querySelector("#no-delete-link")
      const preview = yesNoDiv.querySelector("globular-link")
      if (preview) preview.removeAttribute("deleteable")

      yesBtn.onclick = () => {
        toast.hideToast()
        if (this.ondelete) this.ondelete()
        if (this.parentNode) this.parentNode.removeChild(this)
      }
      noBtn.onclick = () => toast.hideToast()
      toast.id = this.uuid
    })

    this.shadowRoot.querySelector("#edit-lnk-btn").addEventListener("click", (evt) => {
      evt.stopPropagation()
      if (typeof this.onedit === "function") {
        this.onedit({
          path: this.getAttribute("path") || "",
          alias: this.getAttribute("alias") || "",
          domain: this.getAttribute("domain") || ""
        })
      }
    })

    // Enrich label from media metadata (titles/videos/audios)
    // (best-effort; non-blocking)
    this._hydrateDisplayName(path).catch(() => {})

    this._applyAttributes()
  }

  setFileExplorer(fileExplorer) {
    this._fileExplorer = fileExplorer
  }

  static get observedAttributes() {
    return ["path", "thumbnail", "domain", "alias", "mime", "deleteable", "permission-badge"]
  }

  attributeChangedCallback(name, oldVal, newVal) {
    if (oldVal === newVal) return
    if (name === "deleteable") {
      if (this.hasAttribute("deleteable")) this.setDeleteable()
      else this.resetDeleteable()
      return
    }
    this._applyAttributes()
    if (name === "path" && newVal) {
      this._hydrateDisplayName(newVal).catch(() => {})
    }
  }

  _applyAttributes() {
    const path = this.getAttribute("path") || ""
    const aliasAttr = this.getAttribute("alias")
    const alias = aliasAttr && aliasAttr.length > 0 ? aliasAttr : (path.split("/").pop() || path)
    if (this._nameEl) this._nameEl.textContent = alias

    const thumbnail = this.getAttribute("thumbnail") || ""
    if (this._imgEl) this._imgEl.src = thumbnail || ""

    const badgeLabel = this.getAttribute("permission-badge") || ""
    if (this._badgeEl) {
      if (badgeLabel) {
        this._badgeEl.textContent = badgeLabel
        this._badgeEl.style.display = "inline-flex"
      } else {
        this._badgeEl.textContent = ""
        this._badgeEl.style.display = "none"
      }
      this._badgeEl.style.fontSize = "0.75rem"
      this._badgeEl.style.position = "absolute"
      this._badgeEl.style.top = "-5px"
      this._badgeEl.style.right = "-5px"
      this._badgeEl.style.backgroundColor = "var(--palette-primary-main)"
      this._badgeEl.style.color = "white"
      this._badgeEl.style.padding = "2px 4px"
      this._badgeEl.style.borderRadius = "8px"
      this._badgeEl.style.boxShadow = "0 2px 4px rgba(0, 0, 0, 0.2)"

      // I will set the title attribute for tooltip
      if (badgeLabel === "R") {
        this._badgeEl.title = "Read-only access"
      } else if (badgeLabel === "RW") {
        this._badgeEl.title = "Read and write access"
      } else if (badgeLabel === "RWX") {
        this._badgeEl.title = "Read, write and delete access"
      } else {
        this._badgeEl.title = ""
      }
    }
  }

  connectedCallback() {
    if (this.hasAttribute("deleteable")) this.setDeleteable()
  }

  setDeleteable() {
    if (this._deleteBtnDiv) this._deleteBtnDiv.style.display = "flex"
    if (this._editBtnDiv) this._editBtnDiv.style.display = "flex"
  }

  resetDeleteable() {
    if (this._deleteBtnDiv) this._deleteBtnDiv.style.display = "none"
    if (this._editBtnDiv) this._editBtnDiv.style.display = "none"
  }

  /** Try to name the link using title/video/audio metadata (first match wins). */
  async _hydrateDisplayName(path) {
    const nameEl = this.shadowRoot.querySelector("#link-name")
    if (!nameEl) return

    try {
      const videos = await getFileVideosInfo(path)
      if (videos && videos.length > 0) {
        nameEl.textContent = videos[0].description || videos[0].id || nameEl.textContent || ""
        return
      }
    } catch {}

    try {
      const titles = await getFileTitlesInfo(path)
      if (titles && titles.length > 0) {
        nameEl.textContent = titles[0].name || titles[0].id || nameEl.textContent || ""
        return
      }
    } catch {}

    try {
      const audios = await getFileAudiosInfo(path)
      if (audios && audios.length > 0) {
        const title = audios[0].title || audios[0].name || audios[0].id
        if (title) nameEl.textContent = title
      }
    } catch {}
  }
}

customElements.define("globular-link", Link)