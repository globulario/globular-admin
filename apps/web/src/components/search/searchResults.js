import getUuidByString from "uuid-by-string";
import { Backend } from "../../backend/backend"; // Assuming Backend is available
import { SearchResultsPage } from "./searchResultsPage"; // Assuming SearchResultsPage is a custom element

// Polymer component imports
import '@polymer/paper-tabs/paper-tabs.js';
import '@polymer/paper-tabs/paper-tab.js';
import '@polymer/paper-icon-button/paper-icon-button.js';
import '@polymer/paper-card/paper-card.js'; // For paper-card in styles

/**
 * Custom element to display and manage multiple search results pages, each in a tab.
 */
export class SearchResults extends HTMLElement {
    // Private instance properties
    _tabsContainer = null; // Reference to the paper-tabs container
    _closeAllBtn = null; // Reference to the close button for the entire panel
    _emptySearchMessage = null; // Reference to the "No results" message
    _listeners = {}; // To store UUIDs for event hub subscriptions

    /**
     * Constructor for the SearchResults custom element.
     */
    constructor() {
        super();
        this.attachShadow({ mode: 'open' });
        // Initial rendering in connectedCallback
    }

    /**
     * Called when the element is inserted into the document's DOM.
     * Performs initial rendering, gets DOM references, and binds event listeners.
     */
    connectedCallback() {
        this._renderInitialStructure();
        this._getDomReferences();
        this._bindEventListeners();
        this._setupBackendSubscriptions(); // Setup backend event listeners
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
     * Renders the initial HTML structure of the search results panel.
     * @private
     */
    _renderInitialStructure() {
        this.shadowRoot.innerHTML = `
            <style>
                :host {
                    padding: 10px;
                    display: flex; /* Ensure host is flex for proper layout */
                    flex-direction: column;
                }

                #container {
                    display: flex;
                    flex-direction: column;
                    background-color: var(--surface-color);
                    color: var(--primary-text-color);
                    user-select: none;
                    height: 100%;
                    border-radius: 8px; /* Consistent rounded corners */
                    box-shadow: var(--shadow-elevation-8dp); /* Stronger shadow */
                    overflow: hidden; /* Hide overflow from rounded corners */
                }

                .header {
                    display: flex;
                    width: 100%;
                    align-items: center;
                    background-color: var(--palette-primary-accent); /* Header background */
                    color: var(--on-primary-color); /* Header text color */
                    padding: 5px 0; /* Vertical padding */
                }

                paper-tabs {
                    flex-grow: 1;
                    --paper-tabs-selection-bar-color: var(--primary-color);
                    color: var(--on-primary-color); /* Text color on accent background */
                    --paper-tab-ink: var(--palette-action-disabled);
                }

                #close-btn {
                    width: 30px;
                    height: 30px;
                    padding: 3px;
                    color: var(--on-primary-color); /* Icon color on accent background */
                }

                paper-card {
                    background-color: var(--surface-color);
                    color: var(--primary-text-color);
                }

                paper-tab {
                    display: inline-flex; /* Use inline-flex for better control */
                    align-items: center;
                    justify-content: center;
                }

                paper-tab span {
                    font-size: 1.1rem;
                    flex-grow: 1;
                    white-space: nowrap; /* Prevent tab text wrapping */
                    overflow: hidden;
                    text-overflow: ellipsis;
                }

                #empty-search-msg {
                    text-align: center;
                    color: var(--palette-divider); /* Muted color */
                    margin-top: 20px;
                }
            </style>

            <div id="container">
                <div class="header">
                    <paper-tabs id="search-results-tabs" scrollable>
                        </paper-tabs>
                    <paper-icon-button id="close-all-btn" icon="icons:close" title="Close All Results"></paper-icon-button>
                </div>
                <h2 id="empty-search-msg">No search results to display...</h2>
                <slot></slot> </div>
        `;
    }

    /**
     * Retrieves references to all necessary DOM elements.
     * @private
     */
    _getDomReferences() {
        this._tabsContainer = this.shadowRoot.querySelector("#search-results-tabs");
        this._closeAllBtn = this.shadowRoot.querySelector("#close-all-btn");
        this._emptySearchMessage = this.shadowRoot.querySelector("#empty-search-msg");
    }

    /**
     * Binds event listeners to interactive elements.
     * @private
     */
    _bindEventListeners() {
        if (this._closeAllBtn) {
            this._closeAllBtn.addEventListener('click', this._handleCloseAllClick.bind(this));
        }
        // Listener for click on tabs is handled dynamically when tabs are created
    }

    /**
     * Sets up subscriptions to backend events for new search results.
     * @private
     */
    _setupBackendSubscriptions() {
        // Backend ready event (original used this, but it's more about initialization order)
        // document.addEventListener("backend-ready", this._handleBackendReady.bind(this));

        // New search event (main trigger for new tabs/pages)
        Backend.eventHub.subscribe(
            "__new_search_event__",
            (uuid) => { this._listeners["__new_search_event__"] = uuid; },
            this._handleNewSearchEvent.bind(this),
            true, // Retain last value
            this // Context for unsubscription
        );

        // Hide search results event (triggered by SearchBar escape key)
        Backend.eventHub.subscribe(
            "_hide_search_results_",
            (uuid) => { this._listeners["_hide_search_results_"] = uuid; },
            this._handleHideSearchResultsEvent.bind(this),
            true, this
        );
    }

    /**
     * Handles the '_hide_search_results_' event to hide the entire panel.
     * @param {Object} evt - The event object (may contain an id).
     * @private
     */
    _handleHideSearchResultsEvent(evt) {
        // Only hide if the event is for this specific SearchResults instance (if id is provided)
        // or if it's a general hide all.
        if (!evt || !evt.id || evt.id === this.id) { // Assuming this component also has an 'id'
            if (this.parentNode) {
                this.parentNode.removeChild(this);
            }
        }
        // If it's not being removed, perhaps just hide the _emptySearchMessage if already displayed
        if (this._emptySearchMessage.style.display !== "none") {
            this._emptySearchMessage.style.display = "none";
        }
    }

    /**
     * Handles the '__new_search_event__' from the backend.
     * Creates or switches to a new search results page and its corresponding tab.
     * @param {Object} evt - The event object containing query, summary, contexts, offset.
     * @private
     */
    _handleNewSearchEvent(evt) {
        // Ensure the main container is visible
        if (this._emptySearchMessage) this._emptySearchMessage.style.display = "none"; // Hide empty message

        const queryId = `_${getUuidByString(evt.query)}`; // Unique ID for this search query
        let tab = this._tabsContainer.querySelector(`#${queryId}-tab`);

        // Clean query for display in tab
        const displayQuery = evt.query
            .replaceAll(" -adult", "")
            .replaceAll(" -youtube", "")
            .replaceAll(" -TVEpisode", "")
            .replaceAll(" -TVSerie", "")
            .replaceAll(" -Movie", "")
            .trim();

        if (tab === null) {
            // Create new tab if it doesn't exist
            const tabHtml = `
                <paper-tab id="${queryId}-tab">
                    <span>${displayQuery} (<span id="${queryId}-total-span" style="font-size: 1rem;"></span>)</span>
                    <paper-icon-button id="${queryId}-close-tab-btn" icon="icons:close" title="Close this search"></paper-icon-button>
                </paper-tab>
            `;
            this._tabsContainer.appendChild(document.createRange().createContextualFragment(tabHtml));
            tab = this._tabsContainer.querySelector(`#${queryId}-tab`); // Get reference to the newly added tab
            tab.totalSpan = tab.querySelector(`#${queryId}-total-span`); // Store ref to total count span

            // Bind click to switch pages
            tab.addEventListener('click', () => this._handleTabClick(queryId));

            // Bind close button on tab
            const closeTabBtn = tab.querySelector(`#${queryId}-close-tab-btn`);
            closeTabBtn.addEventListener('click', (evt_) => {
                evt_.stopPropagation(); // Prevent tab click when closing
                this._deletePageResults(queryId);
            });
            this._tabsContainer.selected = this._tabsContainer.items.length -1; // Select the new tab
        } else {
            tab.click(); // If tab exists, just click it to switch to its page
        }

        // Create or get the associated SearchResultsPage
        let resultsPage = this.querySelector(`#${queryId}-results-page`);
        if (resultsPage === null) {
            // Hide all other pages before appending new one
            this.querySelectorAll("globular-search-results-page").forEach(page => page.style.display = "none");

            resultsPage = new SearchResultsPage(queryId, evt.summary, evt.contexts, tab);
            resultsPage.id = `${queryId}-results-page`; // Set ID for querySelector
            this.appendChild(resultsPage);
        } else {
            // If page already exists, update its summary (total count)
            if (evt.summary) {
                resultsPage.setSummary(evt.summary); // Assuming SearchResultsPage has a setSummary method
            }
        }

        // Update total count on the tab
        if (tab.totalSpan && evt.summary && evt.summary.getTotal) {
            tab.totalSpan.textContent = resultsPage.getTotal(); // Assuming resultsPage has getTotal
        }
        // Ensure the current page is visible
        this.querySelectorAll("globular-search-results-page").forEach(page => {
            page.style.display = (page.id === `${queryId}-results-page`) ? "" : "none";
            // Also manage facet filter visibility (assuming it's a property on SearchResultsPage)
            if (page.facetFilter) {
                page.facetFilter.style.display = (page.id === `${queryId}-results-page`) ? "" : "none";
            }
        });
    }

    /**
     * Handles click event on a search results tab to switch to its page.
     * @param {string} queryId - The ID of the query associated with the tab.
     * @private
     */
    _handleTabClick(queryId) {
        const targetPage = this.querySelector(`#${queryId}-results-page`);
        if (!targetPage) return;

        // Hide all other pages and show the target page
        this.querySelectorAll("globular-search-results-page").forEach(page => {
            page.style.display = "none";
            if (page.facetFilter) page.facetFilter.style.display = "none"; // Hide its facet filter
        });

        targetPage.style.display = ""; // Show the clicked page
        if (targetPage.facetFilter) {
            targetPage.facetFilter.style.display = ""; // Show its facet filter
        }
    }


    /**
     * Handles click event for the "Close All Results" button.
     * @private
     */
    _handleCloseAllClick() {
        // Clear all tabs and pages
        this._tabsContainer.innerHTML = "";
        this.querySelectorAll("globular-search-results-page").forEach(page => {
            // Also remove its facetFilter if it was globally appended (e.g., to side menu)
            if (page.facetFilter && page.facetFilter.parentNode) {
                page.facetFilter.parentNode.removeChild(page.facetFilter);
            }
            page.parentNode.removeChild(page); // Remove the page element itself
        });

        this._emptySearchMessage.style.display = "block"; // Show empty message
        Backend.eventHub.publish("_hide_search_results_", { "id": this.id }, true); // Publish global hide event
    }

    /**
     * Checks if there are any search results pages currently displayed.
     * @returns {boolean} True if no pages are displayed, false otherwise.
     */
    isEmpty() {
        return this._tabsContainer.querySelectorAll("paper-tab").length === 0;
    }

    /**
     * Deletes a specific search results page and its associated tab.
     * @param {string} queryId - The ID of the query (and page) to delete.
     */
    _deletePageResults(queryId) {
        const pageToDelete = this.querySelector(`#${queryId}-results-page`);
        const tabToDelete = this._tabsContainer.querySelector(`#${queryId}-tab`);

        if (pageToDelete && pageToDelete.parentNode) {
            // Remove its facetFilter if it was globally appended
            if (pageToDelete.facetFilter && pageToDelete.facetFilter.parentNode) {
                pageToDelete.facetFilter.parentNode.removeChild(pageToDelete.facetFilter);
            }
            pageToDelete.parentNode.removeChild(pageToDelete);
        }
        if (tabToDelete && tabToDelete.parentNode) {
            tabToDelete.parentNode.removeChild(tabToDelete);
        }

        // After deletion, switch to another tab or hide the whole panel
        if (this._tabsContainer.querySelectorAll("paper-tab").length > 0) {
            // Click the first remaining tab to activate its page
            this._tabsContainer.querySelector("paper-tab")?.click();
        } else {
            // If no tabs left, hide the entire search results panel
            this._emptySearchMessage.style.display = "block";
            Backend.eventHub.publish("_hide_search_results_", { "id": this.id }, true);
        }
    }
}

customElements.define('globular-search-results', SearchResults);