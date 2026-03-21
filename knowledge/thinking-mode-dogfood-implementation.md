---
id: KNOW-a4c8f1e2
type: knowledge
title: "Thinking Mode: Dogfood Implementation"
description: "Building infrastructure for immediate use in the current workflow — not a future feature idea."
status: active
created: 2026-03-21
updated: 2026-03-21
relationships:
  - target: RULE-009
    type: related-to
  - target: RULE-010
    type: related-to
---

# Thinking Mode: Dogfood Implementation

You are building infrastructure that this project will use immediately. This is not a future feature idea — it's work-enabling infrastructure for the current session or workflow.

## Example Signals

- "build a symlink script and dogfood it"
- "create this now — we need it for our workflow"
- "let's use this in the current session"
- "build this infrastructure today"
- "we should dogfood X immediately"
- "let's implement this now so we can use it"
- "this needs to work right now for us"
- "add this feature and test it with our setup"

## What the Agent Needs

**Core requirements (same as Implementation Mode):**
- Coding standards (RULE-006) and four-layer completeness rule (RULE-010)
- Relevant domain knowledge: `svelte5-best-practices`, `rust-async-patterns`, `orqa-ipc-patterns`
- Search the codebase for existing implementations before creating new ones
- Verify full request chain: component → store → invoke → Rust command

**PLUS Dogfood-Specific Guidance:**
- Awareness of `dogfood: true` flag in `.orqa/project.json` — you are editing the app from inside or alongside it
- RULE-009 context (dogfood mode constraints, restart protocol, sidecar self-edit warnings)
- Search **aggressively** for existing patterns in THIS codebase — reuse over rebuild is critical for dogfood
- For Rust backend changes: offer to run `make restart-tauri` after commit — changes affect the running environment
- For sidecar protocol changes (`sidecar/src/`): warn before modifying; protocol changes require rebuild + restart
- For frontend changes: Vite HMR handles them live, but avoid editing conversation components mid-stream (can crash)
- After changes: be ready to restart the app to verify they work end-to-end

## Key Differences from Regular Implementation

| Aspect | Regular Implementation | Dogfood Implementation |
|--------|----------------------|----------------------|
| Motivation | Feature roadmap | Immediate workflow utility |
| Urgency | Can wait for planning/design cycle | Needed now |
| Consequence | Code goes into the app | Code affects the running app |
| Testing | Integration tests + CI pipeline | Manual verification + potential restart |
| Pattern search | Moderate — rewrite is acceptable | Aggressive — reuse is mandatory |

**Example distinction:**
- Regular: "add a metrics dashboard" (feature for users)
- Dogfood: "build a script to auto-migrate old artifacts" (tool for us right now)

## Distinguishing from Similar Modes

- Not **Planning**: execution is happening immediately, not after a design phase
- Not **Implementation** (regular): urgency + immediate use + affects running environment
- Not **Ideas**: not speculative or future-facing — this is happening now
- Not **Learning Loop**: not teaching the system — building a tool
