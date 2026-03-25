class PaperCheckbox extends HTMLElement {
  static observedAttributes = ['checked', 'disabled']

  constructor() {
    super()
    this.attachShadow({ mode: 'open' })
  }

  connectedCallback() { this._render(); this._bind() }
  attributeChangedCallback() { this._syncState() }

  get checked(): boolean { return this.hasAttribute('checked') }
  set checked(v: boolean) {
    v ? this.setAttribute('checked', '') : this.removeAttribute('checked')
    const inp = this.shadowRoot?.querySelector('input') as HTMLInputElement
    if (inp) inp.checked = v
  }

  private _render() {
    this.shadowRoot!.innerHTML = `
      <style>
        :host { display: inline-flex; align-items: center; gap: 8px; cursor: pointer; }
        :host([disabled]) { opacity: .38; pointer-events: none; }
        input[type=checkbox] {
          width: 18px; height: 18px; margin: 0; cursor: pointer;
          accent-color: var(--accent-color, #3b82f6);
        }
      </style>
      <input type="checkbox" ${this.checked ? 'checked' : ''} ${this.hasAttribute('disabled') ? 'disabled' : ''} />
      <slot></slot>
    `
  }

  private _syncState() {
    const inp = this.shadowRoot?.querySelector('input') as HTMLInputElement
    if (inp) {
      inp.checked = this.checked
      inp.disabled = this.hasAttribute('disabled')
    }
  }

  private _bind() {
    this.shadowRoot?.querySelector('input')?.addEventListener('change', (e) => {
      const checked = (e.target as HTMLInputElement).checked
      checked ? this.setAttribute('checked', '') : this.removeAttribute('checked')
      this.dispatchEvent(new CustomEvent('checked-changed', { detail: { value: checked }, bubbles: true }))
      this.dispatchEvent(new CustomEvent('change', { bubbles: true }))
    })
  }
}

if (!customElements.get('paper-checkbox')) customElements.define('paper-checkbox', PaperCheckbox)
