import getUuidByString from "uuid-by-string";
import { Permission } from "globular-web-client/rbac/rbac_pb"; // Assuming Permission proto is here
import { Account, Group } from "globular-web-client/resource/resource_pb"; // Assuming Account and Group protos are here

// Polymer/Custom Element imports
import '@polymer/iron-icon/iron-icon.js'; // Needed for iron-icon
import '@polymer/paper-icon-button/paper-icon-button.js'; // Needed for paper-icon-button
import '@polymer/iron-icons/iron-icons.js'; // For icons:check, icons:remove, icons:block
import '@polymer/iron-icons/social-icons.js'; // For social:people icon (for groups)

/**
 * Displays and allows setting read, write, and delete permissions for a list of subjects (accounts/groups).
 */
export class SharedSubjectsPermissions extends HTMLElement {
    // Private instance properties
    _accounts = []; // List of Account objects
    _groups = []; // List of Group objects
    // _applications = []; // Not used in original, keeping consistent with original
    // _organizations = []; // Not used in original, keeping consistent with original

    _permissionsTable = null; // Reference to the main permissions table div

    /**
     * Constructor for the SharedSubjectsPermissions custom element.
     * Initializes the shadow DOM.
     */
    constructor() {
        super();
        this.attachShadow({ mode: 'open' });
        // Initial rendering in connectedCallback
    }

    /**
     * Called when the element is inserted into the document's DOM.
     * Performs initial rendering.
     */
    connectedCallback() {
        this._renderInitialStructure();
        this._getDomReferences();
        // Data will be populated by setAccounts/setGroups and then refresh()
    }

    /**
     * Renders the initial HTML structure of the permissions table.
     * @private
     */
    _renderInitialStructure() {
        this.shadowRoot.innerHTML = `
            <style>
                #container {
                    display: flex;
                    flex-direction: column;
                    width: 100%; /* Take full width of parent */
                    box-sizing: border-box; /* Include padding/border in width */
                    color: var(--primary-text-color); /* Inherit text color */
                }

                .title {
                    font-size: 1.2rem;
                    font-weight: 500; /* Bolder title */
                    color: var(--primary-text-color); /* Primary text color for title */
                    padding-bottom: 10px; /* Space below title */
                    margin-bottom: 10px; /* Space before table */
                    border-bottom: 1px solid var(--palette-divider); /* Separator below title */
                }

                #permissions {
                    display: table; /* Use table display for consistent columns */
                    width: 100%;
                    border-collapse: collapse; /* Collapse borders for cleaner look */
                }

                #permissions-header {
                    display: table-row;
                    font-size: 1.0rem;
                    font-weight: 500; /* Bolder header */
                    color: var(--secondary-text-color); /* Muted color for header */
                    border-bottom: 2px solid var(--palette-divider); /* Stronger separator below header */
                    background-color: var(--palette-background-dark); /* Subtle background for header */
                }

                #permissions-header div {
                    display: table-cell;
                    padding: 8px 5px; /* Padding for header cells */
                    text-align: center; /* Center header text */
                    vertical-align: middle;
                }
                #permissions-header .subject-header-cell {
                    text-align: left; /* Align subject header left */
                }


                .subject-permissions-row {
                    display: table-row;
                    border-bottom: 1px solid var(--palette-divider-light); /* Lighter separator between rows */
                }
                .subject-permissions-row:last-child {
                    border-bottom: none; /* No border for the last row */
                }

                .cell {
                    display: table-cell;
                    vertical-align: middle;
                    padding: 8px 5px; /* Padding for data cells */
                }

                .cell iron-icon {
                    fill: var(--primary-color); /* Primary color for icons */
                    width: 24px; /* Larger icons */
                    height: 24px;
                }
                .cell iron-icon:hover {
                    cursor: pointer;
                }

                .infos {
                    display: flex;
                    align-items: center;
                    padding: 4px; /* Padding inside subject info div */
                    border-radius: 4px;
                    background-color: var(--surface-color); /* Subject info background */
                    color: var(--primary-text-color);
                    transition: background 0.2s ease;
                }
                .infos:hover {
                    background-color: var(--palette-action-hover); /* Hover effect for subject info */
                }

                .infos img {
                    width: 32px;
                    height: 32px;
                    border-radius: 50%;
                    object-fit: cover;
                    margin-right: 8px; /* Space between icon/image and text */
                }
                .infos iron-icon { /* Icon for group/default account */
                    width: 32px;
                    height: 32px;
                    margin-right: 8px;
                    --iron-icon-fill-color: var(--palette-action-disabled); /* Muted default icon */
                }

                .infos span {
                    font-size: 1rem;
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis; /* Truncate long names */
                    flex-grow: 1; /* Allow name to fill space */
                }
            </style>
            <div id="container">
                <div class="title">Set subject's permissions...</div>
                <div id="permissions">
                    <div id="permissions-header">
                        <div class="subject-header-cell">Subject</div>
                        <div class="permission-header-cell">Read</div>
                        <div class="permission-header-cell">Write</div>
                        <div class="permission-header-cell">Delete</div>
                    </div>
                </div>
            </div>
        `;
    }

    /**
     * Retrieves references to all necessary DOM elements.
     * @private
     */
    _getDomReferences() {
        this._permissionsTable = this.shadowRoot.querySelector("#permissions");
    }

    /**
     * Sets the list of accounts to display permissions for.
     * Triggers a refresh of the table.
     * @param {Array<Object>} accounts - An array of Account objects.
     */
    setAccounts(accounts) {
        this._accounts = accounts || []; // Ensure it's an array
        this.refresh();
    }

    /**
     * Sets the list of groups to display permissions for.
     * Triggers a refresh of the table.
     * @param {Array<Object>} groups - An array of Group objects.
     */
    setGroups(groups) {
        this._groups = groups || []; // Ensure it's an array
        this.refresh();
    }

    /**
     * Refreshes the display of the permissions table with current accounts and groups.
     */
    refresh() {
        // Remove all rows except the header
        this.shadowRoot.querySelectorAll(".subject-permissions-row").forEach(row => row.remove());

        // Process and display accounts
        this._accounts.forEach(account => {
            this._setSubjectRow(account);
        });

        // Process and display groups
        this._groups.forEach(group => {
            this._setSubjectRow(group);
        });
    }

    /**
     * Creates and appends a subject row to the permissions table.
     * This method handles both Account and Group objects.
     * @param {Object} subject - The Account or Group object.
     * @private
     */
    _setSubjectRow(subject) {
        const uuid = `_subject_row_${getUuidByString(subject.getId() + "@" + subject.getDomain())}`;
        let row = this.shadowRoot.querySelector(`#${uuid}`);

        if (!row) {
            row = document.createElement("div");
            row.id = uuid;
            row.className = "subject-permissions-row";
            row.subject = subject; // Store subject object on the row for easy access

            // Create subject info cell
            const subjectInfoCell = document.createElement("div");
            subjectInfoCell.className = "cell";
            const subjectInfoDiv = this._createSubjectInfoDiv(subject);
            subjectInfoCell.appendChild(subjectInfoDiv);
            row.appendChild(subjectInfoCell);

            // Create permission cells for Read, Write, Delete
            ['read', 'write', 'delete'].forEach(permName => {
                const iconId = `${uuid}_${permName}`;
                const permCell = this._createPermissionCell(iconId, permName, subject);
                row.appendChild(permCell);
            });
            this._permissionsTable.appendChild(row);
        } else {
            // If row exists, just update its display (e.g., if re-adding after hidden)
            row.style.display = "table-row";
        }
    }

    /**
     * Creates the inner div displaying subject's icon/image and name.
     * @param {Object} subject - The Account or Group object.
     * @returns {HTMLElement} The subject info div.
     * @private
     */
    _createSubjectInfoDiv(subject) {
        const infoDiv = document.createElement("div");
        infoDiv.className = "infos";

        let imgElement = null;
        let iconElement = null;

        if (subject instanceof Account) {
            if (subject.getProfilepicture() && subject.getProfilepicture().length > 0) {
                imgElement = document.createElement("img");
                imgElement.src = subject.getProfilepicture();
                imgElement.alt = "Profile Picture";
            } else {
                iconElement = document.createElement("iron-icon");
                iconElement.icon = "account-circle";
            }
        } else if (subject instanceof Group) {
            iconElement = document.createElement("iron-icon");
            iconElement.icon = "social:people";
        }

        if (imgElement) infoDiv.appendChild(imgElement);
        if (iconElement) infoDiv.appendChild(iconElement);

        const nameSpan = document.createElement("span");
        nameSpan.textContent = subject.getName() || subject.getId(); // Default to ID if no name
        if (subject instanceof Account && subject.getFirstname() && subject.getLastname()) {
            nameSpan.textContent = `${subject.getFirstname()} ${subject.getLastname()}`;
        }
        infoDiv.appendChild(nameSpan);

        return infoDiv;
    }

    /**
     * Creates a single permission cell with its icon and click logic.
     * @param {string} iconId - The ID for the iron-icon.
     * @param {string} permName - The name of the permission (e.g., 'read').
     * @param {Object} subject - The Account or Group object.
     * @returns {HTMLElement} The permission cell.
     * @private
     */
    _createPermissionCell(iconId, permName, subject) {
        const cell = document.createElement("div");
        cell.className = "cell";
        cell.style.textAlign = "center"; // Center icon in cell

        const icon = document.createElement("iron-icon");
        icon.id = iconId;
        icon.classList.add("permission-icon");
        icon.name = permName; // Store permission name for click handler

        // Set initial icon based on subject's current permission state (not directly available here, but implied)
        // This will be handled by a parent component setting the actual Permissions object
        // For now, default to 'remove' (no permission)
        icon.icon = "icons:remove";

        // Bind click handler for toggling
        icon.addEventListener('click', this._handlePermissionIconClick.bind(this, icon, permName, subject));

        cell.appendChild(icon);
        return cell;
    }

    /**
     * Handles the click event on a permission icon, toggling its state.
     * The state cycles: 'none' (remove) -> 'check' (allowed) -> 'block' (denied) -> 'remove'.
     * Updates the icon and calls `getPermissions` on parent to save.
     * @param {HTMLElement} iconElement - The icon element clicked.
     * @param {string} permName - The name of the permission (read, write, delete).
     * @param {Object} subject - The Account or Group object for this row.
     * @private
     */
    _handlePermissionIconClick(iconElement, permName, subject) {
        let currentIcon = iconElement.icon;
        let nextIcon;

        // Cycle through states: remove (none) -> check (allowed) -> block (denied)
        if (currentIcon === "icons:remove") {
            nextIcon = "icons:check";
        } else if (currentIcon === "icons:check") {
            nextIcon = "icons:block";
        } else { // currentIcon === "icons:block"
            nextIcon = "icons:remove";
        }
        iconElement.icon = nextIcon; // Update icon

        // Trigger a save:
        // This relies on the parent `PermissionsManager` to read the state using `getPermissions()`
        // and then call `savePermissions()`.
        if (this.permissionManager && this.permissionManager.savePermissions) {
            this.permissionManager.savePermissions();
        } else {
            console.warn("PermissionManager instance not available or savePermissions method missing.");
        }
    }


    /**
     * Reads the current UI state of permissions and constructs a Permissions object.
     * This method is called by the parent PermissionsManager to get the updated state.
     * @returns {Object} An object containing 'allowed' and 'denied' permission lists.
     */
    getPermissions() {
        const permissions = { allowed: [], denied: [] };

        // Helper to get or create a Permission object for a specific name
        const getOrCreatePerm = (list, name) => {
            let perm = list.find(p => p.getName() === name);
            if (!perm) {
                perm = new Permission();
                perm.setName(name);
                // Initialize all lists for the new permission
                perm.setAccountsList([]);
                perm.setGroupsList([]);
                // Add other types if necessary: setApplicationsList, setOrganizationsList, setPeersList
            }
            return perm;
        };

        const allowedRead = getOrCreatePerm(permissions.allowed, "read");
        const allowedWrite = getOrCreatePerm(permissions.allowed, "write");
        const allowedDelete = getOrCreatePerm(permissions.allowed, "delete");
        const deniedRead = getOrCreatePerm(permissions.denied, "read");
        const deniedWrite = getOrCreatePerm(permissions.denied, "write");
        const deniedDelete = getOrCreatePerm(permissions.denied, "delete");

        this.shadowRoot.querySelectorAll(".subject-permissions-row").forEach(row => {
            const subject = row.subject; // The stored subject object (Account or Group)
            const icons = row.querySelectorAll(".permission-icon"); // [read_icon, write_icon, delete_icon]

            const accountId = (subject instanceof Account) ? `${subject.getId()}@${subject.getDomain()}` : null;
            const groupId = (subject instanceof Group) ? `${subject.getId()}@${subject.getDomain()}` : null;

            // Read permission
            if (icons[0].icon === "icons:check") { // Allowed
                if (accountId) allowedRead.getAccountsList().push(accountId);
                else if (groupId) allowedRead.getGroupsList().push(groupId);
            } else if (icons[0].icon === "icons:block") { // Denied
                if (accountId) deniedRead.getAccountsList().push(accountId);
                else if (groupId) deniedRead.getGroupsList().push(groupId);
            }

            // Write permission
            if (icons[1].icon === "icons:check") { // Allowed
                if (accountId) allowedWrite.getAccountsList().push(accountId);
                else if (groupId) allowedWrite.getGroupsList().push(groupId);
            } else if (icons[1].icon === "icons:block") { // Denied
                if (accountId) deniedWrite.getAccountsList().push(accountId);
                else if (groupId) deniedWrite.getGroupsList().push(groupId);
            }

            // Delete permission
            if (icons[2].icon === "icons:check") { // Allowed
                if (accountId) allowedDelete.getAccountsList().push(accountId);
                else if (groupId) allowedDelete.getGroupsList().push(groupId);
            } else if (icons[2].icon === "icons:block") { // Denied
                if (accountId) deniedDelete.getAccountsList().push(accountId);
                else if (groupId) deniedDelete.getGroupsList().push(groupId);
            }
        });

        // Filter out permission objects that have no subjects assigned
        permissions.allowed = permissions.allowed.filter(p => p.getAccountsList().length > 0 || p.getGroupsList().length > 0);
        permissions.denied = permissions.denied.filter(p => p.getAccountsList().length > 0 || p.getGroupsList().length > 0);

        return permissions;
    }

    /**
     * Sets the displayed permissions based on a Permissions object.
     * This method is used by PermissionsManager to initialize or update the view.
     * @param {Object} permissions - The Permissions object (containing owner, allowed, denied lists).
     */
    setPermissions(permissions) {
        // Clear all existing subject rows first
        this.shadowRoot.querySelectorAll(".subject-permissions-row").forEach(row => row.remove());

        // Process owner permissions
        const ownerPerm = permissions.getOwners();
        if (ownerPerm) {
            this._addSubjectRowsForPermission(ownerPerm, 'owner');
        }

        // Process allowed permissions
        permissions.getAllowedList().forEach(perm => {
            this._addSubjectRowsForPermission(perm, 'allowed');
        });

        // Process denied permissions
        permissions.getDeniedList().forEach(perm => {
            this._addSubjectRowsForPermission(perm, 'denied');
        });

        // After populating, ensure the icons reflect the correct state.
        this._updatePermissionIconsFromData(permissions);
    }

    /**
     * Helper to add subject rows based on a specific permission object (e.g., a "read" permission).
     * @param {Object} permission - The Permission object (e.g., owner, allowed, denied permission).
     * @param {string} permissionType - The type of permission ('owner', 'allowed', 'denied').
     * @private
     */
    async _addSubjectRowsForPermission(permission, permissionType) {
        // Helper to retrieve and create subject div
        const createAndAppendSubjectRow = async (id, type) => {
            let subject = null;
            try {
                if (type === "account") subject = await promisifiedGetAccount(id);
                else if (type === "group") subject = await promisifiedGetGroup(id, this._permissionManager.globule);
                // Add other types (application, organization, peer) as needed
                else {
                    console.warn(`Unsupported subject type "${type}" in _addSubjectRowsForPermission.`);
                    return null;
                }
            } catch (err) {
                console.error(`Failed to get details for ${type} ${id}: ${err.message}`);
                displayError(`Failed to load details for ${type} ${id}.`, 3000);
                return null;
            }

            if (subject) {
                // Check if row for this subject already exists
                const existingRowId = `_subject_row_${getUuidByString(subject.getId() + "@" + subject.getDomain())}`;
                let row = this.shadowRoot.querySelector(`#${existingRowId}`);

                if (!row) {
                    row = document.createElement("div");
                    row.id = existingRowId;
                    row.className = "subject-permissions-row";
                    row.subject = subject; // Store subject on row

                    const subjectInfoCell = document.createElement("div");
                    subjectInfoCell.className = "cell subject-info-cell";
                    const subjectInfoDiv = this._createSubjectInfoDiv(subject);
                    subjectInfoCell.appendChild(subjectInfoDiv);
                    row.appendChild(subjectInfoCell);

                    // Add empty permission cells for icons
                    ['read', 'write', 'delete'].forEach(permName => { // Ensure owner has these too
                        if (permissionType === 'owner') { // Owners also have implicit read/write/delete
                            const iconId = `${existingRowId}_${permName}`;
                            const permCell = this._createPermissionCell(iconId, permName, subject);
                            row.appendChild(permCell);
                        } else {
                            const iconId = `${existingRowId}_${permName}`;
                            const permCell = this._createPermissionCell(iconId, permName, subject);
                            row.appendChild(permCell);
                        }
                    });
                    this._permissionsTable.appendChild(row);
                }
                return row; // Return the row element (new or existing)
            }
            return null;
        };

        // Add accounts
        for (const id of permission.getAccountsList()) {
            await createAndAppendSubjectRow(id, "account");
        }
        // Add groups
        for (const id of permission.getGroupsList()) {
            await createAndAppendSubjectRow(id, "group");
        }
        // Add applications (if permissions supports them)
        if (permission.getApplicationsList) {
             for (const id of permission.getApplicationsList()) {
                await createAndAppendSubjectRow(id, "application");
            }
        }
        // Add organizations (if permissions supports them)
        if (permission.getOrganizationsList) {
            for (const id of permission.getOrganizationsList()) {
                await createAndAppendSubjectRow(id, "organization");
            }
        }
        // Add peers (if permissions supports them)
        if (permission.getPeersList) {
            for (const id of permission.getPeersList()) {
                await createAndAppendSubjectRow(id, "peer");
            }
        }
    }


    /**
     * Updates the permission icons in the table based on the given Permissions object.
     * This is called after `setPermissions` to reflect the data correctly.
     * @param {Object} permissions - The Permissions object.
     * @private
     */
    _updatePermissionIconsFromData(permissions) {
        this.shadowRoot.querySelectorAll(".subject-permissions-row").forEach(row => {
            const subject = row.subject;
            const icons = row.querySelectorAll(".permission-icon"); // Read, Write, Delete icons

            const getPermissionStatus = (permName) => {
                // Check owner first (highest precedence)
                const ownerPerm = permissions.getOwners();
                if (ownerPerm) {
                    if (ownerPerm.getAccountsList().includes(subject.id) ||
                        ownerPerm.getGroupsList().includes(subject.id) ||
                        (subject.getDomain && (ownerPerm.getAccountsList().includes(`${subject.id}@${subject.getDomain()}`) || ownerPerm.getGroupsList().includes(`${subject.id}@${subject.getDomain()}`)))
                    ) {
                        return "owner"; // Implicitly allowed for all permissions if owner
                    }
                }

                // Check denied permissions
                const deniedPerm = permissions.getDeniedList().find(p => p.getName() === permName);
                if (deniedPerm) {
                    if (deniedPerm.getAccountsList().includes(subject.id) ||
                        deniedPerm.getGroupsList().includes(subject.id) ||
                        (subject.getDomain && (deniedPerm.getAccountsList().includes(`${subject.id}@${subject.getDomain()}`) || deniedPerm.getGroupsList().includes(`${subject.id}@${subject.getDomain()}`)))
                    ) {
                        return "denied";
                    }
                }

                // Check allowed permissions
                const allowedPerm = permissions.getAllowedList().find(p => p.getName() === permName);
                if (allowedPerm) {
                    if (allowedPerm.getAccountsList().includes(subject.id) ||
                        allowedPerm.getGroupsList().includes(subject.id) ||
                        (subject.getDomain && (allowedPerm.getAccountsList().includes(`${subject.id}@${subject.getDomain()}`) || allowedPerm.getGroupsList().includes(`${subject.id}@${subject.getDomain()}`)))
                    ) {
                        return "allowed";
                    }
                }
                return "none"; // Neither allowed nor denied
            };

            // Update icon for each permission type
            icons.forEach(icon => {
                const permName = icon.name; // Get permission name from icon's 'name' attribute
                const status = getPermissionStatus(permName);

                if (status === "allowed" || status === "owner") {
                    icon.icon = "icons:check";
                } else if (status === "denied") {
                    icon.icon = "av:not-interested";
                } else {
                    icon.icon = "icons:remove";
                }
            });
        });
    }
}

customElements.define('globular-shared-subjects-permissions', SharedSubjectsPermissions)