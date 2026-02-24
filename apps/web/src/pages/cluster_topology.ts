import {
  getClusterHealth,
  listClusterNodes,
  getDriftReport,
  clusterdoctorpb,
  type ClusterNode,
  type NodeHealth,
  type NodeCapabilities,
  type DriftItem,
} from '@globular/backend'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtBytes(bytes: number): string {
  if (!bytes) return '—'
  if (bytes >= 1e12) return `${(bytes / 1e12).toFixed(1)} TB`
  if (bytes >= 1e9)  return `${(bytes / 1e9).toFixed(1)} GB`
  if (bytes >= 1e6)  return `${(bytes / 1e6).toFixed(0)} MB`
  return `${bytes} B`
}

function capsCard(caps: NodeCapabilities | null): string {
  if (!caps || (caps.cpuCount === 0 && caps.ramBytes === 0)) return ''
  const diskPct = caps.diskBytes > 0
    ? Math.round((1 - caps.diskFreeBytes / caps.diskBytes) * 100)
    : 0
  return `
    <div class="caps-row">
      <span class="caps-item" title="Logical CPU cores">
        <span class="caps-icon">⬡</span>${caps.cpuCount} CPU${caps.cpuCount !== 1 ? 's' : ''}
      </span>
      <span class="caps-item" title="Total RAM">
        <span class="caps-icon">▣</span>${fmtBytes(caps.ramBytes)} RAM
      </span>
      <span class="caps-item" title="Disk: ${fmtBytes(caps.diskFreeBytes)} free of ${fmtBytes(caps.diskBytes)}">
        <span class="caps-icon">◫</span>${fmtBytes(caps.diskBytes)} disk
        <span class="caps-disk-bar">
          <span class="caps-disk-used" style="width:${diskPct}%"></span>
        </span>
        <span class="caps-disk-free">${fmtBytes(caps.diskFreeBytes)} free</span>
      </span>
    </div>`
}

function statusColor(s: string): string {
  const u = (s || '').toUpperCase()
  if (u === 'HEALTHY' || u === 'READY' || u === 'CONVERGING') return 'var(--success-color)'
  if (u === 'UNHEALTHY' || u === 'DEGRADED') return '#f59e0b'
  if (u === 'UNREACHABLE' || u.includes('ERROR')) return 'var(--error-color)'
  return 'var(--secondary-text-color)'
}

function statusBadge(s: string): string {
  const color = statusColor(s)
  const label = s || 'UNKNOWN'
  return `<span style="
    display:inline-block; padding:2px 8px; border-radius:999px; font-size:.72rem;
    font-weight:700; letter-spacing:.04em; text-transform:uppercase;
    background:color-mix(in srgb,${color} 15%,transparent);
    color:${color}; border:1px solid color-mix(in srgb,${color} 35%,transparent);
  ">${label}</span>`
}

function relativeTime(epochSeconds: number): string {
  if (!epochSeconds) return '—'
  const diff = Math.floor(Date.now() / 1000) - epochSeconds
  if (diff < 60)    return `${diff}s ago`
  if (diff < 3600)  return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

function driftCategoryLabel(cat: number): string {
  const D = clusterdoctorpb.DriftCategory
  switch (cat) {
    case D.STATE_HASH_MISMATCH:  return 'State hash mismatch'
    case D.VERSION_MISMATCH:     return 'Version mismatch'
    case D.MISSING_UNIT_FILE:    return 'Missing unit file'
    case D.UNIT_STOPPED:         return 'Unit stopped'
    case D.UNIT_DISABLED:        return 'Unit disabled'
    case D.INVENTORY_INCOMPLETE: return 'Inventory incomplete'
    default:                      return `drift(${cat})`
  }
}

// ─── Component ───────────────────────────────────────────────────────────────

class PageClusterTopology extends HTMLElement {
  private _refreshTimer: number | null = null
  private _nodes: ClusterNode[] = []
  private _healthNodes = new Map<string, NodeHealth>()
  private _driftByNode = new Map<string, DriftItem[]>()
  private _loading = true
  private _nodesError = ''
  private _expandedNode: string | null = null

  connectedCallback() {
    this.style.display = 'block'
    this.render()
    this.load()
    this._refreshTimer = window.setInterval(() => this.load(), 30_000)
  }

  disconnectedCallback() {
    if (this._refreshTimer) clearInterval(this._refreshTimer)
  }

  private async load() {
    const [nodesRes, healthRes, driftRes] = await Promise.allSettled([
      listClusterNodes(),
      getClusterHealth(),
      getDriftReport(),
    ])

    if (nodesRes.status === 'fulfilled') {
      this._nodes = nodesRes.value
      this._nodesError = ''
    } else {
      this._nodesError = (nodesRes.reason as any)?.message || 'ClusterController unavailable'
    }

    if (healthRes.status === 'fulfilled') {
      this._healthNodes = new Map(healthRes.value.nodes.map(n => [n.nodeId, n]))
    }

    if (driftRes.status === 'fulfilled') {
      const byNode = new Map<string, DriftItem[]>()
      for (const item of driftRes.value.items) {
        const list = byNode.get(item.nodeId) ?? []
        list.push(item)
        byNode.set(item.nodeId, list)
      }
      this._driftByNode = byNode
    }

    this._loading = false
    this.render()
  }

  private renderNodeCard(node: ClusterNode): string {
    const health = this._healthNodes.get(node.nodeId)
    const drift = this._driftByNode.get(node.nodeId) ?? []
    const status = health?.status || node.status || 'unknown'
    const borderColor = statusColor(status)
    const lastSeen = health?.lastSeen || node.lastSeen
    const failedChecks = health?.failedChecks ?? 0
    const expanded = this._expandedNode === node.nodeId

    const profileTags = node.profiles.length > 0
      ? node.profiles.map(p => `<span class="profile-tag">${p}</span>`).join('')
      : ''

    return `
      <div class="node-card${expanded ? ' expanded' : ''}"
           style="border-left:4px solid ${borderColor}"
           data-node-id="${node.nodeId}">

        <div class="node-card-header">
          <div class="node-name">
            <span class="dot" style="background:${borderColor}"></span>
            <span class="hostname">${node.hostname || node.nodeId}</span>
            ${profileTags}
          </div>
          ${statusBadge(status)}
        </div>

        <div class="node-card-body">
          <div class="node-meta">
            <span class="meta-label">IPs</span>
            <span class="meta-value mono">${node.ips.join(' · ') || '—'}</span>
          </div>
          <div class="node-meta">
            <span class="meta-label">Last seen</span>
            <span class="meta-value">${relativeTime(lastSeen)}</span>
          </div>
          <div class="node-meta">
            <span class="meta-label">Inventory</span>
            ${node.inventoryComplete
              ? `<span class="meta-value ok">✓ complete</span>`
              : `<span class="meta-value warn">⚠ incomplete</span>`}
          </div>
          ${failedChecks > 0 ? `
          <div class="node-meta">
            <span class="meta-label">Checks</span>
            <span class="meta-value err">${failedChecks} failed</span>
          </div>` : ''}
          <div class="node-meta">
            <span class="meta-label">Drift</span>
            ${drift.length > 0
              ? `<span class="meta-value warn">${drift.length} item${drift.length !== 1 ? 's' : ''}</span>`
              : `<span class="meta-value ok">✓ none</span>`}
          </div>
          ${node.lastError ? `
          <div class="node-meta">
            <span class="meta-label">Error</span>
            <span class="meta-value err" style="font-size:.75rem">${node.lastError}</span>
          </div>` : ''}
        </div>

        ${capsCard(node.capabilities)}

        ${expanded && drift.length > 0 ? `
        <div class="node-drift">
          <div class="drift-header">Drift Details</div>
          ${drift.map(d => `
          <div class="drift-row">
            <span class="drift-entity">${d.entityRef}</span>
            <span class="drift-cat">${driftCategoryLabel(d.category)}</span>
            <div class="drift-vals">
              <span class="drift-kv"><span class="drift-kv-label">desired</span><code>${d.desired}</code></span>
              <span class="drift-kv"><span class="drift-kv-label">actual</span><code>${d.actual}</code></span>
            </div>
          </div>`).join('')}
        </div>` : ''}

        <button class="node-toggle" data-node-id="${node.nodeId}">
          ${expanded ? '▲ Less' : '▼ Details'}
        </button>
      </div>
    `
  }

  private render() {
    const now = new Date().toLocaleTimeString()

    const totalDrift = [...this._driftByNode.values()].reduce((s, items) => s + items.length, 0)

    const healthyCount = this._nodes.filter(n => {
      const st = (this._healthNodes.get(n.nodeId)?.status || n.status || '').toUpperCase()
      return st === 'HEALTHY' || st === 'READY' || st === 'CONVERGING'
    }).length
    const degradedCount = this._nodes.length - healthyCount

    this.innerHTML = `
      <style>
        .topo { padding:16px; display:flex; flex-direction:column; gap:20px; }

        /* header */
        .topo-header { display:flex; align-items:center; gap:12px; }
        .topo-header h2 { margin:0; font-size:1.3rem; font-weight:800; }
        .topo-ts { font-size:.8rem; color:var(--secondary-text-color); margin-left:auto; }
        .btn-refresh {
          border:1px solid var(--border-subtle-color); background:transparent;
          color:var(--on-surface-color); border-radius:8px; padding:5px 12px;
          cursor:pointer; font-size:.85rem; font-weight:600;
        }
        .btn-refresh:hover { background:var(--surface-elevated-color); }

        /* stat cards */
        .stat-grid { display:grid; grid-template-columns:repeat(4,1fr); gap:12px; }
        @media(max-width:700px) { .stat-grid { grid-template-columns:repeat(2,1fr); } }
        .stat-card {
          background:var(--surface-color); border:1px solid var(--border-subtle-color);
          border-radius:12px; padding:16px 20px;
        }
        .stat-card .label { font-size:.75rem; font-weight:600; text-transform:uppercase;
          letter-spacing:.06em; color:var(--secondary-text-color); margin-bottom:6px; }
        .stat-card .value { font-size:2rem; font-weight:800; line-height:1; }

        /* node grid */
        .node-grid {
          display:grid;
          grid-template-columns:repeat(auto-fill, minmax(300px, 1fr));
          gap:16px;
          align-items:start;
        }

        /* node card */
        .node-card {
          background:var(--surface-color); border:1px solid var(--border-subtle-color);
          border-radius:12px; overflow:hidden; cursor:pointer;
          transition: box-shadow .15s;
        }
        .node-card:hover { box-shadow:0 4px 16px rgba(0,0,0,.1); }
        .node-card.expanded { cursor:default; }

        .node-card-header {
          display:flex; align-items:center; justify-content:space-between;
          padding:14px 16px 10px;
          border-bottom:1px solid var(--border-subtle-color);
        }
        .node-name { display:flex; align-items:center; gap:8px; flex-wrap:wrap; min-width:0; }
        .dot { width:8px; height:8px; border-radius:50%; flex-shrink:0; }
        .hostname { font-weight:700; font-size:.95rem; }

        .profile-tag {
          font-size:.65rem; font-weight:700; text-transform:uppercase; letter-spacing:.05em;
          padding:2px 7px; border-radius:999px;
          background:color-mix(in srgb,var(--primary-color) 15%,transparent);
          color:var(--primary-color);
          border:1px solid color-mix(in srgb,var(--primary-color) 30%,transparent);
        }

        .node-card-body {
          padding:12px 16px;
          display:flex; flex-direction:column; gap:6px;
        }
        .node-meta { display:flex; align-items:baseline; gap:8px; font-size:.82rem; }
        .meta-label {
          min-width:72px; font-size:.72rem; font-weight:600; text-transform:uppercase;
          letter-spacing:.05em; color:var(--secondary-text-color); flex-shrink:0;
        }
        .meta-value { color:var(--on-surface-color); }
        .meta-value.mono { font-family:monospace; font-size:.8rem; }
        .meta-value.ok  { color:var(--success-color); }
        .meta-value.warn { color:#f59e0b; }
        .meta-value.err  { color:var(--error-color); }

        /* drift section */
        .node-drift {
          border-top:1px solid var(--border-subtle-color);
          padding:12px 16px;
        }
        .drift-header {
          font-size:.7rem; font-weight:700; text-transform:uppercase;
          letter-spacing:.07em; color:var(--secondary-text-color); margin-bottom:8px;
        }
        .drift-row {
          display:flex; flex-direction:column; gap:3px;
          padding:8px 0; border-bottom:1px solid var(--border-subtle-color);
          font-size:.8rem;
        }
        .drift-row:last-child { border-bottom:none; padding-bottom:0; }
        .drift-entity { font-weight:700; font-size:.85rem; }
        .drift-cat {
          font-size:.72rem; color:var(--secondary-text-color); text-transform:uppercase;
          letter-spacing:.04em;
        }
        .drift-vals { display:flex; flex-direction:column; gap:2px; margin-top:3px; }
        .drift-kv { display:flex; align-items:baseline; gap:6px; }
        .drift-kv-label {
          min-width:48px; font-size:.7rem; font-weight:600; text-transform:uppercase;
          letter-spacing:.04em; color:var(--secondary-text-color);
        }
        code {
          font-family:monospace; font-size:.78rem;
          background:color-mix(in srgb,var(--primary-color) 8%,transparent);
          padding:1px 5px; border-radius:4px;
          word-break:break-all;
        }

        /* capabilities row */
        .caps-row {
          display:flex; flex-wrap:wrap; gap:12px; padding:10px 16px;
          border-top:1px solid var(--border-subtle-color);
          font-size:.78rem; color:var(--secondary-text-color);
        }
        .caps-item { display:flex; align-items:center; gap:4px; white-space:nowrap; }
        .caps-icon { font-size:.9em; opacity:.7; }
        .caps-disk-bar {
          display:inline-block; width:40px; height:5px;
          background:var(--border-subtle-color); border-radius:3px;
          overflow:hidden; vertical-align:middle; margin:0 3px;
        }
        .caps-disk-used {
          display:block; height:100%; border-radius:3px;
          background:color-mix(in srgb,var(--primary-color) 60%,transparent);
          transition:width .3s;
        }
        .caps-disk-free { font-size:.72rem; }

        /* toggle button */
        .node-toggle {
          width:100%; padding:8px; border:none; border-top:1px solid var(--border-subtle-color);
          background:transparent; color:var(--secondary-text-color);
          font-size:.75rem; font-weight:600; cursor:pointer; letter-spacing:.04em;
          transition: background .1s;
        }
        .node-toggle:hover { background:var(--surface-elevated-color); color:var(--on-surface-color); }

        /* misc */
        .empty-msg {
          color:var(--secondary-text-color); font-size:.85rem; font-style:italic; margin:0;
        }
        .unavail-banner {
          background:color-mix(in srgb,#f59e0b 10%,transparent);
          border:1px solid color-mix(in srgb,#f59e0b 35%,transparent);
          border-radius:8px; padding:12px 16px; font-size:.85rem; color:#b45309; line-height:1.6;
        }
        [data-theme="dark"] .unavail-banner { color:#fbbf24; }
      </style>

      <div class="topo">

        <!-- Header -->
        <div class="topo-header">
          <h2>Cluster Topology</h2>
          <span class="topo-ts">Updated ${now}</span>
          <button class="btn-refresh" id="btnRefresh">↻ Refresh</button>
        </div>

        ${this._loading ? `<div class="empty-msg">Loading topology data…</div>` : ''}

        ${this._nodesError ? `
        <div class="unavail-banner">
          ⚠ ${this._nodesError}
        </div>` : ''}

        <!-- Summary stats -->
        ${!this._nodesError ? `
        <div class="stat-grid">
          <div class="stat-card">
            <div class="label">Nodes</div>
            <div class="value">${this._nodes.length}</div>
          </div>
          <div class="stat-card">
            <div class="label">Healthy</div>
            <div class="value" style="color:var(--success-color)">${healthyCount}</div>
          </div>
          <div class="stat-card">
            <div class="label">Degraded</div>
            <div class="value" style="color:${degradedCount > 0 ? '#f59e0b' : 'inherit'}">${degradedCount}</div>
          </div>
          <div class="stat-card">
            <div class="label">Drift Items</div>
            <div class="value" style="color:${totalDrift > 0 ? '#f59e0b' : 'var(--success-color)'}">${totalDrift}</div>
          </div>
        </div>` : ''}

        <!-- Node cards -->
        <div class="node-grid">
          ${this._nodes.length === 0 && !this._loading && !this._nodesError
            ? `<p class="empty-msg">No nodes registered in this cluster.</p>`
            : this._nodes.map(n => this.renderNodeCard(n)).join('')}
        </div>

      </div>
    `

    this.querySelector('#btnRefresh')?.addEventListener('click', () => this.load())

    // Wire up toggle buttons (stop propagation so card click doesn't double-fire)
    this.querySelectorAll<HTMLButtonElement>('.node-toggle').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation()
        const nodeId = btn.dataset.nodeId!
        this._expandedNode = this._expandedNode === nodeId ? null : nodeId
        this.render()
      })
    })

    // Card click also toggles
    this.querySelectorAll<HTMLElement>('.node-card').forEach(card => {
      card.addEventListener('click', () => {
        const nodeId = card.dataset.nodeId!
        this._expandedNode = this._expandedNode === nodeId ? null : nodeId
        this.render()
      })
    })
  }
}

customElements.define('page-cluster-topology', PageClusterTopology)
