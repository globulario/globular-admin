import { getStoredTokenSync } from '@globular/sdk'

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

interface InstallPolicy {
  verifiedPublishersOnly: boolean
  allowedNamespaces: string[]
  blockedNamespaces: string[]
  blockDeprecated: boolean
  blockYanked: boolean
}

class PageRepoInstallPolicy extends HTMLElement {
  private _policy: InstallPolicy | null = null
  private _loading = true
  private _error = ''
  private _saving = false
  private _saveMsg = ''

  connectedCallback() {
    this.style.display = 'block'
    this.render()
    this.load()
  }

  private async load() {
    try {
      const token = getStoredTokenSync() ?? ''
      const resp = await fetch('/admin/install-policy', {
        headers: token ? { token } : {},
      })
      if (resp.status === 404) {
        this._policy = null
        this._error = ''
      } else if (!resp.ok) {
        this._error = `Failed to load install policy: HTTP ${resp.status}`
      } else {
        this._policy = await resp.json()
        this._error = ''
      }
    } catch (e: any) {
      // Policy endpoint may not exist yet — show empty state
      this._policy = null
      this._error = ''
    }
    this._loading = false
    this.render()
  }

  private getFormValues(): InstallPolicy {
    const form = this.querySelector('#policyForm') as HTMLFormElement | null
    if (!form) {
      return {
        verifiedPublishersOnly: false,
        allowedNamespaces: [],
        blockedNamespaces: [],
        blockDeprecated: false,
        blockYanked: true,
      }
    }

    const getChecked = (id: string): boolean => {
      return (form.querySelector(`#${id}`) as HTMLInputElement)?.checked ?? false
    }
    const getTextareaLines = (id: string): string[] => {
      const val = (form.querySelector(`#${id}`) as HTMLTextAreaElement)?.value ?? ''
      return val.split('\n').map(s => s.trim()).filter(Boolean)
    }

    return {
      verifiedPublishersOnly: getChecked('verifiedOnly'),
      allowedNamespaces: getTextareaLines('allowedNs'),
      blockedNamespaces: getTextareaLines('blockedNs'),
      blockDeprecated: getChecked('blockDeprecated'),
      blockYanked: getChecked('blockYanked'),
    }
  }

  private async savePolicy() {
    this._saving = true
    this._saveMsg = ''
    this.render()

    try {
      const policy = this.getFormValues()
      const token = getStoredTokenSync() ?? ''
      const resp = await fetch('/admin/install-policy', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { token } : {}),
        },
        body: JSON.stringify(policy),
      })
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}`)
      }
      this._policy = policy
      this._saveMsg = 'Policy saved successfully.'
    } catch (e: any) {
      this._saveMsg = `Failed to save policy: ${e?.message || 'unknown error'}`
    }
    this._saving = false
    this.render()
  }

  private async deletePolicy() {
    if (!window.confirm('Remove the install policy? This will allow all packages to be installed.')) return

    try {
      const token = getStoredTokenSync() ?? ''
      const resp = await fetch('/admin/install-policy', {
        method: 'DELETE',
        headers: token ? { token } : {},
      })
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}`)
      }
      this._policy = null
      this._saveMsg = 'Policy removed.'
    } catch (e: any) {
      this._saveMsg = `Failed to remove policy: ${e?.message || 'unknown error'}`
    }
    this.render()
  }

  private render() {
    const p = this._policy

    this.innerHTML = `
      <style>
        .policy-page { padding: 16px; display: flex; flex-direction: column; gap: 20px; max-width:700px; }
        .policy-header h2 { margin:0; font: var(--md-typescale-headline-small); }
        .policy-subtitle { margin:2px 0 0; font: var(--md-typescale-body-medium);
          color:var(--secondary-text-color); opacity:.9; }

        .policy-form { display:flex; flex-direction:column; gap:16px; }
        .form-group { display:flex; flex-direction:column; gap:4px; }
        .form-group label {
          font: var(--md-typescale-label-medium); text-transform:uppercase;
          letter-spacing:.05em; color:var(--secondary-text-color); font-size:.72rem;
        }
        .form-group textarea {
          padding:8px 12px; border:1px solid var(--border-strong-color);
          border-radius: var(--md-shape-sm); background:var(--md-surface-container-lowest);
          color:var(--on-surface-color); font: var(--md-typescale-body-medium);
          font-family:monospace; font-size:.82rem; outline:none; resize:vertical; min-height:60px;
        }
        .form-group textarea:focus { border-color:var(--accent-color); box-shadow:var(--md-focus-ring); }
        .form-hint { font-size:.72rem; color:var(--secondary-text-color); margin-top:2px; }

        .checkbox-row {
          display:flex; align-items:center; gap:8px; padding:4px 0;
        }
        .checkbox-row input[type="checkbox"] {
          width:18px; height:18px; accent-color:var(--accent-color); cursor:pointer;
        }
        .checkbox-row span { font: var(--md-typescale-body-medium); }

        .policy-actions { display:flex; gap:10px; flex-wrap:wrap; align-items:center; }
        .save-msg { font-size:.82rem; margin-left:8px; }
        .save-msg.ok { color:var(--success-color); }
        .save-msg.err { color:var(--error-color); }

        .empty-policy {
          background:var(--md-surface-container-low); border:1px solid var(--border-subtle-color);
          border-radius:var(--md-shape-md); padding:24px; text-align:center;
        }
        .empty-policy p { color:var(--secondary-text-color); margin:0 0 12px; }

        .loading-msg { color:var(--secondary-text-color); font-size:.85rem;
          font-style:italic; padding:16px; }
      </style>

      <div class="policy-page">
        <div>
          <h2>Install Policy</h2>
          <p class="policy-subtitle">Control which packages can be installed on this cluster.</p>
        </div>

        ${this._loading ? '<div class="loading-msg">Loading policy...</div>' : ''}

        ${this._error ? `
        <div class="md-banner-warn">${escHtml(this._error)}</div>
        ` : ''}

        ${!this._loading ? `
        <form id="policyForm" class="policy-form">
          <div class="checkbox-row">
            <input type="checkbox" id="verifiedOnly" ${p?.verifiedPublishersOnly ? 'checked' : ''} />
            <span>Verified publishers only</span>
          </div>
          <div class="form-hint" style="margin-left:26px">Only allow artifacts from namespaces with a claimed owner.</div>

          <div class="form-group">
            <label for="allowedNs">Allowed Namespaces</label>
            <textarea id="allowedNs" rows="3" placeholder="One namespace per line...">${(p?.allowedNamespaces || []).join('\n')}</textarea>
            <div class="form-hint">Only these namespaces will be allowed. Leave empty to allow all.</div>
          </div>

          <div class="form-group">
            <label for="blockedNs">Blocked Namespaces</label>
            <textarea id="blockedNs" rows="3" placeholder="One namespace per line...">${(p?.blockedNamespaces || []).join('\n')}</textarea>
            <div class="form-hint">These namespaces will always be blocked.</div>
          </div>

          <div class="checkbox-row">
            <input type="checkbox" id="blockDeprecated" ${p?.blockDeprecated ? 'checked' : ''} />
            <span>Block deprecated packages</span>
          </div>

          <div class="checkbox-row">
            <input type="checkbox" id="blockYanked" ${p?.blockYanked !== false ? 'checked' : ''} />
            <span>Block yanked packages</span>
          </div>

          <div class="policy-actions">
            <button type="button" class="md-btn md-btn-filled" id="btnSave" ${this._saving ? 'disabled' : ''}>
              ${this._saving ? 'Saving...' : 'Save Policy'}
            </button>
            ${p ? '<button type="button" class="md-btn md-btn-danger" id="btnDelete">Remove Policy</button>' : ''}
            ${this._saveMsg ? `<span class="save-msg ${this._saveMsg.includes('success') || this._saveMsg.includes('removed') ? 'ok' : 'err'}">${escHtml(this._saveMsg)}</span>` : ''}
          </div>
        </form>
        ` : ''}
      </div>
    `

    this.querySelector('#btnSave')?.addEventListener('click', () => this.savePolicy())
    this.querySelector('#btnDelete')?.addEventListener('click', () => this.deletePolicy())
  }
}

customElements.define('page-repo-install-policy', PageRepoInstallPolicy)
