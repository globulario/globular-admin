import { Backend, displayError, displayMessage } from "../../backend/backend"; // Use Backend.authenticatedCall
import { AccountController } from "../../backend/account"; // For AccountController.getToken
import { GetResourcePermissionsRqst, Permission, Permissions, SetResourcePermissionsRqst } from "globular-web-client/rbac/rbac_pb"; // Assuming protos are here
import { PermissionPanel } from "./permissionPanel.js"; // Assuming this is a custom element
import { PermissionsViewer } from "./permissionsViewer.js"; // Assuming this is a custom element

// Polymer Component Imports
import '@polymer/paper-icon-button/paper-icon-button.js';
import '@polymer/iron-collapse/iron-collapse.js';
import '@polymer/iron-icon/iron-icon.js';
import '@polymer/paper-ripple/paper-ripple.js';
import '@polymer/paper-radio-group/paper-radio-group.js'; // Needed for add permission dialog
import '@polymer/paper-radio-button/paper-radio-button.js'; // Needed for add permission dialog
import '@polymer/paper-card/paper-card.js'; // Needed for add permission dialog panel

/**
 * Manages and displays resource permissions (owners, allowed, denied).
 * Provides an interface to view, add, and modify permissions.
 */
export class PermissionsManager extends HTMLElement {
    // Private instance properties
    _globule = null; // The active globule instance
    _permissions = null; // The active permissions object (from backend)
    _path = ""; // The resource path for which permissions are displayed
    _permissionsNames = ["read", "write", "delete"]; // List of possible permission names
    _savePermissionListenerUuid = null; // UUID for event hub subscription (if any)

    _onclose = null; // Callback for when the manager is closed

    // DOM element references
    _container = null;
    _pathDiv = null;
    _closeButton = null;
    _ownersCollapseBtn = null;
    _ownersCollapsePanel = null;
    _allowedCollapseBtn = null;
    _allowedCollapsePanel = null;
    _deniedCollapseBtn = null;
    _deniedCollapsePanel = null;
    _addDeniedBtn = null;
    _addAllowedBtn = null;
    _permissionsViewer = null; // Instance of PermissionsViewer

    /**
     * Constructor for the PermissionsManager custom element.
     * Initializes the shadow DOM.
     */
    constructor() {
        super();
        this.attachShadow({ mode: 'open' });
        // Globule will be set via setter
    }

    /**
     * Called when the element is inserted into the document's DOM.
     * Performs initial rendering, gets DOM references, and binds event listeners.
     */
    connectedCallback() {
        this._renderInitialStructure();
        this._getDomReferences();
        this._bindEventListeners();
        // Initial permission fetching will be triggered by setPath
    }

    /**
     * Called when the element is removed from the document's DOM.
     * Cleans up event hub subscriptions.
     */
    disconnectedCallback() {
        if (this._savePermissionListenerUuid) {
            // Backend.eventHub.unsubscribe(this._savePermissionListenerUuid); // Assuming subscribe returns UUID
            // If using Backend.eventHub.subscribe(..., context) then unsubscription by context handles it.
        }
    }

    /**
     * Sets the globule instance for the manager.
     * @param {Object} globule - The globule instance.
     */
    set globule(globule) {
        this._globule = globule;
    }

    /**
     * Sets the path of the resource for which to manage permissions.
     * Triggers fetching and displaying permissions for the new path.
     * @param {string} path - The resource path.
     */
    set path(path) {
        if (this._path !== path) {
            this._path = path;
            this._fetchAndSetPermissions(path);
        }
    }

    /**
     * Sets the initial permissions object to display.
     * This is useful if permissions are already fetched by a parent component.
     * @param {Object} permissions - The Permissions object from the backend.
     */
    set permissions(permissions) {
        this._permissions = permissions;
        this._renderPermissionsContent(); // Render content based on provided permissions
    }

    /**
     * Sets the resource type for the permissions object.
     * @param {string} resourceType - The type of resource (e.g., "file", "audio_info").
     */
    set resourceType(resourceType) {
        if (this._permissions) {
            this._permissions.setResourceType(resourceType);
        }
    }

    /**
     * Sets the onclose callback.
     * @param {Function | null} callback - The callback function.
     */
    set onclose(callback) {
        this._onclose = callback;
    }

    /**
     * Renders the initial HTML structure of the permissions manager.
     * @private
     */
    _renderInitialStructure() {
        this.shadowRoot.innerHTML = `
            <style>
                #container {
                    display: flex;
                    flex-direction: column;
                    padding: 8px;
                    background-color: var(--surface-color);
                    color: var(--primary-text-color);
                    user-select: none;
                    max-height: calc(100vh - 80px); /* Limit height for scrollability */
                    overflow-y: auto;
                }

                #header {
                    display: flex;
                    align-items: center;
                    padding-bottom: 10px;
                    border-bottom: 2px solid var(--palette-divider);
                    margin-bottom: 10px;
                }

                .title {
                    display: flex;
                    align-items: center;
                    flex-grow: 1;
                    font-weight: 500;
                    color: var(--primary-text-color);
                    line-height: 20px;
                }

                .title iron-icon {
                    margin-right: 8px; /* Space between icon and text */
                    --iron-icon-fill-color: var(--primary-text-color);
                }

                .permissions-section {
                    padding-right: 40px; /* Consistent right padding for all sections */
                }

                .permissions-section .title {
                    margin-top: 15px; /* Space between sections */
                }

                iron-collapse {
                    padding: 10px;
                    border-bottom: 1px solid var(--palette-action-disabled); /* Lighter border for collapse content */
                    /* border-top removed as header has it */
                }
                iron-collapse:last-of-type {
                    border-bottom: none; /* No border on last collapse section */
                }

                paper-icon-button {
                    color: var(--primary-text-color);
                }
                paper-icon-button:hover {
                    cursor: pointer;
                    color: var(--primary-color);
                }

                /* Style for the "Add Permission" dialog that pops up */
                #add-permission-panel {
                    position: absolute;
                    right: 20px;
                    top: 50px; /* Position relative to the button that opens it */
                    z-index: 100;
                    background-color: var(--surface-color);
                    color: var(--primary-text-color);
                    box-shadow: var(--shadow-elevation-4dp);
                    border-radius: 8px;
                    overflow: hidden;
                    padding: 10px;
                    display: flex;
                    flex-direction: column;
                    min-width: 200px;
                }
                #add-permission-panel .panel-header {
                    display: flex;
                    align-items: center;
                    padding-bottom: 5px;
                    border-bottom: 1px solid var(--palette-divider);
                    margin-bottom: 10px;
                }
                #add-permission-panel .panel-header > div {
                    flex-grow: 1;
                    font-weight: 500;
                }
                #add-permission-panel paper-radio-group {
                    display: flex;
                    flex-direction: column;
                    gap: 8px;
                    padding: 5px 0;
                }
                #add-permission-panel paper-radio-button {
                    --paper-radio-button-checked-color: var(--primary-color);
                    --paper-radio-button-label-color: var(--primary-text-color);
                    --paper-radio-button-size: 16px;
                }
            </style>
            <div id="container">
                <div id="header">
                    <div id="path" class="title"></div>
                    <paper-icon-button id="close-button" icon="icons:close"></paper-icon-button>
                </div>
                <slot name="permission-viewer"></slot>

                <div class="permissions-section">
                    <div class="title">
                        <paper-icon-button id="owner-collapse-btn" icon="unfold-less"></paper-icon-button>
                        Owner(s)
                    </div>
                    <iron-collapse id="owner" opened>
                        <slot name="owner"></slot>
                    </iron-collapse>
                </div>

                <div class="permissions-section">
                    <div class="title">
                        <paper-icon-button id="allowed-collapse-btn" icon="unfold-less"></paper-icon-button>
                        Allowed(s)
                    </div>
                    <paper-icon-button id="add-allowed-btn" icon="icons:add"></paper-icon-button>
                    <iron-collapse id="allowed" opened>
                        <slot name="allowed"></slot>
                    </iron-collapse>
                </div>

                <div class="permissions-section">
                    <div class="title">
                        <paper-icon-button id="denied-collapse-btn" icon="unfold-less"></paper-icon-button>
                        Denied(s)
                    </div>
                    <paper-icon-button id="add-denied-btn" icon="icons:add"></paper-icon-button>
                    <iron-collapse id="denied" opened>
                        <slot name="denied"></slot>
                    </iron-collapse>
                </div>
            </div>
        `;
    }

    /**
     * Retrieves references to all necessary DOM elements.
     * @private
     */
    _getDomReferences() {
        this._container = this.shadowRoot.querySelector("#container");
        this._pathDiv = this.shadowRoot.querySelector("#path");
        this._closeButton = this.shadowRoot.querySelector("#close-button");

        // Collapse sections and their buttons
        this._ownersCollapsePanel = this.shadowRoot.querySelector("#owner");
        this._ownersCollapseBtn = this.shadowRoot.querySelector("#owner-collapse-btn");

        this._allowedCollapsePanel = this.shadowRoot.querySelector("#allowed");
        this._allowedCollapseBtn = this.shadowRoot.querySelector("#allowed-collapse-btn");
        this._addAllowedBtn = this.shadowRoot.querySelector("#add-allowed-btn");

        this._deniedCollapsePanel = this.shadowRoot.querySelector("#denied");
        this._deniedCollapseBtn = this.shadowRoot.querySelector("#denied-collapse-btn");
        this._addDeniedBtn = this.shadowRoot.querySelector("#add-denied-btn");
    }

    /**
     * Binds event listeners to interactive elements.
     * @private
     */
    _bindEventListeners() {
        if (this._closeButton) {
            this._closeButton.addEventListener('click', this._handleCloseClick.bind(this));
        }

        // Collapse toggle buttons
        this._ownersCollapseBtn.addEventListener('click', this._handleCollapseToggle.bind(this, this._ownersCollapsePanel, this._ownersCollapseBtn));
        this._allowedCollapseBtn.addEventListener('click', this._handleCollapseToggle.bind(this, this._allowedCollapsePanel, this._allowedCollapseBtn));
        this._deniedCollapseBtn.addEventListener('click', this._handleCollapseToggle.bind(this, this._deniedCollapsePanel, this._deniedCollapseBtn));

        // Add permission buttons
        this._addDeniedBtn.addEventListener('click', this._handleAddPermissionClick.bind(this, this._addDeniedBtn, "denied"));
        this._addAllowedBtn.addEventListener('click', this._handleAddPermissionClick.bind(this, this._addAllowedBtn, "allowed"));
    }

    /**
     * Handles the click event for the close button.
     * @private
     */
    _handleCloseClick() {
        if (this.onclose) {
            this.onclose();
        }
        if (this.parentNode) {
            this.parentNode.removeChild(this);
        }
    }

    /**
     * Toggles the visibility of a collapse panel and updates its icon.
     * @param {HTMLElement} panel - The iron-collapse panel.
     * @param {HTMLElement} button - The paper-icon-button (unfold-less/more).
     * @private
     */
    _handleCollapseToggle(panel, button) {
        if (!panel || !button) return;
        panel.toggle();
        button.icon = panel.opened ? "unfold-less" : "unfold-more";
    }

    /**
     * Handles the click event for adding a new permission.
     * Displays a dialog with radio buttons for available permission names.
     * @param {HTMLElement} parentButton - The button that triggered the action (for positioning).
     * @param {string} type - The type of permission to add ('allowed' or 'denied').
     * @private
     */
    _handleAddPermissionClick(parentButton, type) {
        const dialogId = "add-permission-panel";
        let dialog = parentButton.parentNode.querySelector(`#${dialogId}`);

        // Prevent multiple dialogs
        if (dialog) {
            return;
        }

        const html = `
            <paper-card id="${dialogId}">
                <div class="panel-header">
                    <div>Add Permission</div>
                    <paper-icon-button id="cancel-btn" icon="icons:close"></paper-icon-button>
                </div>
                <div class="card-content">
                    <paper-radio-group id="permission-radio-group">
                        </paper-radio-group>
                </div>
            </paper-card>
        `;

        // Append dialog relative to the parent button
        parentButton.parentNode.appendChild(document.createRange().createContextualFragment(html));
        dialog = parentButton.parentNode.querySelector(`#${dialogId}`);
        dialog.style.top = `${parentButton.offsetTop + parentButton.offsetHeight}px`; // Position below button
        dialog.style.right = "20px"; // Position from right

        const radioGroup = dialog.querySelector("#permission-radio-group");
        const cancelBtn = dialog.querySelector("#cancel-btn");

        // Populate radio buttons from available permission names
        this._permissionsNames.sort().forEach(pName => {
            const radioBtn = document.createElement("paper-radio-button");
            radioBtn.name = pName;
            radioBtn.value = pName; // Use value attribute for consistency
            radioBtn.textContent = pName; // Use textContent for plain text
            radioGroup.appendChild(radioBtn);
        });

        // Event listener for radio button selection
        radioGroup.addEventListener('iron-select', (evt) => {
            const selectedPermissionName = evt.detail.item.value;
            this._createPermission(selectedPermissionName, type);
            // Close dialog after selection
            if (dialog.parentNode) dialog.parentNode.removeChild(dialog);
        });

        // Close dialog on cancel button click
        cancelBtn.addEventListener('click', () => {
            if (dialog.parentNode) dialog.parentNode.removeChild(dialog);
        });
    }

    /**
     * Creates and appends a new PermissionPanel to the appropriate section.
     * @param {string} name - The name of the permission (e.g., "read", "write").
     * @param {string} type - The type of permission section ('allowed' or 'denied').
     * @private
     */
    _createPermission(name, type) {
        // Check if the permission already exists in the current list
        const targetList = type === "allowed" ? this._permissions.getAllowedList() : this._permissions.getDeniedList();
        if (targetList.some(p => p.getName() === name)) {
            displayMessage(`Permission "${name}" already exists in ${type} list.`, 3000);
            return;
        }

        const panelId = `permission_${name}_${type}_panel`;
        const panel = new PermissionPanel(this); // Pass PermissionsManager as parent context
        panel.setAttribute("id", panelId);

        const permission = new Permission();
        permission.setName(name);
        panel.setPermission(permission); // Set the new permission object on the panel

        // Add to the main permissions object and set slot
        if (type === "allowed") {
            this._permissions.getAllowedList().push(permission);
            panel.slot = "allowed";
            this._allowedCollapsePanel.appendChild(panel); // Append to correct collapse panel
            if (!this._allowedCollapsePanel.opened) {
                this._allowedCollapsePanel.toggle(); // Open panel if new permission added
            }
        } else if (type === "denied") {
            this._permissions.getDeniedList().push(permission);
            panel.slot = "denied";
            this._deniedCollapsePanel.appendChild(panel);
            if (!this._deniedCollapsePanel.opened) {
                this._deniedCollapsePanel.toggle();
            }
        }
        // Save changes to backend immediately after adding a new permission
        this._savePermissions();
    }

    /**
     * Saves the current permissions configuration to the backend.
     * @param {Function} [callback] - Optional callback on success.
     */
    async _savePermissions(callback = null) {
        if (!this._permissions || !this._globule) {
            displayError("Permissions object or globule not available to save.", 3000);
            if (callback) callback();
            return;
        }

        const rqst = new SetResourcePermissionsRqst();
        rqst.setPermissions(this._permissions); // The updated permissions object
        rqst.setPath(this._path); // The resource path

        // Ensure resource type is set (default to "file" if not specified)
        if (!this._permissions.getResourceType()) {
            this._permissions.setResourceType("file");
        }
        rqst.setResourcetype(this._permissions.getResourceType());

        try {
            const token = await Backend.authenticatedCall(this._globule); // Authenticate call
            await this._globule.rbacService.setResourcePermissions(rqst, {
                token: token,
                domain: this._globule.domain
            });
            displaySuccess("Permissions saved successfully!", 3000);
            this._fetchAndSetPermissions(this._path); // Reload to reflect changes from backend
            // Backend.publish(AccountController.account.getId() + "_change_permission_event", {}, false); // Optional: global event for permission change
            if (callback) {
                callback();
            }
        } catch (err) {
            displayError(`Failed to save permissions: ${err.message}`, 3000);
            console.error("Permissions save error:", err);
            // Optionally, reload permissions from backend to revert unsaved changes
            this._fetchAndSetPermissions(this._path);
        }
    }

    /**
     * Fetches the current permissions for the given path from the backend and displays them.
     * @param {string} path - The resource path.
     * @private
     */
    async _fetchAndSetPermissions(path) {
        if (!this._globule || !path) {
            console.warn("PermissionsManager: Globule or path not set for fetching permissions.");
            return;
        }

        this.pathDiv.textContent = path; // Update displayed path header

        const rqst = new GetResourcePermissionsRqst();
        rqst.setPath(path);

        try {
            // No token needed for GetResourcePermissionsRqst if it's generally public or implicitly authenticated
            // If authentication is required for this specific call, uncomment token auth.
            // const token = await Backend.authenticatedCall(this._globule);
            const rsp = await this._globule.rbacService.getResourcePermissions(rqst, { /* token: token, */ domain: this._globule.domain });
            this._permissions = rsp.getPermissions();
        } catch (err) {
            // If an error occurs (e.g., resource not found, no permissions),
            // initialize with default empty permissions.
            console.warn(`Failed to get permissions for ${path}: ${err.message}. Initializing with default.`, err);
            this._permissions = new Permissions();
            this._permissions.setPath(path);
            this._permissions.setOwners(new Permission().setName("owner")); // Default owner permission
        } finally {
            this._renderPermissionsContent(); // Always render even if fetching fails (with defaults)
            if (this._permissions && this._permissions.getResourceType()) {
                // Keep the resource type from existing permissions if any
                this.setResourceType(this._permissions.getResourceType());
            }
        }
    }

    /**
     * Renders the fetched permissions into the UI (owners, allowed, denied lists).
     * @private
     */
    _renderPermissionsContent() {
        if (!this._permissions) {
            // Fallback if permissions object is still null after fetch/init
            this._permissions = new Permissions();
            this._permissions.setOwners(new Permission().setName("owner"));
        }

        // Clear existing slotted content
        this.innerHTML = ""; // This clears <slot> content in light DOM

        // Add PermissionsViewer
        if (!this._permissionsViewer) {
            this._permissionsViewer = new PermissionsViewer(this._permissionsNames.concat("owner")); // Pass all permission names
        }
        this._permissionsViewer.slot = "permission-viewer";
        this._permissionsViewer.setPermissions(this._permissions);
        this._permissionsViewer.permissionManager = this; // Pass manager reference for interactions
        this.appendChild(this._permissionsViewer);

        // Render Owners
        const ownersPermissionPanel = new PermissionPanel(this);
        ownersPermissionPanel.id = "permission_owners_panel";
        ownersPermissionPanel.setPermission(this._permissions.getOwners(), true); // true for isOwnerPanel
        ownersPermissionPanel.slot = "owner";
        this.appendChild(ownersPermissionPanel);

        // Render Allowed permissions
        this._permissions.getAllowedList().forEach(p => {
            const panel = new PermissionPanel(this);
            panel.id = `permission_${p.getName()}_allowed_panel`;
            panel.slot = "allowed";
            panel.setPermission(p);
            this.appendChild(panel);
        });

        // Render Denied permissions
        this._permissions.getDeniedList().forEach(p => {
            const panel = new PermissionPanel(this);
            panel.id = `permission_${p.getName()}_denied_panel`;
            panel.slot = "denied";
            panel.setPermission(p);
            this.appendChild(panel);
        });
    }

    /**
     * Sets the resource type. This is typically called by a parent component.
     * @param {string} resourceType - The type of resource (e.g., "file", "audio_info").
     */
    setResourceType(resourceType) {
        if (this._permissions) {
            this._permissions.setResourceType(resourceType);
        }
    }

    /**
     * Hides the header of the permissions manager.
     */
    hideHeader() {
        const header = this.shadowRoot.querySelector("#header");
        if (header) header.style.display = "none";
    }

    /**
     * Shows the header of the permissions manager.
     */
    showHeader() {
        const header = this.shadowRoot.querySelector("#header");
        if (header) header.style.display = "flex"; // Default display for header
    }
}

customElements.define('globular-permissions-manager', PermissionsManager);