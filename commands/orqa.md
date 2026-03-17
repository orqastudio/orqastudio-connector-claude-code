# /orqa — OrqaStudio Governance Summary & Graph Browser

You are working in an OrqaStudio-governed project. This command gives you access to the project's artifact graph, governance rules, and process workflow — the same system used by the OrqaStudio desktop app.

## How the `.claude/` directory maps to OrqaStudio artifacts

The `.claude/` directory is NOT a standalone configuration. It is a set of **symlinks** into the `.orqa/` artifact graph:

| `.claude/` path | → `.orqa/` artifact | Purpose |
|---|---|---|
| `CLAUDE.md` | `team/agents/orchestrator.md` | Your agent definition (the orchestrator) |
| `rules/` | `governance/rules/` | Enforcement rules with YAML frontmatter |
| `agents/` | `team/agents/` | All agent definitions (orchestrator, planner, implementer, etc.) |
| `skills/` | `team/skills/` | Skill definitions loaded by prompt injection |

This means:
- Editing a rule in `.claude/rules/RULE-001.md` edits the OrqaStudio artifact
- Rules have structured YAML frontmatter with `enforcement` arrays
- Agent definitions follow OrqaStudio's agent artifact schema
- Skills follow OrqaStudio's skill artifact schema

## Browsing the artifact graph

Use the `orqa graph` CLI to browse the full artifact graph:

```bash
# Show graph statistics (types, statuses, counts)
orqa graph --stats

# List all active epics
orqa graph --type epic --status active

# Show a specific artifact with all its relationships
orqa graph --id EPIC-082

# Find artifacts related to a specific one
orqa graph --related-to PILLAR-001

# Search by title
orqa graph --search "plugin"

# Show the delivery hierarchy tree
orqa graph --type milestone,epic,task --tree

# Get JSON output for programmatic use
orqa graph --type decision --json
```

## Understanding the project governance

1. **Pillars** (`.orqa/principles/pillars/`) — The foundational principles. Every decision should trace back to a pillar.
2. **Decisions** (`.orqa/process/decisions/`) — Architecture decisions (AD-nnn). These drive implementation.
3. **Rules** (`.orqa/process/rules/`) — Enforcement rules. Some have `enforcement` arrays that trigger on your actions.
4. **Lessons** (`.orqa/process/lessons/`) — Documented mistakes and patterns. Check before repeating.
5. **Skills** (`.orqa/process/skills/`) — Contextual instructions injected by the prompt-injector hook.
6. **Agents** (`.orqa/process/agents/`) — Role definitions. Your CLAUDE.md IS the orchestrator agent.

## Relationship vocabulary

All artifacts connect through typed relationships in their frontmatter:

| Forward | Inverse | Meaning |
|---|---|---|
| `delivers` | `delivered-by` | Task delivers to epic |
| `drives` | `driven-by` | Decision drives work |
| `enforces` | `enforced-by` | Rule enforces decision |
| `grounded` | `grounded-by` | Artifact anchored to pillar |
| `informs` | `informed-by` | Knowledge flows downstream |
| `evolves-into` | `evolves-from` | Artifact lineage |

## Process workflow

When starting work:
1. Check active epics: `orqa graph --type epic --status active`
2. Find related tasks: `orqa graph --related-to EPIC-nnn --type task`
3. Read relevant decisions and rules before coding
4. Follow the skill injections — they're context-aware

When creating artifacts:
- Use proper YAML frontmatter with `id`, `type`, `status`, `relationships`
- Always add bidirectional relationships (forward AND inverse)
- Use `grounded-by` to connect to pillars, not `informs`
- Run `orqa validate` before committing

## Quick actions

```bash
# Validate integrity
orqa validate

# List installed plugins
orqa plugin list

# Install a plugin
orqa plugin install orqastudio/orqastudio-plugin-claude
```
