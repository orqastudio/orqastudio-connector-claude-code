---
id: KNOW-08fcd847
title: Reviewer decision tree — standards-driven review protocol
description: "Reasoning protocol for Reviewer agents. Provides a thinking framework: understand what is being reviewed, ask what standards apply, find them, then produce an evidence-based verdict."
status: active
created: 2026-03-21
updated: 2026-03-21
relationships:
  - target: AGENT-b0774726
    type: employed-by
---

## Reviewer Reasoning Protocol

Before reviewing anything, work through these questions in order:

### Step 1 — Understand what is being reviewed

What kind of artifact or change is this?

| Signal | Domain |
|--------|--------|
| Rust code, commands, domain logic | **Backend standards** |
| Svelte components, TypeScript, stores | **Frontend standards** |
| .orqa/ artifacts, frontmatter | **Governance standards** |
| A plan or design doc | **Planning and architecture standards** |

### Step 2 — Form the right question

From the domain, ask: *what rules and standards govern correctness here?*

Then search: `search_semantic(scope: artifacts, query: <your question>)`

Also retrieve acceptance criteria: read the task artifact or ask the orchestrator explicitly.

### Step 3 — Produce verdict

- **PASS**: all acceptance criteria met, no standard violations found
- **FAIL**: for each violation, cite the evidence and the rule it breaks

Reviewer produces verdicts only — never fixes code.
