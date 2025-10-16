// src/widgets/user_toolbar.ts
import { getUsername, isSa, logout } from '../backend/core/session'

class UserToolbar extends HTMLElement {
  private shadow!: ShadowRoot
  private root!: HTMLElement

  constructor() {
    super()
    this.shadow = this.attachShadow({ mode: 'open' })
  }

  connectedCallback() {
    const u = getUsername()
    const show = isSa()

    this.shadow.innerHTML = `
      <style>
        :host { display: ${show ? 'inline-flex' : 'none'}; }
        .user { display:inline-flex; align-items:center; gap:.5rem; }
        .avatar {
          width:28px; height:28px; border-radius:50%;
          background: var(--on-primary-color); color: var(--primary-color);
          display:grid; place-items:center; font-weight:700; font-size:.9rem;
        }
        .name { font-weight:600; color: var(--on-primary-color); }
        .btn {
          border: 1px solid rgba(255,255,255,.4);
          background: transparent; color: var(--on-primary-color);
          border-radius: 8px; padding: 6px 10px; cursor: pointer; font-weight:600;
        }
        .btn:hover { background: rgba(255,255,255,.12); }
      </style>
      <div class="user">
        <div class="avatar">${(u||'?').slice(0,1).toUpperCase()}</div>
        <span class="name">${u ?? ''}</span>
        <button class="btn" id="logoutBtn" title="Sign out">Logout</button>
      </div>
    `
    this.root = this.shadow.querySelector('.user') as HTMLElement
    const btn = this.shadow.getElementById('logoutBtn') as HTMLButtonElement
    btn.onclick = () => logout()

    // react to auth changes
    this._onAuth = () => this.refresh()
    window.addEventListener('auth:changed', this._onAuth)
    window.addEventListener('storage', this._onAuth)
  }

  disconnectedCallback() {
    window.removeEventListener('auth:changed', this._onAuth)
    window.removeEventListener('storage', this._onAuth)
  }

  private _onAuth = () => {}
  private refresh() {
    const u = getUsername()
    const show = isSa()
    ;(this.shadow.querySelector('.name') as HTMLElement).textContent = u ?? ''
    const av = this.shadow.querySelector('.avatar') as HTMLElement
    av.textContent = (u||'?').slice(0,1).toUpperCase()
    ;(this.style as any).display = show ? 'inline-flex' : 'none'
  }
}

customElements.define('user-toolbar', UserToolbar)
