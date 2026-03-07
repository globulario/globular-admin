import { unary } from '../core/rpc'
import { grpcWebHostUrl } from '../core/endpoints'
import { metadata } from '../core/auth'
import * as eventGrpc from 'globular-web-client/event/event_grpc_web_pb'
import * as eventPb from 'globular-web-client/event/event_pb'

function eventClient(): eventGrpc.EventServiceClient {
  return new eventGrpc.EventServiceClient(grpcWebHostUrl(), null, { withCredentials: true })
}

// ─── Types ──────────────────────────────────────────────────────────────────

export interface HistoricalEvent {
  name: string
  data: Uint8Array
  /** JSON-decoded data if parseable, else null */
  dataJson: any | null
  /** Unix epoch seconds */
  tsEpoch: number
  sequence: number
}

export interface QueryEventsResult {
  events: HistoricalEvent[]
  latestSequence: number
}

export interface QueryEventsOpts {
  nameFilter?: string
  limit?: number
  afterSequence?: number
}

// ─── API ────────────────────────────────────────────────────────────────────

export async function queryEvents(opts: QueryEventsOpts = {}): Promise<QueryEventsResult> {
  const md = metadata()
  const rq = new eventPb.QueryEventsRequest()
  if (opts.nameFilter) rq.setNameFilter(opts.nameFilter)
  if (opts.limit && opts.limit > 0) rq.setLimit(opts.limit)
  if (opts.afterSequence && opts.afterSequence > 0) rq.setAfterSequence(opts.afterSequence)

  const rsp = await unary<eventPb.QueryEventsRequest, eventPb.QueryEventsResponse>(
    eventClient, 'queryEvents', rq, undefined, md,
  )

  const events: HistoricalEvent[] = (rsp.getEventsList?.() ?? []).map((e: any) => {
    const raw: Uint8Array = e.getData_asU8?.() ?? new Uint8Array(0)
    let dataJson: any = null
    try {
      const text = new TextDecoder().decode(raw)
      dataJson = JSON.parse(text)
    } catch { /* not JSON */ }

    return {
      name: e.getName?.() ?? '',
      data: raw,
      dataJson,
      tsEpoch: e.getTs?.()?.getSeconds?.() ?? 0,
      sequence: e.getSequence?.() ?? 0,
    }
  })

  return {
    events,
    latestSequence: rsp.getLatestSequence?.() ?? 0,
  }
}
