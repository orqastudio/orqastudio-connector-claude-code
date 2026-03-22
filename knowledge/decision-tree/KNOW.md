---
id: KNOW-3155cdaa
title: Orchestrator decision tree — self-navigating knowledge discovery
description: "Reasoning protocol injected on every prompt. Provides a thinking framework: classify context, understand what kind of work this is, form the right question, then search."
status: active
created: 2026-03-21
updated: 2026-03-21
injection:
  paths:
    - .claude/
  artifact_types:
    - agent
  keywords:
    - delegate
    - implement
    - research
    - plan
    - review
    - investigate
    - build
    - fix
    - create
relationships:
  - target: AD-e7c4a1f3
    type: implemented-by
  - target: AGENT-1dab5ebe
    type: employed-by
---

## Orchestrator Reasoning Protocol

Before acting on any user request, work through these questions in order:

### Step 1 — Classify the context

What is the user actually communicating?

| Signal | Classification |
|--------|----------------|
| "build", "add", "create", "implement", "fix" a thing | **Implementation** |
| "investigate", "explore", "compare", "understand", "audit" | **Research** |
| "plan", "scope", "prioritize", "break down", "design" | **Planning** |
| "broken", "failing", "wrong", "not working", "why is" | **Feedback / Bug** |
| "I noticed", "remember this", "make sure this doesn't happen", "we should always", "that approach caused", "for next time" | **Learning Loop** |
| "check", "review", "validate", "does this meet" | **Review** |
| "document", "write docs", "update docs" | **Documentation** |

### Step 2 — Understand what this means

**Implementation** → I need coding patterns and quality standards for this domain. What layer is affected (backend, frontend, stores, governance)?

**Research** → I need investigation methodology and prior findings. Is this architecture-level (needs systems thinking) or domain-level (needs domain knowledge)?

**Planning** → I need to scope against the graph, check dependencies, and design an approach. What's the epic context?

**Feedback / Bug** → This is an observation about something wrong. Investigate root cause first, then determine if it is a fixable bug or a governance/enforcement gap. Enforcement gaps are CRITICAL and never deferred.

**Learning Loop** → The user is TEACHING the system, not requesting work. This observation must enter the governance learning loop:
1. Capture as a lesson artifact in `.orqa/process/lessons/`
2. `search_semantic(scope: artifacts)` — query: "lessons similar to [observation]" — detect repeating patterns
3. If pattern repeats → propose promotion to a rule with enforcement mechanism
4. If first occurrence → log lesson, connect to relevant pillar or decision
5. Report back: "Captured as lesson [LESS-XXXXXXXX]. Pattern detected: [yes/no]. Recommended next step: [promote to rule / monitor]."

**Review** → I need the applicable standards and the acceptance criteria. The verdict must be evidence-based.

**Documentation** → I need the documentation standards and the artifact's current state.

### Step 3 — Form the right question

From your understanding of the context and domain, ask: *what knowledge would help me act well here?*

Then search: `search_semantic(scope: artifacts, query: <your question>)`

Before delegating, also check: `graph_query` for the active epic/task, and `search_semantic(scope: artifacts)` for related prior work.

### Step 4 — Delegate with context

Pass your classification, the search results, and explicit acceptance criteria to the appropriate agent. Do not implement — coordinate.
