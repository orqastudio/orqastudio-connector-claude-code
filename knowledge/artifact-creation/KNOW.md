---
name: artifact-creation
description: "How to create valid OrqaStudio artifacts — frontmatter requirements, relationship rules, schema compliance, and common patterns."
user-invocable: false
---

# Artifact Creation

## Frontmatter Requirements

Every artifact MUST have YAML frontmatter:

```yaml
---
id: TYPE-NNN
type: typename
title: "Human-readable title"
status: captured
created: YYYY-MM-DD
updated: YYYY-MM-DD
relationships:
  - target: RELATED-ID
    type: relationship-type
---
```

### Required Fields

| Field | Format | Notes |
|-------|--------|-------|
| `id` | `PREFIX-NNN` | Unique, matches idPrefix from schema |
| `type` | string | Must match a type from core.json or plugin schemas |
| `status` | string | One of the 12 canonical statuses |

### Common Optional Fields

| Field | Format | Notes |
|-------|--------|-------|
| `title` | string | Human-readable name |
| `description` | string | Brief description |
| `created` | `YYYY-MM-DD` | Creation date |
| `updated` | `YYYY-MM-DD` | Last update date |
| `relationships` | array | Typed connections to other artifacts |

## ID Allocation

Check existing artifacts to find the next available ID:

```bash
ls .orqa/delivery/tasks/ | sort -t- -k2 -n | tail -1
```

## Relationship Protocol

1. **Always bidirectional** — write both forward and inverse
2. **Read the target** — verify it exists before creating the relationship
3. **Check type constraints** — some relationships only apply between specific types
4. **Update both files** — the source AND the target artifact

Example: Creating a task that delivers to an epic:

```yaml
# In TASK-367f0026.md
relationships:
  - target: EPIC-6967c7dc
    type: delivers
```

```yaml
# In EPIC-6967c7dc.md — add the inverse
relationships:
  - target: TASK-367f0026
    type: delivered-by
```

## Common Patterns

### New Task

```yaml
---
id: TASK-NNN
type: task
title: "Task title"
status: captured
created: YYYY-MM-DD
updated: YYYY-MM-DD
relationships:
  - target: EPIC-NNN
    type: delivers
---

# TASK-NNN: Task Title

## Acceptance Criteria

1. ...
2. ...
```

### New Epic

```yaml
---
id: EPIC-NNN
type: epic
title: "Epic title"
status: captured
created: YYYY-MM-DD
updated: YYYY-MM-DD
relationships:
  - target: MS-NNN
    type: fulfils
  - target: TASK-NNN
    type: delivered-by
---
```

### New Decision

```yaml
---
id: AD-NNN
type: decision
title: "Decision title"
status: active
created: YYYY-MM-DD
updated: YYYY-MM-DD
relationships:
  - target: PILLAR-NNN
    type: grounded
---
```

## Validation

After creating artifacts:
1. Check frontmatter against `schema.json` in the target directory
2. Verify all relationship targets exist
3. Verify all inverses are present on target artifacts
4. Run `orqa validate` to check graph integrity
