# CLAUDE.md

This file is read automatically by Claude Code at the start of every session. It contains the rules, invariants, and operational knowledge needed to work safely with the globular-admin codebase.

---

## SESSION PRELUDE — read before any tool call

Claude has no continuous memory between sessions. The rules below are loaded as text, but my training defaults will leak through unless I actively check them. Hooks enforce some of these; the rest require deliberate attention.

1. **MEMORY = ai-memory, not flat files.** For project `globular-services`, use `mcp__globular__memory_store` / `memory_query` / `memory_update`. If MCP tools `mcp__globular__memory_*` are unavailable, fall back to flat-file memory at `~/.claude/projects/.../memory/`.

2. **AWARENESS-FIRST for all non-trivial edits.** Before editing any file that renders cluster state, handles auth tokens, performs destructive actions, or constructs backend URLs — call `mcp__awg__awareness_briefing(file=<path>)` FIRST. The awareness graph lives at `.globular/awareness/graph.json` and knowledge files are in `docs/awareness/`.

3. **Ask the graph, don't grep.** When you need an invariant, failure mode, or forbidden fix, use `mcp__awg__awareness_query` / `awareness_resolve` / `awareness_briefing`. Do NOT grep over `docs/awareness/` — the YAML files are inputs to the graph, not the queryable surface.

4. **End non-trivial tasks with the AWG summary line**: `AWG: briefing(<target>) | invariants: X, Y | uncertainty: Z`. See the AWARENESS USAGE section for variants.

---

## PROJECT OVERVIEW

Globular Admin is the **TypeScript web frontend** for the Globular Services platform. It is a pnpm monorepo containing the admin dashboard, media app, shared SDK, UI components, and build tools. The admin UI communicates with the Globular backend cluster via gRPC-web.

This is a **client-only** project — no Go, no backend services, no protobuf generation. The backend lives in the sibling `services/` repository.

---

## HARD RULES — NEVER VIOLATE

### 1. Auth tokens in sessionStorage ONLY

- JWT stored in `sessionStorage` key `__globular_token__`
- **NEVER** localStorage, DOM attributes, URL fragments, or module globals
- Tokens are ephemeral — cleared on tab close by design

### 2. Backend addresses from localStorage config, never hardcoded

- Base URL from `localStorage` key `globular.baseUrl`
- Routing mode from `localStorage` key `globular.routingMode`
- **NEVER** hardcode an IP, hostname, or port in source code
- All gRPC-web channels and HTTP URLs must use the SDK's config-resolved base URL

### 3. The 4-layer state model is SACRED — never collapse

```
Layer 1: Repository (Artifact)        — "Does this version exist?"
Layer 2: Desired Release (Controller)  — "What should be running?"
Layer 3: Installed Observed (Node Agent) — "What is actually installed?"
Layer 4: Runtime Health (systemd)      — "Is it running and healthy?"
```

- Each layer is INDEPENDENT — never assume Desired == Installed or Installed == Running
- Check `docs/awareness/authority_rules.yaml` for which data source owns each display value

### 4. Unknown state must NEVER appear healthy

- When a probe times out, data is absent, or a node is unreachable: show "unknown" or "unreachable"
- **NEVER** default missing/null/timeout to green/healthy/ok
- The "no data = healthy" pattern is forbidden

### 5. Destructive actions require explicit confirmation

- Delete, wipe, remove, reset actions must present a confirmation dialog
- The dialog must name the resource and describe the consequence
- Single-click destructive mutations are forbidden

### 6. RBAC is server-enforced — UI is display-only

- UI hides buttons for unauthorized users as a UX convenience only
- **NEVER** add client-side permission checks as the sole security gate
- The server interceptor chain enforces authorization on every RPC

### 7. Workflow completion requires terminal state polling

- Dispatch RPC returning 200 does NOT mean the operation completed
- Must poll WorkflowService for SUCCEEDED or FAILED before showing success
- Showing "Done" immediately after dispatch is forbidden

### 8. Build the DOM shell ONCE — never rebuild on refresh

- `connectedCallback` / first load builds the full DOM structure once
- All subsequent data updates use targeted `[data-bind]` slot mutations
- `this.innerHTML = ...` or `this.render()` from a timer/RPC handler is **FORBIDDEN**
- Old data stays visible in slots until new data explicitly replaces it
- Module-level cache (`const _cache = ...` at file scope) for stale-while-revalidate

---

## ARCHITECTURE

### Project Structure

```
globular-admin/
├── apps/
│   ├── web/                        # Admin dashboard (Vite + TypeScript)
│   │   ├── src/
│   │   │   ├── main.ts             # Entry point
│   │   │   ├── router.ts           # SPA router
│   │   │   ├── pages/              # Page components (57 pages)
│   │   │   │   ├── cluster_*.ts    # Cluster management pages
│   │   │   │   ├── infrastructure_*.ts  # Infrastructure pages
│   │   │   │   ├── rbac_*.ts       # RBAC management pages
│   │   │   │   ├── repo_*.ts       # Repository/package pages
│   │   │   │   ├── security_*.ts   # Security pages
│   │   │   │   ├── services_*.ts   # Service management pages
│   │   │   │   ├── storage_*.ts    # Storage pages
│   │   │   │   ├── workflow_*.ts   # Workflow pages
│   │   │   │   ├── admin_*.ts      # Admin tools (backups, diagnostics, AI)
│   │   │   │   ├── networking_*.ts # Networking pages
│   │   │   │   ├── observability_*.ts # Logs, metrics, events
│   │   │   │   ├── medias_*.ts     # Media pages
│   │   │   │   ├── login.ts        # Authentication
│   │   │   │   └── dashboard.ts    # Main dashboard
│   │   │   ├── widgets/            # Reusable UI widgets
│   │   │   └── utils/              # Shared utilities
│   │   └── vite.config.ts
│   ├── media/                      # Media app (Vite + TypeScript)
│   └── desktop/                    # Desktop app (placeholder)
├── packages/
│   ├── sdk/                        # @globular/sdk — gRPC-web client library
│   │   ├── src/
│   │   │   ├── core/               # Auth, RPC, sessions, endpoints, errors
│   │   │   │   ├── auth.ts         # Token management (sessionStorage)
│   │   │   │   ├── rpc.ts          # gRPC-web call wrapper (Bearer injection)
│   │   │   │   ├── session.ts      # Session management
│   │   │   │   └── endpoints.ts    # Service endpoint resolution
│   │   │   ├── cluster/            # Cluster operations client
│   │   │   ├── rbac/               # RBAC client (accounts, roles, groups, orgs)
│   │   │   ├── repository/         # Package repository client
│   │   │   ├── workflow/           # Workflow client
│   │   │   ├── metrics/            # Prometheus metrics client
│   │   │   └── backup/             # Backup client
│   │   └── test/                   # Vitest tests
│   ├── ui/                         # @globular/ui — Web components, theme, event bus
│   │   ├── src/
│   │   │   ├── elements/           # Paper-* web components (Material-inspired)
│   │   │   ├── theme/              # CSS custom properties, dark/light mode
│   │   │   └── widgets/            # Theme toggle, user toolbar
│   │   └── CSS_TOKENS.md
│   ├── components/                 # @globular/components — Higher-level components
│   └── build-tools/                # @globular/build-tools — Vite plugins
├── docs/
│   ├── awareness/                  # AWG knowledge files
│   │   ├── invariants.yaml         # UI invariants (14 rules)
│   │   ├── forbidden_fixes.yaml    # Anti-patterns (13 entries)
│   │   ├── failure_modes.yaml      # Known failure classes
│   │   └── authority_rules.yaml    # State authority mapping
│   ├── new-app-guide.md
│   └── service-lifecycle.md
├── scripts/                        # Certbot hooks, DNS scripts
├── .globular/awareness/graph.json  # AWG compiled graph
└── pnpm-workspace.yaml             # Workspace: apps/* + packages/*
```

### Technology Stack

- **Language**: TypeScript (strict mode)
- **Build**: Vite 5 + pnpm workspaces
- **UI**: Vanilla Web Components (no framework — custom elements + Shadow DOM)
- **Styling**: CSS custom properties via `@globular/ui` theme tokens
- **RPC**: gRPC-web via `globular-web-client` (linked from `services/typescript/dist`)
- **Protobuf**: `google-protobuf` (generated stubs consumed, not generated here)
- **Testing**: Vitest (SDK package)
- **Charts**: uPlot (metrics pages)

### Package Dependency Graph

```
@globular/admin-web  →  @globular/sdk
                     →  @globular/ui
                     →  @globular/components
                     →  @globular/media

@globular/ui         →  @globular/sdk
                     →  @globular/components

@globular/components →  @globular/sdk
                     →  @globular/media

@globular/sdk        →  globular-web-client (link:../../../services/typescript/dist)
                     →  grpc-web
                     →  google-protobuf
```

### Key Files

| What | Path |
|------|------|
| Token storage | `packages/sdk/src/core/auth.ts` (sessionStorage) |
| RPC wrapper | `packages/sdk/src/core/rpc.ts` (Bearer injection) |
| Backend config | `packages/sdk/src/backend.ts` (localStorage baseUrl) |
| Endpoint resolution | `packages/sdk/src/core/endpoints.ts` |
| Session management | `packages/sdk/src/core/session.ts` |
| SPA router | `apps/web/src/router.ts` |
| Cluster operations | `packages/sdk/src/cluster/cluster.ts` |
| Theme tokens | `packages/ui/src/theme/theme.ts` |
| Confirmation dialog | `apps/web/src/utils/confirm_dialog.ts` |

---

## BUILD COMMANDS

```bash
# Install dependencies
pnpm install

# Dev server (admin web)
pnpm dev                    # or: pnpm dev:admin

# Dev server (media web)
pnpm dev:media

# Production build (admin)
pnpm build                  # or: pnpm build:admin

# Production build (media)
pnpm build:media

# Preview production build
pnpm preview                # or: pnpm preview:admin

# Build SDK only
pnpm --filter @globular/sdk build

# Run SDK tests
pnpm --filter @globular/sdk test

# Clean SDK build
pnpm --filter @globular/sdk clean

# TypeScript check
pnpm --filter @globular/admin-web exec tsc --noEmit
```

---

## UI COMPONENT PATTERN

All pages are vanilla Web Components following this pattern:

```typescript
// Module-level cache — survives navigation (component destroy/recreate)
interface _PageCache { data: MyData[] | null; fetchedAt: number }
const _cache: _PageCache = { data: null, fetchedAt: 0 }

class PageFoo extends HTMLElement {
  private _built = false
  private _timer?: ReturnType<typeof setInterval>

  connectedCallback() {
    this._buildShell()          // Build DOM once
    if (_cache.data !== null) {
      this._pushData(_cache.data)  // Show cached data immediately
    }
    this._load()                // Background refresh
    this._timer = setInterval(() => this._load(), 30_000)
  }

  disconnectedCallback() {
    if (this._timer) clearInterval(this._timer)
  }

  private _buildShell() {
    if (this._built) return
    this._built = true
    this.innerHTML = `
      <div id="error-banner"></div>
      <table>
        <thead>...</thead>
        <tbody id="data-body"></tbody>
      </table>
    `
  }

  private async _load() {
    try {
      const fresh = await fetchData()
      _cache.data = fresh
      _cache.fetchedAt = Date.now()
      this._pushData(fresh)
      this._showError('')
    } catch (e: any) {
      this._showError(e?.message || 'Load failed')
    }
  }

  private _pushData(data: MyData[]) {
    // Targeted [data-bind] slot updates — never rebuild the shell
    const body = this.querySelector('#data-body')
    // ... sync rows, update cells ...
  }

  private _showError(msg: string) {
    const el = this.querySelector('#error-banner')
    if (el) el.textContent = msg
  }
}

customElements.define('page-foo', PageFoo)
```

### Rules:
1. Shell built ONCE in `_buildShell()` — guarded by `_built` flag
2. Data updates via `_pushData()` — targeted slot writes only
3. Module-level `_cache` for stale-while-revalidate on back-navigation
4. Error banner slot exists in initial shell — no re-render needed for errors
5. Timer cleared in `disconnectedCallback()`
6. Old data stays visible until new data replaces it — no flicker

---

## AWARENESS USAGE

Awareness is the compact map of project intent, invariants, failure modes, and forbidden fixes. It does NOT replace reading code or running tests — it shows which constraints are fragile before you edit.

**Workflow:**
1. `awareness.briefing` with `file` or `task` — start every non-trivial task here.
2. `awareness.impact` on each target file when briefing's coverage is thin.
3. `awareness.resolve` on any `referenced_id` you need expanded.
4. Read the actual code. Patch. Run tests.
5. End the response with the AWG summary line.

**Status handling:**
- `ok` — follow invariants, forbidden fixes, required tests.
- `empty` — handle per risk tier (see below).
- `degraded` — do NOT proceed with high-risk changes without user approval.

**Empty-briefing policy:**

| Risk tier | Example | Action |
|-----------|---------|--------|
| **Low-risk / no-behavior** | Typo fix, formatting, comment | Proceed quietly. Omit AWG line. |
| **High-risk target, minor edit** | Rename in SDK auth, log message in RPC | Treat as DEGRADED. Announce. Check awareness YAML files. |
| **Behavior change in high-risk code** | Auth flow change, new RPC, state rendering | Escalate: run `impact`, `briefing(task=)`, or query related domains. |

**AWG summary line** (append to every non-trivial code task):

```
AWG: briefing(<target>) | invariants: X, Y | uncertainty: Z
```

Variants:
- Degraded: `AWG: DEGRADED -- fallback: <what was checked>`
- Empty + high-risk: `AWG: DEGRADED -- empty briefing for high-risk target; proceeded with fallback reasoning/tests`
- Empty + low-risk: omit the AWG line entirely.

### High-risk files — call awareness.briefing BEFORE editing

- Any file in `packages/sdk/src/core/` (auth, RPC, sessions, endpoints)
- Any page that renders cluster/service/node state
- Any page with destructive actions (delete, wipe, remove, reset)
- Any file that constructs gRPC-web channels or backend URLs
- `apps/web/src/router.ts` (auth gates)
- `packages/sdk/src/cluster/` (cluster operations)
- `packages/sdk/src/workflow/` (workflow state)

### Awareness token discipline — HARD LIMIT

- **1 preflight per task** — compact (default) unless deep/forensic is justified.
- **Do NOT call `awareness agent_context` in the same turn as `awareness preflight`**.
- **Choose the smallest sufficient mode**: micro -> standard -> deep -> forensic.
- **Never call `awareness session_resume_latest` mid-task** — only at session start if resuming.

---

## AI MEMORY SERVICE

If MCP tools `mcp__globular__memory_*` are available, use them instead of flat-file memory. Project: `"globular-services"`.

| Tool | Purpose |
|------|---------|
| `memory_store` | Save knowledge (type, title, content, tags, metadata) |
| `memory_query` | Search by type, tags, text |
| `memory_get` | Retrieve by ID |
| `memory_update` | Merge-update fields |
| `memory_delete` | Remove |
| `memory_list` | Lightweight summaries |
| `session_save` | Persist conversation context |
| `session_resume` | Resume prior conversation |

Types: feedback, architecture, decision, debug, session, user, project, reference, scratch, skill.

---

## COMMON MISTAKES TO AVOID

- Using `localStorage` for auth tokens (must be `sessionStorage`)
- Hardcoding backend addresses in source (use SDK config layer)
- Rebuilding DOM on every refresh tick (`this.innerHTML = ...` in a timer)
- Showing "healthy" when data is absent (show "unknown")
- Single-click destructive actions (always confirm)
- Treating dispatch 200 as operation complete (poll for terminal state)
- Instance-level page cache (`this._cache`) instead of module-level (`const _cache`)
- Wiping data slots to loading placeholder on refresh (leave old data in place)
- Adding client-side RBAC as sole security gate (server enforces)
- Assuming desired state == running state (4 layers are independent)
- Calling `this.render()` from async callbacks (use targeted slot writes)

---

## META-PRINCIPLES (for auditing and error classification)

When documenting or classifying UI bugs, use the perception and composition meta-principles:

**Perception** — "is the screen telling the truth about the system?"
- `meta.ui.screen_claim_must_bind_to_authority` — desired/cached/confirmed collapsed into one meaning
- `meta.ui.state_certainty_must_be_visually_distinct` — loading/stale/unknown rendered like confirmed
- `meta.ui.same_truth_same_language` — same state rendered differently across screens
- `meta.ui.destructive_action_requires_confirmed_authority` — destructive control without RBAC + risk
- `meta.ui.failure_must_preserve_diagnostic_context` — error path blanks selection/context
- `meta.ui.provenance_over_recall` — claim without which-node/as-of-when
- `meta.ui.operator_must_remain_in_control` — auto-refresh changes state without consent
- `meta.ui.workflow_must_yield_closure` — operation ends with no receipt or terminal state

**Composition** — "does the layout make truth easy to perceive?"
- `meta.ui.visual_hierarchy_must_match_decision_hierarchy`
- `meta.ui.visual_grouping_must_match_semantic_grouping`
- `meta.ui.color_must_have_semantic_contract`
- `meta.ui.theme_tokens_must_encode_roles_not_preferences`

**Structure** — "is this unit shaped to be reused and inspected?"
- `meta.code.reusable_unit_must_have_a_stable_semantic_boundary`
- `meta.code.local_state_must_not_become_hidden_authority`
- `meta.code.abstraction_must_be_deeper_than_its_interface`

If a bug fits a meta-principle, add `related_invariants: [meta.<id>]` to the error entry.
If none fits, flag as **UNCLASSIFIABLE** (potential new principle).
