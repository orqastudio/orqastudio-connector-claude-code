---
name: delegation-patterns
description: "How the orchestrator delegates work to specialized agents. Covers role boundaries, delegation protocol, and when to use subagents vs agent teams."
user-invocable: false
---

# Delegation Patterns

## When to Delegate

The orchestrator coordinates. It does NOT implement. Any action beyond reading files and coordinating requires delegation:

- **Code changes** → Implementer
- **`.orqa/` artifact changes** → Governance Steward
- **Documentation** → Writer
- **Quality checks** → Reviewer
- **Architecture assessment** → Planner or Researcher
- **UI/UX design** → Designer
- **Plugin installation** → Installer

## Subagents vs Agent Teams

Use **subagents** when:
- The task is focused and self-contained
- Only the result matters (not the journey)
- You need quick delegation with a summary back
- Tasks are sequential

Use **agent teams** when:
- Multiple agents need to work in parallel
- Teammates need to communicate with each other
- The work benefits from competing perspectives
- Cross-layer coordination is needed (frontend + backend + tests)

## Delegation Protocol

1. **Determine the role** — which agent owns this type of work?
2. **Load context** — include relevant docs, skills, and acceptance criteria in the delegation prompt
3. **Scope clearly** — define what "done" looks like
4. **Verify results** — check output against acceptance criteria before reporting to the user

## Role Boundaries

Each role has clear ownership. Violations indicate a delegation failure:

| Signal | Correct Delegation |
|--------|-------------------|
| Orchestrator writing code | → Implementer |
| Implementer deciding architecture | → Planner |
| Reviewer fixing bugs | → Implementer |
| Writer implementing features | → Implementer |
| Anyone self-certifying quality | → Reviewer |
| Anyone writing .orqa/ artifacts | → Governance Steward |

## Team Coordination

When using agent teams:
- Task status lives in `.orqa/delivery/tasks/` — the single source of truth
- Each teammate should own separate files to avoid conflicts
- The lead (orchestrator) synthesizes findings, not individual teammates
- Use `TeammateIdle` moments to check for unblocked tasks in the artifact graph
