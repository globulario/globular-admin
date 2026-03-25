class PaperCard extends HTMLElement {
  static observedAttributes = ['heading', 'elevation']

  constructor() {
    super()
    this.attachShadow({ mode: 'open' })
    this.shadowRoot!.innerHTML = `
      <style>
        :host {
          display: block;
          background: var(--md-surface-container-low, var(--surface-color, #fff));
          border-radius: var(--md-shape-md, 12px);
          border: 1px solid var(--border-subtle-color, rgba(0,0,0,.1));
          box-shadow: var(--md-elevation-1, 0 1px 2px rgba(0,0,0,.10));
          overflow: hidden;
        }
        .heading {
          padding: 12px 16px;
          font: var(--md-typescale-title-medium, 500 16px/1.5 inherit);
          color: var(--on-surface-color, #1d2025);
        }
        .heading:empty { display: none; }
        ::slotted(.card-content) { padding: 12px 16px; }
        ::slotted(.card-actions) { padding: 8px 16px; border-top: 1px solid var(--border-subtle-color, rgba(0,0,0,.1)); }
      </style>
      <div class="heading"></div>
      <slot></slot>
    `
  }

  connectedCallback() { this._syncHeading() }
  attributeChangedCallback() { this._syncHeading() }

  get heading(): string { return this.getAttribute('heading') || '' }
  set heading(v: string) { this.setAttribute('heading', v) }

  private _syncHeading() {
    const el = this.shadowRoot?.querySelector('.heading') as HTMLElement
    if (el) el.textContent = this.getAttribute('heading') || ''
  }
}

if (!customElements.get('paper-card')) customElements.define('paper-card', PaperCard)
