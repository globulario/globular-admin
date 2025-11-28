// components/filesUploader.js

import getUuidByString from "uuid-by-string"
import { Backend } from "../../backend/backend"

// New torrent wrapper (no direct *_pb imports here)
import { dropTorrent, getTorrentLinks, streamTorrentInfos } from "../../backend/cms/torrent"

// Use helpers from files.ts (size string)
import { getFileSizeString } from "../../backend/cms/files"
import { getBaseUrl } from "../../backend/core/endpoints"

import { formatBytes } from "../utility"

import "@polymer/iron-icon/iron-icon.js"
import "@polymer/iron-collapse/iron-collapse.js"
import "@polymer/paper-progress/paper-progress.js"
import "@polymer/paper-icon-button/paper-icon-button.js"
import "@polymer/paper-ripple/paper-ripple.js"
import "@polymer/paper-button/paper-button.js"
import { displayError, displayMessage } from "../../backend/ui/notify"

const TRANSFER_TYPES = {
  FILE: "file",
  LINK: "link",
  TORRENT: "torrent",
}

/**
 * Try to surface structured HTTP error bodies that look like:
 *   { error: "...", Error: "...", message: "...", Message: "..." }
 * This mirrors the golang WriteJSONError helper on the server.
 */
function deriveXhrErrorText(xhr) {
  if (!xhr) return null
  const raw = String(xhr.responseText || "").trim()
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    const candidate =
      parsed?.error ?? parsed?.Error ?? parsed?.message ?? parsed?.Message
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim()
  } catch {
    // fall through and return raw text below
  }
  return raw
}

export class FilesUploader extends HTMLElement {
  constructor() {
    super()
    this.attachShadow({ mode: "open" })

    this.width = parseInt(this.getAttribute("width")) || 640
    this.height = parseInt(this.getAttribute("height")) || 420

    this.render()
    this.initElements()
    this.addEventListeners()
    this.initializeData()
  }

  /* -------------------------------------------------------------------------- */
  /*  RENDER / INIT                                                             */
  /* -------------------------------------------------------------------------- */

  render() {
    this.shadowRoot.innerHTML = `
      <style>
        :host {
          position: fixed;
          right: 16px;
          bottom: 12px;
          z-index: 2000;
          font-family: var(--font-family, Roboto, "Helvetica Neue", Arial, sans-serif);
          color: var(--on-surface-color, #fff);
        }

        ::-webkit-scrollbar {
          width: 8px;
        }
        ::-webkit-scrollbar-track {
          background: var(--scroll-track, transparent);
        }
        ::-webkit-scrollbar-thumb {
          background: var(--scroll-thumb, var(--palette-divider));
          border-radius: 6px;
        }

        #container {
          background-color: var(--surface-elevated-color, var(--surface-color));
          font-size: 0.9rem;
          display: flex;
          flex-direction: column;
          height: auto;
          width: ${this.width}px;
          max-height: ${this.height}px;
          border-radius: 10px;
          overflow: hidden;
          box-shadow: 0 6px 18px rgba(0,0,0,0.4);
          border: 1px solid var(--palette-divider);
        }

        .header-bar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 4px 8px;
          background: var(--surface-color-dark, #181818);
          border-bottom: 1px solid var(--palette-divider);
        }

        .header-left {
          display: flex;
          align-items: center;
          gap: 6px;
          min-width: 0;
        }

        .header-left iron-icon {
          --iron-icon-height: 18px;
          --iron-icon-width: 18px;
          --iron-icon-fill-color: var(--on-surface-color);
        }

        .header-title {
          font-size: 0.85rem;
          font-weight: 500;
          white-space: nowrap;
        }

        .header-count {
          margin-left: 4px;
          padding: 0 6px;
          border-radius: 999px;
          font-size: 0.7rem;
          background: rgba(255,255,255,0.08);
          color: var(--secondary-text-color, #aaa);
        }

        .header-actions {
          display: flex;
          align-items: center;
        }

        paper-icon-button {
          width: 28px;
          height: 28px;
          padding: 0;
        }

        .card-content {
          display: flex;
          flex-direction: column;
          flex: 1;
          min-height: 0;
          max-height: ${this.height - 56}px;
          overflow-y: auto;
        }

        :host(.collapsed) .card-content {
          display: none;
        }

        .table {
          width: 100%;
          display: flex;
          flex-direction: column;
        }

        .table-header {
          display: flex;
          flex-direction: row;
          padding: 2px 6px;
          font-size: 0.7rem;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          color: var(--secondary-text-color, #999);
          border-bottom: 1px solid var(--palette-divider);
        }

        .table-header .col-cancel {
          width: 28px;
        }
        .table-header .col-type {
          width: 64px;
        }
        .table-header .col-main {
          flex: 1;
        }
        .table-header .col-info {
          width: 96px;
          text-align: right;
        }

        .table-body {
          display: flex;
          flex-direction: column;
        }

        .table-row {
          display: flex;
          flex-direction: row;
          padding: 3px 4px 4px 4px;
          border-bottom: 1px solid rgba(255,255,255,0.04);
          transition: background 0.12s ease, opacity 0.12s ease;
        }

        .table-row:hover {
          background: rgba(255,255,255,0.02);
        }

        .table-row.completed {
          opacity: 0.8;
        }

        .table-cell {
          display: flex;
          flex-direction: column;
          justify-content: center;
          min-height: 30px;
        }

        .cell-cancel {
          width: 28px;
          align-items: center;
        }

        .cell-type {
          width: 64px;
          font-size: 0.7rem;
          text-transform: uppercase;
          color: var(--secondary-text-color, #aaa);
          align-items: flex-start;
          justify-content: center;
        }

        .cell-type-label {
          padding: 2px 6px;
          border-radius: 999px;
          background: rgba(255,255,255,0.06);
        }

        .cell-main {
          flex: 1;
          padding: 0 4px;
          min-width: 0;
        }

        .cell-info {
          width: 96px;
          font-size: 0.75rem;
          text-align: right;
          align-items: flex-end;
          justify-content: center;
          font-variant-numeric: tabular-nums;
          color: var(--secondary-text-color, #aaa);
        }

        .row-primary {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 6px;
          min-width: 0;
        }

        .file-name {
          overflow: hidden;
          white-space: nowrap;
          text-overflow: ellipsis;
          font-size: 0.8rem;
        }

        .status-pill {
          font-size: 0.7rem;
          padding: 0 6px;
          border-radius: 999px;
          background: rgba(255,255,255,0.06);
          color: var(--secondary-text-color, #aaa);
          white-space: nowrap;
        }

        .row-secondary {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 6px;
          margin-top: 2px;
        }

        .file-path {
          overflow: hidden;
          white-space: nowrap;
          text-overflow: ellipsis;
          text-decoration: underline;
          cursor: pointer;
          font-size: 0.75rem;
        }

        .file-path:hover {
          text-decoration: none;
        }

        .row-meta {
          font-size: 0.7rem;
          color: var(--secondary-text-color, #aaa);
          white-space: nowrap;
        }

        paper-progress {
          width: 100%;
          margin-top: 3px;
          height: 4px;
          --paper-progress-height: 4px;
        }

        .details-toggle {
          font-size: 0.7rem;
          margin-top: 2px;
          cursor: pointer;
          color: var(--secondary-text-color, #aaa);
          display: inline-flex;
          align-items: center;
          gap: 3px;
        }

        .details-toggle iron-icon {
          --iron-icon-height: 14px;
          --iron-icon-width: 14px;
        }

        .details-body {
          font-size: 0.75rem;
          margin-top: 2px;
          padding: 3px 0 0 0;
          border-top: 1px dashed rgba(255,255,255,0.1);
        }

        .torrent-file-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 6px;
          margin-bottom: 2px;
        }

        .torrent-file-row span[id="file-lnk"] {
          cursor: pointer;
          text-decoration: underline;
        }

        /* Status bar at bottom */
        #status-bar {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 4px 8px;
          border-top: 1px solid var(--palette-divider);
          font-size: 0.75rem;
          background: var(--surface-color-dark, #151515);
          color: var(--secondary-text-color);
        }

        :host(.collapsed) #status-bar {
          border-top: none;
        }

        #status-indicator {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: var(--palette-action-disabled, rgba(150,150,150,0.7));
          box-shadow: 0 0 0 0 rgba(0,0,0,0.15);
        }

        #status-bar.busy #status-indicator {
          background: var(--primary-color, #ff9800);
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
          color: var(--on-surface-color);
        }

        @media (max-width: 600px) {
          :host {
            left: 0;
            right: 0;
            bottom: 0;
          }
          #container {
            width: calc(100vw - 16px);
            margin: 0 8px 6px 8px;
          }
        }
      </style>

      <div id="container">
        <div class="header-bar">
          <div class="header-left">
            <iron-icon icon="file-upload"></iron-icon>
            <span class="header-title">Transfers</span>
            <span class="header-count" id="header-count">0</span>
          </div>
          <div class="header-actions">
            <paper-icon-button id="toggle-collapse-btn" icon="expand-more"></paper-icon-button>
            <paper-icon-button id="close-btn" icon="icons:close"></paper-icon-button>
          </div>
        </div>

        <div class="card-content">
          <div class="table">
            <div class="table-header">
              <div class="col-cancel"> </div>
              <div class="col-type">Source</div>
              <div class="col-main">Transfer</div>
              <div class="col-info">Info</div>
            </div>
            <div class="table-body" id="transfers-tbody"></div>
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
    this.container = this.shadowRoot.querySelector("#container")
    this.bodyEl = this.shadowRoot.querySelector("#transfers-tbody")
    this.statusBar = this.shadowRoot.querySelector("#status-bar")
    this.statusText = this.shadowRoot.querySelector("#status-text")
    this.headerCount = this.shadowRoot.querySelector("#header-count")
    this.toggleCollapseBtn = this.shadowRoot.querySelector("#toggle-collapse-btn")

    // counters
    this._activeFileUploads = 0
    this._activeLinkDownloads = 0
    this._activeTorrents = new Set()
    this._uploaderActivityActive = false
  }

  addEventListeners() {
    const closeBtn = this.shadowRoot.querySelector("#close-btn")
    if (closeBtn) {
      closeBtn.addEventListener("click", () => {
        // Let the FileExplorer (or whoever owns the uploader) decide what "close" means
        Backend.eventHub.publish("__file_uploader_close__", {}, true, this)
      })
    }

    if (this.toggleCollapseBtn) {
      this.toggleCollapseBtn.addEventListener("click", () => {
        const collapsed = this.classList.toggle("collapsed")
        this.toggleCollapseBtn.icon = collapsed ? "expand-less" : "expand-more"
      })
    }

    // New upload event (no .globule needed)
    Backend.eventHub.subscribe(
      "__upload_files_event__",
      (_uuid) => { },
      (evt) => this.uploadFiles(evt.dir?.getPath?.() ?? evt.dir, evt.files),
      true,
      this
    )

    // Link download progress events
    Backend.eventHub.subscribe(
      "__upload_link_event__",
      (_uuid) => { },
      (evt) => this.uploadLink(evt.pid, evt.path, evt.infos, evt.lnk, evt.done),
      true,
      this
    )

    Backend.eventHub.subscribe(
      "__upload_torrent_event__",
      (_uuid) => { },
      (evt) => this.uploadTorrent(evt),
      true,
      this
    )

    // Legacy peer-start event: just (re)attach torrent streams
    Backend.eventHub.subscribe(
      "start_peer_evt_",
      (_uuid) => { },
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

  /* -------------------------------------------------------------------------- */
  /*  COMMON HELPERS                                                            */
  /* -------------------------------------------------------------------------- */

  ensureVisible() {
    this.style.display = "block"
  }

  setStatus(message, busy = false) {
    if (this.statusText) {
      this.statusText.innerHTML =
        message || `<span class="status-text-strong">Idle</span> — no active transfers`
    }
    if (this.statusBar) {
      this.statusBar.classList.toggle("busy", !!busy)
    }
  }

  _emitActivityState() {
    const activeCount =
      this._activeFileUploads + this._activeLinkDownloads + this._activeTorrents.size
    const active = activeCount > 0

    if (this.headerCount) this.headerCount.textContent = String(activeCount)

    if (active === this._uploaderActivityActive) return
    this._uploaderActivityActive = active
    Backend.eventHub.publish("__file_uploader_activity__", { active }, true, this)
  }

  _updateGlobalStatusAfterChange() {
    const stillActive =
      this._activeFileUploads > 0 ||
      this._activeLinkDownloads > 0 ||
      this._activeTorrents.size > 0

    if (!stillActive) {
      this.setStatus(`<span class="status-text-strong">Idle</span> — no active transfers`, false)
    } else {
      this.setStatus(`Some transfers are still running…`, true)
    }
  }

  createUnifiedRow(id, typeLabel, name, path, sizeOrInfo, onCancel) {
    const row = document.createElement("div")
    row.className = "table-row"
    row.id = id

    // Cancel cell
    const cancelCell = document.createElement("div")
    cancelCell.className = "table-cell cell-cancel"
    const cancelBtn = document.createElement("paper-icon-button")
    cancelBtn.icon = "icons:close"
    cancelBtn.id = "cancel-btn"
    cancelCell.appendChild(cancelBtn)

    // Type cell
    const typeCell = document.createElement("div")
    typeCell.className = "table-cell cell-type"
    typeCell.innerHTML = `<span class="cell-type-label">${typeLabel}</span>`

    // Main cell
    const mainCell = document.createElement("div")
    mainCell.className = "table-cell cell-main"
    mainCell.innerHTML = `
      <div class="row-primary">
        <span class="file-name" id="${id}_name">${name}</span>
        <span class="status-pill" id="${id}_status">Pending</span>
      </div>
      <div class="row-secondary">
        <span class="file-path" id="${id}_path">${path}</span>
        <span class="row-meta" id="${id}_meta"></span>
      </div>
      <paper-progress id="${id}_progress" value="0"></paper-progress>
      <div class="details-toggle" id="${id}_details-toggle" style="display:none;">
        <iron-icon icon="expand-more"></iron-icon>
        <span>Details</span>
      </div>
      <iron-collapse id="${id}_details">
        <div class="details-body" id="${id}_details-body"></div>
      </iron-collapse>
    `

    // Info cell
    const infoCell = document.createElement("div")
    infoCell.className = "table-cell cell-info"
    infoCell.id = `${id}_info`
    infoCell.textContent = sizeOrInfo || ""

    row.appendChild(cancelCell)
    row.appendChild(typeCell)
    row.appendChild(mainCell)
    row.appendChild(infoCell)

    if (typeof onCancel === "function") {
      cancelBtn.onclick = onCancel
    }

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
    if (yesBtn)
      yesBtn.onclick = () => {
        toast.hideToast()
        onConfirm?.()
      }
    if (noBtn)
      noBtn.onclick = () => {
        toast.hideToast()
        onCancel?.()
      }
  }

  /* -------------------------------------------------------------------------- */
  /*  LINKS (YT-DLP)                                                            */
  /* -------------------------------------------------------------------------- */

  parseYtDlpProgress(line) {
    // examples:
    // [download] 35.2% of 420.67MiB at 36.20MiB/s ETA 00:07
    const re =
      /\[download\]\s+([\d.]+)%\s+of\s+([\d.]+[KMG]?i?B)\s+at\s+([\d.]+[KMG]?i?B\/s)\s+ETA\s+([0-9:]+)/i
    const m = re.exec(line)
    if (!m) return null
    return {
      percent: parseFloat(m[1]),
      size: m[2],
      speed: m[3],
      eta: m[4],
    }
  }

  uploadLink(pid, path, infos, lnk, done) {
    this.ensureVisible()

    const id = `link-download-row-${pid}`
    let row = this.shadowRoot.querySelector(`#${id}`)

    // finished
    if (done || infos === "done") {
      if (!row) return
      const nameEl = row.querySelector(`#${id}_name`)
      const title = nameEl ? nameEl.textContent : ""
      displayMessage(`Video ${title || ""} was downloaded`, 3000)

      const statusEl = row.querySelector(`#${id}_status`)
      if (statusEl) statusEl.textContent = "Done"

      const progress = row.querySelector(`#${id}_progress`)
      if (progress) {
        progress.value = 100
        progress.style.display = "none"
      }

      const infoCell = row.querySelector(`#${id}_info`)
      if (infoCell) infoCell.textContent = "Completed"

      row.classList.add("completed")

      const fileName =
        title && title.includes(": ") ? title.split(": ").pop() : title || "video"
      const filePath = `${path}/${fileName}`

      const pathEl = row.querySelector(`#${id}_path`)
      if (pathEl) {
        pathEl.textContent = path
        pathEl.onclick = () =>
          Backend.eventHub.publish("follow_link_event_", { path }, true)
      }

      const fileClick = () =>
        Backend.eventHub.publish("follow_link_event_", { path: filePath }, true)
      if (nameEl) {
        nameEl.classList.add("file-path")
        nameEl.onclick = fileClick
      }

      const cancelBtn = row.querySelector("#cancel-btn")
      if (cancelBtn) {
        cancelBtn.onclick = () => row.parentNode && row.parentNode.removeChild(row)
      }

      this._activeLinkDownloads = Math.max(0, this._activeLinkDownloads - 1)
      this._emitActivityState()
      this._updateGlobalStatusAfterChange()
      return
    }

    // running
    if (!row) {
      this._activeLinkDownloads++
      this._emitActivityState()
      this.setStatus(`Downloading video from link…`, true)

      const titleText =
        typeof infos === "string" && !infos.startsWith("[download]")
          ? infos
          : lnk || "Video download"

      row = this.createUnifiedRow(
        id,
        "Video",
        titleText,
        path,
        "",
        () => {
          this.showConfirmationDialog(
            "You're about to cancel video download. Is this what you want to do?",
            () => {
              Backend.eventHub.publish(
                "cancel_upload_event",
                JSON.stringify({ pid, path }),
                false
              )
              if (row) row.style.display = "none"
              this._activeLinkDownloads = Math.max(0, this._activeLinkDownloads - 1)
              this._emitActivityState()
              this._updateGlobalStatusAfterChange()
            },
            () => { },
            "yes-delete-upload-video",
            "no-delete-upload-video"
          )
        }
      )

      const statusEl = row.querySelector(`#${id}_status`)
      if (statusEl) statusEl.textContent = "Starting…"

      const pathEl = row.querySelector(`#${id}_path`)
      if (pathEl) {
        pathEl.onclick = () =>
          Backend.eventHub.publish("follow_link_event_", { path }, true)
      }

      this.bodyEl.appendChild(row)
    } else {
      const statusEl = row.querySelector(`#${id}_status`)
      const infoCell = row.querySelector(`#${id}_info`)
      const metaEl = row.querySelector(`#${id}_meta`)
      const progress = row.querySelector(`#${id}_progress`)

      if (typeof infos === "string") {
        if (infos.startsWith("[download] Destination:")) {
          // final file name
          const fileName = infos.substring(infos.lastIndexOf("/") + 1)
          const nameEl = row.querySelector(`#${id}_name`)
          if (nameEl) nameEl.textContent = fileName
        } else if (infos.startsWith("[download]")) {
          const parsed = this.parseYtDlpProgress(infos)
          if (parsed) {
            if (progress) progress.value = parsed.percent
            if (statusEl) statusEl.textContent = `${parsed.percent.toFixed(1)}%`
            const infoText = `${parsed.size}`
            const metaText = `${parsed.speed} · ETA ${parsed.eta}`
            if (infoCell) infoCell.textContent = infoText
            if (metaEl) metaEl.textContent = metaText
          } else {
            if (metaEl) metaEl.textContent = infos.replace("[download] ", "")
          }
        } else {
          if (metaEl) metaEl.textContent = infos
        }
      }
    }
  }

  /* -------------------------------------------------------------------------- */
  /*  TORRENTS                                                                  */
  /* -------------------------------------------------------------------------- */

  uploadTorrent(torrent) {
    this.ensureVisible()

    const uuid = getUuidByString(torrent.getName())
    const id = `torrent-download-row-${uuid}`
    let row = this.shadowRoot.querySelector(`#${id}`)

    if (!row) {
      this._activeTorrents.add(uuid)
      this.setStatus(`Downloading torrents…`, true)
      this._emitActivityState()

      const destPath = torrent.getDestination()
      row = this.createUnifiedRow(
        id,
        "Torrent",
        torrent.getName(),
        destPath,
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
              this._emitActivityState()
              this._updateGlobalStatusAfterChange()
            },
            () => { },
            "yes-delete-torrent",
            "no-delete-torrent"
          )
        }
      )

      const pathEl = row.querySelector(`#${id}_path`)
      if (pathEl) {
        pathEl.onclick = () =>
          Backend.eventHub.publish("follow_link_event_", { path: destPath }, true)
      }

      // details toggle
      const toggle = row.querySelector(`#${id}_details-toggle`)
      const details = row.querySelector(`#${id}_details`)
      if (toggle && details) {
        toggle.style.display = "inline-flex"
        toggle.addEventListener("click", () => {
          details.toggle()
          const icon = toggle.querySelector("iron-icon")
          if (icon) {
            icon.icon = details.opened ? "expand-less" : "expand-more"
          }
        })
      }

      this.bodyEl.appendChild(row)
    }

    const progressBar = row.querySelector(`#${id}_progress`)
    const infoCell = row.querySelector(`#${id}_info`)
    const statusEl = row.querySelector(`#${id}_status`)
    const metaEl = row.querySelector(`#${id}_meta`)

    const percent = torrent.getPercent()
    const speed = formatBytes(torrent.getDownloadrate(), 1)

    if (percent === 100) {
      if (progressBar) {
        progressBar.value = 100
        progressBar.style.display = "none"
      }
      if (statusEl) statusEl.textContent = "Done"
      if (infoCell) infoCell.textContent = "Completed"
      if (metaEl) metaEl.textContent = speed ? `${speed}/s` : ""
      row.classList.add("completed")

      const titleEl = row.querySelector(`#${id}_name`)
      if (titleEl) {
        titleEl.classList.add("file-path")
        titleEl.onclick = () =>
          Backend.eventHub.publish("follow_link_event_", {
            path: `${torrent.getDestination()}/${torrent.getName()}`,
          }, true)
      }

      this._activeTorrents.delete(uuid)
      this._emitActivityState()
      this._updateGlobalStatusAfterChange()
    } else {
      if (progressBar) progressBar.value = percent
      if (statusEl) statusEl.textContent = `${percent.toFixed(1)}%`
      if (infoCell) infoCell.textContent = `${speed}/s`
      if (metaEl) metaEl.textContent = ""
      this._activeTorrents.add(uuid)
      this._emitActivityState()
      this.setStatus(`Downloading torrents…`, true)
    }

    // per-file details
    const filesDiv = row.querySelector(`#${id}_details-body`)
    torrent.getFilesList().forEach((f) => {
      const fileId = `_${getUuidByString(f.getPath())}`
      let fileRow = filesDiv.querySelector(`#${fileId}`)
      if (!fileRow) {
        fileRow = document.createElement("div")
        fileRow.id = fileId
        fileRow.className = "torrent-file-row"
        fileRow.innerHTML = `
          <span id="file-lnk">${f.getPath().split("/").pop()}</span>
          <paper-progress id="${fileId}_progress_bar"></paper-progress>
        `
        filesDiv.appendChild(fileRow)
      }

      const fileProgressBar = fileRow.querySelector(`#${fileId}_progress_bar`)
      if (fileProgressBar) fileProgressBar.value = f.getPercent()
      if (f.getPercent() === 100 && fileProgressBar && fileProgressBar.style.display !== "none") {
        fileProgressBar.style.display = "none"
        const fileLnk = fileRow.querySelector("#file-lnk")
        if (fileLnk) {
          fileLnk.classList.add("file-path")
          displayMessage(`Torrent file ${f.getPath()} was downloaded`, 3000)
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

  async getTorrentLnks(callback = () => { }) {
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

  /* -------------------------------------------------------------------------- */
  /*  FILES (LOCAL UPLOAD)                                                      */
  /* -------------------------------------------------------------------------- */

  async uploadFiles(path, files) {
    if (!files || files.length === 0) return

    this.ensureVisible()

    const token = sessionStorage.getItem("__globular_token__") || ""
    const base = (getBaseUrl() || window.location.origin).replace(/\/?$/, "")
    const url = `${base}/api/file-upload`

    this._activeFileUploads += files.length
    this.setStatus(`Uploading ${this._activeFileUploads} file(s)…`, true)
    this._emitActivityState()

    const uploadFile = (index) => {
      if (index >= files.length) {
        this._activeFileUploads = Math.max(0, this._activeFileUploads - files.length)
        this._emitActivityState()
        Backend.eventHub.publish("reload_dir_event", path, false)
        this._updateGlobalStatusAfterChange()
        return
      }

      const f = files[index]
      const id = `_${getUuidByString(path + "/" + f.name)}`
      let row = this.bodyEl.querySelector(`#${id}`)
      let xhr = null

      if (row && row.style.display === "none") {
        uploadFile(index + 1)
        return
      }

      if (!row) {
        const size = getFileSizeString(f.size)
        row = this.createUnifiedRow(
          id,
          "File",
          f.name,
          path,
          size,
          () => {
            this.showConfirmationDialog(
              "You're about to cancel file upload. Is this what you want to do?",
              () => {
                xhr?.abort?.()
                row.style.display = "none"
              },
              () => { },
              "yes-delete-upload",
              "no-delete-upload"
            )
          }
        )

        const statusEl = row.querySelector(`#${id}_status`)
        if (statusEl) statusEl.textContent = "Uploading…"

        const pathEl = row.querySelector(`#${id}_path`)
        if (pathEl) {
          pathEl.onclick = () =>
            Backend.eventHub.publish("follow_link_event_", { path }, true)
        }

        this.bodyEl.appendChild(row)
      }

      // Build XHR upload (progress)
      const fd = new FormData()
      fd.append("multiplefiles", f, f.name)
      fd.append("path", path)

      xhr = new XMLHttpRequest()
      xhr.open("POST", url, true)
      if (token) xhr.setRequestHeader("token", token)

      xhr.upload.onprogress = (event) => {
        const progress = row.querySelector(`#${id}_progress`)
        const statusEl = row.querySelector(`#${id}_status`)
        const infoCell = row.querySelector(`#${id}_info`)
        if (progress && event.lengthComputable) {
          const percent = (event.loaded / event.total) * 100
          progress.value = percent
          if (statusEl) statusEl.textContent = `${percent.toFixed(1)}%`
          if (infoCell) infoCell.textContent = getFileSizeString(f.size)
        }
      }

      xhr.onerror = () => {
        displayError(`File upload for ${path}/${f.name} failed`, 3000)
        if (row) row.style.display = "none"
        uploadFile(index + 1)
      }

      xhr.onload = () => {
        const ok = xhr.status >= 200 && xhr.status < 300
        const progress = row.querySelector(`#${id}_progress`)
        const statusEl = row.querySelector(`#${id}_status`)
        const infoCell = row.querySelector(`#${id}_info`)
        const metaEl = row.querySelector(`#${id}_meta`)

        if (!ok) {
          const detail = deriveXhrErrorText(xhr)
          const statusText = (xhr.statusText || "").trim()
          const statusLabel = detail || statusText || "Unknown error"
          const suffix = detail && statusText ? ` (${statusText})` : ""
          displayError(`Upload error ${xhr.status}: ${statusLabel}${suffix}`, 5000)
          if (row) row.style.display = "none"
          uploadFile(index + 1)
          return
        }

        displayMessage(`File ${f.name} was uploaded`, 3000)
        row.classList.add("completed")

        if (progress) {
          progress.value = 100
          progress.style.display = "none"
        }
        if (statusEl) statusEl.textContent = "Done"
        if (infoCell) infoCell.textContent = getFileSizeString(f.size)
        if (metaEl) metaEl.textContent = ""

        const fileLnk = row.querySelector(`#${id}_name`)
        if (fileLnk) {
          fileLnk.classList.add("file-path")
          fileLnk.onclick = () =>
            Backend.eventHub.publish(
              "follow_link_event_",
              { path: `${path}/${f.name}` },
              true
            )
        }

        const cancelBtn = row.querySelector("#cancel-btn")
        if (cancelBtn) {
          cancelBtn.onclick = () => row.parentNode && row.parentNode.removeChild(row)
        }

        uploadFile(index + 1)
      }

      // Hook cancel button to abort this xhr (while in progress)
      const cancelBtn = row.querySelector("#cancel-btn")
      if (cancelBtn) {
        cancelBtn.onclick = () => {
          this.showConfirmationDialog(
            "You're about to cancel file upload. Is this what you want to do?",
            () => {
              xhr.abort()
              row.style.display = "none"
            },
            () => { },
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
