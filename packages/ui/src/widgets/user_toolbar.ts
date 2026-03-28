import { getUsername, isSa, logout } from "@globular/sdk"
import "@globular/components/fileExplorer/fileExplorer.js"

/**
 * Unified user toolbar web component.
 *
 * Attributes:
 *   visibility      — "sa-only" (default) or "authenticated"
 *   logout-redirect — optional hash route to navigate to after logout (e.g. "#/login")
 */
class UserToolbar extends HTMLElement {
  private shadow!: ShadowRoot
  private root!: HTMLElement

  constructor() {
    super()
    this.shadow = this.attachShadow({ mode: 'open' })
  }

  private get visibilityMode(): string {
    return this.getAttribute('visibility') || 'sa-only'
  }

  private get logoutRedirect(): string | null {
    return this.getAttribute('logout-redirect')
  }

  private shouldShow(): boolean {
    if (this.visibilityMode === 'authenticated') return !!getUsername()
    return isSa()
  }

  connectedCallback() {
    const u = getUsername()
    const show = this.shouldShow()

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
        .btn.icon {
          width: 28px; height: 28px; padding: 0;
          display: inline-flex; align-items: center; justify-content: center;
          border: none;
          border-radius: 4px;
          opacity: .7;
          transition: opacity .2s;
        }
        .btn.icon:hover { opacity: 1; background: rgba(255,255,255,.08); }
        .btn.icon svg {
          width: 18px; height: 18px;
          fill: currentColor;
          pointer-events: none;
        }
      </style>
      <div class="user">
        <div class="avatar">${(u||'?').slice(0,1).toUpperCase()}</div>
        <span class="name">${u ?? ''}</span>
        <button class="btn" id="logoutBtn" title="Sign out">Logout</button>
      </div>
    `
    this.root = this.shadow.querySelector('.user') as HTMLElement

    const btn = this.shadow.getElementById('logoutBtn') as HTMLButtonElement
    btn.onclick = () => {
      const redirect = this.logoutRedirect
      logout()
      if (redirect) {
        // Import navigateTo dynamically to navigate after logout
        // logout() already calls navigateTo('#/login') by default;
        // the redirect attribute lets apps override the destination
        window.location.hash = redirect.replace(/^#/, '')
      }
    }

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
    const show = this.shouldShow()
    ;(this.shadow.querySelector('.name') as HTMLElement).textContent = u ?? ''
    const av = this.shadow.querySelector('.avatar') as HTMLElement
    av.textContent = (u||'?').slice(0,1).toUpperCase()
    ;(this.style as any).display = show ? 'inline-flex' : 'none'
  }

  private openFileExplorer() {
    if (!isSa()) return

    const ExplorerCtor = customElements.get('globular-file-explorer') as (new () => HTMLElement) | undefined
    if (!ExplorerCtor) {
      console.warn("File explorer component is not registered.")
      return
    }
    const explorer = new ExplorerCtor()
    explorer.setAttribute('data-source', 'user-toolbar')

    const handleClose = () => {
      explorer.removeEventListener('dialog-closed', handleClose)
      if (explorer.parentNode) explorer.parentNode.removeChild(explorer)
    }
    explorer.addEventListener('dialog-closed', handleClose as any)

    document.body.appendChild(explorer)
    requestAnimationFrame(() => this.focusFileExplorer(explorer))
  }

  private focusFileExplorer(explorer: HTMLElement) {
    const dialog = explorer.shadowRoot?.querySelector('globular-dialog') as HTMLElement | null
    if (dialog?.focus) {
      dialog.focus()
    } else if ((explorer as any).focus) {
      (explorer as any).focus()
    }
  }
}

customElements.define('user-toolbar', UserToolbar)
