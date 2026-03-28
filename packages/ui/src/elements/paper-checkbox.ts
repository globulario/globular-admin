class PaperCheckbox extends HTMLElement {
  static observedAttributes = ['checked', 'disabled']

  constructor() {
    super()
    this.attachShadow({ mode: 'open' })
  }

  connectedCallback() { this._render(); this._bind() }
  attributeChangedCallback() { this._syncState() }

  get name(): string { return this.getAttribute('name') || '' }
  set name(v: string) { this.setAttribute('name', v) }

  get checked(): boolean { return this.hasAttribute('checked') }
  set checked(v: boolean) {
    if (v === this.checked) return
    v ? this.setAttribute('checked', '') : this.removeAttribute('checked')
    const inp = this.shadowRoot?.querySelector('input') as HTMLInputElement
    if (inp) inp.checked = v
  }

  private _render() {
    this.shadowRoot!.innerHTML = `
      <style>
        :host {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          cursor: pointer;
        }
        :host([disabled]) { opacity: .38; pointer-events: none; }
        input[type=checkbox] {
          width: 18px; height: 18px; margin: 0; cursor: pointer;
          accent-color: var(--paper-checkbox-checked-color, var(--accent-color, #3b82f6));
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
    const inp = this.shadowRoot?.querySelector('input') as HTMLInputElement
    if (!inp) return

    // Listen on the inner input's change event (fires after checked state updates).
    inp.addEventListener('change', () => {
      const isChecked = inp.checked
      isChecked ? this.setAttribute('checked', '') : this.removeAttribute('checked')
      this.dispatchEvent(new CustomEvent('checked-changed', { detail: { value: isChecked }, bubbles: true, composed: true }))
      this.dispatchEvent(new Event('change', { bubbles: true, composed: true }))
    })

    // Also handle clicks on the host element itself (not just the input).
    // This ensures clicking anywhere on the paper-checkbox toggles it.
    this.addEventListener('click', (e) => {
      // If the click was on the inner input, it already toggled — don't double-toggle.
      if (e.composedPath()[0] === inp) return
      e.preventDefault()
      inp.checked = !inp.checked
      inp.dispatchEvent(new Event('change', { bubbles: true }))
    })
  }
}

if (!customElements.get('paper-checkbox')) customElements.define('paper-checkbox', PaperCheckbox)
