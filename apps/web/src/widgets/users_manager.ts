// src/widgets/users_manager.ts
import { listAccounts, createAccount, updateAccount, deleteAccount } from '../backend/rbac/accounts'
import { displayError, displayQuestion, displaySuccess } from '../backend/ui/notify' // <-- update path if needed
import { getBase64FromImageUrl } from '../components/utility.js'   
import '@polymer/iron-icons/iron-icons.js'
import '@polymer/paper-icon-button/paper-icon-button.js'
import '@polymer/iron-collapse/iron-collapse.js'
import '../components/table'     // <globular-table>
import '../components/markdown'  // <globular-markdown> (optional)

type Account = {
  id: string
  name: string
  email?: string
  roles?: string[]
  domain?: string
  profilePicture?: string
  firstName?: string
  lastName?: string
}

type TableRow = {
  _index?: number
  _visible?: boolean

  // headers you requested
  displayAccountId?: string // computed from global fn
  firstName: string
  lastName: string
  userEmail: string

  // helpers for displayAccountId
  id?: string
  profilePicture?: string
}

/* ============================================================
   Global helper used by <globular-table> for the Id column.
   The table calls window[<fieldName>](row) when a property
   is missing and a same-named global function exists.
   ============================================================ */
declare global {
  interface Window { displayAccountId?: (row: TableRow) => string }
}
window.displayAccountId = (row: TableRow) => {
  const src = row.profilePicture || 'https://www.w3schools.com/howto/img_avatar.png'
  const id = row.id || '(unknown)'
  return `
    <div class="user-selector" style="display:flex; align-items:center;">
      <img style="height:32px; width:32px; border-radius:50%; object-fit:cover;" src="${src}" alt="Avatar"/>
      <span style="margin-left:.75rem; text-decoration: underline;">${id}</span>
    </div>
  `
}

/* ============================================================
   Inline editor (no dialog)
   ============================================================ */

class UsersInlineEditor extends HTMLElement {
  private shadow!: ShadowRoot
  private account: Account | null = null
  private isReady = false

  // UI refs
  private avatarImg?: HTMLImageElement
  private avatarPicker?: HTMLElement // <avatar-changer>
  private usernameInput?: HTMLInputElement
  private firstNameInput?: HTMLInputElement
  private lastNameInput?: HTMLInputElement
  private emailInput?: HTMLInputElement
  private domainInput?: HTMLInputElement
  private passwordInput?: HTMLInputElement
  private confirmPasswordInput?: HTMLInputElement
  private saveBtn?: HTMLButtonElement
  private cancelBtn?: HTMLButtonElement
  private deleteBtn?: HTMLButtonElement

  constructor() {
    super()
    this.shadow = this.attachShadow({ mode: 'open' })
  }

  connectedCallback() {
    this.shadow.innerHTML = `
      <style>
        :host { display:block; }
        .card {
          background: var(--surface-color);
          color: var(--on-surface-color);
          border-radius: 12px;
          padding: 12px 14px;
          box-shadow: 0 0 0 1px var(--divider-color, color-mix(in srgb, var(--on-surface-color) 12%, transparent));
          margin-top: 12px;
        }
        .row { display:flex; gap:10px; align-items:center; margin: 8px 0; }
        label { width: 140px; font: 500 14px/25px Roboto,sans-serif; }
        input[type="text"], input[type="email"], input[type="password"] {
          flex: 1; border: none; border-bottom: 1px solid var(--divider-color);
          background: var(--surface-color); color: var(--on-surface-color); padding: 6px 4px;
        }
        input:focus { outline: none; border-bottom: 1px solid var(--primary-color); }
        .actions { display:flex; gap:.5rem; margin-top: 12px; }
        .spacer { flex: 1; }
        .avatar { display:flex; align-items:center; gap:.75rem; position: relative; }
        .avatar img { width: 48px; height:48px; border-radius: 6px; object-fit: cover; border: 1px solid var(--divider-color); cursor: pointer; }
        .hint { font-size: .85rem; color: color-mix(in srgb, var(--on-surface-color) 55%, transparent); }
        .muted { color: color-mix(in srgb, var(--on-surface-color) 55%, transparent); }
        .hidden { display:none; }
        .inline-btn { padding: 6px 10px; border: 1px solid var(--divider-color); background: transparent; color: var(--on-surface-color); border-radius: 8px; cursor: pointer; }
        .inline-btn:hover { border-color: var(--primary-color); }
      </style>

      <div class="card">
        <!-- Avatar -->
        <div class="row avatar">
          <label>Avatar</label>
          <img id="avatar" src="https://www.w3schools.com/howto/img_avatar.png" alt="Avatar" title="Click to change"/>
          <avatar-changer id="avatar-changer" class="hidden" style="position:absolute; top:56px; left:140px; z-index:2;"></avatar-changer>
          <button id="avatar-url-btn" class="inline-btn">Set URL…</button>
        </div>

        <!-- Basics -->
        <div class="row">
          <label>Username</label>
          <input id="username" type="text" required minlength="3" />
        </div>

        <div class="row">
          <label>First name</label>
          <input id="firstName" type="text" />
        </div>

        <div class="row">
          <label>Last name</label>
          <input id="lastName" type="text" />
        </div>

        <div class="row">
          <label>Email</label>
          <input id="email" type="email" required />
        </div>

        <div class="row">
          <label>Domain</label>
          <input id="domain" type="text" />
        </div>

        <!-- Passwords -->
        <div class="row" id="password-row">
          <label>Password</label>
          <input id="password" type="password" />
        </div>

        <div class="row" id="confirm-password-row">
          <label>Confirm</label>
          <input id="confirmPassword" type="password" />
        </div>

        <div class="row">
          <label></label>
          <div class="hint">For existing users, click the masked password to change it.</div>
        </div>

        <!-- Actions -->
        <div class="actions">
          <button id="delete" class="inline-btn">Delete</button>
          <span class="spacer"></span>
          <button id="save" class="inline-btn">Save</button>
          <button id="cancel" class="inline-btn">Cancel</button>
        </div>
      </div>
    `

    // Bind
    this.avatarImg = this.shadow.getElementById('avatar') as HTMLImageElement
    this.avatarPicker = this.shadow.getElementById('avatar-changer') as HTMLElement

    const avatarUrlBtn = this.shadow.getElementById('avatar-url-btn') as HTMLButtonElement

    this.usernameInput = this.shadow.getElementById('username') as HTMLInputElement
    this.firstNameInput = this.shadow.getElementById('firstName') as HTMLInputElement
    this.lastNameInput = this.shadow.getElementById('lastName') as HTMLInputElement
    this.emailInput = this.shadow.getElementById('email') as HTMLInputElement
    this.domainInput = this.shadow.getElementById('domain') as HTMLInputElement
    this.passwordInput = this.shadow.getElementById('password') as HTMLInputElement
    this.confirmPasswordInput = this.shadow.getElementById('confirmPassword') as HTMLInputElement

    const passwordRow = this.shadow.getElementById('password-row') as HTMLDivElement
    const confirmPasswordRow = this.shadow.getElementById('confirm-password-row') as HTMLDivElement

    this.saveBtn = this.shadow.getElementById('save') as HTMLButtonElement
    this.cancelBtn = this.shadow.getElementById('cancel') as HTMLButtonElement
    this.deleteBtn = this.shadow.getElementById('delete') as HTMLButtonElement

    // Ready
    this.isReady = true

    // Apply pre-set account if any
    if (this.account) this._applyAccount(this.account)

    // --- Avatar: show picker on image click
    this.avatarImg.addEventListener('click', () => {
      if (!this.avatarPicker) return
      this.avatarPicker.classList.toggle('hidden')
    })

    // Avatar URL shortcut
    avatarUrlBtn.onclick = () => {
      const url = prompt('Avatar image URL', this.avatarImg?.src || '')
      if (!url || !this.avatarImg) return
      this.avatarImg.src = url
    }

    // Listen to avatar-changer events (base64 the selected image)
    this.avatarPicker?.addEventListener('image-changed', async (e: any) => {
      try {
        const imageUrl = decodeURIComponent(e.detail.src)
        const base64 = await getBase64FromImageUrl(imageUrl)
        if (this.avatarImg) this.avatarImg.src = base64
      } catch (err: any) {
        console.error(err)
        displayError('Failed to set avatar image.')
      } finally {
        this.avatarPicker?.classList.add('hidden')
      }
    })
    this.avatarPicker?.addEventListener('cancel', () => {
      this.avatarPicker?.classList.add('hidden')
    })

    // Cancel
    this.cancelBtn.onclick = () => {
      this.dispatchEvent(new CustomEvent('edit-cancelled', { bubbles: true }))
    }

    // Delete with confirmation
    this.deleteBtn.onclick = async () => {
      if (!this.account?.id) return
      const toast = displayQuestion(
        `<span>Delete account <b>${this.account.name}</b>?</span>
         <div style="display:flex; gap:.5rem; justify-content:center; margin-top:1rem;">
           <paper-button id="yes-btn">Yes</paper-button>
           <paper-button id="no-btn">No</paper-button>
         </div>`
      )
      const noBtn = toast.toastElement?.querySelector('#no-btn') as HTMLElement | null
      if (noBtn) {
        noBtn.onclick = () => toast.toastElement?.remove()
      }
      const yesBtn = toast.toastElement?.querySelector('#yes-btn') as HTMLElement | null
      if (yesBtn) {
        yesBtn.onclick = async () => {
          toast.toastElement?.remove()
          try {
            await deleteAccount(this.account!.id)
            displaySuccess('Account deleted.')
            this.dispatchEvent(new CustomEvent('account-deleted', { bubbles: true, detail: this.account }))
          } catch (e: any) {
            console.error(e)
            displayError(e?.message || 'Failed to delete account')
          }
        }
      }
    }

    // Save (create or update) with validation + confirmations
    this.saveBtn.onclick = async () => {
      // basic validation
      if (!this.usernameInput?.value.trim()) {
        displayError('Username is required.')
        this.usernameInput?.focus()
        return
      }
      if (!this.emailInput?.value.trim()) {
        displayError('Email is required.')
        this.emailInput?.focus()
        return
      }

      // Build payload
      const base: Account & { password?: string } = {
        id: this.account?.id || this.usernameInput.value.trim(),
        name: this.usernameInput.value.trim(),
        email: this.emailInput.value.trim(),
        domain: this.domainInput?.value.trim() || undefined,
        profilePicture: this.avatarImg?.src || undefined,
        firstName: this.firstNameInput?.value.trim() || undefined,
        lastName: this.lastNameInput?.value.trim() || undefined,
      }

      const isNew = !this.account?.id

      // Password rules
      if (isNew) {
        const pwd = this.passwordInput?.value || ''
        const cpwd = this.confirmPasswordInput?.value || ''
        if (!pwd) {
          displayError('Password is required for new accounts.')
          this.passwordInput?.focus()
          return
        }
        if (pwd !== cpwd) {
          displayError('Password and Confirm Password do not match.')
          this.confirmPasswordInput?.focus()
          return
        }
        base.password = pwd
      } else {
        // existing user: if user cleared the mask and typed something, validate + include
        const pwd = (this.passwordInput?.disabled ? '' : (this.passwordInput?.value || ''))
        const cpwd = (this.passwordInput?.disabled ? '' : (this.confirmPasswordInput?.value || ''))
        if (pwd || cpwd) {
          if (pwd !== cpwd) {
            displayError('Password and Confirm Password do not match.')
            this.confirmPasswordInput?.focus()
            return
          }
          base.password = pwd
        }
      }

      const confirmText = isNew
        ? `Create account <b>${base.name}</b>?`
        : `Update account <b>${base.name}</b>?`

      const toast = displayQuestion(
        `<span>${confirmText}</span>
         <div style="display:flex; gap:.5rem; justify-content:center; margin-top:1rem;">
           <paper-button id="yes-btn">Yes</paper-button>
           <paper-button id="no-btn">No</paper-button>
         </div>`
      )
      if (toast.toastElement) {
        const noBtn = toast.toastElement.querySelector('#no-btn') as HTMLElement | null
        if (noBtn) {
          noBtn.onclick = () => toast.toastElement?.remove()
        }
        const yesBtn = toast.toastElement.querySelector('#yes-btn') as HTMLElement | null
        if (yesBtn) {
          yesBtn.onclick = async () => {
            toast.toastElement?.remove()
            try {
              if (isNew) {
                await createAccount({
                  name: base.name,
                  email: base.email,
                  domain: base.domain,
                  profilePicture: base.profilePicture,
                  firstName: base.firstName,
                  lastName: base.lastName,
                  password: base.password, // backend can ignore if unsupported
                })
                displaySuccess('Account created.')
                this.dispatchEvent(new CustomEvent('account-created', { bubbles: true, detail: base }))
              } else {
                await updateAccount(base.id, base)
                displaySuccess('Account updated.')
                this.dispatchEvent(new CustomEvent('account-updated', { bubbles: true, detail: base }))
              }
            } catch (e: any) {
              console.error(e)
              displayError(e?.message || 'Failed to save account')
            }
          }
        }
      }
    }

    // If existing user: mask password and allow click-to-change
    this._setupPasswordMask(passwordRow, confirmPasswordRow)
  }

  /** Public API */
  setAccount(a: Account | null) {
    this.account = a
    if (this.isReady) this._applyAccount(a)
  }

  private _applyAccount(a: Account | null) {
    if (!this.isReady) return

    const acc = a ?? ({} as Account)

    // avatar + basics
    if (this.avatarImg) this.avatarImg.src = acc.profilePicture || 'https://www.w3schools.com/howto/img_avatar.png'
    if (this.usernameInput) this.usernameInput.value = acc.name || ''
    if (this.firstNameInput) this.firstNameInput.value = acc.firstName || ''
    if (this.lastNameInput) this.lastNameInput.value = acc.lastName || ''
    if (this.emailInput) this.emailInput.value = acc.email || ''
    if (this.domainInput) this.domainInput.value = acc.domain || ''

    // delete button visibility
    if (this.deleteBtn) this.deleteBtn.style.display = acc.id ? 'inline-block' : 'none'

    // password UI depending on new vs existing
    const passwordRow = this.shadow.getElementById('password-row') as HTMLDivElement
    const confirmPasswordRow = this.shadow.getElementById('confirm-password-row') as HTMLDivElement
    this._setupPasswordMask(passwordRow, confirmPasswordRow)
  }

  /** Mask/enable password fields depending on whether it's a new or existing account */
  private _setupPasswordMask(passwordRow: HTMLDivElement, confirmPasswordRow: HTMLDivElement) {
    if (!this.passwordInput || !this.confirmPasswordInput) return

    const isExisting = !!this.account?.id
    if (isExisting) {
      // mask + disable until clicked
      this.passwordInput.value = '**********'
      this.passwordInput.disabled = true
      confirmPasswordRow.classList.add('hidden')
      this.passwordInput.onclick = () => {
        this.passwordInput!.disabled = false
        this.passwordInput!.value = ''
        this.confirmPasswordInput!.value = ''
        confirmPasswordRow.classList.remove('hidden')
        this.passwordInput!.focus()
      }
    } else {
      // new account: both visible & enabled
      this.passwordInput.disabled = false
      this.passwordInput.value = ''
      this.confirmPasswordInput.value = ''
      confirmPasswordRow.classList.remove('hidden')
      this.passwordInput.onclick = null
    }
  }
}

customElements.define('users-inline-editor', UsersInlineEditor)

/* ============================================================
   UsersManager — main widget
   ============================================================ */
export class UsersManager extends HTMLElement {
  private shadow!: ShadowRoot
  private table!: any
  private editorWrap!: HTMLElement
  private addBtn!: HTMLElement

  private rows: Account[] = []

  constructor() {
    super()
    this.shadow = this.attachShadow({ mode: 'open' })
  }

  connectedCallback() {
    this.shadow.innerHTML = `
      <style>
        :host { display:block; }
        .page {
          padding: 12px;
          color: var(--on-surface-color);
          background: var(--background-color);
        }
        .header {
          display:flex; align-items:center; gap:.5rem; margin-bottom:.5rem;
        }
        h2 {
          margin:0; font-size:1.1rem; font-weight:800;
          color: var(--on-surface-color);
        }
        .spacer { flex:1; }
        .card {
          background: var(--surface-color);
          color: var(--on-surface-color);
          border-radius: 12px;
          padding: 12px 14px;
          box-shadow: 0 0 0 1px var(--divider-color, color-mix(in srgb, var(--on-surface-color) 12%, transparent));
        }
        .table-wrap { margin-top: 10px; }
      </style>

      <section class="page">
        <div class="header">
          <h2>RBAC — Accounts</h2>
          <div class="spacer"></div>
          <paper-icon-button id="addBtn" icon="icons:add" title="Add account"></paper-icon-button>
        </div>

        <div class="card">
          <div id="editorWrap"></div>
          <div class="table-wrap">
            <!-- Match your original table attributes & columns -->
            <globular-table
              id="tbl"
              display-index="true"
              visible-data-count="10"
              row-height="50px"
              header-background-color="var(--primary-light-color)"
              header-text-color="var(--on-primary-light-color)"
            >
              <span id="table-title" slot="title">Accounts</span>
              <span class="field" slot="fields" field="displayAccountId">Id</span>
              <span class="field" slot="fields" field="firstName">First Name</span>
              <span class="field" slot="fields" field="lastName">Last Name</span>
              <span class="field" slot="fields" field="userEmail">Email</span>
            </globular-table>
          </div>
        </div>
      </section>
    `

    this.table = this.shadow.getElementById('tbl') as any
    this.editorWrap = this.shadow.getElementById('editorWrap') as HTMLElement
    this.addBtn = this.shadow.getElementById('addBtn') as HTMLElement

    this.table.addEventListener('row-click', (ev: any) => {
      const row: TableRow = ev.detail
      const acc = this.rows.find(a => a.id === row.id)
      this.openEditor(acc || null)
    })

    this.addBtn.addEventListener('click', () => {
      const blank: Account = {
        id: '',
        name: '',
        email: '',
        roles: [],
        domain: '',
        profilePicture: '',
        firstName: '',
        lastName: '',
      }
      this.openEditor(blank)
    })

    this.refresh()
  }

  private async refresh() {
    try {
      this.rows = await listAccounts()
      const data: TableRow[] = this.rows.map((a, idx) => ({
        _index: idx,
        _visible: true,

        // fields the table expects
        firstName: a.firstName || '',
        lastName: a.lastName || '',
        userEmail: a.email || '',

        // helper props for displayAccountId()
        id: a.id,
        profilePicture: a.profilePicture,
      }))
      this.table.setData(data)
    } catch (e: any) {
      console.error(e)
      this.table.setData([])
    }
  }

  private openEditor(acc: Account | null) {
    this.editorWrap.innerHTML = ''
    const ed = document.createElement('users-inline-editor') as UsersInlineEditor
    ed.setAccount(acc)

    ed.addEventListener('account-created', () => this._afterSave())
    ed.addEventListener('account-updated', () => this._afterSave())
    ed.addEventListener('account-deleted', () => this._afterSave())
    ed.addEventListener('edit-cancelled', () => { this.editorWrap.innerHTML = '' })

    this.editorWrap.appendChild(ed)
  }

  private async _afterSave() {
    await this.refresh()
    this.editorWrap.innerHTML = ''
  }
}

customElements.define('globular-users-manager', UsersManager)
