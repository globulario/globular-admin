import '@polymer/paper-icon-button/paper-icon-button.js';
import '@polymer/iron-icons/iron-icons.js';
import '@polymer/paper-ripple/paper-ripple.js';
import '@polymer/paper-card/paper-card.js';
import '@polymer/iron-icon/iron-icon.js';
import '@polymer/iron-icons/social-icons'
import '@polymer/iron-icons/communication-icons'
import '@polymer/iron-icons/editor-icons'

export class DropdownMenuItem extends HTMLElement {
  _icon = '';
  _text = '';
  _shortcut = '';
  _hasSeparator = false;

  _container = null;
  _iconElement = null;
  _faIconElement = null;
  _textSpan = null;
  _shortcutSpan = null;
  _separatorSpan = null;
  _itemWrapper = null;

  constructor(icon, text, shortcut) {
    super();
    this.attachShadow({ mode: 'open' });
    if (icon) this._icon = icon;
    if (text) this._text = text;
    if (shortcut) this._shortcut = shortcut;
    this._renderHTML();
  }

  connectedCallback() {
    this._cacheElements();
    this._applyInitialAttributes();
    this._setupEventListeners();
  }

  disconnectedCallback() {
    this._cleanupEventListeners();
  }

/*
  set action(func) { this._action = func; console.log("action set called"); }
  get action() { console.log("action get called"); return this._action; }
*/
  hideIcon() {
    if (this._iconElement) this._iconElement.style.display = "none";
    if (this._faIconElement) this._faIconElement.style.display = "none";
  }

  _renderHTML() {
    this.shadowRoot.innerHTML = `
      <style>
        @import url('https://cdnjs.cloudflare.com/ajax/libs/font-awesome/5.3.1/css/all.min.css');

        /* Important: let clicks pass through the ripple */
        paper-ripple { pointer-events: none; }

        #container { display:flex; flex-direction:column; }

        #item-wrapper {
          background-color: var(--surface-color);
          color: var(--on-surface-color);
          display:flex;
          min-width:150px;
          padding:3px;
          transition:background .2s ease, padding .8s linear;
          position:relative;
          align-items:center;
          justify-content:center;
        }
        #item-wrapper:hover { background-color: var(--hover-color, #f0f0f0); cursor:pointer; }

        #icon-container, iron-icon {  }
        #fa-icon { display:none; font-size:1.2rem; }

        #text-span { flex-grow:1; font-size:1rem; min-width:140px; }
        #shortcut { font-size:.8rem; color:var(--on-surface-color); padding-right:5px; }

        .separator {
          display:none;
          border-top:1px solid var(--palette-divider, lightgray);
          margin-top:2px; padding-top:2px;
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

    if (this._separatorSpan && this._hasSeparator) this._separatorSpan.style.display = "block";
    if (this._textSpan) this._textSpan.innerHTML = this._text;
    if (this._shortcutSpan) this._shortcutSpan.innerHTML = this._shortcut;

    this._setIcon(this._icon);
  }

  _setupEventListeners() {
    // Fallback: ensure clicks anywhere inside the custom element trigger the action
    this.addEventListener("click", this._handleItemClick);
  }

  _cleanupEventListeners() {
   // this.removeEventListener("click", this._handleItemClick);
  }

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

  _handleItemClick (evt){
    evt.preventDefault();
    evt.stopPropagation();
    this.action?.();
    this.dispatchEvent(new CustomEvent('on-action', { bubbles:true, composed:true, detail:{} }));
    // Close the nearest dropdown host
    this.closest('globular-dropdown-menu')?.close?.();
  };
}

customElements.define('globular-dropdown-menu-item', DropdownMenuItem);

export class DropdownMenu extends HTMLElement {
  _isOpen = false;
  _icon = '';
  _text = '';
  _opening = false;        // <— defers the first outside-click close
  _outsideArmed = false;   // <— tracks outside-close listener

  _container = null;
  _menuItemsCard = null;
  _menuBtn = null;
  _textSpan = null;

  onopen = null;
  onclose = null;

  constructor(icon, text) {
    super();
    this.attachShadow({ mode: 'open' });
    this._icon = icon || "";
    this._text = text || "";
    this._renderHTML();
  }

  connectedCallback() {
    this._cacheElements();
    this._applyInitialAttributes();
    this._setupEventListeners();
  }

  disconnectedCallback() {
    this._cleanupEventListeners();
    this._disarmOutsideClose();
  }

  /** Programmatic positioner (used by FileIconView). */
  positionAt(x, y) {
    this.style.position = 'absolute';
    this.style.left = `${Math.round(x)}px`;
    this.style.top  = `${Math.round(y)}px`;
  }

  /** Programmatic open at given coordinates. */
  openAt(x, y) {
    this.positionAt(x, y);
    this.open();
  }

  open() {
    if (this._menuItemsCard) this._menuItemsCard.style.display = "block";
    if (this._textSpan) {
      this._textSpan.style.textDecoration = "underline";
      this._textSpan.style.backgroundColor = "var(--surface-color)";
    }
    this._isOpen = true;
    this._opening = true;                 // prevent immediate outside-close
    this._armOutsideClose();
    setTimeout(() => { this._opening = false; }, 0);

    this.onopen?.();
    this.dispatchEvent(new CustomEvent('on-open', { bubbles:true, composed:true }));
  }

  close() {
    if (!this._isOpen) return;
    if (this._menuItemsCard) this._menuItemsCard.style.display = "none";
    if (this._textSpan) {
      this._textSpan.style.textDecoration = "none";
      this._textSpan.style.backgroundColor = "var(--background-color)";
    }
    this._isOpen = false;
    this._opening = false;
    this._disarmOutsideClose();
    this.onclose?.();
    this.dispatchEvent(new CustomEvent('on-close', { bubbles:true, composed:true }));
  }

  isOpen() { return this._isOpen; }

  hideBtn() { if (this._menuBtn) this._menuBtn.style.display = "none"; }
  showBtn() { if (this._menuBtn) this._menuBtn.style.display = "block"; }

  _renderHTML() {
    this.shadowRoot.innerHTML = `
      <style>
        #container {
          display:flex; align-items:center; width:fit-content; justify-content:center;
          position:relative; transition:background .2s ease, padding .8s linear;
          user-select:none; margin-right:10px;
        }
        .card-content { display:flex; flex-direction:column; padding:0; }
        .menu-items { position:absolute; top:25px; left:0; display:none; z-index:1000; }

        #icon-i:hover, iron-icon:hover { cursor:pointer; }
        #icon-i, iron-icon { display:none; }

        #text {
          padding-left:10px; padding-right:10px;
          background-color: var(--background-color);
          color: var(--on-background-color);
          transition: background .2s ease, padding .8s linear;
        }
        #text:hover { cursor:pointer; background-color: var(--hover-color, #f0f0f0); }
      </style>
      <div id="container">
        <iron-icon id="menu-icon" icon="${this._icon}"></iron-icon>
        <i id="icon-i" class="${this._icon}"></i>
        <span id="text"></span>
        <paper-card class="menu-items">
          <div class="card-content"><slot></slot></div>
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
    if (this._text) this._textSpan.innerHTML = this._text;
    if (this._icon) this._menuBtn.icon = this._icon;

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
    // Toggle when clicking the menu itself (if used as a normal toolbar menu).
    this._container.addEventListener("click", this._handleContainerClick);
  }

  _cleanupEventListeners() {
    this._container?.removeEventListener("click", this._handleContainerClick);
  }

  _handleContainerClick (evt)  {
    evt.stopPropagation();
    this.isOpen() ? this.close() : this.open();
  };

  // --- Outside click handling with arming to avoid same-tick close ---
  _handleOutsideClickCapture(event){
    if (this._opening) return; // ignore the click that opened us
    const path = event.composedPath?.() || [];
    if (!path.includes(this) && !this.contains(event.target)) {
      this.close();
    }
  };

  _armOutsideClose() {
    if (this._outsideArmed) return;
    this._outsideArmed = true;
    document.addEventListener('mousedown', this._handleOutsideClickCapture, true);
  }

  _disarmOutsideClose() {
    if (!this._outsideArmed) return;
    this._outsideArmed = false;
    document.removeEventListener('mousedown', this._handleOutsideClickCapture, true);
  }
}

customElements.define('globular-dropdown-menu', DropdownMenu);

export class MenuBar extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  connectedCallback() {
    this._renderHTML();
    this._setupEventListeners();
  }

  disconnectedCallback() {
    this._cleanupEventListeners();
  }

  _renderHTML() {
    this.shadowRoot.innerHTML = `
      <style>
        #container { background-color: var(--background-color); color: var(--on-background-color); display:flex; }
      </style>
      <div id="container"><slot></slot></div>
    `;
  }

  _setupEventListeners() {
    const slot = this.shadowRoot.querySelector('slot');
    if (slot) slot.addEventListener("slotchange", this._handleSlotChange);
  }

  _cleanupEventListeners() {
    const slot = this.shadowRoot.querySelector('slot');
    if (slot) slot.removeEventListener("slotchange", this._handleSlotChange);
  }

  _handleSlotChange = () => {
    const menus = this.querySelectorAll("globular-dropdown-menu");
    menus.forEach(menu => {
      menu.addEventListener("on-open", this._handleMenuOpen);
      menu.addEventListener("click", evt => evt.stopPropagation());
    });
  };

  _handleMenuOpen = (evt) => {
    this.querySelectorAll("globular-dropdown-menu").forEach(menu => {
      if (menu !== evt.target && !menu.contains(evt.target)) menu.close();
    });
  };
}

customElements.define('globular-menu-bar', MenuBar);
