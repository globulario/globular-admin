import getUuidByString from "uuid-by-string";
import { playAudios } from "../audio"; // Assuming playAudios exists
import { playVideos } from "../video"; // Assuming playVideos exists
import { displayError } from "@globular/backend"; // Assuming displayError exists

// Polymer component imports
import '@polymer/paper-card/paper-card.js';
import '@polymer/paper-icon-button/paper-icon-button.js';
import '@polymer/iron-icon/iron-icon.js';
import '@polymer/paper-checkbox/paper-checkbox.js';
import '@polymer/paper-ripple/paper-ripple.js'; // For paper-ripple

/**
 * Custom element that acts as a container for displaying multiple search facets (filters).
 */
export class FacetSearchFilter extends HTMLElement {
    // Private instance properties
    _page = null; // Reference to the parent search results page component
    _panels = {}; // Stores instances of SearchFacetPanel, keyed by facet field UUID

    /**
     * Constructor for the FacetSearchFilter custom element.
     * @param {HTMLElement} page - The parent search results page component.
     */
    constructor(page) {
        super();
        this.attachShadow({ mode: 'open' });
        this._page = page; // Store reference to the parent page
    }

    /**
     * Called when the element is inserted into the document's DOM.
     * Performs initial rendering.
     */
    connectedCallback() {
        this._renderInitialStructure();
        // Subsequent population handled by setFacets setter
    }

    /**
     * Renders the initial HTML structure of the facet search filter.
     * @private
     */
    _renderInitialStructure() {
        this.shadowRoot.innerHTML = `
            <style>
                #container {
                    font-size: 1.17rem;
                    padding: 10px;
                    padding-right: 30px;
                    max-width: 235px;
                    background-color: var(--surface-color); /* Ensure background */
                    color: var(--primary-text-color); /* Ensure text color */
                    height: 100%; /* Take full height of parent */
                    box-sizing: border-box; /* Include padding in dimensions */
                    overflow-y: auto; /* Enable scrolling for many facets */
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
                    #container {
                        position: initial; /* Unset fixed/absolute if needed */
                        height: 180px; /* Fixed height for mobile */
                        max-width: 100%; /* Take full width */
                        padding-right: 10px; /* Adjust padding */
                    }
                }
            </style>
            <div id="container">
               <slot name="facets"></slot> </div>
        `;
    }

    /**
     * Refreshes the display of all contained SearchFacetPanel components.
     */
    refresh() {
        for (const key in this._panels) {
            this._panels[key].refresh(); // Call refresh method on each panel
        }
    }

    /**
     * Sets the facets data and updates the display of SearchFacetPanel components.
     * @param {Object} facets - The facets object from search results.
     */
    setFacets(facets) {
        if (!facets || !facets.getFacetsList) {
            console.warn("FacetSearchFilter: Invalid facets data provided.");
            return;
        }

        // Keep track of active facet IDs to remove old ones
        const currentFacetIds = new Set();

        facets.getFacetsList().forEach(facet => {
            const id = `_${getUuidByString(facet.getField())}`;
            currentFacetIds.add(id);

            let panel = this._panels[id];
            if (!panel) {
                panel = new SearchFacetPanel(this._page); // Pass parent page
                this._panels[id] = panel;
                panel.slot = "facets"; // Assign to slot
                this.appendChild(panel); // Append to DOM
            }

            // Only update if facet has terms (total > 0)
            if (facet.getTotal() > 0) {
                panel.setFacet(facet); // Set new facet data on the panel
                panel.style.display = ''; // Ensure panel is visible
            } else {
                // If facet has no terms, hide or remove the panel
                if (panel.parentNode) {
                    panel.parentNode.removeChild(panel);
                }
                delete this._panels[id]; // Remove from internal panels map
            }
        });

        // Remove panels that are no longer present in the new facets list
        for (const id in this._panels) {
            if (!currentFacetIds.has(id)) {
                if (this._panels[id].parentNode) {
                    this._panels[id].parentNode.removeChild(this._panels[id]);
                }
                delete this._panels[id];
            }
        }
    }
}
customElements.define('globular-facet-search-filter', FacetSearchFilter);


/**
 * Custom element to display information and controls for a single search facet.
 */
export class SearchFacetPanel extends HTMLElement {
    // Private instance properties
    _page = null; // Reference to the parent search results page component
    _facet = null; // The facet object for this panel
    _terms = {}; // Stores references to rendered terms (checkboxes) for quick update

    // DOM element references
    _facetListDiv = null; // Container for facet terms checkboxes
    _fieldSpan = null; // Span for facet field name
    _totalSpan = null; // Span for facet total count
    _playFacetBtn = null; // Button to play all media in this facet
    _mainCheckbox = null; // Main checkbox for this facet field

    /**
     * Constructor for the SearchFacetPanel custom element.
     * @param {HTMLElement} page - The parent search results page component.
     */
    constructor(page) {
        super();
        this.attachShadow({ mode: 'open' });
        this._page = page; // Store reference to the parent page
    }

    /**
     * Called when the element is inserted into the document's DOM.
     * Performs initial rendering and sets up event listeners.
     */
    connectedCallback() {
        this._renderInitialStructure();
        this._getDomReferences();
        this._bindEventListeners();
        // Data population is handled by setFacet setter
    }

    /**
     * Renders the initial HTML structure of the search facet panel.
     * @private
     */
    _renderInitialStructure() {
        this.shadowRoot.innerHTML = `
            <style>
                .facet-list {
                    padding-bottom: 20px;
                    font-size: 1rem;
                    display: flex;
                    flex-direction: column; /* Stack terms vertically */
                }

                .facet-label-main { /* Style for the main facet checkbox label */
                    display: flex;
                    align-items: center;
                    font-size: 1.1rem; /* Slightly larger font for main label */
                    font-weight: 500;
                    margin-bottom: 10px; /* Space below main label */
                }
                .facet-label-main paper-checkbox {
                    margin-top: 0; /* Align with play button */
                    margin-bottom: 0;
                    --paper-checkbox-checked-color: var(--primary-color);
                    --paper-checkbox-checkmark-color: var(--on-primary-color);
                    --paper-checkbox-label-color: var(--primary-text-color);
                }

                .facet-label-main span { /* Specific span within main label */
                    margin-left: 10px;
                }

                #play_facet_btn {
                    --iron-icon-fill-color: var(--primary-color);
                    display: none; /* Hidden by default */
                    margin-right: 5px; /* Space from checkbox */
                }
                #play_facet_btn:hover { cursor: pointer; }


                .term-item {
                    display: flex;
                    align-items: center;
                    margin-left: 25px; /* Indent terms */
                    margin-top: 8px; /* Space between terms */
                    font-size: 0.95rem; /* Smaller font for terms */
                }
                .term-item paper-checkbox {
                    --paper-checkbox-checked-color: var(--primary-color);
                    --paper-checkbox-checkmark-color: var(--on-primary-color);
                    --paper-checkbox-label-color: var(--primary-text-color);
                }
                .term-count-span {
                    margin-left: 8px;
                    font-style: italic;
                    color: var(--secondary-text-color);
                }

            </style>

            <div style="display: flex; flex-direction: column;">
                <div class="facet-label-main">
                    <paper-icon-button id="play_facet_btn" icon="av:play-arrow"></paper-icon-button>
                    <paper-checkbox id="main-checkbox" checked>
                        <span id='field_span'></span>
                        <span id='total_span'></span>
                    </paper-checkbox>
                </div>
                <div class="facet-list">
                    </div>
            </div>
        `;
    }

    /**
     * Retrieves references to all necessary DOM elements.
     * @private
     */
    _getDomReferences() {
        this._facetListDiv = this.shadowRoot.querySelector(".facet-list");
        this._mainCheckbox = this.shadowRoot.querySelector("#main-checkbox");
        this._fieldSpan = this.shadowRoot.querySelector("#field_span");
        this._totalSpan = this.shadowRoot.querySelector("#total_span");
        this._playFacetBtn = this.shadowRoot.querySelector("#play_facet_btn");
    }

    /**
     * Binds event listeners to interactive elements.
     * @private
     */
    _bindEventListeners() {
        if (this._mainCheckbox) {
            this._mainCheckbox.addEventListener('click', this._handleMainCheckboxClick.bind(this));
            this._mainCheckbox.addEventListener('change', this._handleMainCheckboxChange.bind(this)); // For controlled updates
        }
        if (this._playFacetBtn) {
            this._playFacetBtn.addEventListener('click', this._handlePlayFacetClick.bind(this));
        }
    }

    /**
     * Refreshes the display of the facet panel, particularly term counts.
     */
    refresh() {
        this._totalSpan.textContent = `(${this._page.getTotal()})`; // Update total count for this facet panel

        for (const key in this._terms) {
            const termData = this._terms[key];
            const count = this._page.countElementByClassName(termData.className);

            if (count > 0) {
                termData.countSpan.textContent = `(${count})`;
                if (termData.itemElement && !termData.itemElement.parentNode) {
                    this._facetListDiv.appendChild(termData.itemElement); // Re-append if it was removed
                }
            } else if (termData.itemElement && termData.itemElement.parentNode) {
                termData.itemElement.parentNode.removeChild(termData.itemElement); // Remove if count is zero
            }
        }
    }

    /**
     * Sets the facet data for this panel and renders its terms.
     * @param {Object} facet - The facet object (from search results).
     */
    setFacet(facet) {
        this._facet = facet;
        this.id = `_${getUuidByString(facet.getField())}`; // Set unique ID for the panel

        this._fieldSpan.textContent = facet.getField();
        this._totalSpan.textContent = `(${this._page.getTotal()})`; // Update total count

        this._renderTerms(); // Render the individual terms (checkboxes)
    }

    /**
     * Renders the individual terms (checkboxes) within this facet panel.
     * @private
     */
    _renderTerms() {
        if (!this._facetListDiv) return;

        // Clear existing terms before re-rendering
        this._facetListDiv.innerHTML = "";
        this._terms = {}; // Reset internal terms map

        const terms = this._facet.getTermsList().sort((a, b) => {
            // Sort alphabetically by term
            return a.getTerm().localeCompare(b.getTerm());
        });

        // Show play facet button if any media is associated with this field
        const audiosInFacet = this._page.getAudios(this._facet.getField());
        const videosInFacet = this._page.getVideos(this._facet.getField(), this._facet.getField()); // Pass field as context
        this._playFacetBtn.style.display = (audiosInFacet.length > 0 || videosInFacet.length > 0) ? "block" : "none";


        terms.forEach(termObj => {
            let termText = termObj.getTerm();
            let className = termObj.getTerm(); // Class name for filtering

            if (termText.startsWith("{")) {
                try {
                    const obj = JSON.parse(termText);
                    termText = `${obj.name} ${obj.min}-${obj.max}`;
                    className = obj.name;
                } catch (e) {
                    console.warn("SearchFacetPanel: Failed to parse JSON term:", termText, e);
                }
            }

            const uuid = `_${getUuidByString(className)}`;
            const count = this._page.countElementByClassName(className); // Initial count

            // Create the term item HTML
            const itemElement = document.createElement('div');
            itemElement.id = `${uuid}_div`;
            itemElement.classList.add('term-item');
            itemElement.innerHTML = `
                <paper-icon-button id="${uuid}_play_btn" icon="av:play-arrow" style="display: none;"></paper-icon-button>
                <paper-checkbox id="${uuid}" class="${className}" checked>
                    <div class="facet-label">${termText} <span id="${uuid}_total" class="term-count-span">(${count})</span></div>
                </paper-checkbox>
            `;

            this._facetListDiv.appendChild(itemElement);

            // Store references
            const checkbox = itemElement.querySelector(`#${uuid}`);
            const playBtn = itemElement.querySelector(`#${uuid}_play_btn`);
            const countSpan = itemElement.querySelector(`#${uuid}_total`);

            this._terms[uuid] = {
                itemElement: itemElement,
                checkbox: checkbox,
                playBtn: playBtn,
                countSpan: countSpan,
                className: className,
                termData: termObj // Store original term data
            };

            // Bind individual term event listeners
            this._bindTermEventListeners(this._terms[uuid]);

            // Show play button for individual term if media exists
            const audiosForTerm = this._page.getAudios(className);
            const videosForTerm = this._page.getVideos(className, this._facet.getField());
            playBtn.style.display = (audiosForTerm.length > 0 || videosForTerm.length > 0) ? "block" : "none";
        });
    }

    /**
     * Binds event listeners for individual term checkboxes and play buttons.
     * @param {Object} termData - The object containing references for a specific term item.
     * @private
     */
    _bindTermEventListeners(termData) {
        const { itemElement, checkbox, playBtn, className, termData: originalTermData } = termData;

        // Checkbox click/change handler
        checkbox.addEventListener('click', () => { // Use click for immediate action
            this._page.hideAll(); // Hide all results initially
            if (!checkbox.checked) {
                 // If unchecking, ensure main checkbox is also unchecked if no other terms are checked
                const checkedTerms = Object.values(this._terms).filter(t => t.checkbox.checked);
                if (checkedTerms.length === 0) {
                    this._mainCheckbox.checked = false;
                }
            } else {
                // If checking, re-check main checkbox
                this._mainCheckbox.checked = true;
            }

            // Iterate over all terms to apply filter
            Object.values(this._terms).forEach(t => {
                if (t.checkbox.checked) {
                    this._page.showAll(t.className); // Show elements matching the checked term
                }
            });

            this._page.offset = 0; // Reset pagination
            this._page.refresh(); // Refresh total count and navigator
            this._page.refreshNavigatorAndContextSelector(); // Refresh context selector if needed
        });

        // Play button for individual term
        playBtn.addEventListener('click', () => {
            const audios = this._page.getAudios(className);
            const videos = this._page.getVideos(className, this._facet.getField()); // Pass field as context

            if (audios.length > 0) {
                playAudios(audios, termData.termData.getTerm()); // Play only audios for this term
            } else if (videos.length > 0) {
                playVideos(videos, termData.termData.getTerm()); // Play only videos for this term
            } else {
                displayError("No media found for this filter!", 3000);
            }
        });
    }

    /**
     * Handles the click event for the main facet checkbox.
     * Toggles visibility of all search results or specific ones.
     * @private
     */
    _handleMainCheckboxClick() {
        // This is a click event, so checkbox.checked reflects the *new* state
        if (this._mainCheckbox.checked) {
            this._page.showAll(); // Show all elements if main is checked
        } else {
            this._page.hideAll(); // Hide all if main is unchecked
        }
        // Then, set/unset all sub-checkboxes
        Object.values(this._terms).forEach(termData => {
            termData.checkbox.checked = this._mainCheckbox.checked;
        });

        this._page.offset = 0;
        this._page.refresh();
        this._page.refreshNavigatorAndContextSelector();
    }

    /**
     * Handles the change event for the main facet checkbox.
     * Used for controlled updates of sub-checkboxes' states.
     * @private
     */
    _handleMainCheckboxChange() {
        // The click handler already handles the main logic,
        // this is more for reacting to state changes.
        // It ensures internal state aligns after any click.
    }


    // Public getters for media lists (delegating to _page)
    getAudios(className) {
        return this._page.getAudios(className);
    }

    getVideos(className, field) {
        return this._page.getVideos(className, field);
    }
}

customElements.define('globular-facet', SearchFacetPanel);