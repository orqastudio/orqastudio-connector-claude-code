# /orqa-create — Create Artifact with Guided Frontmatter

Create a new OrqaStudio artifact with valid frontmatter and relationships. This command guides you through artifact creation step by step.

## Usage

When the user asks to create an artifact, follow this process:

### 1. Determine the artifact type

Ask what type of artifact to create if not specified:
- **task** — Delivery work item (TASK-NNN)
- **epic** — Delivery feature grouping (EPIC-NNN)
- **idea** — Discovery concept (IDEA-NNN)
- **decision** — Architecture decision (AD-NNN)
- **rule** — Governance rule (RULE-NNN)
- **lesson** — Learned pattern (IMPL-NNN)
- **research** — Investigation (RES-NNN)

### 2. Allocate the next ID

Find the highest existing ID for this type:

```bash
ls .orqa/delivery/tasks/ | sort -t- -k2 -n | tail -1    # For tasks
ls .orqa/delivery/epics/ | sort -t- -k2 -n | tail -1    # For epics
ls .orqa/process/decisions/ | sort -t- -k2 -n | tail -1  # For decisions
```

### 3. Determine relationships

Every artifact should have at least one relationship:
- **Tasks** → `delivers` to an epic
- **Epics** → `fulfils` a milestone
- **Decisions** → `grounded` to a pillar
- **Rules** → `enforces` a decision
- **Lessons** → `informs` a decision or rule

### 4. Write the artifact

Use the governance-steward agent to create the artifact with:
- Full YAML frontmatter (id, type, title, status, created, updated, relationships)
- Markdown body with appropriate sections
- Bidirectional relationships (add inverses on target artifacts)

### 5. Validate

Run `orqa enforce` to check the new artifact passes integrity checks.

## Example: Create a new task

```yaml
---
id: TASK-907d579d
type: task
title: "Implement widget caching"
status: captured
created: 2026-03-19
updated: 2026-03-19
relationships:
  - target: EPIC-6967c7dc
    type: delivers
---

# TASK-907d579d: Implement Widget Caching

## Acceptance Criteria

1. Widgets are cached after first render
2. Cache invalidates on data change
3. No memory leaks from stale cache entries
```

Then add the inverse on EPIC-6967c7dc:
```yaml
  - target: TASK-907d579d
    type: delivered-by
```
