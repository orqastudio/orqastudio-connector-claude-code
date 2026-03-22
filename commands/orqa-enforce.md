# /orqa-validate — Run Full Integrity Check

Run the OrqaStudio integrity validator against the artifact graph. This checks all `.orqa/` artifacts for:

- **Frontmatter schema compliance** — required fields, valid types, ID format
- **Relationship validity** — targets exist, type constraints satisfied
- **Bidirectional integrity** — every forward relationship has its inverse
- **Status validity** — only canonical statuses used
- **Graph health** — no orphaned artifacts, no broken references

## How to Run

```bash
# Full validation
orqa enforce

# Validate a specific path
orqa enforce .orqa/delivery/

# Show only errors (skip warnings)
orqa enforce --errors-only

# JSON output for programmatic use
orqa enforce --json
```

## Interpreting Results

| Severity | Meaning | Action |
|----------|---------|--------|
| **ERROR** | Graph integrity broken | Must fix before committing |
| **WARNING** | Best practice violation | Should fix, not blocking |
| **INFO** | Suggestion | Optional improvement |

## Common Issues

### Missing inverse relationship
```
ERROR: TASK-367f0026 --delivers--> EPIC-6967c7dc but EPIC-6967c7dc has no delivered-by --> TASK-367f0026
```
**Fix:** Add the inverse relationship to the target artifact.

### Invalid status
```
ERROR: TASK-367f0026 has status "in-progress" — must be one of: captured, exploring, ready, ...
```
**Fix:** Use one of the 12 canonical statuses (e.g., `active` instead of `in-progress`).

### Missing required field
```
ERROR: .orqa/delivery/tasks/TASK-367f0026.md — missing required field: id
```
**Fix:** Add the required field to the YAML frontmatter.

## Baseline

The project maintains **0 errors, 0 warnings** as a baseline. Any regression must be fixed before committing.
