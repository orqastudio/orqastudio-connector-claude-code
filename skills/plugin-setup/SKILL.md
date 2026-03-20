---
id: KNOW-CC-5ebf82dc
title: OrqaStudio Plugin Setup
description: Installs the OrqaStudio companion plugin for Claude Code. Detects existing .claude/ infrastructure, migrates to .orqa/, registers the plugin, and sets up symlinks.
status: active
created: "2026-03-11"
updated: "2026-03-11"
scope: []
user-invocable: true
version: 0.1.0
---

# OrqaStudio Plugin Setup

This skill guides the installation of the OrqaStudio companion plugin for
Claude Code. It handles both fresh installs and migrations from existing
`.claude/` infrastructure.

## Detection Phase

Before installing, determine the current state:

### Check 1: Does `.orqa/` exist?

```bash
ls -d .orqa/ 2>/dev/null
```

- **Yes** → OrqaStudio already initialized. Proceed to plugin installation.
- **No** → Fresh project. Run `project-setup` and `project-inference` skills first.

### Check 2: Does `.claude/` exist with real files (not symlinks)?

```bash
# Check for real files vs symlinks
file .claude/CLAUDE.md .claude/rules .claude/agents .claude/skills 2>/dev/null
```

| Finding | Meaning | Action |
|---------|---------|--------|
| No `.claude/` directory | Fresh install | Bootstrap from scratch |
| `.claude/CLAUDE.md` is a real file | Existing Claude Code project | Migrate to `.orqa/` |
| `.claude/CLAUDE.md` is a symlink to `.orqa/` | Already set up for OrqaStudio | Just install plugin |
| `.claude/rules/` contains real `.md` files | Existing rules | Migrate to `.orqa/process/rules/` |
| `.claude/agents/` contains real `.md` files | Existing agents | Migrate to `.orqa/process/agents/` |
| `.claude/skills/` contains real dirs | Existing knowledge | Migrate to `.orqa/process/knowledge/` |

### Check 3: Is the plugin already installed?

```bash
grep -q "orqa-plugin@orqa-local" .claude/settings.json 2>/dev/null
```

## Migration Path (existing `.claude/` infrastructure)

When real files exist in `.claude/`, migrate them to `.orqa/` before installing:

### Step 1: Migrate CLAUDE.md → orchestrator agent

```bash
# If .claude/CLAUDE.md is a real file (not symlink)
mkdir -p .orqa/process/agents/
cp .claude/CLAUDE.md .orqa/process/agents/orchestrator.md
```

Add orchestrator frontmatter if missing:

```yaml
---
id: AGENT-1dab5ebe
role: orchestrator
title: Orchestrator
description: Coordinates work, enforces process, delegates to agents.
capabilities:
  - file_read
  - file_write
  - file_edit
  - file_search
  - content_search
  - code_search_regex
  - code_search_semantic
  - code_research
  - shell_execute
  - skill_load
skills:
  - orqa-code-search
  - composability
  - planning
  - governance-maintenance
  - skills-maintenance
---
```

### Step 2: Migrate rules

```bash
# If .claude/rules/ contains real .md files
mkdir -p .orqa/process/rules/
cp .claude/rules/*.md .orqa/process/rules/
```

Add rule frontmatter if missing. Each rule needs at minimum:

```yaml
---
id: RULE-NNN
title: Rule Title
description: What this rule enforces.
status: active
scope: []
---
```

### Step 3: Migrate agents

```bash
# If .claude/agents/ contains real .md files
mkdir -p .orqa/process/agents/
cp .claude/agents/*.md .orqa/process/agents/
```

### Step 4: Migrate knowledge

```bash
# If .claude/skills/ contains real knowledge directories
mkdir -p .orqa/process/knowledge/
cp -r .claude/skills/*/ .orqa/process/knowledge/
```

### Step 5: Back up and remove originals

```bash
# Move originals to a backup (just in case)
mkdir -p tmp/claude-backup
mv .claude/CLAUDE.md tmp/claude-backup/ 2>/dev/null || true
mv .claude/rules tmp/claude-backup/ 2>/dev/null || true
mv .claude/agents tmp/claude-backup/ 2>/dev/null || true
mv .claude/skills tmp/claude-backup/ 2>/dev/null || true
mv .claude/hooks tmp/claude-backup/ 2>/dev/null || true
```

## Plugin Installation

### Step 1: Clone the plugin

```bash
git clone git@github.com:orqastudio/orqastudio-claude-plugin.git ../orqa-plugin
```

Or if the plugin is already cloned, verify it exists:

```bash
ls ../orqa-plugin/.claude-plugin/plugin.json
```

### Step 2: Register the marketplace

Add the marketplace to `~/.claude/plugins/known_marketplaces.json`:

```json
{
  "orqa-local": {
    "source": {
      "source": "directory",
      "path": "<absolute-path-to-orqa-plugin>"
    },
    "installLocation": "<home>/.claude/plugins/marketplaces/orqa-local",
    "lastUpdated": "<current-iso-date>"
  }
}
```

Create the marketplace symlink:

```bash
ln -sfn "<absolute-path-to-orqa-plugin>" ~/.claude/plugins/marketplaces/orqa-local
```

### Step 3: Register the plugin installation

Add to `~/.claude/plugins/installed_plugins.json` under the `plugins` object:

```json
{
  "orqa-plugin@orqa-local": [
    {
      "scope": "project",
      "projectPath": "<absolute-path-to-project>",
      "installPath": "<absolute-path-to-orqa-plugin>",
      "version": "0.1.0",
      "installedAt": "<current-iso-date>",
      "lastUpdated": "<current-iso-date>"
    }
  ]
}
```

### Step 4: Enable the plugin in project settings

Write `.claude/settings.json`:

```json
{
  "enabledPlugins": {
    "orqa-plugin@orqa-local": true
  },
  "env": {
    "CLAUDE_AUTOCOMPACT_PCT_OVERRIDE": "70"
  }
}
```

The `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` triggers compaction at 70% context usage instead of the default 95%. This gives the PreCompact hook time to save governance context before the window fills completely.

### Step 5: Verify

Restart Claude Code. The plugin's SessionStart hook will:

1. Create `.claude/CLAUDE.md` → `.orqa/process/agents/orchestrator.md` symlink
2. Create `.claude/rules/` → `.orqa/process/rules/` symlink
3. Create `.claude/agents/` → `.orqa/process/agents/` symlink
4. Create `.claude/knowledge/` → `.orqa/process/knowledge/` symlink
5. Run session health checks (stashes, worktrees, uncommitted files)

## Fresh Install Path (no existing `.claude/`)

1. Run `project-setup` skill to create `.orqa/` structure
2. Run `project-inference` skill to detect project characteristics
3. Follow the Plugin Installation steps above
4. On first session start, the plugin creates all symlinks automatically

## What the Plugin Provides

| Component | Source | Purpose |
|-----------|--------|---------|
| PreToolUse hook | `hooks/hooks.json` | Rule enforcement via pattern matching |
| SessionStart hook | `hooks/hooks.json` | Symlink setup + session health checks |
| Stop hook | `hooks/hooks.json` | Pre-commit checklist reminders |
| Rule enforcement knowledge | `knowledge/rule-enforcement/` | Documents how enforcement works |
| `/orqa` command | `commands/orqa.md` | Governance summary |

## What Stays in `.claude/`

After installation, `.claude/` contains only:

| Item | Type | Purpose |
|------|------|---------|
| `settings.json` | Real file | Plugin enablement, Claude Code config |
| `worktrees/` | Real dir | Claude Code worktree state |
| `CLAUDE.md` | Symlink | → `.orqa/process/agents/orchestrator.md` |
| `rules/` | Symlink | → `.orqa/process/rules/` |
| `agents/` | Symlink | → `.orqa/process/agents/` |

Domain knowledge is accessed via the `knowledge/` directory in the connector plugin. Claude Code-native skills (for the `Skill()` tool) come through the plugin's `skills/` directory. Everything in `.orqa/` is the source of truth. The symlinks are managed by the plugin.

## Platform Notes

### Windows (MSYS2/Git Bash)

The `ln -s` command in MSYS2 creates copies, not real NTFS symlinks. The plugin's
SessionStart hook uses PowerShell to create proper symlinks on Windows:

```bash
powershell -Command "New-Item -ItemType SymbolicLink -Path '...' -Target '...'"
```

This requires Developer Mode enabled or running as administrator.

### macOS / Linux

Standard `ln -sfn` works without special permissions.

## LSP Server Setup

The OrqaStudio LSP server provides real-time validation of `.orqa/` artifact files in your editor. It's separate from the Claude Code plugin — it runs in your editor (VS Code, Neovim, etc.).

### VS Code

Add to `.vscode/settings.json`:

```json
{
  "orqastudio.lsp.path": "orqa-studio",
  "orqastudio.lsp.args": ["--lsp"]
}
```

Or if using a language client extension, configure the server command:

```json
{
  "languageserver": {
    "orqastudio": {
      "command": "orqa-studio",
      "args": ["--lsp"],
      "filetypes": ["markdown"],
      "rootPatterns": [".orqa/"]
    }
  }
}
```

### What it provides

- Frontmatter schema validation (required fields, valid types)
- Hex ID format validation (AD-057)
- Skill documentation constraint (AD-058)
- Relationship target existence checking
- Status validation (12 canonical statuses)
- Duplicate frontmatter key detection
- Real-time diagnostics as you type
