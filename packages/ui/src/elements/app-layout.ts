// Lightweight drop-in replacements for @polymer/app-layout elements.
// These replicate the layout structure and drawer behavior without Polymer.

class AppDrawerLayout extends HTMLElement {
  constructor() {
    super()
    this.attachShadow({ mode: 'open' })
    this.shadowRoot!.innerHTML = `
      <style>
        :host { display: flex; height: 100%; width: 100%; overflow: hidden; }
        ::slotted(app-drawer) { flex-shrink: 0; }
        .main { flex: 1; min-width: 0; display: flex; flex-direction: column; overflow: hidden; }
      </style>
      <slot name="drawer"></slot>
      <div class="main"><slot></slot></div>
    `
    this._checkNarrow = this._checkNarrow.bind(this)
  }

  connectedCallback() {
    this._mq = window.matchMedia('(max-width: 768px)')
    this._mq.addEventListener('change', this._checkNarrow)
    this._checkNarrow()
  }

  disconnectedCallback() {
    this._mq?.removeEventListener('change', this._checkNarrow)
  }

  private _mq: MediaQueryList | null = null

  private _checkNarrow() {
    const narrow = this._mq?.matches ?? false
    this.toggleAttribute('narrow', narrow)
    // Close drawer when switching to narrow
    const drawer = this.querySelector('app-drawer') as any
    if (drawer && narrow && !drawer.persistent) {
      drawer.opened = false
    }
  }
}

class AppDrawer extends HTMLElement {
  static observedAttributes = ['opened', 'persistent', 'align']

  constructor() {
    super()
    this.attachShadow({ mode: 'open' })
    this.shadowRoot!.innerHTML = `
      <style>
        :host {
          display: block; width: var(--app-drawer-width, 256px);
          height: 100%; overflow-y: auto; overflow-x: hidden;
          background: var(--surface-color, #fff);
          border-right: 1px solid var(--border-subtle-color, rgba(0,0,0,.1));
          transition: transform .25s ease, width .25s ease;
          z-index: 10;
        }
        :host-context(app-drawer-layout[narrow]) {
          position: fixed; top: 0; left: 0; bottom: 0;
          transform: translateX(-100%);
          box-shadow: none;
        }
        :host-context(app-drawer-layout[narrow]):host([opened]) {
          transform: translateX(0);
          box-shadow: 4px 0 24px rgba(0,0,0,.2);
        }
        .scrim {
          display: none; position: fixed; top: 0; left: 0; right: 0; bottom: 0;
          background: rgba(0,0,0,.4); z-index: -1;
        }
        :host-context(app-drawer-layout[narrow]):host([opened]) .scrim { display: block; }
      </style>
      <div class="scrim"></div>
      <slot></slot>
    `
    this.shadowRoot!.querySelector('.scrim')?.addEventListener('click', () => {
      this.opened = false
    })
  }

  get opened(): boolean { return this.hasAttribute('opened') }
  set opened(v: boolean) {
    v ? this.setAttribute('opened', '') : this.removeAttribute('opened')
    this.dispatchEvent(new CustomEvent('opened-changed', { detail: { value: v }, bubbles: true }))
  }

  get persistent(): boolean { return this.hasAttribute('persistent') }
  set persistent(v: boolean) { v ? this.setAttribute('persistent', '') : this.removeAttribute('persistent') }

  toggle() { this.opened = !this.opened }
  open() { this.opened = true }
  close() { this.opened = false }
}

class AppHeaderLayout extends HTMLElement {
  constructor() {
    super()
    this.attachShadow({ mode: 'open' })
    this.shadowRoot!.innerHTML = `
      <style>
        :host { display: flex; flex-direction: column; height: 100%; overflow: hidden; }
        ::slotted(app-header) { flex-shrink: 0; }
        .content { flex: 1; min-height: 0; overflow: hidden; }
        /* Override fixed height on slotted app-content — flex handles sizing */
        ::slotted([slot="app-content"]) {
          height: 100% !important;
          max-height: 100% !important;
        }
      </style>
      <slot name="header"></slot>
      <div class="content"><slot></slot></div>
    `
  }
}

class AppHeader extends HTMLElement {
  constructor() {
    super()
    this.attachShadow({ mode: 'open' })
    this.shadowRoot!.innerHTML = `
      <style>
        :host {
          display: block;
          /* Override legacy Polymer CSS that manually offsets for the drawer.
             In our flex layout, the header is already inside the main area
             (next to the drawer), so no offset is needed. */
          width: 100% !important;
          margin-left: 0 !important;
        }
      </style>
      <slot></slot>
    `
  }
}

class AppToolbar extends HTMLElement {
  constructor() {
    super()
    this.attachShadow({ mode: 'open' })
    this.shadowRoot!.innerHTML = `
      <style>
        :host {
          display: flex; align-items: center; padding: 0 8px;
          height: var(--app-toolbar-height, 56px);
          font-size: 20px;
        }
      </style>
      <slot></slot>
    `
  }
}

// app-scroll-effects is just a behavior, register as empty element
class AppScrollEffects extends HTMLElement {}

if (!customElements.get('app-drawer-layout')) customElements.define('app-drawer-layout', AppDrawerLayout)
if (!customElements.get('app-drawer')) customElements.define('app-drawer', AppDrawer)
if (!customElements.get('app-header-layout')) customElements.define('app-header-layout', AppHeaderLayout)
if (!customElements.get('app-header')) customElements.define('app-header', AppHeader)
if (!customElements.get('app-toolbar')) customElements.define('app-toolbar', AppToolbar)
if (!customElements.get('app-scroll-effects')) customElements.define('app-scroll-effects', AppScrollEffects)
