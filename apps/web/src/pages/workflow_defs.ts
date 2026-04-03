// src/pages/workflow_defs.ts
// Typed workflow definitions — compiled from golang/workflow/definitions/*.yaml
// These represent the static blueprint of each workflow.

export interface HandlerDef {
  actor: string
  action: string
  title?: string
}

export interface StepDef {
  id: string
  title: string
  actor: string
  action: string
  dependsOn?: string[]
  when?: { expr?: string; anyOf?: string[] }
  foreach?: { collection: string; itemName: string; strategy?: { mode: string; concurrency?: string } }
  steps?: StepDef[]
  retry?: { maxAttempts: number; backoff: string }
  timeout?: string
  export?: string
  onFailure?: HandlerDef
}

export interface WorkflowDef {
  name: string
  displayName: string
  description: string
  steps: StepDef[]
  onFailure?: HandlerDef
  onSuccess?: HandlerDef
}

// ─── Definitions ────────────────────────────────────────────────────────────

export const WORKFLOW_DEFS: WorkflowDef[] = [

  // ── day0.bootstrap ──────────────────────────────────────────────────────
  {
    name: 'day0.bootstrap',
    displayName: 'Cluster Day-0 bootstrap',
    description: 'Day-0 cluster bootstrap: prerequisites, storage, data layer, mesh, control plane, DNS, ops, workloads, CLI, post-install.',
    steps: [
      { id: 'verify_etcd_healthy', title: 'Verify etcd is healthy', actor: 'node-agent', action: 'node.probe_infra_health', retry: { maxAttempts: 30, backoff: '5s' }, timeout: '3m' },
      { id: 'verify_scylla_healthy', title: 'Verify ScyllaDB is healthy', actor: 'node-agent', action: 'node.probe_infra_health', retry: { maxAttempts: 60, backoff: '10s' }, timeout: '12m' },
      { id: 'verify_minio_healthy', title: 'Verify MinIO is healthy', actor: 'node-agent', action: 'node.probe_infra_health', retry: { maxAttempts: 30, backoff: '5s' }, timeout: '3m' },
      { id: 'configure_shared_storage', title: 'Configure MinIO buckets', actor: 'installer', action: 'installer.configure_shared_storage', dependsOn: ['verify_etcd_healthy', 'verify_scylla_healthy', 'verify_minio_healthy'] },
      { id: 'write_bootstrap_credentials', title: 'Write bootstrap credentials', actor: 'installer', action: 'installer.write_bootstrap_credentials', dependsOn: ['verify_etcd_healthy', 'verify_scylla_healthy', 'verify_minio_healthy'] },
      { id: 'install_persistence', title: 'Install persistence', actor: 'installer', action: 'installer.install_package', dependsOn: ['configure_shared_storage', 'write_bootstrap_credentials'] },
      { id: 'install_mesh_services', title: 'Install xDS, Envoy, gateway', actor: 'installer', action: 'installer.install_package_set', dependsOn: ['install_persistence'] },
      { id: 'install_infra_services', title: 'Install controller + doctor', actor: 'installer', action: 'installer.install_package_set', dependsOn: ['install_mesh_services'] },
      { id: 'install_control_plane', title: 'Install resource, RBAC, auth, discovery, DNS, repo', actor: 'installer', action: 'installer.install_package_set', dependsOn: ['install_infra_services'] },
      { id: 'bootstrap_dns', title: 'Create DNS zone + records', actor: 'installer', action: 'installer.bootstrap_dns', dependsOn: ['install_control_plane'] },
      { id: 'install_ops_services', title: 'Install monitoring, event, log, backup, AI, workflow', actor: 'installer', action: 'installer.install_package_set', dependsOn: ['bootstrap_dns'] },
      { id: 'install_workload_services', title: 'Install file, search, media, title, torrent', actor: 'installer', action: 'installer.install_package_set', dependsOn: ['install_ops_services'] },
      { id: 'install_cli_tools', title: 'Install CLI tools', actor: 'installer', action: 'installer.install_package_set', dependsOn: ['install_ops_services'] },
      { id: 'validate_cluster_health', title: 'Validate cluster health', actor: 'installer', action: 'installer.validate_cluster_health', dependsOn: ['install_workload_services', 'install_cli_tools'] },
      { id: 'generate_join_token', title: 'Generate join token', actor: 'installer', action: 'installer.generate_join_token', dependsOn: ['validate_cluster_health'] },
      { id: 'restart_for_join_token', title: 'Restart controller + node-agent', actor: 'installer', action: 'installer.restart_bootstrap_services', dependsOn: ['generate_join_token'] },
      { id: 'bootstrap_first_node', title: 'Register first node + seed desired', actor: 'installer', action: 'installer.cluster_bootstrap', dependsOn: ['restart_for_join_token'] },
      { id: 'publish_bootstrap_artifacts', title: 'Publish bootstrap artifacts', actor: 'repository', action: 'repository.publish_bootstrap_artifacts', dependsOn: ['bootstrap_first_node'] },
      { id: 'import_installed_into_desired', title: 'Seed desired from installed', actor: 'cluster-controller', action: 'controller.seed_desired_from_installed', dependsOn: ['publish_bootstrap_artifacts'] },
      { id: 'stabilize', title: 'Final reconciliation pass', actor: 'cluster-controller', action: 'controller.reconcile_until_stable', dependsOn: ['import_installed_into_desired'], retry: { maxAttempts: 12, backoff: '10s' } },
      { id: 'cleanup_bootstrap', title: 'Disable bootstrap mode', actor: 'installer', action: 'installer.disable_bootstrap_window', dependsOn: ['stabilize'] },
    ],
    onFailure: { actor: 'installer', action: 'installer.capture_bootstrap_failure_bundle' },
    onSuccess: { actor: 'cluster-controller', action: 'controller.emit_cluster_bootstrap_succeeded' },
  },

  // ── node.bootstrap ──────────────────────────────────────────────────────
  {
    name: 'node.bootstrap',
    displayName: 'Node bootstrap',
    description: 'Advances a node from admitted to workload_ready by waiting on profile-specific convergence conditions.',
    steps: [
      { id: 'mark_infra_preparing', title: 'Mark infra_preparing', actor: 'cluster-controller', action: 'controller.bootstrap.set_phase' },
      { id: 'maybe_wait_etcd_unit', title: 'Wait for etcd unit', actor: 'cluster-controller', action: 'controller.bootstrap.wait_condition', when: { anyOf: ["contains(profiles, 'etcd')", "contains(profiles, 'control-plane')"] }, retry: { maxAttempts: 60, backoff: '5s' } },
      { id: 'maybe_wait_etcd_join', title: 'Wait etcd join verified', actor: 'cluster-controller', action: 'controller.bootstrap.wait_condition', dependsOn: ['maybe_wait_etcd_unit'], when: { anyOf: ["contains(profiles, 'etcd')", "contains(profiles, 'control-plane')"] }, retry: { maxAttempts: 60, backoff: '5s' } },
      { id: 'maybe_wait_xds', title: 'Wait xDS active', actor: 'cluster-controller', action: 'controller.bootstrap.wait_condition', dependsOn: ['maybe_wait_etcd_join'], when: { anyOf: ["contains(profiles, 'xds')", "contains(profiles, 'gateway')", "contains(profiles, 'control-plane')"] }, retry: { maxAttempts: 60, backoff: '5s' } },
      { id: 'maybe_wait_envoy', title: 'Wait Envoy active', actor: 'cluster-controller', action: 'controller.bootstrap.wait_condition', dependsOn: ['maybe_wait_xds'], when: { anyOf: ["contains(profiles, 'gateway')", "contains(profiles, 'ingress')", "contains(profiles, 'control-plane')"] }, retry: { maxAttempts: 60, backoff: '5s' } },
      { id: 'maybe_wait_storage', title: 'Wait storage verified', actor: 'cluster-controller', action: 'controller.bootstrap.wait_condition', dependsOn: ['maybe_wait_envoy'], when: { anyOf: ["contains(profiles, 'minio')", "contains(profiles, 'scylla')", "contains(profiles, 'storage')"] }, retry: { maxAttempts: 60, backoff: '5s' } },
      { id: 'mark_workload_ready', title: 'Mark workload_ready', actor: 'cluster-controller', action: 'controller.bootstrap.set_phase', dependsOn: ['maybe_wait_etcd_join', 'maybe_wait_xds', 'maybe_wait_envoy', 'maybe_wait_storage'] },
    ],
    onFailure: { actor: 'cluster-controller', action: 'controller.bootstrap.mark_failed' },
    onSuccess: { actor: 'cluster-controller', action: 'controller.bootstrap.emit_ready' },
  },

  // ── node.join ───────────────────────────────────────────────────────────
  {
    name: 'node.join',
    displayName: 'Day-1 node join',
    description: 'Full Day-1 join: install all packages in dependency-ordered tiers with parallelism.',
    steps: [
      { id: 'verify_prerequisites', title: 'Verify etcd + node-agent', actor: 'node-agent', action: 'node.verify_services_active', retry: { maxAttempts: 6, backoff: '5s' } },
      { id: 'install_mesh', title: 'Install storage + mesh', actor: 'node-agent', action: 'node.install_packages', dependsOn: ['verify_prerequisites'] },
      { id: 'install_envoy', title: 'Install Envoy', actor: 'node-agent', action: 'node.install_packages', dependsOn: ['install_mesh'] },
      { id: 'install_gateway', title: 'Install gateway', actor: 'node-agent', action: 'node.install_packages', dependsOn: ['install_envoy'] },
      { id: 'install_scylladb', title: 'Install ScyllaDB', actor: 'node-agent', action: 'node.install_packages', dependsOn: ['install_envoy'], retry: { maxAttempts: 2, backoff: '30s' } },
      { id: 'wait_scylladb_ready', title: 'Wait ScyllaDB CQL ready', actor: 'node-agent', action: 'node.probe_infra_health', dependsOn: ['install_scylladb'], retry: { maxAttempts: 60, backoff: '10s' } },
      { id: 'install_scylla_tools', title: 'Install ScyllaDB manager', actor: 'node-agent', action: 'node.install_packages', dependsOn: ['wait_scylladb_ready'] },
      { id: 'install_foundational', title: 'Install foundational services', actor: 'node-agent', action: 'node.install_packages', dependsOn: ['wait_scylladb_ready', 'install_gateway'] },
      { id: 'install_workloads', title: 'Install workload services', actor: 'node-agent', action: 'node.install_packages', dependsOn: ['install_foundational'] },
      { id: 'install_commands', title: 'Install CLI tools', actor: 'node-agent', action: 'node.install_packages', dependsOn: ['install_foundational'] },
      { id: 'report_installed', title: 'Sync installed state', actor: 'node-agent', action: 'node.sync_installed_state', dependsOn: ['install_workloads', 'install_scylla_tools', 'install_commands'] },
      { id: 'mark_converged', title: 'Mark node converged', actor: 'cluster-controller', action: 'controller.bootstrap.set_phase', dependsOn: ['report_installed'] },
    ],
    onFailure: { actor: 'cluster-controller', action: 'controller.bootstrap.mark_failed' },
    onSuccess: { actor: 'cluster-controller', action: 'controller.bootstrap.emit_ready' },
  },

  // ── node.repair ─────────────────────────────────────────────────────────
  {
    name: 'node.repair',
    displayName: 'Node repair',
    description: 'Diagnose, isolate and repair a degraded or partially converged node.',
    steps: [
      { id: 'mark_repair_started', title: 'Mark repair started', actor: 'cluster-controller', action: 'controller.node_repair.mark_started' },
      { id: 'diagnose_node', title: 'Collect diagnostic facts', actor: 'node-agent', action: 'node.collect_repair_facts', dependsOn: ['mark_repair_started'], timeout: '5m' },
      { id: 'classify_failure', title: 'Classify failure', actor: 'cluster-controller', action: 'controller.node_repair.classify', dependsOn: ['diagnose_node'] },
      { id: 'maybe_isolate', title: 'Isolate node', actor: 'cluster-controller', action: 'controller.node_repair.isolate_node', dependsOn: ['classify_failure'], when: { expr: 'isolate_first == true' } },
      { id: 'repair_packages', title: 'Repair/reinstall packages', actor: 'node-agent', action: 'node.repair_packages', dependsOn: ['classify_failure', 'maybe_isolate'] },
      { id: 'restart_repaired_services', title: 'Restart repaired services', actor: 'node-agent', action: 'node.restart_repaired_services', dependsOn: ['repair_packages'] },
      { id: 'verify_runtime', title: 'Verify runtime after repair', actor: 'node-agent', action: 'node.verify_repair_runtime', dependsOn: ['restart_repaired_services'], retry: { maxAttempts: 60, backoff: '5s' } },
      { id: 'sync_installed_state', title: 'Sync installed state', actor: 'node-agent', action: 'node.sync_installed_state', dependsOn: ['verify_runtime'] },
      { id: 'rejoin_node', title: 'Re-enable scheduling', actor: 'cluster-controller', action: 'controller.node_repair.rejoin_node', dependsOn: ['sync_installed_state'] },
      { id: 'mark_recovered', title: 'Mark recovered', actor: 'cluster-controller', action: 'controller.node_repair.mark_recovered', dependsOn: ['rejoin_node'] },
    ],
    onFailure: { actor: 'cluster-controller', action: 'controller.node_repair.mark_failed' },
    onSuccess: { actor: 'cluster-controller', action: 'controller.node_repair.emit_recovered' },
  },

  // ── release.apply.package ───────────────────────────────────────────────
  {
    name: 'release.apply.package',
    displayName: 'Apply package release',
    description: 'Generic package rollout for SERVICE/INFRASTRUCTURE/COMMAND packages. Parallel per-node with concurrency control.',
    steps: [
      { id: 'mark_resolved', title: 'Mark release resolved', actor: 'cluster-controller', action: 'controller.release.mark_resolved' },
      { id: 'select_targets', title: 'Select eligible targets', actor: 'cluster-controller', action: 'controller.release.select_package_targets', dependsOn: ['mark_resolved'] },
      { id: 'short_circuit_if_no_targets', title: 'Finalize (no targets)', actor: 'cluster-controller', action: 'controller.release.finalize_noop', dependsOn: ['select_targets'], when: { expr: 'len(selected_targets) == 0' } },
      { id: 'mark_applying', title: 'Mark applying', actor: 'cluster-controller', action: 'controller.release.mark_applying', dependsOn: ['select_targets'], when: { expr: 'len(selected_targets) > 0' } },
      {
        id: 'apply_per_node', title: 'Apply per node', actor: 'cluster-controller', action: '',
        dependsOn: ['mark_applying'], when: { expr: 'len(selected_targets) > 0' },
        foreach: { collection: '$.selected_targets', itemName: 'target', strategy: { mode: 'parallel', concurrency: '$.max_parallel_nodes' } },
        onFailure: { actor: 'cluster-controller', action: 'controller.release.mark_node_failed' },
        steps: [
          { id: 'mark_node_started', title: 'Mark node started', actor: 'cluster-controller', action: 'controller.release.mark_node_started' },
          { id: 'install_package', title: 'Install package', actor: 'node-agent', action: 'node.install_package', dependsOn: ['mark_node_started'] },
          { id: 'verify_installed', title: 'Verify installed', actor: 'node-agent', action: 'node.verify_package_installed', dependsOn: ['install_package'], retry: { maxAttempts: 20, backoff: '5s' } },
          { id: 'maybe_restart', title: 'Maybe restart', actor: 'node-agent', action: 'node.maybe_restart_package', dependsOn: ['verify_installed'], when: { expr: "restart_policy != 'never'" } },
          { id: 'verify_runtime', title: 'Verify runtime', actor: 'node-agent', action: 'node.verify_package_runtime', dependsOn: ['verify_installed', 'maybe_restart'], retry: { maxAttempts: 60, backoff: '5s' } },
          { id: 'sync_installed_state', title: 'Sync installed state', actor: 'node-agent', action: 'node.sync_installed_package_state', dependsOn: ['verify_runtime'] },
          { id: 'mark_node_succeeded', title: 'Mark node succeeded', actor: 'cluster-controller', action: 'controller.release.mark_node_succeeded', dependsOn: ['sync_installed_state'] },
        ],
      },
      { id: 'aggregate_outcome', title: 'Aggregate outcomes', actor: 'cluster-controller', action: 'controller.release.aggregate_direct_apply_results', dependsOn: ['apply_per_node'], when: { expr: 'len(selected_targets) > 0' }, export: 'aggregate' },
      { id: 'finalize_release', title: 'Finalize release', actor: 'cluster-controller', action: 'controller.release.finalize_direct_apply', dependsOn: ['aggregate_outcome'], when: { expr: 'len(selected_targets) > 0' } },
    ],
    onFailure: { actor: 'cluster-controller', action: 'controller.release.mark_failed' },
    onSuccess: { actor: 'cluster-controller', action: 'controller.release.recheck_convergence' },
  },

  // ── release.apply.infrastructure ────────────────────────────────────────
  {
    name: 'release.apply.infrastructure',
    displayName: 'Apply infrastructure release',
    description: 'Infrastructure-specific rollout. Single-node-at-a-time with strict health checks.',
    steps: [
      { id: 'mark_resolved', title: 'Mark release resolved', actor: 'cluster-controller', action: 'controller.release.mark_resolved' },
      { id: 'select_targets', title: 'Select infra targets', actor: 'cluster-controller', action: 'controller.release.select_infrastructure_targets', dependsOn: ['mark_resolved'] },
      { id: 'short_circuit_if_no_targets', title: 'Finalize (no targets)', actor: 'cluster-controller', action: 'controller.release.finalize_noop', dependsOn: ['select_targets'], when: { expr: 'len(selected_targets) == 0' } },
      { id: 'mark_applying', title: 'Mark applying', actor: 'cluster-controller', action: 'controller.release.mark_applying', dependsOn: ['select_targets'], when: { expr: 'len(selected_targets) > 0' } },
      {
        id: 'apply_per_node', title: 'Apply per node (serial)', actor: 'cluster-controller', action: '',
        dependsOn: ['mark_applying'], when: { expr: 'len(selected_targets) > 0' },
        foreach: { collection: '$.selected_targets', itemName: 'target', strategy: { mode: 'parallel', concurrency: '1' } },
        onFailure: { actor: 'cluster-controller', action: 'controller.release.mark_node_failed' },
        steps: [
          { id: 'mark_node_started', title: 'Mark node started', actor: 'cluster-controller', action: 'controller.release.mark_node_started' },
          { id: 'install_package', title: 'Install infra package', actor: 'node-agent', action: 'node.install_package', dependsOn: ['mark_node_started'], export: 'install_result' },
          { id: 'verify_installed', title: 'Verify installed', actor: 'node-agent', action: 'node.verify_package_installed', dependsOn: ['install_package'], retry: { maxAttempts: 20, backoff: '5s' }, export: 'verify_result' },
          { id: 'maybe_restart', title: 'Restart service', actor: 'node-agent', action: 'node.restart_package_service', dependsOn: ['verify_installed'], when: { expr: 'restart_required == true' } },
          { id: 'verify_runtime_health', title: 'Verify runtime health', actor: 'node-agent', action: 'node.verify_package_runtime', dependsOn: ['verify_installed', 'maybe_restart'], retry: { maxAttempts: 60, backoff: '5s' }, export: 'health_result' },
          { id: 'sync_installed_state', title: 'Sync installed state', actor: 'node-agent', action: 'node.sync_installed_package_state', dependsOn: ['verify_runtime_health'], export: 'sync_result' },
          { id: 'mark_node_succeeded', title: 'Mark node succeeded', actor: 'cluster-controller', action: 'controller.release.mark_node_succeeded', dependsOn: ['sync_installed_state'] },
        ],
      },
      { id: 'aggregate_outcome', title: 'Aggregate outcomes', actor: 'cluster-controller', action: 'controller.release.aggregate_direct_apply_results', dependsOn: ['apply_per_node'], when: { expr: 'len(selected_targets) > 0' }, export: 'aggregate' },
      { id: 'finalize_release', title: 'Finalize release', actor: 'cluster-controller', action: 'controller.release.finalize_direct_apply', dependsOn: ['aggregate_outcome'], when: { expr: 'len(selected_targets) > 0' } },
    ],
    onFailure: { actor: 'cluster-controller', action: 'controller.release.mark_failed' },
    onSuccess: { actor: 'cluster-controller', action: 'controller.release.recheck_convergence' },
  },

  // ── release.remove.package ──────────────────────────────────────────────
  {
    name: 'release.remove.package',
    displayName: 'Remove package',
    description: 'Uninstall a package from all target nodes: stop, disable, remove, clear state.',
    steps: [
      { id: 'mark_removing', title: 'Mark removing', actor: 'cluster-controller', action: 'controller.release.mark_applying' },
      { id: 'select_targets', title: 'Select nodes with package', actor: 'cluster-controller', action: 'controller.release.select_package_targets', dependsOn: ['mark_removing'] },
      { id: 'short_circuit_if_no_targets', title: 'Finalize (none installed)', actor: 'cluster-controller', action: 'controller.release.finalize_noop', dependsOn: ['select_targets'], when: { expr: 'len(selected_targets) == 0' } },
      {
        id: 'remove_per_node', title: 'Remove per node', actor: 'node-agent', action: '',
        dependsOn: ['select_targets'], when: { expr: 'len(selected_targets) > 0' },
        foreach: { collection: '$.selected_targets', itemName: 'target' },
        onFailure: { actor: 'cluster-controller', action: 'controller.release.mark_node_failed' },
        steps: [
          { id: 'stop_service', title: 'Stop service', actor: 'node-agent', action: 'node.stop_package_service' },
          { id: 'disable_service', title: 'Disable service', actor: 'node-agent', action: 'node.disable_package_service', dependsOn: ['stop_service'] },
          { id: 'uninstall_package', title: 'Remove package files', actor: 'node-agent', action: 'node.uninstall_package', dependsOn: ['disable_service'] },
          { id: 'clear_installed_state', title: 'Clear installed state', actor: 'node-agent', action: 'node.clear_installed_package_state', dependsOn: ['uninstall_package'] },
        ],
      },
      { id: 'finalize_removal', title: 'Finalize removal', actor: 'cluster-controller', action: 'controller.release.finalize_direct_apply', dependsOn: ['remove_per_node'], when: { expr: 'len(selected_targets) > 0' } },
    ],
    onFailure: { actor: 'cluster-controller', action: 'controller.release.mark_failed' },
  },

  // ── cluster.reconcile ──────────────────────────────────────────────────
  {
    name: 'cluster.reconcile',
    displayName: 'Cluster reconcile',
    description: 'Continuous drift detection and remediation dispatch. Scans, classifies, and launches child workflows.',
    steps: [
      { id: 'scan_drift', title: 'Scan cluster drift', actor: 'cluster-controller', action: 'controller.reconcile.scan_drift' },
      { id: 'classify_drift', title: 'Classify drift items', actor: 'cluster-controller', action: 'controller.reconcile.classify_drift', dependsOn: ['scan_drift'] },
      { id: 'short_circuit_clean', title: 'Finish (no remediation needed)', actor: 'cluster-controller', action: 'controller.reconcile.finalize_clean', dependsOn: ['classify_drift'], when: { expr: 'len(remediation_items) == 0' } },
      {
        id: 'dispatch_remediations', title: 'Dispatch remediations', actor: 'cluster-controller', action: '',
        dependsOn: ['classify_drift'], when: { expr: 'len(remediation_items) > 0' },
        foreach: { collection: '$.remediation_items', itemName: 'item', strategy: { mode: 'parallel', concurrency: '$.remediation_parallelism' } },
        onFailure: { actor: 'cluster-controller', action: 'controller.reconcile.mark_item_failed' },
        steps: [
          { id: 'mark_item_started', title: 'Mark item started', actor: 'cluster-controller', action: 'controller.reconcile.mark_item_started' },
          { id: 'choose_workflow', title: 'Choose workflow', actor: 'cluster-controller', action: 'controller.reconcile.choose_workflow', dependsOn: ['mark_item_started'] },
          { id: 'launch_remediation', title: 'Launch child workflow', actor: 'workflow-service', action: 'workflow.start_child', dependsOn: ['choose_workflow'] },
          { id: 'wait_child_terminal', title: 'Wait child terminal', actor: 'workflow-service', action: 'workflow.wait_child_terminal', dependsOn: ['launch_remediation'] },
          { id: 'mark_item_terminal', title: 'Mark item terminal', actor: 'cluster-controller', action: 'controller.reconcile.mark_item_terminal', dependsOn: ['wait_child_terminal'] },
        ],
      },
      { id: 'aggregate_remediation', title: 'Aggregate outcomes', actor: 'cluster-controller', action: 'controller.reconcile.aggregate_results', dependsOn: ['dispatch_remediations'], export: 'aggregate' },
      { id: 'finalize_reconcile', title: 'Finalize reconcile', actor: 'cluster-controller', action: 'controller.reconcile.finalize', dependsOn: ['aggregate_remediation'] },
    ],
    onFailure: { actor: 'cluster-controller', action: 'controller.reconcile.mark_failed' },
    onSuccess: { actor: 'cluster-controller', action: 'controller.reconcile.emit_completed' },
  },
]

export function getWorkflowDef(name: string): WorkflowDef | undefined {
  return WORKFLOW_DEFS.find(d => d.name === name)
}
