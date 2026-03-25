// paper-radio-group + paper-radio-button replacements

class PaperRadioButton extends HTMLElement {
  static observedAttributes = ['name', 'checked', 'disabled']

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

  get name(): string { return this.getAttribute('name') || '' }
  set name(v: string) { this.setAttribute('name', v) }

  private _render() {
    this.shadowRoot!.innerHTML = `
      <style>
        :host { display: inline-flex; align-items: center; gap: 8px; cursor: pointer; }
        :host([disabled]) { opacity: .38; pointer-events: none; }
        input[type=radio] { width: 18px; height: 18px; margin: 0; cursor: pointer; accent-color: var(--accent-color, #3b82f6); }
      </style>
      <input type="radio" name="${this.name}" ${this.checked ? 'checked' : ''} ${this.hasAttribute('disabled') ? 'disabled' : ''} />
      <slot></slot>
    `
  }

  private _syncState() {
    const inp = this.shadowRoot?.querySelector('input') as HTMLInputElement
    if (inp) { inp.checked = this.checked; inp.name = this.name }
  }

  private _bind() {
    this.shadowRoot?.querySelector('input')?.addEventListener('change', (e) => {
      const checked = (e.target as HTMLInputElement).checked
      if (checked) {
        this.setAttribute('checked', '')
        this.dispatchEvent(new CustomEvent('change', { bubbles: true, composed: true }))
      }
    })
  }
}

class PaperRadioGroup extends HTMLElement {
  static observedAttributes = ['selected']

  connectedCallback() {
    this.style.display = 'flex'
    this.style.gap = '12px'
    this.style.flexWrap = 'wrap'
    this._syncSelected()
    this.addEventListener('change', this._onChildChange as EventListener)
  }

  disconnectedCallback() {
    this.removeEventListener('change', this._onChildChange as EventListener)
  }

  attributeChangedCallback() { this._syncSelected() }

  get selected(): string { return this.getAttribute('selected') || '' }
  set selected(v: string) { this.setAttribute('selected', v); this._syncSelected() }

  private _onChildChange = (e: Event) => {
    const target = e.target as PaperRadioButton
    if (target.tagName === 'PAPER-RADIO-BUTTON' && target.checked) {
      const name = target.name || target.textContent?.trim() || ''
      this.setAttribute('selected', name)
      // Uncheck siblings
      this.querySelectorAll('paper-radio-button').forEach(rb => {
        if (rb !== target) (rb as PaperRadioButton).checked = false
      })
      this.dispatchEvent(new CustomEvent('selected-changed', { detail: { value: name }, bubbles: true }))
    }
  }

  private _syncSelected() {
    const sel = this.selected
    if (!sel) return
    this.querySelectorAll('paper-radio-button').forEach(rb => {
      const btn = rb as PaperRadioButton
      const name = btn.name || btn.textContent?.trim() || ''
      btn.checked = name === sel
    })
  }
}

if (!customElements.get('paper-radio-button')) customElements.define('paper-radio-button', PaperRadioButton)
if (!customElements.get('paper-radio-group')) customElements.define('paper-radio-group', PaperRadioGroup)
