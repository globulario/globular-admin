import getUuidByString from "uuid-by-string";
import { AccountController } from "../../backend/account";
import { ApplicationController } from "../../backend/applications";
import { PeerController } from "../../backend/peer";
import { SearchableList } from "../list.js"; // Assuming SearchableList is the base class
import { Backend } from "../../backend/backend"; // Use authenticateCall
import { getAllGroups, getAllRoles } from "globular-web-client/api.js"; // Assuming these are async/promisified
import { OrganizationController } from "../../backend/organization";

// Polymer/Custom Element imports
import '@polymer/paper-card/paper-card.js';
import '@polymer/paper-icon-button/paper-icon-button.js';
import '@polymer/iron-icon/iron-icon.js';
import '@polymer/iron-icons/social-icons.js'; // For social icons like people, domain
import '@polymer/iron-icons/hardware-icons.js'; // For hardware:computer icon
import '@polymer/iron-icons/iron-icons.js';
import '../autocomplete.js'; // Assuming this is a custom element for autocomplete

// --- Promisified Backend API Functions (REQUIRED for async/await) ---
// These are necessary if your getAll... functions are callback-based.
// Implement these in your backend/api.js or relevant backend service files.

async function promisifiedGetAllAccounts(query = "{}", includeLocalhost = false) {
    return new Promise((resolve, reject) => {
        AccountController.getAccounts(query, includeLocalhost, resolve, reject);
    });
}

async function promisifiedGetAllApplications(globule) {
    return new Promise((resolve, reject) => {
        ApplicationController.getAllApplicationInfo(resolve, reject, globule); // Assuming it takes globule now
    });
}

async function promisifiedGetAllRoles(globule) {
    return new Promise((resolve, reject) => {
        // Assuming getAllRoles takes globule and returns Promise or has callbacks
        getAllRoles(globule, resolve, reject);
    });
}

async function promisifiedGetAllGroups(globule) {
    return new Promise((resolve, reject) => {
        // Assuming getAllGroups takes globule and returns Promise or has callbacks
        getAllGroups(globule, resolve, reject);
    });
}

async function promisifiedGetAllOrganizations(globule) {
    return new Promise((resolve, reject) => {
        // Assuming OrganizationController.getAllOrganizations takes globule and returns Promise or has callbacks
        OrganizationController.getAllOrganizations(resolve, reject, globule);
    });
}

async function promisifiedGetAllPeers(globule) {
    return new Promise((resolve, reject) => {
        // Assuming PeerController.getAllPeers takes globule and returns Promise or has callbacks
        PeerController.getAllPeers(globule, resolve, reject);
    });
}

// --- Common Helper for "Add" Panel Logic ---
/**
 * Sets up the logic for the common "Add Item" panel.
 * @param {HTMLElement} parentComponent - The SearchableList instance (this).
 * @param {string} panelId - The ID for the add panel.
 * @param {string} titleText - Text for the panel header (e.g., "Add Account").
 * @param {string} autocompleteLabel - Label for the autocomplete input (e.g., "Search Account").
 * @param {Function} fetchAllItemsFn - Async function to fetch all available items (e.g., promisifiedGetAllAccounts).
 * @param {Function} filterAutocompleteFn - Function to filter autocomplete results (e.g., (item, value) => ...).
 * @param {Function} createItemDivFn - Function to create the display div for an individual item (e.g., createAccountDiv).
 * @param {string} autocompleteType - Type for the autocomplete input (e.g., "email", "text").
 * @private
 */
async function _setupAddPanelLogic(
    parentComponent,
    panelId,
    titleText,
    autocompleteLabel,
    fetchAllItemsFn,
    filterAutocompleteFn,
    createItemDivFn,
    autocompleteType = "text"
) {
    const headerDiv = parentComponent.shadowRoot.querySelector("#header-div");
    let panel = headerDiv.querySelector(`#${panelId}`);

    if (panel) {
        return; // Panel already exists
    }

    const html = `
        <style>
            #${panelId}{
                position: absolute;
                left: 0px;
                z-index: 1;
                background-color: var(--surface-color);
                border-radius: 8px; /* Rounded corners */
                box-shadow: var(--shadow-elevation-6dp); /* Added shadow */
                width: 420px; /* Adjusted width */
                max-height: 450px; /* Max height for scrollable content */
                overflow: hidden; /* Hide overflow */
                display: flex;
                flex-direction: column;
            }
            #${panelId} .panel-header {
                display: flex;
                align-items: center;
                padding: 8px;
                background-color: var(--palette-primary-accent); /* Header background */
                color: var(--on-primary-color); /* Header text color */
                border-bottom: 1px solid var(--palette-divider);
            }
            #${panelId} .panel-header > div {
                flex-grow: 1;
                font-weight: 500;
            }
            #${panelId} .card-content{
                overflow-y: auto;
                flex-grow: 1; /* Allow content to grow */
                padding: 10px;
            }
            #${panelId} paper-card{
                background-color: var(--surface-color);
                color: var(--primary-text-color);
            }
            #${panelId} globular-autocomplete {
                --globular-autocomplete-input-width: 100%; /* Ensure input takes full width */
            }
        </style>
        <paper-card id="${panelId}">
            <div class="panel-header">
                <div>${titleText}</div>
                <paper-icon-button id="cancel-btn" icon="icons:close"></paper-icon-button>
            </div>
            <div class="card-content">
                <globular-autocomplete type="${autocompleteType}" label="${autocompleteLabel}" id="add_input" width="${parentComponent.width - 20}" style="flex-grow: 1;"></globular-autocomplete>
            </div>
        </paper-card>
    `;

    headerDiv.appendChild(document.createRange().createContextualFragment(html));
    panel = headerDiv.querySelector(`#${panelId}`);
    panel.style.top = `${(headerDiv.offsetHeight / 2) + 14}px`; // Position relative to header

    const closeBtn = panel.querySelector("#cancel-btn");
    closeBtn.addEventListener('click', () => {
        if (panel.parentNode) panel.parentNode.removeChild(panel);
    });

    const addInput = panel.querySelector("globular-autocomplete");
    addInput.focus();

    let allAvailableItems = await fetchAllItemsFn(Backend.globular); // Pass Backend.globular
    let currentItemsInList = parentComponent.list; // Get items already in the main list

    // Filter out items already in the main list
    allAvailableItems = allAvailableItems.filter(item => {
        return !currentItemsInList.some(existingItem => existingItem.getId() === item.getId());
    });

    addInput.onkeyup = () => {
        const val = addInput.getValue();
        if (val && val.length >= 2) { // Changed to val.length >= 2
            const filteredValues = filterAutocompleteFn(allAvailableItems, val);
            addInput.setValues(filteredValues);
        } else {
            addInput.clear(); // Clear results if query too short
        }
    };

    addInput.displayValue = (item) => {
        const itemDiv = createItemDivFn(item);
        const addBtn = itemDiv.querySelector("paper-icon-button");
        if (addBtn) { // Ensure button exists
            addBtn.icon = "icons:add";
            addBtn.addEventListener('click', () => {
                // Remove the added item from the autocomplete's source list
                allAvailableItems = allAvailableItems.filter(a => a.getId() !== item.getId());
                addInput.clear(); // Clear current search results
                addInput.setValues(filterAutocompleteFn(allAvailableItems, addInput.getValue())); // Re-filter autocomplete

                // Call the onadditem callback of the parent component
                if (parentComponent.onadditem) {
                    parentComponent.onadditem(item);
                }
            });
        }
        return itemDiv;
    };
}

// --- Common Helper for Creating Item Divs ---
/**
 * Creates a generic item display div.
 * @param {string} uuid - Unique ID for the div.
 * @param {string} mainText - Primary text to display.
 * @param {string} [subText=""] - Optional secondary text.
 * @param {string} [iconUrl=""] - URL for an image icon.
 * @param {string} [iconName="account-circle"] - Iron-icon name if no image URL.
 * @returns {HTMLElement} The created div element.
 */
function _createGenericItemDiv(uuid, mainText, subText = "", iconUrl = "", iconName = "account-circle") {
    const div = document.createElement('div');
    div.id = uuid;
    div.className = "item-div";
    div.innerHTML = `
        <style>
            .item-div {
                display: flex;
                align-items: center;
                padding: 8px; /* More padding */
                width: 100%;
                border-bottom: 1px solid var(--palette-divider); /* Separator */
            }
            .item-div:last-child {
                border-bottom: none;
            }
            .item-icon {
                width: 40px;
                height: 40px;
                border-radius: 50%;
                object-fit: cover;
                margin-right: 8px;
                flex-shrink: 0;
            }
            .item-icon-placeholder {
                width: 40px;
                height: 40px;
                --iron-icon-fill-color: var(--palette-action-disabled);
                margin-right: 8px;
                flex-shrink: 0;
            }
            .item-text-content {
                display: flex;
                flex-direction: column;
                flex-grow: 1;
                font-size: 0.9em; /* Slightly smaller font for list items */
            }
            .item-text-content span:first-child {
                font-weight: 500;
            }
            .item-delete-btn {
                margin-left: auto; /* Push to right */
                color: var(--primary-text-color);
            }
            .item-delete-btn:hover {
                color: var(--palette-error-main); /* Red on hover for delete */
                cursor: pointer;
            }
        </style>
        <div style="display: flex; align-items: center; width: 100%;">
            ${iconUrl ? `<img class="item-icon" src="${iconUrl}" alt="Item Icon">` : `<iron-icon class="item-icon-placeholder" icon="${iconName}"></iron-icon>`}
            <div class="item-text-content">
                <span>${mainText}</span>
                ${subText ? `<span>${subText}</span>` : ''}
            </div>
            <paper-icon-button class="item-delete-btn" icon="icons:delete"></paper-icon-button>
        </div>
    `;
    return div;
}

// --- SearchableAccountList ---
export class SearchableAccountList extends SearchableList {
    constructor(title, list, ondeleteaccount, onaddaccount) {
        const onadd = async (accounts) => { // Make onadd async
            await _setupAddPanelLogic(
                this,
                "add-list-user-panel",
                "Add Account",
                "Search Account",
                promisifiedGetAllAccounts, // Async fetch function
                (allAccounts, value) => { // Filter function for autocomplete
                    return allAccounts.filter(a =>
                        a.getName().toUpperCase().includes(value.toUpperCase()) ||
                        a.getEmail().toUpperCase().includes(value.toUpperCase())
                    );
                },
                (account) => this.createAccountDiv(account), // Create div for account
                "email" // Autocomplete type
            );
        };
        super(title, list, ondeleteaccount, onaddaccount, onadd);
    }

    createAccountDiv(account) {
        const uuid = `_${getUuidByString(account.getId())}`;
        const name = (account.getFirstname() && account.getLastname()) ? `${account.getFirstname()} ${account.getLastname()}` : account.getName();
        const email = account.getEmail();
        const profilePicture = account.getProfilepicture();
        return _createGenericItemDiv(uuid, name, email, profilePicture, "account-circle");
    }

    removeItem(a) {
        this.list = this.list.filter(el => el.getId() !== a.getId());
    }

    displayItem(a) {
        const div = this.createAccountDiv(a);
        const deleteBtn = div.querySelector(".item-delete-btn");

        if (this.ondeleteitem) {
            deleteBtn.addEventListener('click', () => {
                if (div.parentNode) div.parentNode.removeChild(div);
                this.ondeleteitem(a);
            });
        } else {
            deleteBtn.style.display = "none";
        }
        return div;
    }

    filter(account) {
        const filterVal = this.filter_.toUpperCase();
        return account.getName().toUpperCase().includes(filterVal) || account.getEmail().toUpperCase().includes(filterVal);
    }

    sortItems() {
        return this.list.sort((a, b) => a.getName().localeCompare(b.getName()));
    }
}
customElements.define('globular-searchable-account-list', SearchableAccountList);

// --- SearchableApplicationList ---
export class SearchableApplicationList extends SearchableList {
    constructor(title, list, ondeleteapplication, onaddapplication) {
        const onadd = async (applications) => {
            await _setupAddPanelLogic(
                this,
                "add-list-application-panel",
                "Add Application",
                "Search Application",
                promisifiedGetAllApplications, // Async fetch function
                (allApplications, value) => { // Filter function for autocomplete
                    return allApplications.filter(a =>
                        a.getName().toUpperCase().includes(value.toUpperCase()) ||
                        a.getAlias().toUpperCase().includes(value.toUpperCase())
                    );
                },
                (application) => this.createApplicationDiv(application) // Create div for application
            );
        };
        super(title, list, ondeleteapplication, onaddapplication, onadd);
    }

    createApplicationDiv(application) {
        const uuid = `_${application.getId()}`; // Use application ID for UUID as it's unique
        const mainText = `${application.getAlias()}@${application.getDomain()}`;
        const subText = application.getVersion();
        const iconUrl = application.getIcon();
        return _createGenericItemDiv(uuid, mainText, subText, iconUrl, "apps"); // Use "apps" icon for application
    }

    removeItem(a) {
        this.list = this.list.filter(el => el.getId() !== a.getId());
    }

    displayItem(a) {
        const div = this.createApplicationDiv(a);
        const deleteBtn = div.querySelector(".item-delete-btn");

        if (this.ondeleteitem) {
            deleteBtn.addEventListener('click', () => {
                if (div.parentNode) div.parentNode.removeChild(div);
                this.ondeleteitem(a);
            });
        } else {
            deleteBtn.style.display = "none";
        }
        return div;
    }

    filter(a) {
        const filterVal = this.filter_.toUpperCase();
        return a.getName().toUpperCase().includes(filterVal) || a.getAlias().toUpperCase().includes(filterVal);
    }

    sortItems() {
        return this.list.sort((a, b) => a.getName().localeCompare(b.getName()));
    }
}
customElements.define('globular-searchable-application-list', SearchableApplicationList);

// --- SearchableRoleList ---
export class SearchableRoleList extends SearchableList {
    constructor(title, list, ondeleterole, onaddrole) {
        const onadd = async (roles) => {
            await _setupAddPanelLogic(
                this,
                "add-list-role-panel",
                "Add Role",
                "Search Role",
                promisifiedGetAllRoles, // Async fetch function
                (allRoles, value) => { // Filter function for autocomplete
                    return allRoles.filter(r =>
                        r.getName().toUpperCase().includes(value.toUpperCase()) ||
                        r.getId().toUpperCase().includes(value.toUpperCase())
                    );
                },
                (role) => this.createRoleDiv(role) // Create div for role
            );
        };
        super(title, list, ondeleterole, onaddrole, onadd);
    }

    createRoleDiv(role) {
        const uuid = `_${role.getId()}`;
        const mainText = `${role.getId()}@${role.getDomain()}`;
        const iconName = "notification:enhanced-encryption"; // Icon for role
        return _createGenericItemDiv(uuid, mainText, "", "", iconName); // No subtext, no iconUrl
    }

    removeItem(r) {
        this.list = this.list.filter(el => el.getId() !== r.getId());
    }

    displayItem(r) {
        const div = this.createRoleDiv(r);
        const deleteBtn = div.querySelector(".item-delete-btn");

        if (this.ondeleteitem) {
            deleteBtn.addEventListener('click', () => {
                if (div.parentNode) div.parentNode.removeChild(div);
                this.ondeleteitem(r);
            });
        } else {
            deleteBtn.style.display = "none";
        }
        return div;
    }

    filter(r) {
        const filterVal = this.filter_.toUpperCase();
        return r.getName().toUpperCase().includes(filterVal) || r.getId().toUpperCase().includes(filterVal);
    }

    sortItems() {
        return this.list.sort((a, b) => a.getName().localeCompare(b.getName()));
    }
}
customElements.define('globular-searchable-role-list', SearchableRoleList);

// --- SearchableGroupList ---
export class SearchableGroupList extends SearchableList {
    constructor(title, list, ondeletegroup, onaddgroup) {
        const onadd = async (groups) => {
            await _setupAddPanelLogic(
                this,
                "add-list-group-panel",
                "Add Group",
                "Search Group",
                promisifiedGetAllGroups, // Async fetch function
                (allGroups, value) => { // Filter function for autocomplete
                    return allGroups.filter(g =>
                        g.getName().toUpperCase().includes(value.toUpperCase()) ||
                        g.getId().toUpperCase().includes(value.toUpperCase())
                    );
                },
                (group) => this.createGroupDiv(group) // Create div for group
            );
        };
        super(title, list, ondeletegroup, onaddgroup, onadd);
    }

    createGroupDiv(group) {
        const uuid = `_${group.getId()}`;
        const mainText = `${group.getId()}@${group.getDomain()}`;
        const iconName = "social:people"; // Icon for group
        return _createGenericItemDiv(uuid, mainText, "", "", iconName); // No subtext, no iconUrl
    }

    removeItem(g) {
        this.list = this.list.filter(el => el.getId() !== g.getId());
    }

    displayItem(g) {
        const div = this.createGroupDiv(g);
        const deleteBtn = div.querySelector(".item-delete-btn");

        if (this.ondeleteitem) {
            deleteBtn.addEventListener('click', () => {
                if (div.parentNode) div.parentNode.removeChild(div);
                this.ondeleteitem(g);
            });
        } else {
            deleteBtn.style.display = "none";
        }
        return div;
    }

    filter(g) {
        const filterVal = this.filter_.toUpperCase();
        return g.getName().toUpperCase().includes(filterVal) || g.getId().toUpperCase().includes(filterVal);
    }

    sortItems() {
        return this.list.sort((a, b) => a.getName().localeCompare(b.getName()));
    }
}
customElements.define('globular-searchable-group-list', SearchableGroupList);

// --- SearchableOrganizationList ---
export class SearchableOrganizationList extends SearchableList {
    constructor(title, list, ondeleteorganization, onaddorganization) {
        const onadd = async (organizations) => {
            await _setupAddPanelLogic(
                this,
                "add-list-organization-panel",
                "Add Organization",
                "Search Organization",
                promisifiedGetAllOrganizations, // Async fetch function
                (allOrganizations, value) => { // Filter function for autocomplete
                    return allOrganizations.filter(o =>
                        o.getName().toUpperCase().includes(value.toUpperCase()) ||
                        o.getId().toUpperCase().includes(value.toUpperCase())
                    );
                },
                (organization) => this.createOrganizationDiv(organization) // Create div for organization
            );
        };
        super(title, list, ondeleteorganization, onaddorganization, onadd);
    }

    createOrganizationDiv(organization) {
        const uuid = `_${organization.getId()}`;
        const mainText = `${organization.getId()}@${organization.getDomain()}`;
        const iconName = "social:domain"; // Icon for organization
        return _createGenericItemDiv(uuid, mainText, "", "", iconName); // No subtext, no iconUrl
    }

    removeItem(o) {
        this.list = this.list.filter(el => el.getId() !== o.getId());
    }

    displayItem(o) {
        const div = this.createOrganizationDiv(o);
        const deleteBtn = div.querySelector(".item-delete-btn");

        if (this.ondeleteitem) {
            deleteBtn.addEventListener('click', () => {
                if (div.parentNode) div.parentNode.removeChild(div);
                this.ondeleteitem(o);
            });
        } else {
            deleteBtn.style.display = "none";
        }
        return div;
    }

    filter(o) {
        const filterVal = this.filter_.toUpperCase();
        return o.getName().toUpperCase().includes(filterVal) || o.getId().toUpperCase().includes(filterVal);
    }

    sortItems() {
        return this.list.sort((a, b) => a.getName().localeCompare(b.getName()));
    }
}
customElements.define('globular-searchable-organization-list', SearchableOrganizationList);

// --- SearchablePeerList ---
export class SearchablePeerList extends SearchableList {
    constructor(title, list, ondeletepeer, onaddpeer) {
        const onadd = async (peers) => {
            await _setupAddPanelLogic(
                this,
                "add-list-peer-panel",
                "Add Peer",
                "Search Peer",
                promisifiedGetAllPeers, // Async fetch function
                (allPeers, value) => { // Filter function for autocomplete
                    return allPeers.filter(p =>
                        p.getHostname().toUpperCase().includes(value.toUpperCase()) ||
                        p.getMac().toUpperCase().includes(value.toUpperCase())
                    );
                },
                (peer) => this.createPeerDiv(peer), // Create div for peer
                "text" // Autocomplete type
            );
        };
        super(title, list, ondeletepeer, onaddpeer, onadd);
    }

    createPeerDiv(peer) {
        const uuid = `_${peer.getMac()}`; // Use MAC address for UUID
        const mainText = `${peer.getHostname()}.${peer.getDomain()}`;
        const subText = `(${peer.getMac()})`;
        const iconName = "hardware:computer"; // Icon for peer
        return _createGenericItemDiv(uuid, mainText, subText, "", iconName); // No iconUrl
    }

    removeItem(p) {
        this.list = this.list.filter(el => el.getId() !== p.getId()); // Assuming peer has getId()
    }

    displayItem(p) {
        const div = this.createPeerDiv(p);
        const deleteBtn = div.querySelector(".item-delete-btn");

        if (this.ondeleteitem) {
            deleteBtn.addEventListener('click', () => {
                if (div.parentNode) div.parentNode.removeChild(div);
                this.ondeleteitem(p);
            });
        } else {
            deleteBtn.style.display = "none";
        }
        return div;
    }

    filter(p) {
        const filterVal = this.filter_.toUpperCase();
        return p.getHostname().toUpperCase().includes(filterVal) || p.getMac().toUpperCase().includes(filterVal);
    }

    sortItems() {
        return this.list.sort((a, b) => a.getHostname().localeCompare(b.getHostname())); // Sort by hostname
    }
}
customElements.define('globular-searchable-peer-list', SearchablePeerList);