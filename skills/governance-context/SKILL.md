---
name: governance-context
description: "How to read and use OrqaStudio governance data — artifact graph, relationship vocabulary, status model, and enforcement rules."
user-invocable: false
---

# Governance Context

## The Artifact Graph

OrqaStudio manages work through an **artifact graph** — markdown files with YAML frontmatter in `.orqa/`. Files are nodes. Frontmatter `relationships` arrays are edges.

### Where Things Live

| What | Where |
|------|-------|
| Tasks | `.orqa/delivery/tasks/` |
| Epics | `.orqa/delivery/epics/` |
| Ideas | `.orqa/discovery/ideas/` |
| Research | `.orqa/discovery/research/` |
| Decisions | `.orqa/process/decisions/` |
| Rules | `.orqa/process/rules/` |
| Lessons | `.orqa/process/lessons/` |
| Knowledge | `.orqa/process/knowledge/*/KNOW.md` |
| Agents | `.orqa/process/agents/` |
| Documentation | `.orqa/documentation/` |
| Project config | `.orqa/project.json` |

### Reading the Graph

```
Task → reads epic (relationships: delivers → EPIC-NNN)
Epic → reads milestone (relationships: fulfils → MS-NNN)
Decision → reads rule (relationships: enforced-by → RULE-NNN)
Artifact → reads pillar (relationships: grounded-by → PILLAR-NNN)
```

## Relationship Vocabulary

All connections use the `relationships` frontmatter array with `target` and `type` fields.

| Forward | Inverse | When to Use |
|---------|---------|-------------|
| `delivers` | `delivered-by` | Task delivers to epic |
| `fulfils` | `fulfilled-by` | Epic fulfils milestone |
| `drives` | `driven-by` | Decision drives work |
| `enforces` | `enforced-by` | Rule enforces decision |
| `grounded` | `grounded-by` | Artifact anchored to pillar |
| `informs` | `informed-by` | Knowledge flows downstream |
| `evolves-into` | `evolves-from` | Artifact lineage |
| `observes` | `observed-by` | Agent watches artifact |
| `merged-into` | `merged-from` | Artifact consolidation |
| `depends-on` | `depended-on-by` | Task sequencing |

**Relationships are ALWAYS bidirectional.** When you write `A --delivers--> B`, you MUST also add `B --delivered-by--> A`.

## 12 Canonical Statuses

`captured` → `exploring` → `ready` → `prioritised` → `active` → `hold` / `blocked` → `review` → `completed` → `surpassed` / `archived` / `recurring`

## Rules

Rules in `.orqa/process/rules/RULE-NNN.md` define enforcement:
- `status: active` — enforced, agents must comply
- `status: inactive` — not enforced, historical reference
- Rules with `enforcement` arrays in frontmatter trigger hook-based enforcement

## Schema Validation

Each artifact directory has a `schema.json` that defines required/optional fields. Read the schema before creating or modifying artifacts.

## Type Constraints

From `core.json`:
- `enforces` only FROM rule TO decision
- `grounded`/`grounded-by` only TO pillar
- `drives`/`driven-by` only FROM decision
- `observes`/`observed-by` only FROM agent

## MCP Knowledge Discovery

When you need domain knowledge beyond what's preloaded, query the MCP server:

```
# Find knowledge artifacts by keyword
graph_query({ type: "knowledge", search: "composability" })

# Search only governance artifacts
graph_query({ type: "knowledge", search: "testing", scope: "artifacts" })

# Read a knowledge artifact's full content
graph_read({ path: ".orqa/process/knowledge/search/KNOW.md" })

# Get a knowledge artifact's relationships (which agents use it)
graph_relationships({ id: "KNOW-f0c40eaf" })
```

Use `scope: "artifacts"` to search only `.orqa/` content. Use `scope: "codebase"` for source code.
