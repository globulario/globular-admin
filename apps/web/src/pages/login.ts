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

    connectedCallback() {
        const appName = this.getAttribute('app-name') ?? 'Globular Admin'
        const logoSrc = this.getAttribute('logo-src') ?? './img/massicot_logo.svg'
        const version = this.getAttribute('version') ?? ''
        const savedBase = getBaseUrl() ?? ''

        this.style.display = 'block';

        this.innerHTML = `
      <div class="wrap auth-page">
        <div class="card auth-card" part="card">
          <div class="brand">
            <div class="brand-title">${appName}</div>
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
    `;

        this.form = this.querySelector('#loginForm') as HTMLFormElement
        this.submitBtn = this.querySelector('#submitBtn') as HTMLButtonElement
        this.errorEl = this.querySelector('#err') as HTMLElement
        this.pwdInput = this.querySelector('#password') as HTMLInputElement
        this.userInput = this.querySelector('#username') as HTMLInputElement
        this.toggleBtn = this.querySelector('#togglePwd') as HTMLButtonElement
        this.addrInput = this.querySelector('#backend') as HTMLInputElement

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
