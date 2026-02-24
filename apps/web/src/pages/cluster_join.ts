// src/pages/cluster_join.ts
import {
  listJoinRequests, approveJoin, rejectJoin, createJoinToken,
  type JoinRequest,
} from '@globular/backend'

function badge(label: string, color: string): string {
  return `<span style="display:inline-block;padding:2px 8px;border-radius:999px;font-size:.72rem;font-weight:700;letter-spacing:.04em;text-transform:uppercase;background:color-mix(in srgb,${color} 15%,transparent);color:${color};border:1px solid color-mix(in srgb,${color} 35%,transparent)">${label}</span>`
}

function statusBadge(status: string): string {
  switch (status.toLowerCase()) {
    case 'pending':  return badge('PENDING',  '#f59e0b')
    case 'approved': return badge('APPROVED', 'var(--success-color)')
    case 'rejected': return badge('REJECTED', 'var(--error-color)')
    default:         return badge(status || 'UNKNOWN', 'var(--secondary-text-color)')
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

class PageClusterJoin extends HTMLElement {
  private _requests: JoinRequest[] = []
  private _loadError = ''
  private _loading = true

  private _expandedId = ''
  private _actionMode: 'approve' | 'reject' = 'approve'
  private _actionError = ''
  private _actionPending = false

  private _token = ''
  private _tokenExpiry = ''
  private _tokenError = ''
  private _tokenLoading = false

  private _refreshTimer: number | null = null

  connectedCallback() {
    this.style.display = 'block'
    this.load()
    this._refreshTimer = window.setInterval(() => this.load(), 30_000)
  }

  disconnectedCallback() {
    if (this._refreshTimer) clearInterval(this._refreshTimer)
  }

  // ─── Data ─────────────────────────────────────────────────────────────────

  private async load() {
    try {
      this._requests = await listJoinRequests()
      this._loadError = ''
    } catch (e: any) {
      this._loadError = e?.message || 'ClusterController unavailable'
    }
    this._loading = false
    this.render()
  }

  private async doApprove(requestId: string) {
    const input = this.querySelector<HTMLInputElement>('#profiles-input')
    const profiles = (input?.value ?? '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)

    this._actionPending = true
    this._actionError = ''
    this.render()

    try {
      await approveJoin(requestId, profiles)
      this._expandedId = ''
      this._actionPending = false
      await this.load()
    } catch (e: any) {
      this._actionError = e?.message || 'Approval failed'
      this._actionPending = false
      this.render()
    }
  }

  private async doReject(requestId: string) {
    const input = this.querySelector<HTMLInputElement>('#reject-reason')
    const reason = input?.value?.trim() ?? ''

    this._actionPending = true
    this._actionError = ''
    this.render()

    try {
      await rejectJoin(requestId, reason)
      this._expandedId = ''
      this._actionPending = false
      await this.load()
    } catch (e: any) {
      this._actionError = e?.message || 'Rejection failed'
      this._actionPending = false
      this.render()
    }
  }

  private async doCreateToken() {
    this._tokenLoading = true
    this._tokenError = ''
    this._token = ''
    this._tokenExpiry = ''
    this.render()

    try {
      const result = await createJoinToken()
      this._token = result.token
      this._tokenExpiry = result.expiresAt
    } catch (e: any) {
      this._tokenError = e?.message || 'Failed to create join token'
    }
    this._tokenLoading = false
    this.render()
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  private render() {
    const pending = this._requests.filter(r => r.status.toLowerCase() === 'pending')
    const other   = this._requests.filter(r => r.status.toLowerCase() !== 'pending')

    this.innerHTML = `
      <style>
        .cj-wrap { padding: 16px; }
        .cj-header { display: flex; align-items: center; gap: 12px; margin-bottom: 4px; flex-wrap: wrap; }
        .cj-header h2 { margin: 0; font-size: 1.25rem; font-weight: 800; }
        .cj-subtitle { margin: 0.25rem 0 1.25rem; opacity: .85; font-size: .88rem; }
        .cj-panel {
          background: var(--surface-color);
          border: 1px solid var(--border-subtle-color);
          border-radius: 12px;
          overflow: hidden;
          margin-bottom: 16px;
        }
        .cj-panel-hdr {
          padding: 10px 14px;
          font-size: .75rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: .06em;
          color: var(--secondary-text-color);
          border-bottom: 1px solid var(--border-subtle-color);
          display: flex;
          align-items: center;
          justify-content: space-between;
          flex-wrap: wrap;
          gap: 6px;
        }
        .cj-table { width: 100%; border-collapse: collapse; font-size: .84rem; }
        .cj-table th {
          text-align: left;
          padding: 8px 12px;
          font-size: .71rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: .06em;
          color: var(--secondary-text-color);
          border-bottom: 1px solid var(--border-subtle-color);
        }
        .cj-table td { padding: 9px 12px; border-bottom: 1px solid var(--border-subtle-color); vertical-align: middle; }
        .cj-table tr:last-child td { border-bottom: none; }
        .cj-mono { font-family: monospace; font-size: .78rem; color: var(--secondary-text-color); }
        .cj-empty { padding: 14px; font-size: .85rem; font-style: italic; color: var(--secondary-text-color); }
        .cj-btn {
          border: 1px solid var(--border-subtle-color);
          background: transparent;
          color: var(--on-surface-color);
          border-radius: 6px;
          padding: 4px 12px;
          cursor: pointer;
          font-size: .78rem;
        }
        .cj-btn-approve {
          border: none;
          background: var(--success-color);
          color: #fff;
          border-radius: 6px;
          padding: 4px 12px;
          cursor: pointer;
          font-size: .78rem;
          font-weight: 600;
        }
        .cj-btn-reject {
          border: none;
          background: var(--error-color);
          color: #fff;
          border-radius: 6px;
          padding: 4px 12px;
          cursor: pointer;
          font-size: .78rem;
          font-weight: 600;
        }
        .cj-btn:disabled, .cj-btn-approve:disabled, .cj-btn-reject:disabled { opacity: .5; cursor: not-allowed; }
        .cj-action-row td {
          background: color-mix(in srgb, var(--primary-color) 4%, transparent);
          padding: 12px 14px;
          border-bottom: 1px solid var(--border-subtle-color);
        }
        .cj-action-form { display: flex; align-items: flex-start; gap: 10px; flex-wrap: wrap; }
        .cj-input {
          flex: 1;
          min-width: 200px;
          padding: 6px 10px;
          border: 1px solid var(--border-subtle-color);
          border-radius: 6px;
          background: var(--background-color);
          color: var(--on-surface-color);
          font-size: .84rem;
        }
        .cj-input:focus { outline: none; border-color: var(--primary-color); }
        .cj-input-label { font-size: .72rem; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; color: var(--secondary-text-color); margin-bottom: 5px; }
        .cj-error {
          background: color-mix(in srgb, var(--error-color) 10%, transparent);
          border: 1px solid color-mix(in srgb, var(--error-color) 30%, transparent);
          border-radius: 8px;
          padding: 10px 14px;
          font-size: .84rem;
          color: var(--error-color);
          margin-bottom: 12px;
        }
        .cj-warn {
          background: color-mix(in srgb, #f59e0b 10%, transparent);
          border: 1px solid color-mix(in srgb, #f59e0b 30%, transparent);
          border-radius: 8px;
          padding: 10px 14px;
          font-size: .84rem;
          color: #b45309;
          margin-bottom: 12px;
          line-height: 1.5;
        }
        [data-theme="dark"] .cj-warn { color: #fbbf24; }
        .cj-token-box {
          background: color-mix(in srgb, var(--primary-color) 5%, transparent);
          border: 1px solid var(--border-subtle-color);
          border-radius: 8px;
          padding: 12px 14px;
          display: flex;
          align-items: center;
          gap: 10px;
          flex-wrap: wrap;
        }
        .cj-token-code {
          font-family: monospace;
          font-size: .84rem;
          word-break: break-all;
          flex: 1;
        }
        .cj-ips { font-size: .75rem; color: var(--secondary-text-color); }
      </style>

      <div class="cj-wrap">
        <div class="cj-header">
          <h2>Join Requests</h2>
          <div style="flex:1"></div>
          <button class="cj-btn" id="btnRefresh">↻ Refresh</button>
        </div>
        <p class="cj-subtitle">Approve or reject nodes requesting to join the cluster.</p>

        ${this._loadError ? `<div class="cj-warn">⚠ ${this._loadError}</div>` : ''}

        <!-- Pending requests -->
        <div class="cj-panel">
          <div class="cj-panel-hdr">
            <span>Pending (${pending.length})</span>
          </div>
          ${this._loading ? `<p class="cj-empty">Loading…</p>` : pending.length === 0
            ? `<p class="cj-empty">No pending join requests.</p>`
            : `<table class="cj-table">
              <thead>
                <tr>
                  <th>Hostname</th>
                  <th>Node Name</th>
                  <th>IPs</th>
                  <th>OS / Arch</th>
                  <th>Agent</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                ${pending.map(r => this.renderRequestRow(r)).join('')}
              </tbody>
            </table>`
          }
        </div>

        <!-- Recent (approved/rejected) -->
        ${other.length > 0 ? `
        <div class="cj-panel">
          <div class="cj-panel-hdr">
            <span>Recent (${other.length})</span>
          </div>
          <table class="cj-table">
            <thead>
              <tr>
                <th>Hostname</th>
                <th>Node Name</th>
                <th>IPs</th>
                <th>Status</th>
                <th>Message</th>
              </tr>
            </thead>
            <tbody>
              ${other.map(r => `
              <tr>
                <td><strong>${r.hostname || '—'}</strong>${r.domain ? `<br><span class="cj-mono">${r.domain}</span>` : ''}</td>
                <td class="cj-mono">${r.nodeName || '—'}</td>
                <td class="cj-ips">${r.ips.join('<br>') || '—'}</td>
                <td>${statusBadge(r.status)}</td>
                <td style="color:var(--secondary-text-color);font-size:.82rem">${r.message || '—'}</td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>` : ''}

        <!-- Join token -->
        <div class="cj-panel">
          <div class="cj-panel-hdr">
            <span>Join Token</span>
            <button class="cj-btn" id="btnCreateToken" ${this._tokenLoading ? 'disabled' : ''}>
              ${this._tokenLoading ? 'Generating…' : '+ Generate Token'}
            </button>
          </div>
          <div style="padding:14px">
            <p style="margin:0 0 10px;font-size:.84rem;color:var(--secondary-text-color);line-height:1.6">
              Generate a one-time token to give to a node operator. The node agent uses this token when calling <code>RequestJoin</code>. Once a node submits its request, it will appear above for approval.
            </p>
            ${this._tokenError ? `<div class="cj-error">${this._tokenError}</div>` : ''}
            ${this._token ? `
            <div class="cj-token-box">
              <span class="cj-token-code" id="tokenText">${this._token}</span>
              <button class="cj-btn" id="btnCopyToken">Copy</button>
            </div>
            ${this._tokenExpiry ? `<p style="margin:6px 0 0;font-size:.75rem;color:var(--secondary-text-color)">Expires: ${this._tokenExpiry}</p>` : ''}
            ` : ''}
          </div>
        </div>
      </div>
    `

    this.querySelector('#btnRefresh')?.addEventListener('click', () => this.load())
    this.querySelector('#btnCreateToken')?.addEventListener('click', () => this.doCreateToken())
    this.querySelector('#btnCopyToken')?.addEventListener('click', () => {
      navigator.clipboard.writeText(this._token).catch(() => {})
      const btn = this.querySelector('#btnCopyToken') as HTMLButtonElement
      if (btn) { btn.textContent = 'Copied!'; setTimeout(() => { btn.textContent = 'Copy' }, 2000) }
    })

    // Wire up approve/reject toggle buttons
    this.querySelectorAll<HTMLButtonElement>('[data-approve]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.approve!
        if (this._expandedId === id && this._actionMode === 'approve') {
          this._expandedId = ''; this.render()
        } else {
          this._expandedId = id; this._actionMode = 'approve'; this._actionError = ''; this.render()
        }
      })
    })

    this.querySelectorAll<HTMLButtonElement>('[data-reject]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.reject!
        if (this._expandedId === id && this._actionMode === 'reject') {
          this._expandedId = ''; this.render()
        } else {
          this._expandedId = id; this._actionMode = 'reject'; this._actionError = ''; this.render()
        }
      })
    })

    // Wire up confirm buttons inside the expanded action row
    this.querySelector<HTMLButtonElement>('#btnConfirmApprove')?.addEventListener('click', () => {
      this.doApprove(this._expandedId)
    })
    this.querySelector<HTMLButtonElement>('#btnConfirmReject')?.addEventListener('click', () => {
      this.doReject(this._expandedId)
    })
    this.querySelector<HTMLButtonElement>('#btnCancelAction')?.addEventListener('click', () => {
      this._expandedId = ''; this._actionError = ''; this.render()
    })
  }

  private renderRequestRow(r: JoinRequest): string {
    const isExpanded = this._expandedId === r.requestId
    const rows: string[] = []

    rows.push(`
      <tr>
        <td><strong>${r.hostname || '—'}</strong>${r.domain ? `<br><span class="cj-mono">${r.domain}</span>` : ''}</td>
        <td class="cj-mono">${r.nodeName || '—'}</td>
        <td class="cj-ips">${r.ips.join('<br>') || '—'}</td>
        <td class="cj-mono">${r.os}${r.arch ? ' / ' + r.arch : ''}</td>
        <td class="cj-mono">${r.agentVersion || '—'}</td>
        <td>
          <div style="display:flex;gap:6px">
            <button class="cj-btn-approve" data-approve="${r.requestId}">✓ Approve</button>
            <button class="cj-btn-reject"  data-reject="${r.requestId}">✕ Reject</button>
          </div>
        </td>
      </tr>`)

    if (isExpanded) {
      rows.push(`
        <tr class="cj-action-row">
          <td colspan="6">
            ${this._actionError ? `<div class="cj-error" style="margin-bottom:10px">⚠ ${this._actionError}</div>` : ''}
            ${this._actionMode === 'approve' ? `
            <div>
              <div class="cj-input-label">Profiles (comma-separated, optional)</div>
              <div class="cj-action-form">
                <input id="profiles-input" class="cj-input" type="text"
                  placeholder="e.g. worker, control-plane"
                  value="${r.profiles.join(', ')}" />
                <button class="cj-btn-approve" id="btnConfirmApprove" ${this._actionPending ? 'disabled' : ''}>
                  ${this._actionPending ? 'Approving…' : '✓ Confirm Approve'}
                </button>
                <button class="cj-btn" id="btnCancelAction">Cancel</button>
              </div>
              <p style="margin:6px 0 0;font-size:.75rem;color:var(--secondary-text-color)">
                Profiles define what services this node should run. Leave empty for the default profile.
              </p>
            </div>` : `
            <div>
              <div class="cj-input-label">Reason for rejection (optional)</div>
              <div class="cj-action-form">
                <input id="reject-reason" class="cj-input" type="text"
                  placeholder="e.g. Unrecognised node, wrong token" />
                <button class="cj-btn-reject" id="btnConfirmReject" ${this._actionPending ? 'disabled' : ''}>
                  ${this._actionPending ? 'Rejecting…' : '✕ Confirm Reject'}
                </button>
                <button class="cj-btn" id="btnCancelAction">Cancel</button>
              </div>
            </div>`}
          </td>
        </tr>`)
    }

    return rows.join('')
  }
}

customElements.define('page-cluster-join', PageClusterJoin)
