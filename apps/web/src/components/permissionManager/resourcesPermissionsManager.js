import getUuidByString from "uuid-by-string";
import { Backend, displayError } from "../../backend/backend";
import { AccountController } from "../../backend/account"; // Needed for AccountController.getToken
import { Permissions } from "globular-web-client/rbac/rbac_pb"; // Assuming Permissions proto is here

// Import specific resource getters (assuming these are async/promisified)
// Adjust paths as needed for your project structure
import { getApplication } from "../../backend/applications"; // Placeholder
import { getBlog } from "../blogPost/blogPost"; // Placeholder
import { getConversation } from "../conversation/conversation"; // Placeholder
import { getDomain } from "../domain/domain"; // Placeholder
// import { getFile } from "../../backend/file"; // Commented out as in original
import { getGroup } from "../../backend/group"; // Placeholder
import { getOrganization } from "../../backend/organization"; // Placeholder
import { getPackage } from "../package/package"; // Placeholder
import { getRole } from "../role/role"; // Placeholder
import { getWebpage } from "../webpage/webpage"; // Placeholder

/**
 * Manages and displays permissions for various types of resources.
 * It dynamically appends `ResourcesPermissionsType` components for each resource type.
 */
export class ResourcesPermissionsManager extends HTMLElement {
    // Private instance properties
    _listeners = {}; // To store UUIDs for event hub subscriptions for cleanup

    /**
     * Constructor for the ResourcesPermissionsManager custom element.
     * Initializes the shadow DOM and sets up initial event subscriptions.
     */
    constructor() {
        super();
        this.attachShadow({ mode: 'open' });
        // Initial rendering in connectedCallback
    }

    /**
     * Called when the element is inserted into the document's DOM.
     * Performs initial rendering and sets up event subscriptions.
     */
    connectedCallback() {
        this._renderInitialStructure();
        this._setupBackendSubscriptions();
        this._appendAllResourceTypes(); // Append specific resource type managers
    }

    /**
     * Called when the element is removed from the document's DOM.
     * Cleans up event hub subscriptions.
     */
    disconnectedCallback() {
        for (const uuid in this._listeners) {
            Backend.eventHub.unsubscribe(uuid);
        }
        this._listeners = {}; // Clear the listeners map
    }

    /**
     * Renders the initial HTML structure of the manager.
     * @private
     */
    _renderInitialStructure() {
        this.shadowRoot.innerHTML = `
            <style>
                /* Basic container style, more specific styles for children */
                #container {
                    display: flex;
                    flex-direction: column;
                    width: 100%; /* Ensure it takes available width */
                    box-sizing: border-box; /* Include padding/border in width */
                }
            </style>
            <div id="container">
                <slot></slot> </div>
        `;
    }

    /**
     * Sets up subscriptions to backend events for resource permission changes.
     * @private
     */
    _setupBackendSubscriptions() {
        // Event received when permissions were deleted
        Backend.eventHub.subscribe(
            "delete_resources_permissions_event",
            (uuid) => { this._listeners["delete_resources_permissions_event"] = uuid; },
            (evt) => {
                const permissions = Permissions.deserializeBinary(evt); // Assuming Permissions proto
                const typeElement = this.querySelector(`#${permissions.getResourceType()}-permissions`);
                if (typeElement && typeElement.deletePermissions) { // Assuming method exists
                    typeElement.deletePermissions(permissions);
                }
            }, false, this
        );

        // Event received when permissions were set/updated
        Backend.eventHub.subscribe(
            "set_resources_permissions_event",
            (uuid) => { this._listeners["set_resources_permissions_event"] = uuid; },
            (evt) => {
                const permissions = Permissions.deserializeBinary(evt); // Assuming Permissions proto
                const typeElement = this.querySelector(`#${permissions.getResourceType()}-permissions`);
                if (typeElement && typeElement.setPermissions) { // Assuming method exists
                    typeElement.setPermissions(permissions);
                }
            }, false, this
        );
    }

    /**
     * Appends ResourcesPermissionsType components for all supported resource types.
     * @private
     */
    _appendAllResourceTypes() {
        // Map of resource type names to their respective getter functions
        const resourceTypes = [
            { name: "application", getter: getApplication },
            { name: "blog", getter: getBlog },
            { name: "conversation", getter: getConversation },
            { name: "domain", getter: getDomain },
            // { name: "file", getter: getFile }, // Commented out as in original
            { name: "group", getter: getGroup },
            { name: "organization", getter: getOrganization },
            { name: "package", getter: getPackage },
            { name: "role", getter: getRole },
            { name: "webpage", getter: getWebpage }
        ];

        resourceTypes.forEach(type => {
            if (!this.querySelector(`#${type.name}-permissions`)) {
                const resourcePermissionsType = new ResourcesPermissionsType(type.name, type.getter);
                resourcePermissionsType.id = `${type.name}-permissions`;
                this.appendChild(resourcePermissionsType);
            }
        });
    }
}

customElements.define('globular-resources-permissions-manager', ResourcesPermissionsManager);


// --- Refactored ResourcesPermissionsType Class ---

import '@polymer/paper-card/paper-card.js';
import '@polymer/iron-icon/iron-icon.js';
import '@polymer/paper-ripple/paper-ripple.js';
import '@polymer/iron-collapse/iron-collapse.js'; // Needed for iron-collapse

// Assuming GetResourcePermissionsByResourceTypeRqst is defined elsewhere
import { GetResourcePermissionsByResourceTypeRqst } from "globular-web-client/rbac/rbac_pb";

/**
 * Displays a collapsible list of resources for a given type, with their permission status.
 */
export class ResourcesPermissionsType extends HTMLElement {
    // Private instance properties
    _resourceType = null; // The type of resource this instance displays (e.g., "application", "blog")
    _getResourceFn = null; // Function to get a single resource by its path/ID
    _counterSpan = null; // Reference to the counter element
    _hideButton = null; // Reference to the hide/toggle button
    _collapsePanel = null; // Reference to the iron-collapse panel

    /**
     * Constructor for the ResourcesPermissionsType custom element.
     * @param {string} resourceType - The type of resource this component will manage (e.g., "application").
     * @param {Function} getResource - An async function `(path: string) => Promise<Object>` to retrieve a single resource object.
     */
    constructor(resourceType, getResource) {
        super();
        this.attachShadow({ mode: 'open' });
        this._resourceType = resourceType;
        this._getResourceFn = getResource; // Store the getter function
    }

    /**
     * Called when the element is inserted into the document's DOM.
     * Performs initial rendering, gets DOM references, and binds event listeners.
     */
    connectedCallback() {
        this._renderInitialStructure();
        this._getDomReferences();
        this._bindEventListeners();
        this._loadAndDisplayResourcesPermissions(); // Load data initially
    }

    /**
     * Renders the initial HTML structure of the resource type manager.
     * @private
     */
    _renderInitialStructure() {
        this.shadowRoot.innerHTML = `
            <style>
                paper-card {
                    background-color: var(--surface-color);
                    color: var(--primary-text-color);
                    font-size: 1rem;
                    text-align: left;
                    border-radius: 8px; /* Consistent rounded corners */
                    width: 100%;
                    box-shadow: var(--shadow-elevation-2dp); /* Subtle shadow */
                    margin-bottom: 10px; /* Space between cards */
                }

                .card-content {
                    min-width: 728px; /* Desktop min-width */
                    font-size: 1rem;
                    padding: 0px;
                }

                @media (max-width: 800px) {
                    .card-content{ min-width: 580px; }
                }
                @media (max-width: 600px) {
                    .card-content{ min-width: 380px; }
                }

                #container {
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    border-bottom: 1px solid var(--palette-divider); /* Separator between types */
                    padding-bottom: 10px; /* Space above border */
                }
                #container:last-child {
                    border-bottom: none; /* No border for the last type */
                }


                .header {
                    display: flex;
                    align-items: center;
                    width: 100%;
                    padding: 10px; /* Padding for header */
                    background-color: var(--surface-color);
                    transition: background 0.2s ease, filter 0.2s ease; /* Smooth hover */
                    border-bottom: 1px solid var(--palette-divider); /* Separator inside card */
                    border-top-left-radius: 8px; /* Match card radius */
                    border-top-right-radius: 8px;
                }
                .header:hover {
                    background-color: var(--palette-action-hover); /* Light hover background */
                    cursor: pointer;
                }
                .header .title {
                    flex-grow: 1;
                    font-weight: 500;
                    padding-right: 10px; /* Space from counter */
                    text-transform: capitalize; /* Capitalize first letter */
                    color: var(--primary-text-color);
                }
                .header #counter {
                    font-weight: 400;
                    color: var(--secondary-text-color);
                    margin-right: 10px; /* Space from hide button */
                }

                .header paper-icon-button {
                    --iron-icon-fill-color: var(--primary-text-color);
                }
                .header paper-icon-button:hover {
                    color: var(--primary-color);
                }

                #content {
                    display: flex;
                    flex-direction: column;
                    margin: 10px; /* Margin around slotted content */
                }

                iron-collapse {
                    width: 100%;
                }
                iron-collapse .iron-collapse-closed {
                    max-height: 0px;
                    transition: max-height 0s;
                }
                iron-collapse.iron-collapse-opened {
                    max-height: 1000px; /* Sufficiently large to allow content to show */
                    transition: max-height 0.3s ease-in-out;
                }
            </style>

            <div id="container">
                <paper-card>
                    <div class="card-content">
                        <div class="header">
                            <span class="title">
                                ${this._resourceType}
                            </span>
                            <span id="counter">0</span>
                            <paper-icon-button id="hide-btn" icon="unfold-less"></paper-icon-button>
                        </div>
                        <iron-collapse id="collapse-panel" opened>
                            <div id="content">
                                <slot></slot> </div>
                        </iron-collapse>
                    </div>
                </paper-card>
            </div>
        `;
    }

    /**
     * Retrieves references to all necessary DOM elements.
     * @private
     */
    _getDomReferences() {
        this._counterSpan = this.shadowRoot.querySelector("#counter");
        this._hideButton = this.shadowRoot.querySelector("#hide-btn");
        this._collapsePanel = this.shadowRoot.querySelector("#collapse-panel");
    }

    /**
     * Binds event listeners to interactive elements.
     * @private
     */
    _bindEventListeners() {
        if (this._hideButton && this._collapsePanel) {
            this._hideButton.addEventListener('click', this._handleCollapseToggle.bind(this));
            // Bind header click to toggle as well
            const header = this.shadowRoot.querySelector(".header");
            if (header) {
                header.addEventListener('click', this._handleCollapseToggle.bind(this));
            }
        }
    }

    /**
     * Handles the click event for the collapse button, toggling the panel.
     * @private
     */
    _handleCollapseToggle() {
        if (this._collapsePanel && this._hideButton) {
            this._collapsePanel.toggle();
            this._hideButton.icon = this._collapsePanel.opened ? "unfold-less" : "unfold-more";
        }
    }

    /**
     * Fetches permissions for resources of this type and displays them.
     * @private
     */
    async _loadAndDisplayResourcesPermissions() {
        try {
            const permissionsList = await this._getResourcePermissionsByResourceType(this._resourceType);

            // Clear previous resources
            this.innerHTML = "";
            let count = 0;

            for (const p of permissionsList) {
                try {
                    // Get the actual resource object using the provided getter function
                    const resource = await this._getResourceFn(p.getPath());
                    const resourcePermissionsComponent = new ResourcePermissions(resource);
                    resourcePermissionsComponent.id = `_${getUuidByString(p.getPath())}`;
                    this.appendChild(resourcePermissionsComponent);
                    count++;
                } catch (resourceErr) {
                    console.warn(`Failed to get resource for path ${p.getPath()}: ${resourceErr.message}. Attempting to delete permissions.`);
                    // If the resource itself cannot be retrieved, attempt to delete its permissions
                    // This implies a stale permission entry for a non-existent resource.
                    await this._deleteStaleResourcePermissions(p.getPath(), this._resourceType);
                }
            }
            this._updateCounter(count);
        } catch (err) {
            displayError(`Failed to load ${this._resourceType} permissions: ${err.message}`, 3000);
            console.error(err);
            this._updateCounter(0);
        }
    }

    /**
     * Fetches a list of permissions by resource type from the backend.
     * @param {string} resourceType - The type of resource to filter by.
     * @returns {Promise<Array<Object>>} A promise that resolves with an array of Permissions objects.
     * @private
     */
    async _getResourcePermissionsByResourceType(resourceType) {
        const rqst = new GetResourcePermissionsByResourceTypeRqst();
        rqst.setResourcetype(resourceType);
        let permissions = [];

        try {
            // Backend.globular should be available
            // If authentication is required for this streaming call, add token here.
            // const token = await Backend.authenticatedCall(Backend.globular);
            const stream = Backend.globular.rbacService.getResourcePermissionsByResourceType(rqst, {
                domain: Backend.globular.domain,
                // token: token // Uncomment if needed
            });

            return new Promise((resolve, reject) => {
                stream.on("data", (rsp) => {
                    permissions = permissions.concat(rsp.getPermissionsList());
                });
                stream.on("status", (status) => {
                    if (status.code === 0) {
                        resolve(permissions);
                    } else {
                        displayError(`Stream error for ${resourceType} permissions: ${status.details}`, 3000);
                        reject(new Error(status.details));
                    }
                });
                stream.on("error", (err) => {
                    displayError(`Error fetching ${resourceType} permissions: ${err.message}`, 3000);
                    reject(err);
                });
            });
        } catch (err) {
            displayError(`Failed to initiate stream for ${resourceType} permissions: ${err.message}`, 3000);
            throw err;
        }
    }

    /**
     * Updates the counter displayed in the header.
     * @param {number} count - The new count of resources.
     * @private
     */
    _updateCounter(count) {
        if (this._counterSpan) {
            this._counterSpan.textContent = count.toString();
        }
    }

    /**
     * Handles deletion of permissions for a specific resource.
     * This is called when a ResourcePermissions component is deleted internally.
     * @param {Object} permissions - The Permissions object of the deleted resource.
     */
    deletePermissions(permissions) {
        const uuid = `_${getUuidByString(permissions.getPath())}`;
        const resourceComponent = this.querySelector(`#${uuid}`);
        if (resourceComponent && resourceComponent.parentNode) {
            resourceComponent.parentNode.removeChild(resourceComponent);
            this._updateCounter(this.childElementCount); // Update count
        }
    }

    /**
     * Sets or updates permissions for a specific resource, adding it if not present.
     * @param {Object} permissions - The Permissions object to set.
     */
    async setPermissions(permissions) {
        const id = `_${getUuidByString(permissions.getPath())}`;

        try {
            // Try to get the actual resource object
            const resource = await this._getResourceFn(permissions.getPath());

            let resourceComponent = this.querySelector(`#${id}`);
            if (resourceComponent) {
                // If exists, remove and re-add to ensure order/freshness (or just update its internal state)
                resourceComponent.parentNode.removeChild(resourceComponent);
            }
            // Create and append a new one
            resourceComponent = new ResourcePermissions(resource);
            resourceComponent.id = id;
            this.appendChild(resourceComponent);
            this._updateCounter(this.childElementCount);
        } catch (err) {
            displayError(`Failed to update ${permissions.getResourceType()} permission for path ${permissions.getPath()}: ${err.message}. Resource might not exist.`, 3000);
            console.warn(`Resource ${permissions.getPath()} not found for update, attempting to delete stale permissions.`);
            // If resource cannot be found, implies stale entry, delete its permissions from backend.
            await this._deleteStaleResourcePermissions(permissions.getPath(), permissions.getResourceType());
        }
    }

    /**
     * Attempts to delete stale resource permissions from the backend.
     * @param {string} path - The path of the resource.
     * @param {string} resourceType - The type of the resource.
     * @private
     */
    async _deleteStaleResourcePermissions(path, resourceType) {
        try {
            const rqst = new DeleteResourcePermissionsRqst(); // Assuming this proto exists
            rqst.setPath(path);
            rqst.setResourcetype(resourceType); // Set the resource type for deletion

            const globule = Backend.globular;
            const token = await Backend.authenticatedCall(globule); // Authenticate call
            await globule.rbacService.deleteResourcePermissions(rqst, { domain: globule.domain, token: token });
            displayMessage(`Stale permissions for ${resourceType} at ${path} were removed.`, 3000);
            // After successful deletion, the 'delete_resources_permissions_event' should trigger cleanup
        } catch (deleteErr) {
            displayError(`Failed to delete stale permissions for ${resourceType} at ${path}: ${deleteErr.message}`, 3000);
        }
    }
}

customElements.define('globular-resources-permissions-type', ResourcesPermissionsType);


// --- Refactored ResourcePermissions Class ---

// Assuming DeleteResourcePermissionsRqst is defined elsewhere
import { DeleteResourcePermissionsRqst } from "globular-web-client/rbac/rbac_pb";
import { ApplicationInfo } from "../applicationInfo"; // Example of resource info component
import { BlogPostInfo } from "../blogPostInfo";
import { ConversationInfo } from "../conversationInfo";
import { DomainInfo } from "../domainInfo";
import { FileInfo } from "../fileInfo";
import { GroupInfo } from "../groupInfo";
import { OrganizationInfo } from "../organizationInfo";
import { PackageInfo } from "../packageInfo";
import { RoleInfo } from "../roleInfo";
import { WebpageInfo } from "../webpageInfo";
import { TitleInfo } from "./titleInfo"; // Assuming TitleInfo is specific type
import { AudioInfo } from "./audioInfo"; // Assuming AudioInfo is specific type
import { VideoInfo } from "./videoInfo"; // Assuming VideoInfo is specific type


/**
 * Displays information and management tools for a single resource's permissions.
 * Includes buttons to view info, edit permissions, and delete permissions.
 */
export class ResourcePermissions extends HTMLElement {
    // Private instance properties
    _resource = null; // The resource object (e.g., Application, Blog, File)
    _infoTogglePanel = null; // iron-collapse for resource info
    _permissionsTogglePanel = null; // iron-collapse for permissions editor
    _infoButton = null;
    _editButton = null;
    _deleteButton = null;

    /**
     * Constructor for the ResourcePermissions custom element.
     * @param {Object} resource - The resource object to display and manage permissions for.
     */
    constructor(resource) {
        super();
        this.attachShadow({ mode: 'open' });
        this._resource = resource;
    }

    /**
     * Called when the element is inserted into the document's DOM.
     * Performs initial rendering, gets DOM references, and binds event listeners.
     */
    connectedCallback() {
        this._renderInitialStructure();
        this._getDomReferences();
        this._bindEventListeners();
        this._appendResourceInfoComponent(); // Dynamically append resource info
        this._appendPermissionsEditor(); // Dynamically append permissions editor
    }

    /**
     * Renders the initial HTML structure for the single resource's permissions.
     * @private
     */
    _renderInitialStructure() {
        // Assuming getHeaderText() and getInfo() methods exist on the resource object.
        // getInfo() should return an info component instance (e.g., ApplicationInfo, BlogInfo)
        this.shadowRoot.innerHTML = `
            <style>
                #container {
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    border-bottom: 1px solid var(--palette-divider-light); /* Lighter border */
                    padding-bottom: 5px; /* Space above border */
                }
                #container:last-child {
                    border-bottom: none; /* No border for the last resource */
                }

                .header {
                    display: flex;
                    align-items: center;
                    width: 100%;
                    padding: 8px; /* Adjusted padding */
                    background-color: var(--surface-color);
                    transition: background 0.2s ease;
                    border-radius: 4px; /* Slight rounding */
                }
                .header:hover {
                    background-color: var(--palette-action-hover);
                    cursor: pointer;
                }

                .header iron-icon {
                    padding: 5px; /* Padding around icons */
                    color: var(--primary-text-color);
                }
                .header iron-icon:hover {
                    cursor: pointer;
                    color: var(--primary-color);
                }

                .resource-text {
                    flex-grow: 1;
                    padding: 5px;
                    text-overflow: ellipsis;
                    overflow: hidden;
                    white-space: nowrap;
                    max-width: 584px; /* Adjusted max-width based on parent */
                }

                #content {
                    display: flex;
                    flex-direction: column;
                    margin: 10px; /* Margin around content in collapse panels */
                    background-color: var(--surface-color);
                    color: var(--primary-text-color);
                }

                iron-collapse {
                    width: 100%;
                }
                iron-collapse.iron-collapse-closed {
                    max-height: 0px;
                    transition: max-height 0s;
                }
                iron-collapse.iron-collapse-opened {
                    max-height: 1000px; /* Sufficiently large */
                    transition: max-height 0.3s ease-in-out;
                }
            </style>
            <div id="container">
                <div class="header">
                    <paper-icon-button id="info-btn" icon="icons:info"></paper-icon-button>
                    <span class="resource-text">${this._resource.getHeaderText()}</span>
                    <paper-icon-button id="edit-btn" icon="editor:mode-edit"></paper-icon-button>
                    <paper-icon-button id="delete-btn" icon="icons:delete"></paper-icon-button>
                </div>
                <iron-collapse id="info-collapse-panel">
                    <div id="content">
                        <slot name="resource-info"></slot>
                    </div>
                </iron-collapse>
                <iron-collapse id="permissions-editor-collapse-panel">
                    <div id="content">
                        <slot name="resource-permissions-editor"></slot>
                    </div>
                </iron-collapse>
            </div>
        `;
    }

    /**
     * Retrieves references to all necessary DOM elements.
     * @private
     */
    _getDomReferences() {
        this._infoTogglePanel = this.shadowRoot.querySelector("#info-collapse-panel");
        this._permissionsTogglePanel = this.shadowRoot.querySelector("#permissions-editor-collapse-panel");
        this._infoButton = this.shadowRoot.querySelector("#info-btn");
        this._editButton = this.shadowRoot.querySelector("#edit-btn");
        this._deleteButton = this.shadowRoot.querySelector("#delete-btn");
    }

    /**
     * Binds event listeners to interactive elements.
     * @private
     */
    _bindEventListeners() {
        if (this._infoButton && this._infoTogglePanel) {
            this._infoButton.addEventListener('click', this._handleInfoToggleClick.bind(this));
        }
        if (this._editButton && this._permissionsTogglePanel) {
            this._editButton.addEventListener('click', this._handlePermissionsEditorToggleClick.bind(this));
        }
        if (this._deleteButton) {
            this._deleteButton.addEventListener('click', this._handleDeleteClick.bind(this));
        }
    }

    /**
     * Dynamically appends the appropriate resource info component (e.g., ApplicationInfo).
     * @private
     */
    _appendResourceInfoComponent() {
        if (!this._resource) return;

        let infoComponent = null;
        // The original code uses resource.getInfo() which should return an info component instance.
        // Assuming resource.getInfo() returns a newly constructed info component or null.
        const resourceInfoInstance = this._resource.getInfo(); // Get instance from resource object

        if (resourceInfoInstance) {
            resourceInfoInstance.slot = "resource-info"; // Assign to slot
            // Set data property on the info component (e.g., resourceInfoInstance.application = this._resource)
            // This is done via setters based on type
            if (this._resource.hasOwnProperty('getAlias')) { // Heuristic for ApplicationInfo
                resourceInfoInstance.application = this._resource;
            } else if (this._resource.hasOwnProperty('getCreationTime')) { // Heuristic for ConversationInfo
                resourceInfoInstance.conversation = this._resource;
            } else if (this._resource.hasOwnProperty('getDomain')) { // Heuristic for DomainInfo / OrganizationInfo / PeerInfo
                if (this._resource.hasOwnProperty('getName') && this._resource.hasOwnProperty('getGroupsList')) { // Organization
                    resourceInfoInstance.organization = this._resource;
                } else if (this._resource.hasOwnProperty('getHostname')) { // Peer
                    resourceInfoInstance.peer = this._resource; // Assuming PeerInfo class exists and takes .peer
                } else { // Domain
                    resourceInfoInstance.domain = this._resource;
                }
            } else if (this._resource.hasOwnProperty('getKeywordsList') && this._resource.hasOwnProperty('getType')) { // PackageInfo
                resourceInfoInstance.descriptor = this._resource;
            } else if (this._resource.hasOwnProperty('getName') && this._resource.hasOwnProperty('getMembersList')) { // GroupInfo / RoleInfo
                if (this._resource.hasOwnProperty('getRolesList')) { // Organization has getRolesList, but context is group
                    resourceInfoInstance.group = this._resource;
                } else if (this._resource.hasOwnProperty('getId')) { // RoleInfo
                    resourceInfoInstance.role = this._resource;
                } else { // Fallback for GroupInfo
                    resourceInfoInstance.group = this._resource;
                }
            } else if (this._resource.hasOwnProperty('thumbnail')) { // WebpageInfo
                resourceInfoInstance.webpage = this._resource;
            } else if (this._resource.hasOwnProperty('getPoster')) { // VideoInfo / AudioInfo / TitleInfo
                if (this._resource.hasOwnProperty('getDescription') && this._resource.hasOwnProperty('getCastingList')) { // VideoInfo
                    resourceInfoInstance.video = this._resource;
                } else if (this._resource.hasOwnProperty('getTitle')) { // AudioInfo
                    resourceInfoInstance.audio = this._resource;
                } else { // TitleInfo
                    resourceInfoInstance.title = this._resource;
                }
            } else if (this._resource.hasOwnProperty('getMime')) { // FileInfo
                resourceInfoInstance.file = this._resource;
            } else if (this._resource.hasOwnProperty('getUuid') && this._resource.hasOwnProperty('getSubtitle')) { // BlogPostInfo
                resourceInfoInstance.blogPost = this._resource;
            }

            this.appendChild(resourceInfoInstance);
        } else {
            console.warn("ResourcePermissions: No info component returned by resource.getInfo() for:", this._resource);
        }
    }

    /**
     * Dynamically appends the PermissionsManager for editing this resource's permissions.
     * @private
     */
    _appendPermissionsEditor() {
        if (!this._resource) return;

        const permissionManager = new PermissionsManager();
        permissionManager.hideHeader(); // Hide header if integrated
        permissionManager.slot = "resource-permissions-editor"; // Assign to slot
        this.appendChild(permissionManager);
        permissionManager.setPath(this._resource.getPath()); // Set the resource path
        permissionManager.setResourceType(this._resource.getResourceType()); // Set specific resource type
        permissionManager.globule = this._resource.globule; // Pass globule
    }

    /**
     * Toggles the visibility of the resource info collapse panel.
     * @private
     */
    _handleInfoToggleClick() {
        if (this._infoTogglePanel) {
            this._infoTogglePanel.toggle();
        }
    }

    /**
     * Toggles the visibility of the permissions editor collapse panel.
     * @private
     */
    _handlePermissionsEditorToggleClick() {
        if (this._permissionsTogglePanel) {
            this._permissionsTogglePanel.toggle();
        }
    }

    /**
     * Handles the click event for the delete button.
     * Displays a confirmation dialog and then deletes resource permissions.
     * @private
     */
    _handleDeleteClick() {
        if (!this._resource || !this._resource.getPath || !this._resource.getResourceType) {
            displayError("Resource information incomplete for deletion.", 3000);
            return;
        }

        const resourcePath = this._resource.getPath();
        const resourceType = this._resource.getResourceType(); // Assuming getResourceType exists on resource
        const resourceHeaderText = this._resource.getHeaderText(); // Assuming getHeaderText exists on resource

        const toast = displayMessage(`
            <style>
                #delete-permission-dialog { display: flex; flex-direction: column; align-items: center; }
                #delete-permission-dialog .dialog-actions { display: flex; justify-content: flex-end; gap: 10px; width: 100%; margin-top: 20px; }
            </style>
            <div id="delete-permission-dialog">
                <div>You're about to delete permission for resource:</div>
                <div><strong>${resourceHeaderText}</strong></div>
                <div>Is that what you want to do? </div>
                <div class="dialog-actions">
                    <paper-button id="delete-permission-cancel-btn">Cancel</paper-button>
                    <paper-button id="delete-permission-ok-btn">Ok</paper-button>
                </div>
            </div>
            `, 60 * 1000); // 60 seconds timeout

        const cancelBtn = toast.toastElement.querySelector("#delete-permission-cancel-btn");
        const okBtn = toast.toastElement.querySelector("#delete-permission-ok-btn");

        cancelBtn.addEventListener('click', () => toast.hideToast());
        okBtn.addEventListener('click', async () => {
            toast.hideToast();
            try {
                const rqst = new DeleteResourcePermissionsRqst();
                rqst.setPath(resourcePath);
                rqst.setResourcetype(resourceType); // Set the resource type for deletion

                const globule = Backend.globular; // Assuming Backend.globular is the active globule
                const token = await Backend.authenticatedCall(globule); // Authenticate call
                await globule.rbacService.deleteResourcePermissions(rqst, { domain: globule.domain, token: token });

                displayMessage("Permission was removed successfully!", 3000);
                // Publish event so parent ResourcesPermissionsType can update its list
                Backend.eventHub.publish("delete_resources_permissions_event", Permissions.fromBinary(rqst.serializeBinary()), false); // Send full permissions object if possible, or path/type
                // Removing this component from its parent is handled by the ResourcesPermissionsType listener
            } catch (err) {
                displayError(`Failed to delete permission: ${err.message}`, 3000);
            }
        });
    }
}

customElements.define('globular-resource-permissions', ResourcePermissions);