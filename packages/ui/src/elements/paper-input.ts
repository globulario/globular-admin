class PaperInput extends HTMLElement {
  static observedAttributes = ['label', 'value', 'type', 'placeholder', 'disabled', 'readonly', 'maxlength', 'required', 'invalid']

  constructor() {
    super()
    this.attachShadow({ mode: 'open' })
  }

  connectedCallback() { this._render(); this._bindEvents() }
  attributeChangedCallback() { if (this.shadowRoot?.querySelector('input')) this._syncFromAttrs() }

  get value(): string { return (this.shadowRoot?.querySelector('input') as HTMLInputElement)?.value ?? this.getAttribute('value') ?? '' }
  set value(v: string) {
    const inp = this.shadowRoot?.querySelector('input') as HTMLInputElement
    if (inp) inp.value = v
    this.setAttribute('value', v)
  }

  get invalid(): boolean { return this.hasAttribute('invalid') }
  set invalid(v: boolean) { v ? this.setAttribute('invalid', '') : this.removeAttribute('invalid') }

  private _render() {
    const label = this.getAttribute('label') || ''
    const type = this.getAttribute('type') || 'text'
    const val = this.getAttribute('value') || ''
    const ph = this.getAttribute('placeholder') || label
    const disabled = this.hasAttribute('disabled')
    const readonly = this.hasAttribute('readonly')
    this.shadowRoot!.innerHTML = `
      <style>
        :host { display: block; }
        .wrap { display: flex; flex-direction: column; gap: 4px; }
        label { font: var(--md-typescale-body-small, 400 12px/1.33 inherit); color: var(--secondary-text-color, #666); }
        input {
          padding: 8px 12px; border: 1px solid var(--border-strong-color, #ccc);
          border-radius: var(--md-shape-sm, 8px);
          background: var(--md-surface-container-lowest, #fafbfc);
          color: var(--on-surface-color, #1d2025);
          font: var(--md-typescale-body-medium, 400 14px/1.43 inherit);
          outline: none; transition: border-color .12s, box-shadow .12s;
          width: 100%; box-sizing: border-box;
        }
        input:focus { border-color: var(--accent-color, #3b82f6); box-shadow: var(--md-focus-ring, 0 0 0 3px rgba(59,130,246,.28)); }
        :host([invalid]) input { border-color: var(--error-color, #ef4444); }
      </style>
      <div class="wrap">
        ${label ? `<label>${label}</label>` : ''}
        <input type="${type}" value="${val}" placeholder="${ph}" ${disabled ? 'disabled' : ''} ${readonly ? 'readonly' : ''} />
      </div>
    `
  }

  private _syncFromAttrs() {
    const inp = this.shadowRoot?.querySelector('input') as HTMLInputElement
    if (!inp) return
    const v = this.getAttribute('value')
    if (v !== null && inp.value !== v) inp.value = v
  }

  private _bindEvents() {
    const inp = this.shadowRoot?.querySelector('input') as HTMLInputElement
    if (!inp) return
    inp.addEventListener('input', () => {
      this.setAttribute('value', inp.value)
      this.dispatchEvent(new CustomEvent('value-changed', { detail: { value: inp.value }, bubbles: true }))
    })
    inp.addEventListener('change', () => {
      this.dispatchEvent(new CustomEvent('change', { bubbles: true }))
    })
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.dispatchEvent(new CustomEvent('keydown', { detail: e, bubbles: true }))
    })
  }
}

if (!customElements.get('paper-input')) customElements.define('paper-input', PaperInput)
