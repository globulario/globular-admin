import '@polymer/paper-icon-button/paper-icon-button.js';
import '@polymer/iron-icons/iron-icons.js';
import '@polymer/paper-ripple/paper-ripple.js';
import '@polymer/paper-card/paper-card.js';
import '@polymer/iron-icon/iron-icon.js';
import '@polymer/iron-icons/social-icons'
import '@polymer/iron-icons/communication-icons'
import '@polymer/iron-icons/editor-icons'

/**
 * `globular-dropdown-menu-item` Web Component.
 * Represents a clickable item within a dropdown menu.
 *
 * Properties:
 * - `icon` (string): Icon name (e.g., 'icons:close') or Font Awesome class ('fa fa-star').
 * - `text` (string): The display text for the menu item.
 * - `shortcut` (string): Optional shortcut key display.
 * - `separator` (boolean): If present, displays a separator line above the item.
 *
 * Callbacks (set on the instance):
 * - `action`: A function to be executed when the item is clicked.
 */
export class DropdownMenuItem extends HTMLElement {
    // --- Internal Properties ---
    _icon = '';
    _text = '';
    _shortcut = '';
    _hasSeparator = false;
    
    // Cached DOM elements
    _container = null;
    _iconElement = null;
    _faIconElement = null;
    _textSpan = null;
    _shortcutSpan = null;
    _separatorSpan = null;
    _itemWrapper = null; // The div wrapping icon/text/shortcut

    // --- Constructor ---
    constructor(icon, text, shortcut) {
        super();
        this.attachShadow({ mode: 'open' });
        
        // Set initial properties from constructor arguments
        if (icon) this._icon = icon;
        if (text) this._text = text;
        if (shortcut) this._shortcut = shortcut;

        this._renderHTML(); // Render HTML in constructor
    }

    // --- Lifecycle Callbacks ---
    connectedCallback() {
        this._cacheElements();
        this._applyInitialAttributes();
        this._setupEventListeners();
    }

    // --- Public Getters/Setters ---
    set action(func) { this._action = func; }
    get action() { return this._action; }

    // --- Public API Methods ---

    /** Hides the icon display for the menu item. */
    hideIcon() {
        if (this._iconElement) this._iconElement.style.display = "none";
        if (this._faIconElement) this._faIconElement.style.display = "none";
    }

    // --- Private Helper Methods ---

    _renderHTML() {
        this.shadowRoot.innerHTML = `
        <style>
            @import url('https://cdnjs.cloudflare.com/ajax/libs/font-awesome/5.3.1/css/all.min.css');
            
            #container { display: flex; flex-direction: column; }
  
            #item-wrapper {
                background-color: var(--surface-color);
                color: var(--on-surface-color);
                display: flex;
                min-width: 150px;
                padding: 3px;
                transition: background 0.2s ease, padding 0.8s linear;
                position: relative;
                align-items: center;
                justify-content: center;
            }
  
            #item-wrapper:hover {
                background-color: var(--hover-color, #f0f0f0);
                cursor: pointer;
            }
  
            #icon-container, iron-icon { width: 20px; padding-right: 10px; }
            #fa-icon { display: none; font-size: 1.2rem; }
  
            #text-span { flex-grow: 1; font-size: 1rem; min-width: 140px; }
            #shortcut { font-size: 0.8rem; color: var(--on-surface-color); padding-right: 5px; }
  
            .separator {
                display: none;
                border-top: 1px solid var(--palette-divider, lightgray);
                margin-top: 2px;
                padding-top: 2px;
            }
        </style>
        
        <div id="container">
          <span class="separator"></span>
          <div id="item-wrapper">
            <paper-ripple recenters></paper-ripple>
            <iron-icon id="icon"></iron-icon>
            <i id="fa-icon"></i>
            <span id="text-span"></span>
            <span id="shortcut"></span>
            <slot></slot>
          </div>
        </div>
        `;
    }

    _cacheElements() {
        this._container = this.shadowRoot.getElementById("container");
        this._itemWrapper = this.shadowRoot.getElementById("item-wrapper");
        this._iconElement = this.shadowRoot.getElementById("icon");
        this._faIconElement = this.shadowRoot.getElementById("fa-icon");
        this._textSpan = this.shadowRoot.getElementById("text-span");
        this._shortcutSpan = this.shadowRoot.getElementById("shortcut");
        this._separatorSpan = this.shadowRoot.querySelector(".separator");
    }

    _applyInitialAttributes() {
        this._hasSeparator = this.hasAttribute("separator");
        this._icon = this.getAttribute("icon") || this._icon;
        this._text = this.getAttribute("text") || this._text;
        this._shortcut = this.getAttribute("shortcut") || "";

        // Update DOM with initial values
        if (this._separatorSpan && this._hasSeparator) this._separatorSpan.style.display = "block";
        if (this._textSpan) this._textSpan.innerHTML = this._text;
        if (this._shortcutSpan) this._shortcutSpan.innerHTML = this._shortcut;

        this._setIcon(this._icon);
    }

    _setupEventListeners() {
        if (this._itemWrapper) {
            this._itemWrapper.addEventListener("click", this._handleItemClick);
        }

        // The original code had a global document click listener in each instance,
        // which is bad for performance. The `DropdownMenu` parent should manage this.
    }

    _cleanupEventListeners() {
        if (this._itemWrapper) {
            this._itemWrapper.removeEventListener("click", this._handleItemClick);
        }
    }

    /** Sets the icon based on its name or class. */
    _setIcon(icon) {
        if (!this._iconElement || !this._faIconElement) return;

        if (icon.startsWith("fa")) {
            this._faIconElement.style.display = "block";
            this._faIconElement.className = icon;
            this._iconElement.style.display = "none";
        } else if (icon.length > 0) {
            this._faIconElement.style.display = "none";
            this._iconElement.style.display = "block";
            this._iconElement.setAttribute("icon", icon);
        } else {
            this._faIconElement.style.display = "none";
            this._iconElement.style.display = "none";
        }
    }

    _handleItemClick = (evt) => {
        evt.stopPropagation();
        
        // Execute the action if defined
        if (this.action) {
            this.action();
        }

        // Dispatch a custom event for other listeners
        this.dispatchEvent(new CustomEvent('on-action', {
            bubbles: true,
            composed: true,
            detail: {
                // You can provide additional data here
            }
        }));

        // Close the parent menu
        if (this.parentNode && typeof this.parentNode.close === 'function') {
            this.parentNode.close();
        }
    };
}

customElements.define('globular-dropdown-menu-item', DropdownMenuItem);

/**
 * `globular-dropdown-menu` Web Component.
 * Acts as a container for a list of menu items, which can be opened and closed.
 *
 * Properties:
 * - `icon` (string): Icon for the menu button.
 * - `text` (string): Text for the menu button.
 */
export class DropdownMenu extends HTMLElement {
    // --- Internal Properties ---
    _isOpen = false;
    _icon = '';
    _text = '';
    
    // Cached DOM elements
    _container = null;
    _menuItemsCard = null;
    _menuBtn = null;
    _textSpan = null;

    // Callbacks set by consumers
    onopen = null;
    onclose = null;

    // --- Constructor ---
    constructor(icon, text) {
        super();
        this.attachShadow({ mode: 'open' });

        this._icon = icon || "";
        this._text = text || "";
        
        this._renderHTML();
    }

    // --- Lifecycle Callbacks ---
    connectedCallback() {
        this._cacheElements();
        this._applyInitialAttributes();
        this._setupEventListeners();
        // Add a global listener for outside clicks, but it's better managed by a parent
        // container like a MenuBar or a top-level overlay.
        document.addEventListener('click', this._handleOutsideClick);
    }

    disconnectedCallback() {
        this._cleanupEventListeners();
        document.removeEventListener('click', this._handleOutsideClick);
    }

    // --- Public API Methods ---

    /** Opens the dropdown menu. */
    open() {
        if (this._menuItemsCard) {
            this._menuItemsCard.style.display = "block";
        }
        if (this._textSpan) {
            this._textSpan.style.textDecoration = "underline";
            this._textSpan.style.backgroundColor = "var(--surface-color)";
        }
        this._isOpen = true;
        this.onopen?.(); // Use optional chaining for callback
        this.dispatchEvent(new CustomEvent('on-open', { bubbles: true, composed: true }));
    }

    /** Closes the dropdown menu. */
    close() {
        if (this._menuItemsCard) {
            this._menuItemsCard.style.display = "none";
        }
        if (this._textSpan) {
            this._textSpan.style.textDecoration = "none";
            this._textSpan.style.backgroundColor = "var(--background-color)";
        }
        this._isOpen = false;
        this.onclose?.(); // Use optional chaining for callback
        this.dispatchEvent(new CustomEvent('on-close', { bubbles: true, composed: true }));
    }

    /** Returns true if the menu is open. */
    isOpen() {
        return this._isOpen;
    }

    /** Hides the icon button. */
    hideBtn() {
        if (this._menuBtn) this._menuBtn.style.display = "none";
    }

    /** Shows the icon button. */
    showBtn() {
        if (this._menuBtn) this._menuBtn.style.display = "block";
    }

    // --- Private Helper Methods ---

    _renderHTML() {
        this.shadowRoot.innerHTML = `
        <style>
            #container {
                display: flex;
                align-items: center;
                width: fit-content;
                justify-content: center;
                position: relative;
                transition: background 0.2s ease, padding 0.8s linear;
                user-select: none;
                margin-right: 10px;
            }

            .card-content { display: flex; flex-direction: column; padding: 0px; }
            .menu-items { position: absolute; top: 25px; left: 0px; display: none; z-index: 1000; }

            #icon-i:hover, iron-icon:hover { cursor: pointer; }
            #icon-i, iron-icon { display: none; font-size: 1.2rem; }

            #text {
                padding-left: 10px;
                padding-right: 10px;
                background-color: var(--background-color);
                color: var(--on-background-color);
                transition: background 0.2s ease, padding 0.8s linear;
            }

            #text:hover { cursor: pointer; background-color: var(--hover-color, #f0f0f0); }
        </style>
        <div id="container">
            <iron-icon id="menu-icon" icon="${this._icon}"></iron-icon>
            <i id="icon-i" class="${this._icon}"></i>
            <span id="text"></span>
            <paper-card class="menu-items">
                <div class="card-content">
                    <slot></slot>
                </div>
            </paper-card>
        </div>`;
    }

    _cacheElements() {
        this._container = this.shadowRoot.getElementById("container");
        this._menuItemsCard = this.shadowRoot.querySelector("paper-card");
        this._menuBtn = this.shadowRoot.querySelector("#menu-icon");
        this._textSpan = this.shadowRoot.querySelector("#text");
    }

    _applyInitialAttributes() {
        // Set menu text and icon
        if (this._text) this._textSpan.innerHTML = this._text;
        if (this._icon) this._menuBtn.icon = this._icon;

        // Set the icon, if it is a font awesome icon.
        if (this._icon.startsWith("fa")) {
            const faIcon = this.shadowRoot.querySelector("#icon-i");
            if (faIcon) {
                faIcon.style.display = "block";
                faIcon.className = this._icon;
                this._menuBtn.style.display = "none";
            }
        } else if (this._icon.length > 0) {
            this._menuBtn.style.display = "block";
            const faIcon = this.shadowRoot.querySelector("#icon-i");
            if (faIcon) faIcon.style.display = "none";
        }
    }

    _setupEventListeners() {
        this._container.addEventListener("click", this._handleContainerClick);
    }

    _cleanupEventListeners() {
        this._container.removeEventListener("click", this._handleContainerClick);
    }
    
    _handleContainerClick = (evt) => {
        evt.stopPropagation();
        this.isOpen() ? this.close() : this.open();
    };

    _handleOutsideClick = (event) => {
        // Close menu if click is outside the menu container
        if (!this._container.contains(event.target)) {
            this.close();
        }
    };
}

customElements.define('globular-dropdown-menu', DropdownMenu);

/**
 * `globular-menu-bar` Web Component.
 * Acts as a container for multiple `globular-dropdown-menu` components.
 */
export class MenuBar extends HTMLElement {
    // --- Constructor ---
    constructor() {
        super();
        this.attachShadow({ mode: 'open' });
        this._renderHTML();
    }

    // --- Lifecycle Callbacks ---
    connectedCallback() {
        this._setupEventListeners();
    }
    
    disconnectedCallback() {
        this._cleanupEventListeners();
    }

    // --- Private Helper Methods ---
    _renderHTML() {
        this.shadowRoot.innerHTML = `
        <style>
            #container {
                background-color: var(--background-color);
                color: var(--on-background-color);
                display: flex;
            }
        </style>
        <div id="container">
            <slot></slot>
        </div>
        `;
    }

    _setupEventListeners() {
        // Use event delegation on the slot for better performance
        const slot = this.shadowRoot.querySelector('slot');
        if (slot) {
            slot.addEventListener("slotchange", this._handleSlotChange);
        }
    }

    _cleanupEventListeners() {
        const slot = this.shadowRoot.querySelector('slot');
        if (slot) {
            slot.removeEventListener("slotchange", this._handleSlotChange);
        }
    }

    _handleSlotChange = () => {
        const menus = this.querySelectorAll("globular-dropdown-menu");
        menus.forEach(menu => {
            // Subscribe to the 'on-open' event of each menu
            menu.addEventListener("on-open", this._handleMenuOpen);
            // This is a more robust way to handle nested menus:
            // when a menu opens, close all other menus that are not its ancestor.
            menu.addEventListener("click", evt => evt.stopPropagation()); // Prevent clicks from bubbling up and closing other menus
        });
    };

    _handleMenuOpen = (evt) => {
        // When one menu opens, close all other top-level menus
        this.querySelectorAll("globular-dropdown-menu").forEach(menu => {
            if (menu !== evt.target) {
                // Check if the menu that opened is a sub-menu of the current menu
                // (This is a complex check in JS, but a common pattern is to just close all others)
                if (!menu.contains(evt.target)) {
                     menu.close();
                }
            }
        });
    };
}

customElements.define('globular-menu-bar', MenuBar);