import { SharedResources } from './sharedResources.js'; // Assuming SharedResources is a custom element

// Polymer component imports
import '@polymer/paper-card/paper-card.js';
import '@polymer/paper-icon-button/paper-icon-button.js';
import '@polymer/iron-icon/iron-icon.js'; // For general icons (e.g., close)
import './subjectsView.js'; // Assuming globular-subjects-view is a custom element

/**
 * Custom element representing a panel for managing shared resources.
 * It allows selecting a subject and then displays resources shared with/by that subject.
 */
export class SharePanel extends HTMLElement {
    // Private instance properties
    _account = null; // The account for which the panel is opened
    _fileExplorer = null; // Reference to the parent file explorer component

    // DOM element references
    _closeButton = null;
    _subjectsView = null;
    _shareContentDiv = null;

    /**
     * Optional callback fired when the panel is closed.
     * @type {Function | null}
     */
    onclose = null;

    /**
     * Constructor for the SharePanel custom element.
     * @param {Object} account - The account object for which the panel is opened.
     */
    constructor(account) {
        super();
        this.attachShadow({ mode: 'open' });
        this._account = account; // Store the account object
        // Initial rendering and event binding in connectedCallback
    }

    /**
     * Called when the element is inserted into the document's DOM.
     * Performs initial rendering, gets DOM references, and binds event listeners.
     */
    connectedCallback() {
        this._renderInitialStructure();
        this._getDomReferences();
        this._bindEventListeners();
        this._setupSubjectsViewCallbacks(); // Setup callbacks for subject selection
    }

    /**
     * Sets the file explorer instance.
     * @param {Object} explorer - The file explorer object.
     */
    setFileExplorer(explorer) {
        this._fileExplorer = explorer;
    }

    /**
     * Renders the initial HTML structure of the share panel.
     * @private
     */
    _renderInitialStructure() {
        this.shadowRoot.innerHTML = `
            <style>
                #container {
                    background-color: var(--surface-color);
                    font-size: 1rem; /* Adjusted base font size for consistency */
                    display: flex;
                    height: 100%;
                    width: 100%;
                    box-sizing: border-box; /* Ensure padding/border is included in width/height */
                }

                .card-content {
                    display: flex;
                    flex-direction: column;
                    width: 100%;
                    height: 100%;
                    padding: 0px; /* No padding on card-content itself */
                    font-size: 1rem;
                }

                .header-bar {
                    display: flex;
                    justify-content: center;
                    align-items: center;
                    padding: 10px; /* Padding for header bar */
                    border-bottom: 1px solid var(--palette-divider); /* Separator */
                    background-color: var(--palette-primary-accent); /* Header background */
                    color: var(--on-primary-color); /* Header text color */
                    flex-shrink: 0; /* Prevent header from shrinking */
                }

                .header-bar h1 {
                    margin: 0px;
                    margin-left: 10px;
                    font-size: 1.25rem;
                    flex-grow: 1;
                    font-weight: 500;
                    color: var(--on-primary-color); /* Ensure text color */
                }

                .header-bar paper-icon-button {
                    color: var(--on-primary-color); /* Icon color on accent background */
                }

                #share_div {
                    display: flex;
                    padding: 0px; /* No direct padding, use margins on children */
                    height: calc(100% - 60px); /* Height minus header height */
                    flex-grow: 1;
                }

                globular-subjects-view {
                    border-right: 1px solid var(--palette-divider); /* Separator for subjects view */
                    flex-shrink: 0; /* Prevent from shrinking */
                    min-width: 250px; /* Min width for subjects view */
                    max-width: 40%; /* Flexible width for subject view */
                    overflow-y: auto; /* Allow scrolling for subjects */
                }

                #share_content_div {
                    display: flex;
                    flex-grow: 1;
                    min-width: 0; /* Allow content to shrink below min-width for flexibility */
                    padding: 10px; /* Padding for the main content area */
                    overflow-y: auto; /* Allow scrolling for shared resources list */
                }

                /* Slot for SharedResources component */
                slot {
                    display: flex; /* Ensure slot itself is a flex container */
                    flex-grow: 1;
                }

                @media (max-width: 500px) {
                    .card-content { width: calc(100vw - 10px); }
                    #share_div {
                        padding: 0px;
                        flex-direction: column;
                        flex-grow: 1;
                    }
                    globular-subjects-view {
                        border-right: none;
                        border-bottom: 1px solid var(--palette-divider); /* Separator for mobile */
                        max-width: 100%; /* Take full width */
                        height: 200px; /* Fixed height for mobile subjects view */
                        flex-shrink: 0;
                    }
                    #share_content_div {
                        min-width: auto;
                        width: 100%;
                        height: 100%; /* Take remaining height */
                        padding: 5px; /* Adjusted padding for mobile */
                    }
                }
            </style>
            <div id="container">
                <paper-card class="card-content">
                    <div class="header-bar">
                        <h1>Shared Resources...</h1>
                        <paper-icon-button id="close-btn" icon="icons:close"></paper-icon-button>
                    </div>
                    <div id="share_div">
                        <globular-subjects-view></globular-subjects-view>
                        <div id="share_content_div">
                            <slot></slot> </div>
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
        this._closeButton = this.shadowRoot.querySelector("#close-btn");
        this._subjectsView = this.shadowRoot.querySelector("globular-subjects-view");
        this._shareContentDiv = this.shadowRoot.querySelector("#share_content_div");
    }

    /**
     * Binds event listeners to interactive elements.
     * @private
     */
    _bindEventListeners() {
        if (this._closeButton) {
            this._closeButton.addEventListener('click', this._handleCloseClick.bind(this));
        }
    }

    /**
     * Sets up callbacks for the `globular-subjects-view` component.
     * @private
     */
    _setupSubjectsViewCallbacks() {
        if (this._subjectsView) {
            this._subjectsView.on_account_click = (accountDiv, account) => {
                accountDiv.account = account; // Pass the account object to the div (if it's a custom element)
                this._displaySharedResources(account);
            };

            this._subjectsView.on_group_click = (groupDiv, group) => {
                groupDiv.group = group; // Pass the group object to the div
                this._displaySharedResources(group);
            };

            // Add callbacks for other subject types if subjects-view supports them
            // subjectsView.on_application_click = (appDiv, app) => this.displaySharedResources(app);
            // subjectsView.on_organization_click = (orgDiv, org) => this.displaySharedResources(org);
            // subjectsView.on_peer_click = (peerDiv, peer) => this.displaySharedResources(peer);
        }
    }

    /**
     * Handles the click event for the close button.
     * Removes the panel from the DOM and calls the onclose callback.
     * @private
     */
    _handleCloseClick() {
        if (this.parentNode) {
            this.parentNode.removeChild(this);
        }
        if (this.onclose) {
            this.onclose();
        }
    }

    /**
     * Displays resources shared with a given subject in the content area.
     * Creates and appends a `SharedResources` component.
     * @param {Object} subject - The subject (Account, Group, etc.) to display shared resources for.
     */
    displaySharedResources(subject) {
        this._shareContentDiv.innerHTML = ""; // Clear previous content

        const sharedResourcesComponent = new SharedResources(subject);
        sharedResourcesComponent.setFileExplorer(this._fileExplorer); // Pass file explorer reference
        this._shareContentDiv.appendChild(sharedResourcesComponent);
    }
}

customElements.define('globular-share-panel', SharePanel);