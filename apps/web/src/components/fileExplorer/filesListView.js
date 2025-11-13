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
import { readText } from "../../backend/cms/files";
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
  if (m.startsWith("text/"))  return "editor:insert-drive-file";
  return "icons:insert-drive-file";
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
    const t = this._domRefs.tableElement;
    t.addEventListener("click", this._handleTableClick.bind(this));
    t.addEventListener("drop", this._handleTableDrop.bind(this));
    t.addEventListener("dragover", this._handleTableDragOver.bind(this));
    t.addEventListener("mouseover", this._handleTableMouseOver.bind(this));
    t.addEventListener("mouseout", this._handleTableMouseOut.bind(this));
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
    const imgEl  = row.querySelector(".file-thumbnail");

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
      mimeDisplay = (mime.split(";")[0] || "").toUpperCase();
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
        <span title="${path}">${displayName}</span>
        <paper-icon-button id="menu-btn-${rowId}" icon="icons:more-vert" class="control-button"></paper-icon-button>
        <paper-ripple recenters></paper-ripple>
      </td>
      <td>${modDateStr}</td>
      <td>${mimeDisplay || (isDir ? "FOLDER" : "FILE")}</td>
      <td>${sizeDisplay}</td>
    `;

    // Apply thumbnail or icon immediately (with load/error fallback)
    this._applyThumbOrIcon(row, icon, thumbnailSrc);

    // async enrichment (videos/audios/titles or folder infos)
    this._getFileDisplayInfo(row, (mime || "").split("/")[0], file)
      .then((info) => {
        if (info) this._updateRowDisplayInfo?.(row, (mime || "").split("/")[0], info);
      })
      .catch(() => { /* non-fatal */ });

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
        const videos = await new Promise((resolve, reject) => getFileVideosInfo(file.path, resolve, reject));
        if (Array.isArray(videos) && videos.length > 0) {
          file.videos = videos;
          displayTitle = videos[0]?.getDescription?.() || displayTitle;
          const poster = videos[0]?.getPoster?.();
          if (poster?.getContenturl) thumbnailUrl = poster.getContenturl();
        }
      } else if (mimeType === "audio") {
        const audios = await new Promise((resolve, reject) => getFileAudiosInfo(file.path, resolve, reject));
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
              const title = await new Promise((resolve, reject) => getTitleInfo(titleInfos.ID, resolve, reject));
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
      const nameSpan = row.querySelector(".first-cell span");
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

  _handleTableDrop(evt) {
    evt.preventDefault();

    const filesDataTransfer = evt.dataTransfer.getData("files");
    const domainDataTransfer = evt.dataTransfer.getData("domain");
    const fileListTransfer = evt.dataTransfer.files;

    if (fileListTransfer && fileListTransfer.length > 0) {
      Backend.eventHub.publish(
        "__upload_files_event__",
        { dir: getCurrentExplorerPath(this._fileExplorer || this._fileExplorer), files: Array.from(fileListTransfer), lnk: null },
        true
      );
    } else if (filesDataTransfer && domainDataTransfer) {
      try {
        const files = JSON.parse(filesDataTransfer);
        const sourceId = evt.dataTransfer.getData("id");
        const explorer = this._fileExplorer || this._fileExplorer;
        if (explorer && Array.isArray(files) && files.length > 0) {
          const destPath = getCurrentExplorerPath(explorer);
          files.forEach((f) => {
            Backend.eventHub.publish(
              `drop_file_${(explorer.id || "explorer")}_event`,
              { file: f, dir: destPath, id: sourceId, domain: domainDataTransfer },
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

  _handleTableDragOver(evt) { evt.preventDefault(); }

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

    const dir = isDirOf(file);
    const kind = (mimeOf(file) || "").split("/")[0]?.toLowerCase();

    if (dir) {
      explorer.publishSetDirEvent?.(pathOf(file));
    } else {
      if (kind === "video") {
        (explorer.playVideo || explorer._playMedia)?.call(explorer, file, "video");
      } else if (kind === "audio") {
        (explorer.playAudio || explorer._playMedia)?.call(explorer, file, "audio");
      } else if (kind === "image") {
        (explorer.showImage || explorer._showImage)?.call(explorer, file);
      } else {
        (explorer.readFile || explorer._readFile)?.call(explorer, file);
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
  }
}

customElements.define("globular-files-list-view", FilesListView);
