// src/pages/services_instances.ts
//
// Cluster-wide service instances view. Groups services by name with per-node
// instance rows showing hostname, IP, installed version, and unit state.
import {
  getConfig,
  listClusterNodes,
  getClusterHealthV1Full,
  type ServiceDesc,
  type ClusterNode,
  type ClusterHealthV1Result,
  type NodeHealthV1,
} from '@globular/sdk'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function badge(label: string, color: string): string {
  return `<span class="md-badge" style="--badge-color:${color}">${label.toUpperCase()}</span>`
}

function stateBadge(state: string): string {
  const s = (state || '').toLowerCase()
  if (s === 'running' || s === 'active' || s === 'ok')
    return badge(state, 'var(--success-color)')
  if (s === 'failed' || s === 'error' || s === 'unhealthy')
    return badge(state, 'var(--error-color)')
  if (s === 'starting' || s === 'stopping' || s === 'converging')
    return badge(state, '#f59e0b')
  if (s === 'stopped' || s === 'missing')
    return badge(state, 'var(--secondary-text-color)')
  if (state)
    return badge(state, 'var(--secondary-text-color)')
  return `<span style="color:var(--secondary-text-color)">—</span>`
}

function shortHostname(h: string): string {
  // "globule-ryzen.globular.internal" → "globule-ryzen"
  const dot = h.indexOf('.')
  return dot > 0 ? h.substring(0, dot) : h
}

function ago(epochSec: number): string {
  if (!epochSec) return '—'
  const d = Math.floor((Date.now() / 1000) - epochSec)
  if (d < 60) return `${d}s ago`
  if (d < 3600) return `${Math.floor(d / 60)}m ago`
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`
  return `${Math.floor(d / 86400)}d ago`
}

// ─── Data model ──────────────────────────────────────────────────────────────

interface NodeInstance {
  nodeId:    string
  hostname:  string
  ip:        string
  profiles:  string[]
  version:   string   // installed version from heartbeat
  state:     string   // node operational state (ready/unhealthy/converging)
  lastSeen:  number   // epoch seconds
}

interface ServiceGroup {
  name:       string      // canonical service name (e.g. "authentication")
  port:       number
  tls:        boolean
  version:    string      // desired version
  kind:       string      // SERVICE / INFRASTRUCTURE / COMMAND
  instances:  NodeInstance[]
  running:    number      // count of nodes with this service installed
  total:      number      // total eligible nodes
}

// IDs used by cluster control plane — systemd-managed, not service-managed.
const CONTROL_PLANE = new Set([
  'cluster-controller', 'node-agent', 'cluster-doctor',
])

// Infrastructure daemons — not gRPC services, kind = INFRASTRUCTURE.
const INFRA_SERVICES = new Set([
  'etcd', 'scylladb', 'minio', 'envoy', 'xds', 'gateway', 'mcp',
  'prometheus', 'alertmanager', 'node-exporter', 'sidekick',
  'keepalived', 'scylla-manager', 'scylla-manager-agent',
])

// ─── Module-level cache ────────────────────────────────────────────────────────

const _instancesCache: {
  groups: ServiceGroup[]
  cpGroups: ServiceGroup[]
  fetchedAt: number
} = { groups: [], cpGroups: [], fetchedAt: 0 }

// ─── Component ────────────────────────────────────────────────────────────────

class PageServicesInstances extends HTMLElement {
  private _built = false
  private _groups:        ServiceGroup[] = []
  private _cpGroups:      ServiceGroup[] = []
  private _loadError    = ''
  private _loading      = true
  private _expandedSvc  = ''
  private _refreshTimer: number | null = null

  connectedCallback() {
    this.style.display = 'block'
    this._buildShell()
    // Show cached data immediately on remount
    if (_instancesCache.groups.length > 0 || _instancesCache.cpGroups.length > 0) {
      this._groups = _instancesCache.groups
      this._cpGroups = _instancesCache.cpGroups
      this._loading = false
      this._pushData()
    }
    this._load()
    this._refreshTimer = window.setInterval(() => this._load(), 30_000)
  }

  disconnectedCallback() {
    if (this._refreshTimer) clearInterval(this._refreshTimer)
  }

  private _buildShell() {
    if (this._built) return
    this._built = true
    this.innerHTML = `
      <style>
        .si-wrap { padding: 16px; }
        .si-header { display: flex; align-items: center; gap: 12px; margin-bottom: 4px; }
        .si-header h2 { margin: 0; font: var(--md-typescale-headline-small); }
        .si-subtitle { margin: .25rem 0 1rem; opacity: .85; font: var(--md-typescale-body-medium); }
        .si-mono { font-family: monospace; font-size: .8em; color: var(--secondary-text-color); }
        .si-name { font-weight: 600; }
        .si-chevron { font-size: .9rem; color: var(--secondary-text-color); transition: transform .15s; cursor: pointer; }
        .si-chevron.open { transform: rotate(90deg); }
        .si-empty { padding: 14px 16px; font-style: italic; color: var(--secondary-text-color); font-size: .82rem; }
        .si-btn {
          border: 1px solid var(--border-subtle-color);
          background: transparent;
          color: var(--on-surface-color);
          border-radius: var(--md-shape-sm);
          padding: 3px 10px;
          cursor: pointer;
          font-size: .72rem;
        }
        .si-btn:hover { background: var(--md-state-hover); }
        .si-kind {
          display: inline-block;
          font-size: .6rem;
          padding: 1px 5px;
          border-radius: 3px;
          margin-left: 6px;
          vertical-align: middle;
          font-weight: 500;
          color: var(--secondary-text-color);
          border: 1px solid var(--border-subtle-color);
        }
        .si-instance-row td {
          padding: 4px 12px;
          font-size: .8rem;
          background: var(--md-surface-container-lowest);
          border-bottom: 1px solid var(--border-subtle-color);
        }
        .si-instance-row td:first-child { padding-left: 36px; }
        .si-node-chip {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          font-weight: 500;
        }
        .si-node-dot {
          width: 8px; height: 8px; border-radius: 50%;
          display: inline-block;
        }
        .si-node-dot.ready { background: var(--success-color); }
        .si-node-dot.unhealthy { background: var(--error-color); }
        .si-node-dot.converging { background: #f59e0b; }
        .si-node-dot.unknown { background: var(--secondary-text-color); }
        .si-count {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          font-size: .8rem;
          font-family: monospace;
        }
        .si-count-bar {
          display: inline-flex; height: 6px; border-radius: 3px; overflow: hidden; width: 40px;
        }
        .si-count-fill { height: 100%; }
        .si-profiles {
          display: inline-flex; gap: 3px; flex-wrap: wrap;
        }
        .si-profile-chip {
          font-size: .6rem;
          padding: 0 4px;
          border-radius: 3px;
          background: var(--md-surface-container);
          color: var(--secondary-text-color);
        }
        .si-cp-note {
          padding: 10px 14px;
          font-size: .72rem;
          color: var(--secondary-text-color);
          background: var(--md-surface-container-lowest);
          border-top: 1px solid var(--border-subtle-color);
          line-height: 1.5;
        }
      </style>

      <div class="si-wrap">
        <div class="si-header">
          <h2>Service Instances</h2>
          <div style="flex:1"></div>
          <button class="si-btn" id="btnRefresh">↻ Refresh</button>
        </div>
        <p class="si-subtitle">Cluster-wide service instances across all nodes.</p>

        <div data-bind="loading"></div>
        <div data-bind="error"></div>
        <div data-bind="content"></div>
      </div>
    `

    this.querySelector('#btnRefresh')?.addEventListener('click', () => this._load())
  }

  private _set(bind: string, html: string) {
    const el = this.querySelector(`[data-bind="${bind}"]`) as HTMLElement | null
    if (el) el.innerHTML = html
  }

  private async _load() {
    try {
      // Fetch cluster-wide data in parallel.
      const [nodes, healthResult, cfg] = await Promise.all([
        listClusterNodes(),
        getClusterHealthV1Full(),
        getConfig().catch(() => null),
      ])

      this.buildGroups(nodes, healthResult, cfg)
      _instancesCache.groups = this._groups
      _instancesCache.cpGroups = this._cpGroups
      _instancesCache.fetchedAt = Date.now()
      this._loadError = ''
    } catch (e: any) {
      this._loadError = e?.message || 'Could not load cluster data'
      // Keep cached groups visible — do not clear this._groups or this._cpGroups
    }
    this._loading = false
    this._pushData()
  }

  private buildGroups(
    nodes: ClusterNode[],
    healthResult: ClusterHealthV1Result | null,
    cfg: any | null,
  ) {
    // Build node lookup
    const nodeMap = new Map<string, ClusterNode>()
    for (const n of nodes) nodeMap.set(n.nodeId, n)

    // Build per-node installed versions from healthV1
    const nodeHealthMap = new Map<string, NodeHealthV1>()
    if (healthResult) {
      for (const nh of healthResult.nodeHealths) {
        nodeHealthMap.set(nh.nodeId, nh)
      }
    }

    // Build service metadata from gateway config (port, TLS, etc.)
    const svcMeta = new Map<string, ServiceDesc>()
    if (cfg?.Services) {
      for (const s of Object.values(cfg.Services) as ServiceDesc[]) {
        const name = canonicalName(s.Name ?? s.Id ?? '')
        if (name) svcMeta.set(name, s)
      }
    }

    // Collect all service names from the cluster health summary + installed
    const allServices = new Map<string, { desired: string; kind: string }>()
    if (healthResult) {
      for (const svc of healthResult.services) {
        allServices.set(svc.serviceName, {
          desired: svc.desiredVersion,
          kind: svc.kind,
        })
      }
    }
    // Also include services discovered in per-node installedVersions that are
    // not yet in allServices (e.g. bootstrapped services with no desired-state
    // entry, or control-plane services not tracked via the reconciler).
    // Heuristic: CONTROL_PLANE → INFRASTRUCTURE, INFRA_SERVICES → INFRASTRUCTURE,
    // everything else → SERVICE (CLI tools don't have globular-*.service units,
    // so they won't appear here; the only false-positives are rare edge cases).
    for (const nh of nodeHealthMap.values()) {
      for (const svcName of Object.keys(nh.installedVersions ?? {})) {
        if (allServices.has(svcName)) continue
        let kind: string
        if (CONTROL_PLANE.has(svcName) || INFRA_SERVICES.has(svcName)) {
          kind = 'INFRASTRUCTURE'
        } else {
          kind = 'SERVICE'
        }
        allServices.set(svcName, { desired: '', kind })
      }
    }

    // Build grouped view
    const groups: ServiceGroup[] = []
    const cpGroups: ServiceGroup[] = []

    for (const [svcName, info] of allServices) {
      // COMMAND packages (claude, etcdctl, mc, etc.) are CLI tools, not
      // service instances — skip them so they don't clutter the view.
      if (info.kind === 'COMMAND') continue

      const meta = svcMeta.get(svcName)
      const instances: NodeInstance[] = []

      for (const node of nodes) {
        const nh = nodeHealthMap.get(node.nodeId)
        const installed = nh?.installedVersions?.[svcName]
        if (!installed) continue

        instances.push({
          nodeId:   node.nodeId,
          hostname: node.hostname,
          ip:       node.ips?.[0] ?? '',
          profiles: node.profiles,
          version:  installed,
          state:    node.status,
          lastSeen: node.lastSeen,
        })
      }

      const group: ServiceGroup = {
        name:      svcName,
        port:      meta?.Port ?? 0,
        tls:       meta?.TLS ?? true,
        version:   info.desired || instances[0]?.version || '',
        kind:      info.kind,
        instances,
        running:   instances.length,
        total:     nodes.length,
      }

      if (CONTROL_PLANE.has(svcName)) {
        cpGroups.push(group)
      } else {
        groups.push(group)
      }
    }

    groups.sort((a, b) => a.name.localeCompare(b.name))
    cpGroups.sort((a, b) => a.name.localeCompare(b.name))

    this._groups = groups
    this._cpGroups = cpGroups
  }

  private _pushData() {
    this._set('loading', this._loading ? `<p style="padding:14px;font-style:italic;color:var(--secondary-text-color)">Loading…</p>` : '')
    this._set('error', this._loadError ? `<div class="md-banner-warn">⚠ ${this._loadError}</div>` : '')

    // Clear content only when loading with no cache or when errored with no data to show.
    if (this._loading || (this._loadError && this._groups.length === 0 && this._cpGroups.length === 0)) {
      this._set('content', '')
      return
    }

    const totalRunning = this._groups.reduce((n, g) => n + g.running, 0)
    const totalInstances = this._groups.reduce((n, g) => n + g.instances.length, 0)

    this._set('content', `
      <!-- ── Application services ────────────────────────── -->
      <div class="md-panel">
        <div class="md-panel-header">
          <span>Application Services (${this._groups.length} services, ${totalInstances} instances)</span>
          <span>${totalRunning} running across nodes</span>
        </div>
        ${this._groups.length === 0
          ? `<p class="si-empty">No services registered.</p>`
          : `<table class="md-table">
              <thead>
                <tr>
                  <th style="width:24px"></th>
                  <th>Service</th>
                  <th>Port</th>
                  <th>Version</th>
                  <th>Nodes</th>
                  <th>TLS</th>
                </tr>
              </thead>
              <tbody>
                ${this._groups.map(g => this.renderGroupRows(g)).join('')}
              </tbody>
            </table>`
        }
      </div>

      <!-- ── Cluster Control Plane ───────────────────────── -->
      <div class="md-panel">
        <div class="md-panel-header">
          <span>Cluster Control Plane (${this._cpGroups.length})</span>
          <span>systemd-managed</span>
        </div>
        ${this._cpGroups.length === 0
          ? `<p class="si-empty">No control-plane services detected.</p>`
          : `<table class="md-table">
              <thead>
                <tr>
                  <th style="width:24px"></th>
                  <th>Service</th>
                  <th>Port</th>
                  <th>Version</th>
                  <th>Nodes</th>
                  <th>TLS</th>
                </tr>
              </thead>
              <tbody>
                ${this._cpGroups.map(g => this.renderGroupRows(g)).join('')}
              </tbody>
            </table>
            <div class="si-cp-note">
              Control-plane services (NodeAgent, ClusterController, ClusterDoctor) run on
              every node as systemd units. They are not routed through Envoy.
            </div>`
        }
      </div>
    `)

    this.querySelectorAll<HTMLElement>('tr.si-group-row[data-svc]').forEach(el => {
      el.addEventListener('click', () => {
        const svc = el.dataset.svc ?? ''
        this._expandedSvc = this._expandedSvc === svc ? '' : svc
        this._pushData()
      })
    })
  }

  private renderGroupRows(g: ServiceGroup): string {
    const expanded = g.name === this._expandedSvc
    const allOk = g.instances.every(i => i.state === 'ready')
    const countColor = g.instances.length === 0
      ? 'var(--error-color)'
      : allOk ? 'var(--success-color)' : '#f59e0b'
    const fillPct = g.total > 0 ? (g.running / g.total) * 100 : 0

    const kindLabel = g.kind && g.kind !== 'SERVICE'
      ? `<span class="si-kind">${g.kind}</span>` : ''

    const headerRow = `
      <tr class="md-row si-group-row${expanded ? ' expanded' : ''}" data-svc="${g.name}">
        <td><span class="si-chevron${expanded ? ' open' : ''}">›</span></td>
        <td class="si-name">${g.name}${kindLabel}</td>
        <td class="si-mono">${g.port || '—'}</td>
        <td class="si-mono">${g.version || '—'}</td>
        <td>
          <span class="si-count">
            <span class="si-count-bar">
              <span class="si-count-fill" style="width:${fillPct}%;background:${countColor}"></span>
              <span class="si-count-fill" style="width:${100 - fillPct}%;background:var(--border-subtle-color)"></span>
            </span>
            <span style="color:${countColor}">${g.running}/${g.total}</span>
          </span>
        </td>
        <td style="text-align:center">${g.tls ? '✓' : '—'}</td>
      </tr>`

    if (!expanded) return headerRow

    if (g.instances.length === 0) {
      return headerRow + `
        <tr class="si-instance-row">
          <td colspan="6" style="font-style:italic;color:var(--secondary-text-color);padding-left:36px">
            Not installed on any node
          </td>
        </tr>`
    }

    const instanceRows = g.instances.map(inst => {
      const dotClass = inst.state === 'ready' ? 'ready'
        : inst.state === 'unhealthy' ? 'unhealthy'
        : inst.state === 'converging' ? 'converging' : 'unknown'

      const profiles = inst.profiles.map(p =>
        `<span class="si-profile-chip">${p}</span>`
      ).join('')

      return `
        <tr class="si-instance-row">
          <td></td>
          <td>
            <span class="si-node-chip">
              <span class="si-node-dot ${dotClass}"></span>
              ${shortHostname(inst.hostname)}
            </span>
            <span class="si-profiles">${profiles}</span>
          </td>
          <td class="si-mono">${inst.ip}</td>
          <td class="si-mono">${inst.version}</td>
          <td>${stateBadge(inst.state)}</td>
          <td class="si-mono" style="font-size:.7rem">${ago(inst.lastSeen)}</td>
        </tr>`
    }).join('')

    return headerRow + instanceRows
  }
}

// ─── Utilities ────────────────────────────────────────────────────────────────

/** Normalize a proto service name to its canonical form.
 *  "authentication.AuthenticationService" → "authentication"
 *  "ai_executor.AiExecutorService" → "ai-executor"
 */
function canonicalName(name: string): string {
  if (!name) return ''
  // Take the part before the first dot (proto package name)
  let canon = name.includes('.') ? name.split('.')[0] : name
  // Normalize underscores to dashes
  canon = canon.replace(/_/g, '-')
  return canon
}

customElements.define('page-services-instances', PageServicesInstances)
