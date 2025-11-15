import * as getUuid from 'uuid-by-string';
import { getCoords } from './utility';

/**
 * `globular-dialog-handle` Web Component.
 * Represents a minimized dialog's clickable icon in the dockbar.
 */
export class DialogHandle extends HTMLElement {
  _dialog = null;
  _height = 200;
  _isFocused = false;
  _isDocked = false;

  _container = null;
  _closeBtn = null;
  _minimizeBtn = null;
  _titleSpan = null;
  _previewContainer = null;

  constructor(dialog, height = 200) {
    super();
    this.attachShadow({ mode: 'open' });
    this._dialog = dialog;
    this._height = height;
    this._renderHTML();
  }

  connectedCallback() {
    this._cacheElements();
    this._applyInitialStyles();
    this._setupEventListeners();
    this.refreshPreview();
  }

  getCoords() {
    return getCoords(this._container);
  }

  getRect() {
    const coords = this.getCoords();
    return {
      top: coords.top,
      left: coords.left,
      width: this._container.offsetWidth,
      height: this._container.offsetHeight
    };
  }

  refreshPreview() {
    if (this._previewContainer && this._dialog && this._dialog.getPreview) {
      this._previewContainer.innerHTML = "";
      if (this._dialog && this._titleSpan) {
        this._titleSpan.textContent = this._dialog.getTitle() || this._dialog.getAttribute('name') || "Dialog";
      }
      const previewContent = this._dialog.getPreview();
      if (previewContent) {
        previewContent.classList.add("text-preview");
        this._previewContainer.appendChild(previewContent);
      }
    } else {
      console.warn("DialogHandle: Could not refresh preview. Dialog or preview method missing.");
    }
  }

  dock() {
    if (this._dialog) {
      this._dialog.style.display = "none";
      this._dialog.classList.add("minimized");
    }
    this._isDocked = true;
    if (this._minimizeBtn) this._minimizeBtn.style.display = "none";
    this.refreshPreview();
  }

  undock() {
    if (this._dialog) {
      this._dialog.style.display = "";
      this._dialog.classList.remove("minimized");
      this._dialog.focus();
    }
    this._isDocked = false;
    if (this._minimizeBtn) this._minimizeBtn.style.display = "block";
  }

  blur() {
    this._isFocused = false;
    if (this._container)
      this._container.style.border = "1px solid var(--border-subtle-color, var(--divider-color))";
  }

  focus() {
    if (this._isFocused) return;
    document.querySelectorAll("globular-dialog-handle").forEach(handle => {
      if (handle !== this && typeof handle.blur === 'function') handle.blur();
    });
    this._isFocused = true;
    this._dialog?.focus();
    if (this._container)
      this._container.style.border = "1px solid var(--primary-light-color)";
  }

  hasFocus() { return this._isFocused; }

  _renderHTML() {
    this.shadowRoot.innerHTML = `
            <style>
        #container {
          position: relative;
          display: flex;
          flex-direction: column;
          background-color: var(--surface-elevated-color);
          border: 1px solid var(--border-subtle-color, var(--divider-color));
          border-radius: 6px;
          height: var(--dialog-handle-height);
          width: var(--dialog-handle-width);
          overflow: hidden;
          box-sizing: border-box;
          box-shadow: 0 4px 10px rgba(0,0,0,0.35);
        }
        #header-bar {
          display: flex;
          align-items: center;
          z-index: 1000;
          background-color: var(--primary-light-color);
          color: var(--on-primary-color);
          padding: 2px 4px;
        }
        #close-btn, #minimize-btn {
          width: 22px;
          height: 22px;
          margin-right: 2px;
          padding: 4px;
          color: var(--on-primary-color);
        }
        #title-span {
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          flex-grow: 1;
          font-size: 0.8rem;
          padding: 0 4px;
        }
        .preview-container {
          flex-grow: 1;
          overflow: hidden;
          display: flex;
          align-items: center;
          justify-content: center;
          background-color: var(--surface-color);
        }
      </style>
      <div id="container">
        <div id="header-bar">
          <paper-icon-button id="close-btn" icon="clear"></paper-icon-button>
          <span id="title-span"></span>
          <paper-icon-button id="minimize-btn" icon="icons:remove"></paper-icon-button>
        </div>
        <div class="preview-container"></div>
      </div>
    `;
  }

  _cacheElements() {
    this._container = this.shadowRoot.getElementById('container');
    this._closeBtn = this.shadowRoot.getElementById('close-btn');
    this._minimizeBtn = this.shadowRoot.getElementById('minimize-btn');
    this._titleSpan = this.shadowRoot.getElementById('title-span');
    this._previewContainer = this.shadowRoot.querySelector('.preview-container');
  }

  _applyInitialStyles() {
    this.style.setProperty('--dialog-handle-height', `${this._height + 10}px`);
    this.style.setProperty('--dialog-handle-width', `${this._height}px`);
    if (this._dialog && this._titleSpan) {
      this._titleSpan.textContent = this._dialog.getTitle() || this._dialog.getAttribute('name') || "Dialog";
    }
  }

  _setupEventListeners() {
    this._closeBtn.addEventListener('click', this._handleCloseClick);
    this._minimizeBtn.addEventListener('click', this._handleMinimizeClick);
    this._container.addEventListener('click', this._handleContainerClick);

    this._dialog.addEventListener("dialog-focused", this._handleDialogFocused);
    this._dialog.addEventListener("refresh-preview", this._handleRefreshPreview);
    this._dialog.addEventListener("dialog-closing", this._handleDialogClosing);
  }

  _cleanupEventListeners() {
    this._closeBtn.removeEventListener('click', this._handleCloseClick);
    this._minimizeBtn.removeEventListener('click', this._handleMinimizeClick);
    this._container.removeEventListener('click', this._handleContainerClick);

    this._dialog.removeEventListener("dialog-focused", this._handleDialogFocused);
    this._dialog.removeEventListener("refresh-preview", this._handleRefreshPreview);
    this._dialog.removeEventListener("dialog-closing", this._handleDialogClosing);
  }

  _handleCloseClick = (evt) => {
    evt.stopPropagation();
    this.undock();
    this._dialog?.close();
  };
  _handleMinimizeClick = (evt) => {
    evt.stopPropagation();
    this._dialog?.minimize();
  };
  _handleContainerClick = (evt) => {
    evt.stopPropagation();
    this.focus();
    if (this._isDocked) this.undock();
  };
  _handleDialogFocused = () => this.focus();
  _handleRefreshPreview = () => this.refreshPreview();
  _handleDialogClosing = () => {
    if (this._isDocked) {
      this.undock();
      this._dialog.style.display = "";
    }
  };
}
customElements.define('globular-dialog-handle', DialogHandle);


/**
 * `globular-dialog-handles` — groups of handles.
 */
export class DialogHandles extends HTMLElement {
  _iconElement = null;
  _countSpan = null;
  _handlesContainer = null;
  _container = null;

  // state for stable hover/flyout
  _isHot = false;
  _hideTimer = null;

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._renderHTML();
  }

  connectedCallback() {
    this._cacheElements();
    this._setupEventListeners();
    this._updateCountAndIcon();
  }

  appendHandle(handle) {
    if (this.querySelector(`#${handle.id}`)) {
      console.log(`Handle with ID ${handle.id} already exists.`);
      return;
    }
    this.appendChild(handle);
    this._updateCountAndIcon();

    handle.addEventListener('click', this._handleHandleClick);
    handle.addEventListener('mouseover', this._handleHandleMouseOver);
    handle.addEventListener('mouseout', this._handleHandleMouseOut);

  }

  removeHandle(handle) {
    this.removeChild(handle);
    this._updateCountAndIcon();

    handle.removeEventListener('click', this._handleHandleClick);
    handle.removeEventListener('mouseover', this._handleHandleMouseOver);
    handle.removeEventListener('mouseout', this._handleHandleMouseOut);

    if (this.children.length === 0) {
      this._handlesContainer.style.display = "none";
    }
  }

  hideHandles() {
    this._isHot = false;
    this._scheduleHide();
  }

  _renderHTML() {
    this.shadowRoot.innerHTML = `
      <style>
        #container {
          position: relative;
          display: none;        /* hidden until we have children */
          justify-content: center;
          align-items: center;
          margin-right: 10px;
        }
        #main-icon {
          width: 40px; height: 40px; object-fit: contain;
        }
        #count-badge {
          position: absolute; top: -5px; left: -5px;
          background-color: var(--primary-dark-color);
          color: var(--on-primary-dark-color);
          border-radius: 50%;
          width: 20px; height: 20px;
          text-align: center; font-size: 12px; line-height: 20px;
          display: none;
        }
        .handles {
          display: none;
          flex-direction: row;
          align-items: flex-end;
          justify-content: flex-start;
          position: fixed;      /* viewport anchored */
          top: 0; left: 0;      /* set via JS */
          padding: 5px;
          border-radius: 5px;
          background-color: var(--surface-color);
          border: 1px solid var(--divider-color);
          box-shadow: 0 4px 8px rgba(0,0,0,0.2);
          z-index: 10000;
        }
        .handles ::slotted(globular-dialog-handle) {
          margin: 0 5px;
          transition: box-shadow 0.2s ease;
        }
      </style>
      <div id="container">
        <img id="main-icon"></img>
        <span id="count-badge"></span>
        <div class="handles"><slot></slot></div>
      </div>
    `;
  }

  _cacheElements() {
    this._container = this.shadowRoot.getElementById("container");
    this._iconElement = this.shadowRoot.getElementById("main-icon");
    this._countSpan = this.shadowRoot.getElementById("count-badge");
    this._handlesContainer = this.shadowRoot.querySelector(".handles");
  }

  _setupEventListeners() {
    // pointer events (don’t bubble like mouseenter/leave)
    this._container.addEventListener("pointerenter", this._onIconEnter);
    this._container.addEventListener("pointerleave", this._onIconLeave);
    this._handlesContainer.addEventListener("pointerenter", this._onHandlesEnter);
    this._handlesContainer.addEventListener("pointerleave", this._onHandlesLeave);
  }

  _cleanupEventListeners() {
    this._container.removeEventListener("pointerenter", this._onIconEnter);
    this._container.removeEventListener("pointerleave", this._onIconLeave);
    this._handlesContainer.removeEventListener("pointerenter", this._onHandlesEnter);
    this._handlesContainer.removeEventListener("pointerleave", this._onHandlesLeave);
  }

  // --- stable hover logic ---
  _showHandles = () => {
    this._handlesContainer.style.display = "flex";

    const iconRect = this._iconElement.getBoundingClientRect();
    const handles = this._handlesContainer;

    // force layout to get size
    const w = handles.offsetWidth;
    const h = handles.offsetHeight;

    const left = Math.round(iconRect.left + (iconRect.width - w) / 2);
    const top = Math.round(iconRect.top - h - 8); // 8px gap above icon

    const clampedLeft = Math.max(8, Math.min(left, window.innerWidth - w - 8));
    const clampedTop = Math.max(8, top);

    handles.style.left = `${clampedLeft}px`;
    handles.style.top = `${clampedTop}px`;

    // refresh previews of children
    Array.from(this.children).forEach(child => {
      if (child instanceof DialogHandle && typeof child.refreshPreview === 'function') {
        child.refreshPreview();
      }
    });
  };

  _scheduleHide = () => {
    if (this._hideTimer) clearTimeout(this._hideTimer);
    this._hideTimer = setTimeout(() => {
      if (!this._isHot) this._handlesContainer.style.display = "none";
    }, 120);
  };

  _onIconEnter = () => {
    // close other groups
    document.querySelectorAll("globular-dialog-handles").forEach(other => {
      if (other !== this && typeof other.hideHandles === 'function') other.hideHandles();
    });
    this._isHot = true;
    this._showHandles();
  };

  _onIconLeave = (evt) => {
    if (this._handlesContainer.contains(evt.relatedTarget)) return; // moving into flyout
    this._isHot = false;
    this._scheduleHide();
  };

  _onHandlesEnter = () => {
    this._isHot = true;
    if (this._hideTimer) clearTimeout(this._hideTimer);
  };

  _onHandlesLeave = (evt) => {
    if (this._container.contains(evt.relatedTarget)) return; // moving back to icon
    this._isHot = false;
    this._scheduleHide();
  };

  _handleHandleClick = (evt) => {
    evt.stopPropagation();
    const handle = evt.currentTarget;
    if (handle instanceof DialogHandle) {
      handle.undock();
      this.hideHandles();
    }
  };

  _handleHandleMouseOver = (evt) => {
    evt.stopPropagation();
    const handle = evt.currentTarget;
    if (handle instanceof DialogHandle && handle._dialog?.style) {
      handle.style.boxShadow = "0px 0px 5px 0px var(--primary-light-color)";
      handle._dialog.style.boxShadow = "0px 0px 5px 0px var(--primary-light-color)";
    }
  };

  _handleHandleMouseOut = (evt) => {
    evt.stopPropagation();
    const handle = evt.currentTarget;
    if (handle instanceof DialogHandle && handle._dialog?.style) {
      handle.style.boxShadow = "";
      handle._dialog.style.boxShadow = "";
    }
  };

  _updateCountAndIcon() {
    const count = this.children.length;
    this._countSpan.innerHTML = count;
    this._countSpan.style.display = count > 0 ? "block" : "none";

    if (count > 0) {
      const lastHandle = this.children[count - 1];
      if (lastHandle instanceof DialogHandle && lastHandle._dialog && lastHandle._dialog.getIcon) {
        this._iconElement.src = lastHandle._dialog.getIcon();
      }
      this._container.style.display = "flex";
    } else {
      this._iconElement.src = "";
      this._container.style.display = "none";
    }
  }
}
customElements.define('globular-dialog-handles', DialogHandles);


/**
 * `globular-dockbar` — main dockbar container.
 */
export class Dockbar extends HTMLElement {
  _dialogs = [];
  _dockbarContainer = null;
  _mainContainer = null;

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._renderHTML();
  }

  connectedCallback() { this._cacheElements(); }

  getDialogs() { return this._dialogs; }

  appendDialog(dialog) {
    if (!this._dialogs.includes(dialog)) this._dialogs.push(dialog);

    let groupId = dialog.getAttribute("name");
    if (!groupId) groupId = `_group_${getUuid(dialog.getTitle() || dialog.id)}`;

    let handlesGroup = this.querySelector(`#${groupId}`);
    if (!handlesGroup) {
      handlesGroup = new DialogHandles();
      handlesGroup.id = groupId;
      this.appendChild(handlesGroup);
    }

    let dialogHandle = handlesGroup.querySelector(`#${dialog.id}-handle`);
    if (!dialogHandle) {
      dialogHandle = new DialogHandle(dialog);
      dialogHandle.id = `${dialog.id}-handle`;
      dialogHandle.name = groupId;
      handlesGroup.appendHandle(dialogHandle);
    } else {
      console.log(`Handle for dialog ID ${dialog.id} already exists.`);
    }

    this._setupDialogListeners(dialog, handlesGroup, dialogHandle);

    if (this._dockbarContainer) this._dockbarContainer.style.display = "flex";
  }

  getCoords() {
    let rect = this.shadowRoot.querySelector("#dockbar").getBoundingClientRect();
    return rect;
  }

  _renderHTML() {
    this.shadowRoot.innerHTML = `
    <style>
      #container {
        position: fixed;
        bottom: 0;
        left: 50%;
        right: 50%;
        display: flex;
        flex-direction: row;
        align-items: center;
        justify-content: center; /* horizontally center #dockbar */
        user-select: none;
        /* no transform, no pointer-events hacks */
      }

      #dockbar {
        pointer-events: auto;
        z-index: 1000;
        display: none;
        flex-direction: row;
        align-items: center;
        padding: 8px 12px;
        border-radius: 10px;
        background-color: var(--surface-elevated-color, var(--surface-color));
        border: 1px solid var(--border-subtle-color, var(--divider-color));
        color: var(--on-surface-color);
        height: auto;
        min-width: 260px;
        margin-bottom: 10px;
        box-shadow: var(--dockbar-shadow);
      }

      #dockbar ::slotted(globular-dialog-handles) {
        margin: 0 4px;
      }
    </style>
      <div id="container">
        <paper-card id="dockbar"><slot></slot></paper-card>
      </div>
    `;
  }

  _cacheElements() {
    this._dockbarContainer = this.shadowRoot.getElementById("dockbar");
    this._mainContainer = this.shadowRoot.getElementById("container");
  }

  _setupDialogListeners(dialog, handlesGroup, handle) {
    dialog.removeEventListener("dialog-minimized", handle._handleMinimizedListener);
    dialog.removeEventListener("dialog-opened", handle._handleOpenedListener);
    dialog.removeEventListener("dialog-closed", handle._handleClosedListener);

    handle._handleMinimizedListener = () => handle.dock();
    handle._handleOpenedListener = () => {
      handlesGroup.appendHandle(handle);
      this._dockbarContainer.style.display = "flex";
    };
    handle._handleClosedListener = () => {
      handlesGroup.removeHandle(handle);

      if (handlesGroup.children.length === 0) {
        this.removeChild(handlesGroup);
      }

      if (this._dialogs.length === 0) {
        this._dockbarContainer.style.display = "none";
      }

      const dialogIndex = this._dialogs.findIndex(d => d.id === dialog.id);
      if (dialogIndex > -1) this._dialogs.splice(dialogIndex, 1);

      dialog.removeEventListener("dialog-minimized", handle._handleMinimizedListener);
      dialog.removeEventListener("dialog-opened", handle._handleOpenedListener);
      dialog.removeEventListener("dialog-closed", handle._handleClosedListener);
      handle._handleMinimizedListener = null;
      handle._handleOpenedListener = null;
      handle._handleClosedListener = null;
    };

    dialog.addEventListener("dialog-minimized", handle._handleMinimizedListener);
    dialog.addEventListener("dialog-opened", handle._handleOpenedListener);
    dialog.addEventListener("dialog-closed", handle._handleClosedListener);
  }
}

customElements.define('globular-dockbar', Dockbar);

// Singleton dockbar instance
export const dockbar = new Dockbar();
if (document.body) {
  document.body.appendChild(dockbar);
} else {
  document.addEventListener('DOMContentLoaded', () => {
    document.body.appendChild(dockbar);
  });
}
