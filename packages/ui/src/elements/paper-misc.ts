// Miscellaneous Polymer widget replacements:
// paper-slider, paper-toggle-button, paper-spinner, paper-badge,
// paper-tooltip, iron-autogrow-textarea, iron-image

// ── paper-slider ────────────────────────────────────────────────────────────
class PaperSlider extends HTMLElement {
  static observedAttributes = ['value', 'min', 'max', 'step', 'disabled']
  constructor() { super(); this.attachShadow({ mode: 'open' }) }
  connectedCallback() { this._render(); this._bind() }
  attributeChangedCallback() { this._syncState() }

  get value(): number { return parseFloat(this.getAttribute('value') || '0') }
  set value(v: number) { this.setAttribute('value', String(v)); this._syncState() }

  private _render() {
    this.shadowRoot!.innerHTML = `
      <style>
        :host { display: flex; align-items: center; width: 100%; }
        input[type=range] { width: 100%; accent-color: var(--accent-color, #3b82f6); cursor: pointer; }
      </style>
      <input type="range" min="${this.getAttribute('min') || '0'}" max="${this.getAttribute('max') || '100'}"
        step="${this.getAttribute('step') || '1'}" value="${this.value}" ${this.hasAttribute('disabled') ? 'disabled' : ''} />
    `
  }
  private _syncState() {
    const inp = this.shadowRoot?.querySelector('input') as HTMLInputElement
    if (inp) inp.value = String(this.value)
  }
  private _bind() {
    this.shadowRoot?.querySelector('input')?.addEventListener('input', (e) => {
      const v = parseFloat((e.target as HTMLInputElement).value)
      this.setAttribute('value', String(v))
      this.dispatchEvent(new CustomEvent('value-changed', { detail: { value: v }, bubbles: true }))
      this.dispatchEvent(new CustomEvent('immediate-value-changed', { detail: { value: v }, bubbles: true }))
    })
  }
}

// ── paper-toggle-button ─────────────────────────────────────────────────────
class PaperToggleButton extends HTMLElement {
  static observedAttributes = ['checked', 'disabled']
  constructor() { super(); this.attachShadow({ mode: 'open' }) }
  connectedCallback() { this._render(); this._bind() }
  attributeChangedCallback() { this._syncState() }

  get checked(): boolean { return this.hasAttribute('checked') }
  set checked(v: boolean) { v ? this.setAttribute('checked', '') : this.removeAttribute('checked'); this._syncState() }

  private _render() {
    this.shadowRoot!.innerHTML = `
      <style>
        :host { display: inline-flex; align-items: center; gap: 8px; cursor: pointer; }
        :host([disabled]) { opacity: .38; pointer-events: none; }
        .track { width: 36px; height: 20px; border-radius: 10px; background: var(--border-strong-color, #ccc); position: relative; transition: background .2s; }
        .thumb { width: 16px; height: 16px; border-radius: 50%; background: #fff; position: absolute; top: 2px; left: 2px; transition: transform .2s; box-shadow: 0 1px 3px rgba(0,0,0,.3); }
        :host([checked]) .track { background: var(--accent-color, #3b82f6); }
        :host([checked]) .thumb { transform: translateX(16px); }
      </style>
      <div class="track"><div class="thumb"></div></div>
      <slot></slot>
    `
  }
  private _syncState() {
    // Visual state is CSS-driven via :host([checked])
  }
  private _bind() {
    this.shadowRoot?.addEventListener('click', () => {
      if (this.hasAttribute('disabled')) return
      this.checked = !this.checked
      this.dispatchEvent(new CustomEvent('checked-changed', { detail: { value: this.checked }, bubbles: true }))
      this.dispatchEvent(new CustomEvent('change', { bubbles: true }))
    })
  }
}

// ── paper-spinner ───────────────────────────────────────────────────────────
class PaperSpinner extends HTMLElement {
  static observedAttributes = ['active']
  constructor() { super(); this.attachShadow({ mode: 'open' }) }
  connectedCallback() { this._render() }
  attributeChangedCallback() { this._render() }

  get active(): boolean { return this.hasAttribute('active') }
  set active(v: boolean) { v ? this.setAttribute('active', '') : this.removeAttribute('active') }

  private _render() {
    this.shadowRoot!.innerHTML = `
      <style>
        :host { display: inline-block; width: 28px; height: 28px; }
        :host(:not([active])) .spin { display: none; }
        .spin { width: 100%; height: 100%; border: 3px solid var(--border-subtle-color, #e0e0e0);
          border-top-color: var(--accent-color, #3b82f6); border-radius: 50%;
          animation: spin 800ms linear infinite; box-sizing: border-box; }
        @keyframes spin { to { transform: rotate(360deg); } }
      </style>
      <div class="spin"></div>
    `
  }
}

// ── paper-badge ─────────────────────────────────────────────────────────────
class PaperBadge extends HTMLElement {
  static observedAttributes = ['label']
  constructor() { super(); this.attachShadow({ mode: 'open' }) }
  connectedCallback() { this._render() }
  attributeChangedCallback() { this._render() }

  get label(): string { return this.getAttribute('label') || '' }
  set label(v: string) { this.setAttribute('label', v) }

  private _render() {
    this.shadowRoot!.innerHTML = `
      <style>
        :host { display: inline-flex; }
        span { background: var(--error-color, #ef4444); color: #fff; border-radius: 10px;
          padding: 2px 6px; font-size: .65rem; font-weight: 700; min-width: 16px;
          text-align: center; line-height: 1.3; }
      </style>
      <span>${this.label}</span>
    `
  }
}

// ── paper-tooltip ───────────────────────────────────────────────────────────
class PaperTooltip extends HTMLElement {
  connectedCallback() {
    // Transfer content to parent's title attribute for native tooltip
    const target = this.getAttribute('for')
    const parent = target
      ? (this.getRootNode() as Document | ShadowRoot).getElementById(target)
      : this.parentElement
    if (parent && this.textContent) {
      parent.setAttribute('title', this.textContent.trim())
    }
    this.style.display = 'none'
  }
}

// ── iron-autogrow-textarea ──────────────────────────────────────────────────
class IronAutogrowTextarea extends HTMLElement {
  static observedAttributes = ['value', 'placeholder', 'rows', 'max-rows', 'disabled', 'readonly']
  constructor() { super(); this.attachShadow({ mode: 'open' }) }
  connectedCallback() { this._render(); this._bind() }
  attributeChangedCallback() { this._syncState() }

  get value(): string { return (this.shadowRoot?.querySelector('textarea') as HTMLTextAreaElement)?.value ?? '' }
  set value(v: string) {
    const ta = this.shadowRoot?.querySelector('textarea') as HTMLTextAreaElement
    if (ta) { ta.value = v; this._autoGrow(ta) }
  }

  get textarea(): HTMLTextAreaElement | null { return this.shadowRoot?.querySelector('textarea') ?? null }

  private _render() {
    this.shadowRoot!.innerHTML = `
      <style>
        :host { display: block; }
        textarea {
          width: 100%; box-sizing: border-box; resize: none; overflow: hidden;
          padding: 8px 12px; border: 1px solid var(--border-strong-color, #ccc);
          border-radius: var(--md-shape-sm, 8px);
          background: var(--md-surface-container-lowest, #fafbfc);
          color: var(--on-surface-color, #1d2025);
          font: var(--md-typescale-body-medium, 400 14px/1.43 inherit);
          outline: none; transition: border-color .12s;
        }
        textarea:focus { border-color: var(--accent-color, #3b82f6); box-shadow: var(--md-focus-ring); }
      </style>
      <textarea rows="${this.getAttribute('rows') || '1'}"
        placeholder="${this.getAttribute('placeholder') || ''}"
        ${this.hasAttribute('disabled') ? 'disabled' : ''}
        ${this.hasAttribute('readonly') ? 'readonly' : ''}
      >${this.getAttribute('value') || ''}</textarea>
    `
  }
  private _syncState() {
    const ta = this.shadowRoot?.querySelector('textarea') as HTMLTextAreaElement
    if (!ta) return
    const v = this.getAttribute('value')
    if (v !== null && ta.value !== v) ta.value = v
    this._autoGrow(ta)
  }
  private _bind() {
    const ta = this.shadowRoot?.querySelector('textarea') as HTMLTextAreaElement
    if (!ta) return
    const handler = () => { this._autoGrow(ta); this.dispatchEvent(new CustomEvent('value-changed', { detail: { value: ta.value }, bubbles: true })) }
    ta.addEventListener('input', handler)
    requestAnimationFrame(() => this._autoGrow(ta))
  }
  private _autoGrow(ta: HTMLTextAreaElement) {
    ta.style.height = 'auto'
    ta.style.height = ta.scrollHeight + 'px'
  }
}

// ── iron-image ──────────────────────────────────────────────────────────────
class IronImage extends HTMLElement {
  static observedAttributes = ['src', 'sizing', 'preload', 'fade', 'alt']
  constructor() { super(); this.attachShadow({ mode: 'open' }) }
  connectedCallback() { this._render() }
  attributeChangedCallback() { this._render() }

  private _render() {
    const src = this.getAttribute('src') || ''
    const sizing = this.getAttribute('sizing') || ''
    this.shadowRoot!.innerHTML = `
      <style>
        :host { display: block; position: relative; overflow: hidden; }
        img { width: 100%; height: 100%; display: block;
          object-fit: ${sizing === 'cover' ? 'cover' : sizing === 'contain' ? 'contain' : 'fill'};
        }
      </style>
      ${src ? `<img src="${src}" alt="${this.getAttribute('alt') || ''}" />` : ''}
    `
  }
}

if (!customElements.get('paper-slider')) customElements.define('paper-slider', PaperSlider)
if (!customElements.get('paper-toggle-button')) customElements.define('paper-toggle-button', PaperToggleButton)
if (!customElements.get('paper-spinner')) customElements.define('paper-spinner', PaperSpinner)
if (!customElements.get('paper-badge')) customElements.define('paper-badge', PaperBadge)
if (!customElements.get('paper-tooltip')) customElements.define('paper-tooltip', PaperTooltip)
if (!customElements.get('iron-autogrow-textarea')) customElements.define('iron-autogrow-textarea', IronAutogrowTextarea)
if (!customElements.get('iron-image')) customElements.define('iron-image', IronImage)
