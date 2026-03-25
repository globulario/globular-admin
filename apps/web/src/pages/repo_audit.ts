function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function formatDate(epochSeconds: number): string {
  if (!epochSeconds) return '--'
  return new Date(epochSeconds * 1000).toLocaleString()
}

interface AuditEvent {
  event: string
  subject: string
  principal_type: string
  timestamp: string
  timestamp_unix: number
  correlation_id: string
  source_ip: string
  // Additional fields vary by event type
  publisher_id?: string
  name?: string
  version?: string
  build_number?: number
  target_state?: string
  previous_state?: string
  reason?: string
  [key: string]: any
}

class PageRepoAudit extends HTMLElement {
  private _refreshTimer: number | null = null
  private _events: AuditEvent[] = []
  private _loading = true
  private _error = ''
  private _searchQuery = ''
  private _eventTypeFilter = ''
  private _listening = false
  private _eventSource: EventSource | null = null

  connectedCallback() {
    this.style.display = 'block'
    this.render()
    this.startListening()
    this._refreshTimer = window.setInterval(() => this.render(), 10_000) // re-render for relative times
  }

  disconnectedCallback() {
    if (this._refreshTimer) clearInterval(this._refreshTimer)
    this.stopListening()
  }

  private startListening() {
    // Subscribe to audit events via the Event service channels.
    // For now, audit events are displayed from a static snapshot with live additions
    // via the EventHub if available. Since there's no dedicated audit query RPC yet,
    // we start with an empty list and accumulate live events.
    this._loading = false
    this._listening = true
    this.render()

    // Try to connect to server-sent events for audit
    try {
      const hub = (window as any).__globularEventHub
      if (hub && typeof hub.subscribe === 'function') {
        // Subscribe to all pkg.* audit channels
        const channels = [
          'pkg.artifact.uploaded',
          'pkg.artifact.promoted',
          'pkg.artifact.state_changed',
          'pkg.artifact.downloaded',
          'pkg.artifact.deleted',
          'pkg.namespace.claimed',
          'pkg.namespace.granted',
          'pkg.namespace.revoked',
          'pkg.trusted_publisher.created',
          'pkg.trusted_publisher.deleted',
        ]
        for (const ch of channels) {
          hub.subscribe(ch,
            () => { /* onsubscribe */ },
            (data: any) => {
              if (data && typeof data === 'object') {
                this._events.unshift(data as AuditEvent)
                // Keep max 500 events
                if (this._events.length > 500) this._events.length = 500
                this.render()
              }
            },
            false, // local=false, subscribe to remote events
          )
        }
      }
    } catch {
      // EventHub not available — page degrades to empty state
    }
  }

  private stopListening() {
    this._listening = false
    if (this._eventSource) {
      this._eventSource.close()
      this._eventSource = null
    }
  }

  private get distinctEventTypes(): string[] {
    const set = new Set<string>()
    for (const e of this._events) {
      if (e.event) set.add(e.event)
    }
    return Array.from(set).sort()
  }

  private get filteredEvents(): AuditEvent[] {
    let list = this._events

    if (this._eventTypeFilter) {
      list = list.filter(e => e.event === this._eventTypeFilter)
    }

    if (this._searchQuery) {
      const q = this._searchQuery.toLowerCase()
      list = list.filter(e => {
        return (e.event || '').toLowerCase().includes(q)
          || (e.subject || '').toLowerCase().includes(q)
          || (e.publisher_id || '').toLowerCase().includes(q)
          || (e.name || '').toLowerCase().includes(q)
          || (e.source_ip || '').toLowerCase().includes(q)
      })
    }

    return list
  }

  private eventBadge(eventName: string): string {
    let color = '#6b7280'
    if (eventName.includes('uploaded') || eventName.includes('created') || eventName.includes('claimed')) {
      color = '#16a34a'
    } else if (eventName.includes('deleted') || eventName.includes('revoked') || eventName.includes('quarantined')) {
      color = '#dc2626'
    } else if (eventName.includes('promoted') || eventName.includes('granted')) {
      color = '#2563eb'
    } else if (eventName.includes('state_changed') || eventName.includes('deprecated')) {
      color = '#ca8a04'
    } else if (eventName.includes('downloaded')) {
      color = '#6b7280'
    }
    // Strip prefix for display
    const short = eventName.replace(/^pkg\./, '').replace(/^artifact\./, '').replace(/^namespace\./, 'ns.')
    return `<span class="md-badge" style="--badge-color:${color}">${short}</span>`
  }

  private render() {
    const list = this.filteredEvents
    const eventTypes = this.distinctEventTypes

    this.innerHTML = `
      <style>
        .audit-page { padding: 16px; display: flex; flex-direction: column; gap: 20px; }
        .audit-header h2 { margin:0; font: var(--md-typescale-headline-small); }
        .audit-subtitle { margin:2px 0 0; font: var(--md-typescale-body-medium);
          color:var(--secondary-text-color); opacity:.9; }

        .stat-row { display:flex; gap:12px; flex-wrap:wrap; align-items:center; }
        .stat-pill {
          background: var(--md-surface-container-low); border:1px solid var(--border-subtle-color);
          border-radius: var(--md-shape-md); padding:12px 20px;
          box-shadow: var(--md-elevation-1);
        }
        .stat-pill .label { font-size:.7rem; font-weight:600; text-transform:uppercase;
          letter-spacing:.06em; color:var(--secondary-text-color); margin-bottom:4px; }
        .stat-pill .value { font-size:1.6rem; font-weight:800; line-height:1; }

        .live-dot { display:inline-block; width:8px; height:8px; border-radius:50%;
          background:#16a34a; margin-right:6px; animation: pulse 2s infinite; }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }

        .toolbar { display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
        .toolbar .search-input {
          padding:8px 12px; border:1px solid var(--border-strong-color);
          border-radius: var(--md-shape-sm); background:var(--md-surface-container-lowest);
          color:var(--on-surface-color); font: var(--md-typescale-body-medium);
          outline:none; min-width:200px; flex:1; max-width:360px;
        }
        .toolbar .search-input:focus { border-color:var(--accent-color); box-shadow:var(--md-focus-ring); }
        .toolbar select {
          padding:8px 12px; border:1px solid var(--border-strong-color);
          border-radius: var(--md-shape-sm); background:var(--md-surface-container-lowest);
          color:var(--on-surface-color); font: var(--md-typescale-body-medium);
          outline:none; cursor:pointer;
        }

        .detail-cell { font-size:.78rem; color:var(--secondary-text-color); }
        .detail-cell code { font-size:.72rem; background:var(--md-surface-container);
          padding:1px 4px; border-radius:3px; }

        .empty-state { text-align:center; padding:48px 16px; }
        .empty-state h3 { margin:0 0 8px; font: var(--md-typescale-title-medium);
          color:var(--secondary-text-color); }
        .empty-state p { margin:0; font: var(--md-typescale-body-medium);
          color:var(--secondary-text-color); opacity:.7; }
        .loading-msg { color:var(--secondary-text-color); font-size:.85rem;
          font-style:italic; padding:16px; }
      </style>

      <div class="audit-page">
        <div>
          <h2>Audit Events</h2>
          <p class="audit-subtitle">
            ${this._listening ? '<span class="live-dot"></span>Live — ' : ''}
            Trust-sensitive operations on packages and namespaces.
          </p>
        </div>

        ${this._loading ? '<div class="loading-msg">Connecting to audit stream...</div>' : ''}

        ${this._error ? `
        <div class="md-banner-warn">${escHtml(this._error)}</div>
        ` : ''}

        ${!this._loading ? `
        <div class="stat-row">
          <div class="stat-pill">
            <div class="label">Events Captured</div>
            <div class="value">${this._events.length}</div>
          </div>
          <div class="stat-pill">
            <div class="label">Event Types</div>
            <div class="value">${eventTypes.length}</div>
          </div>
        </div>

        <div class="toolbar">
          <input type="text" class="search-input" id="searchInput"
            placeholder="Search events..." value="${this._searchQuery.replace(/"/g, '&quot;')}" />
          <select id="eventTypeSelect">
            <option value=""${this._eventTypeFilter === '' ? ' selected' : ''}>All Events</option>
            ${eventTypes.map(t => `<option value="${t}"${this._eventTypeFilter === t ? ' selected' : ''}>${t}</option>`).join('')}
          </select>
        </div>

        ${list.length > 0 ? `
        <div class="md-panel" style="margin-bottom:0">
          <table class="md-table">
            <thead>
              <tr>
                <th>Timestamp</th>
                <th>Subject</th>
                <th>Event</th>
                <th>Details</th>
                <th>Source</th>
              </tr>
            </thead>
            <tbody>
              ${list.map(ev => {
                const ts = ev.timestamp_unix || (ev.timestamp ? Math.floor(new Date(ev.timestamp).getTime() / 1000) : 0)
                const details: string[] = []
                if (ev.publisher_id) details.push(`ns: ${ev.publisher_id}`)
                if (ev.name) details.push(`pkg: ${ev.name}`)
                if (ev.version) details.push(`v${ev.version}`)
                if (ev.build_number !== undefined) details.push(`build ${ev.build_number}`)
                if (ev.target_state) details.push(`→ ${ev.target_state}`)
                if (ev.reason) details.push(`"${ev.reason}"`)
                return `
              <tr>
                <td style="white-space:nowrap; color:var(--secondary-text-color)">${formatDate(ts)}</td>
                <td><code>${escHtml(ev.subject || '--')}</code></td>
                <td>${this.eventBadge(ev.event || '')}</td>
                <td class="detail-cell">${details.map(d => escHtml(d)).join(' &middot; ') || '--'}</td>
                <td class="detail-cell"><code>${escHtml(ev.source_ip || '--')}</code></td>
              </tr>`
              }).join('')}
            </tbody>
          </table>
        </div>
        ` : `
        <div class="empty-state">
          <h3>No audit events captured yet.</h3>
          <p>Events will appear here as trust-sensitive operations occur (uploads, state changes, namespace grants).</p>
        </div>
        `}
        ` : ''}
      </div>
    `

    // Wire up events
    const searchInput = this.querySelector('#searchInput') as HTMLInputElement | null
    if (searchInput) {
      searchInput.addEventListener('input', () => {
        this._searchQuery = searchInput.value
        this.render()
        const newInput = this.querySelector('#searchInput') as HTMLInputElement | null
        if (newInput) {
          newInput.focus()
          newInput.setSelectionRange(newInput.value.length, newInput.value.length)
        }
      })
    }

    this.querySelector('#eventTypeSelect')?.addEventListener('change', (e) => {
      this._eventTypeFilter = (e.target as HTMLSelectElement).value
      this.render()
    })
  }
}

customElements.define('page-repo-audit', PageRepoAudit)
