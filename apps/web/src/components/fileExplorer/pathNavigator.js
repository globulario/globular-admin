// path-navigator.js — revisited to preserve legacy File.js behavior
// - Keeps EventHub contract used in File.js (subscribe/unsubscribe by topic + uuid)
// - Accepts proto-like Dir and VM Dir { path, files }
// - Dropdown respects hidden rules from legacy (skip dot-dirs, skip HLS pseudo dirs)
// - Labels replace current account id@domain with displayName when segment matches

import { Backend } from "../../backend/backend";
import { readDir } from "../../backend/cms/files";
import { getCurrentAccount } from "../../backend/rbac/accounts";
import { displayError } from "../../backend/ui/notify";

import "@polymer/iron-icon/iron-icon.js";
import "@polymer/paper-card/paper-card.js";

// DRY helpers used across file components
import { pathOf, nameOf, isDir, mimeOf } from "./filevm-helpers";

/* ----------------------------- tiny helpers ----------------------------- */
const ICON_CHEVRON_RIGHT = "icons:chevron-right";
const ICON_EXPAND_MORE   = "icons:expand-more";

function setIcon(el, icon) { if (el) el.icon = icon; }
function show(el, on)     { if (el) el.style.display = on ? "flex" : "none"; }
function hide(el)         { show(el, false); }

function closeAllDropdowns(root) {
  root.querySelectorAll(".directories-selector").forEach(hide);
  root.querySelectorAll(".path-separator-icon").forEach(i => setIcon(i, ICON_CHEVRON_RIGHT));
}

function isHiddenOrVirtual(vm) {
  const nm = nameOf(vm) || "";
  const mm = mimeOf(vm) || "";
  return nm.startsWith(".") || mm === "video/hls-stream";
}

/** Replace only exact id / id@domain matches with displayName */
function accountAwareLabel(segmentName) {
  const acct = getCurrentAccount();
  if (!acct) return segmentName;

  const id      = acct?.getId?.() ?? acct?.id;
  const domain  = acct?.getDomain?.() ?? acct?.domain;
  const name    = acct?.getDisplayName?.() ?? acct?.displayName ?? acct?.getName?.() ?? acct?.name ?? id;

  if (!id) return segmentName;

  const full = id && domain ? `${id}@${domain}` : id;

  if (segmentName === full || segmentName === id) return name || segmentName;
  return segmentName; // avoid replacing inside composites like "sa sa"
}

export class PathNavigator extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });

    /** @type {HTMLElement|null} */
    this.pathContainer = null;

    /** @type {string|undefined} */
    this.currentPath = undefined;

    /** { topic: string, uuid: string } */
    this._navSub = null;

    /** @type {any|undefined} */
    this._fileExplorer = undefined;

    this.shadowRoot.innerHTML = `
      <style>
        :host { display: flex; }
        #path-navigator-box {
          flex-grow: 1; background-color: var(--surface-color); color: var(--primary-text-color);
          display: flex; align-items: center; user-select: none; flex-wrap: wrap;
          padding: 0 5px; overflow-x: auto;
        }
        .path-segment { display: flex; align-items: center; position: relative; padding: 2px 0; }
        .path-segment-text { max-width: 350px; white-space: nowrap; text-overflow: ellipsis; overflow: hidden; user-select: none; padding: 0 4px; }
        .path-segment-text:hover { cursor: pointer; }
        .path-separator-icon { --iron-icon-fill-color: var(--primary-text-color); margin: 0 -2px; }
        .path-separator-icon:hover { cursor: pointer; }

        /* Dropdown card is fixed to viewport; we set left/top from JS to the icon's bottom-left */
        .directories-selector {
          display: none;
          flex-direction: column;
          position: fixed;              /* <-- fixed to viewport */
          padding: 5px;
          z-index: 10000;               /* keep above headers/overlays */
          left: 0;                      /* computed in JS */
          top: 0;                       /* computed in JS */
          background-color: var(--surface-color);
          color: var(--primary-text-color);
          box-shadow: var(--shadow-elevation-2dp);
          max-height: 240px;
          overflow-y: auto;
          min-width: 180px;
        }
        .subdirectory-item { padding: 4px 8px; white-space: nowrap; }
        .subdirectory-item:hover { cursor: pointer; background-color: var(--palette-action-hover); }
      </style>
      <div id="path-navigator-box"></div>
    `;

    this.pathContainer = this.shadowRoot.querySelector("#path-navigator-box");

    // Close any open dropdown when clicking anywhere inside the shadow root
    this.shadowRoot.addEventListener("click", () => closeAllDropdowns(this.shadowRoot));
  }

  connectedCallback() {
    // Legacy: File.js publishes "__set_dir_event__" with { dir, file_explorer_id }
    const topic = "__set_dir_event__";
    const uuid = Backend.eventHub.subscribe(
      topic,
      () => {},
      (evt) => {
        if (this._fileExplorer && this._fileExplorer.id === evt.file_explorer_id) {
          this.setDir(evt.dir);
        }
      },
      true,
      this
    );
    this._navSub = { topic, uuid };
  }

  disconnectedCallback() {
    if (this._navSub?.uuid) {
      // Keep parity with legacy unsubscribe signature (topic, uuid)
      Backend.eventHub.unsubscribe(this._navSub.topic, this._navSub.uuid);
      this._navSub = null;
    }
  }

  /** Wire the owning FileExplorer (as in File.js) */
  setFileExplorer(fileExplorer) {
    this._fileExplorer = fileExplorer;
  }

  /** Accepts either proto-like dir or DirVM { path, files } */
  setDir(dir) {
    let dirPath = pathOf(dir);
    if (!dirPath) return;

    // ------- Normalize any breadcrumb/presentation artifacts -------
    dirPath = String(dirPath)
      .replace(/>\s*/g, "/")      // turn any " >" breadcrumb leftovers into "/"
      .replace(/\s*\/\s*/g, "/")  // collapse " / " into "/"
      .replace(/\/{2,}/g, "/")    // collapse multiple slashes
      .trim();
    if (dirPath.length > 1 && dirPath.endsWith("/")) dirPath = dirPath.slice(0, -1);

    this.currentPath = dirPath;
    this.pathContainer.innerHTML = "";

    // Build parts; include root clickable segment
    const isAbs = dirPath.startsWith("/");
    const parts = dirPath.split("/").map(s => s.trim()).filter(s => s.length);
    let acc = isAbs ? "/" : "";

    parts.forEach( (segment, idx) => {
      if (acc === "/") acc += segment; else acc = acc ? `${acc}/${segment}` : segment;
      const isLast = idx === parts.length - 1;
      this._createPathSegmentElement(segment, acc, isLast);
    });
  }

  _createPathSegmentElement(segmentName, fullPathForSegment, isLastSegment) {
    const segmentDiv = document.createElement("div");
    segmentDiv.className = "path-segment";

    const segmentTextSpan = document.createElement("span");
    segmentTextSpan.className = "path-segment-text";
    segmentTextSpan.textContent = accountAwareLabel(segmentName);
    if (segmentName.length > 20) segmentTextSpan.title = segmentName;

    // navigate to that level on click
    segmentTextSpan.addEventListener("click", (evt) => {
      evt.stopPropagation();
      this._navigateToPath(fullPathForSegment);
    });

    segmentDiv.appendChild(segmentTextSpan);

    if (!isLastSegment) {
      const sep = document.createElement("iron-icon");
      sep.className = "path-separator-icon";
      setIcon(sep, ICON_CHEVRON_RIGHT);
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
    const placeCard = (card) => {
      // Position the dropdown so its top-left is the bottom-left of the icon
      const r = iconEl.getBoundingClientRect(); // viewport-relative
      card.style.position = "fixed";
      card.style.left = `${Math.round(r.left)}px`;
      card.style.top  = `${Math.round(r.bottom)}px`;
    };

    const attachReposition = (card) => {
      const onResize = () => placeCard(card);
      window.addEventListener("resize", onResize);
      // store remover on element so we can clean up
      card._removeReposition = () => window.removeEventListener("resize", onResize);
    };

    const detachReposition = (card) => {
      if (card && card._removeReposition) {
        try { card._removeReposition(); } catch {}
        delete card._removeReposition;
      }
    };

    if (dropdownEl && iconEl.icon === ICON_EXPAND_MORE) {
      hide(dropdownEl);
      detachReposition(dropdownEl);
      setIcon(iconEl, ICON_CHEVRON_RIGHT);
      return dropdownEl;
    }

    // close others
    closeAllDropdowns(this.shadowRoot);
    setIcon(iconEl, ICON_EXPAND_MORE);

    if (!dropdownEl) {
      const card = document.createElement("paper-card");
      card.className = "directories-selector";
      show(card, true);
      // Keep it as a child (shadow tree), but fixed positioning uses viewport coords
      iconEl.parentElement.appendChild(card);

      try {
        const dir = await readDir(parentPath, { refresh: true });
        const files = (dir && dir.files) || [];

        files
          .filter(isDir)
          .filter(vm => !isHiddenOrVirtual(vm))
          .forEach((sub) => {
            const item = document.createElement("div");
            item.className = "subdirectory-item";
            item.textContent = nameOf(sub);
            item.addEventListener("click", (evt) => {
              evt.stopPropagation();
              this._navigateToPath(pathOf(sub));
              hide(card);
              detachReposition(card);
              setIcon(iconEl, ICON_CHEVRON_RIGHT);
            });
            card.appendChild(item);
          });

        // Position after it renders to get width/height right
        requestAnimationFrame(() => {
          placeCard(card);
          attachReposition(card);
        });

        // Hide when leaving the card
        card.addEventListener("mouseleave", () => {
          hide(card);
          detachReposition(card);
          setIcon(iconEl, ICON_CHEVRON_RIGHT);
        });

        dropdownEl = card;
      } catch (e) {
        displayError(e?.message || String(e), 3000);
        setIcon(iconEl, ICON_CHEVRON_RIGHT);
        return null;
      }
    } else {
      show(dropdownEl, true);
      placeCard(dropdownEl);
      attachReposition(dropdownEl);
    }

    return dropdownEl;
  }

  _navigateToPath(path) {
    if (!this._fileExplorer?.publishSetDirEvent) return;
    this._fileExplorer.publishSetDirEvent(path);
  }
}

customElements.define("globular-path-navigator", PathNavigator);
