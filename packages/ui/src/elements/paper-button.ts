class PaperButton extends HTMLElement {
  static observedAttributes = ['disabled', 'raised']

  constructor() {
    super()
    this.attachShadow({ mode: 'open' })
  }

  connectedCallback() { this._render() }
  attributeChangedCallback() { this._render() }

  private _render() {
    const raised = this.hasAttribute('raised')
    const disabled = this.hasAttribute('disabled')
    this.shadowRoot!.innerHTML = `
      <style>
        :host { display: inline-flex; }
        button {
          border: none; cursor: pointer; padding: 6px 16px;
          border-radius: var(--md-shape-full, 9999px);
          font: var(--md-typescale-label-large, 500 14px/1.43 inherit);
          display: inline-flex; align-items: center; justify-content: center;
          gap: 6px; white-space: nowrap; color: inherit;
          transition: background .12s, box-shadow .12s;
          background: ${raised ? 'var(--accent-color, #3b82f6)' : 'transparent'};
          color: ${raised ? '#fff' : 'inherit'};
        }
        button:hover:not(:disabled) {
          background: ${raised
            ? 'color-mix(in srgb, var(--accent-color, #3b82f6) 88%, #000)'
            : 'var(--md-state-hover, rgba(0,0,0,.08))'};
        }
        button:disabled { opacity: .38; cursor: default; }
        ::slotted(iron-icon) { width: 18px; height: 18px; }
      </style>
      <button ${disabled ? 'disabled' : ''}><slot></slot></button>
    `
  }
}

if (!customElements.get('paper-button')) customElements.define('paper-button', PaperButton)
