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

// Create a class for the element
export class AppLayout extends HTMLElement {
  // attributes.

  // Create the application view.
  constructor() {
    super();

    // Set the shadow dom.
    this.attachShadow({ mode: 'open' });
  }

  connectedCallback() {

    // Retrieve saved theme data from local storage
    const savedTheme = localStorage.getItem("theme");
    if (savedTheme) {
      const themeData = JSON.parse(savedTheme);
      const root = document.documentElement;

      // Apply saved theme data to CSS variables
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

      // ... set other CSS variables using saved values
    }

    // Get the application name and url.
    const applicationName = this.getAttribute('application-name') || 'Default Application Name';
    document.title = applicationName

    // Set the application name.
    //document.querySelector("meta[name='application-name']").setAttribute("content", applicationName);

    // Initialization of the layout.
    this.shadowRoot.innerHTML = `
        <style>
          @import url('./styles.css');

          app-drawer-layout[narrow] app-header {
            width: 100%; /* Full width when in narrow mode */
            margin-left: 0; /* No offset in narrow mode */
          }


          app-drawer-layout:not([narrow]) [drawer-toggle] {
            display: none;
          }
        
          app-header {
            width: calc(100% - var(--app-drawer-width, 256px)); /* Adjust header width */
            margin-left: var(--app-drawer-width, 256px); /* Offset to align with drawer */
            background-color: var(--primary-color);
            color: var(--text-primary-color);
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
            box-shadow: 0 2px 2px 0 rgba(0, 0, 0, .14), 0 3px 1px -2px rgba(0, 0, 0, .2), 0 1px 5px 0 rgba(0, 0, 0, .12);
            transition: max-height 0.2s cubic-bezier(.4, 0, .2, 1), box-shadow 0.2s cubic-bezier(.4, 0, .2, 1);
          }

          app-header-layout {
            background-color: var(--background-color); 
          }

          paper-icon-button[drawer-toggle] {
            flex-shrink: 0; /* Prevent shrinking */
            min-width: 40px; /* Default Material Design icon button size */
            min-height: 40px;
            width: 40px; /* Ensure it maintains a consistent size */
            height: 40px;
            overflow: visible; /* Prevents it from being clipped */
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
        }

        #overflow-dropdown {
          position: fixed;
          top: 100%;
          right: 40px;
          background: var(--surface-color);
          color: var(--on-surface-color); 
          box-shadow: 0 2px 10px rgba(0, 0, 0, 0.2);
          padding-left: 0.5rem;
          padding-right: 0.5rem;
          border-radius: 2px;
          z-index: 10;
          font-size: 1rem;
          font-weight: 400;
          display: none;
        }

          ::slotted([slot="contextual-action-bar"]) {
            white-space: nowrap;
            padding: 0 .5rem;
            font-size: 1rem;
            font-weight: 500;
            align-self: center;
            display: flex;
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
          <slot name="app-content" style=""></slot>
        </app-header-layout>
      </app-drawer-layout>
    `

    // Create a new instance of the ResponsiveToolbar class
    let toolbar = new ResponsiveToolbar(this.shadowRoot.querySelector('#contextual-action-bar'),
      this.shadowRoot.querySelector('#overflow-menu'),
      this.shadowRoot.querySelector('#overflow-dropdown'));

    const menuButton = this.shadowRoot.querySelector('#overflow-menu');
    const dropdown = this.shadowRoot.querySelector('#overflow-dropdown');

    // Close the dropdown when clicking outside of it
    menuButton.addEventListener('click', (event) => {
      event.stopPropagation();
      if (dropdown.hasAttribute('hidden')) {
        dropdown.removeAttribute('hidden');
        dropdown.style.display = 'block';
      } else {
        dropdown.setAttribute('hidden', '');
        dropdown.style.display = 'none';
      }
    });


  }
}

customElements.define('globular-app-layout', AppLayout);


class ResponsiveToolbar {
  constructor(toolbar, overflowMenu, overflowDropdown) {
    this.toolbarContainer = toolbar;
    this.toolbarSlot = toolbar.querySelector('slot[name="contextual-action-bar"]');
    this.overflowMenu = overflowMenu
    this.overflowMenuSlot = overflowMenu.querySelector('slot[name="overflow-menu"]');
    this.overflowDropdown = overflowDropdown;

    this.checkOverflow = this.checkOverflow.bind(this);
    window.addEventListener('resize', this.checkOverflow);

    this.checkOverflow(); // Run on load
  }

  checkOverflow() {
    let movedItems = [];

    // Get all actions inside both contextual-action-bar and overflow-menu
    const actions = [...this.toolbarSlot.assignedElements(), ...this.overflowMenuSlot.assignedElements()];

    actions.forEach(action => {
      action.slot = "contextual-action-bar"; // Try to place all actions in the main toolbar first
    });

    let toolbarWidth = this.toolbarContainer.offsetWidth;
    let totalWidth = 0;

    actions.forEach(action => {
      totalWidth += action.offsetWidth;

      if (totalWidth > toolbarWidth) {
        action.slot = "overflow-menu"; // Move to overflow menu
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


/**
 * This is the application sidebar.
 */
export class SideBar extends HTMLElement {
  // attributes.

  // Create the applicaiton view.
  constructor() {
    super()
    // Set the shadow dom.
    this.attachShadow({ mode: 'open' });
  }

  // The connection callback.
  connectedCallback() {

    // Innitialisation of the layout.
    this.shadowRoot.innerHTML = `
      <style>
        @import url('./styles.css');

        #container{
            background-color: var(--surface-color);
            color: var(on-surface-color);
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
      `

    // give the focus to the input.
    if (this.hasAttribute("header-background-colour")) {
      this.setHeaderBackgroundColour(this.getAttribute("header-background-colour"))
    }

    if (this.hasAttribute("header-background-image")) {
      this.setHeaderBackgroundImage(this.getAttribute("header-background-image"))
    }

    if (this.hasAttribute("header-icon")) {
      this.setHeaderIcon(this.getAttribute("header-icon"))
    }

    if (this.hasAttribute("header-title")) {
      this.setHeaderTitle(this.getAttribute("header-title"))
    }

    if (this.hasAttribute("header-subtitle")) {
      this.setHeaderSubtitle(this.getAttribute("header-subtitle"))
    }

  }

  /**
   * Set the header icon.
   * @param {*} icon 
   */
  setHeaderIcon(icon) {
    // be sure to not override the icon if attribute is set.
    if (!this.hasAttribute("header-icon")) {
      this.shadowRoot.querySelector("#logo").src = icon
    } else {
      this.shadowRoot.querySelector("#logo").src = this.getAttribute("header-icon")
    }
  }

  /**
   * Set the header background colour.
   * @param {*} colour 
   */
  setHeaderBackgroundColour(colour) {
    this.shadowRoot.querySelector("#sidebar_main .sidebar_main_header").style.backgroundColor = colour
  }

  /**
   * Set the header background image.
   */
  setHeaderBackgroundImage(image) {
    this.shadowRoot.querySelector("#sidebar_main .sidebar_main_header").style.backgroundImage = `url(${image})`
  }

  /**
   * Set the header title.
   * @param {*} title
   */
  setHeaderTitle(title) {
    title = title || "Application Name"
    this.shadowRoot.querySelector("#title").innerText = title
  }

  /**
   * Set the header subtitle.
   * @param {*} subtitle 
   */
  setHeaderSubtitle(subtitle) {
    subtitle = subtitle || "Subtitle"
    this.shadowRoot.querySelector("#subtitle").innerText = subtitle
  }

}

customElements.define('globular-sidebar', SideBar)

/**
 * This is the sidebar menu item.
 */
export class SideBarMenuItem extends HTMLElement {
  // attributes.
  static get observedAttributes() {
    return ['alias', 'edit-mode']; // List of attributes to observe
  }

  // Create the applicaiton view.
  constructor() {
    super()
    // Set the shadow dom.
    this.attachShadow({ mode: 'open' });
  }

  // The connection callback.
  connectedCallback() {

    // Innitialisation of the layout.
    this.shadowRoot.innerHTML = `
      <style>
          /* import the font awesome stylesheet.*/
          @import url('./styles.css');

          #container{
              transition: background 0.8s ease,padding 0.8s linear;
              background-color: var(--surface-color);
              color: var(on-surface-color);
              font: 500 14px/25px Roboto,sans-serif;
              color: #212121;
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
          }

          #icon {
            font-size: 24px;
            vertical-align: top;
            margin-right: 25px;
            margin-left: 10px;
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
              width: 16px;   /* Define the size */
              height: 16px;  /* Define the size */
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
                    <iron-icon  id="collapse-btn"  icon="icons:expand-more" --iron-icon-fill-color:var(--primary-text-color);"></iron-icon>
                    <paper-ripple class="circle" recenters=""></paper-ripple>
                </div>
            </div>
            
          </div>
          <iron-collapse class="subitems" id="collapse-panel" style="display: flex; flex-direction: column;">
              <slot></slot>
          </iron-collapse>
          <paper-ripple id="mr-ripple"></paper-ripple>
      </div>
      `
    const slot = this.shadowRoot.querySelector('slot:not([name])');
    slot.addEventListener('slotchange', this.handleSlotChange.bind(this));


    let collapse_btn = this.shadowRoot.querySelector("#collapse-btn")
    let collapse_panel = this.shadowRoot.querySelector("#collapse-panel")
    collapse_btn.onclick = (evt) => {
      evt.stopPropagation();
      if (!collapse_panel.opened) {
        collapse_btn.icon = "expand-less"
      } else {
        collapse_btn.icon = "expand-more"
      }
      collapse_panel.toggle();
    }

    // give the focus to the input.
    if (this.hasAttribute("icon")) {
      let icon = this.getAttribute("icon")
      if (icon.startsWith("fa")) {
        this.shadowRoot.querySelector("#icon").className = this.getAttribute("icon")
      } else if (icon.endsWith(".svg")) {
        this.shadowRoot.querySelector("#icon").innerHTML = `<img src="${icon}" style="height: 24px; width: auto;"/>`
      }
    }

    if (this.hasAttribute("text")) {
      this.shadowRoot.querySelector("#text").innerText = this.getAttribute("text")
    }
    this.container = this.shadowRoot.querySelector('#container');
    this.textElement = this.shadowRoot.querySelector('#text');
    this.iconElement = this.shadowRoot.querySelector('#icon');

    // Setup drag and drop event listeners
    this.container = this.shadowRoot.querySelector('#container');
  }

  // Called whenever an observed attribute changes
  attributeChangedCallback(name, oldValue, newValue) {
    if (name === 'alias') {
      console.log(`Attribute ${name} changed from ${oldValue} to ${newValue}`);
      this.shadowRoot.querySelector('#text').textContent = newValue;
    } else if (name === 'edit-mode') {

      if (newValue === 'true') {
        // Here I will display the action buttons.
        let actions = this.shadowRoot.querySelector('slot[name="actions"]');
        actions.style.display = "flex";
      } else {
        let actions = this.shadowRoot.querySelector('slot[name="actions"]');
        actions.style.display = "none";
      }
    }
  }

  /**
   * So here I will try to get the text content of the slot.
   * @param {*} event 
   */
  handleSlotChange(event) {
    const slot = event.target;
    const assignedElements = slot.assignedNodes({ flatten: true });

    const elementCount = assignedElements.length;
    if (elementCount > 0) {
      this.shadowRoot.querySelector("#collapse-btn").style.display = "block"
      this.shadowRoot.querySelector("#collapse-panel").style.display = "block"
      this.shadowRoot.querySelector("#mr-ripple").style.display = "none"

      assignedElements.forEach(element => {
        if (element.setSubitem)
          element.setSubitem()
      });
    }
  }

  // Call search event.
  setSubitem() {
    console.log("setSubitem", this)
    this.shadowRoot.querySelector("#text").style.fontSize = ".9rem"
    this.shadowRoot.querySelector("#text").style.fontWeight = "400"
    this.shadowRoot.querySelector("#text").style.fontFamily = "Roboto, sans-serif"
    this.shadowRoot.querySelector("#icon").style.fontSize = "20px"
  }
}

customElements.define('globular-sidebar-menu-item', SideBarMenuItem)


/**
 * Sample empty component
 */
export class SideBarMenu extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
  }

  connectedCallback() {
    this.shadowRoot.innerHTML = `
      <style>
        #container {
          background-color: var(--surface-color);
          color: var(--primary-text-color);
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

    const slot = this.shadowRoot.querySelector("slot");
    slot.addEventListener("slotchange", () => this.handleSlotChange(slot));
  }

  handleSlotChange(slot) {
    const setDragEvents = (item, index) => {
      if (item.tagName === "GLOBULAR-SIDEBAR-MENU-ITEM") {
        item.setAttribute("draggable", true);
        item.classList.add("draggable");
        item.dataset.index = index;

        item.addEventListener("dragstart", (e) => this.handleDragStart(e));
        item.addEventListener("dragover", (e) => this.handleDragOver(e));
        item.addEventListener("drop", (e) => this.handleDrop(e));
        item.addEventListener("dragend", (e) => this.handleDragEnd(e));
        item.addEventListener("dragleave", (e) => this.handleDragLeave(e));

        // Handle nested items recursively
        let subitems = item.querySelectorAll("globular-sidebar-menu-item");
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
    //event.preventDefault();2
    event.stopPropagation();

    if (target.tagName === "GLOBULAR-SIDEBAR-MENU-ITEM") {
      event.dataTransfer.setData("text/plain", target.dataset.index);
      this.draggedItem = target;

      // Optional: Set a custom drag image
      // You can create an image element or clone the item itself
      const dragImage = document.createElement('div');
      dragImage.style.width = target.offsetWidth + 'px';
      dragImage.style.height = target.offsetHeight + 'px';
      dragImage.appendChild(target.cloneNode(true));
      document.body.appendChild(dragImage);

      // Use the created element as the drag image
      event.dataTransfer.setDragImage(dragImage, 0, 0);
    }
  }

  handleDragOver(event) {
    event.preventDefault();
    event.stopPropagation();

    const target = event.target.closest("globular-sidebar-menu-item");
    if (target) {
      // Get the bounding box of the target
      const targetRect = target.getBoundingClientRect();

      // Calculate the mid-point of the target's height
      const midPoint = targetRect.top + targetRect.height / 2;

      // Check whether the cursor is in the top or bottom half
      if (event.clientY < midPoint) {
        // Cursor is in the top section
        target.classList.add("drag-over-top");
        target.classList.remove("drag-over-bottom");
      } else {
        // Cursor is in the bottom section
        target.classList.add("drag-over-bottom");
        target.classList.remove("drag-over-top");
      }
    }
  }

  handleDragLeave(event) {
    const target = event.target.closest("globular-sidebar-menu-item");
    if (target) {
      target.classList.remove("drag-over-top", "drag-over-bottom");
    }
  }

  handleDrop(event) {
    event.preventDefault();
    if (this.draggedItem == null) {
      this.draggedItem = null;
      return;
    }


    const target = event.target.closest("globular-sidebar-menu-item");

    if (target) {


      // Insert the dragged item at the new index
      let parent = target.parentElement; // The parent of slot elements
      if (parent == null) {
        parent = this
      }

      let assignedItems = Array.from(parent.querySelectorAll(":scope > globular-sidebar-menu-item"));
      if (target === this.draggedItem) {
        assignedItems.forEach((item) => item.classList.remove("drag-over-top", "drag-over-bottom"));
        this.draggedItem = null;
        return
      }

      // Get the index of the target item
      const targetIndex = assignedItems.findIndex((item) => item === target);

      // Determine drop position (above or below the target)
      const targetRect = target.getBoundingClientRect();
      const midPoint = targetRect.top + targetRect.height / 2;

      let newIndex;
      if (event.clientY < midPoint) {
        // Drop above the target
        newIndex = targetIndex;
      } else {
        // Drop below the target
        newIndex = targetIndex + 1;
      }

      // Remove dragging item from its current position in the DOM
      this.draggedItem.remove();

      if (parent !== null) {
        if (newIndex >= assignedItems.length) {
          parent.appendChild(this.draggedItem); // Append at the end if it's the last position
        } else {
          const referenceNode = assignedItems[newIndex];
          parent.insertBefore(this.draggedItem, referenceNode);
        }
      }

      // Dispatch a custom event to notify the application of the new order
      const items_change_event = new CustomEvent("items-change-event", {
        detail: {
          menuItem: this.draggedItem,
        }
      });

      // Dispatch the event
      document.dispatchEvent(items_change_event);

      // Remove visual indicators
      assignedItems.forEach((item) => item.classList.remove("drag-over-top", "drag-over-bottom"));
      this.draggedItem = null;
    }
  }

  handleDragEnd(event) {
    const items = this.shadowRoot.querySelectorAll("globular-sidebar-menu-item");
    items.forEach((item) => item.classList.remove("dragging", "drag-over", "drag-over-top", "drag-over-bottom"));
    // Optionally remove the custom drag image
    const dragImage = document.querySelector('.drag-image');
    if (dragImage) {
      dragImage.remove();
    }
  }

}

customElements.define("globular-sidebar-menu", SideBarMenu);
