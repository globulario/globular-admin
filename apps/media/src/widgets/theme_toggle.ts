// src/widgets/theme_toggle.ts
import { applyTheme, getStoredTheme, setStoredTheme, resolveTheme, Theme } from '../theme/theme'

class ThemeToggle extends HTMLElement {
  private shadow!: ShadowRoot
  private btn!: HTMLButtonElement

  constructor() {
    super()
    this.shadow = this.attachShadow({ mode: 'open' })
  }

  connectedCallback() {
    this.shadow.innerHTML = `
      <style>
        :host { display: inline-flex; }
        button {
          border: 1px solid rgba(255,255,255,.4);
          background: transparent;
          color: var(--on-primary-color);
          border-radius: 8px;
          padding: 6px 10px;
          cursor: pointer;
          font-weight: 600;
          display: inline-flex;
          align-items: center;
          gap: .5rem;
        }
        button:hover { background: rgba(255,255,255,.12); }
        .icon { width: 16px; height: 16px; display:inline-block; }
      </style>
      <button id="toggle"><span class="icon" id="icon"></span><span id="label"></span></button>
    `

    this.btn = this.shadow.getElementById('toggle') as HTMLButtonElement
    this.btn.onclick = () => {
      const eff = resolveTheme(getStoredTheme())
      const next: Theme = eff === 'dark' ? 'light' : 'dark'
      setStoredTheme(next)
      applyTheme(next)
      this.render()
    }

    this.render()
    window.addEventListener('theme:changed', this._onChanged)
  }

  disconnectedCallback() {
    window.removeEventListener('theme:changed', this._onChanged)
  }

  private _onChanged = () => this.render()

  private render() {
    const eff = resolveTheme(getStoredTheme())
    const icon = this.shadow.getElementById('icon')!
    const label = this.shadow.getElementById('label')!
    icon.textContent = eff === 'dark' ? '🌙' : '☀️'
    label.textContent = eff === 'dark' ? 'Dark' : 'Light'
  }
}

customElements.define('theme-toggle', ThemeToggle)
