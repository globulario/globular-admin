// packages/backend/src/core/services.ts
// ServicesManagerService has been removed from Globular.
// Service instance discovery is now done via ClusterController plans.
// See packages/backend/src/cluster/cluster.ts → getNodePlan(), DesiredServiceVM, NodeServicePlan.

/**
 * Previously returned all registered RPC action names from ServicesManager.
 * That service no longer exists; returns empty array so callers don't break.
 */
export async function listActions(): Promise<string[]> {
  return []
}
