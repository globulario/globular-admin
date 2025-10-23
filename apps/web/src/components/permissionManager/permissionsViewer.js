import { Permission, Permissions } from "globular-web-client/rbac/rbac_pb"; // Assuming Permissions and Permission protos are here
import { AccountController } from "../../backend/account"; // Assuming getAccount is promisified
import { ApplicationController } from "../../backend/applications"; // Assuming getApplicationInfo is promisified
import { GroupController } from "../../backend/group"; // Assuming getGroup is promisified
import { OrganizationController } from "../../backend/organization"; // Assuming getOrganizationById is promisified
import { PeerController } from "../../backend/peer"; // Assuming getPeerById is promisified

// Polymer/Custom Element imports
import '@polymer/iron-icon/iron-icon.js'; // For iron-icon
import '@polymer/iron-icons/social-icons.js'; // For social:people, social:domain
import '@polymer/iron-icons/hardware-icons.js'; // For hardware:computer
import '@polymer/iron-icons/iron-icons.js'; // For generic icons like close, add, delete, archive

/**
 * Displays a tabular view of resource permissions (read, write, delete, owner) for various subjects.
 * Allows interactive toggling of permissions for each subject.
 */
export class PermissionsViewer extends HTMLElement {
    // Private instance properties
    _permissionsNames = []; // The list of permission names to display (e.g., ["read", "write", "delete", "owner"])
    _permissions = null; // The Permissions object received from PermissionsManager
    _subjects = {}; // Internal map of subjects (account, group, etc.) with their resolved details and permissions state
    _permissionManager = null; // Reference to the parent PermissionsManager for saving changes

    // DOM element references
    _subjectsDiv = null;
    _permissionsDiv = null;
    _permissionsHeader = null;

    /**
     * Constructor for the PermissionsViewer custom element.
     * @param {Array<string>} permissionsNames - An array of permission names (e.g., ["read", "write", "delete", "owner"]).
     */
    constructor(permissionsNames) {
        super();
        this.attachShadow({ mode: 'open' });
        this._permissionsNames = permissionsNames;
        // DOM setup and population in connectedCallback or setter
    }

    /**
     * Called when the element is inserted into the document's DOM.
     * Performs initial rendering and gets DOM references.
     */
    connectedCallback() {
        this._renderInitialStructure();
        this._getDomReferences();
        // Initial permission display will be triggered by setPermissions setter.
    }

    /**
     * Sets the main Permissions object to be viewed and managed.
     * This method triggers the rendering of the entire permissions table.
     * @param {Object} permissions - The Permissions object (from rbac_pb.js).
     */
    setPermissions(permissions) {
        if (this._permissions !== permissions) {
            this._permissions = permissions;
            this._processPermissionsData();
            this._renderPermissionsTable();
        }
    }

    /**
     * Sets the reference to the parent PermissionsManager.
     * This is needed for calling savePermissions on the manager.
     * @param {HTMLElement} manager - The PermissionsManager instance.
     */
    set permissionManager(manager) {
        this._permissionManager = manager;
    }

    /**
     * Renders the initial HTML structure, including the table headers.
     * @private
     */
    _renderInitialStructure() {
        // Headers are dynamically generated in _renderPermissionsTable
        this.shadowRoot.innerHTML = `
            <style>
                #subjects-div {
                    vertical-align: middle;
                    text-align: center; /* This div appears unused in the updated structure */
                }

                #permissions-div {
                    display: table;
                    width: 100%;
                    border-collapse: collapse; /* Collapse borders for cleaner look */
                    font-size: 0.95rem; /* Slightly smaller font for table content */
                }

                #permissions-header {
                    display: table-row;
                    font-size: 1.0rem;
                    font-weight: 500; /* Bolder header */
                    color: var(--primary-text-color); /* Primary text color */
                    border-bottom: 2px solid var(--palette-divider);
                    background-color: var(--palette-background-dark); /* Subtle background for header */
                }

                #permissions-header div {
                    display: table-cell;
                    padding: 8px 5px; /* Padding for header cells */
                    text-align: center;
                    vertical-align: middle;
                }

                .subject-cell {
                    display: table-cell;
                    padding: 5px;
                    text-align: left; /* Align subject text left */
                    vertical-align: middle;
                    max-width: 250px; /* Constrain width for subject display */
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                }

                .permission-cell {
                    text-align: center;
                    vertical-align: middle;
                    padding: 5px;
                    display: table-cell;
                }

                .permission-cell iron-icon {
                    width: 24px; /* Larger icons */
                    height: 24px;
                    color: var(--secondary-text-color); /* Default icon color */
                }

                .permission-cell iron-icon:hover {
                    cursor: pointer;
                    color: var(--primary-color); /* Highlight on hover */
                }

                /* Specific icon colors for clarity */
                .permission-cell iron-icon[icon="icons:check"] { color: var(--palette-success-main); }
                .permission-cell iron-icon[icon="av:not-interested"] { color: var(--palette-error-main); }
                .permission-cell iron-icon[icon="icons:remove"] { color: var(--secondary-text-color); }

                .permission-row {
                    display: table-row;
                    border-bottom: 1px solid var(--palette-divider-light); /* Lighter row separator */
                }
                .permission-row:last-child {
                    border-bottom: none;
                }
            </style>

            <div>
                <div id="subjects-div"></div>

                <div id="permissions-div">
                    <div id="permissions-header">
                        <div class="subject-cell">Subject</div>
                        ${this._permissionsNames.map(name => `<div class="permission-cell">${name}</div>`).join('')}
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
        this._subjectsDiv = this.shadowRoot.querySelector("#subjects-div");
        this._permissionsDiv = this.shadowRoot.querySelector("#permissions-div");
        this._permissionsHeader = this.shadowRoot.querySelector("#permissions-header");
    }

    /**
     * Processes the raw Permissions object into a flattened, display-ready `_subjects` map.
     * This map will contain all unique subjects and their permission states.
     * @private
     */
    _processPermissionsData() {
        this._subjects = {}; // Reset subjects map

        // Helper to add/update a subject in the _subjects map
        const addSubject = (id, type, permissionName, permissionStatus) => {
            const subjectKey = `${id}_${type}`; // Unique key for subject
            if (!this._subjects[subjectKey]) {
                this._subjects[subjectKey] = {
                    id: id,
                    type: type,
                    permissions: {} // Store status for each permission name
                };
            }
            this._subjects[subjectKey].permissions[permissionName] = permissionStatus;
        };

        // Process Owners
        const ownerPerm = this._permissions.getOwners();
        if (ownerPerm) {
            ownerPerm.getAccountsList().forEach(id => addSubject(id, "account", "owner", "allowed"));
            ownerPerm.getGroupsList().forEach(id => addSubject(id, "group", "owner", "allowed"));
            ownerPerm.getApplicationsList().forEach(id => addSubject(id, "application", "owner", "allowed"));
            ownerPerm.getOrganizationsList().forEach(id => addSubject(id, "organization", "owner", "allowed"));
            ownerPerm.getPeersList().forEach(id => addSubject(id, "peer", "owner", "allowed"));
        }

        // Process Allowed permissions
        this._permissions.getAllowedList().forEach(perm => {
            const permName = perm.getName();
            perm.getAccountsList().forEach(id => addSubject(id, "account", permName, "allowed"));
            perm.getGroupsList().forEach(id => addSubject(id, "group", permName, "allowed"));
            perm.getApplicationsList().forEach(id => addSubject(id, "application", permName, "allowed"));
            perm.getOrganizationsList().forEach(id => addSubject(id, "organization", permName, "allowed"));
            perm.getPeersList().forEach(id => addSubject(id, "peer", permName, "allowed"));
        });

        // Process Denied permissions
        this._permissions.getDeniedList().forEach(perm => {
            const permName = perm.getName();
            perm.getAccountsList().forEach(id => addSubject(id, "account", permName, "denied"));
            perm.getGroupsList().forEach(id => addSubject(id, "group", permName, "denied"));
            perm.getApplicationsList().forEach(id => addSubject(id, "application", permName, "denied"));
            perm.getOrganizationsList().forEach(id => addSubject(id, "organization", permName, "denied"));
            perm.getPeersList().forEach(id => addSubject(id, "peer", permName, "denied"));
        });
    }

    /**
     * Renders the permissions table based on the processed `_subjects` data.
     * @private
     */
    async _renderPermissionsTable() {
        // Clear previous rows, but keep the header
        this.shadowRoot.querySelectorAll('.permission-row').forEach(row => row.remove());

        const subjectPromises = Object.values(this._subjects).map(async (subject) => {
            let resolvedSubjectDiv = null;
            // Resolve subject details (e.g., get full account/group object for display)
            try {
                if (subject.type === "account") {
                    const account = await new Promise((resolve, reject) => { // Promisify getAccount
                        AccountController.getAccount(subject.id, resolve, reject, this._permissionManager.globule);
                    });
                    resolvedSubjectDiv = this._createAccountDiv(account);
                } else if (subject.type === "application") {
                    const application = await new Promise((resolve, reject) => { // Promisify getApplicationInfo
                        ApplicationController.getApplicationInfo(subject.id, resolve, reject, this._permissionManager.globule);
                    });
                    resolvedSubjectDiv = this._createApplicationDiv(application);
                } else if (subject.type === "group") {
                    const group = await new Promise((resolve, reject) => { // Promisify getGroup
                        GroupController.getGroup(subject.id, resolve, reject, this._permissionManager.globule);
                    });
                    resolvedSubjectDiv = this._createGroupDiv(group);
                } else if (subject.type === "organization") {
                    const organization = await new Promise((resolve, reject) => { // Promisify getOrganizationById
                        OrganizationController.getOrganizationById(subject.id, resolve, reject, this._permissionManager.globule);
                    });
                    resolvedSubjectDiv = this._createOrganizationDiv(organization);
                } else if (subject.type === "peer") {
                    const peer = await new Promise((resolve, reject) => { // Promisify getPeerById
                        PeerController.getPeerById(subject.id, resolve, reject, this._permissionManager.globule);
                    });
                    resolvedSubjectDiv = this._createPeerDiv(peer);
                } else {
                    // Fallback for unknown type
                    resolvedSubjectDiv = this._createGenericSubjectDiv(`Unknown: ${subject.id}`, `Type: ${subject.type}`, "icons:help");
                }
            } catch (e) {
                console.error(`Failed to load details for ${subject.type} ${subject.id}:`, e);
                resolvedSubjectDiv = this._createGenericSubjectDiv(`Error: ${subject.id}`, `Type: ${subject.type}`, "icons:error");
            }
            return { element: resolvedSubjectDiv, subject: subject };
        });

        // Wait for all subjects to be resolved
        const resolvedSubjects = await Promise.all(subjectPromises);

        // Append rows to the table
        resolvedSubjects.forEach(({ element: subjectDivElement, subject }) => {
            const row = document.createElement("div");
            row.className = "permission-row";

            const subjectCell = document.createElement("div");
            subjectCell.className = "subject-cell";
            subjectCell.appendChild(subjectDivElement); // Append the resolved subject's div
            row.appendChild(subjectCell);

            // Add permission cells for each permission name
            this._permissionsNames.forEach(permName => {
                const status = subject.permissions[permName]; // 'allowed', 'denied', or undefined
                const cell = this._createPermissionCell(status, permName, subject);
                row.appendChild(cell);
            });
            this._permissionsDiv.appendChild(row);
        });
    }

    /**
     * Creates a generic display div for a subject in the table.
     * @param {string} uuid - Unique ID for the div.
     * @param {string} mainText - Primary text to display.
     * @param {string} [subText=""] - Optional secondary text.
     * @param {string} [iconUrl=""] - URL for an image icon.
     * @param {string} [iconName="account-circle"] - Iron-icon name if no image URL.
     * @returns {HTMLElement} The created div element.
     * @private
     */
    _createGenericSubjectDiv(mainText, subText = "", iconUrl = "", iconName = "account-circle") {
        const div = document.createElement('div');
        div.className = "item-subject-display"; // Unique class for subject display
        div.innerHTML = `
            <style>
                .item-subject-display {
                    display: flex;
                    align-items: center;
                    padding: 2px;
                }
                .item-subject-icon {
                    width: 32px; /* Smaller icons for table cells */
                    height: 32px;
                    border-radius: 50%;
                    object-fit: cover;
                    margin-right: 5px;
                    flex-shrink: 0;
                }
                .item-subject-icon-placeholder {
                    width: 32px;
                    height: 32px;
                    --iron-icon-fill-color: var(--palette-action-disabled);
                    margin-right: 5px;
                    flex-shrink: 0;
                }
                .item-subject-text {
                    display: flex;
                    flex-direction: column;
                    font-size: 0.8em;
                    flex-grow: 1;
                    min-width: 0; /* Allow text to shrink */
                }
                .item-subject-text span:first-child {
                    font-weight: 500;
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                }
                .item-subject-text span:last-child {
                    font-size: 0.7em;
                    color: var(--secondary-text-color);
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                }
            </style>
            ${iconUrl ? `<img class="item-subject-icon" src="${iconUrl}" alt="Subject Icon">` : `<iron-icon class="item-subject-icon-placeholder" icon="${iconName}"></iron-icon>`}
            <div class="item-subject-text">
                <span>${mainText}</span>
                ${subText ? `<span>${subText}</span>` : ''}
            </div>
        `;
        return div;
    }

    /**
     * Specific display methods for different subject types.
     * They use the generic _createGenericSubjectDiv.
     * @private
     */
    _createAccountDiv(account) {
        const name = (account.getFirstname() && account.getLastname()) ? `${account.getFirstname()} ${account.getLastname()}` : account.getName();
        return this._createGenericSubjectDiv(name, account.getEmail(), account.getProfilepicture(), "account-circle");
    }

    _createApplicationDiv(application) {
        return this._createGenericSubjectDiv(application.getAlias(), application.getVersion(), application.getIcon(), "apps");
    }

    _createOrganizationDiv(organization) {
        return this._createGenericSubjectDiv(organization.getName(), `${organization.getId()}@${organization.getDomain()}`, "", "social:domain");
    }

    _createPeerDiv(peer) {
        return this._createGenericSubjectDiv(peer.getHostname(), `(${peer.getMac()})`, "", "hardware:computer");
    }

    _createGroupDiv(group) {
        return this._createGenericSubjectDiv(group.getName(), `${group.getId()}@${group.getDomain()}`, "", "social:people");
    }

    /**
     * Creates a single permission status cell for the table.
     * @param {string} status - The permission status ('allowed', 'denied', or undefined/no status).
     * @param {string} permissionName - The name of the permission (e.g., 'read', 'owner').
     * @param {Object} subject - The subject object ({id, type, permissions}).
     * @returns {HTMLElement} The created table cell element.
     * @private
     */
    _createPermissionCell(status, permissionName, subject) {
        const cell = document.createElement("div");
        cell.className = "permission-cell";

        let iconElement;
        if (status === "allowed") {
            iconElement = document.createElement("iron-icon");
            iconElement.icon = "icons:check";
        } else if (status === "denied") {
            iconElement = document.createElement("iron-icon");
            iconElement.icon = "av:not-interested";
        } else { // No explicit status, or "none"
            iconElement = document.createElement("iron-icon");
            iconElement.icon = "icons:remove";
        }
        cell.appendChild(iconElement);

        // Attach click listener to toggle permission
        iconElement.addEventListener('click', () => {
            this._togglePermissionStatus(subject, permissionName, status);
        });

        return cell;
    }

    /**
     * Toggles the permission status for a subject and permission name.
     * Updates the underlying Permissions object and triggers a save.
     * The order of toggling is: allowed -> denied -> none -> allowed (for read/write/delete)
     * For owner: allowed -> none -> allowed
     * @param {Object} subject - The subject object ({id, type, permissions}).
     * @param {string} permissionName - The name of the permission (e.g., 'read', 'owner').
     * @param {string | undefined} currentStatus - The current status ('allowed', 'denied', or undefined).
     * @private
     */
    _togglePermissionStatus(subject, permissionName, currentStatus) {
        // Find or create the relevant permission objects within `_permissions`
        const getOrCreatePermission = (listGetter, listSetter) => {
            let perm = this._permissions[listGetter]().find(p => p.getName() === permissionName);
            if (!perm) {
                perm = new Permission();
                perm.setName(permissionName);
                perm.setAccountsList([]);
                perm.setApplicationsList([]);
                perm.setOrganizationsList([]);
                perm.setGroupsList([]);
                perm.setPeersList([]);
                this._permissions[listGetter]().push(perm); // Add new permission object to the list
            }
            return perm;
        };

        const getSubjectList = (permissionObj) => {
            if (subject.type === "account") return permissionObj.getAccountsList();
            if (subject.type === "group") return permissionObj.getGroupsList();
            if (subject.type === "application") return permissionObj.getApplicationsList();
            if (subject.type === "organization") return permissionObj.getOrganizationsList();
            if (subject.type === "peer") return permissionObj.getPeersList();
            return [];
        };

        const setSubjectList = (permissionObj, newList) => {
            if (subject.type === "account") permissionObj.setAccountsList(newList);
            else if (subject.type === "group") permissionObj.setGroupsList(newList);
            else if (subject.type === "application") permissionObj.setApplicationsList(newList);
            else if (subject.type === "organization") permissionObj.setOrganizationsList(newList);
            else if (subject.type === "peer") permissionObj.setPeersList(newList);
        };

        const removeSubjectFromList = (permissionObj) => {
            const currentList = getSubjectList(permissionObj);
            const updatedList = currentList.filter(id => id !== subject.id && id !== `${subject.id}@${subject.domain}`); // Account for FQDN
            setSubjectList(permissionObj, updatedList);
        };

        const addSubjectToList = (permissionObj) => {
            const currentList = getSubjectList(permissionObj);
            const subjectIdToAdd = subject.getDomain ? `${subject.id}@${subject.getDomain()}` : subject.id; // Assume getDomain for entities
            if (!currentList.includes(subjectIdToAdd)) {
                const updatedList = [...currentList, subjectIdToAdd];
                setSubjectList(permissionObj, updatedList);
            }
        };


        let nextStatus;
        if (permissionName === "owner") {
            // Owner permission: allowed -> none -> allowed
            if (currentStatus === "allowed") {
                nextStatus = undefined; // Remove owner permission
            } else {
                nextStatus = "allowed"; // Make owner
            }
        } else {
            // Read/Write/Delete permission: allowed -> denied -> none -> allowed
            if (currentStatus === "allowed") {
                nextStatus = "denied";
            } else if (currentStatus === "denied") {
                nextStatus = undefined; // Remove permission (neither allowed nor denied)
            } else {
                nextStatus = "allowed"; // Make allowed
            }
        }

        // Apply changes to the underlying _permissions object
        const allowedPerm = getOrCreatePermission('getAllowedList', 'setAllowedList');
        const deniedPerm = getOrCreatePermission('getDeniedList', 'setDeniedList');
        const ownerPerm = this._permissions.getOwners(); // Owner is special, already in permissions

        // Reset subject from all lists first for this permission name
        removeSubjectFromList(allowedPerm);
        removeSubjectFromList(deniedPerm);
        if (ownerPerm) { // If owner permission exists, remove from its list too
            removeSubjectFromList(ownerPerm);
        }

        // Add subject to the correct list based on nextStatus
        if (nextStatus === "allowed") {
            addSubjectToList(allowedPerm);
            if (permissionName === "owner") { // If owner, add to owners list
                addSubjectToList(ownerPerm);
            }
        } else if (nextStatus === "denied") {
            addSubjectToList(deniedPerm);
        }

        // After updating the _permissions object, re-render the table to reflect changes
        this._renderPermissionsTable();

        // Save changes to backend
        this._permissionManager.savePermissions();
    }
}

customElements.define('globular-permissions-viewer', PermissionsViewer);