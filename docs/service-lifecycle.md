# Service Lifecycle — Declarative Model

## Overview

Globular uses a **declarative desired-state model** for service management.
Operators declare which services (and versions) should run on the cluster;
the control plane converges each node toward that desired state.

Imperative per-node installation (`globular services apply --service`)
is **deprecated** and will be removed in a future release.

---

## D / A / I Model

| Layer | Meaning | Stored in |
|-------|---------|-----------|
| **Desired (D)** | Operator intent — which services and versions the cluster should run | Cluster controller (etcd) |
| **Applied (A)** | What the node-agent has successfully written to disk (binaries, configs, systemd units) | Node-agent local state |
| **Installed (I)** | What systemd reports as loaded / active | Node filesystem |

Convergence flows top-down: **D → A → I**.
Drift is detected bottom-up: **I ≠ A** or **A ≠ D**.

---

## Lifecycle States

Each service-on-node has exactly one lifecycle state at any time:

| State | Color | Meaning |
|-------|-------|---------|
| `applied` | green | Desired == Applied, service running normally |
| `managed-pending` | yellow | Desired state set, not yet applied to this node |
| `staged` | blue | Artifacts downloaded and ready, activation pending |
| `awaiting-privileged-apply` | orange | Node lacks privilege (non-root, no systemd write access) to complete the apply; manual `globular services apply-desired` required |
| `progressing` | yellow | A plan is actively running to converge this service |
| `drifted` | red | Applied state has diverged from desired with no active plan |
| `failure` | red | Plan execution failed; see error details |
| `unmanaged` | gray | Service installed outside the desired-state system (legacy imperative install) |
| `not-selected` | muted | Service exists in the catalog but is neither desired nor installed |

### State Transitions

```
                ┌──────────────┐
                │  not-selected │
                └──────┬───────┘
                       │ operator runs: globular services desired set <svc> <ver>
                       v
                ┌──────────────────┐
                │  managed-pending  │
                └──────┬───────────┘
                       │ controller creates plan
                       v
                ┌──────────────┐
         ┌──────│  progressing  │──────┐
         │      └──────────────┘      │
         │ success                    │ failure
         v                            v
  ┌──────────┐                 ┌──────────┐
  │  applied  │                │  failure  │
  └────┬─────┘                 └──────────┘
       │ external change
       v
  ┌──────────┐
  │  drifted  │──► controller creates new plan ──► progressing
  └──────────┘

  Special case — node lacks privilege:
  managed-pending ──► awaiting-privileged-apply
  (resolve by running `globular services apply-desired` on that node)
```

---

## Declarative Workflow

### Setting desired state

```bash
# Add or update a service in the cluster desired state
globular services desired set <service> <version>

# Remove a service from desired state
globular services desired remove <service>

# View current desired state
globular services desired list

# Compare desired vs. local applied state
globular services desired diff
```

### Applying desired state

Under normal operation the node-agent converges automatically.
When the node-agent runs unprivileged (cannot write systemd units),
apply manually on the target node:

```bash
globular services apply-desired
```

### Adopting existing installations

Services installed via the old imperative method appear as `unmanaged`.
To bring them under declarative management:

```bash
globular services adopt-installed
```

This imports currently-installed services into the desired state,
making them managed going forward.

---

## Migration from Imperative Installs

1. **Audit**: Run `globular services desired list` and compare with
   `globular services list` to identify unmanaged services.

2. **Adopt**: Run `globular services adopt-installed` to seed the
   desired state from what is currently installed.

3. **Verify**: Check the admin UI — services should transition from
   `unmanaged` (gray) to `applied` (green).

4. **Going forward**: Use only `globular services desired set/remove`
   to manage the service inventory. The old `globular services apply --service`
   command will print a deprecation error directing you to the declarative path.

---

## Node Capabilities

Each node reports whether it can perform privileged operations
(writing systemd units, managing service binaries) via the
`can_apply_privileged` capability flag.

- **Root or systemd-writable**: `can_apply_privileged = true` — full
  automatic convergence.
- **Unprivileged**: `can_apply_privileged = false` — the control plane
  sets the plan state to `AWAITING_PRIVILEGED_APPLY` and the admin UI
  shows an orange badge with remediation instructions.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| Service stuck at "Awaiting privileged apply" | Node-agent running without root / systemd access | Run `globular services apply-desired` on the node |
| Service shows "Unmanaged" | Installed via old imperative path | Run `globular services adopt-installed` |
| Service shows "Drifted" | Applied state diverged (manual edit, partial upgrade) | Controller will auto-create a plan; if node is unprivileged, run `globular services apply-desired` |
| Service shows "Failure" | Plan execution error | Check `globular plans list` and node-agent logs for details |
