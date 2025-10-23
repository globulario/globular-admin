// components/filesListView.js

import { FilesView } from "./filesView.js";
import getUuidByString from "uuid-by-string";
import "@polymer/paper-checkbox/paper-checkbox.js";
import "@polymer/iron-icon/iron-icon.js";
import "@polymer/paper-ripple/paper-ripple.js";

import { displayError } from "../../backend/ui/notify";
import { Backend } from "../../backend/backend";

// Use the new backend wrappers instead of FileController.*
// - readText reads a whole file as UTF-8 text (streamed under the hood)
import { readText } from "../../backend/files";

// If you still rely on TitleController helpers, call them without globule now.
import { TitleController } from "../../backend/title";

/** Human-readable size formatter */
function getFileSizeString(bytes) {
  const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
  if (!bytes || bytes === 0) return "0 Bytes";
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return Math.round(bytes / Math.pow(1024, i), 2) + " " + sizes[i];
}

export class FilesListView extends FilesView {
  _dir = null;

  constructor() {
    super();

    // Shadow DOM scaffold
    this.attachShadow({ mode: "open" });
    this.shadowRoot.innerHTML = `
      <style>
        :host { display:block; width:100%; height:100%; overflow-y:auto; }
        table { width:100%; border-collapse:collapse; background:var(--surface-color); color:var(--primary-text-color); user-select:none; }
        thead tr { background:var(--surface-color-dark,#f0f0f0); border-bottom:1px solid var(--palette-divider); }
        th { padding:8px 12px; text-align:left; font-weight:500; font-size:.9rem; cursor:pointer; }
        th:hover { background:var(--paper-grey-200,#eee); }
        tbody tr { border-bottom:1px solid var(--palette-divider); transition:background .2s ease; }
        tbody tr:last-child { border-bottom:none; }
        tbody tr:hover { background:var(--paper-grey-100,#f5f5f5); }
        tbody tr.active { filter:brightness(1.05); }
        tbody tr.selected { background:var(--primary-light-color,#e0f2f7); }
        td { padding:8px 12px; font-size:.95rem; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:200px; }
        .first-cell { display:flex; align-items:center; position:relative; max-width:none; }
        .first-cell span { flex-grow:1; padding-left:8px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; cursor:pointer; }
        .first-cell span:hover { text-decoration:underline; }
        .first-cell paper-checkbox { visibility:hidden; --paper-checkbox-checked-color:var(--primary-color); --paper-checkbox-unchecked-color:var(--palette-action-disabled); }
        .first-cell paper-icon-button { min-width:40px; visibility:hidden; --iron-icon-fill-color:var(--palette-action-disabled); }
        .file-icon { height:24px; width:24px; margin-right:8px; }
        .file-thumbnail { height:32px; width:32px; object-fit:contain; margin-right:8px; display:none; }
        tbody tr:hover .first-cell paper-checkbox,
        tbody tr.active .first-cell paper-checkbox { visibility:visible; }
        tbody tr:hover .first-cell paper-icon-button,
        tbody tr.active .first-cell paper-icon-button { visibility:visible; }
        globular-dropdown-menu { position:absolute; top:0; left:0; z-index:100; }
      </style>
      <table>
        <thead>
          <tr>
            <th class="name_header_div">Name</th>
            <th class="modified_header_div">Modified</th>
            <th class="mime_header_div">Type</th>
            <th class="size_header_div">Size</th>
          </tr>
        </thead>
        <tbody id="files-list-view-info"></tbody>
      </table>
    `;

    this._domRefs = {
      fileListViewBody: this.shadowRoot.querySelector("#files-list-view-info"),
      tableElement: this.shadowRoot.querySelector("table"),
    };

    // Delegated table events
    this._domRefs.tableElement.addEventListener(
      "click",
      this._handleTableClick.bind(this)
    );
    this._domRefs.tableElement.addEventListener(
      "drop",
      this._handleTableDrop.bind(this)
    );
    this._domRefs.tableElement.addEventListener(
      "dragover",
      this._handleTableDragOver.bind(this)
    );
    this._domRefs.tableElement.addEventListener(
      "mouseover",
      this._handleTableMouseOver.bind(this)
    );
    this._domRefs.tableElement.addEventListener(
      "mouseout",
      this._handleTableMouseOut.bind(this)
    );
  }

  /** Render a directory (no more validateDirAccess/.globule) */
  setDir(dir) {
    this._dir = dir;
    this._renderFiles();
  }

  _renderFiles() {
    this._domRefs.fileListViewBody.innerHTML = "";

    const sorted = [...this._dir.getFilesList()].sort((a, b) => {
      if (a.getIsDir() && !b.getIsDir()) return -1;
      if (!a.getIsDir() && b.getIsDir()) return 1;
      return a.getName().localeCompare(b.getName());
    });

    for (const file of sorted) {
      // Skip plain dotfiles except known special cases
      if (
        file.getName().startsWith(".") &&
        file.getName() !== "audio.m3u" &&
        file.getName() !== "video.m3u" &&
        !file.getName().startsWith(".hidden")
      ) {
        continue;
      }
      const row = this._createFileRow(file);
      this._domRefs.fileListViewBody.appendChild(row);
    }
  }

  _createFileRow(file) {
    const rowId = `row-${getUuidByString(file.getPath())}`;
    const row = document.createElement("tr");
    row.id = rowId;
    row.dataset.filePath = file.getPath();
    row._file = file;

    let sizeDisplay = "";
    let mimeDisplay = file.getMime() || "Folder";
    let icon = "icons:insert-drive-file";
    let thumbnailSrc = "";

    if (file.getIsDir()) {
      sizeDisplay = `${file.getFilesList().length} items`;
      mimeDisplay = "Folder";
      icon = "icons:folder";
    } else {
      sizeDisplay = getFileSizeString(file.getSize());
      mimeDisplay = (file.getMime() || "").split(";")[0] || "";
      if (file.getMime().startsWith("video")) icon = "av:movie";
      else if (file.getMime().startsWith("audio")) icon = "av:music-note";
      else if (file.getMime().startsWith("image") && file.getThumbnail()) {
        thumbnailSrc = file.getThumbnail();
      }
    }

    let displayName = file.getName();
    if (file.getLnk && file.getLnk()) {
      displayName = `${file.getLnk().getName()} (Link)`;
    }

    // async enrichment (videos/audios/titles or folder infos)
    this._getFileDisplayInfo(row, (file.getMime() || "").split("/")[0], file)
      .then((info) => {
        if (info) this._updateRowDisplayInfo(row, (file.getMime() || "").split("/")[0], info);
      })
      .catch(() => { /* non-fatal */ });

    row.innerHTML = `
      <td class="first-cell" data-file-path="${file.getPath()}">
        <paper-checkbox id="checkbox-${rowId}"></paper-checkbox>
        <iron-icon id="icon-${rowId}" class="file-icon" icon="${icon}" style="${thumbnailSrc ? "display:none;" : ""}"></iron-icon>
        <img id="thumbnail-${rowId}" class="file-thumbnail" src="${thumbnailSrc}" style="${thumbnailSrc ? "display:block;" : "display:none;"}"/>
        <span title="${file.getPath()}">${displayName}</span>
        <paper-icon-button id="menu-btn-${rowId}" icon="icons:more-vert" class="control-button"></paper-icon-button>
        <paper-ripple recenters></paper-ripple>
      </td>
      <td>${new Date(file.getModeTime() * 1000).toLocaleString()}</td>
      <td>${mimeDisplay}</td>
      <td>${sizeDisplay}</td>
    `;

    // sync checkbox with global selection pub/sub
    Backend.eventHub.subscribe(
      `__file_select_unselect_${file.getPath()}`,
      () => {},
      (checked) => {
        const checkbox = row.querySelector("paper-checkbox");
        if (checkbox) checkbox.checked = checked;
        this._updateSelectionState(row, checked);
      },
      true,
      this
    );

    // wire checkbox change => selection map
    const checkbox = row.querySelector(`#checkbox-${rowId}`);
    checkbox?.addEventListener("change", (e) => {
      this._updateSelectionState(row, e.target.checked);
    });

    // context menu button
    const menuBtn = row.querySelector(`#menu-btn-${rowId}`);
    menuBtn?.addEventListener("click", (evt) => {
      evt.stopPropagation();
      if (!this.menu) return; // FilesView sets this.menu in parent
      this._showContextMenu(row, file, menuBtn);
    });

    // clicking on icon/name/thumbnail opens file/dir
    const firstCell = row.querySelector(".first-cell");
    firstCell?.addEventListener("click", (evt) => {
      const tag = evt.target.tagName;
      if (tag === "SPAN" || tag === "IRON-ICON" || tag === "IMG") {
        this._handleFileOpen(file);
      }
    });

    return row;
  }

  async _getFileDisplayInfo(row, mimeType, file) {
    let displayTitle = file.getName();
    let thumbnailUrl = file.getThumbnail && file.getThumbnail();

    try {
      if (mimeType === "video") {
        const videos = await new Promise((resolve, reject) =>
          TitleController.getFileVideosInfo(file, resolve, reject)
        );
        if (videos?.length > 0) {
          file.videos = videos;
          displayTitle = videos[0].getDescription?.() || displayTitle;
          const poster = videos[0].getPoster?.();
          if (poster?.getContenturl) thumbnailUrl = poster.getContenturl();
        }
      } else if (mimeType === "audio") {
        const audios = await new Promise((resolve, reject) =>
          TitleController.getFileAudiosInfo(file, resolve, reject)
        );
        if (audios?.length > 0) {
          file.audios = audios;
          displayTitle = audios[0].getTitle?.() || displayTitle;
          const poster = audios[0].getPoster?.();
          if (poster?.getContenturl) thumbnailUrl = poster.getContenturl();
        }
      } else if (file.getIsDir()) {
        // Try to read infos.json directly via the new readText helper
        try {
          const text = await readText(`${file.getPath()}/infos.json`);
          const titleInfos = JSON.parse(text || "{}");
          const title = await new Promise((resolve, reject) =>
            TitleController.getTitleInfo(titleInfos.ID, resolve, reject)
          );
          if (title) {
            file.titles = [title];
            displayTitle = title.getName?.() || displayTitle;
            const poster = title.getPoster?.();
            if (poster?.getContenturl) thumbnailUrl = poster.getContenturl();
          }
        } catch {
          /* silently ignore if infos.json not present */
        }
      }
    } catch (err) {
      console.warn(`Extended info failed for ${file.getName?.() || file.getName()}:`, err);
    } finally {
      const nameSpan = row.querySelector(".first-cell span");
      if (nameSpan) nameSpan.textContent = displayTitle;

      const iconEl = row.querySelector(".file-icon");
      const thumbEl = row.querySelector(".file-thumbnail");
      if (thumbnailUrl && thumbEl) {
        thumbEl.src = thumbnailUrl;
        thumbEl.style.display = "block";
        if (iconEl) iconEl.style.display = "none";
      } else {
        if (iconEl) iconEl.style.display = "block";
        if (thumbEl) thumbEl.style.display = "none";
      }
    }
  }

  _handleTableClick(evt) {
    evt.stopPropagation();
    const targetRow = evt.target.closest("tr");
    if (!targetRow || !targetRow._file) return;

    const target = evt.target;
    if (target.tagName === "PAPER-CHECKBOX") return;

    if (target.id && target.id.startsWith("menu-btn-")) {
      this._showContextMenu(targetRow, targetRow._file, target);
      return;
    }

    const firstCell = target.closest(".first-cell");
    if (firstCell && (target.tagName === "SPAN" || target.tagName === "IRON-ICON" || target.tagName === "IMG")) {
      this._handleFileOpen(targetRow._file);
    }
  }

  _handleTableDrop(evt) {
    evt.preventDefault();

    const filesDataTransfer = evt.dataTransfer.getData("files");
    const domainDataTransfer = evt.dataTransfer.getData("domain");
    const fileListTransfer = evt.dataTransfer.files;

    if (fileListTransfer.length > 0) {
      // New upload flow is handled elsewhere in app; just broadcast
      Backend.eventHub.publish(
        "__upload_files_event__",
        { dir: this._dir, files: Array.from(fileListTransfer) },
        true
      );
    } else if (filesDataTransfer && domainDataTransfer) {
      try {
        const files = JSON.parse(filesDataTransfer);
        const sourceId = evt.dataTransfer.getData("id");
        if (this._file_explorer_ && files.length > 0) {
          files.forEach((f) => {
            Backend.eventHub.publish(
              `drop_file_${this._file_explorer_.id}_event`,
              {
                file: f,
                dir: this._file_explorer_._path,
                id: sourceId,
                domain: domainDataTransfer,
              },
              true
            );
          });
        }
      } catch (e) {
        console.error("Error processing dropped files:", e);
        displayError("Failed to process dropped files.", 3000);
      }
    }
  }

  _handleTableDragOver(evt) {
    evt.preventDefault();
  }

  _handleTableMouseOver(evt) {
    const row = evt.target.closest("tr");
    if (!row || !row._file) return;
    row.classList.add("active");
    const checkbox = row.querySelector("paper-checkbox");
    if (checkbox) checkbox.style.visibility = "visible";
    const menuBtn = row.querySelector('paper-icon-button[id^="menu-btn-"]');
    if (menuBtn) menuBtn.style.visibility = "visible";
  }

  _handleTableMouseOut(evt) {
    const row = evt.target.closest("tr");
    if (!row || !row._file) return;
    if (!row.classList.contains("selected")) row.classList.remove("active");
    const checkbox = row.querySelector("paper-checkbox");
    if (checkbox && !checkbox.checked) checkbox.style.visibility = "hidden";
    const menuBtn = row.querySelector('paper-icon-button[id^="menu-btn-"]');
    if (menuBtn) menuBtn.style.visibility = "hidden";
  }

  _handleFileOpen(file) {
    if (file.getIsDir()) {
      this._file_explorer_.publishSetDirEvent(file.getPath());
    } else {
      const kind = (file.getMime() || "").split("/")[0];
      if (kind === "video") this._file_explorer_._playMedia(file, "video");
      else if (kind === "audio") this._file_explorer_._playMedia(file, "audio");
      else if (kind === "image") this._file_explorer_._showImage(file);
      else this._file_explorer_._readFile(file);
    }
    this.hideMenu?.();
  }

  _showContextMenu(row, file, menuButton) {
    const menu = this.menu;
    if (!menu) return;

    if (menu.parentNode !== document.body) document.body.appendChild(menu);

    const rect = menuButton.getBoundingClientRect();
    menu.style.position = "absolute";
    menu.style.top = `${rect.bottom + 5 + window.scrollY}px`;
    menu.style.left = `${rect.left + rect.width / 2 + window.scrollX}px`;

    menu.setFile(file);
    menu.rename = () => this.rename(row, file, row.offsetTop + row.offsetHeight + 6);
    menu.showBtn();

    menu.onmouseenter = () => row.classList.add("active");
    menu.onmouseleave = () => row.classList.remove("active");
  }

  _updateSelectionState(row, checked) {
    if (checked) {
      row.classList.add("selected");
      this.selected[row.dataset.filePath] = row._file;
    } else {
      row.classList.remove("selected");
      delete this.selected[row.dataset.filePath];
    }
  }
}

customElements.define("globular-files-list-view", FilesListView);
