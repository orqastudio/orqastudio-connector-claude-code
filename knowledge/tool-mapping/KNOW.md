---
id: KNOW-CC-tool-mapping
name: tool-mapping
description: "Which MCP tool to use for which governance operation. Required reading before any delegation that touches the artifact graph or codebase."
user-invocable: false
status: active
created: "2026-03-20"
updated: "2026-03-20"
---

# Tool Mapping for Governance Operations

Before starting any task that touches `.orqa/` files or reads the codebase, the orchestrator
MUST query the artifact graph and codebase using the appropriate tool. This document maps
governance operations to their correct tools.

**These steps are not optional.** Skipping graph queries before delegation leads to missed
context, duplicate work, and broken relationships.

## Governance Operation Map

| Operation | Tool | When to Use |
|-----------|------|-------------|
| Find an artifact by known ID | `graph_resolve` | Before reading or editing a known artifact — confirms it exists and returns its path |
| Find artifacts by type or status | `graph_query` | When scoping work (find all in-progress tasks, find all active rules) or auditing |
| Check what an artifact links to or from | `graph_relationships` | Before modifying frontmatter relationships — see what's already connected |
| Find prior work similar to what you're about to start | `search_semantic` (scope: artifacts) | Before starting new work — avoids duplication, surfaces related decisions |
| Find code implementations of a concept | `search_semantic` (scope: codebase) | Before writing new code — find existing patterns and components |
| Find an exact function, class, or string in code | `search_regex` | Refactoring, renaming, verifying a command exists, tracing a call chain |
| Understand a feature area end-to-end | `search_research` | Before planning implementation — maps the full chain from UI to backend |
| Verify artifact graph health after batch changes | `graph_validate` | After creating or editing multiple artifacts in one session |

## Required Pre-Delegation Steps

### Before ANY task

1. `graph_query({ type: "task", status: "in-progress" })` — confirm no duplicate active work
2. `graph_resolve(<task-id>)` — read the task artifact, follow its `epic` relationship
3. `search_semantic("scope: artifacts, query: <task-subject>")` — find related prior decisions

### Before delegating to an Implementer

1. `search_research("<feature area>")` — map the full request chain (component → store → IPC → Rust command)
2. `search_semantic(scope: codebase, "<concept>")` — find existing patterns to reuse
3. `graph_query({ type: "decision", search: "<feature area>" })` — find relevant architecture decisions

### Before delegating to a Governance Steward (`.orqa/` changes)

1. `graph_relationships(<artifact-id>)` — read all relationships before modifying
2. `graph_query({ type: "rule" })` — check for existing rules that constrain the change
3. `graph_validate()` — baseline health check before making changes

### Before delegating to a Planner

1. `graph_query({ type: "epic", status: "ready" })` — find related epics
2. `search_semantic(scope: artifacts, "<problem domain>")` — find research and ideas
3. `search_research("<problem domain>")` — understand the current implementation

## Tool Reference

### `graph_resolve(id)`

Resolves a single artifact by its frontmatter ID. Returns the full node including
path, title, status, and all frontmatter fields. Use when you have the ID and need
to confirm the artifact exists and read its content.

```
graph_resolve("EPIC-0a8a5e72")
→ { id, path, title, status, artifact_type, frontmatter, references_out, references_in }
```

### `graph_query(filters)`

Returns all artifacts matching the given filters. Filters are combined with AND logic.

```
graph_query({ type: "task", status: "in-progress" })
graph_query({ type: "rule", search: "enforcement" })
graph_query({ type: "decision" })
```

### `graph_relationships(id)`

Returns all outgoing and incoming relationships for a given artifact. Use before
modifying relationships to understand what's already connected and avoid breaking
existing links.

```
graph_relationships("EPIC-0a8a5e72")
→ { references_out: [...], references_in: [...] }
```

### `graph_validate()`

Runs graph integrity checks: broken references, orphaned nodes, missing inverses.
Run after batch artifact changes to catch problems before committing.

### `search_semantic(scope, query)`

Semantic search using the ONNX embedding engine. Two scopes:

- `scope: "artifacts"` — searches `.orqa/` governance artifacts
- `scope: "codebase"` — searches source code files

Use for concept-level searches when you know what you're looking for but not
where it lives. More powerful than grep for discovering related work.

```
search_semantic("scope: artifacts, query: authentication flow")
search_semantic("scope: codebase, query: error handling in Tauri commands")
```

### `search_regex(pattern)`

Exact pattern match across the codebase. Use when you know the exact function
name, struct name, or string you're looking for.

```
search_regex("create_session")
search_regex("graph_commands")
```

### `search_research(query)`

End-to-end research that searches both documentation and code together.
Use when you need to understand how an entire feature area works before planning
or implementing.

```
search_research("how does streaming work")
search_research("artifact graph construction pipeline")
```

## Why This Matters

Skipping pre-delegation graph queries causes:

- **Duplicate work** — implementing something that already exists elsewhere
- **Broken relationships** — creating artifacts without linking to related ones
- **Missed constraints** — missing architecture decisions or rules that constrain the approach
- **Orphaned artifacts** — artifacts that don't connect to anything in the graph

The artifact graph is the single source of truth for what has been decided, what is
in progress, and what relationships exist between artifacts. Querying it before every
delegation ensures the orchestrator acts on current state, not assumptions.
