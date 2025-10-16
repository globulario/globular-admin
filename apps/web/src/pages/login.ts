// src/pages/login.ts
import { setToken, login } from '../backend/core/auth'
import { hasBaseUrl, getBaseUrl, setBaseUrl } from '../backend/core/endpoints'
import { displayError, displaySuccess } from '../backend/ui/notify' // ← update path if needed

/**
 * <page-login>
 * Attributes (optional):
 *  - app-name="Globular Admin"
 *  - logo-src="./img/massicot_logo.svg"
 *  - version="v0.9.0"
 */
class PageLogin extends HTMLElement {
    private shadow!: ShadowRoot
    private form!: HTMLFormElement
    private submitBtn!: HTMLButtonElement
    private errorEl!: HTMLElement
    private pwdInput!: HTMLInputElement
    private userInput!: HTMLInputElement
    private addrInput!: HTMLInputElement
    private toggleBtn!: HTMLButtonElement

    static get observedAttributes() {
        return ['app-name', 'logo-src', 'version']
    }

    constructor() {
        super()
        this.shadow = this.attachShadow({ mode: 'open' })
    }

    connectedCallback() {
        const appName = this.getAttribute('app-name') ?? 'Globular Admin'
        const logoSrc = this.getAttribute('logo-src') ?? './img/massicot_logo.svg'
        const version = this.getAttribute('version') ?? ''
        const savedBase = getBaseUrl() ?? ''

        this.shadow.innerHTML = `
      <style>
        :host {
          display: block;
          min-height: 100%;
          width: 100%;
          font-family: 'Roboto', sans-serif;
          box-sizing: border-box;
        }
        .wrap {
          min-height: inherit;
          display: grid;
          place-items: center;
          padding: 4vh 16px;
          background: var(--background-color);
          color: var(--on-surface-color);
          min-width: 0;
          /* optional: avoid any child forcing it wider */
          overflow-wrap: anywhere;
        }
        .card {
          width: 100%;
          max-width: 420px;
          background: var(--surface-color);
          color: var(--on-surface-color);
          border-radius: 12px;
          box-shadow: 0 8px 28px rgba(0,0,0,0.12);
          padding: 28px;
        }
        .brand {
          display: flex;
          align-items: center;
          gap: 12px;
          margin-bottom: 12px;
          justify-content: center;
        }
        .brand img {
          height: 56px;
          width: auto;
        }
        h1 {
          margin: 0.25rem 0 1.25rem;
          font-size: 1.35rem;
          text-align: center;
          color: var(--on-surface-color);
        }
        form {
          display: grid;
          gap: 12px;
        }
        .field {
          display: grid;
          gap: 6px;
        }
        label {
          font-size: 0.85rem;
          color: rgba(0,0,0,0.7);
        }
        input {
          padding: 10px 12px;
          border-radius: 8px;
          border: 1px solid rgba(0,0,0,0.18);
          background: var(--surface-color);
          color: var(--on-surface-color);
          outline: none;
        }
        input:focus {
          border-color: var(--primary-color);
          box-shadow: 0 0 0 3px color-mix(in srgb, var(--primary-color) 20%, transparent);
        }
        .pwd-row {
          display: grid;
          grid-template-columns: 1fr auto;
          align-items: center;
          gap: 8px;
        }
        .toggle {
          border: 1px solid rgba(0,0,0,0.18);
          background: transparent;
          color: var(--on-surface-color);
          border-radius: 8px;
          padding: 8px 10px;
          cursor: pointer;
        }
        .submit {
          margin-top: 6px;
          background: var(--primary-color);
          color: var(--on-primary-color);
          border: none;
          border-radius: 8px;
          padding: 10px 14px;
          font-weight: 600;
          cursor: pointer;
        }
        .submit[disabled] {
          opacity: 0.7;
          cursor: default;
        }
        .err {
          min-height: 20px;
          color: var(--error-color);
          font-size: 0.9rem;
          margin-top: 6px;
          text-align: center;
           /* wrap very long words/URLs */
            overflow-wrap: anywhere;      /* modern */
            word-break: break-word;       /* fallback */
            white-space: normal;

            /* clamp to 3 lines with ellipsis */
            display: -webkit-box;
            -webkit-line-clamp: 3;
            -webkit-box-orient: vertical;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        .meta {
          margin-top: 16px;
          font-size: 0.8rem;
          color: rgba(0,0,0,0.55);
          text-align: center;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .meta img {
          height: 64px;
          width: auto;    
          margin-right: 8px;
          display: none;
        }
        .spinner {
          display: inline-block;
          width: 16px;
          height: 16px;
          border: 2px solid rgba(255,255,255,0.5);
          border-top-color: var(--on-primary-color);
          border-radius: 50%;
          margin-left: 8px;
          animation: spin 800ms linear infinite;
          vertical-align: -2px;
        }
        @keyframes spin { to { transform: rotate(360deg); } }

        /* Address bar */
        .addr-field {
          display: grid;
          gap: 6px;
          margin-bottom: 6px;
        }
      </style>

      <div class="wrap">
        <div class="card" part="card">
          <div class="brand">
            <div style="font-weight:700;font-size:1.05rem;">${appName}</div>
          </div>

          <form id="loginForm" novalidate>
            <div class="addr-field">
              <label for="backend">Backend address</label>
              <input id="backend" name="backend" placeholder="https://your-server.domain" value="${savedBase}" required />
            </div>

            <div class="field">
              <label for="username">Username</label>
              <input id="username" name="username" autocomplete="username" required />
            </div>
            <div class="field">
              <label for="password">Password</label>
              <div class="pwd-row">
                <input id="password" name="password" type="password" autocomplete="current-password" required />
                <button type="button" class="toggle" id="togglePwd">Show</button>
              </div>
            </div>
            <button class="submit" id="submitBtn">Sign in</button>
            <div class="err" id="err"></div>
          </form>

          <div class="meta">
            <img src="${logoSrc}" alt="logo" />
            ${version ? `${version} &nbsp;•&nbsp; ` : ''}© ${new Date().getFullYear()} Globular Project
          </div>
        </div>
      </div>
    `

        this.form = this.shadow.querySelector('#loginForm') as HTMLFormElement
        this.submitBtn = this.shadow.querySelector('#submitBtn') as HTMLButtonElement
        this.errorEl = this.shadow.querySelector('#err') as HTMLElement
        this.pwdInput = this.shadow.querySelector('#password') as HTMLInputElement
        this.userInput = this.shadow.querySelector('#username') as HTMLInputElement
        this.toggleBtn = this.shadow.querySelector('#togglePwd') as HTMLButtonElement
        this.addrInput = this.shadow.querySelector('#backend') as HTMLInputElement

        // Autofocus username or backend depending on state
        queueMicrotask(() => {
            if (!hasBaseUrl()) this.addrInput.focus()
            else this.userInput.focus()
        })

        // toggle password visibility
        this.toggleBtn.onclick = () => {
            const showing = this.pwdInput.type === 'text'
            this.pwdInput.type = showing ? 'password' : 'text'
            this.toggleBtn.textContent = showing ? 'Show' : 'Hide'
        }

        // submit handler
        this.form.onsubmit = async (e) => {
            e.preventDefault()
            this.errorEl.textContent = ''

            const backend = this.addrInput.value.trim()
            const username = this.userInput.value.trim()
            const password = this.pwdInput.value

            if (!backend) {
                const msg = 'Please enter the backend address.'
                this.errorEl.textContent = msg
                displayError(msg)
                return
            }
            if (!username || !password) {
                const msg = 'Please enter username and password.'
                this.errorEl.textContent = msg
                displayError(msg)
                return
            }

            try {
                // Save backend URL
                setBaseUrl(backend)
                this.setLoading(true)

                const token = await login(username, password)
                setToken(token)

                try { localStorage.setItem('current_user', username) } catch { }
                window.dispatchEvent(new CustomEvent('auth:changed'))

                // Toast first so the user sees it, then route
                displaySuccess(`Welcome, ${username}!`)

                // Route to dashboard
                history.replaceState(null, '', '#/dashboard')
                window.dispatchEvent(new HashChangeEvent('hashchange'))
            } catch (err: any) {
                const msg = err?.message || 'Login failed'
                this.errorEl.textContent = msg
                displayError(msg)
            } finally {
                this.setLoading(false)
            }
        }
    }

    private setLoading(on: boolean) {
        if (on) {
            this.submitBtn.setAttribute('disabled', 'true')
            this.submitBtn.innerHTML = `Signing in<span class="spinner"></span>`
        } else {
            this.submitBtn.removeAttribute('disabled')
            this.submitBtn.textContent = 'Sign in'
        }
    }
}

customElements.define('page-login', PageLogin)
