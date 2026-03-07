// src/pages/infrastructure_storage.ts
import {
  fetchAdminStorage, fetchAdminServices,
  queryPrometheus, type PromQueryResponse,
  type StorageResponse, type ServicesResponse,
  type MountInfo, type ApplicationPath,
} from '@globular/backend'

import {
  INFRA_STYLES, badge, stateBadge, stateColor, esc,
  fmtBytes, fmtPct, fmtTime, fmtRate, freshnessBadge, externalHost,
  type HealthState,
} from '../utils/infra_health'

const POLL = 30_000

function appStatus(a: ApplicationPath): HealthState {
  if (!a.exists) return 'critical'
  if (!a.writable) return 'degraded'
  if (a.status === 'healthy') return 'healthy'
  if (a.status === 'at_risk') return 'degraded'
  return 'critical'
}

function mountColor(m: MountInfo): string {
  if (m.status === 'critical') return 'var(--error-color)'
  if (m.status === 'degraded') return '#f59e0b'
  return '#22c55e'
}

interface MinioMetrics {
  usedBytes: number
  totalObjects: number
  bucketCount: number
  capacityTotalBytes: number
  capacityFreeBytes: number
  s3RequestRate: { api: string; rate: number }[]
  s3ErrorRate: number
  sidekickRequests: number
  sidekickErrors: number
  sidekickRxBytes: number
  sidekickTxBytes: number
}

interface ScyllaMetrics {
  readRate: number
  writeRate: number
  readFailRate: number
  writeFailRate: number
  cacheUsedBytes: number
  cacheTotalBytes: number
  cacheMissRatio: number | null
  memAllocated: number
  memFree: number
  totalDiskBytes: number
  totalSSTables: number
  compactionsActive: number
  compactionsPending: number
  readLatencyP99: { group: string; value: number }[]
  topDiskUsage: { keyspace: string; table: string; bytes: number }[]
  topWriteRate: { keyspace: string; table: string; rate: number }[]
  sstableCounts: { keyspace: string; table: string; count: number }[]
  shardImbalance: number | null
}

class PageInfrastructureStorage extends HTMLElement {
  private _timer: number | null = null
  private _lastUpdated: Date | null = null
  private _storage: StorageResponse | null = null
  private _services: ServicesResponse | null = null
  private _minio: MinioMetrics | null = null
  private _minioAvailable = true
  private _minioRetryAt = 0  // timestamp to retry after unavailable
  private _scylla: ScyllaMetrics | null = null
  private _scyllaAvailable = true  // false if Scylla queries return nothing
  private _tab: 'overview' | 'minio' | 'scylladb' | 'mounts' = 'overview'

  connectedCallback() {
    this.style.display = 'block'
    this.innerHTML = `
      <style>${INFRA_STYLES}</style>
      <section class="wrap">
        <header class="infra-header">
          <h2>Storage</h2>
          <div class="spacer"></div>
          <span id="stTimestamp" class="infra-timestamp"></span>
          <span id="stFreshness"></span>
          <button id="stRefresh" class="infra-btn">&#8635; Refresh</button>
        </header>
        <p style="font:var(--md-typescale-body-medium);color:var(--secondary-text-color);margin:0 0 16px">
          Disk mounts, application data stores, and capacity.
        </p>
        <div class="infra-tabs" id="stTabs">
          <button class="infra-tab active" data-tab="overview">Overview</button>
          <button class="infra-tab" data-tab="minio">MinIO</button>
          <button class="infra-tab" data-tab="scylladb">ScyllaDB</button>
          <button class="infra-tab" data-tab="mounts">Mounts</button>
        </div>
        <div id="stContent"></div>
      </section>
    `
    this.querySelector('#stRefresh')?.addEventListener('click', () => this.load())
    this.querySelectorAll<HTMLElement>('.infra-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        this._tab = btn.dataset.tab as typeof this._tab
        this.querySelectorAll('.infra-tab').forEach(b => b.classList.remove('active'))
        btn.classList.add('active')
        this.renderContent()
      })
    })
    this.load()
    this._timer = window.setInterval(() => this.load(), POLL)
  }

  disconnectedCallback() {
    if (this._timer) clearInterval(this._timer)
  }

  private async load() {
    const [stR, svcR] = await Promise.allSettled([
      fetchAdminStorage(),
      fetchAdminServices(),
    ])
    this._storage  = stR.status  === 'fulfilled' ? stR.value  : null
    this._services = svcR.status === 'fulfilled' ? svcR.value : null
    this._lastUpdated = new Date()

    // Retry MinIO after 60s if previously unavailable
    if (!this._minioAvailable && Date.now() > this._minioRetryAt) {
      this._minioAvailable = true
    }
    const [minioResult, scyllaResult] = await Promise.allSettled([
      this._minioAvailable ? this.loadMinioMetrics() : Promise.resolve(null),
      this._scyllaAvailable ? this.loadScyllaMetrics() : Promise.resolve(null),
    ])
    this._minio = minioResult.status === 'fulfilled' ? minioResult.value : null
    this._scylla = scyllaResult.status === 'fulfilled' ? scyllaResult.value : null

    this.render()
  }

  private async loadMinioMetrics(): Promise<MinioMetrics | null> {
    const [usedRes, objRes, bucketRes, capTotalRes, capFreeRes, reqRateRes, errRateRes, skReqRes, skErrRes, skRxRes, skTxRes] = await Promise.allSettled([
      queryPrometheus('minio_cluster_usage_total_bytes'),
      queryPrometheus('minio_cluster_usage_object_total'),
      queryPrometheus('minio_cluster_bucket_total'),
      queryPrometheus('minio_cluster_capacity_usable_total_bytes'),
      queryPrometheus('minio_cluster_capacity_usable_free_bytes'),
      queryPrometheus('sum by (api)(rate(minio_s3_requests_total[5m]))'),
      queryPrometheus('sum(rate(minio_s3_requests_errors_total[5m]))'),
      queryPrometheus('sidekick_requests_total'),
      queryPrometheus('sidekick_errors_total'),
      queryPrometheus('sidekick_rx_bytes_total'),
      queryPrometheus('sidekick_tx_bytes_total'),
    ])

    const used = usedRes.status === 'fulfilled' ? usedRes.value : null
    const obj = objRes.status === 'fulfilled' ? objRes.value : null
    const bucket = bucketRes.status === 'fulfilled' ? bucketRes.value : null
    const capTotal = capTotalRes.status === 'fulfilled' ? capTotalRes.value : null
    const capFree = capFreeRes.status === 'fulfilled' ? capFreeRes.value : null
    const reqRate = reqRateRes.status === 'fulfilled' ? reqRateRes.value : null
    const errRate = errRateRes.status === 'fulfilled' ? errRateRes.value : null
    const skReq = skReqRes.status === 'fulfilled' ? skReqRes.value : null
    const skErr = skErrRes.status === 'fulfilled' ? skErrRes.value : null
    const skRx = skRxRes.status === 'fulfilled' ? skRxRes.value : null
    const skTx = skTxRes.status === 'fulfilled' ? skTxRes.value : null

    const valOrZero = (r: PromQueryResponse | null) => r?.result?.[0] ? parseFloat(r.result[0].value[1]) || 0 : 0

    // If no MinIO cluster data and no sidekick data, retry after 60s
    if (!used?.result?.length && !obj?.result?.length && !skReq?.result?.length) {
      this._minioAvailable = false
      this._minioRetryAt = Date.now() + 60_000
      return null
    }

    const s3RequestRate = (reqRate?.result ?? [])
      .map(m => ({ api: m.metric.api || 'unknown', rate: parseFloat(m.value[1]) || 0 }))
      .filter(x => x.rate > 0)
      .sort((a, b) => b.rate - a.rate)

    return {
      usedBytes: valOrZero(used),
      totalObjects: valOrZero(obj),
      bucketCount: valOrZero(bucket),
      capacityTotalBytes: valOrZero(capTotal),
      capacityFreeBytes: valOrZero(capFree),
      s3RequestRate,
      s3ErrorRate: valOrZero(errRate),
      sidekickRequests: valOrZero(skReq),
      sidekickErrors: valOrZero(skErr),
      sidekickRxBytes: valOrZero(skRx),
      sidekickTxBytes: valOrZero(skTx),
    }
  }

  private async loadScyllaMetrics(): Promise<ScyllaMetrics | null> {
    const queries = [
      queryPrometheus('topk(10, histogram_quantile(0.99, rate(scylla_storage_proxy_coordinator_read_latency_bucket[5m])))'),
      queryPrometheus('sum(rate(scylla_cache_row_hits[5m]))'),
      queryPrometheus('sum(rate(scylla_cache_row_misses[5m]))'),
      queryPrometheus('topk(10, scylla_column_family_live_disk_space_used)'),
      queryPrometheus('topk(10, rate(scylla_column_family_memtable_switch[5m]))'),
      queryPrometheus('topk(10, scylla_column_family_live_ss_table_count)'),
      queryPrometheus('max by (shard)(rate(scylla_cache_row_hits[5m]))'),
      queryPrometheus('min by (shard)(rate(scylla_cache_row_hits[5m]))'),
      // New: throughput, cache, memory, disk, compactions
      queryPrometheus('sum(rate(scylla_database_total_reads[5m]))'),
      queryPrometheus('sum(rate(scylla_database_total_writes[5m]))'),
      queryPrometheus('sum(rate(scylla_database_total_reads_failed[5m]))'),
      queryPrometheus('sum(rate(scylla_database_total_writes_failed[5m]))'),
      queryPrometheus('scylla_cache_bytes_used'),
      queryPrometheus('scylla_cache_bytes_total'),
      queryPrometheus('scylla_memory_allocated_memory'),
      queryPrometheus('scylla_memory_free_memory'),
      queryPrometheus('sum(scylla_column_family_live_disk_space)'),
      queryPrometheus('sum(scylla_column_family_live_sstable)'),
      queryPrometheus('scylla_compaction_manager_compactions'),
      queryPrometheus('scylla_compaction_manager_pending_compactions'),
    ]

    const results = await Promise.allSettled(queries)
    const val = (i: number) => results[i].status === 'fulfilled' ? (results[i] as PromiseFulfilledResult<PromQueryResponse | null>).value : null
    const numVal = (i: number) => {
      const r = val(i)
      return r?.result?.[0] ? parseFloat(r.result[0].value[1]) || 0 : 0
    }

    const lat = val(0), hits = val(1), misses = val(2), disk = val(3), writes = val(4), sst = val(5)
    const shardMax = val(6), shardMin = val(7)

    // If no Scylla data at all, mark as unavailable
    if (!lat?.result?.length && !disk?.result?.length && !sst?.result?.length && !val(8)?.result?.length) {
      this._scyllaAvailable = false
      return null
    }

    const extractTable = (r: PromQueryResponse | null): { keyspace: string; table: string; value: number }[] => {
      if (!r?.result) return []
      return r.result
        .map(m => ({
          keyspace: m.metric.ks || m.metric.keyspace || '',
          table: m.metric.cf || m.metric.table || '',
          value: parseFloat(m.value[1]) || 0,
        }))
        .filter(x => x.value > 0)
        .sort((a, b) => b.value - a.value)
        .slice(0, 10)
    }

    const extractLatency = (r: PromQueryResponse | null): { group: string; value: number }[] => {
      if (!r?.result) return []
      return r.result
        .map(m => ({
          group: m.metric.scheduling_group_name || m.metric.ks || m.metric.keyspace || 'unknown',
          value: (parseFloat(m.value[1]) || 0) / 1e6,  // µs → ms
        }))
        .filter(x => x.value > 0 && isFinite(x.value))
        .sort((a, b) => b.value - a.value)
        .slice(0, 10)
    }

    const hitVal = numVal(1), missVal = numVal(2)
    const total = hitVal + missVal
    const cacheMissRatio = total > 0 ? missVal / total : null

    const maxV = shardMax?.result?.[0] ? parseFloat(shardMax.result[0].value[1]) || 0 : 0
    const minV = shardMin?.result?.[0] ? parseFloat(shardMin.result[0].value[1]) || 0 : 0
    const shardImbalance = minV > 0 ? maxV / minV : null

    return {
      readRate: numVal(8),
      writeRate: numVal(9),
      readFailRate: numVal(10),
      writeFailRate: numVal(11),
      cacheUsedBytes: numVal(12),
      cacheTotalBytes: numVal(13),
      cacheMissRatio,
      memAllocated: numVal(14),
      memFree: numVal(15),
      totalDiskBytes: numVal(16),
      totalSSTables: numVal(17),
      compactionsActive: numVal(18),
      compactionsPending: numVal(19),
      readLatencyP99: extractLatency(lat),
      topDiskUsage: extractTable(disk).map(x => ({ keyspace: x.keyspace, table: x.table, bytes: x.value })),
      topWriteRate: extractTable(writes).map(x => ({ keyspace: x.keyspace, table: x.table, rate: x.value })),
      sstableCounts: extractTable(sst).map(x => ({ keyspace: x.keyspace, table: x.table, count: Math.round(x.value) })),
      shardImbalance,
    }
  }

  private render() {
    const tsEl = this.querySelector('#stTimestamp') as HTMLElement
    if (tsEl && this._lastUpdated) tsEl.textContent = `Last updated: ${fmtTime(this._lastUpdated)}`
    const freshEl = this.querySelector('#stFreshness') as HTMLElement
    if (freshEl) freshEl.innerHTML = freshnessBadge(this._lastUpdated?.getTime() ?? null, POLL)

    this.renderContent()
  }

  private renderContent() {
    const el = this.querySelector('#stContent') as HTMLElement
    if (!el) return
    switch (this._tab) {
      case 'overview': el.innerHTML = this.buildOverview(); break
      case 'minio':    el.innerHTML = this.buildMinio(); break
      case 'scylladb': el.innerHTML = this.buildScylla(); break
      case 'mounts':   el.innerHTML = this.buildMounts(); break
    }
  }

  private buildOverview(): string {
    const s = this._storage
    if (!s) return `<div class="infra-empty">Loading storage data&hellip;</div>`

    const totalDisk = s.mounts.reduce((a, m) => a + m.total_bytes, 0)
    const usedDisk = s.mounts.reduce((a, m) => a + m.used_bytes, 0)
    const usedPct = totalDisk > 0 ? (usedDisk / totalDisk) * 100 : 0
    const healthyApps = s.applications.filter(a => a.exists && a.writable).length
    const overallState: HealthState = s.derived_status === 'healthy' ? 'healthy' : s.derived_status === 'degraded' ? 'degraded' : 'critical'

    const infra = this._services?.infra ?? {}
    const host = externalHost()

    const appsHtml = s.applications.length === 0 ? '' : `
      <div class="infra-section-title">Application Data Stores</div>
      <div class="infra-grid">
        ${s.applications.map(a => {
          const state = appStatus(a)
          const etcdInfo = a.name.toLowerCase() === 'etcd' && infra['etcd']
            ? `<div class="infra-card-metric">
                Leader: ${infra['etcd'].etcd_is_leader ? 'Yes' : 'No'}
                &middot; DB: ${fmtBytes(infra['etcd'].etcd_db_size_bytes ?? 0)}
                &middot; Keys: ${(infra['etcd'].etcd_total_keys ?? 0).toLocaleString()}
              </div>`
            : ''
          const minioLink = a.name.toLowerCase() === 'minio'
            ? `<div style="margin-top:6px"><a class="infra-link" href="http://${host}:9001" target="_blank" rel="noopener">Open Console &rarr;</a></div>`
            : ''
          return `
            <div class="infra-card" style="border-left:4px solid ${stateColor(state)}">
              <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">
                <span style="font-weight:700;font-size:.88rem">${esc(a.name)}</span>
                <div style="flex:1"></div>
                ${stateBadge(state)}
              </div>
              <div style="font-size:.78rem;color:var(--secondary-text-color);font-family:monospace;word-break:break-all">${esc(a.path)}</div>
              <div style="display:flex;gap:8px;margin-top:6px">
                ${badge(a.exists ? 'EXISTS' : 'MISSING', a.exists ? '#22c55e' : 'var(--error-color)')}
                ${a.exists ? badge(a.writable ? 'WRITABLE' : 'READ-ONLY', a.writable ? '#22c55e' : '#f59e0b') : ''}
                ${a.size_bytes != null ? `<span style="font-size:.78rem;color:var(--secondary-text-color)">${fmtBytes(a.size_bytes)}</span>` : ''}
              </div>
              ${etcdInfo}
              ${minioLink}
            </div>
          `
        }).join('')}
      </div>
    `

    return `
      <div class="infra-grid">
        <div class="infra-card" style="border-left:4px solid ${stateColor(overallState)}">
          <div class="infra-card-label">Overall Status</div>
          <div style="margin:6px 0">${stateBadge(overallState)}</div>
          <div class="infra-card-sub">${s.reasons?.length ? esc(s.reasons[0]) : 'All checks passed'}</div>
        </div>
        <div class="infra-card">
          <div class="infra-card-label">Disk Capacity</div>
          <div class="infra-card-value">${fmtPct(usedPct)}</div>
          <div class="infra-card-sub">${fmtBytes(usedDisk)} / ${fmtBytes(totalDisk)}</div>
          <div class="infra-progress-bar" style="margin-top:6px">
            <div class="infra-progress-fill" style="width:${usedPct.toFixed(1)}%;background:${usedPct > 90 ? 'var(--error-color)' : usedPct > 75 ? '#f59e0b' : '#22c55e'}"></div>
          </div>
        </div>
        <div class="infra-card">
          <div class="infra-card-label">App Paths</div>
          <div class="infra-card-value" style="color:${healthyApps === s.applications.length ? '#22c55e' : 'var(--error-color)'}">${healthyApps}/${s.applications.length}</div>
          <div class="infra-card-sub">paths healthy</div>
        </div>
      </div>
      ${appsHtml}
    `
  }

  private buildMinio(): string {
    if (!this._minio) return `<div class="infra-empty">No MinIO metrics available.</div>`
    const m = this._minio

    const totalReqRate = m.s3RequestRate.reduce((a, r) => a + r.rate, 0)
    const errColor = m.s3ErrorRate > 1 ? 'var(--error-color)' : m.s3ErrorRate > 0.1 ? '#f59e0b' : '#22c55e'
    const usedPct = m.capacityTotalBytes > 0 ? (m.usedBytes / m.capacityTotalBytes) * 100 : 0
    const capColor = usedPct > 90 ? 'var(--error-color)' : usedPct > 75 ? '#f59e0b' : '#22c55e'
    const skErrRatio = m.sidekickRequests > 0 ? m.sidekickErrors / m.sidekickRequests : 0
    const skColor = skErrRatio > 0.05 ? 'var(--error-color)' : skErrRatio > 0.01 ? '#f59e0b' : '#22c55e'

    const hasClusterMetrics = m.usedBytes > 0 || m.totalObjects > 0 || m.capacityTotalBytes > 0

    return `
      <div class="infra-section-title">MinIO Object Store</div>
      ${hasClusterMetrics ? `
        <div class="infra-grid">
          <div class="infra-card">
            <div class="infra-card-label">Capacity</div>
            <div class="infra-card-value" style="color:${capColor}">${fmtBytes(m.usedBytes)}</div>
            <div class="infra-card-sub">${fmtBytes(m.usedBytes)} / ${fmtBytes(m.capacityTotalBytes)} (${fmtPct(usedPct)})</div>
            <div class="infra-progress-bar" style="margin-top:6px">
              <div class="infra-progress-fill" style="width:${usedPct.toFixed(1)}%;background:${capColor}"></div>
            </div>
          </div>
          <div class="infra-card">
            <div class="infra-card-label">Objects</div>
            <div class="infra-card-value">${m.totalObjects.toLocaleString()}</div>
            <div class="infra-card-sub">${Math.round(m.bucketCount)} bucket${m.bucketCount !== 1 ? 's' : ''}</div>
          </div>
          <div class="infra-card">
            <div class="infra-card-label">S3 Request Rate</div>
            <div class="infra-card-value">${fmtRate(totalReqRate)}</div>
            <div class="infra-card-sub">req/s (5m avg)</div>
          </div>
          <div class="infra-card">
            <div class="infra-card-label">S3 Error Rate</div>
            <div class="infra-card-value" style="color:${errColor}">${fmtRate(m.s3ErrorRate)}</div>
            <div class="infra-card-sub">errors/s (5m avg)</div>
          </div>
        </div>
      ` : ''}

      ${m.s3RequestRate.length ? `
        <div class="infra-section-title" style="font-size:.72rem;margin-top:12px">S3 Request Rate by API</div>
        <div style="overflow-x:auto">
          <table class="infra-table">
            <thead><tr><th>API Method</th><th>Req/s</th></tr></thead>
            <tbody>${m.s3RequestRate.map(r => `
              <tr>
                <td style="font-family:monospace;font-size:.78rem">${esc(r.api)}</td>
                <td>${fmtRate(r.rate)}</td>
              </tr>
            `).join('')}</tbody>
          </table>
        </div>
      ` : ''}

      <div class="infra-section-title" style="font-size:.72rem;margin-top:12px">Sidekick Proxy</div>
      <div class="infra-grid">
        <div class="infra-card">
          <div class="infra-card-label">Proxy Requests</div>
          <div class="infra-card-value">${m.sidekickRequests.toLocaleString()}</div>
        </div>
        <div class="infra-card">
          <div class="infra-card-label">Proxy Errors</div>
          <div class="infra-card-value" style="color:${skColor}">${m.sidekickErrors.toLocaleString()}</div>
          <div class="infra-card-sub">${fmtPct(skErrRatio * 100)} error ratio</div>
        </div>
        <div class="infra-card">
          <div class="infra-card-label">Throughput</div>
          <div class="infra-card-sub">RX: ${fmtBytes(m.sidekickRxBytes)} &middot; TX: ${fmtBytes(m.sidekickTxBytes)}</div>
        </div>
      </div>
    `
  }

  private buildScylla(): string {
    if (!this._scylla) return `<div class="infra-empty">No ScyllaDB metrics available.</div>`
    const s = this._scylla

    const cacheColor = s.cacheMissRatio === null ? 'var(--secondary-text-color)'
      : s.cacheMissRatio > 0.1 ? 'var(--error-color)'
      : s.cacheMissRatio > 0.02 ? '#f59e0b' : '#22c55e'
    const cachePct = s.cacheMissRatio !== null ? fmtPct(s.cacheMissRatio * 100) : '—'

    const imbalanceColor = s.shardImbalance === null ? 'var(--secondary-text-color)'
      : s.shardImbalance > 2 ? 'var(--error-color)'
      : s.shardImbalance > 1.5 ? '#f59e0b' : '#22c55e'
    const imbalanceLabel = s.shardImbalance !== null ? `${s.shardImbalance.toFixed(2)}x` : '—'

    const cacheUsedPct = s.cacheTotalBytes > 0 ? (s.cacheUsedBytes / s.cacheTotalBytes) * 100 : 0
    const memTotal = s.memAllocated + s.memFree
    const memUsedPct = memTotal > 0 ? (s.memAllocated / memTotal) * 100 : 0
    const failColor = (v: number) => v > 1 ? 'var(--error-color)' : v > 0 ? '#f59e0b' : '#22c55e'

    const tableRow = (ks: string, tbl: string, val: string) =>
      `<tr><td style="font-family:monospace;font-size:.78rem">${esc(ks)}</td><td style="font-family:monospace;font-size:.78rem">${esc(tbl)}</td><td>${val}</td></tr>`

    return `
      <div class="infra-section-title">ScyllaDB Metrics</div>
      <div class="infra-grid">
        <div class="infra-card">
          <div class="infra-card-label">Read Rate</div>
          <div class="infra-card-value">${fmtRate(s.readRate)}</div>
          <div class="infra-card-sub">reads/s &middot; <span style="color:${failColor(s.readFailRate)}">${fmtRate(s.readFailRate)} failed/s</span></div>
        </div>
        <div class="infra-card">
          <div class="infra-card-label">Write Rate</div>
          <div class="infra-card-value">${fmtRate(s.writeRate)}</div>
          <div class="infra-card-sub">writes/s &middot; <span style="color:${failColor(s.writeFailRate)}">${fmtRate(s.writeFailRate)} failed/s</span></div>
        </div>
        <div class="infra-card">
          <div class="infra-card-label">Row Cache</div>
          <div class="infra-card-value" style="color:${cacheColor}">${cachePct}</div>
          <div class="infra-card-sub">${fmtBytes(s.cacheUsedBytes)} / ${fmtBytes(s.cacheTotalBytes)} (${fmtPct(cacheUsedPct)})</div>
          <div class="infra-progress-bar" style="margin-top:6px">
            <div class="infra-progress-fill" style="width:${cacheUsedPct.toFixed(1)}%;background:${cacheColor}"></div>
          </div>
        </div>
        <div class="infra-card">
          <div class="infra-card-label">Memory</div>
          <div class="infra-card-value">${fmtBytes(s.memAllocated)}</div>
          <div class="infra-card-sub">${fmtBytes(s.memAllocated)} / ${fmtBytes(memTotal)} (${fmtPct(memUsedPct)})</div>
          <div class="infra-progress-bar" style="margin-top:6px">
            <div class="infra-progress-fill" style="width:${memUsedPct.toFixed(1)}%;background:${memUsedPct > 90 ? 'var(--error-color)' : memUsedPct > 75 ? '#f59e0b' : '#22c55e'}"></div>
          </div>
        </div>
        <div class="infra-card">
          <div class="infra-card-label">Disk Usage</div>
          <div class="infra-card-value">${fmtBytes(s.totalDiskBytes)}</div>
          <div class="infra-card-sub">${Math.round(s.totalSSTables).toLocaleString()} SSTables</div>
        </div>
        <div class="infra-card">
          <div class="infra-card-label">Compactions</div>
          <div class="infra-card-value">${Math.round(s.compactionsActive)}</div>
          <div class="infra-card-sub">${Math.round(s.compactionsPending)} pending</div>
        </div>
        <div class="infra-card">
          <div class="infra-card-label">Shard Imbalance</div>
          <div class="infra-card-value" style="color:${imbalanceColor}">${imbalanceLabel}</div>
          <div class="infra-card-sub">max/min across shards</div>
        </div>
      </div>

      ${s.readLatencyP99.length ? `
        <div class="infra-section-title" style="font-size:.72rem;margin-top:12px">Read Latency p99</div>
        <div style="overflow-x:auto">
          <table class="infra-table">
            <thead><tr><th>Scheduling Group</th><th>p99 (ms)</th></tr></thead>
            <tbody>${s.readLatencyP99.map(r => `
              <tr>
                <td style="font-family:monospace;font-size:.78rem">${esc(r.group)}</td>
                <td>${r.value < 1 ? r.value.toFixed(3) : r.value.toFixed(1)}</td>
              </tr>
            `).join('')}</tbody>
          </table>
        </div>
      ` : ''}

      ${s.topDiskUsage.length ? `
        <div class="infra-section-title" style="font-size:.72rem;margin-top:12px">Top Tables by Disk Usage</div>
        <div style="overflow-x:auto">
          <table class="infra-table">
            <thead><tr><th>Keyspace</th><th>Table</th><th>Size</th></tr></thead>
            <tbody>${s.topDiskUsage.map(r => tableRow(r.keyspace, r.table, fmtBytes(r.bytes))).join('')}</tbody>
          </table>
        </div>
      ` : ''}

      ${s.topWriteRate.length ? `
        <div class="infra-section-title" style="font-size:.72rem;margin-top:12px">Top Tables by Write Rate</div>
        <div style="overflow-x:auto">
          <table class="infra-table">
            <thead><tr><th>Keyspace</th><th>Table</th><th>Writes/s</th></tr></thead>
            <tbody>${s.topWriteRate.map(r => tableRow(r.keyspace, r.table, fmtRate(r.rate))).join('')}</tbody>
          </table>
        </div>
      ` : ''}

      ${s.sstableCounts.length ? `
        <div class="infra-section-title" style="font-size:.72rem;margin-top:12px">SSTable Count</div>
        <div style="overflow-x:auto">
          <table class="infra-table">
            <thead><tr><th>Keyspace</th><th>Table</th><th>SSTables</th></tr></thead>
            <tbody>${s.sstableCounts.map(r => tableRow(r.keyspace, r.table, r.count.toLocaleString())).join('')}</tbody>
          </table>
        </div>
      ` : ''}
    `
  }

  private buildMounts(): string {
    const s = this._storage
    if (!s || s.mounts.length === 0) return `<div class="infra-empty">No mount data available.</div>`

    return `
      <div class="infra-section-title">Mount Points</div>
      <div style="overflow-x:auto">
        <table class="infra-table">
          <thead>
            <tr>
              <th>Device</th>
              <th>Mount</th>
              <th>FS</th>
              <th>Total</th>
              <th>Used</th>
              <th>Free%</th>
              <th style="min-width:100px">Usage</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            ${s.mounts.map(m => `
              <tr>
                <td style="font-family:monospace;font-size:.78rem">${esc(m.device)}</td>
                <td style="font-family:monospace;font-size:.78rem">${esc(m.mount_point)}</td>
                <td>${esc(m.fs_type)}</td>
                <td>${fmtBytes(m.total_bytes)}</td>
                <td>${fmtBytes(m.used_bytes)}</td>
                <td>${fmtPct(m.free_pct)}</td>
                <td>
                  <div class="infra-progress-bar">
                    <div class="infra-progress-fill" style="width:${m.used_pct.toFixed(1)}%;background:${mountColor(m)}"></div>
                  </div>
                </td>
                <td>${badge(m.status.toUpperCase(), mountColor(m))}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `
  }
}

customElements.define('page-infrastructure-storage', PageInfrastructureStorage)
