#!/usr/bin/env bash
# OrqaStudio plugin — SessionStart hook
# Runs session health checks and recovers previous session state.
# Symlinks (.claude/agents, .claude/rules) and server configs (.mcp.json, .lsp.json)
# are created at install time by `orqa plugin install`. This hook does NOT regenerate them.

set -euo pipefail

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-.}"
ORQA_DIR="$PROJECT_DIR/.orqa"

# ─── Session Guard ───────────────────────────────────────────────────────────
# Only run health checks once per session
GUARD="$PROJECT_DIR/tmp/.session-started"
if [ -f "$GUARD" ]; then
  exit 0
fi
mkdir -p "$PROJECT_DIR/tmp"
touch "$GUARD"

# ─── Health Checks ───────────────────────────────────────────────────────────
OUTPUT=""

# ─── Graph Integrity ─────────────────────────────────────────────────────────
# Run orqa validate --fix at session start to auto-fix missing inverses
# and surface any remaining integrity issues before work begins.
if command -v orqa &> /dev/null; then
  VALIDATE_OUTPUT=$(cd "$PROJECT_DIR" && orqa validate --fix 2>&1 || true)
  if echo "$VALIDATE_OUTPUT" | grep -q "error"; then
    OUTPUT="${OUTPUT}GRAPH INTEGRITY ISSUES:\n${VALIDATE_OUTPUT}\n\n"
  fi
fi

# Check for stashes
STASHES=$(cd "$PROJECT_DIR" && git stash list 2>/dev/null || true)
if [ -n "$STASHES" ]; then
  OUTPUT="${OUTPUT}WARNING: Git stashes found! Investigate and commit before proceeding:\n${STASHES}\n\n"
fi

# Check for stale worktrees
MAIN_DIR=$(cd "$PROJECT_DIR" && git rev-parse --show-toplevel 2>/dev/null || echo "$PROJECT_DIR")
WORKTREES=$(cd "$PROJECT_DIR" && git worktree list 2>/dev/null | grep -v "$MAIN_DIR" || true)
if [ -n "$WORKTREES" ]; then
  OUTPUT="${OUTPUT}WARNING: Non-main worktrees detected! Check if these need cleanup:\n${WORKTREES}\n\n"
fi

# Check for orphaned worktree directories
PARENT_DIR=$(dirname "$MAIN_DIR")
ORPHANS=$(ls -d "$PARENT_DIR"/orqa-* 2>/dev/null || true)
if [ -n "$ORPHANS" ]; then
  OUTPUT="${OUTPUT}WARNING: Orphaned worktree directories found:\n${ORPHANS}\n\n"
fi

# Check for uncommitted changes on main
CURRENT_BRANCH=$(cd "$PROJECT_DIR" && git branch --show-current 2>/dev/null || true)
if [ "$CURRENT_BRANCH" = "main" ]; then
  UNCOMMITTED=$(cd "$PROJECT_DIR" && git status --short 2>/dev/null | wc -l | tr -d ' ')
  if [ "$UNCOMMITTED" -gt 20 ]; then
    OUTPUT="${OUTPUT}WARNING: ${UNCOMMITTED} uncommitted files on main! Commit before starting new work.\n\n"
  elif [ "$UNCOMMITTED" -gt 0 ]; then
    OUTPUT="${OUTPUT}NOTE: ${UNCOMMITTED} uncommitted files on main. Consider committing before starting new work.\n\n"
  fi
fi

# ─── Session Continuity ─────────────────────────────────────────────────────
# Load previous session state for context recovery.
# Also check for governance context saved before compaction.
if [ -f "$PROJECT_DIR/tmp/session-state.md" ]; then
  SESSION_STATE=$(cat "$PROJECT_DIR/tmp/session-state.md")
  OUTPUT="${OUTPUT}═══ PREVIOUS SESSION STATE ═══\n${SESSION_STATE}\n"
  OUTPUT="${OUTPUT}═══ END SESSION STATE ═══\n\n"
  OUTPUT="${OUTPUT}ACTION REQUIRED: Read the session state above. Resume where the previous session left off.\n"
  OUTPUT="${OUTPUT}If the scope has changed, acknowledge the previous state and set a new scope.\n\n"
fi

if [ -f "$PROJECT_DIR/tmp/governance-context.md" ]; then
  GOV_CONTEXT=$(cat "$PROJECT_DIR/tmp/governance-context.md")
  OUTPUT="${OUTPUT}GOVERNANCE CONTEXT (from pre-compaction save):\n${GOV_CONTEXT}\n\n"
fi

# Dogfood detection
if [ -f "$ORQA_DIR/project.json" ]; then
  if grep -q '"dogfood"[[:space:]]*:[[:space:]]*true' "$ORQA_DIR/project.json" 2>/dev/null; then
    OUTPUT="${OUTPUT}DOGFOOD MODE ACTIVE: You are editing the app from the CLI.\n"
    OUTPUT="${OUTPUT}- CLI context: make restart does NOT end the session\n"
    OUTPUT="${OUTPUT}- Use make restart-tauri after Rust changes\n"
    OUTPUT="${OUTPUT}- See RULE-009 for full dogfood rules\n\n"
  fi
fi

# Session management protocol
OUTPUT="${OUTPUT}SESSION PROTOCOL:\n"
OUTPUT="${OUTPUT}1. Read previous session state (above, if present)\n"
OUTPUT="${OUTPUT}2. Set scope: which epic/task is the focus for this session?\n"
OUTPUT="${OUTPUT}3. Work within scope — delegate to specialized agents\n"
OUTPUT="${OUTPUT}4. Before stopping: write session state to tmp/session-state.md\n\n"

OUTPUT="${OUTPUT}ORCHESTRATOR REMINDERS:\n"
OUTPUT="${OUTPUT}- You coordinate. You do NOT implement. Delegate to specialized agents.\n"
OUTPUT="${OUTPUT}- Universal roles: researcher, planner, implementer, reviewer, writer, designer, governance-steward\n"
OUTPUT="${OUTPUT}- Roles are specialised via knowledge at runtime\n\n"

OUTPUT="${OUTPUT}SESSION START CHECKLIST:\n"
OUTPUT="${OUTPUT}- Check .orqa/delivery/tasks/ for active tasks\n"
OUTPUT="${OUTPUT}- Check .orqa/delivery/epics/ for active epics\n"
OUTPUT="${OUTPUT}- Read the active epic to understand context\n"

if [ -n "$OUTPUT" ]; then
  echo -e "$OUTPUT"
fi

exit 0
