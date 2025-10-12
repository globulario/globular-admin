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

import { stream, unary } from "../core/rpc"
const SERVICE = "resource.ResourceService"
const factory = (addr: string) => new (window as any).ResourceServiceClient?.(addr)

// export async function listPeers() { ... }
// export async function watchPeers(onEvent: (e: any) => void) { ... }
