import getUuidByString from "uuid-by-string";

/**
 * `globular-editable-string-list` Web Component.
 * Displays a list of strings as chips that can be edited, added, and removed.
 */
export class EditableStringList extends HTMLElement {
    _items = [];
    _stringListDiv = null;
    _addItemBtn = null;

    constructor(list) {
        super();
        this.attachShadow({ mode: 'open' });
        this._renderHTML();
        this._cacheElements();
        this._setupEventListeners();
        this.setItems(list || []);
    }

    connectedCallback() {
        this._cacheElements();
    }

    getItems() {
        const chips = this.shadowRoot.querySelectorAll(".chip-text");
        return Array.from(chips).map(el => el.textContent).filter(Boolean);
    }

    setItems(items) {
        this._items = items || [];
        this._renderChips();
    }

    setValues(values) { this.setItems(values); }
    getValues() { return this.getItems(); }

    blur() {
        this.shadowRoot.querySelectorAll(".chip-input").forEach(input => {
            const chip = input.closest(".chip");
            const text = chip?.querySelector(".chip-text");
            if (text) text.style.display = "";
            input.style.display = "none";
        });
    }

    _renderHTML() {
        this.shadowRoot.innerHTML = `
        <style>
            :host { display: inline-flex; }
            .container {
                display: flex;
                align-items: center;
                flex-wrap: wrap;
                gap: 6px;
            }
            .chip {
                display: inline-flex;
                align-items: center;
                padding: 2px 6px 2px 10px;
                border: 1px solid color-mix(in srgb, var(--on-surface-color) 20%, transparent);
                border-radius: 999px;
                font-size: .78rem;
                color: var(--on-surface-color);
                background: color-mix(in srgb, var(--on-surface-color) 6%, transparent);
                cursor: pointer;
                transition: background .1s ease;
                gap: 4px;
            }
            .chip:hover {
                background: color-mix(in srgb, var(--on-surface-color) 12%, transparent);
            }
            .chip-text {
                white-space: nowrap;
            }
            .chip-input {
                display: none;
                border: none;
                outline: none;
                background: transparent;
                color: var(--on-surface-color);
                font-size: .78rem;
                font-family: inherit;
                width: 80px;
                padding: 0;
            }
            .chip-remove {
                width: 14px;
                height: 14px;
                cursor: pointer;
                opacity: .5;
                transition: opacity .15s;
                fill: var(--on-surface-color);
            }
            .chip-remove:hover { opacity: 1; }
            .add-btn {
                width: 24px;
                height: 24px;
                border-radius: 50%;
                border: 1px dashed color-mix(in srgb, var(--on-surface-color) 25%, transparent);
                background: transparent;
                color: var(--on-surface-color);
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 1rem;
                opacity: .5;
                transition: opacity .15s, border-color .15s;
                flex-shrink: 0;
            }
            .add-btn:hover {
                opacity: 1;
                border-color: var(--accent-color);
                color: var(--accent-color);
            }
        </style>
        <div class="container">
            <div id="chips"></div>
            <button class="add-btn" id="add-btn" title="Add genre">+</button>
        </div>
        `;
    }

    _cacheElements() {
        this._stringListDiv = this.shadowRoot.querySelector("#chips");
        this._addItemBtn = this.shadowRoot.querySelector("#add-btn");
    }

    _setupEventListeners() {
        this._addItemBtn?.addEventListener("click", (e) => {
            e.stopPropagation();
            this._addChip("", true);
        });
    }

    _renderChips() {
        if (!this._stringListDiv) return;
        this._stringListDiv.innerHTML = "";
        this._items.forEach(item => {
            if (item) this._addChip(item, false);
        });
    }

    _addChip(value, editImmediately) {
        const chip = document.createElement("span");
        chip.className = "chip";

        const text = document.createElement("span");
        text.className = "chip-text";
        text.textContent = value;

        const input = document.createElement("input");
        input.className = "chip-input";
        input.type = "text";
        input.value = value;

        const remove = document.createElement("iron-icon");
        remove.className = "chip-remove";
        remove.setAttribute("icon", "icons:close");

        chip.appendChild(text);
        chip.appendChild(input);
        chip.appendChild(remove);
        this._stringListDiv.appendChild(chip);

        // Click text to edit
        text.addEventListener("click", (e) => {
            e.stopPropagation();
            text.style.display = "none";
            input.style.display = "inline-block";
            input.value = text.textContent;
            input.focus();
            input.select();
        });

        // Save on Enter, cancel on Escape
        input.addEventListener("keydown", (e) => {
            e.stopPropagation();
            if (e.key === "Enter") {
                e.preventDefault();
                const v = input.value.trim();
                if (v) {
                    text.textContent = v;
                    text.style.display = "";
                    input.style.display = "none";
                } else {
                    chip.remove();
                }
            } else if (e.key === "Escape") {
                e.preventDefault();
                if (!value) { chip.remove(); return; }
                text.style.display = "";
                input.style.display = "none";
                input.value = text.textContent;
            }
        });

        // Save on blur
        input.addEventListener("blur", () => {
            setTimeout(() => {
                if (input.style.display === "none") return;
                const v = input.value.trim();
                if (v) {
                    text.textContent = v;
                    text.style.display = "";
                    input.style.display = "none";
                } else {
                    chip.remove();
                }
            }, 100);
        });

        // Remove chip
        remove.addEventListener("click", (e) => {
            e.stopPropagation();
            chip.remove();
        });

        // Auto-edit for new chips
        if (editImmediately) {
            text.style.display = "none";
            input.style.display = "inline-block";
            requestAnimationFrame(() => {
                input.focus();
            });
        }
    }
}

customElements.define("globular-editable-string-list", EditableStringList);
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
                --paper-input-container-focus-color: var(--accent-color);
                --paper-input-container-input-color: var(--primary-text-color);
            }
            .add-action-btn{
                display:inline-flex;
                align-items:center;
                font-size:.75rem;
                gap:4px;
                white-space:nowrap;
                background: var(--accent-color);
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