import '@polymer/iron-icons/iron-icons.js';
import '@polymer/paper-icon-button/paper-icon-button.js';
import '@polymer/paper-input/paper-input.js';
import '@polymer/paper-card/paper-card.js';
import '@polymer/paper-button/paper-button.js';
import '@polymer/paper-checkbox/paper-checkbox.js';
import '@polymer/paper-badge/paper-badge.js';
import '@polymer/paper-tooltip/paper-tooltip.js';
import '@polymer/paper-radio-button/paper-radio-button.js';
import '@polymer/paper-radio-group/paper-radio-group.js';
import '@polymer/paper-toggle-button/paper-toggle-button.js';
import '@polymer/paper-spinner/paper-spinner.js';

import { fireResize } from './utility'; // Assuming this is functional
import { Backend } from '../backend/backend'; // Assuming Backend is configured

// --- Constants for CSS Classes ---
const CLASS_STEP_NUMBER = 'step-number';
const CLASS_STEP_NUMBER_DISABLED = 'step-number-disabled'; // Renamed to avoid 'disable' keyword conflict
const CLASS_STEP_NUMBER_ACTIVE = 'step-number-active';

/**
 * Wizard Web Component for multi-step flows.
 * Manages pages, navigation, and progress indicators.
 */
export class Wizard extends HTMLElement {
    // --- Class Properties ---
    pages = []; // Stores the actual content elements for each page
    stepButtons = []; // Stores the step number button elements
    currentIndex = 0; // The current active page index

    initialWidth = 0; // The initial width of the wizard

    // DOM element references (will be cached in constructor/connectedCallback)
    containerElement = null;
    contentWrapper = null;
    pagesContainer = null;
    actionButtonsDiv = null;
    stepNumbersDiv = null;
    nextBtn = null;
    previousBtn = null;
    doneBtn = null;
    closeBtn = null;
    summaryPageElement = null; // Reference to the summary page content

    // Callbacks for wizard events
    onDone = null;
    onClose = null;

    // --- Constructor ---
    constructor(initialWidth = 700) { // Default width if none provided
        super();
        this.attachShadow({ mode: 'open' });

        this.initialWidth = Math.min(initialWidth, window.innerWidth);

        // --- Initial HTML Structure (Styling first) ---
        this.shadowRoot.innerHTML = `
            <style>
                #container h3 {
                    margin-block-end: 0px;
                }

                paper-input iron-icon {
                    margin-right: 10px;
                }

                paper-tooltip p {
                    min-width: 200px;
                    font-size: 1.35em;
                }

                .${CLASS_STEP_NUMBER} {
                    position: relative;
                    display: flex;
                    justify-content: center;
                    align-items: center;
                    margin: 5px 10px;
                    width: 30px;
                    height: 30px;
                    border-radius: 17px;
                    border: 2px solid var(--paper-grey-500, #9e9e9e); /* Default disabled color */
                    color: var(--paper-grey-500, #9e9e9e);
                    transition: all 0.3s ease-in-out;
                }

                .${CLASS_STEP_NUMBER} paper-ripple {
                    display: none; /* Hide ripple by default, show on active/disabled */
                }

                .${CLASS_STEP_NUMBER}:hover {
                    cursor: pointer;
                }

                .${CLASS_STEP_NUMBER_DISABLED} {
                    border-color: var(--paper-grey-500, #9e9e9e);
                    background-color: var(--paper-grey-200, #eeeeee); /* Lighter background for disabled */
                }

                .${CLASS_STEP_NUMBER_ACTIVE} {
                    border-color: var(--paper-blue-500, #2196F3); /* Active border color */
                    color: var(--paper-light-blue-500, #03A9F4); /* Active text color */
                    background-color: var(--surface-color, white); /* Surface color for active */
                }

                .${CLASS_STEP_NUMBER_ACTIVE} paper-ripple,
                .${CLASS_STEP_NUMBER_DISABLED} paper-ripple {
                    display: block; /* Show ripple on interactive states */
                }

                #container {
                    display: flex;
                    flex-direction: column;
                    width: 100%;
                    height: 100%;
                    background-color: var(--surface-color, white);
                    overflow: hidden; /* Ensure content doesn't overflow */
                }

                #pages {
                    display: flex;
                    transition: transform 0.6666s ease-in-out; /* Smooth transition */
                    height: 100%; /* Ensure pages take full height for scrolling */
                }

                /* Styling for individual wizard pages slotted */
                .wizard-page {
                    flex-shrink: 0; /* Prevent pages from shrinking */
                    width: 100%; /* Default width, adjusted by JS */
                    max-width: 100%;
                    min-width: 100%;
                    overflow-y: auto;
                    box-sizing: border-box; /* Include padding in width */
                    padding: 15px; /* Apply padding consistently */
                }

                ::-webkit-scrollbar { width: 5px; height: 5px; }
                ::-webkit-scrollbar-track { background: var(--surface-color); }
                ::-webkit-scrollbar-thumb { background: var(--palette-divider); }

                .content-area { /* Renamed from .content to avoid conflict with slot name */
                    flex-grow: 1;
                    overflow-y: auto;
                    overflow-x: hidden;
                    display: flex; /* Make it a flex container for #pages */
                    flex-direction: column; /* Allow pages to stack */
                }

                .card-actions {
                    display: flex;
                    width: 100%;
                    justify-content: flex-end;
                    align-items: center; /* Vertically align buttons */
                    padding: 8px 16px; /* Add some padding */
                    border-top: 1px solid var(--paper-grey-200, #eeeeee); /* Separator */
                    box-sizing: border-box;
                }

                paper-button {
                    font-size: 1rem;
                    text-transform: uppercase; /* Standard button style */
                    margin-left: 8px; /* Space between buttons */
                }

                #step-numbers {
                    display: flex;
                    flex-grow: 1;
                    flex-wrap: wrap;
                    justify-content: flex-start;
                    align-items: center;
                }
            </style>

            <div id="container">
                <div class="content-area" id="content-area">
                    <div id="pages">
                        <slot name="pages-slot"></slot> </div>
                    <slot name="summary-page-slot"></slot> </div>

                <div class="card-actions" id="card-actions">
                    <div id="step-numbers"></div>
                    <paper-button id="previous-btn" style="display:none">Previous</paper-button>
                    <paper-button id="next-btn">Next</paper-button>
                    <paper-button id="done-btn" style="display:none">Done</paper-button>
                    <paper-button id="close-btn" style="display:none">Close</paper-button>
                </div>
            </div>
        `;
    }

    // --- Lifecycle Callbacks ---
    connectedCallback() {
        this._cacheElements();
        this._setInitialWidth();
        this._setupEventListeners();
        this._initializeWizardState(); // Call after elements are cached and listeners set
        fireResize(); // Trigger global resize for initial layout
    }

    disconnectedCallback() {
        this._cleanupEventListeners();
    }

    // --- Private Helper Methods ---

    /** Caches references to frequently used DOM elements. */
    _cacheElements() {
        this.containerElement = this.shadowRoot.getElementById("container");
        this.contentWrapper = this.shadowRoot.getElementById("content-area");
        this.pagesContainer = this.shadowRoot.getElementById("pages");
        this.actionButtonsDiv = this.shadowRoot.getElementById("card-actions");
        this.stepNumbersDiv = this.shadowRoot.getElementById("step-numbers");

        this.nextBtn = this.shadowRoot.getElementById("next-btn");
        this.previousBtn = this.shadowRoot.getElementById("previous-btn");
        this.doneBtn = this.shadowRoot.getElementById("done-btn");
        this.closeBtn = this.shadowRoot.getElementById("close-btn");
    }

    /** Sets the initial width of the wizard container. */
    _setInitialWidth() {
        this.containerElement.style.width = `${this.initialWidth}px`;
    }

    /** Sets up all event listeners for the component. */
    _setupEventListeners() {
        this.nextBtn.addEventListener('click', this._handleNextClick);
        this.previousBtn.addEventListener('click', this._handlePreviousClick);
        this.doneBtn.addEventListener('click', this._handleDoneClick);
        this.closeBtn.addEventListener('click', this._handleCloseClick);

        window.addEventListener("resize", this._handleResize);
        // Custom event for updating step button state
        this.addEventListener('wizard-page-validity-change', this._handlePageValidityChange);
    }

    /** Cleans up all event listeners. */
    _cleanupEventListeners() {
        this.nextBtn.removeEventListener('click', this._handleNextClick);
        this.previousBtn.removeEventListener('click', this._handlePreviousClick);
        this.doneBtn.removeEventListener('click', this._handleDoneClick);
        this.closeBtn.removeEventListener('click', this._handleCloseClick);
        window.removeEventListener("resize", this._handleResize);
        this.removeEventListener('wizard-page-validity-change', this._handlePageValidityChange);
    }

    /** Initializes the wizard state on first connection. */
    _initializeWizardState() {
        this._updateNavigationButtons();
        // Set initial state for step numbers (first one active)
        if (this.stepButtons.length > 0) {
            this.stepButtons[0].classList.add(CLASS_STEP_NUMBER_ACTIVE);
        }
        this._applyPageStyles(); // Apply initial width to pages
    }

    /** Handles clicks on the "Next" button. */
    _handleNextClick = () => {
        this.next();
    };

    /** Handles clicks on the "Previous" button. */
    _handlePreviousClick = () => {
        this.previous();
    };

    /** Handles clicks on the "Done" button. */
    _handleDoneClick = () => {
        this._showSummaryPage();
        if (this.onDone) {
            this.onDone(this.summaryPageElement);
        }
    };

    /** Handles clicks on the "Close" button. */
    _handleCloseClick = () => {
        this.parentNode?.removeChild(this); // Safely remove component
        if (this.onClose) {
            this.onClose();
        }
    };

    /** Handles window resize events. */
    _handleResize = () => {
        // Get the parent's actual width to set wizard's width responsively
        const newWidth = this.parentNode ? this.parentNode.offsetWidth : window.innerWidth;
        const currentWizardWidth = this.containerElement.offsetWidth;

        // Only resize if there's a significant change or if it's initial setup
        if (Math.abs(newWidth - currentWizardWidth) > 5) { // Threshold for resizing
            this.initialWidth = Math.min(newWidth, window.innerWidth); // Clamp to screen width

            this.containerElement.style.width = `${this.initialWidth}px`;
            
            // Reapply page widths for responsive layout
            this._applyPageStyles();
            this._updatePageTransform(); // Adjust transform after width change
        }
    };

    /** Handles custom events for page validity changes (e.g., from an input field). */
    _handlePageValidityChange = (evt) => {
        const { isValid } = evt.detail;
        if (isValid) {
            this.enableNextBtn();
        } else {
            this.disableNextBtn();
        }
    };

    /** Updates the visibility of navigation buttons based on current index. */
    _updateNavigationButtons() {
        const isLastPage = this.currentIndex === this.pages.length - 1;
        const hasMultiplePages = this.pages.length > 1;

        this.nextBtn.style.display = isLastPage ? 'none' : 'block';
        this.doneBtn.style.display = isLastPage ? 'block' : 'none';
        this.previousBtn.style.display = this.currentIndex > 0 && hasMultiplePages ? 'block' : 'none';
        this.closeBtn.style.display = 'none'; // Only shown after done
    }

    /** Updates the CSS transform for page transitions. */
    _updatePageTransform() {
        this.pagesContainer.style.transform = `translateX(${this.currentIndex * this.containerElement.offsetWidth * -1}px)`;
    }

    /** Applies width styles to all pages and the summary page. */
    _applyPageStyles() {
        const pageElements = [...this.pages, this.summaryPageElement].filter(Boolean); // Include summary if present
        const currentWidth = this.containerElement.offsetWidth;

        pageElements.forEach(p => {
            p.style.width = `${currentWidth}px`;
            p.style.maxWidth = `${currentWidth}px`;
            p.style.minWidth = `${currentWidth}px`;
        });
    }

    /** Shows the summary page and hides regular navigation. */
    _showSummaryPage() {
        this.nextBtn.style.display = 'none';
        this.previousBtn.style.display = 'none';
        this.doneBtn.style.display = 'none';
        this.stepNumbersDiv.style.display = 'none';
        this.pagesContainer.style.display = 'none';
        this.pagesContainer.style.transform = `translateX(0px)`; // Reset transform

        this.closeBtn.style.display = 'block';

        if (this.summaryPageElement) {
            this.summaryPageElement.style.display = 'block';
        }
    }

    /** Updates the active/disabled state of step number buttons. */
    _updateStepButtonStates() {
        this.stepButtons.forEach((btn, index) => {
            btn.classList.remove(CLASS_STEP_NUMBER_ACTIVE, CLASS_STEP_NUMBER_DISABLED);
            if (index === this.currentIndex) {
                btn.classList.add(CLASS_STEP_NUMBER_ACTIVE);
            } else if (index < this.currentIndex) { // Pages already visited
                btn.classList.add(CLASS_STEP_NUMBER_DISABLED);
            }
            // For future pages, no special class by default
        });
    }

    // --- Public API Methods ---

    /**
     * Gets a page by its index.
     * @param {number} index The index of the page.
     * @returns {HTMLElement|undefined} The page element.
     */
    getPage(index) {
        return this.pages[index];
    }

    /**
     * Returns an element from inside the wizard's shadow DOM by ID.
     * @param {string} id The ID of the element.
     * @returns {HTMLElement|null} The element found.
     */
    getElementById(id) {
        return this.shadowRoot.getElementById(id);
    }

    /**
     * Returns a list of elements from inside the wizard's shadow DOM by class name.
     * @param {string} className The class name to search for.
     * @returns {NodeListOf<HTMLElement>} A NodeList of matching elements.
     */
    getElementsByClassName(className) {
        return this.shadowRoot.querySelectorAll(`.${className}`);
    }

    /**
     * Sets the content for the wizard's summary page.
     * @param {HTMLElement} content The DOM element for the summary page content.
     */
    setSummaryPage(content) {
        const summaryWrapper = document.createElement("div");
        summaryWrapper.id = "summary_page_wrapper"; // Unique ID
        summaryWrapper.className = "wizard-page"; // Re-use page styling
        summaryWrapper.slot = "summary-page-slot"; // Assign to named slot
        summaryWrapper.style.display = "none"; // Hidden initially
        summaryWrapper.appendChild(content);

        this.appendChild(summaryWrapper);
        this.summaryPageElement = summaryWrapper; // Cache reference
        this._applyPageStyles(); // Apply initial width
    }

    /**
     * Appends a new configuration page to the wizard.
     * @param {HTMLElement} content The DOM element for the page content.
     */
    appendPage(content) {
        const pageWrapper = document.createElement("div");
        pageWrapper.className = "wizard-page"; // Apply common page styles
        pageWrapper.id = `page_${this.pages.length + 1}`; // Unique ID

        pageWrapper.appendChild(content);
        pageWrapper.slot = "pages-slot"; // Assign to named slot

        this.appendChild(pageWrapper); // Append to the light DOM, slotted into shadow DOM

        const stepNumberBtn = document.createElement("div");
        stepNumberBtn.className = CLASS_STEP_NUMBER;
        stepNumberBtn.innerHTML = `
            ${this.pages.length + 1}
            <paper-ripple class="circle" recenters></paper-ripple>`;

        stepNumberBtn.dataset.index = this.pages.length.toString(); // Use dataset for index
        this.stepNumbersDiv.appendChild(stepNumberBtn);

        this.pages.push(pageWrapper); // Store the page wrapper
        this.stepButtons.push(stepNumberBtn); // Store the step button

        // Set initial active state for the first page
        if (this.pages.length === 1) {
            stepNumberBtn.classList.add(CLASS_STEP_NUMBER_ACTIVE);
        } else {
            stepNumberBtn.classList.add(CLASS_STEP_NUMBER_DISABLED);
        }

        // Add click listener for step number buttons
        stepNumberBtn.addEventListener('click', this._handleStepButtonClick);

        this._applyPageStyles(); // Apply current width to the new page
    }

    /** Handles clicks on a step number button. */
    _handleStepButtonClick = (evt) => {
        const clickedIndex = parseInt(evt.currentTarget.dataset.index);

        // Only allow navigation to active or disabled (already visited) steps
        if (clickedIndex > this.currentIndex && !evt.currentTarget.classList.contains(CLASS_STEP_NUMBER_DISABLED)) {
            return; // Cannot jump forward to unvisited steps (unless explicitly designed)
        }

        this.currentIndex = clickedIndex;
        this._updatePageTransform();
        this._updateStepButtonStates();
        this._updateNavigationButtons();

        // Publish local event for page change
        Backend.eventHub.publish("wizard_page_changed", { index: this.currentIndex }, true);
    };

    /** Disables the "Next" button. */
    disableNextBtn() {
        this.nextBtn.setAttribute("disabled", "");
    }

    /** Enables the "Next" button. */
    enableNextBtn() {
        this.nextBtn.removeAttribute("disabled");
    }

    /** Navigates to the next page in the wizard. */
    next() {
        if (this.currentIndex < this.pages.length - 1) {
            this.currentIndex++;
            this._updatePageTransform();
            this._updateStepButtonStates();
            this._updateNavigationButtons();

            Backend.eventHub.publish("wizard_next_page_evt", { index: this.currentIndex }, true);
        }
    }

    /** Navigates to the previous page in the wizard. */
    previous() {
        if (this.currentIndex > 0) {
            this.currentIndex--;
            this._updatePageTransform();
            this._updateStepButtonStates();
            this._updateNavigationButtons();

            Backend.eventHub.publish("wizard_previous_page_evt", { index: this.currentIndex }, true);
        }
    }
}

customElements.define('globular-wizard', Wizard);