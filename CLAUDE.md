# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Globular Services is a microservices platform for building self-hosted distributed applications. Built on gRPC with Protocol Buffers, it provides 28+ microservices across multiple languages (primarily Go, with TypeScript client support).

## Build Commands

```bash
# Build all Go services
cd golang && go build ./...

# Build a specific service
cd golang && go build ./authentication/authentication_server

# Run all tests
cd golang && go test ./... -race -coverprofile=coverage.out

# Run tests for a specific package
cd golang && go test ./echo/echo_server -v

# Lint (via CI)
golangci-lint run --timeout=5m

# Generate protobuf code from .proto files
./generateCode.sh

# Build all packages (infrastructure + services)
./build-all-packages.sh
```

## Project Structure

```
services/
├── golang/                     # PRIMARY - All Go microservices
│   ├── <service_name>/         # Each service has its own directory
│   │   ├── <service_name>pb/   # Generated protobuf code
│   │   ├── <service_name>_client/
│   │   └── <service_name>_server/
│   ├── globular_service/       # Shared service primitives (lifecycle, CLI, config)
│   ├── globular_client/        # Shared client primitives
│   ├── interceptors/           # gRPC interceptors (auth, audit, RBAC)
│   ├── config/                 # Configuration management (etcd backend)
│   └── go.mod                  # Go 1.24.5
├── typescript/                 # TypeScript web client library
├── proto/                      # Protocol buffer definitions (*.proto)
├── generated/                  # Generated specs and packages
└── build-all-packages.sh       # Full build script
```

## Service Architecture

Each Go service follows this structure:
```
service_name_server/
├── server.go       # Main server + gRPC registration
├── config.go       # Config struct, validation, persistence
├── handlers.go     # Business logic (refactored pattern)
├── *_test.go       # Tests
```

### Service Implementation Pattern

Services use shared primitives from `globular_service/`:

1. **CLI Helpers** - `globular.HandleInformationalFlags()`, `globular.ParsePositionalArgs()`
2. **Lifecycle Manager** - `globular.NewLifecycleManager()` for startup/shutdown
3. **Config Helpers** - `globular.SaveConfigToFile()`, `globular.ValidateCommonFields()`

Services implement two interfaces:
- `Service` interface (getters/setters for Name, Port, Domain, etc.)
- `LifecycleService` interface (`StartService()`, `StopService()`, `GetGrpcServer()`)

See `golang/MIGRATION_GUIDE.md` and `golang/SHARED_PRIMITIVES.md` for details.

## 4-Layer State Model

The platform tracks each package across 4 state layers:

| Layer | Source | Owner |
|-------|--------|-------|
| **Artifact** | Repository catalog (`repository.PackageRepository`) | `pkg publish` / `ensure-bootstrap-artifacts.sh` |
| **Desired Release** | Controller etcd (`/globular/resources/DesiredRelease/…`) | `globular services desired set` / `seed` |
| **Installed Observed** | Node Agent etcd (`/globular/nodes/{id}/packages/…`) | Node Agent (auto-populated from systemd) |
| **Runtime Health** | systemd + gRPC health checks | Gateway / admin metrics |

Status vocabulary (design-doc-aligned):
- **Installed** — desired == installed, converged
- **Planned** — desired set, not yet installed
- **Available** — in repo, no desired release
- **Drifted** — installed version differs from desired
- **Unmanaged** — installed without a desired-state entry
- **Missing in repo** — desired/installed but artifact not in repository
- **Orphaned** — in repo, not desired, not installed

CLI tools: `globular services repair [--dry-run]`, `globular services seed`

## Key Dependencies

- `google.golang.org/grpc` v1.78.0 - gRPC framework
- `go.etcd.io/etcd/client/v3` v3.5.14 - Distributed configuration
- `go.mongodb.org/mongo-driver` v1.16.0 - MongoDB
- `github.com/minio/minio-go/v7` - Object storage
- `github.com/prometheus/client_golang` - Metrics

## Protocol Buffers

Proto files are in `/proto/`. After modifying a `.proto` file:
```bash
./generateCode.sh   # Regenerates Go + TypeScript code
```

## Testing

- Unit tests alongside source files (`*_test.go`)
- Integration tests in server directories
- Test utilities in `golang/testutil/`

## CLI Tool (globularcli)

Located in `golang/globularcli/`. Commands include:
```bash
globular cluster bootstrap    # Initialize first node
globular cluster join         # Add nodes to cluster
globular cluster token create # Create join tokens
globular pkg build            # Build service packages
```

## Default Ports

- Authentication: 10101
- Event: 10102
- File: 10103
- RBAC: 10104
- Node Agent: 11000
- Cluster Controller: 12000
- AI Memory: 10200

## AI Memory Service (IMPORTANT — read this section carefully)

Globular includes a dedicated memory service (`ai_memory.AiMemoryService`) backed by ScyllaDB
that replaces flat-file memory with structured, searchable, cluster-scoped persistent storage.

### How to detect if the service is available

Check your `<available-deferred-tools>` list at the start of the conversation. If you see
tools prefixed with `mcp__globular__memory_` (e.g. `mcp__globular__memory_store`), the service
is deployed and you SHOULD use it. If those tools are absent, fall back to the flat-file
memory system at `~/.claude/projects/.../memory/`.

### Tool reference

All tools use the MCP namespace `mcp__globular__`. The `project` parameter should always
be `"globular-services"` when working in this repository.

**memory_store** — Save knowledge to the cluster
```
Parameters (all strings unless noted):
  project:         REQUIRED  "globular-services"
  type:            REQUIRED  One of: feedback, architecture, decision, debug,
                             session, user, project, reference, scratch
  title:           REQUIRED  One-line summary (used in listings)
  content:         REQUIRED  Full memory body (markdown OK)
  tags:            optional  Comma-separated: "dns,badgerdb,corruption"
  ttl_seconds:     optional  (number) Auto-expire after N seconds. 0 = permanent.
                             Use for scratch type.
  conversation_id: optional  Link to originating conversation
  metadata:        optional  JSON string of key-value pairs for flexible attributes:
                             '{"root_cause":"unclean-shutdown","confidence":"high"}'
  related_ids:     optional  Comma-separated memory IDs this memory relates to
Returns: { id, status, project, type, title }
```

**memory_query** — Search memories
```
Parameters:
  project:     REQUIRED  "globular-services"
  type:        optional  Filter by memory type
  tags:        optional  Comma-separated (AND logic): "dns,corruption"
  text_search: optional  Substring match on title + content
  limit:       optional  (number) Max results, default 20
Returns: { total, memories: [{ id, type, tags, title, content, created_at, ... }] }
```

**memory_get** — Retrieve single memory by ID
```
Parameters:
  id:      REQUIRED  Memory UUID
  project: REQUIRED  "globular-services"
Returns: full memory object with content
```

**memory_update** — Modify an existing memory (merge: only non-empty fields change)
```
Parameters:
  id:          REQUIRED  Memory UUID
  project:     REQUIRED  "globular-services"
  title:       optional  New title
  content:     optional  New content
  tags:        optional  New tags (replaces existing)
  ttl_seconds: optional  (number) New TTL
  metadata:    optional  JSON string of key-value pairs (merged into existing)
  related_ids: optional  Comma-separated memory IDs to link (appended, deduplicated)
Returns: { success, id }
```

**memory_delete** — Remove a memory
```
Parameters:
  id:      REQUIRED  Memory UUID
  project: REQUIRED  "globular-services"
Returns: { success, id }
```

**memory_list** — Browse summaries (no content, lightweight)
```
Parameters:
  project: REQUIRED  "globular-services"
  type:    optional  Filter by type
  tags:    optional  Comma-separated filter
  limit:   optional  (number) Default 20
Returns: { total, memories: [{ id, type, tags, title, created_at, updated_at }] }
```

**session_save** — Capture conversation context for continuity
```
Parameters:
  project:          REQUIRED  "globular-services"
  topic:            REQUIRED  Short topic key: "dns-debugging", "rbac-externalization"
  summary:          REQUIRED  What was accomplished this session
  decisions:        optional  Comma-separated key decisions made
  open_questions:   optional  Comma-separated unresolved items
  related_memories: optional  Comma-separated memory IDs created/referenced
Returns: { id, status, topic, project }
```

**session_resume** — Pick up where a prior conversation left off
```
Parameters:
  project: REQUIRED  "globular-services"
  topic:   REQUIRED  Topic to search (fuzzy match on topic + summary)
  limit:   optional  (number) How many sessions to return, default 1
Returns: { sessions: [{ id, topic, summary, decisions, open_questions, related_memories, created_at }] }
```

### When to use each tool

| Moment | Action |
|--------|--------|
| Start of conversation | `session_resume` if user references prior work |
| User corrects your approach | `memory_store` type=feedback |
| You discover a bug root cause | `memory_store` type=debug, tag the service |
| Design decision is made | `memory_store` type=decision |
| You learn about user's role/prefs | `memory_store` type=user |
| Temporary analysis notes | `memory_store` type=scratch, ttl_seconds=86400 |
| End of conversation | `session_save` with summary + decisions + open questions |
| Need to recall past knowledge | `memory_query` with relevant tags or text_search |
| Check what you know about a topic | `memory_list` with type/tag filters, then `memory_get` |
| Knowledge is outdated | `memory_update` or `memory_delete` |

### Memory types explained

- **feedback**: User corrections and confirmed approaches (what to do / not do)
- **architecture**: System design knowledge (how things work and why)
- **decision**: Design decisions with rationale (why X was chosen over Y)
- **debug**: Debugging sessions and root causes (problem + fix + how discovered)
- **session**: Auto-created by session_save (conversation summaries)
- **user**: User profile, preferences, expertise level
- **project**: Ongoing work, goals, deadlines, initiatives
- **reference**: Pointers to external resources (URLs, doc locations, dashboards)
- **scratch**: Temporary analysis, auto-expires via TTL

### Tags convention

Use lowercase, descriptive tags. Common patterns:
- Service name: `dns`, `rbac`, `monitoring`, `gateway`
- Technology: `scylladb`, `badgerdb`, `etcd`, `envoy`
- Category: `bug`, `fix`, `config`, `tls`, `bootstrap`
- Example: `tags: "dns,badgerdb,corruption,bug"`

### Adaptive features (metadata + related_ids + reference_count)

Memories have three fields that enable them to self-organize over time:

**metadata** — flexible key-value bag for attributes not in the schema:
```json
{"root_cause": "unclean-shutdown", "confidence": "high", "affects": "badgerdb,prometheus"}
```
Use metadata to capture context that doesn't fit tags or content. Common keys:
- `root_cause`: underlying cause of a bug (enables pattern detection)
- `confidence`: how certain you are about this memory (`high`, `medium`, `low`)
- `affects`: which services/components are impacted
- `supersedes`: ID of an older memory this one replaces
- `source`: where this knowledge came from (`debug-session`, `user-feedback`, `code-review`)

**related_ids** — bidirectional links between memories:
When you store a memory related to an existing one, link them:
```
memory_store(..., related_ids: "uuid-of-related-memory")
memory_update(id: "uuid-of-related-memory", related_ids: "uuid-of-new-memory")
```
This builds a knowledge graph. When debugging, follow related_ids to find connected insights.
Example: a BadgerDB corruption fix and a Prometheus WAL fix share `root_cause: "unclean-shutdown"`
— link them so next time you see one, you check for the other.

**reference_count** — auto-incremented every time `memory_get` is called:
Memories that get queried often are more valuable. Use reference_count to:
- Surface frequently-used knowledge first
- Identify memories that might be worth expanding or promoting
- Spot rarely-referenced memories that might be stale

## Security Constraints (Makefile)

The Makefile enforces security checks:
- `clustercontroller_server` must NOT use `os/exec`, `syscall`, or `systemctl`
- `nodeagent_server` can only use `os/exec` within `internal/supervisor/`

Run checks: `make check-services`