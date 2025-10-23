// Polymer dependencies
import '@polymer/iron-icons/iron-icons.js';
import '@polymer/paper-icon-button/paper-icon-button.js';

// Assuming these are external utility functions
import { setResizeable } from "./resizeable.js";
import { setMoveable } from './moveable.js';
import { dockbar } from './dockbar.js'; // Assuming dockbar is a global object
import { fireResize, getCoords } from './utility.js';

/**
 * `globular-dialog` Web Component.
 * Implements a customizable dialog window with features like moveability, resizability,
 * minimize/maximize, and modal overlay.
 *
 * Attributes:
 * - `id` (string): Unique ID for the dialog (auto-generated if not provided).
 * - `name` (string): A name for the dialog.
 * - `width` (string): Initial width (e.g., "500px", "50%").
 * - `height` (string): Initial height (e.g., "300px", "auto").
 * - `background-color` (string): Background color of the dialog.
 * - `color` (string): Text color of the dialog.
 * - `overflow` (string): CSS overflow-y property for content ("auto", "hidden").
 * - `ok-cancel` (boolean): If "true", shows default "Ok" and "Cancel" buttons in the footer.
 * - `is-modal` (boolean): If "true", dialog is modal (shows an overlay).
 * - `show-icon` (boolean): If "true", shows the icon slot in the header.
 * - `is-maximizeable` (boolean): If "true", allows dialog to be maximized.
 * - `is-minimizeable` (boolean): If "true", allows dialog to be minimized to a dockbar.
 * - `is-moveable` (boolean): If "true", allows dialog to be dragged.
 * - `offset` (number): Vertical offset for positioning (e.g., if under an app bar).
 *
 * Slots:
 * - Default slot: For the main content of the dialog.
 * - `icon`: For an icon in the header.
 * - `search`: For a search bar in the header.
 * - `title`: For the main title in the header.
 * - `header`: For custom buttons/elements in the header.
 * - `actions`: For custom buttons/elements in the footer.
 *
 * Callbacks (set as properties on the instance):
 * - `onok`: Function called when the "Ok" button is clicked.
 * - `oncancel`: Function called when the "Cancel" button is clicked.
 * - `onclose`: Function called when the dialog is fully closed (after animation).
 * - `onminimize`: Function called when the dialog starts minimizing.
 * - `onmove(left, top)`: Function called when the dialog is moved.
 */
export class Dialog extends HTMLElement {
    // --- Internal Properties (using _ convention for "private-like") ---
    _dialogElement = null; // The main dialog paper-card element
    _headerElement = null;
    _contentElement = null;
    _footerElement = null;
    _titleSpan = null; // Renamed for clarity from titleDiv
    _okBtn = null;
    _cancelBtn = null;
    _closeBtn = null;
    _minimizeBtn = null;
    _enterMaxBtn = null;
    _exitMaxBtn = null;
    _iconSlot = null; // Renamed from icon
    _okCancelButtonsDiv = null; // Renamed from buttonsDiv

    _isMoving = false; // Internal state for moveability (managed by moveable.js)
    _offsetX = 0; // Internal state for moveability (managed by moveable.js)
    _offsetY = 0; // Internal state for moveability (managed by moveable.js)

    _time = new Date().getTime(); // Timestamp for ID and sorting
    _dialogId = null; // Unique ID for the dialog
    _parent = null; // Parent element where dialog is appended (body or modal overlay)
    _modalDiv = null; // The modal overlay div if isModal is true

    // Dialog state
    _isResizable = false;
    _isModal = false;
    _showIcon = false;
    _isMaximizeable = false;
    _isMinimizeable = false;
    _isMoveable = false;
    _offset = 0; // Vertical offset for positioning

    // Stored dimensions for maximize/restore
    _originalWidth = 0;
    _originalHeight = 0;
    _originalTop = 0;
    _originalLeft = 0;

    // Callbacks set by consumers
    onok = null;
    oncancel = null;
    onclose = null;
    onminimize = null;
    onmove = null;

    // --- Constructor ---
    constructor() {
        super();
        this.attachShadow({ mode: 'open' });
        this._renderHTML(); // Render HTML in constructor
    }

    // --- Lifecycle Callbacks ---
    connectedCallback() {
        this._cacheElements(); // Cache DOM elements
        this._applyInitialAttributes(); // Apply attributes
        this._setupButtonActions(); // Setup all button event listeners
        this._setupAnimationListeners(); // Setup animation end listeners
        this._setupMoveableAndResizable(); // Setup external moveable/resizable
        this._setupModalBehavior(); // Create and manage modal overlay if needed
        this._positionDialog(); // Initial positioning
        this.focus(); // Set initial focus
    }

    disconnectedCallback() {
        this._cleanupEventListeners(); // Clean up all event listeners
        // Clean up modal overlay if it exists and this dialog owns it
        if (this._modalDiv && this._modalDiv.parentNode) {
            this._modalDiv.parentNode.removeChild(this._modalDiv);
        }
    }

    // --- Private Helper Methods ---

    _renderHTML() {
        // Set dialog ID in constructor for early access
        this._dialogId = this.getAttribute("id") || `_${this._time}`;
        // Prevent creating duplicate dialogs if one with the same ID already exists in the body
        if (document.getElementById(this._dialogId) && !this._isModal) { // Check !this.isModal to allow re-rendering in place for modal
            console.warn(`Dialog with ID "${this._dialogId}" already exists. Skipping rendering.`);
            return;
        }

        const backgroundColor = this.getAttribute("background-color") || "var(--surface-color)";
        const color = this.getAttribute("color") || "var(--on-surface-color)";
        const overflow = this.getAttribute("overflow") === "hidden" ? "hidden" : "auto";
        const name = this.getAttribute("name") || "";

        this.shadowRoot.innerHTML = `
        <style>
        @keyframes minimize {
            0% { transform: scale(1) translate(0,0); }
            50% { height: 40px; transform: translate( var(--offset-left), var(--offset-top)); }
            75% { height: 40px; width: 250px; transform: translate( var(--offset-left), var(--offset-top)); }
            100% { height: 0px; width: 250px; transform: translate( var(--offset-left), calc(var(--offset-top) + 40px)); }
        }

        @keyframes implode {
            0% { transform: scale(1); opacity: 1; }
            100% { transform: scale(0.5); opacity: 0; }
        }

        .dialog {
            border: solid 1px var(--divider-color);
            border-top: solid 1px var(--primary-color);
            transform-origin: top left;
            opacity: 1;
            background-color: ${backgroundColor};
            color: ${color};
            border-radius: 4px;
            position: absolute;
            display: flex;
            flex-direction: column;
            top: 0px;
            left: 0px;
            z-index: 100;
            overflow: hidden; /* Main dialog overflow */
            user-select: none;
            box-sizing: border-box; /* Include padding/border in width/height */
        }

        .dialog.minimizing { animation: minimize 1s ease-in-out forwards; pointer-events: none; }
        .dialog.closing { animation: implode 0.2s ease-in-out forwards; pointer-events: none; }

        .dialog_content {
            flex-grow: 1;
            width: 100%;
            height: 100%;
            overflow-y: ${overflow}; /* Controlled by attribute */
            overflow-x: hidden; /* Typically hidden for vertical scrolling dialogs */
        }

        ::-webkit-scrollbar { width: 8.5px; height: 8.5px; }
        ::-webkit-scrollbar-track { background: var(--surface-color); }
        ::-webkit-scrollbar-thumb { background: var(--palette-divider); border-radius: 20px; border: 6px solid transparent; background-clip: content-box; min-height: 30px; }
        ::-webkit-scrollbar-thumb:hover { background-color: var(--palette-divider-hover, #a8bbbf); }

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
        
        .dialog_delete_button { /* This class seems unused in provided HTML */
            display: flex; justify-content: center; align-items: center; min-width: 16px; z-index: 10;
        }
        
        .dialog_delete_button i:hover { cursor: pointer; transition: all .2s ease; }
        
        .unselectable{
            -webkit-touch-callout: none; -webkit-user-select: none; -khtml-user-select: none;
            -moz-user-select: none; -ms-user-select: none; user-select: none;
        }
        
        .dialog_footer {
            display: flex;
            position: relative;
            text-align: center;
            vertical-align: middle;
            justify-content: flex-end;
            padding: 1px;
        }
        
        .dialog_button:hover { cursor: pointer; border-color: white; }
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
            cursor: grab; /* Indicates draggable header */
        }

        .dialog_header_buttons { display: flex; flex-direction: row; justify-content: flex-end; align-items: center; flex-grow: 1; }

        /* Maximize/Restore Specific Styles */
        .dialog.maximized {
            top: 0px !important;
            left: 0px !important;
            width: 100% !important;
            height: 100% !important;
            border-radius: 0px !important;
            border: none !important;
        }

        </style>

        <paper-card id="dialog_div" class="dialog">
            <div class="dialog_header unselectable">
                <div id="icon" class="dialog_icon">
                    <slot name="icon"></slot>
                </div>

                <div id="search" class="dialog_search">
                    <slot name="search"></slot>
                </div>
    
                <div id="title-slot-container" class="dialog_title">
                    <slot name="title"></slot>
                </div>
                
                <div class="dialog_header_buttons">
                    <slot name="header"></slot>
                    <paper-icon-button id="minimize_btn" style="display: none;" icon="icons:remove" class="dialog_button"></paper-icon-button>
                    <paper-icon-button id="enter_max_btn" style="display: none;" icon="icons:fullscreen" class="dialog_button"></paper-icon-button>
                    <paper-icon-button id="exit_max_btn" style="display: none;" icon="icons:fullscreen-exit" class="dialog_button"></paper-icon-button>
                    <paper-icon-button id="close_btn" icon="clear" class="dialog_button"></paper-icon-button>
                </div>
            </div>

            <div class="dialog_content">
                <slot></slot>
            </div>

            <div class="card-actions modal-footer unselectable">
                <slot name="actions"></slot>
                <div id="ok_cancel_buttons_div" class="dialog_buttons">
                    <paper-button id="ok_btn">Ok</paper-button>
                    <paper-button id="cancel_btn">Cancel</paper-button>
                </div>
            </div>
        </paper-card>
        `;
        this.id = this._dialogId; // Set the ID on the host element
    }

    _cacheElements() {
        this._dialogElement = this.shadowRoot.getElementById("dialog_div");
        this._headerElement = this.shadowRoot.querySelector(".dialog_header");
        this._contentElement = this.shadowRoot.querySelector(".dialog_content");
        this._footerElement = this.shadowRoot.querySelector(".modal-footer"); // Renamed class in template
        this._titleSpan = this.shadowRoot.getElementById("title-slot-container"); // Container for title slot
        this._okBtn = this.shadowRoot.getElementById("ok_btn");
        this._cancelBtn = this.shadowRoot.getElementById("cancel_btn");
        this._closeBtn = this.shadowRoot.getElementById("close_btn");
        this._minimizeBtn = this.shadowRoot.getElementById("minimize_btn");
        this._enterMaxBtn = this.shadowRoot.getElementById("enter_max_btn");
        this._exitMaxBtn = this.shadowRoot.getElementById("exit_max_btn");
        this._iconSlot = this.shadowRoot.getElementById("icon"); // The icon slot container
        this._okCancelButtonsDiv = this.shadowRoot.getElementById("ok_cancel_buttons_div");
    }

    _applyInitialAttributes() {
        this._dialogElement.setAttribute("name", this.getAttribute("name") || "");

        // Dimensions
        this.setWidth(this.getAttribute("width"));
        this.setHeight(this.getAttribute("height"));

        // Colors
        this.setBackGroundColor(this.getAttribute("background-color") || "var(--surface-color)");
        this.setColor(this.getAttribute("color") || "var(--on-surface-color)");

        // Booleans
        this._isResizable = this.hasAttribute("is-resizeable") && this.getAttribute("is-resizeable") === "true";
        this._isModal = this.hasAttribute("is-modal") && this.getAttribute("is-modal") === "true";
        this._showIcon = this.hasAttribute("show-icon") && this.getAttribute("show-icon") === "true";
        this._isMaximizeable = this.hasAttribute("is-maximizeable") && this.getAttribute("is-maximizeable") === "true";
        this._isMinimizeable = this.hasAttribute("is-minimizeable") && this.getAttribute("is-minimizeable") === "true";
        this._isMoveable = this.hasAttribute("is-moveable") && this.getAttribute("is-moveable") === "true";
        this._offset = parseInt(this.getAttribute("offset")) || 0;

        // Apply initial display states based on attributes
        if (this._showIcon) {
            this._iconSlot.style.display = "flex";
        } else {
            this._iconSlot.style.display = "none";
        }

        if (this.hasAttribute("ok-cancel") && this.getAttribute("ok-cancel") === "true") {
            this._okCancelButtonsDiv.style.display = "flex";
        } else {
            this._okCancelButtonsDiv.style.display = "none";
            // Hide entire footer if no custom actions and ok/cancel are hidden
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
        // Event listener for animation completion
        this._dialogElement.addEventListener('animationend', this._handleAnimationEnd);
    }

    _setupMoveableAndResizable() {
        if (this._isResizable) {
            setResizeable(this._dialogElement, (width, height) => {
                this.setWidth(width);
                this.setHeight(height);
                this.dispatchEvent(new CustomEvent("dialog-resized", {
                    detail: { width: width, height: height },
                    bubbles: true,
                    composed: true
                }));
            }, "right", 1000); // Assuming "right" resize handle, threshold 1000
        }

        if (this._isMoveable) {
            setMoveable(this._headerElement, this._dialogElement, (left, top) => {
                if (this.onmove) {
                    this.onmove(left, top);
                }
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
            dockbar.appendDialog(this); // Assumes dockbar is ready
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
            this._parent = this._modalDiv; // Set parent for dialog append
            this._modalDiv.appendChild(this); // Append dialog to modal overlay
        } else {
            this._parent = this.parentNode; // Standard parent
        }
    }

    _positionDialog() {
        // Position the new dialog (offset from last opened dialog or centered)
        const dialogs = dockbar.getDialogs();
        if (dialogs.length > 1) {
            // Convert to array and sort by 'time' attribute (timestamp from constructor)
            const sortedDialogs = Array.from(dialogs).sort((dialogA, dialogB) => {
                const timeA = parseInt(dialogA.getAttribute("time"));
                const timeB = parseInt(dialogB.getAttribute("time"));
                return timeA - timeB;
            });

            const lastDialog = sortedDialogs[dialogs.length - 2]; // Second to last
            const lastDialogCoord = lastDialog.getCoords();
            const offsetLeft = lastDialogCoord.left + 40;
            const offsetTop = lastDialogCoord.top + 40;

            this.setPosition(offsetLeft, offsetTop);
        } else {
            // If not moveable, center by default for first dialog
            if (!this._isMoveable) {
                this.setCentered();
            }
        }
    }

    // --- Event Handlers (using arrow functions for 'this' binding) ---

    _handleDialogClick = (e) => {
        e.stopPropagation(); // Stop propagation to prevent document/body clicks from interfering
        this.focus(); // Set focus on this dialog
    };

    _handleCloseClick = (evt) => {
        evt.stopPropagation();
        this._dialogElement.classList.add('closing'); // Trigger closing animation
        this.dispatchEvent(new CustomEvent("dialog-closing")); // Dispatch closing event
    };

    _handleCancelClick = (evt) => {
        this._handleCloseClick(evt); // Use same close handler
        this.oncancel?.(); // Call external cancel callback
    };

    _handleOkClick = (evt) => {
        this.onok?.(); // Call external OK callback
        this._handleCloseClick(evt); // Use same close handler
    };

    _handleAnimationEnd = (evt) => {
        if (evt.animationName === "implode") {
            // Dialog has finished closing animation
            if (this._modalDiv && this._modalDiv.parentNode) {
                this._modalDiv.parentNode.removeChild(this._modalDiv);
            }
            if (this.parentNode) {
                this.parentNode.removeChild(this);
            }
            this._dialogElement.classList.remove('closing'); // Clean up class
            this.onclose?.(); // Call external onclose callback
            this.dispatchEvent(new CustomEvent("dialog-closed", { bubbles: true, composed: true })); // Dispatch closed event
        } else if (evt.animationName === "minimize") {
            // Dialog has finished minimizing animation
            this._dialogElement.classList.remove('minimizing'); // Clean up class
            this.dispatchEvent(new CustomEvent("dialog-minimized", { bubbles: true, composed: true })); // Dispatch minimized event
        }
    };

    _handleEnterMaximize = (e) => {
        e.stopPropagation();
        this._originalWidth = this._dialogElement.offsetWidth;
        this._originalHeight = this._dialogElement.offsetHeight;
        this._originalTop = this._dialogElement.offsetTop;
        this._originalLeft = this._dialogElement.offsetLeft;

        this._dialogElement.classList.add('maximized');
        // If modal, fixed positioning; otherwise, absolute relative to parent container
        if (this._isModal) {
            this._dialogElement.style.position = "fixed";
            this._dialogElement.style.top = "0px";
            this._dialogElement.style.left = "0px";
            this._dialogElement.style.height = "100%";
        } else {
            this._dialogElement.style.position = "absolute";
            this._dialogElement.style.top = `${this._offset}px`; // Use offset if defined
            this._dialogElement.style.left = "0px";
            this._dialogElement.style.height = `calc(100% - ${this._offset}px)`;
        }
        this._dialogElement.style.width = "100%";

        this._exitMaxBtn.style.display = "block";
        this._enterMaxBtn.style.display = "none";

        fireResize(); // Inform layout system
        this.dispatchEvent(new CustomEvent("dialog-maximized", { bubbles: true, composed: true }));
    };

    _handleExitMaximize = (e) => {
        e.stopPropagation();
        this._dialogElement.classList.remove('maximized');
        this._dialogElement.style.top = `${this._originalTop}px`;
        this._dialogElement.style.left = `${this._originalLeft}px`;
        // Reset position to default (unset) if it was originally not explicitly positioned by CSS
        this._dialogElement.style.position = "";
        this._dialogElement.style.width = `${this._originalWidth}px`;
        this._dialogElement.style.height = `${this._originalHeight}px`;

        this._enterMaxBtn.style.display = "block";
        this._exitMaxBtn.style.display = "none";
        fireResize(); // Inform layout system
    };

    _handleHeaderDoubleClick = (e) => {
        e.stopPropagation();
        if (this._dialogElement.classList.contains('maximized')) {
            this._handleExitMaximize(e);
        } else {
            this._handleEnterMaximize(e);
        }
    };

    _handleMinimizeClick = (e) => {
        e.stopPropagation();
        const dockbarCoords = dockbar.getCoords();
        const dialogCoords = getCoords(this._dialogElement);

        const offsetLeft = dockbarCoords.left - dialogCoords.left + 2; // Offset to dockbar x position + small buffer
        const offsetTop = dockbarCoords.top - dialogCoords.top - 40; // Offset to dockbar y position - height of dialog title bar

        this._dialogElement.style.setProperty("--offset-left", `${offsetLeft}px`);
        this._dialogElement.style.setProperty("--offset-top", `${offsetTop}px`);

        this._dialogElement.classList.add('minimizing'); // Add animation class
        this._onMinimize?.(); // Call external minimize callback
    };


    // --- Public API Methods ---

    /**
     * Sets the background color of the dialog.
     * @param {string} color The CSS color value.
     */
    setBackGroundColor(color) {
        if (this._dialogElement) {
            this._dialogElement.style.backgroundColor = color;
        }
    }

    /**
     * Sets the text color of the dialog.
     * @param {string} color The CSS color value.
     */
    setColor(color) {
        if (this._dialogElement) {
            this._dialogElement.style.color = color;
        }
    }

    /** Hides the horizontal resize handle. */
    hideHorizontalResize() {
        const resizeHandle = this.shadowRoot.querySelector("#resize-width-div"); // Assuming ID for handle
        if (resizeHandle) resizeHandle.style.display = "none";
    }

    /** Shows the horizontal resize handle. */
    showHorizontalResize() {
        const resizeHandle = this.shadowRoot.querySelector("#resize-width-div");
        if (resizeHandle) resizeHandle.style.display = "block";
    }

    /** Hides the vertical resize handle. */
    hideVerticalResize() {
        const resizeHandle = this.shadowRoot.querySelector("#resize-height-div"); // Assuming ID for handle
        if (resizeHandle) resizeHandle.style.display = "none";
    }

    /** Shows the vertical resize handle. */
    showVerticalResize() {
        const resizeHandle = this.shadowRoot.querySelector("#resize-height-div");
        if (resizeHandle) resizeHandle.style.display = "block";
    }

    /**
     * Sets the height of the dialog.
     * @param {string|number} height The height in pixels or CSS string (e.g., "300px", "50%").
     */
    setHeight(height) {
        if (this._dialogElement) {
            this._dialogElement.style.height = typeof height === 'number' ? `${height}px` : height;
        }
    }

    /**
     * Sets the width of the dialog.
     * @param {string|number} width The width in pixels or CSS string (e.g., "500px", "auto").
     */
    setWidth(width) {
        if (this._dialogElement) {
            this._dialogElement.style.width = typeof width === 'number' ? `${width}px` : width;
        }
    }

    /**
     * Gets the current offsetWidth of the dialog.
     * @returns {number} The width in pixels.
     */
    getWidth() {
        return this._dialogElement ? this._dialogElement.offsetWidth : 0;
    }

    /**
     * Gets the current offsetHeight of the dialog, including header.
     * @returns {number} The height in pixels.
     */
    getHeight() {
        // Adjust for header height as dialog_content flex-grows
        return (this._dialogElement ? this._dialogElement.offsetHeight : 0);
    }

    /**
     * Sets the maximum width of the dialog.
     * @param {string|number} maxWidth The maximum width.
     */
    setMaxWidth(maxWidth) {
        if (this._dialogElement) {
            this._dialogElement.style.maxWidth = typeof maxWidth === 'number' ? `${maxWidth}px` : maxWidth;
        }
    }

    /**
     * Returns the coordinates (top, left) of the dialog relative to the viewport.
     * @returns {object} An object with top and left properties.
     */
    getCoords() {
        return getCoords(this._dialogElement); // Assumes getCoords handles null element
    }

    /** Return the icon of the dialog (src of slotted img). */
    getIcon() {
        // Assuming the icon slot contains an <img> element
        const iconSlot = this.shadowRoot.querySelector('slot[name="icon"]');
        const assignedImg = iconSlot?.assignedNodes().find(node => node.nodeName === 'IMG');
        return assignedImg ? assignedImg.getAttribute('src') : "";
    }

    /** Return the title of the dialog (text content of slotted title). */
    getTitle() {
        // Assuming the title slot contains text content directly or within a simple element
        const titleSlot = this.shadowRoot.querySelector('slot[name="title"]');
        return titleSlot ? titleSlot.assignedNodes()[0]?.textContent || "" : "";
    }

    /** Closes the window. */
    close() {
        this._closeBtn?.click(); // Trigger click on internal close button
    }

    /** Minimizes the window. */
    minimize() {
        this._minimizeBtn?.click(); // Trigger click on internal minimize button
    }

    /** Restores the window from maximized state. */
    restore() {
        this._exitMaxBtn?.click(); // Trigger click on internal exit maximize button
    }

    /** Opens the dialog. */
    open() {
        if (this._modalDiv) {
            document.body.appendChild(this._modalDiv);
            this._modalDiv.appendChild(this); // Dialog is appended to modal overlay
        } else if (this.parentNode) { // Append to original parent if not modal
            this.parentNode.appendChild(this);
        }

        this.dispatchEvent(new CustomEvent("dialog-opened", { bubbles: true, composed: true }));
        this.focus(); // Set focus on this dialog
    }

    /** Centers the dialog within its parent (or viewport if parent is body). */
    setCentered() {
        if (!this._dialogElement || !this._parent) {
            console.warn("Dialog or parent not ready for centering.");
            return;
        }
        
        const parentRect = this._parent.getBoundingClientRect();
        const dialogWidth = this._dialogElement.offsetWidth;
        const dialogHeight = this._dialogElement.offsetHeight;

        // Calculate center position relative to parent's viewport rect
        let left = parentRect.left + (parentRect.width - dialogWidth) / 2;
        let top = parentRect.top + (parentRect.height - dialogHeight) / 2;

        // Adjust for window scroll if parent is body/document
        if (this._parent === document.body || this._parent === document.documentElement || this._parent === this._modalDiv) {
             left += window.pageXOffset || document.documentElement.scrollLeft || document.body.scrollLeft;
             top += window.pageYOffset || document.documentElement.scrollTop || document.body.scrollTop;
        }

        this.setPosition(left, top);
    }

    /**
     * Sets the dialog's position on the screen.
     * @param {number} x The horizontal position (left).
     * @param {number} y The vertical position (top).
     */
    setPosition(x, y) {
        if (this._dialogElement) {
            this._dialogElement.style.left = `${x}px`;
            this._dialogElement.style.top = `${y}px`;
        }
    }

    /** Sets focus on this dialog, bringing it to the front. */
    focus() {
        // Get all dialogs managed by dockbar (assuming dockbar tracks all open dialogs)
        const dialogs = dockbar.getDialogs();

        // Reset z-index and border for other dialogs
        dialogs.forEach(dialog => {
            if (dialog._dialogElement) {
                dialog._dialogElement.style.zIndex = "100";
                dialog._dialogElement.style.border = "solid 1px var(--divider-color)";
                dialog._headerElement.style.backgroundColor = "var(--primary-light-color)";
            }
        });

        // Set z-index and highlight for this dialog
        if (this._dialogElement) {
            this._dialogElement.style.zIndex = "1000";
            this._dialogElement.style.border = "solid 1px var(--primary-light-color)";
            this._headerElement.style.backgroundColor = "var(--primary-color)";
        }

        // Dispatch dialog-focused event
        this.dispatchEvent(new CustomEvent("dialog-focused", { bubbles: true, composed: true }));

        // Simulate a click on the header to ensure it gains focus/activity, if needed by moveable.js
        this._headerElement?.click();
    }
}

customElements.define('globular-dialog', Dialog);