// Polymer/Custom Element imports
import '@polymer/iron-icon/iron-icon.js'; // Needed for iron-icon (account-circle, social:people)
import '@polymer/paper-icon-button/paper-icon-button.js'; // Often used for close/remove buttons

/**
 * Custom element to display a list of selected subjects (accounts and groups).
 * Provides a visual representation of selected entities and allows for their removal.
 */
export class GlobularSubjectsSelected extends HTMLElement {
    // Private instance properties
    _accounts = []; // Internal array to store selected Account objects
    _groups = []; // Internal array to store selected Group objects

    // DOM element references
    _accountsDiv = null;
    _groupsDiv = null;

    // Custom events for removal (optional, but good for parent components)
    onAccountRemoved = null; // Callback when an account is removed
    onGroupRemoved = null; // Callback when a group is removed

    /**
     * Constructor for the GlobularSubjectsSelected custom element.
     * Initializes the shadow DOM.
     */
    constructor() {
        super();
        this.attachShadow({ mode: 'open' });
    }

    /**
     * Called when the element is inserted into the document's DOM.
     * Performs initial rendering and gets DOM references.
     */
    connectedCallback() {
        this._renderInitialStructure();
        this._getDomReferences();
        // Event binding for dynamically added items will be in _appendSubject
    }

    /**
     * Renders the initial HTML structure of the selected subjects display.
     * @private
     */
    _renderInitialStructure() {
        this.shadowRoot.innerHTML = `
            <style>
                #container {
                    display: flex;
                    flex-direction: column;
                    width: 100%; /* Take full width */
                    box-sizing: border-box; /* Include padding/border in width */
                    color: var(--primary-text-color); /* Inherit text color */
                }

                .subject-list-section {
                    display: flex;
                    flex-wrap: wrap;
                    gap: 10px; /* Space between subject cards */
                    margin-top: 15px; /* Space from title */
                }
                .subject-list-section:first-of-type {
                    margin-top: 5px; /* Less margin for first section */
                }


                .infos {
                    margin: 2px;
                    padding: 8px; /* Increased padding */
                    display: flex;
                    flex-direction: column;
                    border-radius: 8px; /* More rounded corners */
                    align-items: center;
                    background-color: var(--surface-color);
                    color: var(--primary-text-color);
                    box-shadow: var(--shadow-elevation-2dp); /* Subtle shadow */
                    transition: background 0.2s ease, box-shadow 0.2s ease;
                    position: relative; /* For remove button */
                }
                .infos:hover {
                    box-shadow: var(--shadow-elevation-4dp); /* More pronounced shadow */
                }
                .infos img {
                    width: 64px;
                    height: 64px;
                    border-radius: 50%; /* Round profile pictures */
                    object-fit: cover;
                    margin-bottom: 5px; /* Space between image and name */
                }
                .infos iron-icon.subject-icon { /* Default icon for subjects */
                    width: 64px;
                    height: 64px;
                    margin-bottom: 5px;
                    --iron-icon-fill-color: var(--palette-action-disabled);
                }
                .infos span {
                    font-size: 0.9rem; /* Slightly smaller font for names */
                    text-align: center;
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis; /* Truncate long names */
                    max-width: 100px; /* Max width for name before ellipsis */
                }

                .remove-btn {
                    position: absolute;
                    top: 0px;
                    right: 0px;
                    color: var(--palette-error-main); /* Red for delete */
                    padding: 4px;
                    border-radius: 50%;
                    background-color: rgba(0, 0, 0, 0.4); /* Dark background for visibility */
                    display: none; /* Hidden by default */
                    transition: opacity 0.2s ease;
                }
                .infos:hover .remove-btn {
                    display: block; /* Show on hover of the info card */
                }

            </style>
            <div id="container">
                <span style="font-size: 1.1rem; font-weight: 500;">Choose who to share with...</span>
                <div id="accounts-list" class="subject-list-section"></div>
                <div id="groups-list" class="subject-list-section"></div>
            </div>
        `;
    }

    /**
     * Retrieves references to all necessary DOM elements.
     * @private
     */
    _getDomReferences() {
        this._accountsDiv = this.shadowRoot.querySelector("#accounts-list");
        this._groupsDiv = this.shadowRoot.querySelector("#groups-list");
    }

    /**
     * Appends an account to the list of selected accounts.
     * @param {HTMLElement} accountDivTemplate - The DOM element template representing the account.
     * @param {Object} account - The Account object to append.
     */
    appendAccount(accountDivTemplate, account) {
        // Prevent adding duplicates
        if (this._accounts.some(a => a.getId() === account.getId())) {
            console.warn(`Account ${account.getId()} already selected.`);
            return;
        }

        const accountDiv = this._createSubjectCard(account, 'account');
        this._accountsDiv.appendChild(accountDiv);
        this._accounts.push(account); // Add to internal array
    }

    /**
     * Appends a group to the list of selected groups.
     * @param {HTMLElement} groupDivTemplate - The DOM element template representing the group.
     * @param {Object} group - The Group object to append.
     */
    appendGroup(groupDivTemplate, group) {
        // Prevent adding duplicates
        if (this._groups.some(g => g.getId() === group.getId())) {
            console.warn(`Group ${group.getId()} already selected.`);
            return;
        }

        const groupDiv = this._createSubjectCard(group, 'group');
        this._groupsDiv.appendChild(groupDiv);
        this._groups.push(group); // Add to internal array
    }

    /**
     * Creates a standardized card display for a subject (account or group).
     * @param {Object} subject - The account or group object.
     * @param {string} type - 'account' or 'group'.
     * @returns {HTMLElement} The created subject card element.
     * @private
     */
    _createSubjectCard(subject, type) {
        const card = document.createElement('div');
        card.classList.add('infos');
        card.subject = subject; // Store subject object on the card

        let iconHtml = '';
        let nameText = subject.getName() || subject.getId(); // Default name

        if (type === 'account') {
            if (subject.getProfilepicture && subject.getProfilepicture().length > 0) {
                iconHtml = `<img src="${subject.getProfilepicture()}" alt="Profile Picture">`;
            } else {
                iconHtml = `<iron-icon class="subject-icon" icon="account-circle"></iron-icon>`;
            }
            if (subject.getFirstname && subject.getLastname && subject.getFirstname().length > 0 && subject.getLastname().length > 0) {
                nameText = `${subject.getFirstname()} ${subject.getLastname()}`;
            }
        } else if (type === 'group') {
            iconHtml = `<iron-icon class="subject-icon" icon="social:people"></iron-icon>`;
        }

        card.innerHTML = `
            ${iconHtml}
            <span>${nameText}</span>
            <paper-icon-button class="remove-btn" icon="icons:close" title="Remove"></paper-icon-button>
        `;

        const removeBtn = card.querySelector('.remove-btn');
        if (removeBtn) {
            removeBtn.addEventListener('click', () => {
                this._removeSubject(subject, type);
                card.remove(); // Remove card from DOM
            });
        }
        return card;
    }

    /**
     * Removes a subject from the internal lists and dispatches a removal event.
     * @param {Object} subjectToRemove - The subject object to remove.
     * @param {string} type - 'account' or 'group'.
     * @private
     */
    _removeSubject(subjectToRemove, type) {
        if (type === 'account') {
            this._accounts = this._accounts.filter(a => a.getId() !== subjectToRemove.getId());
            if (this.onAccountRemoved) {
                this.onAccountRemoved(subjectToRemove);
            }
        } else if (type === 'group') {
            this._groups = this._groups.filter(g => g.getId() !== subjectToRemove.getId());
            if (this.onGroupRemoved) {
                this.onGroupRemoved(subjectToRemove);
            }
        }
        // Dispatch a generic event for parent ShareResourceWizard
        this.dispatchEvent(new CustomEvent(`${type}-removed`, { detail: subjectToRemove }));
    }


    /**
     * Returns the list of currently selected Account objects.
     * @returns {Array<Object>} An array of selected Account objects.
     */
    getAccounts() {
        return this._accounts;
    }

    /**
     * Returns the list of currently selected Group objects.
     * @returns {Array<Object>} An array of selected Group objects.
     */
    getGroups() {
        return this._groups;
    }

    // Add similar methods for other subject types (Applications, Organizations, Peers) if needed
    // appendApplication(appDiv, app) { ... }
    // getApplications() { ... }
    // onApplicationRemoved = null;
}

customElements.define('globular-subjects-selected', GlobularSubjectsSelected);