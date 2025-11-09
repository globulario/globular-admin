// Date: 2021-05-17
// Creator: Dave Courtois
//
// Updated to new backend (no globule): 2025-11-04
// JS version

import { randomUUID } from "./utility.js"
import { Backend } from "../backend/backend"
import { displayError, displayMessage } from "../backend/ui/notify"

import { FileExplorer } from "./fileExplorer/fileExplorer.js"
import { playVideo } from "./video.js"
import { playAudio } from "./audio.js"

// New backend helpers (promise-based, no globule)
import { getFile } from "../backend/cms/files"
import { getFileTitlesInfo, getFileVideosInfo, getFileAudiosInfo } from "../backend/media/title"

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
        #delete-lnk-btn {
          height: 16px;
          width: 16px;
          flex-grow: 1;
          --iron-icon-fill-color:var(--palette-text-primary);
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
          <div class="btn-div" style="visibility: hidden;">
            <iron-icon  id="delete-lnk-btn"  icon="close"></iron-icon>
            <paper-ripple class="circle"></paper-ripple>
          </div>
        </div>
        <div id="content">
          <img src="${thumbnail}">
          <div class="shortcut-icon">
            <iron-icon icon="icons:reply"></iron-icon>
          </div>
          <paper-ripple></paper-ripple>
        </div>
        <span id="link-name">${alias.length > 0 ? alias : name}</span>
      </div>
    `

    const lnk = this.shadowRoot.querySelector("#content")
    lnk.onclick = async () => {
      if (this._fileExplorer) {
        Backend.eventHub.publish(
          "follow_link_event_",
          { path, domain, _fileExplorer: this._fileExplorer },
          true
        )
        return
      }

      try {
        const file = await getFile(path, 64, 64)
        if (file.isDir) {
          const fileExplorer = new FileExplorer()
          document.body.appendChild(fileExplorer)
          this._fileExplorer = fileExplorer

          fileExplorer.onclose = () => (this._fileExplorer = null)
          fileExplorer.onloaded = () => fileExplorer.publishSetDirEvent(path)
        } else {
          const mime = file.mime || ""
          if (mime.startsWith("video")) {
            playVideo(file.path)
          } else if (mime.startsWith("audio")) {
            playAudio(file.path)
          } else {
            const fileExplorer = new FileExplorer()
            document.body.appendChild(fileExplorer)
            this._fileExplorer = fileExplorer
            fileExplorer.onclose = () => (this._fileExplorer = null)
            fileExplorer.onloaded = () => fileExplorer.readFile(file)
          }
        }
      } catch (e) {
        displayError((e && e.message) || String(e), 3000)
      }
    }

    // Drag & drop metadata
    lnk.draggable = true
    this.shadowRoot.querySelector("img").draggable = false
    lnk.ondragstart = (evt) => {
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
    this.shadowRoot.querySelector(".btn-div").addEventListener("click", (evt) => {
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

    // Enrich label from media metadata (titles/videos/audios)
    // (best-effort; non-blocking)
    this._hydrateDisplayName(path).catch(() => {})
  }

  connectedCallback() {
    if (this.hasAttribute("deleteable")) this.setDeleteable()
  }

  setDeleteable() {
    this.shadowRoot.querySelector(`#${this.uuid}-link-div`).style.marginTop = "25px"
    this.shadowRoot.querySelector(".btn-div").style.visibility = "visible"
  }

  resetDeleteable() {
    this.shadowRoot.querySelector(`#${this.uuid}-link-div`).style.marginTop = "5px"
    this.shadowRoot.querySelector(".btn-div").style.visibility = "hidden"
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
