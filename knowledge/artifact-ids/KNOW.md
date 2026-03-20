---
name: artifact-ids
description: "How artifact IDs work in OrqaStudio — TYPE-XXXXXXXX hex format, generation, validation. Injected when creating artifacts."
user-invocable: false
---

# Artifact IDs

## Format

All artifact IDs use `TYPE-XXXXXXXX` where:
- `TYPE` is the artifact type prefix in uppercase (SKILL, TASK, EPIC, RULE, AD, DOC, etc.)
- `XXXXXXXX` is 8 lowercase hexadecimal characters, randomly generated

Examples: `SKILL-a7f3b2c1`, `TASK-9e4d1f08`, `EPIC-c3a82b7e`

## Generating IDs

```bash
# CLI
orqa id generate TASK

# Shell (no CLI)
echo "TASK-$(openssl rand -hex 4)"
```

In code:
```typescript
const id = `${prefix}-${crypto.randomBytes(4).toString('hex')}`;
```

## Rules

- The type prefix MUST match the artifact's actual type
- The hex portion MUST be exactly 8 lowercase hex characters
- IDs are location-independent — they don't change when artifacts move between core, plugins, or projects
- Each ID must be unique across the entire graph

## Legacy IDs

Sequential IDs like `TASK-580` or `SKILL-SVE-001` are still valid and accepted by the scanner. New artifacts must use the hex format.
