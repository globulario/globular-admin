// packages/backend/src/core/services.ts
// ServicesManagerService has been removed from Globular.
// Service instance discovery is now done via ClusterController plans.
// See packages/backend/src/cluster/cluster.ts → getNodePlan(), DesiredServiceVM, NodeServicePlan.

import { getConfig, getBaseUrl } from "./endpoints"

/**
 * Collect all unique action strings from service Permissions configs.
 * Each service registers its gRPC method paths as permissioned actions
 * in its config (stored in etcd, served via /config).
 */
export async function listActions(): Promise<string[]> {
  try {
    const cfg = await getConfig(getBaseUrl() || "")
    if (!cfg?.Services) return []

    const set = new Set<string>()
    for (const id of Object.keys(cfg.Services)) {
      const svc = cfg.Services[id] as any
      const perms = svc?.Permissions
      if (!Array.isArray(perms)) continue
      for (const p of perms) {
        const action = p?.action
        if (action && typeof action === "string") {
          set.add(action)
        }
      }
    }
    return Array.from(set).sort()
  } catch (e) {
    console.warn("listActions: failed to load service actions from config", e)
    return []
  }
}
