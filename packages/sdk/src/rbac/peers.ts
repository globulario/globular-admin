// src/backend/peers.ts
//
// Peer management RPCs (getPeers, registerPeer, etc.) were removed from
// resource.proto. These stubs keep the UI from crashing until the peer
// management UI is updated or removed.

import { getBaseUrl } from '../core/endpoints'

export type PeerVM = {
  hostname?: string
  domain?: string
  externalIpAddress?: string
  localIpAddress?: string
  mac: string
  portHttp?: number
  portHttps?: number
  protocol?: string
  state?: number | string
  actions?: string[]
  typeName?: string
}

export type DiscoveredHost = {
  name: string
  ip: string
  mac: string
  infos?: string
}

type BasicListOptions = string | {
  query?: object | string
  pageSize?: number
  page?: number
  limit?: number
  offset?: number
  options?: object | string
}

type ListResult<T> = T[] & { items: T[]; total: number }

function emptyList<T>(): ListResult<T> {
  const arr: any = []
  arr.items = []
  arr.total = 0
  return arr
}

export function toPeerVM(p: any): PeerVM {
  return { mac: p?.mac ?? '' }
}

export type ListPeersOptions = BasicListOptions
export async function listPeers(_opts: ListPeersOptions = {}): Promise<ListResult<PeerVM>> {
  return emptyList()
}

export type UpsertPeerInput = Partial<PeerVM> & { mac: string }

export async function registerPeer(_input: UpsertPeerInput & { publicKey?: string }): Promise<void> {}
export async function updatePeer(_input: UpsertPeerInput): Promise<void> {}
export async function deletePeer(_mac: string): Promise<void> {}
export async function addPeerActions(_mac: string, _actions: string[]): Promise<void> {}
export async function removePeerAction(_mac: string, _action: string): Promise<void> {}
export async function removePeersAction(_action: string): Promise<void> {}
export async function getPeerApprovalState(_mac: string, _remotePeerAddress: string): Promise<number> { return 0 }
export async function acceptPeer(_mac: string): Promise<void> {}
export async function rejectPeer(_mac: string): Promise<void> {}

export async function getAvailableHosts(): Promise<DiscoveredHost[]> { return [] }
export async function scanPeers(): Promise<DiscoveredHost[]> { return [] }

export async function pingPeer(ip: string): Promise<boolean> {
  try {
    const base = getBaseUrl() || "http://localhost"
    const proto = new URL(base).protocol
    const url = `${proto}//${ip}/config`
    const res = await fetch(url, { method: 'GET', mode: 'cors' })
    return res.ok
  } catch {
    return false
  }
}
