#!/usr/bin/env bash
# Stop hook — provides pre-commit checklist when agent is about to stop

set -euo pipefail

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-.}"
OUTPUT=""

# Check for open worktrees
MAIN_DIR=$(cd "$PROJECT_DIR" && git rev-parse --show-toplevel 2>/dev/null || echo "$PROJECT_DIR")
WORKTREES=$(cd "$PROJECT_DIR" && git worktree list 2>/dev/null | grep -v "$MAIN_DIR" || true)
if [ -n "$WORKTREES" ]; then
  OUTPUT="${OUTPUT}WARNING: Open worktrees detected — merge and clean up before reporting task complete:\n${WORKTREES}\n\n"
fi

# Check for uncommitted changes
UNCOMMITTED=$(cd "$PROJECT_DIR" && git status --short 2>/dev/null | wc -l | tr -d ' ')
if [ "$UNCOMMITTED" -gt 0 ]; then
  OUTPUT="${OUTPUT}UNCOMMITTED CHANGES: ${UNCOMMITTED} files. Commit or stash before ending session.\n\n"
fi

cat <<'EOF'
PRE-STOP CHECKLIST:

Before stopping, verify:
- All checks pass (make check)
- No stub/mock/placeholder patterns in committed code
- Working in worktree (not main) for implementation tasks
- Changes are within task scope
- No TODO comments or stubs added
- Documentation updated if behaviour changed
- Session state written to tmp/session-state.md

COMMIT DISCIPLINE:
- Commit at natural boundaries: end of task, end of epic, end of session
- Never end a session with uncommitted changes on main

FORBIDDEN:
- NEVER use --no-verify — fix the errors instead
- NEVER skip pre-commit hooks
EOF

if [ -n "$OUTPUT" ]; then
  echo ""
  echo -e "$OUTPUT"
fi

exit 0
