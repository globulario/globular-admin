// packages/backend/src/metrics/stats.ts
//
// Client-side wrapper for the gateway /stats endpoint.
// Provides TypeScript types mirroring the Go JSON, a fetch helper,
// and a ring buffer for time-series chart data.

// ── Types (mirror Go StatsResponse) ─────────────────────────────────────────

export interface CPUStats {
  count: number
  usagePct: number
  perCore: number[]
}

export interface MemoryStats {
  totalBytes: number
  usedBytes: number
  usedPct: number
}

export interface DiskStats {
  totalBytes: number
  usedBytes: number
  freePct: number
  path: string
}

export interface NetStats {
  rxBytes: number
  txBytes: number
}

export interface GoStats {
  goroutines: number
  heapAllocBytes: number
  gcPauseNs: number
  numGC: number
}

export interface GatewayStats {
  hostname: string
  uptimeSec: number
  cpu: CPUStats
  memory: MemoryStats
  disk: DiskStats
  network: NetStats
  go: GoStats
}

// ── Fetch ───────────────────────────────────────────────────────────────────

export async function fetchGatewayStats(base = ''): Promise<GatewayStats> {
  const res = await fetch(`${base}/stats`)
  if (!res.ok) throw new Error(`/stats: ${res.status} ${res.statusText}`)
  return res.json()
}

// ── Ring buffer for time-series data ────────────────────────────────────────

export interface StatsSnapshot {
  ts: number // epoch seconds
  stats: GatewayStats
}

export class StatsRingBuffer {
  private _buf: StatsSnapshot[] = []
  private _cap: number

  constructor(capacity = 60) {
    this._cap = capacity
  }

  push(stats: GatewayStats): void {
    this._buf.push({ ts: Date.now() / 1000, stats })
    if (this._buf.length > this._cap) this._buf.shift()
  }

  toArray(): StatsSnapshot[] {
    return this._buf.slice()
  }

  latest(): StatsSnapshot | undefined {
    return this._buf[this._buf.length - 1]
  }

  get length(): number {
    return this._buf.length
  }

  /** Extract a uPlot-ready [timestamps[], values[]] pair. */
  series(extractor: (s: GatewayStats) => number): [number[], number[]] {
    const ts: number[] = []
    const vals: number[] = []
    for (const snap of this._buf) {
      ts.push(snap.ts)
      vals.push(extractor(snap.stats))
    }
    return [ts, vals]
  }
}
