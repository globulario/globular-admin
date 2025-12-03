// Polymer dependencies
import '@polymer/iron-icons/iron-icons.js';
import '@polymer/paper-icon-button/paper-icon-button.js';

// Assuming these are external utility functions
import { setResizeable } from "./resizeable.js";
import { setMoveable } from './moveable.js';
import { dockbar } from './dockbar.js'; // Assuming dockbar is a global object
import { fireResize, getCoords } from './utility.js';

/**
 * `globular-dialog` Web Component…
 */
export class Dialog extends HTMLElement {
    _dialogElement = null;
    _headerElement = null;
    _contentElement = null;
    _footerElement = null;
    _titleSpan = null;
    _okBtn = null;
    _cancelBtn = null;
    _closeBtn = null;
    _minimizeBtn = null;
    _enterMaxBtn = null;
    _exitMaxBtn = null;
    _iconSlot = null;
    _okCancelButtonsDiv = null;

    _isMoving = false;
    _offsetX = 0;
    _offsetY = 0;

    _time = new Date().getTime();
    _dialogId = null;
    _parent = null;
    _modalDiv = null;

    _isResizable = false;
    _isModal = false;
    _showIcon = false;
    _isMaximizeable = false;
    _isMinimizeable = false;
    _isMoveable = false;
    _offset = 0;
    _resizeDirection = "both";

    _originalWidth = 0;
    _originalHeight = 0;
    _originalTop = 0;
    _originalLeft = 0;

    onok = null;
    oncancel = null;
    onclose = null;
    onminimize = null;
    onmove = null;

    static get observedAttributes() { return ["offset", "resize-direction"]; }
    attributeChangedCallback(name, _oldValue, newValue) {
        if (name === "offset") {
            const n = parseInt(newValue) || 0;
            this._offset = n;
            this.style.setProperty("--dialog-top-offset", `${n}px`);
            if (this._dialogElement && this._dialogElement.classList.contains("maximized")) {
                this._dialogElement.style.top = "";
                this._dialogElement.style.height = "";
            }
        } else if (name === "resize-direction") {
            this._resizeDirection = newValue || "both";
        }
    }

    constructor() {
        super();
        this.attachShadow({ mode: 'open' });
        this._renderHTML();
    }

    connectedCallback() {
        this._cacheElements();
        this._applyInitialAttributes();
        this._setupButtonActions();
        this._setupAnimationListeners();
        this._setupMoveableAndResizable();
        this._setupModalBehavior();
        this._positionDialog();
        this.focus();
    }

    disconnectedCallback() {
        this._cleanupEventListeners?.();
        if (this._modalDiv && this._modalDiv.parentNode) {
            this._modalDiv.parentNode.removeChild(this._modalDiv);
        }
    }

    _renderHTML() {
        this._dialogId = this.getAttribute("id") || `_${this._time}`;
        if (document.getElementById(this._dialogId) && !this._isModal) {
            console.warn(`Dialog with ID "${this._dialogId}" already exists. Skipping rendering.`);
            return;
        }

        const backgroundColor = this.getAttribute("background-color") || "var(--surface-color)";
        const color = this.getAttribute("color") || "var(--on-surface-color)";

        let overflow = "hidden";
        if (!this.getAttribute("overflow"))
            overflow = this.getAttribute("overflow")

        this.shadowRoot.innerHTML = `
      <style>
        @keyframes minimize {
          0% { transform: scale(1) translate(0,0); }
          50% { height: 40px; transform: translate(var(--offset-left), var(--offset-top)); }
          75% { height: 40px; width: 250px; transform: translate(var(--offset-left), var(--offset-top)); }
          100% { height: 0px; width: 250px; transform: translate(var(--offset-left), calc(var(--offset-top) + 40px)); }
        }
        @keyframes implode {
          0% { transform: scale(1); opacity: 1; }
          100% { transform: scale(0.5); opacity: 0; }
        }

        .dialog {
            border: 1px solid var(--dialog-border-color);
            border-top: 1px solid var(--border-strong-color, var(--palette-divider));
            transform-origin: top left;
            opacity: 1;
            background-color: ${backgroundColor};
            color: ${color};
            border-radius: 8px;
            position: absolute;
            display: flex;
            flex-direction: column;
            top: 0px;
            left: 0px;
            z-index: 100;
            overflow: hidden;
            user-select: none;
            box-sizing: border-box;
            box-shadow:
                0 18px 45px rgba(0,0,0,0.6),
                0 0 0 1px rgba(0,0,0,0.6); /* tighter edge in dark mode */

        }


        .dialog.minimizing { animation: minimize 1s ease-in-out forwards; pointer-events: none; }
        .dialog.closing { animation: implode 0.2s ease-in-out forwards; pointer-events: none; }

        .dialog_content {
          flex-grow: 1;
          width: 100%;
          height: 100%;
          overflow-y: ${overflow};
          overflow-x: hidden;
        }

        ::-webkit-scrollbar {
          width: 10px;
        }
        ::-webkit-scrollbar-track {
          background: var(--scroll-track, var(--surface-color));
        }
        ::-webkit-scrollbar-thumb {
          background: var(--scroll-thumb, var(--palette-divider));
          border-radius: 6px;
        }
        ::-webkit-scrollbar-thumb:hover {
          background: var(--scroll-thumb-hover, var(--palette-divider));
        }

        .dialog_title {
          width: 100%;
          height: 40px;
          padding: 1px;
          text-align: center;
          flex-grow: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          overflow: hidden;
        }

        .unselectable{ -webkit-touch-callout:none; -webkit-user-select:none; -khtml-user-select:none;
          -moz-user-select:none; -ms-user-select:none; user-select:none; }

        .dialog_footer {
          display: flex;
          position: relative;
          text-align: center;
          vertical-align: middle;
          justify-content: flex-end;
          padding: 1px;
        }

        .dialog_button:hover {
            background-color: rgba(0,0,0,0.06);
            border-radius: 50%;
            transition: background 120ms ease;
        }
        .dialog_button:active { border: solid 1px lightblue; }

        .dialog_buttons { display: flex; flex-direction: row; justify-content: flex-end; width: 100%; }

        .dialog_icon { display: flex; justify-content: center; align-items: center; padding-left: 8px; width: 40px; height: 40px; z-index: 10; }
        .dialog_icon img { width: 32px; height: 32px; }

        .dialog_header {
            background-color: var(--primary-light-color);
            color: var(--on-primary-color);
            display: flex;
            align-items: center;
            flex-direction: row;
            width: 100%;
            cursor: grab;
            box-shadow: 0 1px 0 rgba(0,0,0,0.12);
        }

        .dialog_header_buttons { display: flex; flex-direction: row; justify-content: flex-end; align-items: center; flex-grow: 1; }

        /* Default: maximize within parent container (e.g., #app which is position:relative) */
        .dialog.maximized {
          position: absolute !important;
          top: var(--dialog-top-offset, 0px) !important;
          left: 0px !important;
          width: 100% !important;
          height: calc(100% - var(--dialog-top-offset, 0px)) !important;
          border-radius: 0px !important;
          border: none !important;
          z-index: 10000 !important;
        }

        /* If this dialog is modal, span the viewport instead */
        :host([data-modal="true"]) .dialog.maximized {
          position: fixed !important;
          top: var(--dialog-top-offset, 0px) !important;
          left: 0px !important;
          height: calc(100vh - var(--dialog-top-offset, 0px)) !important;
        }

      </style>

      <paper-card id="dialog_div" class="dialog">
        <div class="dialog_header unselectable">
          <div id="icon" class="dialog_icon"><slot name="icon"></slot></div>
          <div id="search" class="dialog_search"><slot name="search"></slot></div>
          <div id="title-slot-container" class="dialog_title"><slot name="title"></slot></div>
          <div class="dialog_header_buttons">
            <slot name="header"></slot>
            <paper-icon-button id="minimize_btn" style="display:none;" icon="icons:remove" class="dialog_button"></paper-icon-button>
            <paper-icon-button id="enter_max_btn" style="display:none;" icon="icons:fullscreen" class="dialog_button"></paper-icon-button>
            <paper-icon-button id="exit_max_btn" style="display:none;" icon="icons:fullscreen-exit" class="dialog_button"></paper-icon-button>
            <paper-icon-button id="close_btn" icon="clear" class="dialog_button"></paper-icon-button>
          </div>
        </div>

        <div class="dialog_content"><slot></slot></div>

        <div class="card-actions modal-footer unselectable">
          <slot name="actions"></slot>
          <div id="ok_cancel_buttons_div" class="dialog_buttons">
            <paper-button id="ok_btn">Ok</paper-button>
            <paper-button id="cancel_btn">Cancel</paper-button>
          </div>
        </div>
      </paper-card>
    `;
        this.id = this._dialogId;
    }

    _cacheElements() {
        this._dialogElement = this.shadowRoot.getElementById("dialog_div");
        this._headerElement = this.shadowRoot.querySelector(".dialog_header");
        this._contentElement = this.shadowRoot.querySelector(".dialog_content");
        this._footerElement = this.shadowRoot.querySelector(".modal-footer");
        this._titleSpan = this.shadowRoot.getElementById("title-slot-container");
        this._okBtn = this.shadowRoot.getElementById("ok_btn");
        this._cancelBtn = this.shadowRoot.getElementById("cancel_btn");
        this._closeBtn = this.shadowRoot.getElementById("close_btn");
        this._minimizeBtn = this.shadowRoot.getElementById("minimize_btn");
        this._enterMaxBtn = this.shadowRoot.getElementById("enter_max_btn");
        this._exitMaxBtn = this.shadowRoot.getElementById("exit_max_btn");
        this._iconSlot = this.shadowRoot.getElementById("icon");
        this._okCancelButtonsDiv = this.shadowRoot.getElementById("ok_cancel_buttons_div");
    }

    _applyInitialAttributes() {
        this._dialogElement.setAttribute("name", this.getAttribute("name") || "");

        this.setWidth(this.getAttribute("width"));
        this.setHeight(this.getAttribute("height"));

        this.setBackGroundColor(this.getAttribute("background-color") || "var(--surface-color)");
        this.setColor(this.getAttribute("color") || "var(--on-surface-color)");

        this._isResizable = this.getAttribute("is-resizeable") === "true";
        this._isModal = this.getAttribute("is-modal") === "true";
        this._showIcon = this.getAttribute("show-icon") === "true";
        this._isMaximizeable = this.getAttribute("is-maximizeable") === "true";
        this._isMinimizeable = this.getAttribute("is-minimizeable") === "true";
        this._isMoveable = this.getAttribute("is-moveable") === "true";
        this._offset = parseInt(this.getAttribute("offset")) || 0;
        this._resizeDirection = this.getAttribute("resize-direction") || "both";

        // set host flag for CSS override
        if (this._isModal) this.setAttribute("data-modal", "true");
        else this.removeAttribute("data-modal");

        this.style.setProperty("--dialog-top-offset", `${this._offset}px`);

        this._iconSlot.style.display = this._showIcon ? "flex" : "none";

        if (this.getAttribute("ok-cancel") === "true") {
            this._okCancelButtonsDiv.style.display = "flex";
        } else {
            this._okCancelButtonsDiv.style.display = "none";
            const actionsSlot = this.shadowRoot.querySelector('slot[name="actions"]');
            if (actionsSlot && actionsSlot.assignedNodes().length === 0) {
                this._footerElement.style.display = "none";
            }
        }
    }

    _setupButtonActions() {
        this._closeBtn.addEventListener("click", this._handleCloseClick);
        this._cancelBtn.addEventListener("click", this._handleCancelClick);
        this._okBtn.addEventListener("click", this._handleOkClick);
    }

    _setupAnimationListeners() {
        this._dialogElement.addEventListener('animationend', this._handleAnimationEnd);
    }

    _setupMoveableAndResizable() {
        if (this._isResizable) {
            setResizeable(
                this._dialogElement,
                (w, h) => {
                    this.setWidth(w);
                    this.setHeight(h);
                    this.dispatchEvent(new CustomEvent("dialog-resized", {
                        detail: { width: w, height: h }, bubbles: true, composed: true
                    }));
                },
                "right",
                1000,
                40, // header height if you want vertical drag to start below header
                {
                    horizontal: this._resizeDirection !== "vertical",
                    vertical: this._resizeDirection !== "horizontal"
                }
            );
        }

        if (this._isMoveable) {
            setMoveable(this._headerElement, this._dialogElement, (left, top) => {
                this.onmove?.(left, top);
            }, this, this._offset);
        }

        if (this._isMaximizeable) {
            this._enterMaxBtn.style.display = "block";
            this._enterMaxBtn.addEventListener("click", this._handleEnterMaximize);
            this._exitMaxBtn.addEventListener("click", this._handleExitMaximize);
            this._headerElement.addEventListener("dblclick", this._handleHeaderDoubleClick);
        } else {
            this._enterMaxBtn.style.display = "none";
            this._exitMaxBtn.style.display = "none";
        }

        if (this._isMinimizeable) {
            this._minimizeBtn.style.display = "block";
            dockbar.appendDialog(this);
            this._minimizeBtn.addEventListener("click", this._handleMinimizeClick);
        } else {
            this._minimizeBtn.style.display = "none";
        }
    }

    _setupModalBehavior() {
        if (this._isModal) {
            this._modalDiv = document.createElement("div");
            this._modalDiv.style.cssText = `
        position: fixed; top: 0px; left: 0px; height: 100%; width: 100%;
        background-color: rgba(0,0,0,.25); z-index: 1000; display: block;
      `;
            document.body.appendChild(this._modalDiv);
            this._parent = this._modalDiv;
            this._modalDiv.appendChild(this);
        } else {
            this._parent = this.parentNode;
        }
    }

    _positionDialog() {
        const dialogs = dockbar.getDialogs();
        if (dialogs.length > 1) {
            const sortedDialogs = Array.from(dialogs).sort((a, b) =>
                parseInt(a.getAttribute("time")) - parseInt(b.getAttribute("time"))
            );
            const lastDialog = sortedDialogs[dialogs.length - 2];
            const lastDialogCoord = lastDialog.getCoords();
            const offsetLeft = lastDialogCoord.left + 40;
            const offsetTop = lastDialogCoord.top + 40;
            this.setPosition(offsetLeft, offsetTop);
        } else {
            if (!this._isMoveable) this.setCentered();
        }
    }

    _handleDialogClick = (e) => { e.stopPropagation(); this.focus(); };
    _handleCloseClick = (evt) => {
        evt.stopPropagation();
        this._dialogElement.classList.add('closing');
        this.dispatchEvent(new CustomEvent("dialog-closing"));
    };
    _handleCancelClick = (evt) => { this._handleCloseClick(evt); this.oncancel?.(); };
    _handleOkClick = (evt) => { this.onok?.(); this._handleCloseClick(evt); };

    _handleAnimationEnd = (evt) => {
        if (evt.animationName === "implode") {
            if (this._modalDiv && this._modalDiv.parentNode) this._modalDiv.parentNode.removeChild(this._modalDiv);
            if (this.parentNode) this.parentNode.removeChild(this);
            this._dialogElement.classList.remove('closing');
            this.onclose?.();
            this.dispatchEvent(new CustomEvent("dialog-closed", { bubbles: true, composed: true }));
        } else if (evt.animationName === "minimize") {
            this._dialogElement.classList.remove('minimizing');
            this.dispatchEvent(new CustomEvent("dialog-minimized", { bubbles: true, composed: true }));
        }
    };

    _handleEnterMaximize = (e) => {
        e.stopPropagation();
        this._originalWidth = this._dialogElement.offsetWidth;
        this._originalHeight = this._dialogElement.offsetHeight;
        this._originalTop = this._dialogElement.offsetTop;
        this._originalLeft = this._dialogElement.offsetLeft;

        this._dialogElement.classList.add('maximized');

        // let CSS control the geometry; clear inline dims
        this._dialogElement.style.position = "";
        this._dialogElement.style.top = "";
        this._dialogElement.style.left = "";
        this._dialogElement.style.width = "";
        this._dialogElement.style.height = "";

        this._exitMaxBtn.style.display = "block";
        this._enterMaxBtn.style.display = "none";

        fireResize();
        this.dispatchEvent(new CustomEvent("dialog-maximized", { bubbles: true, composed: true }));
    };

    _handleExitMaximize = (e) => {
        e.stopPropagation();
        this._dialogElement.classList.remove('maximized');
        this._dialogElement.style.top = `${this._originalTop}px`;
        this._dialogElement.style.left = `${this._originalLeft + 20}px`;
        this._dialogElement.style.position = "";
        this._dialogElement.style.width = `${this._originalWidth}px`;
        this._dialogElement.style.height = `${this._originalHeight}px`;

        this._enterMaxBtn.style.display = "block";
        this._exitMaxBtn.style.display = "none";
        fireResize();
    };

    _handleHeaderDoubleClick = (e) => {
        e.stopPropagation();
        if (this._dialogElement.classList.contains('maximized')) this._handleExitMaximize(e);
        else this._handleEnterMaximize(e);
    };

    _handleMinimizeClick = (e) => {
        e.stopPropagation();
        const dockbarCoords = dockbar.getCoords();
        const dialogCoords = getCoords(this._dialogElement);

        const offsetLeft = dockbarCoords.left - dialogCoords.left + 2;
        const offsetTop = dockbarCoords.top - dialogCoords.top - 40;

        this._dialogElement.style.setProperty("--offset-left", `${offsetLeft}px`);
        this._dialogElement.style.setProperty("--offset-top", `${offsetTop}px`);

        this._dialogElement.classList.add('minimizing');
        this._onMinimize?.();
    };

    setBackGroundColor(color) { if (this._dialogElement) this._dialogElement.style.backgroundColor = color; }
    setColor(color) { if (this._dialogElement) this._dialogElement.style.color = color; }
    hideHorizontalResize() { const h = this.shadowRoot.querySelector("#resize-width-div"); if (h) h.style.display = "none"; }
    showHorizontalResize() { const h = this.shadowRoot.querySelector("#resize-width-div"); if (h) h.style.display = "block"; }
    hideVerticalResize() { const h = this.shadowRoot.querySelector("#resize-height-div"); if (h) h.style.display = "none"; }
    showVerticalResize() { const h = this.shadowRoot.querySelector("#resize-height-div"); if (h) h.style.display = "block"; }
    setHeight(height) { if (this._dialogElement) this._dialogElement.style.height = typeof height === 'number' ? `${height}px` : height; }
    setWidth(width) { if (this._dialogElement) this._dialogElement.style.width = typeof width === 'number' ? `${width}px` : width; }
    getWidth() { return this._dialogElement ? this._dialogElement.offsetWidth : 0; }
    getHeight() { return this._dialogElement ? this._dialogElement.offsetHeight : 0; }
    setMaxWidth(maxWidth) { if (this._dialogElement) this._dialogElement.style.maxWidth = typeof maxWidth === 'number' ? `${maxWidth}px` : maxWidth; }
    getCoords() { return getCoords(this._dialogElement); }

    getIcon() {
        const iconSlot = this.shadowRoot.querySelector('slot[name="icon"]');
        const assignedImg = iconSlot?.assignedNodes().find(node => node.nodeName === 'IMG');
        return assignedImg ? assignedImg.getAttribute('src') : "";
    }
    getTitle() {
        const titleSlot = this.shadowRoot.querySelector('slot[name="title"]');
        return titleSlot ? titleSlot.assignedNodes()[0]?.textContent || "" : "";
    }

    close() { this._closeBtn?.click(); }
    minimize() { this._minimizeBtn?.click(); }
    restore() { this._exitMaxBtn?.click(); }

    open() {
        if (this._modalDiv) {
            document.body.appendChild(this._modalDiv);
            this._modalDiv.appendChild(this);
        } else if (this.parentNode) {
            this.parentNode.appendChild(this);
        }
        this.dispatchEvent(new CustomEvent("dialog-opened", { bubbles: true, composed: true }));
        this.focus();
    }

    setCentered() {
        if (!this._dialogElement || !this._parent) {
            console.warn("Dialog or parent not ready for centering.");
            return;
        }
        const parentRect = this._parent.getBoundingClientRect();
        const dialogWidth = this._dialogElement.offsetWidth;
        const dialogHeight = this._dialogElement.offsetHeight;

        let left = parentRect.left + (parentRect.width - dialogWidth) / 2;
        let top = parentRect.top + (parentRect.height - dialogHeight) / 2;

        if (this._parent === document.body || this._parent === document.documentElement || this._parent === this._modalDiv) {
            left += window.pageXOffset || document.documentElement.scrollLeft || document.body.scrollLeft;
            top += window.pageYOffset || document.documentElement.scrollTop || document.body.scrollTop;
        }

        this.setPosition(left, top);
    }

    setPosition(x, y) {
        if (this._dialogElement) {
            this._dialogElement.style.left = `${x}px`;
            this._dialogElement.style.top = `${y}px`;
        }
    }

    focus() {
        const dialogs = dockbar.getDialogs();
        dialogs.forEach(dialog => {
            if (dialog._dialogElement) {
                dialog._dialogElement.style.zIndex = "100";
                dialog._dialogElement.style.border = "solid 1px var(--divider-color)";
                dialog._headerElement.style.backgroundColor = "var(--primary-light-color)";
            }
        });

        if (this._dialogElement) {
            this._dialogElement.style.zIndex = "1000";
            this._dialogElement.style.border = "solid 1px var(--primary-light-color)";
            this._headerElement.style.backgroundColor = "var(--primary-color)";
        }

        this.dispatchEvent(new CustomEvent("dialog-focused", { bubbles: true, composed: true }));
        this._headerElement?.click();
    }
}

customElements.define('globular-dialog', Dialog);