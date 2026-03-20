#!/usr/bin/env bash
# OrqaStudio plugin — SessionStart hook
# Sets up .claude/ symlinks and runs session health checks

set -euo pipefail

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-.}"
ORQA_DIR="$PROJECT_DIR/.orqa"
CLAUDE_DIR="$PROJECT_DIR/.claude"

# ─── Symlink Setup ───────────────────────────────────────────────────────────
# The plugin manages all .claude/ symlinks. .orqa/ is the single source of truth.
# These symlinks are required by Claude Code's native discovery:
#   CLAUDE.md  — project instructions (from orchestrator agent)
#   rules/     — rules loaded as system context
#   agents/    — agent definitions for subagent delegation
#   skills/    — skill definitions for /skill commands

create_symlink() {
  local link="$1"
  local target="$2"

  # Detect OS for symlink creation
  if [[ "$OSTYPE" == "msys" || "$OSTYPE" == "mingw"* || "$OSTYPE" == "cygwin" ]]; then
    # Windows — use PowerShell for proper NTFS symlinks
    local win_link
    local win_target
    win_link=$(cygpath -w "$link" 2>/dev/null || echo "$link")
    win_target=$(cygpath -w "$target" 2>/dev/null || echo "$target")

    if [ -d "$target" ]; then
      powershell -Command "New-Item -ItemType SymbolicLink -Path '$win_link' -Target '$win_target' -Force" > /dev/null 2>&1
    else
      powershell -Command "New-Item -ItemType SymbolicLink -Path '$win_link' -Target '$win_target' -Force" > /dev/null 2>&1
    fi
  else
    # Unix — standard ln -sfn
    ln -sfn "$target" "$link"
  fi
}

setup_symlink() {
  local link="$1"
  local target="$2"

  # Skip if .orqa/ source doesn't exist
  if [ ! -e "$target" ]; then
    return
  fi

  # Already a correct symlink
  if [ -L "$link" ]; then
    return
  fi

  # Real file/dir exists — don't overwrite
  if [ -e "$link" ]; then
    return
  fi

  create_symlink "$link" "$target"
}

if [ -d "$ORQA_DIR" ]; then
  mkdir -p "$CLAUDE_DIR"

  # .claude/ symlinks — required by Claude Code's native discovery
  # CLAUDE.md → orchestrator agent definition (project instructions)
  # rules/ → governance rules with enforcement arrays
  # agents/ → agent definitions for subagent delegation
  # NOTE: skills/ is NOT symlinked — skills come through the plugin's skills/
  # directory and are curated for the Claude Code context, not raw OrqaStudio artifacts
  setup_symlink "$CLAUDE_DIR/CLAUDE.md" "$ORQA_DIR/process/agents/orchestrator.md"
  setup_symlink "$CLAUDE_DIR/rules"     "$ORQA_DIR/process/rules"
  setup_symlink "$CLAUDE_DIR/agents"    "$ORQA_DIR/process/agents"
fi

# ─── Plugin Skill Registration ───────────────────────────────────────────────
# Register plugin skills in .orqa/process/skills/ so they're discoverable by
# the artifact scanner and browsable in the app. Plugin skills have layer: plugin.
# NOTE: Claude Code discovers skills natively via the plugin's skills/ directory.
# This symlink is for the OrqaStudio app's artifact scanner only.
PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-}"

if [ -n "$PLUGIN_ROOT" ] && [ -d "$PLUGIN_ROOT/skills" ] && [ -d "$ORQA_DIR/process/skills" ]; then
  for skill_dir in "$PLUGIN_ROOT"/skills/*/; do
    [ -d "$skill_dir" ] || continue
    skill_name=$(basename "$skill_dir")
    target_dir="$ORQA_DIR/process/skills/$skill_name"
    setup_symlink "$target_dir" "$skill_dir"
  done
fi

# ─── Skill Sync ──────────────────────────────────────────────────────────────
# Sync OrqaStudio skills to Claude Code format in the plugin's skills/ directory.
if [ -n "$PLUGIN_ROOT" ] && [ -f "$PLUGIN_ROOT/hooks/scripts/sync-skills.mjs" ]; then
  CLAUDE_PROJECT_DIR="$PROJECT_DIR" CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" \
    node "$PLUGIN_ROOT/hooks/scripts/sync-skills.mjs" 2>/dev/null || true
fi

# ─── Server Sync ─────────────────────────────────────────────────────────────
# Aggregate LSP/MCP server declarations from all installed plugins into
# .lsp.json and .mcp.json (AD-059: central registration via manifests).
if [ -n "$PLUGIN_ROOT" ] && [ -f "$PLUGIN_ROOT/hooks/scripts/sync-servers.mjs" ]; then
  CLAUDE_PROJECT_DIR="$PROJECT_DIR" CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" \
    node "$PLUGIN_ROOT/hooks/scripts/sync-servers.mjs" 2>/dev/null || true
fi

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
OUTPUT="${OUTPUT}- Roles are specialised via skills at runtime\n\n"

OUTPUT="${OUTPUT}SESSION START CHECKLIST:\n"
OUTPUT="${OUTPUT}- Check .orqa/delivery/tasks/ for active tasks\n"
OUTPUT="${OUTPUT}- Check .orqa/delivery/epics/ for active epics\n"
OUTPUT="${OUTPUT}- Read the active epic to understand context\n"

if [ -n "$OUTPUT" ]; then
  echo -e "$OUTPUT"
fi

exit 0
