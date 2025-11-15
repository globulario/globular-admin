import '@polymer/iron-icons/iron-icons.js';
import '@polymer/paper-icon-button/paper-icon-button.js';
import '@polymer/app-layout/app-drawer-layout/app-drawer-layout.js';
import '@polymer/app-layout/app-drawer/app-drawer.js';
import '@polymer/app-layout/app-scroll-effects/app-scroll-effects.js';
import '@polymer/app-layout/app-header/app-header.js';
import '@polymer/app-layout/app-header-layout/app-header-layout.js';
import '@polymer/app-layout/app-toolbar/app-toolbar.js';
import '@polymer/iron-collapse/iron-collapse.js';
import '@polymer/paper-ripple/paper-ripple.js';

/* ------------------------------------------------------------------ */
/* Responsive toolbar helper                                          */
/* ------------------------------------------------------------------ */

class ResponsiveToolbar {
  constructor(toolbar, overflowMenu, overflowDropdown) {
    this.toolbarContainer = toolbar;
    this.toolbarSlot = toolbar.querySelector('slot[name="contextual-action-bar"]');
    this.overflowMenu = overflowMenu;
    this.overflowMenuSlot = overflowMenu.querySelector('slot[name="overflow-menu"]');
    this.overflowDropdown = overflowDropdown;

    this.checkOverflow = this.checkOverflow.bind(this);
    this._onResize = this.checkOverflow.bind(this);

    window.addEventListener('resize', this._onResize);
    // Run on first frame so layout is stable
    requestAnimationFrame(this.checkOverflow);
  }

  disconnect() {
    window.removeEventListener('resize', this._onResize);
  }

  checkOverflow() {
    if (!this.toolbarSlot || !this.overflowMenuSlot) return;

    const movedItems = [];

    // All actions from both areas
    const actions = [
      ...this.toolbarSlot.assignedElements(),
      ...this.overflowMenuSlot.assignedElements(),
    ];

    // If container has no width (hidden / collapsed), bail and hide overflow
    const toolbarWidth =
      this.toolbarContainer.clientWidth ||
      this.toolbarContainer.offsetWidth ||
      0;

    if (!toolbarWidth || actions.length === 0) {
      this.overflowMenu.setAttribute('hidden', '');
      return;
    }

    // Try to place all actions in main bar first
    actions.forEach((action) => {
      action.slot = 'contextual-action-bar';
    });

    let totalWidth = 0;

    actions.forEach((action) => {
      // offsetWidth is 0 if not visible; just include anyway
      totalWidth += action.offsetWidth || 0;

      if (totalWidth > toolbarWidth) {
        action.slot = 'overflow-menu';
        movedItems.push(action);
      }
    });

    // Show or hide the overflow menu based on moved items
    if (movedItems.length === 0) {
      this.overflowMenu.setAttribute('hidden', '');
    } else {
      this.overflowMenu.removeAttribute('hidden');
    }
  }
}

/* ------------------------------------------------------------------ */
/* AppLayout                                                          */
/* ------------------------------------------------------------------ */

// Create a class for the element
export class AppLayout extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });

    this._toolbar = null;
    this._onDocClick = null;
  }

  connectedCallback() {
    // Retrieve saved theme data from local storage
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme) {
      try {
        const themeData = JSON.parse(savedTheme);
        const root = document.documentElement;

        root.style.setProperty('--primary-color', themeData['primary-color']);
        root.style.setProperty('--secondary-color', themeData['secondary-color']);
        root.style.setProperty('--error-color', themeData['error-color']);
        root.style.setProperty('--on-surface-color', themeData['on-surface-color']);
        root.style.setProperty('--on-primary-color', themeData['on-primary-color']);
        root.style.setProperty('--on-secondary-color', themeData['on-secondary-color']);
        root.style.setProperty('--on-error-color', themeData['on-error-color']);
        root.style.setProperty('--background-color', themeData['background-color']);
        root.style.setProperty('--surface-color', themeData['surface-color']);
        root.style.setProperty('--primary-light-color', themeData['primary-light-color']);
        root.style.setProperty('--secondary-light-color', themeData['secondary-light-color']);
        root.style.setProperty('--primary-dark-color', themeData['primary-dark-color']);
        root.style.setProperty('--secondary-dark-color', themeData['secondary-dark-color']);
      } catch (e) {
        console.warn('Invalid saved theme JSON', e);
      }
    }

    const applicationName =
      this.getAttribute('application-name') || 'Default Application Name';
    document.title = applicationName;

    this.shadowRoot.innerHTML = `
        <style>
          @import url('./styles.css');

          app-drawer-layout {
            --app-drawer-width: 256px;
            height: 100vh;
            --app-drawer-content-container: {
              background-color: var(--surface-color);
              color: var(--on-surface-color);
            };
          }

          ::slotted([slot="app-content"]) {
            display: block;
            box-sizing: border-box;
            padding: 16px;
            height: calc(100vh - 64px);
            overflow-y: auto;
            background-color: var(--background-color);
            color: var(--on-surface-color);
          }

          /* Firefox */
          ::slotted([slot="app-content"])  {
            scrollbar-width: thin;
            scrollbar-color: var(--scroll-thumb) var(--scroll-track);
          }

          /* Chromium/WebKit */
          ::slotted([slot="app-content"])::-webkit-scrollbar {
            width: 10px;
            height: 10px;
          }
          ::slotted([slot="app-content"])::-webkit-scrollbar-track {
            background: var(--scroll-track);
          }
          ::slotted([slot="app-content"])::-webkit-scrollbar-thumb {
            background-color: var(--scroll-thumb);
            border-radius: 6px;
            border: 2px solid var(--scroll-track);
          }
          ::slotted([slot="app-content"])::-webkit-scrollbar-thumb:hover {
            background-color: var(--scroll-thumb-hover);
          }

          app-drawer-layout[narrow] app-header {
            width: 100%;
            margin-left: 0;
          }

          app-drawer-layout:not([narrow]) [drawer-toggle] {
            display: none;
          }
        
          app-header {
            width: calc(100% - var(--app-drawer-width, 256px));
            margin-left: var(--app-drawer-width, 256px);
            background-color: var(--primary-color);
            color: var(--on-primary-color);
            display: flex;
            flex-direction: column;
            flex-wrap: nowrap;
            justify-content: flex-start;
            box-sizing: border-box;
            flex-shrink: 0;
            margin: 0;
            padding: 0;
            border: none;
            min-height: 64px;
            z-index: 3;
            box-shadow: 0 2px 2px 0 rgba(0, 0, 0, .14),
                        0 3px 1px -2px rgba(0, 0, 0, .2),
                        0 1px 5px 0 rgba(0, 0, 0, .12);
            transition: max-height 0.2s cubic-bezier(.4, 0, .2, 1),
                        box-shadow 0.2s cubic-bezier(.4, 0, .2, 1);
          }

          app-header-layout {
              background-color: var(--background-color);
              color: var(--on-surface-color);
          }

          paper-icon-button[drawer-toggle] {
            flex-shrink: 0;
            min-width: 40px;
            min-height: 40px;
            width: 40px;
            height: 40px;
            overflow: visible;
          }

          #toolbar {
            display: flex;
            flex-grow: 1;
            max-width: 100%;
            overflow: hidden;
            padding: 0 1rem;
          }
        
          #contextual-action-bar {
            justify-content: flex-end;
            display: flex;
            flex-grow: 1;
            overflow: hidden;
          }

          #overflow-menu {
            position: relative;
            display: flex;
            align-items: center;
            cursor: pointer;
            background: var(--surface-color);
            color: var(--on-surface-color);
          }

          #overflow-menu[hidden] {
            display: none;
          }

          #overflow-dropdown {
            position: fixed;
            right: 40px;
            top: 56px;
            background: var(--surface-color);
            color: var(--on-surface-color); 
            box-shadow: 0 2px 10px rgba(0, 0, 0, 0.2);
            padding-left: 0.5rem;
            padding-right: 0.5rem;
            border-radius: 2px;
            z-index: 10;
            font-size: 1rem;
            font-weight: 400;
          }

          #overflow-dropdown[hidden] {
            display: none;
          }

          /* Items added into the contextual action bar */
          ::slotted([slot="contextual-action-bar"]) {
            white-space: nowrap;
            padding: 0 .5rem;
            font-size: 1rem;
            font-weight: 500;
            align-self: center;
            display: flex;
            color: var(--on-primary-color);
          }

          ::slotted([slot="overflow-menu"]) {
            white-space: nowrap;
            padding: .25rem 0;
            display: block;
          }

      </style>
      
      <app-drawer-layout>
        <app-drawer slot="drawer">
            <slot name="app-side-menu"></slot>
        </app-drawer>
        <app-header-layout>
          <app-header style="display: block;" class="mdl-layout__header is-casting-shadow" slot="header" reveals
            effects="waterfall">
            <app-toolbar>
              <paper-icon-button icon="menu" drawer-toggle></paper-icon-button>

              <div id="toolbar" style="display: flex; flex-grow: 1;">
                <slot name="app-logo"></slot>
                <div id="main-title">
                  <slot name="app-title"></slot>
                </div>

                <!-- Action Bar (Main) -->
                <div id="contextual-action-bar">
                  <slot name="contextual-action-bar"></slot>
                </div>

                <!-- Overflow Menu -->
                <div id="overflow-menu" hidden>
                  <iron-icon icon="more-vert"></iron-icon>
                  <div id="overflow-dropdown" hidden>
                    <slot name="overflow-menu"></slot>
                  </div>
                </div>
              </div>
            </app-toolbar>
          </app-header>
          <slot name="app-content"></slot>
        </app-header-layout>
      </app-drawer-layout>
    `;

    const cab = this.shadowRoot.querySelector('#contextual-action-bar');
    const overflowMenu = this.shadowRoot.querySelector('#overflow-menu');
    const dropdown = this.shadowRoot.querySelector('#overflow-dropdown');

    if (cab && overflowMenu && dropdown) {
      this._toolbar = new ResponsiveToolbar(cab, overflowMenu, dropdown);

      // Toggle dropdown on overflow-menu click
      overflowMenu.addEventListener('click', (event) => {
        event.stopPropagation();
        if (dropdown.hasAttribute('hidden')) {
          dropdown.removeAttribute('hidden');
        } else {
          dropdown.setAttribute('hidden', '');
        }
      });

      // Close dropdown when clicking outside
      this._onDocClick = (evt) => {
        if (!dropdown || dropdown.hasAttribute('hidden')) return;
        const path = evt.composedPath ? evt.composedPath() : [evt.target];
        const insideOverflow = path.includes(overflowMenu);
        if (!insideOverflow) {
          dropdown.setAttribute('hidden', '');
        }
      };
      document.addEventListener('click', this._onDocClick, true);
    }
  }

  disconnectedCallback() {
    if (this._toolbar) {
      this._toolbar.disconnect();
      this._toolbar = null;
    }
    if (this._onDocClick) {
      document.removeEventListener('click', this._onDocClick, true);
      this._onDocClick = null;
    }
  }
}

customElements.define('globular-app-layout', AppLayout);

/* ------------------------------------------------------------------ */
/* SideBar                                                            */
/* ------------------------------------------------------------------ */

export class SideBar extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  connectedCallback() {
    this.shadowRoot.innerHTML = `
      <style>
        @import url('./styles.css');

        #container{
          background-color: var(--surface-color);
          color: var(--on-surface-color);
          height: 100vh;
        }

        #sidebar_main {
          width: 100%;
          height: 100%;
          display: flex;
          flex-direction: column;
        }

        #side-bar-content {
          flex-grow: 1;
          overflow-y: auto;
          overflow-x: hidden;
        }

        #sidebar_main .sidebar_main_header {
          height: 89px;
          border-bottom: 1px solid rgba(0,0,0,.12);
          background-image: url(../img/sidebar_head_bg.png);
          background-repeat: no-repeat;
          background-position: 0 0;
          position: relative;
        }

        #sidebar_main .sidebar_main_header .sidebar_logo {
          height: 48px;
          line-height: 1rem;
          overflow: hidden;
        }

        #sidebar_main .sidebar_main_header .sidebar_actions {
          margin: 0 20px;
        }

        .sidebar_logo{
          display: flex;
          align-items: center;
        }

        img#logo {
          height: 48px;
          width: auto;
          margin-left: 10px;
          margin-right: 10px;
        }

        span#title {
          font-size: 20px;
          font-weight: 400;
          font-family: "Segoe UI",Arial,sans-serif;
          text-transform: uppercase;
        }

        span#subtitle {
          font-size: 12px;
          font-weight: 400;
          font-family: "Segoe UI",Arial,sans-serif;
        }

        span#title, span#subtitle {
          color: var(--on-surface-color);
        }

      </style>
      <div id="container">
        <div id="sidebar_main">
            <div class="sidebar_main_header" >
              <div class="sidebar_logo">
                <slot name="header-logo"></slot>
                <div style="display: flex; flex-direction: column; padding-top:10px; padding-left:10px;">
                  <span id="title">
                    <slot name="header-title"></slot>
                  </span>
                  <span id="subtitle">
                    <slot name="header-subtitle"></slot>
                  </span>
                </div>
              </div>
            </div>
            <div id="side-bar-content">
              <slot></slot>
            </div>
        </div>
      </div>
      `;

    if (this.hasAttribute('header-background-colour')) {
      this.setHeaderBackgroundColour(this.getAttribute('header-background-colour'));
    }

    if (this.hasAttribute('header-background-image')) {
      this.setHeaderBackgroundImage(this.getAttribute('header-background-image'));
    }

    if (this.hasAttribute('header-icon')) {
      this.setHeaderIcon(this.getAttribute('header-icon'));
    }

    if (this.hasAttribute('header-title')) {
      this.setHeaderTitle(this.getAttribute('header-title'));
    }

    if (this.hasAttribute('header-subtitle')) {
      this.setHeaderSubtitle(this.getAttribute('header-subtitle'));
    }
  }

  setHeaderIcon(icon) {
    const logo = this.shadowRoot.querySelector('#logo');
    if (!logo) return;
    if (!this.hasAttribute('header-icon')) {
      logo.src = icon;
    } else {
      logo.src = this.getAttribute('header-icon');
    }
  }

  setHeaderBackgroundColour(colour) {
    const header = this.shadowRoot.querySelector('#sidebar_main .sidebar_main_header');
    if (header) header.style.backgroundColor = colour;
  }

  setHeaderBackgroundImage(image) {
    const header = this.shadowRoot.querySelector('#sidebar_main .sidebar_main_header');
    if (header) header.style.backgroundImage = `url(${image})`;
  }

  setHeaderTitle(title) {
    title = title || 'Application Name';
    const el = this.shadowRoot.querySelector('#title');
    if (el) el.innerText = title;
  }

  setHeaderSubtitle(subtitle) {
    subtitle = subtitle || 'Subtitle';
    const el = this.shadowRoot.querySelector('#subtitle');
    if (el) el.innerText = subtitle;
  }
}

customElements.define('globular-sidebar', SideBar);

/* ------------------------------------------------------------------ */
/* SideBarMenuItem                                                    */
/* ------------------------------------------------------------------ */

export class SideBarMenuItem extends HTMLElement {
  static get observedAttributes() {
    return ['alias', 'edit-mode'];
  }

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  connectedCallback() {
    this.shadowRoot.innerHTML = `
      <style>
          @import url('./styles.css');

          #container{
              transition: background 0.8s ease,padding 0.8s linear;
              background-color: var(--surface-color);
              color: var(--on-surface-color);
              font: 500 14px/25px Roboto,sans-serif;
              display: flex;
              flex-direction: column;
              padding-left: 8px;
              padding-top: 8px;
              padding-right: 8px;
              position: relative;
              border: 1px solid transparent;
              width: 100%;
          }

          #container:hover {
            cursor: pointer;
            -webkit-filter: invert(2%);
            filter: invert(2%);
            background-color: color-mix(in srgb, var(--on-surface-color) 4%, transparent);
          }

          #icon {
            font-size: 24px;
            vertical-align: top;
            margin-right: 25px;
            margin-left: 10px;
            color: var(--on-surface-color);
          }

          #text {
            flex-grow: 1;
          }

          #collapse-btn {
            display: none;
            align-self: end;

          }

          #collapse-panel {
            margin-top: 8px;
            display: none;
          }

          :host(globular-sidebar-menu-item) {
            display: flex;
          } 
            
          :host(.drag-over-top) {
            border-top: 2px dashed var(--primary-color, #000);
          }
          :host(.drag-over-bottom) {
            border-bottom: 2px dashed var(--primary-color, #000);
          }

          ::slotted(iron-icon) {
              width: 16px;
              height: 16px;
              margin-left: 8px;
          }

          ::slotted(iron-icon:hover) {
              cursor: pointer;
          }

          slot[name="actions"] {
            display: none;
            flex-direction: row;
            align-items: center;
            margin-right: 10px;
          }

      </style>
      <div id="container">
          <div style="display: flex; flex-direction: row; position: relative; align-items: center;">
            <i id="icon"></i>
            <span id="text"></span>

            <slot name="actions"></slot>

            <div style="display: flex;">
                <div style="position: relative;">
                    <iron-icon id="collapse-btn" icon="icons:expand-more"
                               style="--iron-icon-fill-color:var(--on-surface-color, var(--primary-text-color));"></iron-icon>
                    <paper-ripple class="circle" recenters=""></paper-ripple>
                </div>
            </div>
            
          </div>
          <iron-collapse class="subitems" id="collapse-panel" style="display: flex; flex-direction: column;">
              <slot></slot>
          </iron-collapse>
          <paper-ripple id="mr-ripple"></paper-ripple>
      </div>
      `;

    const slot = this.shadowRoot.querySelector('slot:not([name])');
    slot.addEventListener('slotchange', this.handleSlotChange.bind(this));

    const collapse_btn = this.shadowRoot.querySelector('#collapse-btn');
    const collapse_panel = this.shadowRoot.querySelector('#collapse-panel');
    if (collapse_btn && collapse_panel) {
      collapse_btn.onclick = (evt) => {
        evt.stopPropagation();
        collapse_btn.icon = collapse_panel.opened ? 'expand-more' : 'expand-less';
        collapse_panel.toggle();
      };
    }

    if (this.hasAttribute('icon')) {
      const icon = this.getAttribute('icon');
      const iconEl = this.shadowRoot.querySelector('#icon');
      if (iconEl) {
        if (icon.startsWith('fa')) {
          iconEl.className = icon;
        } else if (icon.endsWith('.svg')) {
          iconEl.innerHTML = `<img src="${icon}" style="height: 24px; width: auto;"/>`;
        }
      }
    }

    if (this.hasAttribute('text')) {
      const textEl = this.shadowRoot.querySelector('#text');
      if (textEl) textEl.innerText = this.getAttribute('text');
    }

    this.container = this.shadowRoot.querySelector('#container');
    this.textElement = this.shadowRoot.querySelector('#text');
    this.iconElement = this.shadowRoot.querySelector('#icon');
  }

  attributeChangedCallback(name, oldValue, newValue) {
    if (name === 'alias') {
      const textEl = this.shadowRoot.querySelector('#text');
      if (textEl) textEl.textContent = newValue;
    } else if (name === 'edit-mode') {
      const actions = this.shadowRoot.querySelector('slot[name="actions"]');
      if (!actions) return;
      if (newValue === 'true') {
        actions.style.display = 'flex';
      } else {
        actions.style.display = 'none';
      }
    }
  }

  handleSlotChange(event) {
    const slot = event.target;
    const assignedElements = slot.assignedNodes({ flatten: true });

    const elementCount = assignedElements.length;
    if (elementCount > 0) {
      const collapseBtn = this.shadowRoot.querySelector('#collapse-btn');
      const collapsePanel = this.shadowRoot.querySelector('#collapse-panel');
      const ripple = this.shadowRoot.querySelector('#mr-ripple');

      if (collapseBtn) collapseBtn.style.display = 'block';
      if (collapsePanel) collapsePanel.style.display = 'block';
      if (ripple) ripple.style.display = 'none';

      assignedElements.forEach((element) => {
        if (element.setSubitem) element.setSubitem();
      });
    }
  }

  setSubitem() {
    const text = this.shadowRoot.querySelector('#text');
    const icon = this.shadowRoot.querySelector('#icon');
    if (text) {
      text.style.fontSize = '.9rem';
      text.style.fontWeight = '400';
      text.style.fontFamily = 'Roboto, sans-serif';
    }
    if (icon) {
      icon.style.fontSize = '20px';
    }
  }
}

customElements.define('globular-sidebar-menu-item', SideBarMenuItem);

/* ------------------------------------------------------------------ */
/* SideBarMenu                                                        */
/* ------------------------------------------------------------------ */

export class SideBarMenu extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.draggedItem = null;
  }

  connectedCallback() {
    this.shadowRoot.innerHTML = `
      <style>
        #container {
          background-color: var(--surface-color);
          color: var(--on-surface-color); 
          display: flex;
          flex-direction: column;
        }

        .draggable {
          cursor: grab;
        }

        .dragging {
          opacity: 0.5;
        }

        ::slotted(globular-sidebar-menu-item) {
          display: flex;
        } 

        ::slotted(globular-sidebar-menu-item.drag-over-top) {
          border-top: 2px dashed var(--primary-color, #000);
        }

        ::slotted(globular-sidebar-menu-item.drag-over-bottom) {
          border-bottom: 2px dashed var(--primary-color, #000);
        }

      </style>
      <div id="container">
        <slot></slot>
      </div>
    `;

    const slot = this.shadowRoot.querySelector('slot');
    slot.addEventListener('slotchange', () => this.handleSlotChange(slot));
  }

  handleSlotChange(slot) {
    const setDragEvents = (item, index) => {
      if (item.tagName === 'GLOBULAR-SIDEBAR-MENU-ITEM') {
        item.setAttribute('draggable', true);
        item.classList.add('draggable');
        item.dataset.index = index;

        item.addEventListener('dragstart', (e) => this.handleDragStart(e));
        item.addEventListener('dragover', (e) => this.handleDragOver(e));
        item.addEventListener('drop', (e) => this.handleDrop(e));
        item.addEventListener('dragend', (e) => this.handleDragEnd(e));
        item.addEventListener('dragleave', (e) => this.handleDragLeave(e));

        const subitems = item.querySelectorAll('globular-sidebar-menu-item');
        subitems.forEach((subitem, subIndex) => {
          setDragEvents(subitem, subIndex);
        });
      }
    };

    const assignedItems = slot.assignedElements();
    assignedItems.forEach((item, index) => {
      setDragEvents(item, index);
    });
  }

  handleDragStart(event) {
    const target = event.target;
    event.stopPropagation();

    if (target.tagName === 'GLOBULAR-SIDEBAR-MENU-ITEM') {
      event.dataTransfer.setData('text/plain', target.dataset.index || '');
      this.draggedItem = target;

      const dragImage = document.createElement('div');
      dragImage.classList.add('drag-image');
      dragImage.style.width = target.offsetWidth + 'px';
      dragImage.style.height = target.offsetHeight + 'px';
      dragImage.style.position = 'absolute';
      dragImage.style.top = '-1000px';
      dragImage.style.left = '-1000px';
      dragImage.appendChild(target.cloneNode(true));
      document.body.appendChild(dragImage);

      event.dataTransfer.setDragImage(dragImage, 0, 0);
    }
  }

  handleDragOver(event) {
    event.preventDefault();
    event.stopPropagation();

    const target = event.target.closest('globular-sidebar-menu-item');
    if (target) {
      const targetRect = target.getBoundingClientRect();
      const midPoint = targetRect.top + targetRect.height / 2;

      if (event.clientY < midPoint) {
        target.classList.add('drag-over-top');
        target.classList.remove('drag-over-bottom');
      } else {
        target.classList.add('drag-over-bottom');
        target.classList.remove('drag-over-top');
      }
    }
  }

  handleDragLeave(event) {
    const target = event.target.closest('globular-sidebar-menu-item');
    if (target) {
      target.classList.remove('drag-over-top', 'drag-over-bottom');
    }
  }

  handleDrop(event) {
    event.preventDefault();
    event.stopPropagation();

    if (!this.draggedItem) {
      this.draggedItem = null;
      return;
    }

    const target = event.target.closest('globular-sidebar-menu-item');
    if (!target) return;

    let parent = target.parentElement;
    if (!parent) parent = this;

    const assignedItems = Array.from(
      parent.querySelectorAll(':scope > globular-sidebar-menu-item')
    );

    if (target === this.draggedItem) {
      assignedItems.forEach((item) =>
        item.classList.remove('drag-over-top', 'drag-over-bottom')
      );
      this.draggedItem = null;
      return;
    }

    const targetIndex = assignedItems.findIndex((item) => item === target);
    const targetRect = target.getBoundingClientRect();
    const midPoint = targetRect.top + targetRect.height / 2;

    let newIndex;
    if (event.clientY < midPoint) {
      newIndex = targetIndex;
    } else {
      newIndex = targetIndex + 1;
    }

    this.draggedItem.remove();

    if (newIndex >= assignedItems.length) {
      parent.appendChild(this.draggedItem);
    } else {
      const referenceNode = assignedItems[newIndex];
      parent.insertBefore(this.draggedItem, referenceNode);
    }

    const items_change_event = new CustomEvent('items-change-event', {
      detail: {
        menuItem: this.draggedItem,
      },
    });
    document.dispatchEvent(items_change_event);

    assignedItems.forEach((item) =>
      item.classList.remove('drag-over-top', 'drag-over-bottom')
    );
    this.draggedItem = null;
  }

  handleDragEnd() {
    const items = this.shadowRoot.querySelectorAll('globular-sidebar-menu-item');
    items.forEach((item) =>
      item.classList.remove(
        'dragging',
        'drag-over',
        'drag-over-top',
        'drag-over-bottom'
      )
    );
    const dragImage = document.querySelector('.drag-image');
    if (dragImage && dragImage.parentNode) {
      dragImage.parentNode.removeChild(dragImage);
    }
  }
}

customElements.define('globular-sidebar-menu', SideBarMenu);
