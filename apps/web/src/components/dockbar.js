import * as getUuid from 'uuid-by-string'; // Assuming getUuid.v4 or similar
import { getCoords } from './utility'; // Assuming getCoords is functional

/**
 * `globular-dialog-handle` Web Component.
 * Represents a minimized dialog's clickable icon in the dockbar.
 *
 * Properties:
 * - `dialog` (Dialog): The actual `globular-dialog` instance this handle controls.
 * - `height` (number): The desired height of the handle (controls its visual size).
 */
export class DialogHandle extends HTMLElement {
    // --- Internal Properties (using _ convention for "private-like") ---
    _dialog = null;
    _height = 200; // Default height for handle
    _isFocused = false;
    _isDocked = false;

    // Cached DOM elements
    _container = null;
    _closeBtn = null;
    _minimizeBtn = null;
    _titleSpan = null; // Span element for title
    _previewContainer = null; // Container for the dialog's preview content

    // --- Constructor ---
    constructor(dialog, height = 200) {
        super();
        this.attachShadow({ mode: 'open' });

        this._dialog = dialog;
        this._height = height;

        this._renderHTML(); // Render HTML in constructor
    }

    // --- Lifecycle Callbacks ---
    connectedCallback() {
        this._cacheElements(); // Cache DOM elements
        this._applyInitialStyles(); // Apply initial height/width based on props
        this._setupEventListeners(); // Setup event listeners
        this.refreshPreview(); // Initial preview render
    }

    // --- Public Getters ---
    getCoords() {
        return getCoords(this._container);
    }

    getRect() {
        const coords = this.getCoords();
        // The width/height should reflect the handle's size, not the original dialog's
        return {
            top: coords.top,
            left: coords.left,
            width: this._container.offsetWidth,
            height: this._container.offsetHeight
        };
    }

    // --- Public Methods ---

    /** Refreshes the preview content displayed within the handle. */
    refreshPreview() {
        if (this._previewContainer && this._dialog && this._dialog.getPreview) {
            this._previewContainer.innerHTML = ""; // Clear existing preview
            const previewContent = this._dialog.getPreview();
            if (previewContent) {
                previewContent.classList.add("text-preview"); // Apply any preview-specific styling
                this._previewContainer.appendChild(previewContent);
            }
        } else {
            console.warn("DialogHandle: Could not refresh preview. Dialog or preview method missing.");
        }
    }

    /** Docks the associated dialog (hides it and shows handle). */
    dock() {
        if (this._dialog) {
            this._dialog.style.display = "none";
            this._dialog.classList.add("minimized"); // Add minimized class to dialog for animation/state
        }
        this._isDocked = true;
        if (this._minimizeBtn) this._minimizeBtn.style.display = "none";
        this.refreshPreview(); // Refresh to ensure preview is shown
    }

    /** Undocks the associated dialog (shows it and hides handle). */
    undock() {
        if (this._dialog) {
            this._dialog.style.display = ""; // Restore display
            this._dialog.classList.remove("minimized"); // Remove minimized class
            this._dialog.focus(); // Focus the dialog when undocked
        }
        this._isDocked = false;
        if (this._minimizeBtn) this._minimizeBtn.style.display = "block";
        // Remove preview content, as dialog is now visible
        if (this._previewContainer) this._previewContainer.innerHTML = "";
    }

    /** Removes focus from the dialog handle. */
    blur() {
        this._isFocused = false;
        if (this._container) this._container.style.border = "1px solid var(--divider-color)";
    }

    /** Sets focus on the dialog handle, bringing its associated dialog to front. */
    focus() {
        if (this._isFocused) {
            return;
        }

        // Blur all other handles
        document.querySelectorAll("globular-dialog-handle").forEach(handle => {
            if (handle !== this && typeof handle.blur === 'function') { // Ensure it's a DialogHandle
                handle.blur();
            }
        });

        this._isFocused = true;
        this._dialog?.focus(); // Focus the associated dialog

        if (this._container) this._container.style.border = "1px solid var(--primary-color)";
    }

    /**
     * Checks if the dialog handle has focus.
     * @returns {boolean} True if the dialog handle has focus.
     */
    hasFocus() {
        return this._isFocused;
    }

    // --- Private Helper Methods ---

    _renderHTML() {
        // Set basic width/height on container for the handle itself
        this.shadowRoot.innerHTML = `
        <style>
            #container {
                position: relative;
                display: flex;
                flex-direction: column;
                background-color: var(--surface-color);
                border: 1px solid var(--divider-color);
                height: var(--dialog-handle-height);
                width: var(--dialog-handle-width);
                overflow: hidden;
                box-sizing: border-box; /* Include padding/border in width/height */
            }

            #header-bar {
                display: flex;
                align-items: center;
                z-index: 1000;
                background-color: var(--primary-light-color, lightgray); /* Header background */
                color: var(--on-primary-color, black); /* Header text color */
                padding: 2px;
            }

            #close-btn, #minimize-btn {
                width: 24px;
                height: 24px;
                margin-right: 2px;
                color: var(--on-primary-color, white); /* Icon color */
                padding: 5px;
            }

            #title-span {
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
                flex-grow: 1;
                font-size: 0.85rem;
                padding: 0 4px; /* Padding for title text */
            }

            .preview-container {
                flex-grow: 1;
                overflow: hidden;
                display: flex;
                align-items: center;
                justify-content: center;
                background-color: black; /* Default preview background */
            }
        </style>
        <div id="container">
            <div id="header-bar">
                <paper-icon-button id="close-btn" icon="clear"></paper-icon-button>
                <span id="title-span"></span>
                <paper-icon-button id="minimize-btn" icon="icons:remove"></paper-icon-button>
            </div>
            <div class="preview-container">
                </div>
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
        // Set CSS variables for handle dimensions
        this.style.setProperty('--dialog-handle-height', `${this._height + 10}px`); // +10 for header padding/border
        this.style.setProperty('--dialog-handle-width', `${this._height}px`); // Width equals height for square handles

        if (this._dialog) {
            // Set the title in the handle's header
            if (this._titleSpan) {
                this._titleSpan.textContent = this._dialog.getTitle() || this._dialog.getAttribute('name') || "Dialog";
            }
        }
    }

    _setupEventListeners() {
        this._closeBtn.addEventListener('click', this._handleCloseClick);
        this._minimizeBtn.addEventListener('click', this._handleMinimizeClick);
        this._container.addEventListener('click', this._handleContainerClick); // Focus on click

        // Listen for events from the associated dialog to update handle state
        this._dialog.addEventListener("dialog-focused", this._handleDialogFocused);
        this._dialog.addEventListener("refresh-preview", this._handleRefreshPreview);
        this._dialog.addEventListener("dialog-closing", this._handleDialogClosing); // To clear preview on closing
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
        this.undock(); // Undock first to restore dialog visibility before closing
        this._dialog?.close(); // Trigger the dialog's close method
    };

    _handleMinimizeClick = (evt) => {
        evt.stopPropagation();
        this._dialog?.minimize(); // Trigger the dialog's minimize method
    };

    _handleContainerClick = (evt) => {
        evt.stopPropagation();
        this.focus(); // Set focus on this handle (and its dialog)
        if (this._isDocked) { // If docked, undock it on click
            this.undock();
        }
    };

    _handleDialogFocused = (evt) => {
        this.focus(); // Propagate focus from dialog to handle
    };

    _handleRefreshPreview = (evt) => {
        this.refreshPreview(); // Refresh preview when dialog content changes
    };

    _handleDialogClosing = (evt) => {
        // When the dialog starts closing, immediately undock it if it's docked,
        // so its closing animation is visible.
        if (this._isDocked) {
            this.undock(); // Undock it
            this._dialog.style.display = ""; // Ensure display is on for animation
        }
        // The dockbar will handle removing the handle after dialog-closed event.
    };
}

customElements.define('globular-dialog-handle', DialogHandle);


/**
 * `globular-dialog-handles` Web Component.
 * Acts as a container for multiple `globular-dialog-handle` instances,
 * grouping them by dialog type (name) and managing their display.
 *
 * Properties:
 * - None directly, manages slotted `DialogHandle` children.
 */
export class DialogHandles extends HTMLElement {
    // --- Internal Properties ---
    _iconElement = null; // Icon representing the group type
    _countSpan = null; // Count of handles in the group
    _handlesContainer = null; // The div holding the dialog handles

    constructor() {
        super();
        this.attachShadow({ mode: 'open' });
        this._renderHTML(); // Render HTML in constructor
    }

    connectedCallback() {
        this._cacheElements(); // Cache DOM elements
        this._setupEventListeners(); // Setup event listeners
        this._updateCountAndIcon(); // Initial count and icon display
    }

    // --- Public Methods ---

    /**
     * Appends a new dialog handle to this group.
     * @param {DialogHandle} handle The `DialogHandle` instance to append.
     */
    appendHandle(handle) {
        // Prevent adding the same handle multiple times
        if (this.querySelector(`#${handle.id}`)) {
            console.log(`Handle with ID ${handle.id} already exists.`);
            return;
        }

        this.appendChild(handle); // Append to light DOM, which slots it
        this._updateCountAndIcon(); // Update count and icon

        // Setup click listener for the handle (to undock)
        // This is done here to avoid re-attaching if handle is reused across groups
        handle.addEventListener('click', this._handleHandleClick);
        handle.addEventListener('mouseover', this._handleHandleMouseOver);
        handle.addEventListener('mouseout', this._handleHandleMouseOut);

        // Ensure the group handles container is visible if there are handles
        this._handlesContainer.style.display = "flex";
    }

    /**
     * Removes a dialog handle from this group.
     * @param {DialogHandle} handle The `DialogHandle` instance to remove.
     */
    removeHandle(handle) {
        this.removeChild(handle);
        this._updateCountAndIcon(); // Update count and icon

        // Remove listeners
        handle.removeEventListener('click', this._handleHandleClick);
        handle.removeEventListener('mouseover', this._handleHandleMouseOver);
        handle.removeEventListener('mouseout', this._handleHandleMouseOut);

        // Hide handles container if no children left
        if (this.children.length === 0) {
            this._handlesContainer.style.display = "none";
        }
    }

    /** Hides the group's dialog handles display. */
    hideHandles() {
        if (this._handlesContainer) {
            this._handlesContainer.style.display = "none";
        }
    }

    // --- Private Helper Methods ---

    _renderHTML() {
        this.shadowRoot.innerHTML = `
        <style>
            #container {
                position: relative;
                display: flex;
                justify-content: center;
                align-items: center;
                margin-right: 10px;
                /* By default, assume hidden until handles are added or icon is set */
                display: none; 
            }

            #main-icon { /* Renamed for clarity */
                width: 40px;
                height: 40px;
                object-fit: contain; /* Ensure icon scales properly */
            }

            #count-badge { /* Renamed for clarity */
                position: absolute;
                top: -5px;
                left: -5px;
                background-color: var(--primary-dark-color);
                color: var(--on-primary-dark-color); /* Ensure text color is set */
                border-radius: 50%;
                width: 20px;
                height: 20px;
                text-align: center;
                font-size: 12px;
                line-height: 20px;
                display: none; /* Hidden by default until count > 0 */
            }

            .handles {
                display: none; /* Controlled by JS hover/mouse events */
                flex-direction: row;
                align-items: flex-end; /* Align handles to bottom */
                justify-content: flex-start;
                position: fixed; /* Fixed position relative to viewport */
                top: -212px; /* Arbitrary initial hidden position, adjusted by JS */
                left: 0px; /* Adjusted by JS to center */
                padding: 5px; /* Padding inside the handles container */
                border-radius: 5px;
                background-color: var(--surface-color);
                border: 1px solid var(--divider-color);
                box-shadow: 0 4px 8px rgba(0,0,0,0.2); /* Add shadow */
                z-index: 10000; /* High z-index */
            }

            .handles:hover {
                cursor: pointer;
            }

            /* Slotted dialog handles */
            .handles ::slotted(globular-dialog-handle) {
                margin: 0 5px; /* Space between handles */
                transition: box-shadow 0.2s ease;
            }

        </style>
       
        <div id="container">
            <img id="main-icon"></img>
            <span id="count-badge"></span>
            <div class="handles">
                <slot></slot>
            </div>
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
        this._container.addEventListener("mouseenter", this._handleMouseEnter);
        this._handlesContainer.addEventListener("mouseleave", this._handleMouseLeave);
        // Using document-wide mousemove for click-outside-like behavior
        document.addEventListener("mousemove", this._handleMouseMove);
    }

    _cleanupEventListeners() {
        this._container.removeEventListener("mouseenter", this._handleMouseEnter);
        this._handlesContainer.removeEventListener("mouseleave", this._handleMouseLeave);
        document.removeEventListener("mousemove", this._handleMouseMove);
    }

    _handleMouseEnter = (evt) => {
        evt.stopPropagation();
        // Hide other DialogHandles groups if any are open
        document.querySelectorAll("globular-dialog-handles").forEach(otherHandles => {
            if (otherHandles !== this && typeof otherHandles.hideHandles === 'function') {
                otherHandles.hideHandles();
            }
        });
        this._handlesContainer.style.display = "flex";

        // Refresh previews of all dialog handles in this group
        Array.from(this.children).forEach(child => {
            if (child instanceof DialogHandle && typeof child.refreshPreview === 'function') {
                child.refreshPreview();
            }
        });

        // Position the handles container correctly above the icon
        this._positionHandlesContainer();
    };

    _handleMouseLeave = (evt) => {
        // This is primarily for when mouse leaves the handles container directly
        // The document mousemove handles cases where mouse leaves to arbitrary areas
        this._handlesContainer.style.display = "none";
    };

    _handleMouseMove = (evt) => {
        if (this._handlesContainer.style.display !== "flex") {
            return; // Only check if handles are currently visible
        }

        const rect = this._handlesContainer.getBoundingClientRect();
        const iconRect = this._iconElement.getBoundingClientRect();

        const x = evt.clientX;
        const y = evt.clientY;

        // The "hot zone" for the mouse: icon itself OR the expanded handles area
        const isOverIcon = x >= iconRect.left && x <= iconRect.right && y >= iconRect.top && y <= iconRect.bottom;
        const isOverHandles = x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;

        if (!isOverIcon && !isOverHandles) {
            this._handlesContainer.style.display = "none";
        }
    };

    _handleHandleClick = (evt) => {
        evt.stopPropagation();
        const handle = evt.currentTarget; // The clicked dialog handle
        if (handle instanceof DialogHandle) {
            handle.undock();
            this.hideHandles(); // Hide the handles bar after a dialog is restored
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

    /** Updates the displayed count and icon for the group. */
    _updateCountAndIcon() {
        const count = this.children.length;
        this._countSpan.innerHTML = count;
        this._countSpan.style.display = count > 0 ? "block" : "none";

        if (count > 0) {
            // Use the icon of the last added dialog (or first, depending on preference)
            const lastHandle = this.children[count - 1];
            if (lastHandle instanceof DialogHandle && lastHandle._dialog && lastHandle._dialog.getIcon) {
                this._iconElement.src = lastHandle._dialog.getIcon();
            }
            this._container.style.display = "flex"; // Show main icon container
        } else {
            this._iconElement.src = "";
            this._container.style.display = "none"; // Hide main icon container if no handles
        }
    }

    /** Positions the handles container above the main icon. */
    _positionHandlesContainer() {
        if (!this._iconElement || !this._handlesContainer) return;

        const iconRect = this._iconElement.getBoundingClientRect();
        const handlesWidth = this._handlesContainer.offsetWidth;

        // Position handles container centered above the icon
        this._handlesContainer.style.left = `${iconRect.left + (iconRect.width / 2) - (handlesWidth / 2)}px`;
        this._handlesContainer.style.top = `${iconRect.top - this._handlesContainer.offsetHeight - 10}px`; // 10px buffer
    }
}

customElements.define('globular-dialog-handles', DialogHandles);

/**
 * `globular-dockbar` Web Component.
 * Acts as the main dockbar for minimized dialogs, grouping them
 * into `globular-dialog-handles` containers.
 */
export class Dockbar extends HTMLElement {
    // --- Internal Properties ---
    _dialogs = []; // Array of all dialogs managed by the dockbar (not just minimized)
    _dockbarContainer = null; // The paper-card element for the dockbar itself

    constructor() {
        super();
        this.attachShadow({ mode: 'open' });
        this._renderHTML(); // Render HTML in constructor
    }

    connectedCallback() {
        this._cacheElements(); // Cache DOM elements
        // The dockbar is globally managed, so most listeners are implicit or handled by DialogHandles
    }

    // --- Public Methods ---

    /**
     * Returns a list of all dialogs currently managed by the dockbar.
     * @returns {Array<Dialog>} An array of `globular-dialog` instances.
     */
    getDialogs() {
        return this._dialogs;
    }

    /**
     * Appends a dialog to the dockbar, creating a `DialogHandles` group if needed.
     * @param {Dialog} dialog The `globular-dialog` instance to manage.
     */
    appendDialog(dialog) {
        // Prevent adding the same dialog multiple times to the _dialogs array
        if (!this._dialogs.includes(dialog)) {
            this._dialogs.push(dialog);
        }

        // Determine the group ID (based on dialog name or a UUID for untitled dialogs)
        let groupId = dialog.getAttribute("name");
        if (!groupId) {
            groupId = `_group_${getUuid(dialog.getTitle() || dialog.id)}`; // Use dialog title or ID for grouping
        }

        let handlesGroup = this.querySelector(`#${groupId}`);
        if (!handlesGroup) {
            handlesGroup = new DialogHandles();
            handlesGroup.id = groupId;
            this.appendChild(handlesGroup); // Append to light DOM, which slots it
        }

        // Append the specific dialog handle to the group
        let dialogHandle = handlesGroup.querySelector(`#${dialog.id}-handle`);
        if (!dialogHandle) {
            dialogHandle = new DialogHandle(dialog);
            dialogHandle.id = `${dialog.id}-handle`;
            dialogHandle.name = groupId; // Set name attribute for grouping reference
            handlesGroup.appendHandle(dialogHandle); // Use appendHandle method of DialogHandles
        } else {
            console.log(`Handle for dialog ID ${dialog.id} already exists.`);
        }

        // Set up listeners on the dialog for its state changes
        this._setupDialogListeners(dialog, handlesGroup, dialogHandle);

        // Ensure the dockbar itself is visible
        if (this._dockbarContainer) {
            this._dockbarContainer.style.display = "flex";
        }
    }

    /**
     * Gets the bounding client rectangle of the dockbar container.
     * @returns {DOMRect} The rectangle of the dockbar container.
     */
    getCoords() {
        return this.shadowRoot.querySelector("#container").getBoundingClientRect();
    }

    // --- Private Helper Methods ---

    _renderHTML() {
        this.shadowRoot.innerHTML = `
        <style>
            #container {
                position: fixed;
                z-index: 10000;
                bottom: 0px;
                /* Center the container */
                margin-left: 50%;
                transform: translateX(-50%);
                display: flex;
                flex-direction: row;
                align-items: center;
                justify-content: center;
                user-select: none;
            }

            #dockbar {
                z-index: 1000;
                display: none; /* Hidden by default until dialogs are minimized */
                flex-direction: row;
                align-items: center;
                padding: 10px;
                border-radius: 5px;
                background-color: var(--surface-color);
                border: 1px solid var(--divider-color);
                color: var(--on-surface-color); /* Use --on-surface-color */
                height: auto;
                min-width: 400px; /* Min width for dockbar */
                margin-bottom: 10px; /* Space from bottom of screen */
            }

            /* Slotted dialog-handles */
            #dockbar ::slotted(globular-dialog-handles) {
                margin: 0 5px; /* Space between handle groups */
            }

        </style>
        <div id="container">
            <paper-card id="dockbar">
                <slot></slot> </paper-card>
        </div>
        `;
    }

    _cacheElements() {
        this._dockbarContainer = this.shadowRoot.getElementById("dockbar");
        this._mainContainer = this.shadowRoot.getElementById("container"); // The fixed container
    }

    /** Sets up event listeners on a dialog to manage its presence in the dockbar. */
    _setupDialogListeners(dialog, handlesGroup, handle) {
        // Remove previous listeners if they exist (important if dialog is re-managed)
        dialog.removeEventListener("dialog-minimized", handle._handleMinimizedListener);
        dialog.removeEventListener("dialog-opened", handle._handleOpenedListener);
        dialog.removeEventListener("dialog-closed", handle._handleClosedListener);

        // Store references to bound listeners for later removal
        handle._handleMinimizedListener = () => handle.dock();
        handle._handleOpenedListener = () => {
            // When dialog opens, ensure its handle is appended and dockbar is visible
            handlesGroup.appendHandle(handle);
            this._dockbarContainer.style.display = "flex";
        };
        handle._handleClosedListener = () => {
            handlesGroup.removeHandle(handle);

            if (handlesGroup.children.length === 0) {
                this.removeChild(handlesGroup); // Remove the group if empty
            }

            if (this._dialogs.length === 0) { // Check if ALL dialogs are gone
                this._dockbarContainer.style.display = "none";
            }

            // Remove dialog from internal _dialogs array
            const dialogIndex = this._dialogs.findIndex(d => d.id === dialog.id);
            if (dialogIndex > -1) {
                this._dialogs.splice(dialogIndex, 1);
            }

            // Clean up listeners from the dialog itself after it's fully closed
            dialog.removeEventListener("dialog-minimized", handle._handleMinimizedListener);
            dialog.removeEventListener("dialog-opened", handle._handleOpenedListener);
            dialog.removeEventListener("dialog-closed", handle._handleClosedListener);
            // Also remove temporary event handlers stored on the handle
            handle._handleMinimizedListener = null;
            handle._handleOpenedListener = null;
            handle._handleClosedListener = null;
        };

        // Add new listeners
        dialog.addEventListener("dialog-minimized", handle._handleMinimizedListener);
        dialog.addEventListener("dialog-opened", handle._handleOpenedListener);
        dialog.addEventListener("dialog-closed", handle._handleClosedListener);
    }
}

customElements.define('globular-dockbar', Dockbar);

// Create the global dockbar instance and append it to the body
// This is done here to ensure it's a singleton and available globally
export const dockbar = new Dockbar();
if (document.body) {
    document.body.appendChild(dockbar);
} else {
    // Fallback for cases where document.body is not yet ready (e.g., in head)
    document.addEventListener('DOMContentLoaded', () => {
        document.body.appendChild(dockbar);
    });
}