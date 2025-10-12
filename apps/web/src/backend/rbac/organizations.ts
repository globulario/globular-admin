/*
ORIGINAL FILE CONTENT FOR REFERENCE:

import { GetOrganizationsRqst, Organization } from 'globular-web-client/resource/resource_pb';
import { Globular } from "globular-web-client";
import { Backend, generatePeerToken } from './backend';

export class OrganizationController {
    private static __organizations__: {};

    static getAllOrganizations(callback: (organizations: Organization[]) => void, errorCallback: (err: any) => void, globule: Globular = Backend.globular) {

        let rqst = new GetOrganizationsRqst
        rqst.setQuery("{}")
        let organizations = new Array<Organization>();

        generatePeerToken(globule, token => {

            if (globule.resourceService == null) {
                errorCallback({ message: "Resource service not found" });
                return;
            }

            let stream = globule.resourceService.getOrganizations(rqst, { domain: globule.domain, address: globule.address, token: token });

            // Get the stream and set event on it...
            stream.on("data", (rsp) => {
                organizations = organizations.concat(rsp.getOrganizationsList());
            });

            stream.on("status", (status) => {
                if (status.code == 0) {
                    callback(organizations);
                } else {
                    errorCallback({ message: status.details });
                }
            });
        }, errorCallback)


    }

    static getOrganizationById(id: string, callback: (organization: Organization)=>void, errorCallback: (err: any) => void, globule: Globular = Backend.globular) {
        let rqst = new GetOrganizationsRqst
        rqst.setQuery(`{ id="${id}" }`)
        let organizations = new Array<Organization>();

        generatePeerToken(globule, token => {

            if (globule.resourceService == null) {
                errorCallback({ message: "Resource service not found" });
                return;
            }

            let stream = globule.resourceService.getOrganizations(rqst, { domain: globule.domain, address: globule.address, token: token });

            // Get the stream and set event on it...
            stream.on("data", (rsp) => {
                organizations = organizations.concat(rsp.getOrganizationsList());
            });

            stream.on("status", (status) => {
                if (status.code == 0) {
                    if (organizations.length > 0) {
                        callback(organizations[0]);
                    }else{
                        errorCallback({ message: "Organization not found" });
                    }
                } else {
                    errorCallback({ message: status.details });
                }
            });
        }, errorCallback)
    }

}
*/

import { unary } from "../core/rpc"
const SERVICE = "rbac.RbacService"
const factory = (addr: string) => new (window as any).RbacServiceClient?.(addr, null, { withCredentials: true })

// export async function listOrganizations() { ... }
