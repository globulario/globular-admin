// src/pages/cluster_join.ts
import "@globular/components/markdown.js"
import '@polymer/iron-icons/iron-icons.js'
import '@polymer/paper-icon-button/paper-icon-button.js'
import '@polymer/iron-collapse/iron-collapse.js'
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

    // Static shell — info panel lives here so collapse state survives re-renders
    this.innerHTML = `
      <style>
        .cj-wrap { padding: 16px; }
        .cj-header { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; flex-wrap: wrap; }
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
        .cj-token-code { font-family: monospace; font-size: .84rem; word-break: break-all; flex: 1; }
        .cj-ips { font-size: .75rem; color: var(--secondary-text-color); }
      </style>

      <div class="cj-wrap">
        <div class="cj-header">
          <h2>Join Requests</h2>
          <div style="flex:1"></div>
          <button class="cj-btn" id="btnRefresh">↻ Refresh</button>
          <paper-icon-button id="infoBtn" icon="icons:help-outline" title="How to join a node"></paper-icon-button>
        </div>
        <p class="cj-subtitle">Approve or reject nodes requesting to join the cluster.</p>

        <iron-collapse id="infoPanel" class="info">
          <globular-markdown
            style="
              --content-bg-color: var(--surface-color);
              --content-text-color: var(--on-surface-color);
              --md-code-bg: color-mix(in srgb, var(--on-surface-color) 6%, var(--surface-color));
              --md-code-fg: var(--on-surface-color);
              --divider-color: color-mix(in srgb, var(--on-surface-color) 12%, transparent);
            "
          >
## How to register a node with Globular

Nodes do not register themselves automatically. Each node must go through an
explicit join flow: the node agent requests to join using a **join token**, and
an administrator approves the request here.

### Step 1 — Generate a join token

Use the **Generate Token** button below, or use the CLI **on the controller node**:

\`\`\`bash
globular cluster token create \\
  --controller <CONTROLLER_IP>:12000 \\
  --ca /var/lib/globular/pki/ca.crt
\`\`\`

> **Note:** Globular services run TLS by default. The CLI must trust the internal
> CA or the handshake will fail. The CA certificate is always at
> \`/var/lib/globular/pki/ca.crt\` on the controller node.
>
> **Common errors:**
>
> - \`connection refused\` — wrong IP. Use \`ip addr show\` on the controller node
>   to find its LAN IP, then pass it with \`--controller <LAN_IP>:12000\`.
>
> - \`unknown service clustercontroller.ClusterControllerService\` — right IP but
>   wrong port. The ClusterController listens on port **12000**.
>   Verify: \`ss -tlnp | grep 12000\`.
>
> - \`tls: first record does not look like a TLS handshake\` — TLS mismatch.
>   Pass \`--ca /var/lib/globular/pki/ca.crt\` so the CLI trusts the internal CA.
>   If running a dev setup without TLS, use \`--insecure\` instead.
>
> - \`context deadline exceeded while waiting for connections to become ready\` —
>   TLS succeeded but the ClusterController is not accepting requests. The service
>   may not be running or may still be starting up. Check its status:
>
> \`\`\`bash
> sudo systemctl status globular-clustercontroller
> sudo journalctl -u globular-clustercontroller -n 50
> \`\`\`
>
>   If the service is stopped, start it:
>
> \`\`\`bash
> sudo systemctl start globular-clustercontroller
> \`\`\`
>
> - \`stat /var/lib/globular/pki/ca.crt: permission denied\` — the CA file is
>   root-owned. Run the command with \`sudo\`, or copy the cert to a readable location first:
>
> \`\`\`bash
> # Option 1 — run with sudo
> sudo globular cluster token create \\
>   --controller 192.168.1.10:12000 \\
>   --ca /var/lib/globular/pki/ca.crt
>
> # Option 2 — copy the cert to your home directory first
> sudo cp /var/lib/globular/pki/ca.crt ~/globular-ca.crt
> globular cluster token create \\
>   --controller 192.168.1.10:12000 \\
>   --ca ~/globular-ca.crt
> \`\`\`
>
> Set permanently to avoid repeating flags on every command:
>
> \`\`\`bash
> export GLOBULAR_CONTROLLER=192.168.1.10:12000
> export GLOBULAR_CA=~/globular-ca.crt
> \`\`\`

Copy the token that is printed. It is single-use and expires after 24 hours (pass \`--expires 48h\` to extend).

### Step 2 — Install and start the node agent on the new node

On the machine you want to add to the cluster, install the Globular node agent
and point it at the controller:

\`\`\`bash
# Install the agent (adjust path to your distribution)
sudo globular install node-agent

# Start the agent with the join token and controller address
sudo globular node join \
  --token  <JOIN_TOKEN> \
  --controller <CONTROLLER_HOST>:443
\`\`\`

The agent will contact the controller, send its identity (hostname, IPs, OS,
architecture, agent version), and wait for approval.

### Step 3 — Approve the request here

Once the agent has sent its request, it appears in the **Pending** table above.
Click **✓ Approve**, optionally assign one or more profiles
(e.g. \`worker\`, \`control-plane\`), and confirm.

The node agent will receive its assigned node ID and begin converging toward
the desired state defined by its profiles.

### Step 4 — Verify

After approval, the node will appear on the **Nodes** page and in the
**Overview** health summary within one heartbeat interval (~30 s).

You can also verify from the CLI:

\`\`\`bash
globular cluster nodes list
\`\`\`

### Profiles

Profiles define which services a node should run. Leave the field empty to use
the cluster default. Common values:

| Profile | Purpose |
|---|---|
| \`worker\` | Runs workload services |
| \`control-plane\` | Runs etcd, scheduler, controller |
| \`storage\` | Runs persistence and object-store services |
          </globular-markdown>
        </iron-collapse>

        <div id="content"></div>
      </div>
    `

    const infoBtn   = this.querySelector('#infoBtn')
    const infoPanel = this.querySelector('#infoPanel') as any
    infoBtn?.addEventListener('click', () => infoPanel?.toggle())

    this.querySelector('#btnRefresh')?.addEventListener('click', () => this.load())

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

  // ─── Render (dynamic content only) ────────────────────────────────────────

  private render() {
    const el = this.querySelector('#content') as HTMLElement
    if (!el) return

    const pending = this._requests.filter(r => r.status.toLowerCase() === 'pending')
    const other   = this._requests.filter(r => r.status.toLowerCase() !== 'pending')

    el.innerHTML = `
      ${this._loadError ? `<div class="cj-warn">⚠ ${this._loadError}</div>` : ''}

      <!-- Pending requests -->
      <div class="cj-panel">
        <div class="cj-panel-hdr">
          <span>Pending (${pending.length})</span>
        </div>
        ${this._loading
          ? `<p class="cj-empty">Loading…</p>`
          : pending.length === 0
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

      <!-- Recent (approved / rejected) -->
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

      <!-- Join token generator -->
      <div class="cj-panel">
        <div class="cj-panel-hdr">
          <span>Join Token</span>
          <button class="cj-btn" id="btnCreateToken" ${this._tokenLoading ? 'disabled' : ''}>
            ${this._tokenLoading ? 'Generating…' : '+ Generate Token'}
          </button>
        </div>
        <div style="padding:14px">
          <p style="margin:0 0 10px;font-size:.84rem;color:var(--secondary-text-color);line-height:1.6">
            Generate a one-time token to give to a node operator. The node agent uses this token
            when calling <code>globular node join --token &lt;TOKEN&gt;</code>. Once submitted,
            the request will appear in the Pending list above.
          </p>
          ${this._tokenError ? `<div class="cj-error">${this._tokenError}</div>` : ''}
          ${this._token ? `
          <div class="cj-token-box">
            <span class="cj-token-code">${this._token}</span>
            <button class="cj-btn" id="btnCopyToken">Copy</button>
          </div>
          ${this._tokenExpiry ? `<p style="margin:6px 0 0;font-size:.75rem;color:var(--secondary-text-color)">Expires: ${this._tokenExpiry}</p>` : ''}
          ` : ''}
        </div>
      </div>
    `

    // Token actions
    el.querySelector('#btnCreateToken')?.addEventListener('click', () => this.doCreateToken())
    el.querySelector('#btnCopyToken')?.addEventListener('click', () => {
      navigator.clipboard.writeText(this._token).catch(() => {})
      const btn = el.querySelector('#btnCopyToken') as HTMLButtonElement
      if (btn) { btn.textContent = 'Copied!'; setTimeout(() => { btn.textContent = 'Copy' }, 2000) }
    })

    // Approve / reject toggle buttons
    el.querySelectorAll<HTMLButtonElement>('[data-approve]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.approve!
        if (this._expandedId === id && this._actionMode === 'approve') {
          this._expandedId = ''; this.render()
        } else {
          this._expandedId = id; this._actionMode = 'approve'; this._actionError = ''; this.render()
        }
      })
    })

    el.querySelectorAll<HTMLButtonElement>('[data-reject]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.reject!
        if (this._expandedId === id && this._actionMode === 'reject') {
          this._expandedId = ''; this.render()
        } else {
          this._expandedId = id; this._actionMode = 'reject'; this._actionError = ''; this.render()
        }
      })
    })

    el.querySelector<HTMLButtonElement>('#btnConfirmApprove')?.addEventListener('click', () => this.doApprove(this._expandedId))
    el.querySelector<HTMLButtonElement>('#btnConfirmReject')?.addEventListener('click', () => this.doReject(this._expandedId))
    el.querySelector<HTMLButtonElement>('#btnCancelAction')?.addEventListener('click', () => {
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
                Profiles define what services this node should run. Leave empty for the cluster default.
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
