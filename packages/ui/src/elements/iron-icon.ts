import { getIconPath } from './icon-map'

class IronIcon extends HTMLElement {
  static observedAttributes = ['icon']

  constructor() {
    super()
    this.attachShadow({ mode: 'open' })
    this.shadowRoot!.innerHTML = `
      <style>
        :host {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 24px;
          height: 24px;
          fill: currentColor;
          flex-shrink: 0;
        }
        svg { width: 100%; height: 100%; }
      </style>
      <svg viewBox="0 0 24 24"><path d=""/></svg>
    `
  }

  get icon(): string { return this.getAttribute('icon') || '' }
  set icon(v: string) { this.setAttribute('icon', v) }

  connectedCallback() { this._render() }
  attributeChangedCallback() { this._render() }

  private _render() {
    const name = this.getAttribute('icon') || ''
    const d = getIconPath(name)
    const path = this.shadowRoot?.querySelector('path')
    if (path) path.setAttribute('d', d)
  }
}

if (!customElements.get('iron-icon')) customElements.define('iron-icon', IronIcon)
