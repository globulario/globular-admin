import { grpcWebHostUrl } from '../core/endpoints'
import { metadata } from '../core/auth'
import * as logGrpc from 'globular-web-client/log/log_grpc_web_pb'
import * as logPb from 'globular-web-client/log/log_pb'

function logClient(): logGrpc.LogServiceClient {
  return new logGrpc.LogServiceClient(grpcWebHostUrl(), null, { withCredentials: true })
}

// ─── Types ──────────────────────────────────────────────────────────────────

const LEVEL_LABELS: Record<number, string> = {
  0: 'FATAL',
  1: 'ERROR',
  2: 'WARN',
  3: 'INFO',
  4: 'DEBUG',
  5: 'TRACE',
}

export interface LogEntry {
  id: string
  level: number
  levelLabel: string
  application: string
  method: string
  message: string
  line: string
  occurences: number
  timestampMs: number
  component: string
  fields: Record<string, string>
  nodeId: string
}

export interface QueryLogsOpts {
  level?: string        // "error" | "fatal" | "info" | "debug" | "warn" | "trace" | "*"
  application?: string  // e.g. "dns.DnsService" or "*"
  method?: string
  component?: string
  sinceMs?: number
  untilMs?: number
  limit?: number
  order?: 'asc' | 'desc'
  contains?: string
  node?: string
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function logInfoToEntry(info: any): LogEntry {
  const lvl: number = info.getLevel?.() ?? 3
  const fieldsMap: Record<string, string> = {}
  try {
    const m = info.getFieldsMap?.()
    if (m) {
      m.forEach((v: string, k: string) => { fieldsMap[k] = v })
    }
  } catch { /* no fields */ }

  return {
    id: info.getId?.() ?? '',
    level: lvl,
    levelLabel: LEVEL_LABELS[lvl] ?? 'UNKNOWN',
    application: info.getApplication?.() ?? '',
    method: info.getMethod?.() ?? '',
    message: info.getMessage?.() ?? '',
    line: info.getLine?.() ?? '',
    occurences: info.getOccurences?.() ?? 0,
    timestampMs: info.getTimestampMs?.() ?? 0,
    component: info.getComponent?.() ?? '',
    fields: fieldsMap,
    nodeId: info.getNodeId?.() ?? '',
  }
}

/**
 * Build the URL-style query string for GetLogRqst.
 * Format: /{level}/{application}/*?since=ms&until=ms&limit=N&order=asc|desc&method=X&component=Y&contains=Z
 */
function buildQuery(opts: QueryLogsOpts): string {
  const level = opts.level || '*'
  const app = opts.application || '*'
  let path = `/${level}/${app}/*`

  const params: string[] = []
  if (opts.sinceMs) params.push(`since=${opts.sinceMs}`)
  if (opts.untilMs) params.push(`until=${opts.untilMs}`)
  if (opts.limit && opts.limit > 0) params.push(`limit=${opts.limit}`)
  if (opts.order) params.push(`order=${opts.order}`)
  if (opts.method) params.push(`method=${encodeURIComponent(opts.method)}`)
  if (opts.component) params.push(`component=${encodeURIComponent(opts.component)}`)
  if (opts.contains) params.push(`contains=${encodeURIComponent(opts.contains)}`)
  if (opts.node) params.push(`node=${encodeURIComponent(opts.node)}`)

  if (params.length > 0) path += '?' + params.join('&')
  return path
}

// ─── API ────────────────────────────────────────────────────────────────────

/**
 * Query persisted logs (ERROR/FATAL) via the GetLog server-streaming RPC.
 */
export function queryLogs(opts: QueryLogsOpts = {}): Promise<LogEntry[]> {
  return new Promise((resolve, reject) => {
    const md = metadata()
    const query = buildQuery(opts)
    const rq = new logPb.GetLogRqst()
    rq.setQuery(query)

    const client = logClient()
    const call = client.getLog(rq, md)
    const entries: LogEntry[] = []

    call.on('data', (rsp: any) => {
      const infos = rsp.getInfosList?.() ?? []
      for (const info of infos) {
        entries.push(logInfoToEntry(info))
      }
    })

    call.on('error', (err: any) => {
      if (entries.length > 0) {
        resolve(entries)
      } else {
        reject(err)
      }
    })

    call.on('end', () => {
      resolve(entries)
    })
  })
}

/**
 * Parse a `new_log_evt` JSON payload (protojson-serialized LogInfo) into a LogEntry.
 * Returns null if the payload is not a valid log event.
 * Reused by Live Tail.
 */
export function parseLogEvent(data: any): LogEntry | null {
  if (!data || typeof data !== 'object') return null
  try {
    // The event payload is protojson — field names are snake_case
    const lvl = typeof data.level === 'number' ? data.level : (typeof data.Level === 'number' ? data.Level : 3)
    const fields: Record<string, string> = {}
    const rawFields = data.fields || data.Fields || {}
    if (rawFields && typeof rawFields === 'object') {
      for (const [k, v] of Object.entries(rawFields)) {
        fields[k] = String(v)
      }
    }
    return {
      id: data.id || data.Id || data.ID || '',
      level: lvl,
      levelLabel: LEVEL_LABELS[lvl] ?? 'UNKNOWN',
      application: data.application || data.Application || '',
      method: data.method || data.Method || '',
      message: data.message || data.Message || '',
      line: String(data.line || data.Line || ''),
      occurences: data.occurences || data.Occurences || 0,
      timestampMs: data.timestamp_ms || data.timestampMs || data.TimestampMs || Date.now(),
      component: data.component || data.Component || '',
      fields,
      nodeId: data.node_id || data.nodeId || data.NodeId || '',
    }
  } catch {
    return null
  }
}
