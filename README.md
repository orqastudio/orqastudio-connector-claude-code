![License](https://img.shields.io/badge/license-BSL%201.1-blue)
![Status](https://img.shields.io/badge/status-pre--release-orange)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)

![OrqaStudio](https://github.com/orqastudio/orqastudio-brand/blob/main/assets/banners/banner-1680x240.png?raw=1)

# Claude Code Connector

Dual-manifest connector plugin bridging OrqaStudio's governance system with Claude Code's plugin framework. Serves as both an OrqaStudio plugin (`orqa-plugin.json`) and a Claude Code plugin (`.claude-plugin/plugin.json`).

## What It Does

- **Rule enforcement** — evaluates governance rules via PreToolUse hooks (block/warn/inject)
- **Knowledge injection** — injects relevant domain knowledge based on file paths being edited
- **Session health checks** — validates graph integrity, warns on stashes and uncommitted work
- **Slash commands** — `/orqa`, `/orqa-validate`, `/orqa-create`

## Architecture

```
connectors/claude-code/
├── .claude-plugin/plugin.json  ← Claude Code sees this
├── orqa-plugin.json            ← OrqaStudio sees this
├── hooks/
│   ├── hooks.json              ← Hook event registrations
│   └── scripts/                ← Hook implementation scripts
├── skills/                     ← 5 curated user-invocable Claude Code skills
├── knowledge/                  ← Domain knowledge files (injected by hooks)
├── agents/                     ← Claude Code subagent definitions
├── commands/                   ← 3 slash commands (/orqa, /orqa-validate, /orqa-create)
└── src/                        ← TypeScript library (rule engine, prompt injector)
```

## Bridge Model

The connector makes OrqaStudio's governance visible to Claude Code without copying or syncing files.

### What `orqa plugin install` sets up (once, at install time)

```
.claude/CLAUDE.md              ← Claude Code CLAUDE.md (connector-owned, not a symlink)
.claude/rules/    →  .orqa/process/rules/       (symlink)
.claude/agents/   →  .orqa/process/agents/      (symlink)
.claude/knowledge/ → .orqa/process/knowledge/   (symlink)
.mcp.json                      ← Generated MCP server config
.lsp.json                      ← Generated LSP server config
```

The installer runs once. The SessionStart hook does NOT regenerate these.

### CLAUDE.md

CLAUDE.md is a Claude Code artifact maintained by the connector — it contains orchestration instructions for Claude Code. It is **not** derived from `.orqa/process/agents/orchestrator.md`. The two files serve different purposes:

- `CLAUDE.md` — Claude Code system prompt: how to use Claude Code tools, hook behavior, session protocol
- `.orqa/process/agents/orchestrator.md` — OrqaStudio agent definition: role, capabilities, knowledge, relationships

### Knowledge (`knowledge/`)

Domain knowledge files that the prompt-injector hook injects as system context based on which files the agent is editing. These are flat markdown files:

```
knowledge/
├── orqa-domain-services.md
├── orqa-ipc-patterns.md
├── svelte5-best-practices.md
└── ...
```

File paths trigger injection — editing `backend/src-tauri/src/domain/` injects `orqa-domain-services.md`. Agents read these as reference documentation. These files are **not** copies of `.orqa/process/knowledge/` — they are the connector's own curated versions.

### Skills (`skills/`)

5 curated Claude Code skills invocable via the `Skill()` tool:

| Skill | Purpose |
|-------|---------|
| `governance-context` | How to read the artifact graph, relationship vocabulary |
| `planning` | Documentation-first planning protocol |
| `search` | Unified search (regex, semantic, research queries) |
| `diagnostic-methodology` | Root cause analysis workflow |
| `plugin-setup` | Plugin installation and migration guide |

These are user-invocable. They are **not** domain knowledge for auto-injection — that is `knowledge/`.

### SessionStart Hook

The SessionStart hook runs health checks only:
- Runs `orqa enforce --fix` to surface graph integrity issues
- Warns on uncommitted changes, stale stashes, orphaned worktrees
- Recovers previous session state from `tmp/session-state.md`

It does **not** create symlinks, regenerate configs, or sync files.

## Installation

Installed alongside the Claude Integration plugin (`@orqastudio/plugin-claude`) via:

```bash
orqa plugin install @orqastudio/connector-claude-code
```

## License

Apache-2.0 — see [LICENSE](LICENSE) for details.
