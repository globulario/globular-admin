// path-navigator.js

import { Backend } from "../../backend/backend";
import { readDir } from "../../backend/files";           // new files API
import { AccountController } from "../../backend/accounts";
import { displayError } from "../../backend/notify";

import "@polymer/iron-icon/iron-icon.js";
import "@polymer/paper-card/paper-card.js";

export class PathNavigator extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });

    /** @type {HTMLElement|null} */
    this.pathContainer = null;

    /** @type {string|undefined} */
    this.currentPath = undefined;

    /** @type {string} */
    this.navigationListenerUuid = "";

    /** @type {any|undefined} */
    this._fileExplorer = undefined;

    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: flex;
        }

        #path-navigator-box {
          flex-grow: 1;
          background-color: var(--surface-color);
          color: var(--primary-text-color);
          display: flex;
          align-items: center;
          user-select: none;
          flex-wrap: wrap;
          padding: 0 5px;
          margin-right: 10px;
          overflow-x: auto;
        }

        .path-segment {
          display: flex;
          align-items: center;
          position: relative;
          padding: 2px 0;
        }

        .path-segment-text {
          max-width: 350px;
          white-space: nowrap;
          text-overflow: ellipsis;
          overflow: hidden;
          user-select: none;
          padding: 0 4px;
        }

        .path-segment-text:hover {
          cursor: pointer;
        }

        .path-separator-icon {
          --iron-icon-fill-color: var(--primary-text-color);
          margin: 0 -2px;
        }
        .path-separator-icon:hover {
          cursor: pointer;
        }

        .directories-selector {
          display: flex;
          flex-direction: column;
          position: absolute;
          padding: 5px;
          z-index: 1000;
          top: 100%;
          right: 0;
          background-color: var(--surface-color);
          color: var(--primary-text-color);
          box-shadow: var(--shadow-elevation-2dp);
          max-height: 200px;
          overflow-y: auto;
        }

        .subdirectory-item {
          padding: 4px;
          white-space: nowrap;
        }
        .subdirectory-item:hover {
          cursor: pointer;
          background-color: var(--palette-action-hover);
        }
      </style>

      <div id="path-navigator-box"></div>
    `;

    this.pathContainer = this.shadowRoot.querySelector("#path-navigator-box");
  }

  connectedCallback() {
    this.navigationListenerUuid = Backend.eventHub.subscribe(
      "__set_dir_event__",
      () => {},
      (evt) => {
        if (this._fileExplorer && this._fileExplorer.id === evt.file_explorer_id) {
          this.setDir(evt.dir);
        }
      },
      true,
      this
    );
  }

  disconnectedCallback() {
    if (this.navigationListenerUuid) {
      Backend.eventHub.unsubscribe(this.navigationListenerUuid);
      this.navigationListenerUuid = "";
    }
  }

  /** Link the file explorer that owns this navigator */
  setFileExplorer(fileExplorer) {
    this._fileExplorer = fileExplorer;
  }

  /** Accepts either proto-like dir or the new DirVM { path, files } */
  setDir(dir) {
    const dirPath = getPath(dir);
    if (!dirPath) return;

    this.currentPath = dirPath;
    this.pathContainer.innerHTML = "";

    const parts = dirPath.split("/").filter(Boolean);
    let acc = dirPath.startsWith("/") ? "/" : "";

    parts.forEach((segment, idx) => {
      if (acc === "/") acc += segment;
      else acc = acc ? `${acc}/${segment}` : segment;
      const isLast = idx === parts.length - 1;
      this._createPathSegmentElement(segment, acc, isLast);
    });
  }

  _createPathSegmentElement(segmentName, fullPathForSegment, isLastSegment) {
    const segmentDiv = document.createElement("div");
    segmentDiv.className = "path-segment";

    const segmentTextSpan = document.createElement("span");
    segmentTextSpan.className = "path-segment-text";

    // replace account id with account display name for the visible label
    const acct = AccountController?.account;
    const acctId = acct?.getId?.() ?? acct?.id;
    const acctName = acct?.getName?.() ?? acct?.name;
    segmentTextSpan.textContent =
      acctId && segmentName.startsWith(acctId)
        ? segmentName.replace(acctId, acctName || acctId)
        : segmentName;

    if (segmentName.length > 20) segmentTextSpan.title = segmentName;

    segmentDiv.appendChild(segmentTextSpan);

    // navigate to that level on click
    segmentTextSpan.addEventListener("click", (evt) => {
      evt.stopPropagation();
      this._navigateToPath(fullPathForSegment);
    });

    if (!isLastSegment) {
      const sep = document.createElement("iron-icon");
      sep.className = "path-separator-icon";
      sep.icon = "icons:chevron-right";
      segmentDiv.appendChild(sep);

      let dropdown = null;
      sep.addEventListener("click", async (evt) => {
        evt.stopPropagation();
        dropdown = await this._toggleSubdirectoryDropdown(sep, dropdown, fullPathForSegment);
      });
    }

    this.pathContainer.appendChild(segmentDiv);
  }

  async _toggleSubdirectoryDropdown(iconEl, dropdownEl, parentPath) {
    if (dropdownEl && iconEl.icon === "icons:expand-more") {
      dropdownEl.style.display = "none";
      iconEl.icon = "icons:chevron-right";
      return dropdownEl;
    }

    // close others
    this.shadowRoot.querySelectorAll(".directories-selector").forEach((d) => (d.style.display = "none"));
    this.shadowRoot.querySelectorAll(".path-separator-icon").forEach((i) => (i.icon = "icons:chevron-right"));

    iconEl.icon = "icons:expand-more";

    if (!dropdownEl) {
      dropdownEl = document.createElement("paper-card");
      dropdownEl.className = "directories-selector";
      dropdownEl.style.display = "flex";
      iconEl.parentElement.appendChild(dropdownEl);

      try {
        const dir = await readDir(parentPath); // new API
        const files = (dir && dir.files) || [];

        files
          .filter((f) => isDir(f))
          .forEach((sub) => {
            const item = document.createElement("div");
            item.className = "subdirectory-item";
            item.textContent = nameOf(sub);
            item.addEventListener("click", (evt) => {
              evt.stopPropagation();
              this._navigateToPath(pathOf(sub));
              dropdownEl.style.display = "none";
              iconEl.icon = "icons:chevron-right";
            });
            dropdownEl.appendChild(item);
          });

        dropdownEl.style.right = -1 * (dropdownEl.offsetWidth - iconEl.offsetWidth) + "px";
        dropdownEl.addEventListener("mouseleave", () => {
          dropdownEl.style.display = "none";
          iconEl.icon = "icons:chevron-right";
        });
      } catch (e) {
        displayError(e?.message || String(e), 3000);
        dropdownEl.remove();
        iconEl.icon = "icons:chevron-right";
        return null;
      }
    } else {
      dropdownEl.style.display = "flex";
      dropdownEl.style.right = -1 * (dropdownEl.offsetWidth - iconEl.offsetWidth) + "px";
    }

    return dropdownEl;
  }

  _navigateToPath(path) {
    if (!this._fileExplorer) return;
    this._fileExplorer.publishSetDirEvent(path);
  }
}

/* ---------------- helpers to handle either proto or FileVM ---------------- */

function getPath(x) {
  return x?.getPath?.() ?? x?.path ?? "";
}
function nameOf(x) {
  return x?.getName?.() ?? x?.name ?? "";
}
function isDir(x) {
  const v = x?.getIsDir?.() ?? x?.isDir;
  return !!v;
}
function pathOf(x) {
  return x?.getPath?.() ?? x?.path ?? "";
}

customElements.define("globular-path-navigator", PathNavigator);
