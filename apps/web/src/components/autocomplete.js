import '@polymer/iron-icons/iron-icons.js';
import '@polymer/paper-icon-button/paper-icon-button.js';
import '@polymer/paper-input/paper-input.js'; // Assuming this import makes paper-input available
import '@polymer/paper-card/paper-card.js';

/**
 * The `globular-autocomplete` Web Component provides type-ahead suggestions for a text input.
 * It expects `getValues` and `displayValue` functions to be set on its instance.
 *
 * Properties:
 * - `label` (attribute): The label for the paper-input.
 * - `type` (attribute): The type for the paper-input (e.g., "text", "email").
 * - `width` (attribute): The width of the component. Defaults to "100%".
 * - `getValues` (function): A function `(inputValue) => Promise<Array>` that returns a promise of suggestions.
 * - `displayValue` (function): A function `(value) => HTMLElement` that returns a DOM element for a suggestion.
 *
 * Methods:
 * - `focus()`: Sets focus on the input element.
 * - `setValues(values)`: Programmatically sets the displayed suggestion values.
 * - `getValue()`: Gets the current value of the input.
 * - `clear()`: Clears the input and suggestions.
 */
export class Autocomplete extends HTMLElement {
    // --- Internal Properties (using _ convention for "private-like") ---
    _getValues = null; // Function to fetch values
    _displayValue = null; // Function to render a single value
    _inputElement = null; // Cached reference to paper-input
    _valuesDiv = null; // Cached reference to the suggestions container
    _currentWidth = "100%"; // Stored width
    _highlightedIndex = -1; // Index of the currently highlighted suggestion
    _debounceTimeout = null; // For input debouncing
    _isComposing = false; // To handle CJK input method editors

    // --- Constructor ---
    constructor() {
        super();
        this.attachShadow({ mode: 'open' });

        this._renderHTML(); // Render HTML in constructor
    }

    // --- Lifecycle Callbacks ---
    connectedCallback() {
        this._cacheElements(); // Cache elements after render
        this._applyInitialAttributes(); // Apply attributes and set up width
        this._setupEventListeners(); // Set up event listeners
    }

    disconnectedCallback() {
        this._cleanupEventListeners(); // Clean up event listeners
    }

    // --- Public Properties (Setters/Getters) ---
    set getValues(func) {
        if (typeof func === 'function') {
            this._getValues = func;
        } else {
            console.error("Autocomplete: 'getValues' must be a function.");
            this._getValues = null;
        }
    }

    get getValues() {
        return this._getValues;
    }

    set displayValue(func) {
        if (typeof func === 'function') {
            this._displayValue = func;
        } else {
            console.error("Autocomplete: 'displayValue' must be a function.");
            this._displayValue = null;
        }
    }

    get displayValue() {
        return this._displayValue;
    }

    // --- Private Helper Methods ---

    _renderHTML() {
        const label = this.getAttribute("label") || "";
        const type = this.getAttribute("type") || "text";
        // Use CSS variables or classes for width instead of inline style for better management
        this.shadowRoot.innerHTML = `
        <style>
            :host {
                display: block; /* Ensure it takes up space */
                width: var(--autocomplete-width, 100%); /* Use CSS variable for width */
            }
            paper-card {
                background-color: var(--surface-elevated-color, #fff);
                color: var(--primary-text-color, #1d2025);
                border: 1px solid var(--border-subtle-color, var(--divider-color));
                border-radius: 8px;
                max-height: 320px;
                overflow-y: hidden;
                width: 100%;
                z-index: 10;
                position: absolute;
                box-shadow: 0 16px 32px rgba(15, 23, 42, 0.2);
                display: none;
            }
            paper-input {
                width: 100%;
                --paper-input-container-input-color: var(--primary-text-color);
                --paper-input-container-focus-color: var(--primary-color);
                --paper-input-container-color: var(--secondary-text-color);
            }
            #autocomplete-div {
                position: relative; /* Needed for absolute positioning of paper-card */
                width: 100%;
            }
            .suggestion-item {
                padding: 10px 12px;
                cursor: pointer;
                transition: background-color 0.2s ease, color 0.2s ease;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }
            .suggestion-item:hover, .suggestion-item.highlighted {
                background-color: color-mix(in srgb, var(--primary-color) 12%, transparent);
                color: var(--primary-text-color);
            }
        </style>

        <div id="autocomplete-div">
            <paper-input id='input' type='${type}' label='${label}'></paper-input>
            <paper-card id="values_div"> </paper-card>
        </div>
        `;
    }

    _cacheElements() {
        this._inputElement = this.shadowRoot.getElementById("input");
        this._valuesDiv = this.shadowRoot.getElementById("values_div");
    }

    _applyInitialAttributes() {
        // Set width using CSS variable
        const widthAttr = this.getAttribute("width");
        if (widthAttr) {
            this._currentWidth = widthAttr; // Store it
            this.style.setProperty('--autocomplete-width', widthAttr);
        } else {
            this.style.setProperty('--autocomplete-width', this._currentWidth);
        }

        // Apply label and type which are already set in _renderHTML
    }

    _setupEventListeners() {
        if (this._inputElement) {
            this._inputElement.addEventListener('input', this._handleInput);
            this._inputElement.addEventListener('focus', this._handleFocus);
            this._inputElement.addEventListener('blur', this._handleBlur);
            this._inputElement.addEventListener('keydown', this._handleKeydown);
            this._inputElement.addEventListener('compositionstart', this._handleCompositionStart);
            this._inputElement.addEventListener('compositionend', this._handleCompositionEnd);
        }
        if (this._valuesDiv) {
            this._valuesDiv.addEventListener('click', this._handleSuggestionClick);
        }
        document.addEventListener('click', this._handleDocumentClick); // For click-outside-to-close
    }

    _cleanupEventListeners() {
        if (this._inputElement) {
            this._inputElement.removeEventListener('input', this._handleInput);
            this._inputElement.removeEventListener('focus', this._handleFocus);
            this._inputElement.removeEventListener('blur', this._handleBlur);
            this._inputElement.removeEventListener('keydown', this._handleKeydown);
            this._inputElement.removeEventListener('compositionstart', this._handleCompositionStart);
            this._inputElement.removeEventListener('compositionend', this._handleCompositionEnd);
        }
        if (this._valuesDiv) {
            this._valuesDiv.removeEventListener('click', this._handleSuggestionClick);
        }
        document.removeEventListener('click', this._handleDocumentClick);
    }

    _handleInput = (event) => {
        // Debounce input to prevent excessive calls to getValues
        clearTimeout(this._debounceTimeout);
        this._debounceTimeout = setTimeout(() => {
            if (!this._isComposing) { // Only process if not in a composition session
                this._fetchAndDisplaySuggestions(event.target.value);
            }
        }, 300); // 300ms debounce
    };

    _handleCompositionStart = () => {
        this._isComposing = true;
    };

    _handleCompositionEnd = (event) => {
        this._isComposing = false;
        // Process the input immediately after composition ends
        this._fetchAndDisplaySuggestions(event.target.value);
    };

    _handleFocus = () => {
        // Show suggestions if input is not empty, or refresh if empty
        if (this._inputElement.value.length > 0 || (this._valuesDiv && this._valuesDiv.children.length > 0)) {
            this._valuesDiv.style.display = 'block';
        }
        this._highlightedIndex = -1; // Reset highlight on focus
    };

    _handleBlur = () => {
        // Hide after a short delay to allow click on suggestion
        setTimeout(() => {
            if (this._valuesDiv) {
                this._valuesDiv.style.display = 'none';
            }
        }, 150); // Short delay
    };

    _handleKeydown = (event) => {
        const suggestions = Array.from(this._valuesDiv.children);
        if (suggestions.length === 0) return;

        if (event.key === 'ArrowDown') {
            event.preventDefault(); // Prevent cursor movement in input
            this._highlightedIndex = (this._highlightedIndex + 1) % suggestions.length;
            this._updateHighlight(suggestions);
            this._scrollIntoView(suggestions[this._highlightedIndex]);
        } else if (event.key === 'ArrowUp') {
            event.preventDefault(); // Prevent cursor movement in input
            this._highlightedIndex = (this._highlightedIndex - 1 + suggestions.length) % suggestions.length;
            this._updateHighlight(suggestions);
            this._scrollIntoView(suggestions[this._highlightedIndex]);
        } else if (event.key === 'Enter') {
            if (this._highlightedIndex > -1) {
                event.preventDefault(); // Prevent form submission if applicable
                this._selectSuggestion(suggestions[this._highlightedIndex]);
            }
        } else if (event.key === 'Escape') {
            this.clear();
            this._valuesDiv.style.display = 'none';
            this._inputElement.blur(); // Remove focus
        }
    };

    _updateHighlight(suggestions) {
        suggestions.forEach((item, index) => {
            item.classList.toggle('highlighted', index === this._highlightedIndex);
        });
    }

    _scrollIntoView(element) {
        if (element) {
            element.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        }
    }

    _handleSuggestionClick = (event) => {
        const clickedItem = event.target.closest('.suggestion-item');
        if (clickedItem) {
            this._selectSuggestion(clickedItem);
        }
    };

    _handleDocumentClick = (event) => {
        // If click is outside this component entirely, hide suggestions
        if (this._valuesDiv && !this.contains(event.target)) {
            this._valuesDiv.style.display = 'none';
        }
    };

    async _fetchAndDisplaySuggestions(inputValue) {
        if (!this._getValues) {
            return; // allow manual integrations to drive suggestions
        }

        if (inputValue.length === 0) {
            this.setValues([]); // Clear suggestions if input is empty
            this._valuesDiv.style.display = 'none';
            return;
        }

        try {
            const suggestions = await this._getValues(inputValue);
            this.setValues(suggestions);
            if (suggestions.length > 0) {
                this._valuesDiv.style.display = 'block';
            } else {
                this._valuesDiv.style.display = 'none';
            }
        } catch (error) {
            console.error("Autocomplete: Error fetching values:", error);
            this.setValues([]); // Clear suggestions on error
            this._valuesDiv.style.display = 'none';
        }
    }

    _selectSuggestion(itemElement) {
        // Set the input value to the selected item's text content (or specific data)
        this._inputElement.value = itemElement.textContent; // Or itemElement.dataset.value if you stored data
        this._valuesDiv.style.display = 'none'; // Hide suggestions
        this._inputElement.blur(); // Remove focus from input

        // Dispatch a custom event to notify parent about selection
        this.dispatchEvent(new CustomEvent('autocomplete-selected', {
            detail: {
                value: itemElement.textContent, // Or itemElement.dataset.originalValue
                element: itemElement
            },
            bubbles: true,
            composed: true
        }));
    }

    // --- Public API Methods ---

    /** Sets focus on the input element. */
    focus() {
        // Use requestAnimationFrame to ensure focus is applied after potential DOM updates
        requestAnimationFrame(() => {
            this._inputElement?.focus();
        });
    }

    /**
     * Programmatically sets the displayed suggestion values.
     * @param {Array} values An array of values to display as suggestions.
     */
    setValues(values) {
        if (!this._valuesDiv || !this._displayValue) {
            console.warn("Autocomplete: 'valuesDiv' or 'displayValue' is not ready.");
            return;
        }

        this._valuesDiv.innerHTML = ""; // Clear existing suggestions
        this._highlightedIndex = -1; // Reset highlight

        if (values && values.length > 0) {
            values.forEach((val) => {
                const div = this._displayValue(val);
                div.classList.add('suggestion-item'); // Add common class for styling/selection
                this._valuesDiv.appendChild(div);
            });
            this._valuesDiv.style.display = 'block';
        } else {
            this._valuesDiv.style.display = 'none';
        }
    }

    /** Gets the current value of the input. */
    getValue() {
        return this._inputElement ? this._inputElement.value : '';
    }

    /** Clears the suggestions but keeps current input value. */
    clearSuggestions() {
        if (!this._valuesDiv) return;
        if (this._valuesDiv) this._valuesDiv.innerHTML = "";
        this._valuesDiv.style.display = 'none';
        this._highlightedIndex = -1;
    }

    /** Clears the input and suggestions. */
    clear() {
        if (this._inputElement) this._inputElement.value = '';
        this.clearSuggestions();
    }
}

customElements.define('globular-autocomplete', Autocomplete);
