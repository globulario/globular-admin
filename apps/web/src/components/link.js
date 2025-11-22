// Date: 2021-05-17
// Creator: Dave Courtois
//
// Updated to new backend (no globule): 2025-11-04
// JS version

import { randomUUID } from "./utility.js"
import { Backend } from "../backend/backend"
import { displayError, displayMessage } from "../backend/ui/notify"

import { getFileTitlesInfo, getFileVideosInfo, getFileAudiosInfo } from "../backend/media/title"
import { getFile } from "../backend/cms/files"

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
        #container{}
        .shortcut-icon {
          position: absolute;
          bottom: -5px;
          left: 0px;
        }
        .shortcut-icon iron-icon{
          background: white;
          fill: black;
          height: 16px;
          width: 16px;
        }
        #content{
          position: relative;
          transition: background 0.2s ease,padding 0.8s linear;
          background-color: var(--palette-background-paper);
          display: flex;
          flex-direction: column;
          justify-content: center;
          border: 1px solid var(--palette-divider);
          padding: 5px;
          border-radius: 2.5px;
        }
        #content:hover{
          cursor: pointer;
          -webkit-filter: invert(10%);
          filter: invert(10%);
        }
        img {
          max-height: 64px;
          object-fit: cover;
          max-width: 96px;
        }
        span{
          font-size: .85rem;
          padding: 2px;
          display: block;
          word-break: break-all;
          max-width: 128px;
        }
        #delete-lnk-btn,
        #edit-lnk-btn {
          height: 16px;
          width: 16px;
          flex-grow: 1;
          --iron-icon-fill-color:var(--palette-text-primary);
        }
        .action-buttons {
          display:flex;
          gap:6px;
        }
        .btn-div{
          position: relative;
          display: flex;
          width: 24px;
          height: 24px;
          justify-content: center;
          align-items: center;
          margin-bottom: 4px;
        }
        .btn-div:hover { cursor: pointer; }
      </style>

      <div id="${this.uuid}-link-div" style="margin: ${deleteable ? "25px" : "5px"} 10px 5px 10px; display: flex; flex-direction: column; align-items: center; width: fit-content; height: fit-content; position: relative;">
        <div style="position: absolute; top: -25px; left: -10px;">
          <div class="action-buttons">
          <div class="btn-div delete-btn-div" style="visibility: hidden;">
            <iron-icon  id="delete-lnk-btn"  icon="close"></iron-icon>
            <paper-ripple class="circle"></paper-ripple>
          </div>
          <div class="btn-div edit-btn-div" style="visibility: hidden;">
            <iron-icon id="edit-lnk-btn" icon="icons:create"></iron-icon>
            <paper-ripple class="circle"></paper-ripple>
          </div>
          </div>
        </div>
        <div id="content">
          <div class="badge" id="${this.uuid}-badge"></div>
          <img src="${thumbnail}">
          <div class="shortcut-icon">
            <iron-icon icon="icons:reply"></iron-icon>
          </div>
          <paper-ripple></paper-ripple>
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
    this.shadowRoot.querySelector(`#${this.uuid}-link-div`).style.marginTop = "30px"
    if (this._deleteBtnDiv) this._deleteBtnDiv.style.visibility = "visible"
    if (this._editBtnDiv) this._editBtnDiv.style.visibility = "visible"
  }

  resetDeleteable() {
    this.shadowRoot.querySelector(`#${this.uuid}-link-div`).style.marginTop = "5px"
    if (this._deleteBtnDiv) this._deleteBtnDiv.style.visibility = "hidden"
    if (this._editBtnDiv) this._editBtnDiv.style.visibility = "hidden"
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
