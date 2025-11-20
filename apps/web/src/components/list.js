import { v4 as uuidv4 } from "uuid";
import getUuidByString from "uuid-by-string";
import { fireResize } from "./utility"; // Assuming this utility is available
import '@polymer/paper-button/paper-button.js';

/**
 * `globular-editable-string-list` Web Component.
 * Displays a list of strings that can be edited, added, and removed.
 *
 * Properties:
 * - `list` (Array): Initial list of strings to display.
 */
export class EditableStringList extends HTMLElement {
    // --- Internal Properties ---
    _items = [];
    
    // Cached DOM elements
    _stringListDiv = null;
    _addItemBtn = null;

    // --- Constructor ---
    constructor(list) {
        super();
        this.attachShadow({ mode: 'open' });
        this._renderHTML(); // Render HTML
        this.setItems(list || []); // Set initial items
    }

    // --- Lifecycle Callbacks ---
    connectedCallback() {
        this._cacheElements();
        this._setupEventListeners();
    }

    disconnectedCallback() {
        this._cleanupEventListeners();
    }

    // --- Public API Methods ---

    /**
     * Returns the list of strings currently in the component.
     * @returns {string[]} An array of strings.
     */
    getItems() {
        const itemSpans = this.shadowRoot.querySelectorAll(".items");
        return Array.from(itemSpans).map(span => span.textContent);
    }

    /**
     * Sets the list of strings to be displayed.
     * @param {string[]} items An array of strings.
     */
    setItems(items) {
        this._items = items;
        this.renderItems();
    }

    /**
     * Sets the list of values (an alias for setItems).
     * @param {string[]} values An array of strings.
     */
    setValues(values) {
        this.setItems(values);
    }

    /**
     * Gets the list of values (an alias for getItems).
     * @returns {string[]} An array of strings.
     */
    getValues() {
        return this.getItems();
    }

    /** Programmatically triggers the input to lose focus, hiding all text inputs. */
    blur() {
        const inputs = this.shadowRoot.querySelectorAll("paper-input");
        inputs.forEach(input => {
            input.style.display = "none";
            input.parentNode.querySelector('.items').style.display = "block";
        });
    }

    // --- Private Helper Methods ---

    _renderHTML() {
        this.shadowRoot.innerHTML = `
        <style>
            .string-list{
                display: flex;
                flex-wrap: wrap;
                min-height: 25px;
            }

            .string-item-wrapper {
                align-items: center;
                justify-content: center;
                padding: 0px 4px 0px 4px;
                margin-right: 5px;
                margin-top: 5px;
                border: 1px solid var(--palette-action-disabled);
                display: flex; /* Ensure inner elements are aligned */
            }

            iron-icon {
                width: 16px;
                height: 16px;
                margin-left: 2px;
                cursor: pointer;
            }
            
            paper-input {
                display: none; /* Hidden by default */
            }
        </style>
       
        <div style="position: relative; display: flex; align-items: center;">
            <paper-icon-button id="add-item-btn" icon="icons:add" style="position: absolute; left: -40px;"></paper-icon-button>
            <div class="string-list">
                </div>
        </div>
        `;
    }

    _cacheElements() {
        this._stringListDiv = this.shadowRoot.querySelector(".string-list");
        this._addItemBtn = this.shadowRoot.querySelector("#add-item-btn");
    }

    _setupEventListeners() {
        if (this._stringListDiv) {
            this._stringListDiv.addEventListener('click', this.blur.bind(this)); // Click on list blurs all
        }
        if (this._addItemBtn) {
            this._addItemBtn.addEventListener('click', () => this._addItem("New value", true));
        }
    }

    _cleanupEventListeners() {
        if (this._stringListDiv) {
            this._stringListDiv.removeEventListener('click', this.blur.bind(this));
        }
        if (this._addItemBtn) {
            this._addItemBtn.removeEventListener('click', () => this._addItem("New value", true));
        }
    }

    /**
     * Adds an item to the list and renders it.
     * @param {string} item The string value.
     * @param {boolean} [edit=false] If true, immediately enters edit mode for the new item.
     */
    _addItem(item, edit = false) {
        // Generate a unique ID for the item's container
        const uuid = `_${getUuidByString(item)}`;
        const existingItemDiv = this.shadowRoot.getElementById(uuid);
        if (existingItemDiv) {
            // If item already exists, focus it for editing instead of adding a duplicate
            const itemSpan = existingItemDiv.querySelector('.items');
            if (itemSpan) itemSpan.click();
            return;
        }

        const itemDiv = document.createElement('div');
        itemDiv.id = uuid;
        itemDiv.classList.add('string-item-wrapper');

        const itemSpan = document.createElement('span');
        itemSpan.classList.add('items');
        itemSpan.textContent = item;

        const itemInput = document.createElement('paper-input');
        itemInput.setAttribute('no-label-float', '');
        itemInput.style.display = 'none';

        const removeBtn = document.createElement('iron-icon');
        removeBtn.setAttribute('icon', 'icons:close');
        removeBtn.id = 'remove-btn';

        itemDiv.appendChild(itemSpan);
        itemDiv.appendChild(itemInput);
        itemDiv.appendChild(removeBtn);

        this._stringListDiv.appendChild(itemDiv);

        // --- Event listeners for the new item ---
        itemSpan.addEventListener('click', (evt) => {
            evt.stopPropagation();
            this._enterEditMode(itemDiv, itemSpan, itemInput);
        });

        removeBtn.addEventListener('click', (evt) => {
            evt.stopPropagation();
            itemDiv.remove();
        });

        itemInput.addEventListener('keyup', (evt) => {
            evt.stopPropagation();
            if (evt.key === 'Escape') {
                this._exitEditMode(itemDiv, itemSpan, itemInput, item); // Revert to original
            } else if (evt.key === 'Enter') {
                this._exitEditMode(itemDiv, itemSpan, itemInput, itemInput.value); // Save value
            }
        });

        itemInput.addEventListener('blur', () => {
            this._exitEditMode(itemDiv, itemSpan, itemInput, itemInput.value);
        });

        // Enter edit mode immediately if requested
        if (edit) {
            this._enterEditMode(itemDiv, itemSpan, itemInput);
        }
    }

    /** Renders all items in the _items array to the DOM. */
    renderItems() {
        this._stringListDiv.innerHTML = ""; // Clear list
        const fragment = document.createDocumentFragment();
        const range = document.createRange();

        this._items.forEach(item => {
            // Use _addItem's logic but without adding new items to the array
            const html = `
                <div id="_${getUuidByString(item)}" class="string-item-wrapper">
                    <span class="items">${item}</span>
                    <paper-input no-label-float style="display: none;"></paper-input>
                    <iron-icon id="remove-btn" icon="icons:close"></iron-icon>
                </div>
            `;
            const itemDiv = range.createContextualFragment(html).firstElementChild;
            fragment.appendChild(itemDiv);

            // Re-attach event listeners after adding to fragment
            const itemSpan = itemDiv.querySelector('.items');
            const itemInput = itemDiv.querySelector('paper-input');
            const removeBtn = itemDiv.querySelector('#remove-btn');

            itemSpan.addEventListener('click', (evt) => {
                evt.stopPropagation();
                this._enterEditMode(itemDiv, itemSpan, itemInput);
            });
            removeBtn.addEventListener('click', (evt) => {
                evt.stopPropagation();
                itemDiv.remove();
            });
            itemInput.addEventListener('keyup', (evt) => {
                evt.stopPropagation();
                if (evt.key === 'Escape') this._exitEditMode(itemDiv, itemSpan, itemInput, item);
                if (evt.key === 'Enter') this._exitEditMode(itemDiv, itemSpan, itemInput, itemInput.value);
            });
            itemInput.addEventListener('blur', () => this._exitEditMode(itemDiv, itemSpan, itemInput, itemInput.value));
        });

        this._stringListDiv.appendChild(fragment);
    }

    /** Puts a list item into edit mode (shows input, hides span). */
    _enterEditMode(itemDiv, itemSpan, itemInput) {
        this.blur(); // Blur other inputs first
        itemInput.style.display = "block";
        itemInput.value = itemSpan.innerHTML;
        itemSpan.style.display = "none";
        // Use requestAnimationFrame for focus after display change
        requestAnimationFrame(() => {
            itemInput.focus();
            itemInput.inputElement.inputElement.select(); // Select text in paper-input's internal input
        });
        fireResize();
    }

    /** Exits edit mode (hides input, shows span), and updates value if needed. */
    _exitEditMode(itemDiv, itemSpan, itemInput, newValue) {
        if (!newValue || newValue.trim() === "") {
            itemDiv.remove(); // Remove item if value is empty
            return;
        }
        
        // Check for duplicates before saving
        const newUuid = `_${getUuidByString(newValue)}`;
        const existingDiv = this.shadowRoot.getElementById(newUuid);
        if (existingDiv && existingDiv !== itemDiv) {
            itemDiv.remove(); // Remove current item if a duplicate exists
            this._enterEditMode(existingDiv, existingDiv.querySelector('.items'), existingDiv.querySelector('paper-input'));
            return;
        }

        itemDiv.id = newUuid; // Update the ID
        itemSpan.innerHTML = newValue;
        itemInput.style.display = "none";
        itemSpan.style.display = "block";
    }
}

customElements.define('globular-editable-string-list', EditableStringList);


/**
 * `globular-searchable-list` Web Component.
 * Displays a filterable list of strings with add and delete actions.
 */
export class SearchableList extends HTMLElement {
    // --- Internal Properties ---
    _list = [];
    _titleText = "";
    _filterText = ""; // The current filter value
    
    // Cached DOM elements
    _headerDiv = null;
    _listDiv = null;
    _shadowDiv = null;
    _filterInput = null;
    _addBtn = null;
    _titleSpan = null;

    // --- External Callbacks ---
    ondeleteitem = null;
    onadditem = null;
    onadd = null;

    // --- Constructor ---
    constructor(title, list, ondeleteitem, onadditem, onadd) {
        super();
        this.attachShadow({ mode: 'open' });
        this.width = 420; // legacy compatibility

        // Set initial properties from constructor args
        this._titleText = title || "";
        this._list = list || [];
        this.ondeleteitem = ondeleteitem;
        this.onadditem = onadditem; // Not used in provided code, but keeping it
        this.onadd = onadd; // Callback for add button
        
        this._renderHTML(); // Render HTML
    }

    // --- Lifecycle Callbacks ---
    connectedCallback() {
        this._cacheElements();
        this._setupEventListeners();
        this.displayItems(); // Initial display
    }

    disconnectedCallback() {
        this._cleanupEventListeners();
    }

    // --- Public API Methods ---

    /**
     * Returns the header div element.
     * @returns {HTMLElement}
     */
    getHeader() {
        return this._headerDiv;
    }

    /**
     * Removes an item from the list and updates the display.
     * @param {string} str The string to remove.
     */
    removeItem(str) {
        this._list = this._list.filter(el => el !== str);
        this._updateTitleCount();
        this.displayItems();
    }

    /**
     * Appends an item to the list and updates the display.
     * @param {string} item The string to add.
     */
    appendItem(item) {
        this._list.push(item);
        this._updateTitleCount();
        this.displayItems();
    }

    /** Hides the title span in the header. */
    hideTitle() {
        if (this._titleSpan) {
            this._titleSpan.style.display = "none";
        }
    }

    /** Back-compat getter/setter for legacy `list` property. */
    get list() {
        return this._list;
    }
    set list(value) {
        this._list = Array.isArray(value) ? value : [];
        this._updateTitleCount();
        if (this._listDiv) {
            this.displayItems();
        }
    }

    /** Legacy alias for `_filterText`. */
    get filter_() {
        return this._filterText || "";
    }
    set filter_(value) {
        this._filterText = value || "";
        if (this._filterInput && this._filterInput.value !== this._filterText) {
            this._filterInput.value = this._filterText;
        }
        if (this._listDiv) {
            this.displayItems();
        }
    }

    // --- Private Helper Methods ---

    _renderHTML() {
        const baseTitle = (this._titleText || "").replace(/\s*\(.*\)/, "").trim() || "Item";
        const addButtonLabel = `Add ${baseTitle}`;
        this.shadowRoot.innerHTML = `
        <style>
            .header{
                position: relative;
                transition: background 0.2s ease,padding 0.8s linear;
                padding: 8px 12px;
                background-color: var(--surface-elevated-color, var(--surface-color));
                color: var(--on-surface-color); /* Use CSS variable */
                border: 1px solid var(--border-subtle-color, var(--palette-divider));
                border-radius: 8px;
            }
            .item-div:hover{
                filter: invert(10%);
            }

            .item-div{
                padding: 5px;
                display: flex;
                align-items: center;
                font-size: 1.125rem;
                cursor: pointer; /* Make items clickable */
            }

            .header-row{
                display:flex;
                align-items:center;
                gap:12px;
            }
            .header-row paper-input{
                flex:1;
                --paper-input-container-color: var(--secondary-text-color);
                --paper-input-container-focus-color: var(--primary-color);
                --paper-input-container-input-color: var(--primary-text-color);
            }
            .add-action-btn{
                display:inline-flex;
                align-items:center;
                font-size:.75rem;
                gap:4px;
                white-space:nowrap;
                background: var(--primary-color);
                color: var(--on-primary-color);
                --paper-button-raised-keyboard-focus: var(--primary-dark-color);
                border-radius: 8px;
            }
            .add-action-btn iron-icon{
                --iron-icon-width:20px;
                --iron-icon-height:20px;
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
            
            #items-container {
                width: 100%;
                max-height: none;
                overflow-y: visible;
                overflow-x: hidden;
                margin-bottom: 5px;
                border: 1px solid var(--divider-color);
                border-radius: 5px;
                box-sizing: border-box;
            }
            #shadow-div {
                width: 100%;
                height: 5px;
                transition: box-shadow 0.2s ease;
            }
        </style>
        
        <div id="header-div" class="header">
            <div class="header-row">
                <paper-input style="padding-left: 15px;" type="text" label="Filter ${this._titleText}"></paper-input>
                <paper-button id="action-add-btn" class="add-action-btn" raised aria-label="${addButtonLabel}" title="${addButtonLabel}">
                    <iron-icon icon="add"></iron-icon>
                    <span>${addButtonLabel}</span>
                </paper-button>
            </div>
        </div>
        <div id="shadow-div"></div>
        <div id="items-container"></div>
        `;
    }

    _cacheElements() {
        this._headerDiv = this.shadowRoot.querySelector("#header-div");
        this._listDiv = this.shadowRoot.querySelector("#items-container");
        this._shadowDiv = this.shadowRoot.querySelector("#shadow-div");
        this._filterInput = this.shadowRoot.querySelector("paper-input");
        this._addBtn = this.shadowRoot.querySelector("#action-add-btn");
        this._titleSpan = this.shadowRoot.querySelector(".title");
    }

    _setupEventListeners() {
        if (this._listDiv) {
            this._listDiv.addEventListener("scroll", this._handleScroll);
        }
        if (this._filterInput) {
            this._filterInput.addEventListener("keyup", this._handleFilterKeyup);
        }
        if (this._addBtn) {
            if (this.onadd) {
                this._addBtn.addEventListener("click", this._handleAddClick);
                this._addBtn.removeAttribute("disabled");
            } else {
                this._addBtn.setAttribute("disabled", "disabled");
            }
        }
    }

    _cleanupEventListeners() {
        if (this._listDiv) {
            this._listDiv.removeEventListener("scroll", this._handleScroll);
        }
        if (this._filterInput) {
            this._filterInput.removeEventListener("keyup", this._handleFilterKeyup);
        }
        if (this._addBtn && this.onadd) {
            this._addBtn.removeEventListener("click", this._handleAddClick);
        }
    }
    
    _handleScroll = () => {
        if (this._listDiv.scrollTop > 0) {
            this._shadowDiv.style.boxShadow = "inset 0px 5px 6px -3px rgba(0, 0, 0, 0.4)";
        } else {
            this._shadowDiv.style.boxShadow = "";
        }
    };

    _handleFilterKeyup = () => {
        this._filterText = this._filterInput.value;
        this.displayItems();
    };

    _handleAddClick = () => {
        this.onadd(this._list);
    };

    /**
     * Filters an item based on the current filter text.
     * This method can be overridden for custom filtering logic.
     * @param {string} item The item to filter.
     * @returns {boolean} True if the item matches the filter, false otherwise.
     */
    filter(item) {
        return item.toUpperCase().includes(this._filterText.toUpperCase()) || this._filterText.length === 0;
    }

    /**
     * Sorts the list of items.
     * This method can be overridden for custom sorting logic.
     * @returns {string[]} The sorted array.
     */
    sortItems() {
        return [...this._list].sort();
    }

    /**
     * Creates the DOM element for a single list item.
     * @param {string} item The string value.
     * @returns {DocumentFragment} A DocumentFragment containing the item's HTML.
     */
    displayItem(item) {
        const uuid = `item-${getUuidByString(item)}`; // Unique ID
        const fragment = document.createDocumentFragment();
        const div = document.createElement("div");
        div.id = uuid;
        div.classList.add("item-div");
        div.style.cssText = "padding-top: 2px; padding-bottom: 2px;"; // Inline style from original

        const span = document.createElement("div");
        span.style.cssText = "flex-grow: 1; line-break: anywhere;";
        span.textContent = item;

        const deleteBtn = document.createElement("paper-icon-button");
        deleteBtn.icon = "delete";

        div.appendChild(span);
        div.appendChild(deleteBtn);
        fragment.appendChild(div);

        if (this.ondeleteitem) {
            deleteBtn.addEventListener('click', (evt) => {
                evt.stopPropagation();
                // Call external handler and then remove the element
                this.ondeleteitem(item);
                this.removeItem(item); // Update the list
            });
        } else {
            deleteBtn.style.display = "none";
        }

        return fragment;
    }

    /** Updates the count in the header. */
    _updateTitleCount() {
        if (this._titleSpan) {
            this._titleSpan.innerHTML = `${this._titleText} (${this._list.length})`;
        }
    }

    /** Displays all items in the list based on the current filter. */
    displayItems() {
        this._listDiv.innerHTML = ""; // Clear list
        const sortedItems = this.sortItems();
        
        sortedItems.forEach(item => {
            if (this.filter(item)) {
                const itemDom = this.displayItem(item);
                this._listDiv.appendChild(itemDom);
            }
        });
    }
}

customElements.define('globular-searchable-list', SearchableList);
