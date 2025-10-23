import { randomUUID } from "../utility"; // Assuming randomUUID is available
import { OrganizationController } from "../../backend/organization"; // Assuming promisified getAllOrganizations
import { AccountController } from "../../backend/account"; // Assuming promisified getAccounts
import { GroupController } from "../../backend/group.ts"; // Assuming promisified getGroups
import { ApplicationController } from "../../backend/applications.ts"; // Assuming promisified getAllApplicationInfo
import { PeerController } from "../../backend/peer.ts"; // Assuming promisified getPeers

import { Backend, displayError } from "../../backend/backend.ts"; // Assuming Backend.Backend.authenticatedCall if needed by getAccount, getGroups etc.

// Polymer/Custom Element imports
import '@polymer/iron-collapse/iron-collapse.js';
import '@polymer/paper-icon-button/paper-icon-button.js';
import '@polymer/iron-icon/iron-icon.js'; // For iron-icon
import '@polymer/paper-ripple/paper-ripple.js'; // For paper-ripple
import '@polymer/paper-card/paper-card.js'; // For paper-card in searchables

// Import all specific SearchableList types
import { SearchableGroupList, SearchableAccountList, SearchableApplicationList, SearchablePeerList, SearchableOrganizationList } from "./list.js";

/**
 * Represents a panel for managing specific types of permissions (e.g., allowed, denied, owners).
 * It contains collapsible sections for different entity types (accounts, groups, etc.).
 */
export class PermissionPanel extends HTMLElement {
    // Private instance properties
    _permissionManager = null; // Reference to the parent PermissionsManager
    _permission = null; // The specific Permission object (e.g., owner, allowed, denied)
    _hideTitle = false; // Flag to hide the panel's main title

    // DOM element references
    _panelTitleDiv = null; // Div for the main permission name (e.g., "read", "write")
    _membersContainer = null; // Container for collapsible member lists

    // Collapse section references (filled dynamically)
    // _collapsibleSections = {}; // Could store references to allow dynamic toggling


    /**
     * Constructor for the PermissionPanel custom element.
     * @param {Object} permissionManager - The parent PermissionsManager instance.
     */
    constructor(permissionManager) {
        super();
        this.attachShadow({ mode: 'open' });
        this._permissionManager = permissionManager;

        // Initial rendering of the basic structure
        this._renderInitialStructure();
        this._getDomReferences(); // Get references after rendering
    }

    /**
     * Called when the element is inserted into the document's DOM.
     * This is where component-specific setup and data population should occur.
     */
    connectedCallback() {
        // Data population is triggered by the setPermission setter
    }

    /**
     * Renders the initial HTML structure of the permission panel.
     * @private
     */
    _renderInitialStructure() {
        this.shadowRoot.innerHTML = `
            <style>
                .title {
                    flex-grow: 1;
                    font-size: 1.2rem;
                    font-weight: 500;
                    color: var(--primary-text-color); /* Primary text color for titles */
                    border-color: var(--palette-divider);
                    padding-bottom: 5px; /* Space below title */
                    margin-bottom: 5px; /* Space before members */
                }

                .members {
                    display: flex;
                    flex-direction: column;
                    width: 100%; /* Ensure members take full width */
                }

                /* Styles for collapsible sections */
                .collapsible-section {
                    padding-left: 10px;
                    width: 100%;
                    box-sizing: border-box; /* Include padding in width */
                }

                .collapsible-header {
                    display: flex;
                    align-items: center;
                    padding: 5px 0; /* Vertical padding */
                    cursor: pointer;
                }

                .collapsible-header iron-icon {
                    margin-right: 8px; /* Space between icon and text */
                    --iron-icon-fill-color: var(--primary-text-color);
                }

                .collapsible-header span {
                    flex-grow: 1;
                    font-weight: 400; /* Regular weight for sub-titles */
                    font-size: 1rem;
                }

                iron-collapse {
                    margin: 5px; /* Margin around collapse content */
                }
            </style>
            <div>
                <div class="title"></div>
                <div class="members"></div>
            </div>
        `;
    }

    /**
     * Retrieves references to all necessary DOM elements.
     * @private
     */
    _getDomReferences() {
        this._panelTitleDiv = this.shadowRoot.querySelector(".title");
        this._membersContainer = this.shadowRoot.querySelector(".members");
    }

    /**
     * Sets the permission object and populates the panel with entity lists.
     * @param {Object} permission - The specific Permission object (e.g., an owner permission, or an allowed/denied permission).
     * @param {boolean} [hideTitle=false] - If true, the panel's main title (permission name) will be hidden.
     */
    setPermission(permission, hideTitle = false) {
        this._permission = permission;
        this._hideTitle = hideTitle;

        if (this._hideTitle) {
            this._panelTitleDiv.style.display = "none";
        } else {
            this._panelTitleDiv.style.display = ""; // Default display
            this._panelTitleDiv.textContent = permission.getName();
        }

        // Clear existing members
        this._membersContainer.innerHTML = "";

        // Populate members for each entity type
        this._setEntitiesPermissions("Accounts", this._permission.getAccountsList(), this._permission.setAccountsList, SearchableAccountList, this._permissionManager.globule, this._permission.getId);
        this._setEntitiesPermissions("Groups", this._permission.getGroupsList(), this._permission.setGroupsList, SearchableGroupList, this._permissionManager.globule, this._permission.getId);
        this._setEntitiesPermissions("Applications", this._permission.getApplicationsList(), this._permission.setApplicationsList, SearchableApplicationList, this._permissionManager.globule, this._permission.getId);
        this._setEntitiesPermissions("Organizations", this._permission.getOrganizationsList(), this._permission.setOrganizationsList, SearchableOrganizationList, this._permissionManager.globule, this._permission.getId);
        this._setEntitiesPermissions("Peers", this._permission.getPeersList(), this._permission.setPeersList, SearchablePeerList, this._permissionManager.globule, this._permission.getId);
    }

    /**
     * Creates a collapsible section for a list of entities.
     * @param {string} title - The title of the collapsible section (e.g., "Accounts").
     * @returns {HTMLElement} The iron-collapse element for the section content.
     * @private
     */
    _createCollapsibleSection(title) {
        const uuid = `_collapsible_${randomUUID()}`;
        const html = `
            <div class="collapsible-section">
                <div class="collapsible-header">
                    <paper-icon-button id="${uuid}-btn" icon="unfold-less"></paper-icon-button>
                    <span>${title}</span>
                </div>
                <iron-collapse id="${uuid}-collapse-panel" opened>
                    </iron-collapse>
            </div>
        `;
        this._membersContainer.appendChild(document.createRange().createContextualFragment(html));

        const contentPanel = this.shadowRoot.querySelector(`#${uuid}-collapse-panel`);
        const toggleButton = this.shadowRoot.querySelector(`#${uuid}-btn`);

        if (toggleButton && contentPanel) {
            toggleButton.addEventListener('click', () => {
                contentPanel.toggle();
                toggleButton.icon = contentPanel.opened ? "unfold-less" : "unfold-more";
            });
        }
        return contentPanel;
    }

    /**
     * Generic method to set permissions for a type of entity (Accounts, Groups, etc.).
     * Fetches all available entities, filters them, and populates a SearchableList.
     * @param {string} title - The title for the collapsible section (e.g., "Accounts").
     * @param {Array<string>} entityIdsInPermission - List of entity IDs currently in this permission.
     * @param {Function} permissionListSetter - Setter method on `_permission` (e.g., `_permission.setAccountsList`).
     * @param {Class} SearchableListClass - The constructor for the specific SearchableList (e.g., `SearchableAccountList`).
     * @param {Object} globule - The globule instance from `_permissionManager`.
     * @param {Function} idGetterForRemove - Function to get ID from entity for remove, (e.g., `(item) => item.getId()`, or `(item) => item.getMac()` for peers).
     * @private
     */
    async _setEntitiesPermissions(title, entityIdsInPermission, permissionListSetter, SearchableListClass, globule, idGetterForRemove) {
        const contentPanel = this._createCollapsibleSection(title);
        const listContainer = document.createElement('div'); // Create a div for the searchable list
        contentPanel.appendChild(listContainer); // Append to the collapse panel

        try {
            // Fetch all entities based on the type
            let allEntities;
            if (SearchableListClass === SearchableAccountList) allEntities = await promisifiedGetAllAccounts();
            else if (SearchableListClass === SearchableGroupList) allEntities = await promisifiedGetAllGroups(globule);
            else if (SearchableListClass === SearchableApplicationList) allEntities = await promisifiedGetAllApplications(globule);
            else if (SearchableListClass === SearchableOrganizationList) allEntities = await promisifiedGetAllOrganizations(globule);
            else if (SearchableListClass === SearchablePeerList) allEntities = await promisifiedGetAllPeers(globule);
            else throw new Error(`Unknown SearchableListClass: ${SearchableListClass.name}`);

            // Filter out full entity objects for those currently in this permission
            const currentListItems = allEntities.filter(entity =>
                entityIdsInPermission.includes(idGetterForRemove(entity)) ||
                entityIdsInPermission.includes(`${idGetterForRemove(entity)}@${entity.getDomain()}`) // Handle fully qualified IDs
            );

            // Initialize the specific SearchableList
            const searchableList = new SearchableListClass(
                title, // Title for the SearchableList
                currentListItems, // List of items already in this permission
                (itemToRemove) => { // ondeleteitem callback
                    const idToRemove = idGetterForRemove(itemToRemove);
                    // Remove from permission's internal list
                    let updatedList = entityIdsInPermission.filter(id =>
                        id !== idToRemove && id !== `${idToRemove}@${itemToRemove.getDomain()}`
                    );
                    permissionListSetter.call(this._permission, updatedList); // Use call to ensure 'this' context
                    this._permissionManager.savePermissions(); // Save changes to backend
                },
                (itemToAdd) => { // onadditem callback
                    const idToAdd = idGetterForRemove(itemToAdd);
                    let updatedList = [...entityIdsInPermission]; // Clone current list
                    // Add only if not already present
                    if (!updatedList.includes(idToAdd) && !updatedList.includes(`${idToAdd}@${itemToAdd.getDomain()}`)) {
                        updatedList.push(`${idToAdd}@${itemToAdd.getDomain()}`); // Always store fully qualified ID
                    }
                    permissionListSetter.call(this._permission, updatedList); // Update permission's internal list
                    this._permissionManager.savePermissions(); // Save changes to backend
                }
            );

            searchableList.hideTitle(); // Hide the redundant title of the inner list
            listContainer.appendChild(searchableList); // Append the SearchableList to its container
        } catch (err) {
            displayError(`Failed to load ${title} permissions: ${err.message}`, 3000);
            console.error(err);
            listContainer.innerHTML = `<p style="color: var(--palette-error-main);">Failed to load ${title}.</p>`;
        }
    }
}

customElements.define('globular-permission-panel', PermissionPanel);