import getUuidByString from "uuid-by-string";
import { AccountController } from "../../backend/account"; // Assuming AccountController is promisified
import { GroupController } from "../../backend/group"; // Assuming GroupController is promisified
import { Backend, displayError } from "../../backend/backend"; // Assuming Backend is available
import { ApplicationController } from "../../backend/applications"; // Assuming ApplicationController is promisified
import { OrganizationController } from "../../backend/organization"; // Assuming OrganizationController is promisified

// Polymer/Custom Element imports
import '@polymer/iron-icon/iron-icon.js'; // For iron-icon
import '@polymer/iron-collapse/iron-collapse.js'; // For iron-collapse
import '@polymer/paper-ripple/paper-ripple.js'; // For paper-ripple
import '@polymer/iron-icons/social-icons.js'; // For social icons
import '@polymer/iron-icons/maps-icons.js'; // For map/place icons (e.g., in organization)
import '@polymer/iron-icons/hardware-icons.js'; // For hardware icons (e.g., computer)

/**
 * Custom element to display and allow selection of various types of subjects
 * (Accounts, Groups, Organizations, Applications) in collapsible sections.
 */
export class GlobularSubjectsView extends HTMLElement {
    // Private instance properties
    _account = null; // The currently logged-in account (for filtering 'sa' and self)

    // Callbacks for parent components
    on_accounts_change = null;
    on_groups_change = null;
    on_account_click = null;
    on_group_click = null;
    on_application_click = null;
    on_organization_click = null;

    // DOM element references
    _subjectsDiv = null; // Main container for all subjects content
    _selectorsDiv = null; // Container for selector tabs (Accounts, Groups etc.)

    _accountsSelector = null; _accountsCounter = null; _accountsCollapsePanel = null; _accountsDiv = null;
    _groupsSelector = null; _groupsCounter = null; _groupsCollapsePanel = null; _groupsDiv = null;
    _organizationsSelector = null; _organizationsCounter = null; _organizationsCollapsePanel = null; _organizationsDiv = null;
    _applicationsSelector = null; _applicationsCounter = null; _applicationsCollapsePanel = null; _applicationsDiv = null;

    _resizeListener = null; // To store reference to resize handler for cleanup

    /**
     * Constructor for the GlobularSubjectsView custom element.
     * Initializes the shadow DOM.
     */
    constructor() {
        super();
        this.attachShadow({ mode: 'open' });
        // Account will be set by the setter, or it defaults from AccountController.account
        this._account = AccountController.account;
    }

    /**
     * Called when the element is inserted into the document's DOM.
     * Performs initial rendering, gets DOM references, binds event listeners, and loads data.
     */
    connectedCallback() {
        this._renderInitialStructure();
        this._getDomReferences();
        this._bindEventListeners();
        this._loadAllSubjectsData(); // Load all initial data (accounts, groups, etc.)
        this._setupResponsiveLayout(); // Setup dynamic layout for small screens
    }

    /**
     * Called when the element is removed from the document's DOM.
     * Cleans up event listeners (especially global ones).
     */
    disconnectedCallback() {
        if (this._resizeListener) {
            window.removeEventListener('resize', this._resizeListener);
            this._resizeListener = null;
        }
        // No specific Backend.eventHub subscriptions handled directly by this class
    }

    /**
     * Sets the account object for the view.
     * @param {Object} account - The Account object.
     */
    set account(account) {
        if (this._account !== account) {
            this._account = account;
            this._loadAllSubjectsData(); // Reload data if account changes (e.g., to filter self)
        }
    }

    /**
     * Renders the initial HTML structure of the subjects view.
     * @private
     */
    _renderInitialStructure() {
        this.shadowRoot.innerHTML = `
            <style>
                #subjects-div {
                    display: flex;
                    flex-direction: column;
                    margin-right: 25px; /* Space from main content */
                    width: 100%; /* Take full width of parent */
                    box-sizing: border-box; /* Include padding/border in width */
                }

                .vertical-tabs {
                    display: flex;
                    flex-direction: column;
                    height: 100%;
                }

                .vertical-tab {
                    display: flex;
                    flex-direction: column;
                    position: relative;
                }

                .selector {
                    display: flex; /* For flex layout of text and counter */
                    align-items: center;
                    justify-content: space-between; /* Space text and counter */
                    text-decoration: underline;
                    padding: 8px 10px; /* Padding for selector tabs */
                    margin-right: 5px; /* Space between selectors in row layout */
                    color: var(--primary-text-color); /* Selector text color */
                    background-color: var(--palette-background-dark); /* Subtle background */
                    border-radius: 4px; /* Rounded corners */
                    cursor: pointer;
                    position: relative; /* For ripple */
                    transition: background-color 0.2s ease;
                }
                .selector:hover {
                    background-color: var(--palette-action-hover);
                }

                .counter {
                    font-size: 0.9em; /* Slightly smaller for counter */
                    color: var(--secondary-text-color);
                }

                .subject-div {
                    padding-left: 10px;
                    width: 100%;
                    display: flex;
                    flex-direction: column; /* Default stack items */
                    padding-bottom: 10px;
                    margin-bottom: 10px;
                    border-bottom: 1px solid var(--palette-divider);
                }

                .infos {
                    margin: 4px; /* Space between individual cards */
                    padding: 8px; /* Padding inside info card */
                    display: flex;
                    border-radius: 4px;
                    align-items: center;
                    background-color: var(--surface-color);
                    color: var(--primary-text-color);
                    box-shadow: var(--shadow-elevation-2dp); /* Subtle shadow */
                    transition: background 0.2s ease, box-shadow 0.2s ease;
                    position: relative; /* For active state */
                }
                .infos:hover {
                    box-shadow: var(--shadow-elevation-4dp);
                    background-color: var(--palette-action-hover);
                }
                .infos.active {
                    border: 1px solid var(--primary-color); /* Highlight active item */
                    box-shadow: var(--shadow-elevation-6dp);
                }

                .infos img {
                    width: 48px; /* Larger images for list items */
                    height: 48px;
                    border-radius: 50%;
                    object-fit: cover;
                    margin-right: 10px;
                    flex-shrink: 0;
                }
                .infos iron-icon {
                    width: 48px;
                    height: 48px;
                    --iron-icon-fill-color: var(--palette-action-disabled); /* Muted default icon */
                    margin-right: 10px;
                }

                .infos span {
                    font-size: 1rem;
                    flex-grow: 1;
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis; /* Truncate long names */
                }
                .infos span:last-child { /* Subtitle/domain */
                    font-size: 0.9em;
                    color: var(--secondary-text-color);
                }

                .group-members {
                    display: flex;
                    flex-wrap: wrap; /* Wrap members */
                    gap: 5px; /* Space between member icons */
                    padding-top: 10px; /* Space below group name */
                }
                .group-members .infos { /* Smaller style for members within group */
                    flex-direction: column;
                    width: 80px; /* Fixed width for member card */
                    padding: 5px;
                    margin: 0;
                    box-shadow: none;
                    background-color: transparent;
                }
                .group-members .infos:hover {
                    filter: none; /* No invert effect on members */
                    background-color: transparent;
                }
                .group-members .infos img {
                    max-height: 32px;
                    max-width: 32px;
                    border-radius: 50%;
                }
                .group-members .infos iron-icon {
                    width: 32px; height: 32px;
                }
                .group-members .infos span {
                    font-size: 0.75rem; /* Smaller font for member name */
                    text-align: center;
                }


                ::-webkit-scrollbar { width: 5px; height: 5px; }
                ::-webkit-scrollbar-track { background: var(--surface-color); }
                ::-webkit-scrollbar-thumb { background: var(--palette-divider); }

                @media (max-width: 500px) {
                    #subjects-div {
                        margin-right: 5px;
                    }
                    .subject-div {
                        padding-left: 0px;
                        flex-direction: row; /* Horizontal scroll for subjects */
                        overflow-x: auto;
                        flex-wrap: nowrap; /* Prevent wrapping in row mode */
                        padding-bottom: 0px; /* Remove bottom padding */
                        margin-bottom: 0px; /* Remove bottom margin */
                        border-bottom: none; /* Remove border */
                    }
                    .infos {
                        flex-direction: column;
                        border: 1px solid var(--palette-divider);
                        margin-right: 5px; /* Space between horizontal cards */
                        flex-shrink: 0; /* Prevent horizontal cards from shrinking */
                        width: 100px; /* Fixed width for mobile cards */
                    }
                    .vertical-tab {
                        height: auto; /* Allow content to dictate height */
                    }
                    .vertical-tab #accounts-div,
                    .vertical-tab #groups-div,
                    .vertical-tab #organizations-div,
                    .vertical-tab #applications-div {
                         padding-left: 0; /* No padding on mobile */
                    }
                    .selectors {
                        flex-direction: row; /* Horizontal tabs */
                        justify-content: center; /* Center tabs */
                        gap: 5px; /* Space between tabs */
                        padding: 5px; /* Padding for selector bar */
                        border-bottom: 1px solid var(--palette-divider); /* Separator */
                        flex-shrink: 0;
                    }
                    .selectors .selector {
                        flex-grow: 1; /* Tabs take equal width */
                        padding: 5px; /* Smaller padding */
                        text-align: center;
                        justify-content: center; /* Center content in tab */
                    }
                    .selectors .counter { display: none; } /* Hide counter on mobile selector tabs */
                    .infos .Contacts_icon { display: none; } /* Hide large icons on mobile cards */
                }
            </style>

            <div id="subjects-div">
                <div class="vertical-tabs">
                    <div class="selectors">
                        <span class="selector" id="accounts-selector">
                            Account's <span class="counter" id="accounts-counter"></span>
                            <paper-ripple recenters></paper-ripple>
                        </span>
                        <span class="selector" id="groups-selector">
                            Group's <span class="counter" id="groups-counter"></span>
                            <paper-ripple recenters></paper-ripple>
                        </span>
                        <span class="selector" id="organizations-selector">
                            Organization's <span class="counter" id="organizations-counter"></span>
                            <paper-ripple recenters></paper-ripple>
                        </span>
                        <span class="selector" id="applications-selector">
                            Application's <span class="counter" id="applications-counter"></span>
                            <paper-ripple recenters></paper-ripple>
                        </span>
                    </div>
                    <div class="vertical-tab" id="accounts-tab">
                        <iron-collapse id="accounts-collapse-panel" opened>
                            <div class="subject-div" id="accounts-div"></div>
                        </iron-collapse>
                    </div>
                    <div class="vertical-tab" id="groups-tab">
                        <iron-collapse id="groups-collapse-panel">
                            <div class="subject-div" id="groups-div"></div>
                        </iron-collapse>
                    </div>
                    <div class="vertical-tab" id="organizations-tab">
                        <iron-collapse id="organizations-collapse-panel">
                            <div class="subject-div" id="organizations-div"></div>
                        </iron-collapse>
                    </div>
                    <div class="vertical-tab" id="applications-tab">
                        <iron-collapse id="applications-collapse-panel">
                            <div class="subject-div" id="applications-div"></div>
                        </iron-collapse>
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
        this._selectorsDiv = this.shadowRoot.querySelector(".selectors");

        this._accountsSelector = this.shadowRoot.querySelector("#accounts-selector");
        this._accountsCounter = this.shadowRoot.querySelector("#accounts-counter");
        this._accountsCollapsePanel = this.shadowRoot.querySelector("#accounts-collapse-panel");
        this._accountsDiv = this.shadowRoot.querySelector("#accounts-div"); // Container for account infos

        this._groupsSelector = this.shadowRoot.querySelector("#groups-selector");
        this._groupsCounter = this.shadowRoot.querySelector("#groups-counter");
        this._groupsCollapsePanel = this.shadowRoot.querySelector("#groups-collapse-panel");
        this._groupsDiv = this.shadowRoot.querySelector("#groups-div"); // Container for group infos

        this._organizationsSelector = this.shadowRoot.querySelector("#organizations-selector");
        this._organizationsCounter = this.shadowRoot.querySelector("#organizations-counter");
        this._organizationsCollapsePanel = this.shadowRoot.querySelector("#organizations-collapse-panel");
        this._organizationsDiv = this.shadowRoot.querySelector("#organizations-div"); // Container for organization infos

        this._applicationsSelector = this.shadowRoot.querySelector("#applications-selector");
        this._applicationsCounter = this.shadowRoot.querySelector("#applications-counter");
        this._applicationsCollapsePanel = this.shadowRoot.querySelector("#applications-collapse-panel");
        this._applicationsDiv = this.shadowRoot.querySelector("#applications-div"); // Container for application infos

        // Tab content containers (for responsive layout)
        this._accountsTab = this.shadowRoot.querySelector("#accounts-tab");
        this._groupsTab = this.shadowRoot.querySelector("#groups-tab");
        this._organizationsTab = this.shadowRoot.querySelector("#organizations-tab");
        this._applicationsTab = this.shadowRoot.querySelector("#applications-tab");
    }

    /**
     * Binds event listeners to interactive elements.
     * @private
     */
    _bindEventListeners() {
        // Selector click handlers for accordion behavior
        this._accountsSelector.addEventListener('click', this._handleSelectorClick.bind(this, 'accounts'));
        this._groupsSelector.addEventListener('click', this._handleSelectorClick.bind(this, 'groups'));
        this._organizationsSelector.addEventListener('click', this._handleSelectorClick.bind(this, 'organizations'));
        this._applicationsSelector.addEventListener('click', this._handleSelectorClick.bind(this, 'applications'));

        // Global resize listener for responsive layout adjustments
        this._resizeListener = this._handleWindowResize.bind(this);
        window.addEventListener('resize', this._resizeListener);
    }

    /**
     * Handles clicks on selector tabs to toggle their corresponding collapse panels.
     * Ensures only one panel is open at a time.
     * @param {string} selectedTabType - The type of tab clicked ('accounts', 'groups', etc.).
     * @private
     */
    _handleSelectorClick(selectedTabType) {
        const collapsePanels = {
            'accounts': this._accountsCollapsePanel,
            'groups': this._groupsCollapsePanel,
            'organizations': this._organizationsCollapsePanel,
            'applications': this._applicationsCollapsePanel
        };

        for (const type in collapsePanels) {
            const panel = collapsePanels[type];
            if (panel) {
                if (type === selectedTabType) {
                    panel.toggle(); // Toggle the clicked panel
                } else if (panel.opened) {
                    panel.toggle(); // Close other open panels
                }
            }
        }
    }

    /**
     * Handles window resize events to adjust responsive layout.
     * Moves selectors between vertical tabs and horizontal bar.
     * @private
     */
    _handleWindowResize() {
        const isMobileView = document.querySelector("body").clientWidth <= 500; // Assuming 500px as breakpoint

        const selectors = [
            { element: this._accountsSelector, tab: this._accountsTab },
            { element: this._groupsSelector, tab: this._groupsTab },
            { element: this._organizationsSelector, tab: this._organizationsTab },
            { element: this._applicationsSelector, tab: this._applicationsTab }
        ];

        selectors.forEach(s => {
            if (s.element && s.tab) {
                if (isMobileView) {
                    // Move selector to the horizontal selectors div
                    if (s.element.parentNode !== this._selectorsDiv) {
                        this._selectorsDiv.appendChild(s.element);
                    }
                } else {
                    // Move selector back to its vertical tab's header
                    if (s.element.parentNode !== s.tab) {
                        s.tab.insertBefore(s.element, s.tab.firstChild);
                    }
                }
            }
        });
        fireResize(); // Trigger global resize event if needed for parent layouts
    }

    /**
     * Loads all subject data (accounts, groups, organizations, applications).
     * @private
     */
    async _loadAllSubjectsData() {
        this._clearAllSubjectLists(); // Clear previous data

        // Load Accounts
        try {
            const accounts = await AccountController.getAccounts("{}", false); // Assuming getAccounts returns Promise
            let count = 0;
            const currentAccountId = this._account ? this._account.getId() : null;

            accounts.forEach(a => {
                // Filter out 'sa' (system administrator) and the current user
                if (a.getId() !== "sa" && a.getId() !== currentAccountId) {
                    this._appendSubjectInfo(this._accountsDiv, a, 'account');
                    count++;
                }
            });
            this._accountsCounter.textContent = `(${count})`;
            if (count > 0) this._accountsSelector.style.display = ""; // Show selector if data exists
        } catch (err) {
            displayError(`Failed to load accounts: ${err.message}`, 3000);
            this._accountsCounter.textContent = "(Error)";
            this._accountsSelector.style.display = "none";
        }

        // Load Groups
        try {
            const groups = await GroupController.getGroups(); // Assuming getGroups returns Promise
            this._groupsCounter.textContent = `(${groups.length})`;
            groups.forEach(g => {
                this._appendSubjectInfo(this._groupsDiv, g, 'group');
            });
            if (groups.length > 0) this._groupsSelector.style.display = "";
        } catch (err) {
            displayError(`Failed to load groups: ${err.message}`, 3000);
            this._groupsCounter.textContent = "(Error)";
            this._groupsSelector.style.display = "none";
        }

        // Load Organizations
        try {
            const organizations = await OrganizationController.getAllOrganizations(); // Assuming getAllOrganizations returns Promise
            this._organizationsCounter.textContent = `(${organizations.length})`;
            organizations.forEach(o => {
                this._appendSubjectInfo(this._organizationsDiv, o, 'organization');
            });
            if (organizations.length > 0) this._organizationsSelector.style.display = "";
        } catch (err) {
            displayError(`Failed to load organizations: ${err.message}`, 3000);
            this._organizationsCounter.textContent = "(Error)";
            this._organizationsSelector.style.display = "none";
        }

        // Load Applications
        try {
            const applications = await ApplicationController.getAllApplicationInfo(); // Assuming getAllApplicationInfo returns Promise
            this._applicationsCounter.textContent = `(${applications.length})`;
            applications.forEach(a => {
                this._appendSubjectInfo(this._applicationsDiv, a, 'application');
            });
            if (applications.length > 0) this._applicationsSelector.style.display = "";
        } catch (err) {
            displayError(`Failed to load applications: ${err.message}`, 3000);
            this._applicationsCounter.textContent = "(Error)";
            this._applicationsSelector.style.display = "none";
        }

        // Ensure default open state for first selector with content
        if (!this._accountsCollapsePanel.opened && !this._groupsCollapsePanel.opened &&
            !this._organizationsCollapsePanel.opened && !this._applicationsCollapsePanel.opened) {
            if (this._accountsCounter.textContent !== "(0)") this._accountsCollapsePanel.toggle();
            else if (this._groupsCounter.textContent !== "(0)") this._groupsCollapsePanel.toggle();
            else if (this._organizationsCounter.textContent !== "(0)") this._organizationsCollapsePanel.toggle();
            else if (this._applicationsCounter.textContent !== "(0)") this._applicationsCollapsePanel.toggle();
        }
    }

    /**
     * Clears all subject lists in the UI.
     * @private
     */
    _clearAllSubjectLists() {
        this._accountsDiv.innerHTML = "";
        this._groupsDiv.innerHTML = "";
        this._organizationsDiv.innerHTML = "";
        this._applicationsDiv.innerHTML = "";
    }

    /**
     * Appends a subject (Account, Group, etc.) to its corresponding list in the UI.
     * @param {HTMLElement} containerDiv - The specific div (e.g., this._accountsDiv) to append to.
     * @param {Object} subject - The subject object.
     * @param {string} type - The type of subject ('account', 'group', 'organization', 'application').
     * @private
     */
    _appendSubjectInfo(containerDiv, subject, type) {
        const uuid = `_subject_${getUuidByString(subject.getId() + "@" + (subject.getDomain ? subject.getDomain() : ''))}`; // Ensure ID uniqueness
        const name = this._getSubjectName(subject, type);
        const iconSource = this._getSubjectIconSource(subject, type); // { img_src, icon_name }

        const html = `
            <div id="${uuid}" class="infos">
                ${iconSource.img_src ? `<img src="${iconSource.img_src}" alt="${name}">` : `<iron-icon icon="${iconSource.icon_name}"></iron-icon>`}
                <div style="display: flex; flex-direction: column;">
                    <span>${name}</span>
                    <span style="font-size: .85rem;">${this._getSubjectSubtitle(subject, type)}</span>
                </div>
            </div>
        `;
        containerDiv.appendChild(document.createRange().createContextualFragment(html));

        const subjectDiv = containerDiv.querySelector(`#${uuid}`);
        subjectDiv.subject = subject; // Store the subject object on the DOM element

        // Add click listener
        subjectDiv.addEventListener('click', this._handleSubjectClick.bind(this, subjectDiv, subject, type));
    }

    /**
     * Helper to get the display name for a subject.
     * @param {Object} subject - The subject object.
     * @param {string} type - The type of subject.
     * @returns {string} The display name.
     * @private
     */
    _getSubjectName(subject, type) {
        if (type === 'account' && subject.getFirstname && subject.getLastname && subject.getFirstname() && subject.getLastname()) {
            return `${subject.getFirstname()} ${subject.getLastname()}`;
        }
        if (subject.getName) return subject.getName();
        if (subject.getAlias) return subject.getAlias();
        return subject.getId ? subject.getId() : ""; // Fallback
    }

    /**
     * Helper to get the subtitle/secondary info for a subject.
     * @param {Object} subject - The subject object.
     * @param {string} type - The type of subject.
     * @returns {string} The subtitle text.
     * @private
     */
    _getSubjectSubtitle(subject, type) {
        if (type === 'account' && subject.getEmail) return subject.getEmail();
        if (subject.getDomain) return subject.getDomain();
        if (subject.getVersion) return `v${subject.getVersion()}`; // For applications
        return "";
    }

    /**
     * Helper to get the image source or icon name for a subject.
     * @param {Object} subject - The subject object.
     * @param {string} type - The type of subject.
     * @returns {Object} An object { img_src: string | null, icon_name: string }.
     * @private
     */
    _getSubjectIconSource(subject, type) {
        let imgSrc = null;
        let iconName = "account-circle"; // Default icon

        if (type === 'account' && subject.getProfilepicture && subject.getProfilepicture().length > 0) {
            imgSrc = subject.getProfilepicture();
        } else if (type === 'group') {
            iconName = "social:people";
        } else if (type === 'organization') {
            iconName = "social:domain";
        } else if (type === 'application') {
            if (subject.getIcon) { // Assuming application might have an icon URL
                imgSrc = subject.getIcon();
            }
            iconName = "apps"; // Default app icon
        }
        return { img_src: imgSrc, icon_name: iconName };
    }

    /**
     * Handles click events on individual subject info cards.
     * Applies 'active' class and calls the appropriate `on_X_click` callback.
     * @param {HTMLElement} clickedDiv - The DOM element of the clicked subject info card.
     * @param {Object} subject - The subject object (Account, Group, etc.).
     * @param {string} type - The type of subject ('account', 'group', etc.).
     * @private
     */
    _handleSubjectClick(clickedDiv, subject, type) {
        // Remove 'active' from all other infos cards
        this.shadowRoot.querySelectorAll(".infos").forEach(info => info.classList.remove("active"));
        clickedDiv.classList.add("active"); // Add 'active' to clicked card

        // Call the specific callback for the subject type
        if (type === 'account' && this.on_account_click) {
            this.on_account_click(clickedDiv, subject);
        } else if (type === 'group' && this.on_group_click) {
            this.on_group_click(clickedDiv, subject);
        } else if (type === 'organization' && this.on_organization_click) {
            this.on_organization_click(clickedDiv, subject);
        } else if (type === 'application' && this.on_application_click) {
            this.on_application_click(clickedDiv, subject);
        }

        // Fire a generic change event for the parent to update selected subjects list
        // This is handled by a listener on `_selectedSubjects.on_accounts_change` etc.
        // The event listener is responsible for calling this._selectedSubjects.appendAccount/Group
        // If this._selectedSubjects is updated, it then triggers on_accounts_change/on_groups_change
        // This is a subtle interaction.
        // For now, I'll keep the on_accounts_change/on_groups_change triggers in _appendSubjectInfo calls
        // from the `SearchResourceWizard` or similar parent.
        // Here, it would be more about notifying the parent that *this* item was clicked.
    }
}

customElements.define('globular-subjects-view', GlobularSubjectsView);