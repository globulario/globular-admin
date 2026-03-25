class PaperTab extends HTMLElement {
  constructor() {
    super()
    this.attachShadow({ mode: 'open' })
    this.shadowRoot!.innerHTML = `
      <style>
        :host {
          display: inline-flex; align-items: center; justify-content: center;
          padding: 8px 16px; cursor: pointer; white-space: nowrap;
          font: var(--md-typescale-label-large, 500 14px/1.43 inherit);
          color: var(--secondary-text-color, #666);
          border-bottom: 2px solid transparent;
          transition: color .15s, border-color .15s;
          user-select: none;
        }
        :host(:hover) { color: var(--on-surface-color, #1d2025); }
        :host(.iron-selected), :host([active]) {
          color: var(--accent-color, #3b82f6);
          border-bottom-color: var(--accent-color, #3b82f6);
        }
      </style>
      <slot></slot>
    `
  }
}

class PaperTabs extends HTMLElement {
  static observedAttributes = ['selected']

  constructor() {
    super()
    this.attachShadow({ mode: 'open' })
    this.shadowRoot!.innerHTML = `
      <style>
        :host {
          display: flex; border-bottom: 1px solid var(--border-subtle-color, #e0e0e0);
          overflow-x: auto; scrollbar-width: none;
        }
        :host::-webkit-scrollbar { display: none; }
      </style>
      <slot></slot>
    `
  }

  connectedCallback() {
    this._syncSelected()
    this.addEventListener('click', this._onClick as EventListener)
  }

  disconnectedCallback() {
    this.removeEventListener('click', this._onClick as EventListener)
  }

  attributeChangedCallback() { this._syncSelected() }

  get selected(): number { return parseInt(this.getAttribute('selected') || '0', 10) }
  set selected(v: number) { this.setAttribute('selected', String(v)) }

  private _onClick = (e: Event) => {
    const tabs = Array.from(this.querySelectorAll('paper-tab'))
    const target = (e.target as HTMLElement).closest('paper-tab')
    if (!target) return
    const idx = tabs.indexOf(target)
    if (idx >= 0 && idx !== this.selected) {
      this.selected = idx
      this.dispatchEvent(new CustomEvent('selected-changed', { detail: { value: idx }, bubbles: true }))
      this.dispatchEvent(new CustomEvent('iron-select', { detail: { item: target }, bubbles: true }))
    }
  }

  private _syncSelected() {
    const tabs = Array.from(this.querySelectorAll('paper-tab'))
    tabs.forEach((tab, i) => {
      tab.classList.toggle('iron-selected', i === this.selected)
      i === this.selected ? tab.setAttribute('active', '') : tab.removeAttribute('active')
    })
  }
}

if (!customElements.get('paper-tab')) customElements.define('paper-tab', PaperTab)
if (!customElements.get('paper-tabs')) customElements.define('paper-tabs', PaperTabs)
