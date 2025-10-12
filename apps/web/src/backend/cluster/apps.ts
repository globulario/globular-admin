/*
ORIGINAL FILE CONTENT FOR REFERENCE:
import { Application, GetApplicationsRqst, GetApplicationsRsp } from "globular-web-client/resource/resource_pb";
import { Backend } from "./backend";
import { Globular } from "globular-web-client";

export class ApplicationController {

    // keep the map of all applications by id.
    private static __applications__: any = {};

    /**
     * Return the list of all applicaitons informations.
     * @param callback
     * @param errorCallback
     *\/
    static getAllApplicationInfo(
        callback: (infos: Array<any>) => void,
        errorCallback: (err: any) => void,
        globule: Globular = Backend.globular
    ) {

        const rqst = new GetApplicationsRqst();

        if(globule.resourceService == null) {
            errorCallback({ message: "Resource service not found" });
            return;
        }

        const stream = globule.resourceService.getApplications(rqst, {
            domain: globule.domain,
            address: globule.address
        });

        let applications = new Array<Application>();

        stream.on("data", (rsp: GetApplicationsRsp) => {
            applications = applications.concat(rsp.getApplicationsList());
        });

        stream.on("status", (status) => {
            if (status.code === 0) {
                
                for (var i = 0; i < applications.length; i++) {
                    // Keep application info up to date.
                   globule.eventHub.subscribe(`update_application_${applications[i].getId()}_settings_evt`,
                        (uuid: string) => {

                        },
                        (__application_info__: string) => {
                            // Set the icon...
                            let info = JSON.parse(__application_info__)
                            ApplicationController.__applications__[applications[i].getId()] = info;
                            ApplicationController.__applications__[applications[i].getName()] = info;
                        }, false)

                        ApplicationController.__applications__[applications[i].getId()] = applications[i];
                        ApplicationController.__applications__[applications[i].getName()] = applications[i];

                }

                callback(applications);
            } else {
                errorCallback({ message: status.details });
            }
        });
    }

    /**
   * Return application infos 
   * @param id
   *\/
    static getApplicationInfo(id: string): Application {
        // TODO manage application domain... 
        if (id.indexOf("@") != -1) {
            return ApplicationController.__applications__[id.split("@")[0]];
        }
        return  ApplicationController.__applications__[id];
    }

}
*/

import { unary } from "../core/rpc"
const SERVICE = "resource.ResourceService"
const factory = (addr: string) => new (window as any).ResourceServiceClient?.(addr)

// export async function listApps() { ... }
