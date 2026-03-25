class PaperProgress extends HTMLElement {
  static observedAttributes = ['value', 'max', 'indeterminate', 'secondary-progress']

  constructor() {
    super()
    this.attachShadow({ mode: 'open' })
    this.shadowRoot!.innerHTML = `
      <style>
        :host { display: block; width: 100%; height: 4px; background: var(--border-subtle-color, #e0e0e0); border-radius: 2px; overflow: hidden; position: relative; }
        .bar { height: 100%; background: var(--accent-color, #3b82f6); transition: width .2s; border-radius: 2px; position: absolute; left: 0; top: 0; }
        .secondary { height: 100%; background: color-mix(in srgb, var(--accent-color, #3b82f6) 30%, transparent); transition: width .2s; border-radius: 2px; position: absolute; left: 0; top: 0; }
        :host([indeterminate]) .bar {
          width: 50% !important; animation: indeterminate 1.5s infinite ease-in-out;
        }
        @keyframes indeterminate {
          0% { left: -50%; } 100% { left: 100%; }
        }
      </style>
      <div class="secondary"></div>
      <div class="bar"></div>
    `
  }

  connectedCallback() { this._update() }
  attributeChangedCallback() { this._update() }

  get value(): number { return parseFloat(this.getAttribute('value') || '0') }
  set value(v: number) { this.setAttribute('value', String(v)) }

  get max(): number { return parseFloat(this.getAttribute('max') || '100') }
  set max(v: number) { this.setAttribute('max', String(v)) }

  private _update() {
    const bar = this.shadowRoot?.querySelector('.bar') as HTMLElement
    const sec = this.shadowRoot?.querySelector('.secondary') as HTMLElement
    if (!bar) return
    if (!this.hasAttribute('indeterminate')) {
      const pct = this.max > 0 ? (this.value / this.max) * 100 : 0
      bar.style.width = `${Math.min(100, Math.max(0, pct))}%`
    }
    const sp = parseFloat(this.getAttribute('secondary-progress') || '0')
    if (sec && this.max > 0) {
      sec.style.width = `${Math.min(100, Math.max(0, (sp / this.max) * 100))}%`
    }
  }
}

if (!customElements.get('paper-progress')) customElements.define('paper-progress', PaperProgress)
