import getUuidByString from "uuid-by-string";
import { Backend, displayMessage } from "@globular/backend";
import { BlogPostInfo } from "../informationManager/blogPostInfo"; // Assuming BlogPostInfo is a custom element
import { InformationsManager } from "../informationManager/informationsManager"; // Assuming InformationsManager is a custom element
import { SearchAudioCard } from "./searchAudioCard"; // Assuming SearchAudioCard is a custom element
import { FacetSearchFilter } from "./searchFacet"; // Assuming FacetSearchFilter is a custom element
import { SearchTitleCard } from "./searchTitleCard"; // Assuming SearchTitleCard is a custom element
import { SearchVideoCard } from "./searchVideoCard"; // Assuming SearchVideoCard is a custom element
import { randomUUID } from "../utility"; // Assuming randomUUID is a utility function
import { playVideos } from "../video";
import { playAudios } from "../audio";

// Polymer component imports
import '@polymer/paper-icon-button/paper-icon-button.js'; // For paper-icon-button
import '@polymer/iron-icon/iron-icon.js'; // For iron-icon
import '@polymer/paper-card/paper-card.js'; // For paper-card in context selector / panels
import '@polymer/paper-checkbox/paper-checkbox.js'; // Used by SearchResultsPageContextsSelector


const MAX_DISPLAY_RESULTS = 20; // Global constant for results per page

/**
 * Manages pagination for search results, displaying page numbers and allowing navigation.
 */
export class SearchResultsPagesNavigator extends HTMLElement {
    // Private instance properties
    _page = null; // Reference to the current SearchResultsPage instance
    _container = null; // Main container for pagination buttons
    _nbPages = 0; // Total number of pages

    /**
     * Constructor for the SearchResultsPagesNavigator custom element.
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
    }

    /**
     * Renders the initial HTML structure of the navigator.
     * @private
     */
    _renderInitialStructure() {
        this.shadowRoot.innerHTML = `
            <style>
                #container {
                    display: flex;
                    padding: 10px;
                    flex-wrap: wrap;
                    justify-content: center; /* Center pagination buttons */
                    align-items: center;
                    gap: 5px; /* Space between buttons */
                }

                .pagination-btn {
                    display: flex;
                    justify-content: center;
                    align-items: center;
                    height: 35px;
                    width: 35px;
                    border: 1px solid var(--palette-divider);
                    border-radius: 50%; /* Make them round */
                    transition: background-color 0.2s ease, border-color 0.2s ease, filter 0.2s ease;
                    color: var(--primary-text-color); /* Default text color */
                }

                @media (max-width: 600px) {
                    #container { padding: 2px; }
                    .pagination-btn { height: 25px; width: 25px; font-size: 0.8em; }
                }

                .pagination-btn:hover {
                    cursor: pointer;
                    background-color: var(--palette-action-hover); /* Subtle hover effect */
                    filter: none; /* Remove filter if any, use background-color */
                }

                .pagination-btn.active {
                    background-color: var(--primary-color); /* Highlight active button */
                    color: var(--on-primary-color); /* Text color for active button */
                    border-color: var(--primary-color);
                }
            </style>
            <div id="container">
                </div>
        `;
    }

    /**
     * Retrieves references to all necessary DOM elements.
     * @private
     */
    _getDomReferences() {
        this._container = this.shadowRoot.querySelector("#container");
    }

    /**
     * Sets the associated SearchResultsPage component.
     * @param {HTMLElement} page - The SearchResultsPage instance.
     */
    setSearchResultsPage(page) {
        this._page = page;
    }

    /**
     * Sets the current page index and triggers a refresh of results.
     * @param {number} index - The 0-based page index to navigate to.
     * @param {HTMLElement} [buttonElement] - The button element that triggered the navigation (optional, for active state).
     */
    setIndex(index, buttonElement) {
        // Ensure valid index
        if (index < 0 || index >= this._nbPages) {
            return;
        }

        // Only update if index has changed
        if (this._page.offset === index) {
            return;
        }

        this._page.offset = index; // Update offset on the associated page

        // Trigger a refresh of the page's content
        // This will cause _display_search_results_ event to be published by the page.refresh()
        Backend.eventHub.publish("_display_search_results_", {}, true); // This event is global, handled by SearchResults and others
        this._page.refresh(); // Tells the page to re-render based on new offset

        // Update active button visual state
        this._updateActiveButton(buttonElement);
    }

    /**
     * Updates the visual active state of pagination buttons.
     * @param {HTMLElement} [activeButton] - The button element to set as active.
     * @private
     */
    _updateActiveButton(activeButton) {
        // Remove 'active' class from all previous active buttons
        this.shadowRoot.querySelectorAll(".pagination-btn.active").forEach(btn => {
            btn.classList.remove("active");
        });

        // Add 'active' class to the new active button, or find it by index
        if (activeButton) {
            activeButton.classList.add("active");
        } else {
            const btnByIndex = this.shadowRoot.querySelector(`#page_${this._page.offset}`);
            if (btnByIndex) {
                btnByIndex.classList.add("active");
            }
        }
    }

    /**
     * Sets the total number of results and updates the pagination buttons.
     * @param {number} total - The total count of search results.
     */
    setTotal(total) {
        // Calculate number of pages
        const newNbPages = Math.ceil(total / MAX_DISPLAY_RESULTS);

        // Only re-render buttons if the number of pages has changed
        if (this._nbPages === newNbPages) {
            // Just update active state if total changes within same page count
            this._updateActiveButton();
            return;
        }

        this._nbPages = newNbPages;
        this._container.innerHTML = ""; // Clear existing buttons

        if (this._nbPages > 1) {
            for (let i = 0; i < this._nbPages; i++) {
                const btn = document.createElement("div");
                btn.id = `page_${i}`;
                btn.textContent = String(i + 1); // Display 1-based page number
                btn.classList.add("pagination-btn");

                // Set active class for the current page
                if (i === this._page.offset) {
                    btn.classList.add("active");
                }

                // Bind click event
                const index = i; // Capture current index in closure
                btn.addEventListener('click', () => {
                    this.setIndex(index, btn);
                });

                this._container.appendChild(btn);
            }
        }
    }
}
customElements.define('globular-search-results-pages-navigator', SearchResultsPagesNavigator);


// --- SearchResultsPageContextsSelector (Refactored in previous turn, included here for context) ---

/**
 * Sample empty component
 */
export class SearchResultsPageContextsSelector extends HTMLElement {
    // attributes.

    // Create the applicaiton view.
    constructor() {
        super()
        // Set the shadow dom.
        this.attachShadow({ mode: 'open' });
        this.page = null;
        this.contexts = [];

        // Innitialisation of the layout.
        this.shadowRoot.innerHTML = `
                <style>
                   
                    #container{
                        display: flex;
                        margin: 5px;
                        margin-left: 10px;
                    }

                    #container div{
                        margin-right: 15px;
                        align-items: center;
                    }

                </style>
                <div id="container">
                </div>
                `
        // give the focus to the input.
        this.container = this.shadowRoot.querySelector("#container")
    }

    // The connection callback.
    connectedCallback() {

    }

    // Set the page reuslts...
    setSearchResultsPage(page) {
        this.page = page;
    }

    // Set the context...
    setContexts(contexts) {
        this.container.innerHTML = ""; // Clear previous contexts
        this.contexts = contexts;
        contexts.forEach(context => {
            let html = `
                <div id="${context}_div" style="display: none;">
                    <paper-checkbox checked id="${context}_checkbox"></paper-checkbox>
                    <span >${context}</span>
                    <span id="${context}_total" style="font-size: 1rem;margin-left: 5px;"></span>
                </div>
            `
            let range = document.createRange()
            this.container.appendChild(range.createContextualFragment(html))

            let checkbox = this.container.querySelector(`#${context}_checkbox`);
            checkbox.onclick = () => {
                this.page.setContextState(context, checkbox.checked)
            }
        })
    }

    // Set context total.
    setContextTotal(context, total) {
        const contextDiv = this.container.querySelector(`#${context}_div`);
        const totalSpan = this.container.querySelector(`#${context}_total`);
        if (contextDiv) {
            contextDiv.style.display = "flex"; // Show the context if it has results
        }
        if (totalSpan) {
            totalSpan.innerHTML = `(${total})`;
        }
    }

}

customElements.define('globular-search-results-page-contexts-selector', SearchResultsPageContextsSelector)


/**
 * Custom element representing a single page of search results.
 * It displays search hits in mosaic or list view and integrates with facets and pagination.
 */
export class SearchResultsPage extends HTMLElement {
    // Private instance properties
    _uuid = null; // Unique ID for this search page
    _offset = 0; // Current offset for pagination
    _count = 0; // Total count of visible/enabled results on this page
    _query = null; // The search query string
    _contexts = []; // Array of search contexts (e.g., "titles", "videos")
    _tab = null; // Reference to the associated paper-tab element

    _nextResultsBtn = null;
    _previousResultsBtn = null;
    _currentPageIndexSpan = null;
    _currentActionsBtns = null;
    _resultsDiv = null; // Main container for search results cards/items

    _searchResultLstViewBtn = null;
    _searchResultIconViewBtn = null;
    _viewType = "icon"; // 'icon' (mosaic) or 'list'

    _hits = {}; // Map of all search hits by their UUID: {uuid: hitObject}
    _hitsByContext = {}; // Map of hits organized by context: {contextName: [hit1, hit2]}
    _hitsByClassName = {}; // Map of hit UUIDs by filter class name: {className: [uuid1, uuid2]}

    _webpageSearchResultsDiv = null;
    _webpageSearchResultsCountSpan = null;
    _webpageSearchResultsHeader = null; // Reference to "Webpage search results" header div
    _resultsActionsDiv = null; // Container for pagination buttons at bottom
    _mosaicSlotChangeHandler = null;

    facetFilter = null; // Reference to the FacetSearchFilter instance
    contextsSelector = null; // Reference to the SearchResultsPageContextsSelector instance
    navigator = null; // Reference to the SearchResultsPagesNavigator instance

    /**
     * Constructor for the SearchResultsPage custom element.
     * @param {string} uuid - Unique ID for this search page.
     * @param {Object} summary - Search summary object.
     * @param {Array<string>} contexts - Array of search contexts.
     * @param {HTMLElement} tab - The associated paper-tab element.
     */
    constructor(uuid, summary, contexts, tab) {
        super();
        this.attachShadow({ mode: 'open' });

        this._uuid = uuid;
        this.id = `${uuid}-results-page`; // Set component ID
        this._offset = 0;
        this._query = summary.getQuery(); // Assuming summary has getQuery()
        this._contexts = contexts;
        this._tab = tab;
        this._count = 0; // Initial visible count
        this._listeners = {};
        this._pendingFacets = [];
        this._mosaicSlotChangeHandler = this._updateMosaicSectionsVisibility.bind(this);

        // Initialize internal hit caches
        this._hits = {};
        this._hitsByContext = {};
        this._hitsByClassName = {};

        this._renderInitialStructure();
        this._getDomReferences();
        this._bindEventListeners();
        this._initChildComponents(); // Initialize child components
        this._setupBackendSubscriptions(); // Setup backend events for hits/facets
    }

    get offset() {
        return this._offset;
    }

    set offset(value) {
        if (typeof value !== "number" || Number.isNaN(value)) {
            return;
        }
        this._offset = Math.max(0, Math.floor(value));
    }

    /**
     * Renders the initial HTML structure of the search results page.
     * @private
     */
    _renderInitialStructure() {
        this.shadowRoot.innerHTML = `
            <style>
                #container {
                    display: flex;
                    flex-grow: 1; /* Take remaining space */
                }

                #facets {
                    margin-right: 15px; /* Space from content */
                    min-width: 225px; /* Minimum width for facets */
                    max-width: 250px; /* Max width to prevent it from getting too wide */
                    flex-shrink: 0; /* Prevent from shrinking */
                }

                #content {
                    display: flex;
                    flex-direction: column;
                    flex-grow: 1;
                    width: 100%; /* Take remaining horizontal space */
                }

                .header {
                    display: flex;
                    align-items: center;
                    padding-bottom: 10px;
                    border-bottom: 1px solid var(--palette-divider);
                    margin-bottom: 10px;
                    flex-wrap: wrap; /* Allow wrapping of elements in header */
                    gap: 10px; /* Space between header elements */
                }

                #summary-actions {
                    display: flex;
                    align-items: center;
                    margin-left: auto; /* Push to right */
                    gap: 5px;
                }

                #results {
                    display: flex;
                    flex-direction: column;
                    flex-grow: 1;
                    overflow-y: auto; /* Allow scrolling for results content */
                    overflow-x: hidden;
                    padding-right: 5px; /* Padding for scrollbar */
                }

                #mosaic-view {
                    display: flex;
                    flex-direction: column;
                    gap: 25px;
                    padding: 10px;
                }
                .mosaic-section {
                    display: none; /* Hidden until content exists */
                    padding: 10px 0 5px;
                }
                .mosaic-section-header {
                    font-size: 1.05rem;
                    font-weight: 600;
                    padding-bottom: 6px;
                    margin-bottom: 12px;
                    border-bottom: 1px solid var(--palette-divider);
                    color: var(--primary-text-color);
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    gap: 8px;
                }
                .mosaic-section-header paper-icon-button {
                    --iron-icon-fill-color: var(--on-surface-color);
                    color: var(--on-surface-color);
                    width: 36px;
                    height: 36px;
                    padding: 4px;
                }
                .mosaic-section-content {
                    display: flex;
                    flex-wrap: wrap;
                    gap: 15px;
                    justify-content: flex-start;
                }
                #list-view {
                    display: flex;
                    flex-direction: column; /* Stack list items vertically */
                    align-items: center; /* Center list items */
                    gap: 15px;
                    padding: 10px;
                }

                #webpage-search-results {
                    display: flex;
                    flex-direction: column;
                    padding: 10px;
                    border-top: 1px solid var(--palette-divider); /* Separator */
                    margin-top: 15px; /* Space from other results */
                }

                #webpage-search-results h2 {
                    text-align: center;
                    color: var(--palette-divider);
                    margin-bottom: 15px;
                }
                #webpage-search-results .webpage-result-item {
                    margin-bottom: 15px;
                    padding-bottom: 15px;
                    border-bottom: 1px solid var(--palette-divider);
                }
                #webpage-search-results .webpage-result-item:last-child {
                    border-bottom: none;
                }
                #webpage-search-results .webpage-rank {
                    font-size: 1.1rem; padding-right: 10px;
                }
                #webpage-search-results .webpage-link {
                    font-size: 1.1rem; font-weight: 500; text-decoration: underline; cursor: pointer;
                    color: var(--primary-color);
                }
                #webpage-search-results .webpage-link:hover { text-decoration-color: var(--primary-color-dark); }
                #webpage-search-results .snippet-container {
                    padding: 15px; font-size: 0.95rem; line-height: 1.4;
                    color: var(--primary-text-color);
                }
                .highlight { background-color: var(--palette-warning-light); /* Yellow highlight */ }


                #results-actions {
                    display: flex;
                    justify-content: flex-end;
                    position: sticky; /* Sticky at bottom */
                    bottom: 0px;
                    left: 0px;
                    right: 0px;
                    margin: 10px;
                    align-items: center;
                    background-color: var(--surface-color); /* Background for sticky bar */
                    border-radius: 20px;
                    padding: 5px 10px;
                    box-shadow: var(--shadow-elevation-8dp);
                    z-index: 100; /* Ensure on top of scrollable content */
                }

                #results-actions-btns {
                    display: flex;
                    align-items: center;
                    border: 1px solid var(--palette-divider);
                    border-radius: 20px;
                    margin-right: 5px;
                }

                #results-actions-btns paper-icon-button {
                    color: var(--primary-color); /* Default color */
                }
                #results-actions-btns paper-icon-button.disable {
                    color: var(--palette-action-disabled); /* Disabled color */
                }


                ::-webkit-scrollbar {
                    width: 10px;
                }
                ::-webkit-scrollbar-track {
                    background: var(--scroll-track, var(--surface-color));
                }
                ::-webkit-scrollbar-thumb {
                    background: var(--scroll-thumb, var(--palette-divider));
                    border-radius: 6px;
                }

                @media (max-width: 600px) {
                    #container { flex-direction: column; padding: 5px; }
                    #facets { margin-right: 0; max-height: 200px; overflow-y: auto; border-bottom: 1px solid var(--palette-divider); }
                    #content { margin-left: 0px; }
                    .header { flex-direction: column; align-items: flex-start; gap: 5px; }
                    .header > div { width: 100%; justify-content: space-between; }
                    #summary-actions { margin-left: 0; width: 100%; justify-content: flex-end; }
                    #results { padding-bottom: 100px; } /* Space for fixed action bar */
                }
            </style>
            <div id="container">
                <div id="facets-panel">
                    <slot name="facets"></slot>
                </div>
                <div id="content">
                    <div class="header">
                        <div style="display: flex; flex-wrap: wrap; flex-grow: 1; align-items: center; gap: 10px;">
                            <globular-search-results-page-contexts-selector></globular-search-results-page-contexts-selector>
                            <globular-search-results-pages-navigator></globular-search-results-pages-navigator>
                        </div>
                        <div id="summary-actions">
                            <paper-icon-button id="search-result-icon-view-btn" icon="icons:view-module" title="Mosaic View"></paper-icon-button>
                            <paper-icon-button id="search-result-lst-view-btn" icon="icons:view-list" title="List View"></paper-icon-button>
                        </div>
                    </div>

                    <div id="results">
                        <div id="mosaic-view">
                            <div class="mosaic-section" data-section="blogPosts">
                                <div class="mosaic-section-header">
                                    <span>Blog Posts</span>
                                </div>
                                <div class="mosaic-section-content">
                                    <slot name="mosaic_blogPosts"></slot>
                                </div>
                            </div>
                            <div class="mosaic-section" data-section="videos">
                                <div class="mosaic-section-header">
                                    <span>Videos</span>
                                    <paper-icon-button class="mosaic-play-btn" data-section="videos" icon="av:play-arrow" title="Play All Videos"></paper-icon-button>
                                </div>
                                <div class="mosaic-section-content">
                                    <slot name="mosaic_videos"></slot>
                                </div>
                            </div>
                            <div class="mosaic-section" data-section="titles">
                                <div class="mosaic-section-header">
                                    <span>Titles</span>
                                </div>
                                <div class="mosaic-section-content">
                                    <slot name="mosaic_titles"></slot>
                                </div>
                            </div>
                            <div class="mosaic-section" data-section="audios">
                                <div class="mosaic-section-header">
                                    <span>Audios</span>
                                    <paper-icon-button class="mosaic-play-btn" data-section="audios" icon="av:play-arrow" title="Play All Audios"></paper-icon-button>
                                </div>
                                <div class="mosaic-section-content">
                                    <slot name="mosaic_audios"></slot>
                                </div>
                            </div>
                        </div>
                        <div id="list-view" style="display: none;">
                            <slot name="list_blogPosts"></slot>
                            <slot name="list_videos"></slot>
                            <slot name="list_titles"></slot>
                            <slot name="list_audios"></slot>
                        </div>
                        <h2 id="webpage-search-results-header" style="display: none;">Webpage search results (<span id="webpage-search-results-count"></span>)</h2>
                        <div id="webpage-search-results"></div>
                        <div id="results-actions">
                            <div id="results-actions-btns">
                                <paper-icon-button id="previous-results-btn" icon="icons:chevron-left" title="Previous Page"></paper-icon-button>
                                <span id="results-index">1</span> <paper-icon-button id="next-results-btn" icon="icons:chevron-right" title="Next Page"></paper-icon-button>
                            </div>
                        </div>
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
        this._nextResultsBtn = this.shadowRoot.querySelector("#next-results-btn");
        this._previousResultsBtn = this.shadowRoot.querySelector("#previous-results-btn");
        this._currentPageIndexSpan = this.shadowRoot.querySelector("#results-index");
        this._currentActionsBtns = this.shadowRoot.querySelector("#results-actions-btns");
        this._resultsDiv = this.shadowRoot.querySelector("#results");

        this._searchResultLstViewBtn = this.shadowRoot.querySelector("#search-result-lst-view-btn");
        this._searchResultIconViewBtn = this.shadowRoot.querySelector("#search-result-icon-view-btn");

        this._mosaicView = this.shadowRoot.querySelector("#mosaic-view");
        this._listView = this.shadowRoot.querySelector("#list-view");

        this._webpageSearchResultsDiv = this.shadowRoot.querySelector("#webpage-search-results");
        this._webpageSearchResultsCountSpan = this.shadowRoot.querySelector("#webpage-search-results-count");
        this._webpageSearchResultsHeader = this.shadowRoot.querySelector("#webpage-search-results-header");
        this._resultsActionsDiv = this.shadowRoot.querySelector("#results-actions"); // The sticky pagination bar

        this._facetsPanel = this.shadowRoot.querySelector("#facets-panel"); // The container for facets

        this.shadowRoot.querySelectorAll('slot[name^="mosaic_"]').forEach(slot => {
            slot.addEventListener('slotchange', this._mosaicSlotChangeHandler);
        });
        this._updateMosaicSectionsVisibility();
        this._setupMosaicPlayButtons();
    }

    /**
     * Binds event listeners to interactive elements.
     * @private
     */
    _bindEventListeners() {
        // Results div scroll
        this._resultsDiv.addEventListener('scroll', this._handleResultsScroll.bind(this));

        // Navigation buttons
        this._nextResultsBtn.addEventListener('click', this._handleNextResultsClick.bind(this));
        this._previousResultsBtn.addEventListener('click', this._handlePreviousResultsClick.bind(this));

        // View toggle buttons
        this._searchResultLstViewBtn.addEventListener('click', this._handleViewToggleClick.bind(this, 'list'));
        this._searchResultIconViewBtn.addEventListener('click', this._handleViewToggleClick.bind(this, 'icon'));

        // Event listener for webpage search result clicks
        document.addEventListener("webpage-search-result-clicked", this._handleWebpageSearchResultClicked.bind(this));
    }

    /**
     * Initializes child components and passes necessary references.
     * @private
     */
    _initChildComponents() {
        // Initialize SearchResultsPageContextsSelector
        this.contextsSelector = new SearchResultsPageContextsSelector();
        this.contextsSelector.setSearchResultsPage(this);
        this.contextsSelector.setContexts(this._contexts); // Pass initial contexts
        this.shadowRoot.querySelector(".header > div:first-child").appendChild(this.contextsSelector); // Append to header

        // Initialize SearchResultsPagesNavigator
        this.navigator = new SearchResultsPagesNavigator();
        this.navigator.setSearchResultsPage(this);
        this.shadowRoot.querySelector(".header > div:first-child").appendChild(this.navigator); // Append to header

        // Initialize FacetSearchFilter
        this.facetFilter = new FacetSearchFilter(this);
        this._facetsPanel.appendChild(this.facetFilter); // Append to the facets panel
        if (this._pendingFacets.length > 0) {
            this._pendingFacets.forEach(evt => this.facetFilter.setFacets(evt.facets, evt.context));
            this._pendingFacets = [];
        }

        // Set initial view type
        this._updateViewTypeDisplay();
    }

    /**
     * Sets up backend event subscriptions for this search results page.
     * @private
     */
    _setupBackendSubscriptions() {
        // Display facets
        Backend.eventHub.subscribe(
            `${this._uuid}_search_facets_event__`,
            (uuid) => { this._listeners[`${this._uuid}_search_facets_event__`] = uuid; },
            (evt) => {
                if (this.facetFilter) {
                    this.facetFilter.setFacets(evt.facets, evt.context);
                } else {
                    this._pendingFacets.push(evt);
                }
            }, true, this
        );

        // Append search hits
        Backend.eventHub.subscribe(
            `${this._uuid}_search_hit_event__`,
            (uuid) => { this._listeners[`${this._uuid}_search_hit_event__`] = uuid; },
            this._handleSearchHitEvent.bind(this),
            true, this
        );

        // Display webpage search result
        Backend.eventHub.subscribe(
            `display_webpage_search_result_${this._query}`, // Note: using _query directly for event name
            (uuid) => { this._listeners[`display_webpage_search_result_${this._query}`] = uuid; },
            this._handleWebpageSearchResults.bind(this),
            true, this
        );
    }

    /**
     * Handles scroll event on the results div to apply shadow effects.
     * @private
     */
    _handleResultsScroll() {
        if (this._resultsDiv.scrollTop === 0) {
            this._resultsDiv.style.boxShadow = "";
            this._resultsDiv.style.borderTop = "";
        } else {
            this._resultsDiv.style.boxShadow = "inset 0px 5px 6px -3px rgb(0 0 0 / 40%)";
            this._resultsDiv.style.borderTop = "1px solid var(--palette-divider)";
        }
    }

    /**
     * Handles click event for the "Next Page" button.
     * @private
     */
    _handleNextResultsClick() {
        this.navigator.setIndex(this._offset + 1);
    }

    /**
     * Handles click event for the "Previous Page" button.
     * @private
     */
    _handlePreviousResultsClick() {
        this.navigator.setIndex(this._offset - 1);
    }

    _getHitUniqueId(hit) {
        if (typeof hit?.getId === "function") return hit.getId();
        if (hit?.getTitle && hit.getTitle()?.getId) return hit.getTitle().getId();
        if (hit?.getVideo && hit.getVideo()?.getId) return hit.getVideo().getId();
        if (hit?.getAudio && hit.getAudio()?.getId) return hit.getAudio().getId();
        if (hit?.getBlog && hit.getBlog()?.getId) return hit.getBlog().getId();
        try {
            return getUuidByString(JSON.stringify(hit ?? {}));
        } catch {
            return randomUUID();
        }
    }

    /**
     * Handles click event for view toggle buttons (icon/list).
     * @param {string} viewType - 'list' or 'icon'.
     * @private
     */
    _handleViewToggleClick(viewType) {
        this._viewType = viewType;
        this._updateViewTypeDisplay();
        // Force refresh to re-apply filtering logic for new view type if needed
        this.refresh();
    }

    /**
     * Updates the display of mosaic vs list view based on _viewType.
     * @private
     */
    _updateViewTypeDisplay() {
        if (this._viewType === "list") {
            this._searchResultLstViewBtn.classList.remove("disable");
            this._searchResultIconViewBtn.classList.add("disable");
            this._listView.style.display = "flex"; // Use flex for list view
            this._mosaicView.style.display = "none";
        } else { // Default to icon/mosaic
            this._searchResultLstViewBtn.classList.add("disable");
            this._searchResultIconViewBtn.classList.remove("disable");
            this._listView.style.display = "none";
            this._mosaicView.style.display = "flex"; // Use flex for mosaic view
        }
    }

    /**
     * Handles search hit events, appending hits to appropriate contexts and views.
     * @param {Object} evt - The event object containing hit and context.
     * @private
     */
    _handleSearchHitEvent(evt) {
        const hit = evt.hit;
        const context = evt.context;

        // Ensure context array exists
        if (!this._hitsByContext[context]) {
            this._hitsByContext[context] = [];
        }

        // Get unique ID for the hit
        const hitUuid = this._getHitUniqueId(hit);

        // Only add if not already present
        if (!this._hits[hitUuid]) {
            this._hits[hitUuid] = hit;
            this._hitsByContext[context].push(hit);

            // Initialize hit state for filtering
            hit.hidden = false;
            hit.enable = true; // Use 'enable' to denote passing context filter

            // Classify hit by permission/type for facet filtering
            this._classifyHitForFacets(hit, hitUuid);

            // Append to DOM if it falls within the current display page (offset)
            if (this._hitsByContext[context].length <= (this._offset + 1) * MAX_DISPLAY_RESULTS) {
                const mosaicEl = this._displayMosaicHit(hit, context);
                const listEl = this._displayListHit(hit, context);
                if (mosaicEl) {
                    this.appendChild(mosaicEl);
                }
                if (listEl) this.appendChild(listEl);
                this._updateMosaicSectionsVisibility();
            }
            this.refreshNavigatorAndContextSelector(); // Update pagination and context totals
        }
    }

    setSummary(summary) {
        this._summary = summary;
        this.refreshNavigatorAndContextSelector();
    }

    /**
     * Classifies a hit by type/genre/rating for facet filtering.
     * @param {Object} hit - The search hit object.
     * @param {string} hitUuid - The unique ID of the hit.
     * @private
     */
    _classifyHitForFacets(hit, hitUuid) {
        const addClassHit = (className) => {
            const uuidClassName = getUuidByString(className.toLowerCase());
            if (!this._hitsByClassName[uuidClassName]) {
                this._hitsByClassName[uuidClassName] = [];
            }
            if (!this._hitsByClassName[uuidClassName].includes(hitUuid)) {
                this._hitsByClassName[uuidClassName].push(hitUuid);
            }
        };

        if (typeof hit?.hasTitle === "function" && hit.hasTitle()) {
            const title = hit.getTitle();
            title.getGenresList().forEach(g => g.split(" ").forEach(g_ => addClassHit(g_)));
            addClassHit(title.getType()); // Add type as a class (e.g., "Movie", "TVEpisode")

            // Rating classification
            const rating = title.getRating();
            if (rating < 3.5) addClassHit("low");
            else if (rating < 7.0) addClassHit("medium");
            else addClassHit("high");
        } else if (typeof hit?.hasVideo === "function" && hit.hasVideo()) {
            const video = hit.getVideo();
            video.getGenresList().forEach(g => g.split(" ").forEach(g_ => addClassHit(g_)));
            video.getTagsList().forEach(tag => addClassHit(tag));

            const rating = video.getRating();
            if (rating < 3.5) addClassHit("low");
            else if (rating < 7.0) addClassHit("medium");
            else addClassHit("high");
        } else if (typeof hit?.hasAudio === "function" && hit.hasAudio()) {
            const audio = hit.getAudio();
            audio.getGenresList().forEach(g => g.split(" ").forEach(g_ => addClassHit(g_)));
        } else if (typeof hit?.hasBlog === "function" && hit.hasBlog()) {
            const blog = hit.getBlog();
            blog.getKeywordsList().forEach(kw => addClassHit(kw));
        }
        // Webpage hits don't have this granular classification in original code
    }

    /**
     * Handles search results for webpages.
     * @param {Array<Object>} results - The raw search results for webpages.
     * @private
     */
    _handleWebpageSearchResults(results) {

        console.log("Displaying webpage search results:", results); 
        if (!this._webpageSearchResultsDiv) return;

        this._webpageSearchResultsDiv.innerHTML = ""; // Clear previous results
        let count = 0;

        if (results && results.length > 0) {
            results.forEach((r) => {
                const doc = JSON.parse(r.getData());
                const snippet = JSON.parse(r.getSnippet());
                const uuid = randomUUID(); // Use randomUUID for unique IDs

                if (snippet.Text && snippet.Text.length > 0) {
                    const itemElement = document.createElement('div');
                    itemElement.classList.add('webpage-result-item');
                    itemElement.innerHTML = `
                        <div style="display: flex; align-items: baseline; margin-left: 2px;">
                            <span class="webpage-rank">${parseFloat(r.getRank() / 1000).toFixed(3)}</span>
                            <div id="webpage-link-${uuid}" class="webpage-link">${doc.PageName}</div>
                        </div>
                        <div id="webpage-snippets-${uuid}" class="snippet-container"></div>
                        <span style="border-bottom: 1px solid var(--palette-action-disabled); width: 80%; margin: 10px auto;"></span>
                    `;
                    this._webpageSearchResultsDiv.appendChild(itemElement);

                    const snippetsDiv = itemElement.querySelector(`#webpage-snippets-${uuid}`);
                    snippet.Text.forEach((s) => {
                        const snippetLine = document.createElement("div");
                        snippetLine.innerHTML = s; // Contains highlight marks from backend
                        snippetsDiv.appendChild(snippetLine);
                    });

                    // Set up event listener for the link
                    const linkElement = itemElement.querySelector(`#webpage-link-${uuid}`);
                    linkElement.addEventListener('click', () => {
                        document.dispatchEvent(new CustomEvent("webpage-search-result-clicked", {
                            detail: {
                                link: doc.Link,
                                elementId: doc.Id, // Original: doc.Id, assuming this is an HTML element ID within the page
                                elementPath: doc.Path,
                                query: this._query,
                            },
                        }));
                    });

                    // Basic hover effects (can be moved to CSS if complex)
                    linkElement.addEventListener('mouseenter', () => { linkElement.style.textDecorationColor = "var(--primary-color)"; });
                    linkElement.addEventListener('mouseleave', () => { linkElement.style.textDecorationColor = ""; });

                    count++;
                }
            });
            this._webpageSearchResultsCountSpan.textContent = count.toString();
            this._webpageSearchResultsHeader.style.display = count > 0 ? "block" : "none";
        } else {
            this._webpageSearchResultsCountSpan.textContent = "0";
            this._webpageSearchResultsHeader.style.display = "none";
        }
    }

    /**
     * Handles a custom event for when a webpage search result is clicked.
     * Navigates to the page and highlights content.
     * @param {CustomEvent} e - The custom event.
     * @private
     */
    _handleWebpageSearchResultClicked(e) {
        const { link, elementId, query } = e.detail;

        // Open the page using the correct PageId (assuming globular-page-link is a navigation component)
        const pageLinks = document.getElementsByTagName("globular-page-link");
        for (let i = 0; i < pageLinks.length; i++) {
            if (pageLinks[i].id.startsWith(link)) {
                pageLinks[i].click(); // Simulate click to navigate

                setTimeout(() => { // Delay to allow page load transition
                    const targetElement = document.getElementById(elementId);
                    if (targetElement) {
                        const position = targetElement.getBoundingClientRect();

                        // Scroll smoothly to the element, accounting for header/offset
                        window.scrollTo({
                            top: position.top + window.scrollY - (65 + 10), // Adjust offset as needed
                            behavior: "smooth",
                        });

                        // Remove any previously highlighted text globally
                        document.querySelectorAll(".highlighted").forEach((el) => {
                            if (el.lowlight) el.lowlight();
                        });

                        // Highlight the searched text within the target element
                        const regex = new RegExp(query, "gi");
                        let text = targetElement.innerHTML;
                        text = text.replace(/(<mark class="highlight">|<\/mark>)/gim, ""); // Remove existing highlights
                        targetElement.innerHTML = text.replace(regex, '<mark class="highlight">$&</mark>');
                        targetElement.classList.add("highlighted");

                        // Function to remove highlight when needed (attached to the element)
                        targetElement.lowlight = () => {
                            targetElement.innerHTML = text; // Revert to original HTML
                            targetElement.classList.remove("highlighted");
                            delete targetElement.lowlight; // Clean up the method
                        };
                    }
                }, 500); // Delay to allow page load transition
                return; // Stop after finding the page link
            }
        }
    }

    /**
     * Removes existing slotted result nodes on the host element.
     * @param {string[]} prefixes - Slot name prefixes to remove (e.g., "mosaic").
     * @private
     */
    _clearSlottedResults(prefixes = []) {
        prefixes.forEach(prefix => {
            if (!prefix) return;
            this.querySelectorAll(`[slot^="${prefix}_"]`).forEach(node => node.remove());
        });
        this._updateMosaicSectionsVisibility();
    }

    /**
     * Toggles mosaic sections visibility based on whether their slots have content.
     * @private
     */
    _updateMosaicSectionsVisibility() {
        if (!this.shadowRoot) return;
        this.shadowRoot.querySelectorAll(".mosaic-section").forEach(section => {
            const slot = section.querySelector("slot");
            if (!slot) return;
            const assigned = typeof slot.assignedElements === "function"
                ? slot.assignedElements({ flatten: true })
                : slot.assignedNodes({ flatten: true }).filter(node => node.nodeType === Node.ELEMENT_NODE);
            const hasContent = assigned.length > 0;
            section.style.display = hasContent ? "block" : "none";
            const playBtn = section.querySelector(".mosaic-play-btn");
            if (playBtn) {
                playBtn.style.display = hasContent ? "inline-flex" : "none";
            }
        });
    }

    /**
     * Attaches click handlers to mosaic play buttons.
     * @private
     */
    _setupMosaicPlayButtons() {
        this.shadowRoot.querySelectorAll(".mosaic-play-btn").forEach(btn => {
            btn.addEventListener("click", (evt) => {
                evt.stopPropagation();
                const targetSection = btn.getAttribute("data-section");
                if (targetSection === "videos") {
                    this._playAllVideos();
                } else if (targetSection === "audios") {
                    this._playAllAudios();
                }
            });
        });
    }


    /**
     * Clears all displayed search hits from the view.
     */
    clear() {
        this._hits = {};
        this._hitsByContext = {};
        this._hitsByClassName = {};
        this._clearSlottedResults(["mosaic", "list"]);
        this._webpageSearchResultsDiv.innerHTML = "";
        this._webpageSearchResultsCountSpan.textContent = "0";
        this._webpageSearchResultsHeader.style.display = "none";
        // Also clear any associated facet filters' terms
        if (this.facetFilter) {
            this.facetFilter.setFacets({ getFacetsList: () => [] }); // Clear facets
        }
    }

    /**
     * Refreshes the display of search results based on current filters and pagination.
     */
    refresh() {
        // Scroll to top when refreshing page results
        if (this._resultsDiv) {
            this._resultsDiv.scrollTo({ top: 0, behavior: 'smooth' });
        }

        // Remove all current search hit elements from slots before re-appending
        this._clearSlottedResults(["mosaic", "list"]);

        let visibleHits = [];
        for (const context in this._hitsByContext) {
            this._hitsByContext[context].forEach(hit => {
                if (!hit.hidden && hit.enable) {
                    visibleHits.push({ hit: hit, context: context });
                }
            });
        }

        // Sort visible hits if needed (e.g., by score, or context order)
        // For now, maintain order as they were collected, but ensure pagination
        // is based on this filtered/sorted list.

        const startIndex = this._offset * MAX_DISPLAY_RESULTS;
        const endIndex = startIndex + MAX_DISPLAY_RESULTS;
        const hitsForCurrentPage = visibleHits.slice(startIndex, endIndex);

        hitsForCurrentPage.forEach(({ hit, context }) => {
            const mosaicElement = this._displayMosaicHit(hit, context);
            if (mosaicElement) {
                this.appendChild(mosaicElement);
            }

            const listElement = this._displayListHit(hit, context);
            if (listElement) {
                this.appendChild(listElement);
            }
        });
        this._updateMosaicSectionsVisibility();

        // Update navigator and action buttons
        this._updatePaginationButtons();
        this.refreshNavigatorAndContextSelector();
        this.facetFilter.refresh(); // Ensure facet counts are updated
    }

    /**
     * Plays all currently visible video hits in order.
     * @private
     */
    async _playAllVideos() {
        const videos = this.getVideos();
        if (!videos || videos.length === 0) {
            displayMessage("No videos available to play.", 3000);
            return;
        }
        playVideos(videos, "Search Results");
    }

    async _playAllAudios() {
        const audios = this.getAudios();
        if (!audios || audios.length === 0) {
            displayMessage("No audios available to play.", 3000);
            return;
        }
        playAudios(audios, "Search Results");
    }

    /**
     * Updates the state of pagination buttons (previous/next).
     * @private
     */
    _updatePaginationButtons() {
        const totalVisibleHits = this.getTotal(); // Get total visible hits
        const totalPages = Math.ceil(totalVisibleHits / MAX_DISPLAY_RESULTS);

        this._currentPageIndexSpan.textContent = String(this._offset + 1); // Display 1-based page number

        const enableBtn = (btn) => { btn.classList.remove("disable"); btn.style.visibility = "visible"; };
        const disableBtn = (btn) => { btn.classList.add("disable"); btn.style.visibility = "hidden"; };

        this._offset === 0 ? disableBtn(this._previousResultsBtn) : enableBtn(this._previousResultsBtn);
        this._offset >= totalPages - 1 ? disableBtn(this._nextResultsBtn) : enableBtn(this._nextResultsBtn);

        // Show/hide the entire results actions bar if there's more than one page
        if (totalPages > 1) {
            this._resultsActionsDiv.style.display = "flex";
        } else {
            this._resultsActionsDiv.style.display = "none";
        }
    }


    /**
     * Refreshes the navigator and context selector components with updated totals.
     */
    refreshNavigatorAndContextSelector() {
        let totalVisibleCount = 0;
        // Count hits that are not hidden AND are enabled by context selector
        for (const id in this._hits) {
            const hit = this._hits[id];
            if (!hit.hidden && hit.enable) {
                totalVisibleCount++;
            }
        }
        // Add webpage search results count if visible
        if (this._webpageSearchResultsHeader.style.display !== "none") {
            totalVisibleCount += parseInt(this._webpageSearchResultsCountSpan.textContent || "0");
        }


        // Update individual context totals on the selector
        this._contexts.forEach(context => {
            let countForContext = 0;
            if (this._hitsByContext[context]) {
                this._hitsByContext[context].forEach(hit => {
                    if (!hit.hidden && hit.enable) {
                        countForContext++;
                    }
                });
            }
            this.contextsSelector.setContextTotal(context, countForContext);
        });

        this.navigator.setTotal(totalVisibleCount);
    }

    /**
     * Returns the total number of currently visible and enabled search results.
     * @returns {number} The total count.
     */
    getTotal() {
        let count = 0;
        for (const id in this._hits) {
            const hit = this._hits[id];
            if (!hit.hidden && hit.enable) {
                count++;
            }
        }
        // Add webpage search results count if they are displayed
        if (this._webpageSearchResultsHeader.style.display !== "none") {
            count += parseInt(this._webpageSearchResultsCountSpan.textContent || "0");
        }
        return count;
    }

    /**
     * Hides all search hits or hits belonging to a specific class.
     * @param {string} [className] - Optional class name to hide. If not provided, hides all.
     */
    hideAll(className = undefined) {
        const uuidClassName = className ? getUuidByString(className.toLowerCase()) : undefined;
        for (const id in this._hits) {
            const hit = this._hits[id];
            if (className === undefined) {
                hit.hidden = true;
            } else if (this._hitsByClassName[uuidClassName] && this._hitsByClassName[uuidClassName].includes(id)) {
                hit.hidden = true;
            }
        }
    }

    /**
     * Shows all search hits or hits belonging to a specific class.
     * @param {string} [className] - Optional class name to show. If not provided, shows all.
     */
    showAll(className = undefined) {
        const uuidClassName = className ? getUuidByString(className.toLowerCase()) : undefined;
        for (const id in this._hits) {
            const hit = this._hits[id];
            if (className === undefined) {
                hit.hidden = false;
            } else if (this._hitsByClassName[uuidClassName] && this._hitsByClassName[uuidClassName].includes(id)) {
                hit.hidden = false;
            }
        }
    }

    setContextState(context, enabled) {
        if (!this._hitsByContext[context]) {
            return;
        }

        this._hitsByContext[context].forEach(hit => {
            hit.enable = enabled;
        });

        this.refresh();
        this.refreshNavigatorAndContextSelector();
        if (this.facetFilter) {
            this.facetFilter.setContextEnabled(context, enabled);
        }
        if (this.facetFilter) {
            this.facetFilter.refresh();
        }
    }

    /**
     * Counts the number of visible elements for a given class name.
     * @param {string} className - The class name to count.
     * @returns {number} The count of visible elements.
     */
    countElementByClassName(className) {
        let count = 0;
        const uuidClassName = getUuidByString(className.toLowerCase());
        if (this._hitsByClassName[uuidClassName]) {
            this._hitsByClassName[uuidClassName].forEach(hitUuid => {
                const hit = this._hits[hitUuid];
                if (hit && !hit.hidden && hit.enable) {
                    count++;
                }
            });
        }
        return count;
    }

    /**
     * Retrieves a list of Audio objects filtered by class name.
     * @param {string} [className] - Optional class name to filter by.
     * @returns {Array<Object>} An array of Audio objects.
     */
    getAudios(className) {
        const audios = [];
        if (this._hitsByContext["audios"]) {
            this._hitsByContext["audios"].forEach(hit => {
                const audio = hit.getAudio();
                if (audio && (className === undefined || audio.getGenresList().some(g => g.split(" ").some(g_ => getUuidByString(g_.toLowerCase()) === getUuidByString(className.toLowerCase()))))) {
                    audios.push(audio);
                }
            });
        }
        return audios;
    }

    /**
     * Retrieves a list of Video objects filtered by class name and field.
     * @param {string} className - The class name to filter by.
     * @param {string} field - The field to apply filter on (e.g., "Genres", "Tags").
     * @returns {Array<Object>} An array of Video objects.
     */
    getVideos(className, field) {
        let videos = [];
        const uuidClassName = className ? getUuidByString(className.toLowerCase()) : null;
        if (this._hitsByContext["videos"]) {
            this._hitsByContext["videos"].forEach(hit => {
                const video = hit.getVideo();
                if (video) {
                    let matches = false;
                    if (className === undefined) { // If no class name, include all
                        matches = true;
                    } else if (field === "Genres") {
                        matches = video.getGenresList().some(g => g.split(" ").some(g_ => getUuidByString(g_.toLowerCase()) === uuidClassName));
                    } else if (field === "Tags") {
                        matches = video.getTagsList().some(tag => getUuidByString(tag.toLowerCase()) === uuidClassName);
                    }
                    if (matches) {
                        videos.push(video);
                    }
                }
            });
        }
        // Remove duplicate values by ID
        return [...new Map(videos.map(v => [v.getId(), v])).values()];
    }

    _getSlotContext(hit, fallbackContext) {
        if (typeof hit?.hasVideo === "function" && hit.hasVideo()) {
            return "videos";
        }
        if (typeof hit?.hasAudio === "function" && hit.hasAudio()) {
            return "audios";
        }
        if (typeof hit?.hasBlog === "function" && hit.hasBlog()) {
            return "blogPosts";
        }
        return fallbackContext || "titles";
    }

    /**
     * Displays a mosaic view hit (blog, video, title, audio).
     * @param {Object} hit - The search hit object.
     * @param {string} context - The search context (e.g., "blogPosts", "videos").
     * @returns {HTMLElement|null} The created custom element or null.
     */
    _displayMosaicHit(hit, context) {
        let cardElement = null;
        let id = null;
        let dataObject = null;
        console.log("Displaying hit in mosaic view:", hit);
        if (typeof hit?.hasTitle === "function" && hit.hasTitle()) {
            dataObject = hit.getTitle();
            id = `_flip_card_${getUuidByString(dataObject.getName())}`;
            cardElement = new SearchTitleCard();
        } else if (typeof hit?.hasVideo === "function" && hit.hasVideo()) {
            console.log("Displaying video hit in mosaic view:", hit);
            dataObject = hit.getVideo();
            id = `_video_card_${getUuidByString(dataObject.getId())}`;
            cardElement = new SearchVideoCard();
        } else if (typeof hit?.hasAudio === "function" && hit.hasAudio()) {
            dataObject = hit.getAudio();
            id = `_audio_card_${getUuidByString(dataObject.getId())}`; // Use ID for audio card
            cardElement = new SearchAudioCard();
        } else if (typeof hit?.hasBlog === "function" && hit.hasBlog()) {
            dataObject = hit.getBlog();
            id = `_blog_info_${dataObject.getUuid()}`; // Use blog UUID
            cardElement = new BlogPostInfo(); // Assumed to have a short mode or a setter for it
            cardElement.isShort = true; // Set short mode for BlogPostInfo
        }

        if (cardElement && dataObject) {
            dataObject.globule = hit.globule; // Attach globule context

            cardElement.id = id;
            const slotContext = this._getSlotContext(hit, context);
            cardElement.slot = `mosaic_${slotContext}`; // Assign to correct slot
            if (cardElement instanceof SearchVideoCard && typeof cardElement.setIndexPath === "function") {
                cardElement.setIndexPath(`/search/${slotContext}`);
            }

            // Set data on the specific card type
        if (cardElement instanceof SearchTitleCard && typeof cardElement.setTitle === "function") cardElement.setTitle(dataObject);
        else if (cardElement instanceof SearchVideoCard && typeof cardElement.setVideo === "function") cardElement.setVideo(dataObject);
        else if (cardElement instanceof SearchAudioCard && typeof cardElement.setAudio === "function") cardElement.setAudio(dataObject);
        else if (cardElement instanceof BlogPostInfo && dataObject) cardElement.blogPost = dataObject;

            // Add filterable classes
            const addFilterableClasses = (entity, type) => {
                cardElement.classList.add("filterable");
                if (type === "title" || type === "video" || type === "audio") {
                    entity.getGenresList()?.forEach(g => g.split(" ").forEach(g_ => cardElement.classList.add(getUuidByString(g_.toLowerCase()))));
                    if (type === "video") entity.getTagsList()?.forEach(tag => cardElement.classList.add(getUuidByString(tag.toLowerCase())));

                    // Rating classes
                    if (entity.getRating) {
                        const rating = entity.getRating();
                        if (rating < 3.5) cardElement.classList.add(getUuidByString("low"));
                        else if (rating < 7.0) cardElement.classList.add(getUuidByString("medium"));
                        else cardElement.classList.add(getUuidByString("high"));
                    }
                    if (type === "title" && entity.getType) { // Add title type as class
                        cardElement.classList.add(getUuidByString(entity.getType().toLowerCase()));
                    }
                } else if (type === "blog") {
                    entity.getKeywordsList()?.forEach(kw => cardElement.classList.add(getUuidByString(kw.toLowerCase())));
                }
            };
            // Call for the specific data object
            if (typeof hit?.hasTitle === "function" && hit.hasTitle()) addFilterableClasses(hit.getTitle(), "title");
            else if (typeof hit?.hasVideo === "function" && hit.hasVideo()) addFilterableClasses(hit.getVideo(), "video");
            else if (typeof hit?.hasAudio === "function" && hit.hasAudio()) addFilterableClasses(hit.getAudio(), "audio");
            else if (typeof hit?.hasBlog === "function" && hit.hasBlog()) addFilterableClasses(hit.getBlog(), "blog");

            return cardElement;
        }
        return null;
    }

    /**
     * Displays a list view hit (blog, video, title, audio).
     * @param {Object} hit - The search hit object.
     * @param {string} context - The search context (e.g., "blogPosts", "videos").
     * @returns {HTMLElement|null} The created div element for list view or null.
     */
    _displayListHit(hit, context) {
        let titleName = "";
        let uuid = null;
        let infoDisplay = null; // InformationsManager instance

        const baseUuid = typeof hit?.getId === "function" ? hit.getId() : `${Math.random()}`;

        if (typeof hit?.hasTitle === "function" && hit.hasTitle()) {
            titleName = hit.getTitle().getName();
            uuid = getUuidByString(baseUuid + "_list_title"); // Use hit ID for uniqueness
            infoDisplay = new InformationsManager();
            infoDisplay.setTitlesInformation([hit.getTitle()]);
        } else if (typeof hit?.hasVideo === "function" && hit.hasVideo()) {
            titleName = hit.getVideo().getDescription(); // Use description as title for video
            uuid = getUuidByString(baseUuid + "_list_video");
            infoDisplay = new InformationsManager();
            infoDisplay.setVideosInformation([hit.getVideo()]);
        } else if (typeof hit?.hasAudio === "function" && hit.hasAudio()) {
            titleName = hit.getAudio().getTitle(); // Use audio title
            uuid = getUuidByString(baseUuid + "_list_audio");
            infoDisplay = new InformationsManager();
            infoDisplay.setAudiosInformation([hit.getAudio()]);
        } else if (typeof hit?.hasBlog === "function" && hit.hasBlog()) {
            titleName = hit.getBlog().getTitle(); // Use blog title
            uuid = getUuidByString(hit.getBlog().getUuid() + "_list_blog");
            infoDisplay = new InformationsManager();
            infoDisplay.setBlogPostInformation(hit.getBlog());
        } else {
            return null; // Unknown hit type
        }

        // Create the main hit div
        const hitDiv = document.createElement("div");
        hitDiv.id = `hit-div-${uuid}`;
        hitDiv.classList.add("hit-div", "filterable", context); // Add context class
        const listSlotContext = this._getSlotContext(hit, context);
        hitDiv.slot = `list_${listSlotContext}`; // Assign to list slot

        hitDiv.innerHTML = `
            <style>
                .hit-div {
                    display: flex;
                    flex-direction: column;
                    padding: 10px;
                    border: 1px solid var(--palette-divider);
                    border-radius: 8px;
                    margin-bottom: 15px;
                    background-color: var(--surface-color);
                    box-shadow: var(--shadow-elevation-2dp);
                    width: 100%; /* Take full width of parent list slot */
                    box-sizing: border-box;
                }
                .hit-header-div {
                    display: flex;
                    align-items: center;
                    font-size: 1.1rem;
                    font-weight: 500;
                    border-bottom: 1px solid var(--palette-divider-light);
                    padding-bottom: 8px;
                    margin-bottom: 8px;
                }
                .hit-index-div { margin-right: 10px; color: var(--secondary-text-color); }
                .hit-title-name-div { flex-grow: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
                .hit-score-div { margin-left: 10px; color: var(--secondary-text-color); }

                .snippets-div {
                    display: flex; flex-direction: column; padding: 10px 0;
                }
                .snippet-field { font-weight: bold; margin-bottom: 5px; color: var(--primary-color); }
                .snippet-fragments div { padding-bottom: 5px; line-height: 1.4; }

                .title-info-wrapper {
                    padding-top: 10px; border-top: 1px solid var(--palette-divider-light); margin-top: 10px;
                }
            </style>
            <div class="hit-header-div">
                <span class="hit-index-div">${hit.getIndex() + 1}.</span>
                <span class="hit-title-name-div">${titleName}</span>
                <span class="hit-score-div">${hit.getScore().toFixed(3)}</span>
            </div>
            <div class="snippets-div"></div>
            <div class="title-info-wrapper"></div>
        `;

        // Append snippets
        const snippetDiv = hitDiv.querySelector(`.snippets-div`);
        hit.getSnippetsList().forEach(snippet => {
            const snippetBlock = document.createElement("div");
            snippetBlock.innerHTML = `
                <div class="snippet-field">${snippet.getField()}</div>
                <div class="snippet-fragments"></div>
            `;
            const fragmentContainer = snippetBlock.querySelector(".snippet-fragments");
            snippet.getFragmentsList().forEach(f => {
                const fragmentLine = document.createElement("div");
                fragmentLine.innerHTML = f;
                fragmentContainer.appendChild(fragmentLine);
            });
            snippetDiv.appendChild(snippetBlock);
        });

        // Append InformationsManager
        const titleInfoWrapper = hitDiv.querySelector(`.title-info-wrapper`);
        if (titleInfoWrapper && infoDisplay) {
            infoDisplay.hideHeader(); // Hide header if integrated directly
            titleInfoWrapper.appendChild(infoDisplay);
        }

        // Add filterable classes (same logic as _displayMosaicHit)
        const addFilterableClasses = (entity, type) => {
            if (type === "title" || type === "video" || type === "audio") {
                entity.getGenresList()?.forEach(g => g.split(" ").forEach(g_ => hitDiv.classList.add(getUuidByString(g_.toLowerCase()))));
                if (type === "video") entity.getTagsList()?.forEach(tag => hitDiv.classList.add(getUuidByString(tag.toLowerCase())));

                if (entity.getRating) {
                    const rating = entity.getRating();
                    if (rating < 3.5) hitDiv.classList.add(getUuidByString("low"));
                    else if (rating < 7.0) hitDiv.classList.add(getUuidByString("medium"));
                    else hitDiv.classList.add(getUuidByString("high"));
                }
                if (type === "title" && entity.getType) {
                    hitDiv.classList.add(getUuidByString(entity.getType().toLowerCase()));
                }
            } else if (type === "blog") {
                entity.getKeywordsList()?.forEach(kw => hitDiv.classList.add(getUuidByString(kw.toLowerCase())));
            }
        };

        if (hit.hasTitle()) addFilterableClasses(hit.getTitle(), "title");
        else if (hit.hasVideo()) addFilterableClasses(hit.getVideo(), "video");
        else if (hit.hasAudio()) addFilterableClasses(hit.getAudio(), "audio");
        else if (hit.hasBlog()) addFilterableClasses(hit.getBlog(), "blog");

        return hitDiv;
    }
}

customElements.define('globular-search-results-page', SearchResultsPage);
