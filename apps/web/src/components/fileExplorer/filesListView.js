// components/filesListView.js — DRY with filevm-helper and shared menu from FilesView

import { FilesView } from "./filesView.js";
import getUuidByString from "uuid-by-string";
import "@polymer/paper-checkbox/paper-checkbox.js";
import "@polymer/iron-icon/iron-icon.js";
import "@polymer/paper-ripple/paper-ripple.js";
import "@polymer/paper-icon-button/paper-icon-button.js"; // menu button

// Icon packs so iron-icon can resolve "icons:*", "av:*", "editor:*"
import "@polymer/iron-icons/iron-icons.js";   // icons:folder, icons:insert-drive-file
import "@polymer/iron-icons/av-icons.js";     // av:movie, av:music-note
import "@polymer/iron-icons/editor-icons.js"; // editor:insert-drive-file

import { displayError } from "../../backend/ui/notify";
import { Backend } from "../../backend/backend";

// New backend wrappers
import { readText, isLinkFile, loadLinkTarget } from "../../backend/cms/files";
import { getFileAudiosInfo, getFileVideosInfo, getTitleInfo } from "../../backend/media/title";

// DRY helpers
import {
  pathOf,
  nameOf,
  mimeOf,
  isDir as isDirOf,
  sizeOf,
  filesOf,
  thumbOf,
  modTimeOf,
} from "./filevm-helpers.js";

/** Human-readable size formatter (no floating bugs) */
function getFileSizeString(bytes) {
  if (!bytes || bytes <= 0) return "0 Bytes";
  const units = ["Bytes", "KB", "MB", "GB", "TB", "PB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const val = bytes / Math.pow(1024, i);
  return `${(i === 0 ? Math.round(val) : Math.round(val * 10) / 10)} ${units[i]}`;
}

/** Get current explorer path safely */
function getCurrentExplorerPath(explorer) {
  return (explorer?.getCurrentPath?.() ?? explorer?._path ?? "/");
}

/** Map a (lowercased) MIME string to an iron-icon name */
function iconForMime(m) {
  if (!m) return "icons:insert-drive-file";
  if (m.startsWith("video/")) return "av:movie";
  if (m.startsWith("audio/")) return "av:music-note";
  if (m.startsWith("text/")) return "editor:insert-drive-file";
  return "icons:insert-drive-file";
}

export class FilesListView extends FilesView {
  _dir = null;
  _active = false; // track current active state

  setActive(isActive) {
    this._active = !!isActive;
  }

  resetActive() {
    this._active = false;
  }

  isActive() {
    return !!this._active;
  }
  constructor() {
    super();

    // Shadow DOM scaffold
    this.attachShadow({ mode: "open" });
    this.shadowRoot.innerHTML = `
    <style>
      :host {
        display: block;
        width: 100%;
        height: 100%;
        overflow-y: auto;
        background: var(--surface-color);
        color: var(--primary-text-color);
        scrollbar-width: thin;
        scrollbar-color: var(--scroll-thumb, var(--palette-divider))
                        var(--scroll-track, var(--surface-color));
      }

      /* Chrome/WebKit */
      :host::-webkit-scrollbar {
        width: 10px;
      }
      :host::-webkit-scrollbar-track {
        background: var(--scroll-track, var(--surface-color));
      }
      :host::-webkit-scrollbar-thumb {
        background: var(--scroll-thumb, var(--palette-divider));
        border-radius: 6px;
      }

      table {
        width: 100%;
        border-collapse: collapse;
        background: var(--surface-color);
        color: var(--on-surface-color);
        user-select: none;
      }

      thead tr {
        background: var(--table-header-bg,
                        var(--surface-variant, var(--surface-color)));
        border-bottom: 1px solid var(--palette-divider);
      }

      th {
        padding: 4px 8px;
        text-align: left;
        font-weight: 500;
        font-size: .9rem;
        cursor: pointer;
      }

      th:hover {
        background: var(--table-header-hover-bg,
                        var(--row-hover-bg, rgba(0,0,0,0.04)));
      }

      tbody tr {
        border-bottom: 1px solid var(--palette-divider);
        transition: background .2s ease;
      }

      tbody tr:last-child {
        border-bottom: none;
      }

      tbody tr:hover {
        background: var(--row-hover-bg,
                        rgba(0,0,0,0.04));
      }

      tbody tr.active {
        filter: brightness(1.05);
      }

      tbody tr.selected {
        background: var(--row-selected-bg,
                        rgba(25,118,210,0.12)); /* safe default for both themes */
      }

      td {
        padding: 8px 12px;
        font-size: .85rem;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        max-width: 200px;
      }

      .first-cell {
        display: flex;
        align-items: center;
        position: relative;
        max-width: none;
      }

      .first-cell span {
        flex-grow: 1;
        padding-left: 8px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        cursor: pointer;
        color: var(--on-surface-color);
      }

      .first-cell span:hover {
        text-decoration: underline;
      }

      .first-cell paper-checkbox {
        visibility: hidden;
        --paper-checkbox-checked-color: var(--primary-color, #1976d2);
        --paper-checkbox-unchecked-color: var(--palette-action-disabled, #9e9e9e);
        --paper-checkbox-checkmark-color: var(--on-primary-color, #fff);
        --paper-checkbox-label-color: var(--primary-text-color);
      }

      .first-cell paper-icon-button {
        min-width: 40px;
        visibility: hidden;
        --iron-icon-fill-color: var(--palette-action-disabled, #9e9e9e);
      }

      .file-icon {
        height: 24px;
        width: 24px;
        margin-right: 8px;
        --iron-icon-fill-color: var(--on-surface-color);
      }

      .file-thumbnail {
        height: 32px;
        width: 32px;
        object-fit: contain;
        margin-right: 8px;
        display: none;
      }

      .link-indicator {
        height: 16px;
        width: 16px;
        margin-right: 4px;
        color: var(--palette-action-active, var(--primary-color));
        display: none;
      }

      tbody tr:hover .first-cell paper-checkbox,
      tbody tr.active .first-cell paper-checkbox {
        visibility: visible;
      }

      tbody tr:hover .first-cell paper-icon-button,
      tbody tr.active .first-cell paper-icon-button {
        visibility: visible;
      }

      globular-dropdown-menu {
        position: absolute;
        top: 0;
        left: 0;
        z-index: 100;
      }

      tr.dragging {
        opacity: 0.6;
      }

      tr.drop-target {
        outline: 1px dashed var(--palette-primary, #1976d2);
      }
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
    const t = this._domRefs.tableElement;
    t.addEventListener("click", this._handleTableClick.bind(this));
    t.addEventListener("drop", this._handleTableDrop.bind(this));
    t.addEventListener("dragover", this._handleTableDragOver.bind(this));
    t.addEventListener("mouseover", this._handleTableMouseOver.bind(this));
    t.addEventListener("mouseout", this._handleTableMouseOut.bind(this));

    // host-level drag & drop so empty areas still accept drops
    this.addEventListener("dragover", this._handleHostDragOver.bind(this));
    this.addEventListener("drop", this._handleHostDrop.bind(this));
  }

  /** Render a directory */
  setDir(dir) {
    this._dir = dir;
    this._renderFiles();
  }

  _renderFiles() {
    this._domRefs.fileListViewBody.innerHTML = "";

    const files = filesOf(this._dir);
    if (!Array.isArray(files)) return;

    const sorted = [...files].sort((a, b) => {
      const aDir = isDirOf(a);
      const bDir = isDirOf(b);
      if (aDir && !bDir) return -1;
      if (!aDir && bDir) return 1;
      return (nameOf(a) || "").localeCompare(nameOf(b) || "");
    });

    for (const file of sorted) {
      const nm = nameOf(file) || "";
      // Skip plain dotfiles except known special cases
      if (nm.startsWith(".") && nm !== "audio.m3u" && nm !== "video.m3u" && !nm.startsWith(".hidden")) {
        continue;
      }
      const row = this._createFileRow(file);
      this._domRefs.fileListViewBody.appendChild(row);
    }
  }

  // inside class FilesListView
  clearSelectionUI() {
    const root = this.shadowRoot || this;
    root.querySelectorAll('paper-checkbox, input[type="checkbox"]').forEach(cb => {
      try { cb.checked = false; cb.removeAttribute('checked'); } catch { }
    });
  }

  /** Show thumbnail if provided; otherwise show icon (with safe fallback if thumb fails). */
  _applyThumbOrIcon(row, iconName, thumbUrl) {
    const iconEl = row.querySelector(".file-icon");
    const imgEl = row.querySelector(".file-thumbnail");

    // guard: if no elements, nothing to do
    if (!iconEl || !imgEl) return;

    // reset handlers to avoid stacking
    imgEl.onload = null;
    imgEl.onerror = null;

    if (thumbUrl) {
      // Try to load the thumbnail; if it fails, show icon.
      imgEl.style.display = "none"; // hide until it loads successfully
      imgEl.src = thumbUrl;

      imgEl.onload = () => {
        imgEl.style.display = "block";
        iconEl.style.display = "none";
      };
      imgEl.onerror = () => {
        imgEl.style.display = "none";
        iconEl.setAttribute("icon", iconName || "icons:insert-drive-file");
        iconEl.style.display = "inline-block";
      };
    } else {
      // No thumb: show icon immediately.
      imgEl.style.display = "none";
      iconEl.setAttribute("icon", iconName || "icons:insert-drive-file");
      iconEl.style.display = "inline-block";
    }
  }

  _createFileRow(file) {
    const path = pathOf(file);
    const name = nameOf(file);
    const mime = (mimeOf(file) || "").toLowerCase();
    const isDir = isDirOf(file);
    const mimeRoot = (mime || "").split("/")[0];
    const isLink = isLinkFile(file);

    const rowId = `row-${getUuidByString(path)}`;
    const row = document.createElement("tr");
    row.id = rowId;
    row.dataset.filePath = path;
    row._file = file;

    let sizeDisplay = "";
    let mimeDisplay = "Folder";
    let icon = "icons:insert-drive-file";
    // Prefer any provided thumbnail (for images or other files that have one)
    let thumbnailSrc = "";

    if (isDir) {
      const items = filesOf(file);
      sizeDisplay = Array.isArray(items) ? `${items.length} items` : "";
      mimeDisplay = "Folder";
      icon = "icons:folder";
    } else {
      sizeDisplay = getFileSizeString(sizeOf(file) || 0);
      mimeDisplay = (mimeRoot || "").toUpperCase();
      icon = iconForMime(mime);

      // Use thumb if given, regardless of type; otherwise we'll show icon
      const t = thumbOf(file);
      if (t) thumbnailSrc = t;
    }

    let displayName = name;
    if (typeof file.getLnk === "function" && file.getLnk()) {
      const l = file.getLnk();
      const lName = typeof l.getName === "function" ? l.getName() : (l?.name || "Link");
      displayName = `${lName} (Link)`;
    }

    // modified time (proto delivers seconds)
    const modTime = modTimeOf(file);
    const modDateStr = modTime.toLocaleString();

    row.innerHTML = `
      <td class="first-cell" data-file-path="${path}">
        <paper-checkbox id="checkbox-${rowId}"></paper-checkbox>
        <iron-icon id="icon-${rowId}" class="file-icon" icon="${icon}" style="display:none;"></iron-icon>
        <img id="thumbnail-${rowId}" class="file-thumbnail" style="display:none;"/>
        <iron-icon class="link-indicator" icon="icons:reply" style="display:${isLink ? "inline-flex" : "none"};"></iron-icon>
        <span class="file-name" title="${path}">${displayName}</span>
        <paper-icon-button id="menu-btn-${rowId}" icon="icons:more-vert" class="control-button"></paper-icon-button>
        <paper-ripple recenters></paper-ripple>
      </td>
      <td class="modified-cell">${modDateStr}</td>
      <td class="type-cell">${mimeDisplay || (isDir ? "FOLDER" : "FILE")}</td>
      <td class="size-cell">${sizeDisplay}</td>
    `;

    // Apply thumbnail or icon immediately (with load/error fallback)
    this._applyThumbOrIcon(row, icon, thumbnailSrc);

    const primeDisplayInfo = (source, mimeHint) => {
      this._getFileDisplayInfo(row, mimeHint, source)
        .then((info) => {
          if (info) this._updateRowDisplayInfo?.(row, mimeHint, info);
        })
        .catch(() => { /* non-fatal */ });
    };

    if (isLink) {
      const indicator = row.querySelector(".link-indicator");
      loadLinkTarget(file)
        .then((target) => {
          if (!target) return;
          const linkName = nameOf(target);
          const span = row.querySelector(".file-name");
          if (span) {
            span.textContent = linkName;
            span.title = `${linkName} (${pathOf(target)})`;
          }
          const targetIsDir = isDirOf(target);
          const targetMime = (mimeOf(target) || "").toLowerCase();
          const typeCell = row.querySelector(".type-cell");
          if (typeCell) {
            typeCell.textContent = targetIsDir ? "FOLDER" : (targetMime.split(";")[0] || "").toUpperCase() || "FILE";
          }
          const sizeCell = row.querySelector(".size-cell");
          if (sizeCell) sizeCell.textContent = getFileSizeString(sizeOf(target) || 0);
          if (indicator) indicator.style.display = "inline-flex";
          const updatedIcon = targetIsDir ? "icons:folder" : iconForMime(targetMime);
          this._applyThumbOrIcon(row, updatedIcon, thumbOf(target));
          primeDisplayInfo(target, (mimeOf(target) || "").split("/")[0]);
        })
        .catch((err) => {
          console.warn("Failed to decode link target", err);
        });
    } else {
      primeDisplayInfo(file, mimeRoot);
    }

    // sync checkbox with global selection pub/sub
    Backend.eventHub.subscribe(
      `__file_select_unselect_${path}`,
      () => { },
      (checked) => {
        const checkbox = row.querySelector("paper-checkbox");
        if (checkbox) checkbox.checked = !!checked;
        this._updateSelectionState(row, !!checked);
      },
      true,
      this
    );

    // wire checkbox change => selection map
    const checkbox = row.querySelector(`#checkbox-${rowId}`);
    checkbox?.addEventListener("change", (e) => {
      this._updateSelectionState(row, e.target.checked);
    });

    // context menu button (uses shared FilesView menu)
    const menuBtn = row.querySelector(`#menu-btn-${rowId}`);
    menuBtn?.addEventListener("click", (evt) => {
      evt.stopPropagation();
      this.showContextMenu(menuBtn, file, row);
    });

    // clicking on icon/name/thumbnail opens file/dir
    const firstCell = row.querySelector(".first-cell");
    firstCell?.addEventListener("click", (evt) => {
      const tag = evt.target.tagName;
      if (tag === "SPAN" || tag === "IRON-ICON" || tag === "IMG") {
        this._handleFileOpen(file);
      }
    });

    // Attach row-level drag & drop behavior
    this._attachRowDnD(row, file);

    return row;
  }

  async _getFileDisplayInfo(row, mimeType, file) {
    let displayTitle = nameOf(file);
    // Keep current icon decision based on MIME
    const iconName = iconForMime((mimeOf(file) || "").toLowerCase());
    // Start from existing thumb (if any)
    let thumbnailUrl = thumbOf(file);

    try {
      if (mimeType === "video") {
        const videos = await getFileVideosInfo(pathOf(file));
        if (Array.isArray(videos) && videos.length > 0) {
          file.videos = videos;
          displayTitle = videos[0]?.getDescription?.() || displayTitle;
          const poster = videos[0]?.getPoster?.();
          if (poster?.getContenturl) thumbnailUrl = poster.getContenturl();
        }
      } else if (mimeType === "audio") {
        const audios = await getFileAudiosInfo(pathOf(file));
        if (Array.isArray(audios) && audios.length > 0) {
          file.audios = audios;
          displayTitle = audios[0]?.getTitle?.() || displayTitle;
          const poster = audios[0]?.getPoster?.();
          if (poster?.getContenturl) thumbnailUrl = poster.getContenturl();
        }
      } else if (isDirOf(file)) {
        // Try to read infos.json directly via the new readText helper
        try {
          const text = await readText(`${pathOf(file)}/infos.json`);
          if (text) {
            const titleInfos = JSON.parse(text);
            if (titleInfos?.ID) {
              const title = await getTitleInfo(titleInfos.ID);
              if (title) {
                file.titles = [title];
                displayTitle = title.getName?.() || displayTitle;
                const poster = title.getPoster?.();
                if (poster?.getContenturl) thumbnailUrl = poster.getContenturl();
              }
            }
          }
        } catch {
          /* silently ignore if infos.json not present/invalid */
        }
      }
    } catch (err) {
      console.warn(`Extended info failed for ${nameOf(file)}:`, err);
    } finally {
      // Update name
      const nameSpan = row.querySelector(".file-name");
      if (nameSpan) nameSpan.textContent = displayTitle;

      // Re-apply thumb or icon with final info (handles load/error fallback)
      this._applyThumbOrIcon(row, iconName, thumbnailUrl);
    }
  }

  _handleTableClick(evt) {
    evt.stopPropagation();
    const targetRow = evt.target.closest("tr");
    if (!targetRow || !targetRow._file) return;

    const target = evt.target;
    if (target.tagName === "PAPER-CHECKBOX") return;

    if (target.id && target.id.startsWith("menu-btn-")) {
      this.showContextMenu(target, targetRow._file, targetRow);
      return;
    }

    const firstCell = target.closest(".first-cell");
    if (firstCell && (target.tagName === "SPAN" || target.tagName === "IRON-ICON" || target.tagName === "IMG")) {
      this._handleFileOpen(targetRow._file);
    }
  }

  // Background table drop → let FilesView decide (URL / OS files / internal)
  _handleTableDrop(evt) {
    evt.preventDefault();
    evt.stopPropagation();
    this.handleDropEvent(evt); // FilesView implementation
  }

  _handleTableDragOver(evt) {
    evt.preventDefault();
    evt.stopPropagation();
    if (evt.dataTransfer) {
      evt.dataTransfer.dropEffect = (evt.ctrlKey || evt.metaKey) ? "copy" : "move";
    }
  }
  
  _handleHostDragOver(evt) {
    const path = evt.composedPath?.() || [];
    if (path.includes(this._domRefs?.tableElement)) return;
    evt.preventDefault();
    if (evt.dataTransfer) {
      evt.dataTransfer.dropEffect = (evt.ctrlKey || evt.metaKey) ? "copy" : "move";
    }
  }

  _handleHostDrop(evt) {
    const path = evt.composedPath?.() || [];
    if (path.includes(this._domRefs?.tableElement)) return;
    evt.preventDefault();
    evt.stopPropagation();
    this.handleDropEvent(evt);
  }

  // ---- Row-level drag helpers ----

  _attachRowDnD(row, file) {
    if (!row || !file) return;

    // Dragging the row
    row.draggable = true;
    row.addEventListener("dragstart", (evt) => this._handleRowDragStart(evt, row, file));
    row.addEventListener("dragend", (evt) => this._handleRowDragEnd(evt, row));

    // If it's a directory, allow dropping on that row (move/copy into that dir)
    if (isDirOf(file)) {
      row.addEventListener("dragover", (evt) => {
        evt.preventDefault();
        if (evt.dataTransfer) {
          evt.dataTransfer.dropEffect = (evt.ctrlKey || evt.metaKey) ? "copy" : "move";
        }
        row.classList.add("drop-target");
      });
      row.addEventListener("dragleave", () => {
        row.classList.remove("drop-target");
      });
      row.addEventListener("drop", (evt) => this._handleRowDrop(evt, row, file));
    }
  }

  _handleRowDragStart(evt, row, file) {
    evt.stopPropagation();
    const dt = evt.dataTransfer;
    if (!dt || !file) return;

    const path = pathOf(file);
    let pathsToDrag = [path];

    // If this file is selected, drag the entire selection set
    if (this._selected && this._selected[path]) {
      pathsToDrag = Object.keys(this._selected);
    }

    dt.setData("files", JSON.stringify(pathsToDrag));
    dt.setData("id", this._fileExplorer?.id || "");
    dt.setData("domain", this._fileExplorer?.globule?.domain || "");
    dt.effectAllowed = "copyMove";

    row.classList.add("dragging");
  }

  _handleRowDragEnd(evt, row) {
    evt.stopPropagation();
    if (row) row.classList.remove("dragging");
    const root = this.shadowRoot || this;
    root.querySelectorAll("tr.drop-target").forEach((el) => el.classList.remove("drop-target"));
  }

  _handleRowDrop(evt, row, file) {
    evt.preventDefault();
    evt.stopPropagation();
    row.classList.remove("drop-target");

    const dt = evt.dataTransfer;
    if (!dt || !file) return;

    const targetPath = pathOf(file);
    const html = dt.getData("text/html") || "";

    // 1) External URL (IMDB etc.) or general URL drop
    const url = dt.getData("Url");
    if (url) {
      this._currentDir = file;
      this._handleUrlDrop(url, html);
      return;
    }

    // 2) OS files dropped from the desktop -> upload into this directory
    if (dt.files && dt.files.length > 0) {
      this._currentDir = file;
      this._handleFileDrop(dt.files, html);
      return;
    }

    // 3) Internal drag from any FileExplorer
    const filesData = dt.getData("files");
    if (!filesData) return;

    let files;
    try {
      files = JSON.parse(filesData);
    } catch {
      files = [];
    }
    const id = dt.getData("id");
    const domain = dt.getData("domain");
    if (!id || !files || files.length === 0) return;

    // Clear visual selection (checkboxes will be reset by FilesView after move/copy)
    this._fileExplorer?.clearSelections?.();

    Backend.eventHub.publish(
      `drop_file_${this._fileExplorer.id}_event`,
      {
        file: files[0],
        dir: targetPath,
        id,
        domain,
      },
      true
    );
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
    const explorer = this._fileExplorer || this._fileExplorer;
    if (!explorer) return;

    const effective = file?.linkTarget || file;
    const dir = isDirOf(effective);
    const kind = (mimeOf(effective) || "").split("/")[0]?.toLowerCase();

    if (dir) {
      explorer.publishSetDirEvent?.(pathOf(effective));
    } else {
      if (kind === "video") {
        (explorer.playVideo || explorer._playMedia)?.call(explorer, effective, "video");
      } else if (kind === "audio") {
        (explorer.playAudio || explorer._playMedia)?.call(explorer, effective, "audio");
      } else if (kind === "image") {
        (explorer.showImage || explorer._showImage)?.call(explorer, effective);
      } else {
        (explorer.readFile || explorer._readFile)?.call(explorer, effective);
      }
    }
    // close shared menu if any
    this.menu?.close?.();
    if (this.menu?.parentNode) this.menu.parentNode.removeChild(this.menu);
  }

  _updateSelectionState(row, checked) {
    if (checked) {
      row.classList.add("selected");
      this._selected = this._selected || {};
      this._selected[row.dataset.filePath] = row._file;
    } else {
      row.classList.remove("selected");
      if (this._selected) delete this._selected[row.dataset.filePath];
    }

    this._selectionChanged?.();
  }
}

customElements.define("globular-files-list-view", FilesListView);
