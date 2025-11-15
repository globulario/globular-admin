// components/filesUploader.js

import getUuidByString from "uuid-by-string"
import { Backend } from "../../backend/backend"

// New torrent wrapper (no direct *_pb imports here)
import { dropTorrent, getTorrentLinks, streamTorrentInfos } from "../../backend/cms/torrent"

// Use helpers from files.ts (size string)
import { getFileSizeString } from "../../backend/cms/files"
import { getBaseUrl } from "../../backend/core/endpoints"

import { formatBytes } from "../utility"

import "@polymer/paper-tabs/paper-tabs.js"
import "@polymer/paper-tabs/paper-tab.js"
import "@polymer/iron-icon/iron-icon.js"
import "@polymer/iron-collapse/iron-collapse.js"
import "@polymer/paper-progress/paper-progress.js"
import "@polymer/paper-icon-button/paper-icon-button.js"
import "@polymer/paper-ripple/paper-ripple.js"
import { displayError, displayMessage } from "../../backend/ui/notify"

export class FilesUploader extends HTMLElement {
  constructor() {
    super()
    this.attachShadow({ mode: "open" })

    this.width = parseInt(this.getAttribute("width")) || 320
    this.height = parseInt(this.getAttribute("height")) || 550

    this.render()
    this.initElements()
    this.addEventListeners()
    this.initializeData()
  }

  render() {
    this.shadowRoot.innerHTML = `
      <style>
        ::-webkit-scrollbar { width: 5px; height: 5px; }
        ::-webkit-scrollbar-track { background: var(--surface-color); }
        ::-webkit-scrollbar-thumb { background: var(--palette-divider); }

        #container {
          background-color: var(--surface-color);
          position: relative;
          font-size: 1rem;
          display: flex;
          flex-direction: column;
          height: ${this.height}px;
          width: ${this.width}px;
          box-shadow: var(--shadow-elevation-2dp, 0 2px 4px rgba(0,0,0,0.24));
          border-left: 1px solid var(--palette-divider);
        }

        .content {
          display: flex;
          flex-direction: column;
          flex-grow: 1;
          min-height: 0;
        }

        .header-bar {
          display: flex;
          align-items: center;
          background: var(--surface-color-dark, var(--palette-primary-accent));
          border-bottom: 1px solid var(--palette-divider);
        }

        paper-tabs {
          background: transparent;
          width: 100%;
          --paper-tabs-selection-bar-color: var(--primary-color);
          color: var(--primary-text-color);
          --paper-tab-ink: var(--palette-action-disabled);
        }

        #close-btn {
          display: none;
          margin-right: 4px;
        }

        .card-content {
          padding: 0;
          border-left: 1px solid var(--palette-divider);
          overflow-y: auto;
          flex-grow: 1;
          max-height: calc(100vh - 220px);
          min-height: 260px;
        }

        .table {
          width: 100%;
          display: flex;
          flex-direction: column;
        }

        .table-header {
          border-bottom: 1px solid var(--palette-divider);
          padding: 4px 0;
          font-size: 0.8rem;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          color: var(--secondary-text-color);
        }

        .table-body {
          position: relative;
          width: 100%;
          display: flex;
          flex-direction: column;
        }

        .table-header,
        .table-row {
          display: flex;
          flex-direction: row;
          width: 100%;
        }

        .table-row {
          border-bottom: 1px solid var(--palette-divider);
          transition: background 0.15s ease, opacity 0.15s ease;
        }

        .table-row:hover {
          background: var(--hover-background-color, rgba(255,255,255,0.02));
        }

        .table-row.completed {
          opacity: 0.85;
        }

        .table-cell {
          padding: 4px 6px;
          display: flex;
          align-items: center;
          justify-content: flex-start;
          font-size: 0.85rem;
        }

        .table-cell:first-child {
          width: 32px;
          justify-content: center;
        }

        .table-cell.size-cell {
          min-width: 72px;
          justify-content: flex-end;
          font-variant-numeric: tabular-nums;
        }

        .file-name {
          overflow: hidden;
          white-space: nowrap;
          text-overflow: ellipsis;
          display: inline-block;
        }

        .file-path {
          overflow: hidden;
          white-space: nowrap;
          text-overflow: ellipsis;
          display: inline-block;
          text-decoration: underline;
          flex-grow: 1;
          cursor: pointer;
        }

        .file-path:hover {
          text-decoration: none;
        }

        .speedometer-div {
          min-width: 60px;
          text-align: right;
          padding-right: 5px;
          font-variant-numeric: tabular-nums;
        }

        paper-card {
          background-color: var(--surface-color);
          color: var(--primary-text-color);
        }

        /* Status bar at bottom */
        #status-bar {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 4px 8px;
          border-top: 1px solid var(--palette-divider);
          font-size: 0.8rem;
          background: var(--surface-color-dark, rgba(0,0,0,0.02));
          color: var(--secondary-text-color);
        }

        #status-indicator {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: var(--palette-action-disabled, rgba(150,150,150,0.7));
          box-shadow: 0 0 0 0 rgba(0,0,0,0.15);
        }

        #status-bar.busy #status-indicator {
          background: var(--primary-color);
          animation: pulse 1.2s ease-in-out infinite;
        }

        @keyframes pulse {
          0% {
            transform: scale(1);
            box-shadow: 0 0 0 0 rgba(0,0,0,0.15);
          }
          50% {
            transform: scale(1.25);
            box-shadow: 0 0 0 4px rgba(0,0,0,0.05);
          }
          100% {
            transform: scale(1);
            box-shadow: 0 0 0 0 rgba(0,0,0,0.0);
          }
        }

        .status-text-strong {
          color: var(--primary-text-color);
        }

        @media (max-width: 500px) {
          .table { width: calc(100vw - 5px); }
          .table-cell { padding: 2px 4px; }
          .card-content {
            max-height: calc(100vh - 140px);
            height: calc(100vh - 140px);
          }
          #container {
            height: 100%;
            width: 100%;
          }
          #close-btn {
            display: block;
          }
          .file-path {
            max-width: calc(100vw - 160px);
          }
        }
      </style>
      <div id="container">
        <div class="content">
          <div class="header-bar">
            <paper-tabs id="tabs" selected="0">
              <paper-tab id="file-upload-tab">Files</paper-tab>
              <paper-tab id="links-download-tab">Videos</paper-tab>
              <paper-tab id="torrents-dowload-tab">Torrents</paper-tab>
            </paper-tabs>
            <paper-icon-button id="close-btn" icon="icons:close"></paper-icon-button>
          </div>

          <div class="card-content">
            <div class="table" id="files-upload-table">
              <div class="table-header files-list-view-header">
                <div class="table-cell"></div>
                <div class="table-cell" style="flex:1;">Transfer</div>
                <div class="table-cell size-cell">Size</div>
              </div>
              <div class="table-body" id="file-upload-tbody"></div>
            </div>

            <div class="table" id="links-download-table" style="display:none;">
              <div class="table-header files-list-view-header">
                <div class="table-cell"></div>
                <div class="table-cell" style="flex:1;">Video Download</div>
                <div class="table-cell size-cell">Status</div>
              </div>
              <div class="table-body" id="links-download-tbody"></div>
            </div>

            <div class="table" id="torrents-download-table" style="display:none;">
              <div class="table-header files-list-view-header">
                <div class="table-cell"></div>
                <div class="table-cell" style="flex:1;">Torrent</div>
                <div class="table-cell size-cell">Speed</div>
              </div>
              <div class="table-body" id="torrent-download-tbody"></div>
            </div>
          </div>
        </div>

        <div id="status-bar">
          <div id="status-indicator"></div>
          <span id="status-text"><span class="status-text-strong">Idle</span> — no active transfers</span>
        </div>
      </div>
    `
  }

  initElements() {
    this.filesUploadTableBody = this.shadowRoot.querySelector("#file-upload-tbody")
    this.torrentDownloadTableBody = this.shadowRoot.querySelector("#torrent-download-tbody")
    this.linksDownloadTableBody = this.shadowRoot.querySelector("#links-download-tbody")

    this.filesUploadTab = this.shadowRoot.querySelector("#file-upload-tab")
    this.torrentsDownloadTab = this.shadowRoot.querySelector("#torrents-dowload-tab")
    this.linksDownloadTab = this.shadowRoot.querySelector("#links-download-tab")
    this.tabsEl = this.shadowRoot.querySelector("#tabs")

    this.allTables = this.shadowRoot.querySelectorAll(".table")

    this.statusBar = this.shadowRoot.querySelector("#status-bar")
    this.statusIndicator = this.shadowRoot.querySelector("#status-indicator")
    this.statusText = this.shadowRoot.querySelector("#status-text")

    // simple counters for nicer status messages
    this._activeFileUploads = 0
    this._activeLinkDownloads = 0
    this._activeTorrents = new Set()
  }

  setStatus(message, busy = false) {
    if (this.statusText) {
      this.statusText.innerHTML = message || `<span class="status-text-strong">Idle</span> — no active transfers`
    }
    if (this.statusBar) {
      this.statusBar.classList.toggle("busy", !!busy)
    }
  }

  addEventListeners() {
    const setSelected = (idx) => { if (this.tabsEl) this.tabsEl.selected = idx }

    this.filesUploadTab.addEventListener("click", () => {
      this.switchTab("files-upload-table")
      setSelected(0)
    })
    this.linksDownloadTab.addEventListener("click", () => {
      this.switchTab("links-download-table")
      setSelected(1)
    })
    this.torrentsDownloadTab.addEventListener("click", () => {
      this.switchTab("torrents-download-table")
      setSelected(2)
    })

    const closeBtn = this.shadowRoot.querySelector("#close-btn")
    if (closeBtn) {
      closeBtn.addEventListener("click", () => (this.style.display = "none"))
    }

    // New upload event (no .globule needed)
    Backend.eventHub.subscribe(
      "__upload_files_event__",
      (_uuid) => {},
      (evt) => this.uploadFiles(evt.dir?.getPath?.() ?? evt.dir, evt.files),
      true,
      this
    )

    // Link download progress events
    Backend.eventHub.subscribe(
      "__upload_link_event__",
      (_uuid) => {},
      (evt) => this.uploadLink(evt.pid, evt.path, evt.infos, evt.lnk, evt.done),
      true,
      this
    )

    Backend.eventHub.subscribe(
      "__upload_torrent_event__",
      (_uuid) => {},
      (evt) => this.uploadTorrent(evt),
      true,
      this
    )

    // Legacy peer-start event: just (re)attach torrent streams
    Backend.eventHub.subscribe(
      "start_peer_evt_",
      (_uuid) => {},
      () => {
        this.getTorrentLnks()
        this.getTorrentsInfo()
      },
      true
    )
  }

  initializeData() {
    this.setStatus(`<span class="status-text-strong">Idle</span> — no active transfers`, false)
    this.getTorrentLnks()
    this.getTorrentsInfo()
  }

  switchTab(tableId) {
    this.allTables.forEach((t) => (t.style.display = "none"))
    const el = this.shadowRoot.querySelector(`#${tableId}`)
    if (el) el.style.display = ""
  }

  createTableRow(id, contentHtml, sizeText = "", cancelAction = null) {
    const row = document.createElement("div")
    row.className = "table-row"
    row.id = id

    const cancelCell = document.createElement("div")
    cancelCell.className = "table-cell"
    const cancelBtn = document.createElement("paper-icon-button")
    cancelBtn.icon = "icons:close"
    cancelBtn.id = "cancel-btn"
    cancelCell.appendChild(cancelBtn)

    const contentCell = document.createElement("div")
    contentCell.className = "table-cell"
    contentCell.style.flexGrow = "1"
    contentCell.innerHTML = contentHtml

    row.appendChild(cancelCell)
    row.appendChild(contentCell)

    if (sizeText) {
      const cellSize = document.createElement("div")
      cellSize.className = "table-cell size-cell"
      cellSize.innerHTML = sizeText
      row.appendChild(cellSize)
    }

    if (cancelAction) cancelBtn.addEventListener("click", cancelAction)
    return row
  }

  showConfirmationDialog(message, onConfirm, onCancel, yesBtnId, noBtnId) {
    const toast = displayMessage(
      `
      <style>
        #confirm-dialog-box { display:flex; flex-direction:column; }
        #confirm-dialog-box div { display:flex; padding-bottom:10px; }
        paper-button { font-size:.8rem; margin-left:8px; }
      </style>
      <div id="confirm-dialog-box">
        <div>${message}</div>
        <div style="justify-content:flex-end;">
          <paper-button raised id="${yesBtnId}">Yes</paper-button>
          <paper-button raised id="${noBtnId}">No</paper-button>
        </div>
      </div>
      `,
      15000
    )
    const yesBtn = document.querySelector(`#${yesBtnId}`)
    const noBtn = document.querySelector(`#${noBtnId}`)
    if (yesBtn) yesBtn.onclick = () => { toast.hideToast(); onConfirm?.() }
    if (noBtn) noBtn.onclick = () => { toast.hideToast(); onCancel?.() }
  }

  /* ---------------------------------- Links ---------------------------------- */

  uploadLink(pid, path, infos, lnk, done) {
    const id = `link-download-row-${pid}`
    let row = this.shadowRoot.querySelector(`#${id}`)

    if (done || infos === "done") {
      // Finished
      if (!row) return
      const spanTitle = row.querySelector(`#${id}_title`)
      if (spanTitle) {
        displayMessage(`File ${spanTitle.innerHTML} was uploaded!`, 3000)
        const info = spanTitle.innerHTML
        const fileName = info.split(": ")[1] || info
        const contentHtml = `
          <div style="display:flex; flex-direction:column; width:100%; align-items:flex-start; font-size:.85rem;">
            <span id="file-lnk" class="file-path">${fileName}</span>
            <span id="dir-lnk" class="file-path">${path}</span>
          </div>
        `
        row.querySelector(".table-cell:nth-child(2)").innerHTML = contentHtml

        const cancelBtn = row.querySelector("#cancel-btn")
        if (cancelBtn) {
          // After completion, close just hides the row
          cancelBtn.onclick = () => (row.parentNode && row.parentNode.removeChild(row))
        }

        const fileClick = () =>
          Backend.eventHub.publish("follow_link_event_", { path: `${path}/${fileName}` }, true)
        const dirClick = () => Backend.eventHub.publish("follow_link_event_", { path }, true)

        const fileEl = row.querySelector("#file-lnk")
        const dirEl = row.querySelector("#dir-lnk")
        if (fileEl) fileEl.onclick = fileClick
        if (dirEl) dirEl.onclick = dirClick
      }

      this._activeLinkDownloads = Math.max(0, this._activeLinkDownloads - 1)
      if (this._activeFileUploads === 0 && this._activeLinkDownloads === 0 && this._activeTorrents.size === 0) {
        this.setStatus(`<span class="status-text-strong">Idle</span> — no active transfers`, false)
      } else {
        this.setStatus(`Some transfers are still running…`, true)
      }
      return
    }

    // Still running
    if (!row) {
      this._activeLinkDownloads++
      this.setStatus(`Downloading video from link…`, true)

      const contentHtml = `
        <div style="display:flex; flex-direction:column; width:100%; align-items:flex-start; font-size:.85rem;">
          <span id="${id}_title" style="text-align:left; width:100%;">${infos}</span>
          <p id="${id}_infos" style="text-align:left; width:100%; white-space:pre-line; margin:0;"></p>
          <span class="file-path" style="text-align:left; width:100%">${path}</span>
        </div>`
      row = this.createTableRow(
        id,
        contentHtml,
        "",
        () => {
          this.showConfirmationDialog(
            "You're about to cancel video upload. Is this what you want to do?",
            () => {
              Backend.eventHub.publish("cancel_upload_event", JSON.stringify({ pid, path }), false)
              if (row) row.style.display = "none"
              this._activeLinkDownloads = Math.max(0, this._activeLinkDownloads - 1)
            },
            () => {},
            "yes-delete-upload-video",
            "no-delete-upload-video"
          )
        }
      )
      const pathEl = row.querySelector(".file-path")
      if (pathEl) pathEl.onclick = () =>
        Backend.eventHub.publish("follow_link_event_", { path }, true)
      this.linksDownloadTableBody.appendChild(row)
    } else {
      if (typeof infos === "string" && infos.startsWith("[download] Destination:")) {
        row.querySelector(`#${id}_title`).innerHTML = infos.substring(infos.lastIndexOf("/") + 1)
      } else {
        const infosEl = row.querySelector(`#${id}_infos`)
        if (infosEl) infosEl.innerHTML = (infos ?? "").toString().trim()
      }
    }
  }

  /* --------------------------------- Torrents -------------------------------- */

  uploadTorrent(torrent) {
    const uuid = getUuidByString(torrent.getName())
    const id = `torrent-download-row-${uuid}`
    let row = this.shadowRoot.querySelector(`#${id}`)

    if (!row) {
      this._activeTorrents.add(uuid)
      this.setStatus(`Downloading torrents…`, true)

      const contentHtml = `
        <div style="display:flex; flex-direction:column; width:100%; align-items:flex-start; font-size:.85rem;">
          <div style="display:flex; align-items:center; width:100%;">
            <div style="display:flex; width:32px; height:32px; justify-content:center; align-items:center; position:relative;">
              <iron-icon id="_${uuid}-collapse-btn" icon="unfold-less" style="--iron-icon-fill-color:var(--primary-text-color);"></iron-icon>
              <paper-ripple class="circle" recenters></paper-ripple>
            </div>
            <span id="${id}_title" class="file-path" style="flex-grow:1;">${torrent.getName()}</span>
            <span class="speedometer-div"></span>
          </div>
          <iron-collapse id="_${uuid}-collapse-torrent-panel" class="collapse-torrent-panel">
            <div id="_${uuid}-file-list-div" style="display:flex; flex-direction:column; padding-left:15px; padding-right:5px"></div>
          </iron-collapse>
          <span id="${id}_dest_path" class="file-path">${torrent.getDestination()}</span>
          <paper-progress id="${id}_progress_bar" style="width:100%; margin-top:5px;"></paper-progress>
        </div>`

      row = this.createTableRow(
        id,
        contentHtml,
        "",
        () => {
          this.showConfirmationDialog(
            `You're about to remove torrent <strong>${torrent.getName()}</strong>. Is this what you want to do?`,
            async () => {
              if (row.parentNode) row.parentNode.removeChild(row)
              try {
                await dropTorrent(torrent.getName())
                displayMessage("Torrent download was removed", 3000)
              } catch (e) {
                displayError(e, 3000)
              }
              this._activeTorrents.delete(uuid)
              if (this._activeFileUploads === 0 && this._activeLinkDownloads === 0 && this._activeTorrents.size === 0) {
                this.setStatus(`<span class="status-text-strong">Idle</span> — no active transfers`, false)
              }
            },
            () => {},
            "yes-delete-torrent",
            "no-delete-torrent"
          )
        }
      )

      const destEl = row.querySelector(`#${id}_dest_path`)
      if (destEl) destEl.onclick = () =>
        Backend.eventHub.publish("follow_link_event_", { path: torrent.getDestination() }, true)
      const titleEl = row.querySelector(`#${id}_title`)
      if (titleEl) titleEl.onclick = () =>
        Backend.eventHub.publish("follow_link_event_", { path: `${torrent.getDestination()}/${torrent.getName()}` }, true)

      this.torrentDownloadTableBody.appendChild(row)
    }

    const progressBar = row.querySelector(`#${id}_progress_bar`)
    const speedo = row.querySelector(".speedometer-div")

    if (torrent.getPercent() === 100) {
      if (progressBar) progressBar.style.display = "none"
      if (speedo) speedo.innerHTML = "Done"
      row.classList.add("completed")
      const titleEl = row.querySelector(`#${id}_title`)
      if (titleEl) {
        titleEl.classList.add("file-path")
        titleEl.onclick = () =>
          Backend.eventHub.publish("follow_link_event_", { path: `${torrent.getDestination()}/${torrent.getName()}` }, true)
      }
      this._activeTorrents.delete(uuid)
      if (this._activeFileUploads === 0 && this._activeLinkDownloads === 0 && this._activeTorrents.size === 0) {
        this.setStatus(`<span class="status-text-strong">Idle</span> — no active transfers`, false)
      } else {
        this.setStatus(`Some transfers are still running…`, true)
      }
    } else {
      if (speedo) speedo.innerHTML = formatBytes(torrent.getDownloadrate(), 1)
      if (progressBar) progressBar.value = torrent.getPercent()
      this._activeTorrents.add(uuid)
      this.setStatus(`Downloading torrents…`, true)
    }

    const collapseBtn = row.querySelector(`#_${uuid}-collapse-btn`)
    const collapsePanel = row.querySelector(`#_${uuid}-collapse-torrent-panel`)
    if (collapseBtn && collapsePanel) {
      collapseBtn.onclick = () => {
        collapseBtn.icon = collapsePanel.opened ? "unfold-less" : "unfold-more"
        collapsePanel.toggle()
      }
    }

    const filesDiv = row.querySelector(`#_${uuid}-file-list-div`)
    torrent.getFilesList().forEach((f) => {
      const fileId = `_${getUuidByString(f.getPath())}`
      let fileRow = filesDiv.querySelector(`#${fileId}`)
      if (!fileRow) {
        const fileHtml = `
          <div id="${fileId}" style="display:flex; flex-direction:column; font-size:.85rem;">
            <div style="display:flex;">
              <span id="file-lnk">${f.getPath().split("/").pop()}</span>
            </div>
            <paper-progress id="${fileId}_progress_bar" style="width:100%;"></paper-progress>
          </div>`
        filesDiv.insertAdjacentHTML("beforeend", fileHtml)
        fileRow = filesDiv.querySelector(`#${fileId}`)
      }

      const fileProgressBar = fileRow.querySelector(`#${fileId}_progress_bar`)
      if (fileProgressBar) fileProgressBar.value = f.getPercent()
      if (f.getPercent() === 100 && fileProgressBar && fileProgressBar.style.display !== "none") {
        fileProgressBar.style.display = "none"
        const fileLnk = fileRow.querySelector("#file-lnk")
        if (fileLnk) {
          fileLnk.classList.add("file-path")
          displayMessage(`Torrent File ${f.getPath()} was uploaded`, 3000)
          fileLnk.onclick = () =>
            Backend.eventHub.publish(
              "follow_link_event_",
              { path: `${torrent.getDestination()}/${f.getPath()}` },
              true
            )
        }
      }
    })
  }

  async getTorrentLnks(callback = () => {}) {
    try {
      const lnks = await getTorrentLinks()
      callback(lnks)
    } catch (e) {
      displayError(e, 3000)
    }
  }

  async getTorrentsInfo() {
    try {
      await streamTorrentInfos(
        (rsp) => {
          rsp.getInfosList().forEach((torrent) => {
            Backend.eventHub.publish("__upload_torrent_event__", torrent, true)
          })
        },
        (err) => console.error("Torrent info stream error:", err),
        () => console.log("Torrent info stream ended.")
      )
    } catch (e) {
      displayError(e, 3000)
    }
  }

  /* --------------------------------- Files ---------------------------------- */

  /**
   * Upload local files with progress using XHR directly (token header).
   */
  async uploadFiles(path, files) {
    if (!files || files.length === 0) return

    const token = sessionStorage.getItem("__globular_token__") || ""
    const base = (getBaseUrl() || window.location.origin).replace(/\/?$/, "")
    const url = `${base}/api/file-upload`

    this._activeFileUploads += files.length
    this.setStatus(`Uploading ${this._activeFileUploads} file(s)…`, true)

    const uploadFile = (index) => {
      if (index >= files.length) {
        this._activeFileUploads = Math.max(0, this._activeFileUploads - files.length)
        Backend.eventHub.publish("reload_dir_event", path, false)

        if (this._activeFileUploads === 0 && this._activeLinkDownloads === 0 && this._activeTorrents.size === 0) {
          this.setStatus(`<span class="status-text-strong">Idle</span> — no active transfers`, false)
        } else {
          this.setStatus(`Some transfers are still running…`, true)
        }
        return
      }

      const f = files[index]
      const id = `_${getUuidByString(path + "/" + f.name)}`
      let row = this.filesUploadTableBody.querySelector(`#${id}`)

      if (row && row.style.display === "none") {
        uploadFile(index + 1)
        return
      }

      let xhr = null

      if (!row) {
        const size = getFileSizeString(f.size)
        const contentHtml = `
          <div style="display:flex; flex-direction:column; width:100%; align-items:flex-start; font-size:.85rem;">
            <span id="file-lnk">${f.name}</span>
            <span id="dest-lnk" class="file-path">${path}</span>
            <paper-progress value="0" style="width:100%;"></paper-progress>
          </div>`
        row = this.createTableRow(
          id,
          contentHtml,
          size,
          () => {
            this.showConfirmationDialog(
              "You're about to cancel file upload. Is this what you want to do?",
              () => { xhr?.abort?.(); row.style.display = "none" },
              () => {},
              "yes-delete-upload",
              "no-delete-upload"
            )
          }
        )
        this.filesUploadTableBody.appendChild(row)
        const destEl = row.querySelector("#dest-lnk")
        if (destEl) destEl.onclick = () =>
          Backend.eventHub.publish("follow_link_event_", { path }, true)
      }

      // Build XHR upload (progress)
      const fd = new FormData()
      fd.append("multiplefiles", f, f.name)
      fd.append("path", path)

      xhr = new XMLHttpRequest()
      xhr.open("POST", url, true)
      if (token) {
        // Keep compatibility with your backend expecting `token` header
        xhr.setRequestHeader("token", token)
      }

      xhr.upload.onprogress = (event) => {
        const progress = row.querySelector("paper-progress")
        if (progress && event.lengthComputable) {
          progress.value = (event.loaded / event.total) * 100
        }
      }

      xhr.onerror = () => {
        displayError(`File upload for ${path}/${f.name} failed`, 3000)
        if (row) row.style.display = "none"
        uploadFile(index + 1)
      }

      xhr.onload = () => {
        const ok = xhr.status >= 200 && xhr.status < 300
        if (!ok) {
          displayError(`Upload error ${xhr.status}: ${xhr.statusText || "Unknown error"}`, 5000)
          if (row) row.style.display = "none"
          uploadFile(index + 1)
          return
        }

        displayMessage(`File ${f.name} was uploaded`, 3000)
        row.classList.add("completed")

        const progress = row.querySelector("paper-progress")
        if (progress) {
          progress.value = 100
          progress.style.display = "none"
        }

        const fileLnk = row.querySelector("#file-lnk")
        if (fileLnk) {
          fileLnk.classList.add("file-path")
          fileLnk.onclick = () =>
            Backend.eventHub.publish("follow_link_event_", { path: `${path}/${f.name}` }, true)
        }

        // After completion, the close button just clears the row
        const cancelBtn = row.querySelector("#cancel-btn")
        if (cancelBtn) {
          cancelBtn.onclick = () => {
            if (row.parentNode) row.parentNode.removeChild(row)
          }
        }

        uploadFile(index + 1)
      }

      // Hook cancel button to abort this xhr (while in progress)
      const cancelBtn = row.querySelector("#cancel-btn")
      if (cancelBtn) {
        cancelBtn.onclick = () => {
          this.showConfirmationDialog(
            "You're about to cancel file upload. Is this what you want to do?",
            () => { xhr.abort(); row.style.display = "none" },
            () => {},
            "yes-delete-upload",
            "no-delete-upload"
          )
        }
      }

      xhr.send(fd)
    }

    uploadFile(0)
  }
}

customElements.define("globular-files-uploader", FilesUploader)
