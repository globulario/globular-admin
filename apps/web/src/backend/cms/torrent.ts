// src/backend/torrent.ts
// Unified, typed wrapper for the Torrent service (accounts.ts style)

/* ------------------------------------------------------------------
 * Core deps (same helpers used by accounts.ts/files.ts)
 * ------------------------------------------------------------------ */
import { getBaseUrl } from "../core/endpoints"
import { unary, stream } from "../core/rpc"

// ---- Generated stubs (adjust paths if needed) ----
import { TorrentServiceClient } from "globular-web-client/torrent/torrent_grpc_web_pb"
import * as tp from "globular-web-client/torrent/torrent_pb"

/* ------------------------------------------------------------------
 * Internals
 * ------------------------------------------------------------------ */
function clientFactory(): TorrentServiceClient {
  const base = getBaseUrl() ?? ""
  return new TorrentServiceClient(base, null, { withCredentials: true })
}

async function meta(): Promise<Record<string, string>> {
  try {
    const t = sessionStorage.getItem("__globular_token__")
    return t ? { token: t } : {}
  } catch {
    return {}
  }
}

function pickMethod(client: any, candidates: ReadonlyArray<string>): string {
  for (const m of candidates) if (typeof client[m] === "function") return m
  return candidates[0]
}

function newRq(names: readonly string[]): any {
  for (const n of names) {
    const Ctor: any = (tp as any)[n]
    if (Ctor) return new Ctor()
  }
  return {}
}

/* ------------------------------------------------------------------
 * API
 * ------------------------------------------------------------------ */

/** Fetch the list of known torrent links (server-side registry). */
export async function getTorrentLinks(): Promise<any> {
  const md = await meta()
  const rq = newRq(["GetTorrentLnksRequest"])
  const method = pickMethod(clientFactory(), ["getTorrentLnks"])
  return unary(clientFactory, method, rq, undefined, md)
}

/**
 * Stream torrent infos (progress). Returns a cancel function.
 * onBatch is called with the protobuf response (use rsp.getInfosList()).
 */
export async function streamTorrentInfos(
  onBatch: (rsp: any) => void,
  onError?: (err: any) => void,
  onEnd?: () => void
): Promise<() => void> {
  const md = await meta()
  const rq = newRq(["GetTorrentInfosRequest"])
  const method = pickMethod(clientFactory(), ["getTorrentInfos"])

  const stop = await stream(
    clientFactory,
    method,
    rq,
    (msg: any) => onBatch?.(msg),
    "torrent.TorrentService",
    md,
    onError,
    onEnd
  )
  return stop
}

/** Drop/remove an active torrent by its name. */
export async function dropTorrent(name: string): Promise<void> {
  const md = await meta()
  const rq = newRq(["DropTorrentRequest"])
  if (typeof rq.setName === "function") rq.setName(name)
  else rq.name = name
  const method = pickMethod(clientFactory(), ["dropTorrent"])
  await unary(clientFactory, method, rq, undefined, md)
}

