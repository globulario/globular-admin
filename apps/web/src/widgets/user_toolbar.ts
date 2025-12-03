// src/widgets/user_toolbar.ts
import { getUsername, isSa, logout } from '../backend/core/session'
import '../components/fileExplorer/fileExplorer.js'

class UserToolbar extends HTMLElement {
  private shadow!: ShadowRoot
  private root!: HTMLElement
  private folderIconUrl = new URL('../assets/icons/folder-flat.svg', import.meta.url).href

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
        .btn.icon {
          width: 34px; height: 34px; padding: 0;
          display: inline-flex; align-items: center; justify-content: center;
          border-radius: 50%;
        }
        .btn.icon img {
          width: 18px; height: 18px;
          filter: invert(1);
        }
      </style>
      <div class="user">
        <button class="btn icon" id="fileExplorerBtn" title="Open File Explorer">
          <img src="${this.folderIconUrl}" alt="File Explorer"/>
        </button>
        <div class="avatar">${(u||'?').slice(0,1).toUpperCase()}</div>
        <span class="name">${u ?? ''}</span>
        <button class="btn" id="logoutBtn" title="Sign out">Logout</button>
      </div>
    `
    this.root = this.shadow.querySelector('.user') as HTMLElement
    const btn = this.shadow.getElementById('logoutBtn') as HTMLButtonElement
    btn.onclick = () => logout()
    const explorerBtn = this.shadow.getElementById('fileExplorerBtn') as HTMLButtonElement
    explorerBtn.onclick = () => this.openFileExplorer()

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
