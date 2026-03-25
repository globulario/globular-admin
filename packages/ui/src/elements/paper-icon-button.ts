import { getIconPath } from './icon-map'

class PaperIconButton extends HTMLElement {
  static observedAttributes = ['icon', 'disabled', 'title']

  constructor() {
    super()
    this.attachShadow({ mode: 'open' })
  }

  get icon(): string { return this.getAttribute('icon') || '' }
  set icon(v: string) { this.setAttribute('icon', v) }

  connectedCallback() { this._render() }
  attributeChangedCallback() { this._render() }

  private _render() {
    const icon = this.getAttribute('icon') || ''
    const d = getIconPath(icon)
    const disabled = this.hasAttribute('disabled')
    this.shadowRoot!.innerHTML = `
      <style>
        :host {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          vertical-align: middle;
          position: relative;
          width: 40px;
          height: 40px;
          box-sizing: border-box;
          flex-shrink: 0;
        }
        button {
          border: none;
          background: transparent;
          cursor: pointer;
          padding: 0;
          margin: 0;
          border-radius: 50%;
          color: inherit;
          display: flex;
          align-items: center;
          justify-content: center;
          width: 100%;
          height: 100%;
          transition: background .15s;
        }
        button:hover:not(:disabled) { background: var(--md-state-hover, rgba(0,0,0,.08)); }
        button:active:not(:disabled) { background: var(--md-state-pressed, rgba(0,0,0,.12)); }
        button:disabled { opacity: .38; cursor: default; }
        svg { width: 24px; height: 24px; fill: currentColor; pointer-events: none; flex-shrink: 0; }
      </style>
      <button ${disabled ? 'disabled' : ''} title="${this.getAttribute('title') || ''}">
        ${d ? `<svg viewBox="0 0 24 24"><path d="${d}"/></svg>` : ''}
      </button>
    `
    this.shadowRoot!.querySelector('button')?.addEventListener('click', (e) => {
      if (disabled) { e.stopPropagation(); return }
    })
  }
}

if (!customElements.get('paper-icon-button')) customElements.define('paper-icon-button', PaperIconButton)
