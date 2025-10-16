/*
ORIGINAL FILE CONTENT FOR REFERENCE:
import { Globular } from "globular-web-client";
import { GetPeersRqst, Peer } from "globular-web-client/resource/resource_pb";
import { Backend, generatePeerToken } from "./backend";

export class PeerController {

    private static __peers__: any = {};

    static getPeers(callback: (peers: Peer[]) => void, errorCallback: (err: any) => void, globule: Globular = Backend.globular) {

        generatePeerToken(globule, token => {
            let rqst = new GetPeersRqst
            rqst.setQuery("{}")
            let peers = new Array<Peer>();

            if (globule.resourceService == null) {
                errorCallback({ message: "Resource service not found" });
                return;
            }

            let stream = globule.resourceService.getPeers(rqst, { domain: globule.domain, address: globule.address, token: token });

            // Get the stream and set event on it...
            stream.on("data", (rsp) => {
                peers = peers.concat(rsp.getPeersList());
            });

            stream.on("status", (status) => {
                if (status.code == 0) {
                    callback(peers);
                } else {
                    errorCallback({ message: status.details });
                }
            });
        }, errorCallback);

    }

    static getPeer(id: string, globule: any, callback: (peer: Peer) => void, errorCallback: (err: any) => void) {

        generatePeerToken(globule, token => {
            let rqst = new GetPeersRqst
            rqst.setQuery(`{ id="${id}" }`)
            let peers = new Array<Peer>();

            if (globule.resourceService == null) {
                errorCallback({ message: "Resource service not found" });
                return;
            }

            let stream = globule.resourceService.getPeers(rqst, { domain: globule.domain, address: globule.address, token: token });

            // Get the stream and set event on it...
            stream.on("data", (rsp:any) => {
                peers = peers.concat(rsp.getPeersList());
            });

            stream.on("status", (status:any) => {
                if (status.code == 0) {
                    if (peers.length > 0) {
                        callback(peers[0]);
                    } else {
                        errorCallback({ message: "Peer not found" });
                    }
                } else {
                    errorCallback({ message: status.details });
                }
            });
        }, errorCallback);
    }

}
*/

// src/backend/core/peers.ts
import { getBaseUrl } from '../core/endpoints'
import { unary } from '../core/rpc'

// Generated gRPC-Web client + messages
import { AdminServiceClient } from 'globular-web-client/admin/admin_grpc_web_pb'
import * as adminpb from 'globular-web-client/admin/admin_pb'

export interface DiscoveredHost {
  name: string
  ip: string
  mac: string
  infos?: string
}

// tiny metadata helper (same pattern as auth.ts)
async function metadata(): Promise<Record<string, string>> {
  try {
    const t = sessionStorage.getItem('__globular_token__')
    return t ? { token: t } : {}
  } catch {
    return {}
  }
}

function client(): AdminServiceClient {
  const addr = getBaseUrl() || "" // e.g. "https://your-node.domain"
  return new AdminServiceClient(addr, null, { withCredentials: true })
}

function mapHost(h: any): DiscoveredHost {
  // adapt to your generated pb getters
  const name = typeof h.getName === 'function' ? String(h.getName()) : String(h.name || '')
  const ip   = typeof h.getIp === 'function' ? String(h.getIp())   : String(h.ip || '')
  const mac  = typeof h.getMac === 'function' ? String(h.getMac()) : String(h.mac || '')
  const infos= typeof h.getInfos === 'function' ? h.getInfos()     : h.infos
  return { name: name.split(':')[0], ip, mac, infos }
}

/** Scan the LAN for available hosts via AdminService.GetAvailableHosts */
export async function scanPeers(): Promise<DiscoveredHost[]> {
  // The request class name varies by your generator:
  // Try adminpb.GetAvailableHostsRqst(); if your build exports getAvailableHostsRequest use that.
  const rq = (adminpb as any).GetAvailableHostsRqst
    ? new (adminpb as any).GetAvailableHostsRqst()
    : new (adminpb as any).getAvailableHostsRequest()

  const md = await metadata()

  // Pass a factory function to unary()
  const rsp: any = await unary(client, 'getAvailableHosts', rq, md)

  // Support either list getter or plain field
  const list = typeof rsp.getHostsList === 'function' ? rsp.getHostsList() : (rsp.hosts || [])
  return list.map(mapHost)
}

/** Simple reachability check; you can swap for a gRPC ping later */
export async function pingPeer(ip: string): Promise<boolean> {
  try {
    // a tiny HEAD/GET to a public endpoint is enough to test reachability through the browser
    const baseUrl = getBaseUrl() || "http://localhost"
    const url = `${new URL(baseUrl).protocol}//${ip}/config`
    const res = await fetch(url, { method: 'GET', mode: 'cors' })
    return res.ok
  } catch {
    return false
  }
}

/** (Optional) Register a peer – wire this to your AdminService.RegisterPeer when ready */
export async function registerPeer(ip: string): Promise<void> {
  // Placeholder — adjust to your real RPC once defined
  // const c = client()
  // const rq = new adminpb.RegisterPeerRqst().setIp(ip)
  // const md = await metadata()
  // await unary(c, 'registerPeer', rq, md)
  return
}
