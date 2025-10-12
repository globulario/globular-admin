/*
ORIGINAL FILE CONTENT FOR REFERENCE:



class PermissionController{
    
}
*/

import { unary } from "../core/rpc"
const SERVICE = "rbac.RbacService"
const factory = (addr: string) => new (window as any).RbacServiceClient?.(addr, null, { withCredentials: true })

// export async function getResourcePermissions(path: string) { ... }
// export async function setResourcePermission(...) { ... }
// export async function validateAccess(subject: string, action: string, path: string) { ... }
