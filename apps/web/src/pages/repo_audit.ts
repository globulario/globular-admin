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

// ─── Module-level cache ───────────────────────────────────────────────────────
// Accumulates received events across navigation — remounting restores prior events.
const _cache: { data: AuditEvent[] | null; fetchedAt: number } = { data: null, fetchedAt: 0 }

class PageRepoAudit extends HTMLElement {
  private _events: AuditEvent[] = []
  private _loading = true
  private _error = ''
  private _searchQuery = ''
  private _eventTypeFilter = ''
  private _listening = false
  private _built = false

  connectedCallback() {
    this.style.display = 'block'
    this._buildShell()
    // Restore previously-received events immediately — no flicker on remount
    if (_cache.data !== null && _cache.data.length > 0) {
      this._events = [..._cache.data]
      // Reveal stats area and hide the "connecting" message right away
      const loadingArea = this.querySelector<HTMLElement>('[data-bind="loading-area"]')
      if (loadingArea) loadingArea.style.display = 'none'
      const statsArea = this.querySelector<HTMLElement>('[data-bind="stats-area"]')
      if (statsArea) statsArea.style.display = ''
      this._pushData()
    }
    this.startListening()
    // No timer: formatDate() renders absolute timestamps — no re-render needed.
  }

  disconnectedCallback() {
    this.stopListening()
  }

  // ── Shell (built once) ──────────────────────────────────────────────────────

  private _buildShell() {
    if (this._built) return
    this._built = true

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
          <p class="audit-subtitle" data-bind="subtitle">
            Trust-sensitive operations on packages and namespaces.
          </p>
        </div>

        <div data-bind="loading-area" class="loading-msg">Connecting to audit stream...</div>
        <div data-bind="error-area" style="display:none"></div>

        <div data-bind="stats-area" style="display:none">
          <div class="stat-row">
            <div class="stat-pill">
              <div class="label">Events Captured</div>
              <div class="value" data-bind="count">0</div>
            </div>
            <div class="stat-pill">
              <div class="label">Event Types</div>
              <div class="value" data-bind="type-count">0</div>
            </div>
          </div>

          <div class="toolbar" style="margin-top:12px">
            <input type="text" class="search-input" id="searchInput"
              placeholder="Search events..." value="" />
            <select id="eventTypeSelect">
              <option value="">All Events</option>
            </select>
          </div>

          <div class="md-panel" data-bind="table-wrap" style="margin-bottom:0;display:none">
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
              <tbody data-bind="tbody"></tbody>
            </table>
          </div>

          <div class="empty-state" data-bind="empty-state" style="display:none">
            <h3>No audit events captured yet.</h3>
            <p>Events will appear here as trust-sensitive operations occur (uploads, state changes, namespace grants).</p>
          </div>
        </div>
      </div>
    `

    // Wire controls once (they read current state via closures)
    const searchInput = this.querySelector('#searchInput') as HTMLInputElement | null
    searchInput?.addEventListener('input', () => {
      this._searchQuery = searchInput.value
      this._pushData()
    })

    this.querySelector('#eventTypeSelect')?.addEventListener('change', (e) => {
      this._eventTypeFilter = (e.target as HTMLSelectElement).value
      this._pushData()
    })
  }

  // ── Slot helpers ────────────────────────────────────────────────────────────

  private _set(key: string, html: string) {
    const el = this.querySelector<HTMLElement>(`[data-bind="${key}"]`)
    if (el) el.innerHTML = html
  }

  // ── Data source ─────────────────────────────────────────────────────────────

  private startListening() {
    this._loading = false
    this._listening = true

    const loadingArea = this.querySelector<HTMLElement>('[data-bind="loading-area"]')
    if (loadingArea) loadingArea.style.display = 'none'

    const statsArea = this.querySelector<HTMLElement>('[data-bind="stats-area"]')
    if (statsArea) statsArea.style.display = ''

    // Update subtitle with live dot
    this._set('subtitle', '<span class="live-dot"></span>Live — Trust-sensitive operations on packages and namespaces.')

    try {
      const hub = (window as any).__globularEventHub
      if (hub && typeof hub.subscribe === 'function') {
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
                if (this._events.length > 500) this._events.length = 500
                // Persist received events for remount restoration
                _cache.data = [...this._events]
                _cache.fetchedAt = Date.now()
                // Push new data into slots without rebuilding the shell
                this._pushData()
              }
            },
            false,
          )
        }
      }
    } catch {
      // EventHub not available — page degrades to empty state
    }

    this._pushData()
  }

  private stopListening() {
    this._listening = false
  }

  // ── Computed filters ────────────────────────────────────────────────────────

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

  // ── Push data into slots ────────────────────────────────────────────────────

  private _pushData() {
    const list = this.filteredEvents
    const eventTypes = this.distinctEventTypes

    // Stat pills
    this._set('count', String(this._events.length))
    this._set('type-count', String(eventTypes.length))

    // Rebuild the event type dropdown options (preserving current selection)
    const select = this.querySelector('#eventTypeSelect') as HTMLSelectElement | null
    if (select) {
      const currentVal = select.value
      select.innerHTML = `<option value="">All Events</option>` +
        eventTypes.map(t => `<option value="${t}"${this._eventTypeFilter === t ? ' selected' : ''}>${t}</option>`).join('')
      // Restore selection if still valid
      if (currentVal && eventTypes.includes(currentVal)) select.value = currentVal
    }

    const tableWrap = this.querySelector<HTMLElement>('[data-bind="table-wrap"]')
    const emptyState = this.querySelector<HTMLElement>('[data-bind="empty-state"]')

    if (list.length > 0) {
      if (tableWrap) tableWrap.style.display = ''
      if (emptyState) emptyState.style.display = 'none'
      this._set('tbody', list.map(ev => {
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
            <td>${this._eventBadge(ev.event || '')}</td>
            <td class="detail-cell">${details.map(d => escHtml(d)).join(' &middot; ') || '--'}</td>
            <td class="detail-cell"><code>${escHtml(ev.source_ip || '--')}</code></td>
          </tr>`
      }).join(''))
    } else {
      if (tableWrap) tableWrap.style.display = 'none'
      if (emptyState) emptyState.style.display = ''
    }
  }

  private _eventBadge(eventName: string): string {
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
    const short = eventName.replace(/^pkg\./, '').replace(/^artifact\./, '').replace(/^namespace\./, 'ns.')
    return `<span class="md-badge" style="--badge-color:${color}">${short}</span>`
  }
}

customElements.define('page-repo-audit', PageRepoAudit)
