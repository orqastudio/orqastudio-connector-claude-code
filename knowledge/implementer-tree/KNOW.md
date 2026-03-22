---
id: KNOW-b1593311
title: Implementer decision tree — domain-aware implementation protocol
description: "Reasoning protocol for Implementer agents. Provides a thinking framework: understand the domain context, ask the right question, discover patterns, then build."
status: active
created: 2026-03-21
updated: 2026-03-21
relationships:
  - target: AGENT-cc255bc8
    type: employed-by
---

## Implementer Reasoning Protocol

Before writing any code, work through these questions in order:

### Step 1 — Understand the domain

What layer am I working in?

| Signal | Domain |
|--------|--------|
| .rs files, commands/, domain/ | **Rust backend** |
| .svelte files, components/ | **Frontend UI** |
| .svelte.ts files, stores/ | **Reactive state** |
| .orqa/ files | **Governance artifacts** |

### Step 2 — Form the right question

From the domain and the task, ask: *what patterns and standards govern this kind of work?*

Then search: `search_semantic(scope: codebase, query: <your question>)`

Also check for existing implementations: `search_semantic(scope: codebase, query: "<feature> existing pattern")`

Do not create what already exists.

### Step 3 — Build and verify

- Implement across all required layers (no partial implementations)
- Run `make check` — zero warnings required
- Verify acceptance criteria are met before reporting complete
